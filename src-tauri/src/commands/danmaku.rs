use crate::auth::get_and_increment_cookie;
use crate::config::AppConfigState;
use crate::danmaku::DanmakuManager;
use crate::parsers;
use crate::HttpClientState;
use log::info;
use tauri::{AppHandle, State};

// 启动弹幕独立预览（不关联录制视频）
#[tauri::command]
pub async fn start_danmaku_preview(
    app: AppHandle,
    danmaku_manager: State<'_, DanmakuManager>,
    config_state: State<'_, AppConfigState>,
    http_state: State<'_, HttpClientState>,
    room_id: String,
    platform: Option<String>,
) -> Result<(), String> {
    info!("启动弹幕独立预览: room_id={}, platform={:?}", room_id, platform);
    let (user_agent, sec_ch_ua, platform_str) = {
        let config = config_state.0.read().unwrap();
        let room = config.rooms.iter().find(|r| r.room_id == room_id).cloned();
        let platform_str = platform
            .or_else(|| room.as_ref().map(|r| r.platform.clone()))
            .unwrap_or_else(|| "douyin".to_string());
        let user_agent = config.global.user_agent.clone();
        let sec_ch_ua = config.global.sec_ch_ua.clone();
        (user_agent, sec_ch_ua, platform_str)
    };
    let cookie = get_and_increment_cookie(&app, &config_state, &platform_str);

    let internal_room_id = if platform_str == "douyin" {
        match parsers::douyin::parse_douyin_live(&http_state.0, &room_id, &cookie, &user_agent, &sec_ch_ua).await {
            Ok(info) => info.internal_room_id,
            Err(_) => None,
        }
    } else {
        None
    };

    danmaku_manager.start_session(
        app,
        platform_str,
        room_id,
        internal_room_id,
        cookie,
        user_agent,
        None, // 纯预览不写入文件
    ).await;

    Ok(())
}

// 停止弹幕独立预览
#[tauri::command]
pub async fn stop_danmaku_preview(
    danmaku_manager: State<'_, DanmakuManager>,
    room_id: String,
) -> Result<(), String> {
    info!("停止弹幕独立预览: room_id={}", room_id);
    danmaku_manager.stop_session(&room_id).await;
    Ok(())
}

// 检查弹幕预览是否正在运行
#[tauri::command]
pub async fn is_danmaku_active(
    danmaku_manager: State<'_, DanmakuManager>,
    room_id: String,
) -> Result<bool, String> {
    Ok(danmaku_manager.is_active(&room_id).await)
}

// 订阅前端实时弹幕事件（抽屉打开时激活）
#[tauri::command]
pub async fn subscribe_danmaku(
    danmaku_manager: State<'_, DanmakuManager>,
    room_id: String,
) -> Result<(), String> {
    danmaku_manager.subscribe(&room_id).await;
    Ok(())
}

// 取消订阅前端实时弹幕事件（抽屉关闭时熔断，节省 IPC 开销）
#[tauri::command]
pub async fn unsubscribe_danmaku(
    danmaku_manager: State<'_, DanmakuManager>,
    room_id: String,
) -> Result<(), String> {
    danmaku_manager.unsubscribe(&room_id).await;
    Ok(())
}

// 获取指定房间最近的弹幕历史（支持首屏秒开与向上触顶分页懒加载）
#[tauri::command]
pub async fn get_recent_danmaku(
    danmaku_manager: State<'_, DanmakuManager>,
    room_id: String,
    limit: Option<usize>,
    before_timestamp_ms: Option<u64>,
) -> Result<crate::danmaku::manager::DanmakuPaginationResponse, String> {
    let limit = limit.unwrap_or(50).clamp(10, 200);
    danmaku_manager
        .get_recent_danmaku(&room_id, limit, before_timestamp_ms)
        .await
}
