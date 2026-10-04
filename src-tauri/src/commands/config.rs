use crate::config::{save_config, AppConfig, AppConfigState, CookieItem};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn get_config(state: State<'_, AppConfigState>) -> AppConfig {
    state.0.read().unwrap().clone()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_global_config(
    app: AppHandle,
    state: State<'_, AppConfigState>,
    ffmpeg_path: String,
    save_dir: String,
    cookies: Vec<CookieItem>,
    user_agent: String,
    sec_ch_ua: String,
    monitor_interval_secs: u64,
    autostart: bool,
    silent_start: bool,
    close_to_tray: bool,
    has_seen_guide: bool,
    record_danmaku: Option<bool>,
    danmaku_format: Option<String>,
) -> Result<(), String> {
    let mut config = state.0.write().unwrap();
    config.global.ffmpeg_path = ffmpeg_path;
    config.global.save_dir = save_dir;
    config.global.cookies = cookies;
    config.global.user_agent = user_agent;
    config.global.sec_ch_ua = sec_ch_ua;
    config.global.monitor_interval_secs = monitor_interval_secs;
    config.global.autostart = autostart;
    config.global.silent_start = silent_start;
    config.global.close_to_tray = close_to_tray;
    config.global.has_seen_guide = has_seen_guide;
    if let Some(rd) = record_danmaku {
        config.global.record_danmaku = rd;
    }
    if let Some(df) = danmaku_format {
        config.global.danmaku_format = df;
    }
    save_config(&app, &config)?;

    // 联动更新系统开机自启动设置
    if let Some(autostart_manager) = app.try_state::<tauri_plugin_autostart::AutoLaunchManager>() {
        if autostart {
            let _ = autostart_manager.enable();
        } else {
            let _ = autostart_manager.disable();
        }
    }
    Ok(())
}
