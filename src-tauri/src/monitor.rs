use crate::config::{load_config, RoomConfig};
use crate::parser::parse_douyin_live;
use crate::recorder::{start_recording, RecorderState};
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub fn start_monitor_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            // 获取当前配置
            let config = load_config(&app);
            let global = config.global.clone();

            // 过滤出需要监控的房间
            let monitoring_rooms: Vec<RoomConfig> = config
                .rooms
                .iter()
                .filter(|r| r.is_monitoring)
                .cloned()
                .collect();

            if !monitoring_rooms.is_empty() {
                // 获取当前正在录制的任务
                let active_tasks = if let Some(recorder_state) = app.try_state::<RecorderState>() {
                    let tasks = recorder_state.tasks.lock().await;
                    tasks.keys().cloned().collect::<std::collections::HashSet<String>>()
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
                    tauri::async_runtime::spawn(async move {
                        match parse_douyin_live(
                            &room_clone.url,
                            &global_clone.cookie,
                            &global_clone.user_agent,
                            &global_clone.sec_ch_ua,
                        )
                        .await
                        {
                            Ok(info) => {
                                if info.is_live && !info.streams.is_empty() {
                                    // 查找画质匹配
                                    let selected_stream = info
                                        .streams
                                        .iter()
                                        .find(|s| s.quality_name == room_clone.preferred_quality)
                                        .or_else(|| info.streams.first());

                                    if let Some(stream) = selected_stream {
                                        // 优先采用 m3u8 地址，其次为 flv
                                        let stream_url = stream
                                            .m3u8_url
                                            .clone()
                                            .or_else(|| stream.flv_url.clone());

                                        if let Some(url) = stream_url {
                                            if let Some(recorder_state) = app_clone.try_state::<RecorderState>() {
                                                let res = start_recording(
                                                    app_clone.clone(),
                                                    recorder_state,
                                                    room_clone.room_id.clone(),
                                                    info.anchor_name.clone(),
                                                    url,
                                                    global_clone.ffmpeg_path.clone(),
                                                    global_clone.save_dir.clone(),
                                                    room_clone.segment_duration_mins,
                                                    global_clone.user_agent.clone(),  // 传入用户配置的 UA
                                                )
                                                .await;

                                                if let Err(e) = res {
                                                    eprintln!("监控自动录制启动失败 ({}): {}", room_clone.anchor_name, e);
                                                } else {
                                                    println!("监控检测到开播，已自动启动录制: {}", info.anchor_name);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("监控解析房间 {} 失败: {}", room_clone.url, e);
                            }
                        }
                    });

                    // 房间检测之间延迟 2 秒，降低风控概率
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }

            // 读取轮询间隔
            let interval = if global.monitor_interval_secs < 5 {
                5
            } else {
                global.monitor_interval_secs
            };
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}
