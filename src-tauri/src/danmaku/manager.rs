use crate::danmaku::bilibili::run_bilibili_danmaku_loop;
use crate::danmaku::douyin::run_douyin_danmaku_loop;
use crate::danmaku::model::LiveMessage;
use crate::danmaku::writer::DanmakuFileWriter;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio::time::interval;
use tokio_util::sync::CancellationToken;

pub struct DanmakuSession {
    pub cancel_token: CancellationToken,
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
        {
            let mut map = self.sessions.lock().await;
            map.insert(
                room_id.clone(),
                DanmakuSession {
                    cancel_token: cancel_token.clone(),
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
        let sessions_ref = self.sessions.clone();

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
                                // 1. Emit live event to frontend
                                let _ = app.emit("live-danmaku", &msg);

                                // 2. If recording to file, write to disk
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

            // Clean up session if it's still registered
            let mut map = sessions_ref.lock().await;
            map.remove(&consumer_room_id);
            log::info!("[DanmakuManager] Session closed for room {}", consumer_room_id);
        });
    }
}
