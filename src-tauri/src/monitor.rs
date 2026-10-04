use crate::config::{AppConfigState, RoomConfig};
use crate::parsers;
use crate::recorder::{start_recording, RecorderState};
use log::{error, info};
use rand::Rng;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, serde::Serialize, Clone)]
struct RoomStatusPayload {
    room_id: String,
    is_live: bool,
    title: String,
}

pub fn start_monitor_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            // 获取当前配置
            let (global, monitoring_rooms) =
                if let Some(config_state) = app.try_state::<AppConfigState>() {
                    let config = config_state.0.read().unwrap();
                    let global = config.global.clone();
                    let monitoring_rooms: Vec<RoomConfig> = config
                        .rooms
                        .iter()
                        .filter(|r| r.is_monitoring)
                        .cloned()
                        .collect();
                    (global, monitoring_rooms)
                } else {
                    (
                        crate::config::AppConfig::default().global,
                        Vec::new(),
                    )
                };

            if !monitoring_rooms.is_empty() {
                // 获取当前正在录制的任务
                let active_tasks = if let Some(recorder_state) = app.try_state::<RecorderState>() {
                    let tasks = recorder_state.tasks.lock().await;
                    tasks
                        .keys()
                        .cloned()
                        .collect::<std::collections::HashSet<String>>()
                } else {
                    std::collections::HashSet::new()
                };

                for room in monitoring_rooms {
                    // 如果已经在录制，跳过
                    if active_tasks.contains(&room.room_id) {
                        continue;
                    }

                    let app_clone = app.clone();
                    let room_clone = room.clone();
                    let global_clone = global.clone();

                    // 异步拉起检测，防止阻塞其他房间检测
                    let cookie = if let Some(config_state) = app_clone.try_state::<AppConfigState>()
                    {
                        crate::auth::get_and_increment_cookie(
                            &app_clone,
                            &config_state,
                            &room_clone.platform,
                        )
                    } else {
                        "".to_string()
                    };
                    let client =
                        if let Some(http_state) = app_clone.try_state::<crate::HttpClientState>() {
                            http_state.0.clone()
                        } else {
                            reqwest::Client::new()
                        };
                    tauri::async_runtime::spawn(async move {
                        match parsers::parse_live(
                            &client,
                            &room_clone.platform,
                            &room_clone.room_id,
                            &cookie, // 使用已保存的 Cookie 进行状态检测以防止滑块拦截
                            &global_clone.user_agent,
                            &global_clone.sec_ch_ua,
                            &room_clone.preferred_quality,
                        )
                        .await
                        {
                            Ok(info) => {
                                // 广播房间状态给前端
                                let _ = app_clone.emit(
                                    "room-status",
                                    RoomStatusPayload {
                                        room_id: room_clone.room_id.clone(),
                                        is_live: info.is_live,
                                        title: info.title.clone(),
                                    },
                                );

                                if info.is_live && !info.streams.is_empty() {
                                    if room_clone.auto_record {
                                        // 查找画质匹配（使用智能降级匹配逻辑）
                                        let selected_stream = parsers::select_best_stream(
                                            &info.streams,
                                            &room_clone.preferred_quality,
                                        );

                                        if let Some(stream) = selected_stream {
                                            // 优先采用 flv 地址，其次为 m3u8（与手动录制逻辑一致）
                                            let stream_url = stream
                                                .flv_url
                                                .clone()
                                                .or_else(|| stream.m3u8_url.clone());

                                            if let Some(url) = stream_url {
                                                if let (Some(recorder_state), Some(danmaku_state)) = (
                                                    app_clone.try_state::<RecorderState>(),
                                                    app_clone.try_state::<crate::danmaku::DanmakuManager>(),
                                                ) {
                                                    let res = start_recording(
                                                        app_clone.clone(),
                                                        recorder_state,
                                                        danmaku_state,
                                                        room_clone.room_id.clone(),
                                                        info.anchor_name.clone(),
                                                        info.title.clone(), // 传入直播标题
                                                        url,
                                                        global_clone.ffmpeg_path.clone(),
                                                        global_clone.save_dir.clone(),
                                                        room_clone.segment_duration_mins,
                                                        global_clone.user_agent.clone(), // 传入用户配置 of UA
                                                        room_clone.platform.clone(),
                                                        room_clone.record_danmaku,
                                                        room_clone.danmaku_format.clone(),
                                                        info.internal_room_id.clone(),
                                                        cookie.clone(),
                                                    )
                                                    .await;

                                                    if let Err(e) = res {
                                                        error!(
                                                            "监控自动录制启动失败 ({}): {}",
                                                            room_clone.anchor_name, e
                                                        );
                                                    } else {
                                                        info!(
                                                            "监控检测到开播，已自动启动录制: {}",
                                                            info.anchor_name
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        info!(
                                            "监控检测到开播，但未开启自动录制配置: {}",
                                            info.anchor_name
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                error!("监控解析房间(ID: {}) 失败: {}", room_clone.room_id, e);
                            }
                        }
                    });

                    // 房间检测之间延迟随机 2~4 秒，降低被风控概率并打破固定时序特征
                    let delay = rand::thread_rng().gen_range(2..=4);
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
            }

            // 读取轮询间隔并加入 0~10 秒随机抖动延时，减弱自动化采集的行为特征
            let interval = if global.monitor_interval_secs < 5 {
                5
            } else {
                global.monitor_interval_secs
            };
            let jitter = rand::thread_rng().gen_range(0..=10);
            tokio::time::sleep(Duration::from_secs(interval + jitter)).await;
        }
    });
}
