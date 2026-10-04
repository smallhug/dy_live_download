use crate::auth::get_and_increment_cookie;
use crate::config::AppConfigState;
use crate::danmaku::DanmakuManager;
use crate::parsers;
use crate::recorder::{get_active_recordings, start_recording, stop_recording, RecorderState};
use crate::HttpClientState;
use log::info;
use std::collections::HashMap;
use tauri::{AppHandle, State};

fn truncate_str(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

// 手动开始录制
#[tauri::command]
pub async fn start_record_task(
    app: AppHandle,
    state: State<'_, RecorderState>,
    danmaku_manager: State<'_, DanmakuManager>,
    config_state: State<'_, AppConfigState>,
    http_state: State<'_, HttpClientState>,
    room_id: String,
) -> Result<(), String> {
    info!("开始手动录制任务");
    info!("room_id: {}", room_id);

    let (room, ffmpeg_path, save_dir, user_agent, sec_ch_ua) = {
        let config = config_state.0.read().unwrap();
        let room = config
            .rooms
            .iter()
            .find(|r| r.room_id == room_id)
            .cloned()
            .ok_or_else(|| "找不到该直播间配置".to_string())?;
        (
            room,
            config.global.ffmpeg_path.clone(),
            config.global.save_dir.clone(),
            config.global.user_agent.clone(),
            config.global.sec_ch_ua.clone(),
        )
    };

    let platform_str = room.platform.clone();
    // 负载均衡选择并自增一个 Cookie
    let cookie = get_and_increment_cookie(&app, &config_state, &platform_str);

    info!("主播: {}, 房间ID: {}, 平台: {}", room.anchor_name, room.room_id, platform_str);

    // 开始解析流地址
    let info = parsers::parse_live(&http_state.0, &platform_str, &room.room_id, &cookie, &user_agent, &sec_ch_ua, &room.preferred_quality).await?;

    info!("解析结果 - is_live: {}, streams数量: {}", info.is_live, info.streams.len());

    if !info.is_live {
        return Err("主播未开播，无法手动录制".to_string());
    }
    if info.streams.is_empty() {
        return Err("未解析到可录制的直播流".to_string());
    }

    // 打印所有可用的流
    for (idx, stream) in info.streams.iter().enumerate() {
        info!(
            "流[{}]: 画质={}, FLV={}, M3U8={}",
            idx,
            stream.quality_name,
            stream.flv_url.as_ref().map(|s| truncate_str(s, 50)).unwrap_or("无"),
            stream.m3u8_url.as_ref().map(|s| truncate_str(s, 50)).unwrap_or("无")
        );
    }

    // 匹配首选画质（使用智能降级匹配逻辑）
    let selected_stream = parsers::select_best_stream(&info.streams, &room.preferred_quality)
        .ok_or_else(|| "无有效画质流".to_string())?;

    info!("选择流: 画质={}", selected_stream.quality_name);

    // 优先使用 FLV 流（原始推流质量最高），M3U8 是转码后的低质量流
    let stream_url = selected_stream
        .flv_url
        .clone()
        .or_else(|| selected_stream.m3u8_url.clone())
        .ok_or_else(|| "无可用推流地址（FLV和M3U8都为空）".to_string())?;

    info!("最终使用URL: {}...", truncate_str(&stream_url, 80));

    info!("调用 start_recording...");
    start_recording(
        app,
        state,
        danmaku_manager,
        room_id,
        info.anchor_name,
        info.title, // 传入直播标题
        stream_url,
        ffmpeg_path,
        save_dir,
        room.segment_duration_mins,
        user_agent,  // 传入用户配置的 UA
        platform_str,
        room.record_danmaku,
        room.danmaku_format,
        info.internal_room_id,
        cookie,
    )
    .await?;

    info!("录制任务启动成功");
    Ok(())
}

// 手动停止录制
#[tauri::command]
pub async fn stop_record_task(
    state: State<'_, RecorderState>,
    danmaku_manager: State<'_, DanmakuManager>,
    room_id: String,
) -> Result<(), String> {
    stop_recording(state, danmaku_manager, &room_id).await
}

// 获取当前正在录制的直播间列表
#[tauri::command]
pub async fn get_active_tasks(state: State<'_, RecorderState>) -> Result<Vec<String>, String> {
    Ok(get_active_recordings(state).await)
}

// 获取当前正在录制的直播间标题映射
#[tauri::command]
pub async fn get_active_task_titles(
    state: State<'_, RecorderState>,
) -> Result<HashMap<String, String>, String> {
    let tasks = state.tasks.lock().await;
    let mut map = HashMap::new();
    for (room_id, task) in tasks.iter() {
        map.insert(room_id.clone(), task.title.clone());
    }
    Ok(map)
}
