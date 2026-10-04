use crate::auth::get_and_increment_cookie;
use crate::config::{save_config, AppConfigState, RoomConfig};
use crate::danmaku::DanmakuManager;
use crate::parsers::{self, LiveRoomInfo};
use crate::recorder::{stop_recording, RecorderState};
use crate::HttpClientState;
use tauri::{AppHandle, State};

// 解析直播间基本信息（用于手动状态检测，使用 Cookie 以防滑块拦截）
#[tauri::command]
pub async fn parse_room(
    app: AppHandle,
    state: State<'_, AppConfigState>,
    http_state: State<'_, HttpClientState>,
    url: String,
    platform: Option<String>,
) -> Result<LiveRoomInfo, String> {
    let platform_str = platform.unwrap_or_else(|| "douyin".to_string());
    let cookie = get_and_increment_cookie(&app, &state, &platform_str);
    let (user_agent, sec_ch_ua) = {
        let config = state.0.read().unwrap();
        (config.global.user_agent.clone(), config.global.sec_ch_ua.clone())
    };

    parsers::parse_live(&http_state.0, &platform_str, &url, &cookie, &user_agent, &sec_ch_ua, "origin").await
}

// 添加直播间
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_room(
    app: AppHandle,
    state: State<'_, AppConfigState>,
    http_state: State<'_, HttpClientState>,
    url: String,
    is_monitoring: bool,
    preferred_quality: String,
    segment_duration_mins: u64,
    platform: Option<String>,
) -> Result<RoomConfig, String> {
    let platform_str = platform.unwrap_or_else(|| "douyin".to_string());
    // 负载均衡选择并自增一个 Cookie
    let cookie = get_and_increment_cookie(&app, &state, &platform_str);

    let (user_agent, sec_ch_ua) = {
        let config = state.0.read().unwrap();
        (config.global.user_agent.clone(), config.global.sec_ch_ua.clone())
    };

    // 解析直播间，以获取真实的 anchor_name 和 room_id
    let info = parsers::parse_live(&http_state.0, &platform_str, &url, &cookie, &user_agent, &sec_ch_ua, &preferred_quality).await?;

    let mut config = state.0.write().unwrap();
    // 检查是否重复
    if config.rooms.iter().any(|r| r.room_id == info.room_id) {
        return Err("该直播间已在任务列表中".to_string());
    }

    let record_danmaku = config.global.record_danmaku;
    let danmaku_format = config.global.danmaku_format.clone();

    let new_room = RoomConfig {
        room_id: info.room_id,
        anchor_name: info.anchor_name,
        is_monitoring,
        preferred_quality,
        segment_duration_mins,
        auto_record: false,
        platform: platform_str,
        record_danmaku,
        danmaku_format,
    };

    config.rooms.push(new_room.clone());
    save_config(&app, &config)?;

    Ok(new_room)
}

// 删除直播间
#[tauri::command]
pub async fn delete_room(
    app: AppHandle,
    state: State<'_, RecorderState>,
    danmaku_manager: State<'_, DanmakuManager>,
    config_state: State<'_, AppConfigState>,
    room_id: String,
) -> Result<(), String> {
    // 如果该房间正在录制，先强行停止录制
    let _ = stop_recording(state, danmaku_manager, &room_id).await;

    let mut config = config_state.0.write().unwrap();
    config.rooms.retain(|r| r.room_id != room_id);
    save_config(&app, &config)
}

// 更新单个直播间配置
#[tauri::command]
pub fn update_room_config(
    app: AppHandle,
    config_state: State<'_, AppConfigState>,
    room: RoomConfig,
) -> Result<(), String> {
    let mut config = config_state.0.write().unwrap();
    if let Some(idx) = config.rooms.iter().position(|r| r.room_id == room.room_id) {
        config.rooms[idx] = room;
        save_config(&app, &config)?;
        Ok(())
    } else {
        Err("找不到该直播间".to_string())
    }
}
