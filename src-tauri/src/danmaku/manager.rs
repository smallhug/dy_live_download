use crate::danmaku::bilibili::run_bilibili_danmaku_loop;
use crate::danmaku::douyin::run_douyin_danmaku_loop;
use crate::danmaku::model::LiveMessage;
use crate::danmaku::writer::DanmakuFileWriter;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio::time::interval;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DanmakuPaginationResponse {
    pub messages: Vec<LiveMessage>,
    pub has_more: bool,
}

pub struct DanmakuSession {
    pub cancel_token: CancellationToken,
    pub subscribers: Arc<AtomicUsize>,
    pub ring_buffer: Arc<Mutex<VecDeque<LiveMessage>>>,
}

#[derive(Clone, Default)]
pub struct DanmakuManager {
    sessions: Arc<Mutex<HashMap<String, DanmakuSession>>>,
}

impl DanmakuManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn stop_session(&self, room_id: &str) {
        let mut map = self.sessions.lock().await;
        if let Some(session) = map.remove(room_id) {
            session.cancel_token.cancel();
            log::info!("[DanmakuManager] Stopped danmaku session for room {}", room_id);
        }
    }

    pub async fn is_active(&self, room_id: &str) -> bool {
        let map = self.sessions.lock().await;
        map.contains_key(room_id)
    }

    // 前端打开弹幕抽屉时增加订阅计数
    pub async fn subscribe(&self, room_id: &str) {
        let map = self.sessions.lock().await;
        if let Some(session) = map.get(room_id) {
            session.subscribers.fetch_add(1, Ordering::SeqCst);
            log::info!("[DanmakuManager] Subscribed to live-danmaku for room {}", room_id);
        }
    }

    // 前端关闭弹幕抽屉时减少订阅计数
    pub async fn unsubscribe(&self, room_id: &str) {
        let map = self.sessions.lock().await;
        if let Some(session) = map.get(room_id) {
            let prev = session.subscribers.fetch_sub(1, Ordering::SeqCst);
            if prev <= 1 {
                session.subscribers.store(0, Ordering::SeqCst);
            }
            log::info!("[DanmakuManager] Unsubscribed from live-danmaku for room {}", room_id);
        }
    }

    // 获取会话级环形缓冲区中历史弹幕消息（支持首屏拉取与向上触顶分页懒加载）
    pub async fn get_recent_danmaku(
        &self,
        room_id: &str,
        limit: usize,
        before_timestamp_ms: Option<u64>,
    ) -> Result<DanmakuPaginationResponse, String> {
        let ring_buffer_opt = {
            let map = self.sessions.lock().await;
            map.get(room_id).map(|s| s.ring_buffer.clone())
        };

        let Some(ring_buffer) = ring_buffer_opt else {
            return Ok(DanmakuPaginationResponse {
                messages: Vec::new(),
                has_more: false,
            });
        };

        let buf = ring_buffer.lock().await;
        let filtered: Vec<&LiveMessage> = match before_timestamp_ms {
            Some(ts) => buf.iter().filter(|m| m.timestamp_ms < ts).collect(),
            None => buf.iter().collect(),
        };

        let total = filtered.len();
        let start_idx = total.saturating_sub(limit);
        let slice = &filtered[start_idx..];
        let has_more = start_idx > 0;

        let messages = slice.iter().map(|&m| m.clone()).collect();

        Ok(DanmakuPaginationResponse {
            messages,
            has_more,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start_session(
        &self,
        app: AppHandle,
        platform: String,
        room_id: String,
        internal_room_id: Option<String>,
        cookie: String,
        user_agent: String,
        file_writer_opt: Option<(PathBuf, String, u64)>, // (path, format, start_time_ms)
    ) {
        // Stop any existing session for this room
        self.stop_session(&room_id).await;

        let cancel_token = CancellationToken::new();
        let subscribers = Arc::new(AtomicUsize::new(if file_writer_opt.is_none() { 1 } else { 0 }));
        let ring_buffer = Arc::new(Mutex::new(VecDeque::with_capacity(1024)));

        {
            let mut map = self.sessions.lock().await;
            map.insert(
                room_id.clone(),
                DanmakuSession {
                    cancel_token: cancel_token.clone(),
                    subscribers: subscribers.clone(),
                    ring_buffer: ring_buffer.clone(),
                },
            );
        }

        let (tx, mut rx) = mpsc::channel::<LiveMessage>(200);

        // Spawn platform-specific reader loop
        let client_cancel_token = cancel_token.clone();
        let client_platform = platform.clone();
        let client_room_id = room_id.clone();
        let client_internal_id = internal_room_id.clone();

        tokio::spawn(async move {
            if client_platform == "bilibili" {
                run_bilibili_danmaku_loop(
                    client_room_id,
                    cookie,
                    user_agent,
                    tx,
                    client_cancel_token,
                )
                .await;
            } else if client_platform == "douyin" {
                run_douyin_danmaku_loop(
                    client_room_id,
                    client_internal_id,
                    cookie,
                    user_agent,
                    tx,
                    client_cancel_token,
                )
                .await;
            } else {
                log::warn!("[DanmakuManager] Unsupported platform: {}", client_platform);
            }
        });

        // Spawn event consumer & optional disk writer loop
        let consumer_cancel_token = cancel_token.clone();
        let consumer_room_id = room_id.clone();
        let session_subscribers = subscribers.clone();
        let session_ring_buffer = ring_buffer.clone();

        tokio::spawn(async move {
            let mut writer: Option<(DanmakuFileWriter, u64)> = if let Some((path, format, start_time)) = file_writer_opt {
                match DanmakuFileWriter::create(path.clone(), &format) {
                    Ok(w) => {
                        log::info!("[DanmakuManager] Writing danmaku to {:?}", path);
                        Some((w, start_time))
                    }
                    Err(e) => {
                        log::error!("[DanmakuManager] Failed to create danmaku file at {:?}: {}", path, e);
                        None
                    }
                }
            } else {
                None
            };

            let mut flush_timer = interval(Duration::from_secs(5));
            flush_timer.tick().await;

            loop {
                tokio::select! {
                    _ = consumer_cancel_token.cancelled() => {
                        break;
                    }
                    _ = flush_timer.tick() => {
                        if let Some((w, _)) = &mut writer {
                            let _ = w.flush();
                        }
                    }
                    maybe_msg = rx.recv() => {
                        match maybe_msg {
                            Some(msg) => {
                                // 1. 始终维护进定长 1000 条内存环形缓冲区，供抽屉首屏与触顶分页懒加载
                                {
                                    let mut buf = session_ring_buffer.lock().await;
                                    if buf.len() >= 1000 {
                                        buf.pop_front();
                                    }
                                    buf.push_back(msg.clone());
                                }

                                // 2. 仅当有前端活跃订阅者时才通过 IPC 广播，防止后台录制时引发 IPC 事件风暴
                                if session_subscribers.load(Ordering::Relaxed) > 0 {
                                    let _ = app.emit("live-danmaku", &msg);
                                }

                                // 3. If recording to file, write to disk
                                if let Some((w, start_time)) = &mut writer {
                                    let _ = w.write_message(&msg, *start_time);
                                }
                            }
                            None => {
                                // Channel closed
                                break;
                            }
                        }
                    }
                }
            }

            if let Some((mut w, _)) = writer {
                let _ = w.finish();
                log::info!("[DanmakuManager] Finished danmaku file writer for room {}", consumer_room_id);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::danmaku::model::{LiveMessagePayload, LiveMessageUser};

    fn make_test_msg(id: &str, ts: u64, content: &str) -> LiveMessage {
        LiveMessage {
            id: id.to_string(),
            platform: "douyin".to_string(),
            room_id: "test_room".to_string(),
            timestamp_ms: ts,
            user: LiveMessageUser {
                user_id: "100".to_string(),
                nickname: "用户".to_string(),
                avatar_url: None,
                badge_name: None,
                badge_level: None,
            },
            payload: LiveMessagePayload::Chat {
                content: content.to_string(),
                color: None,
            },
        }
    }

    #[tokio::test]
    async fn test_danmaku_ring_buffer_and_pagination() {
        let manager = DanmakuManager::new();
        let ring_buffer = Arc::new(Mutex::new(VecDeque::with_capacity(10)));
        {
            let mut buf = ring_buffer.lock().await;
            for i in 1..=15 {
                buf.push_back(make_test_msg(&format!("msg_{}", i), i * 1000, &format!("内容{}", i)));
            }
        }

        {
            let mut map = manager.sessions.lock().await;
            map.insert("test_room".to_string(), DanmakuSession {
                cancel_token: CancellationToken::new(),
                subscribers: Arc::new(AtomicUsize::new(0)),
                ring_buffer,
            });
        }

        // 1. 无时间戳参数，默认返回最新的 5 条
        let res1 = manager.get_recent_danmaku("test_room", 5, None).await.unwrap();
        assert_eq!(res1.messages.len(), 5);
        assert_eq!(res1.messages.last().unwrap().id, "msg_15");
        assert_eq!(res1.messages.first().unwrap().id, "msg_11");
        assert!(res1.has_more);

        // 2. 向上翻页：传入 oldest timestamp (11000)，拉取之前的 5 条
        let res2 = manager.get_recent_danmaku("test_room", 5, Some(11000)).await.unwrap();
        assert_eq!(res2.messages.len(), 5);
        assert_eq!(res2.messages.last().unwrap().id, "msg_10");
        assert_eq!(res2.messages.first().unwrap().id, "msg_6");
        assert!(res2.has_more);

        // 3. 翻到最顶部：传入 6000，只剩下 5 条历史 (1~5)
        let res3 = manager.get_recent_danmaku("test_room", 5, Some(6000)).await.unwrap();
        assert_eq!(res3.messages.len(), 5);
        assert_eq!(res3.messages.first().unwrap().id, "msg_1");
        assert!(!res3.has_more); // 已经没有更早的历史了
    }
}
