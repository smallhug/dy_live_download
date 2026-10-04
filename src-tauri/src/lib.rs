pub mod auth;
pub mod commands;
mod config;
pub mod converter;
pub mod danmaku;
mod logger;
mod monitor;
mod parsers;
mod recorder;
mod telemetry;
mod tray;

use config::{load_config, AppConfigState};
use danmaku::DanmakuManager;
use log::{info, warn};
use recorder::RecorderState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

pub struct HttpClientState(pub reqwest::Client);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(RecorderState::new())
        .manage(DanmakuManager::new())
        .setup(|app| {
            let app_handle = app.handle().clone();

            logger::init_logger(&app_handle);
            info!("应用启动");

            // 初始化并载入配置
            let initial_config = load_config(&app_handle);
            app.manage(AppConfigState(std::sync::RwLock::new(initial_config.clone())));

            // 初始化并托管全局 HTTP 客户端
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("Failed to build global HTTP client");
            app.manage(HttpClientState(client));

            // 静默启动与托盘初始化
            tray::handle_silent_start(&app_handle, initial_config.global.silent_start);
            tray::setup_tray(app).expect("Failed to setup system tray");

            monitor::start_monitor_loop(app_handle.clone());
            telemetry::start_telemetry_loop(app_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 配置管理
            commands::config::get_config,
            commands::config::update_global_config,
            // 房间管理
            commands::room::parse_room,
            commands::room::add_room,
            commands::room::delete_room,
            commands::room::update_room_config,
            commands::room::open_in_external_player,
            // 录制控制
            commands::record::start_record_task,
            commands::record::stop_record_task,
            commands::record::get_active_tasks,
            commands::record::get_active_task_titles,
            // 登录与 Cookie 凭证
            auth::capture_login_cookies,
            auth::open_login_window,
            auth::get_cookie_nickname,
            auth::check_login_status,
            auth::validate_cookie,
            // 视频格式转换
            converter::convert_video,
            // 弹幕预览与按需订阅
            commands::danmaku::start_danmaku_preview,
            commands::danmaku::stop_danmaku_preview,
            commands::danmaku::is_danmaku_active,
            commands::danmaku::subscribe_danmaku,
            commands::danmaku::unsubscribe_danmaku,
            commands::danmaku::get_recent_danmaku
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let is_exiting = Arc::new(AtomicBool::new(false));

    app.run(move |app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if is_exiting.load(Ordering::SeqCst) {
                return;
            }
            is_exiting.store(true, Ordering::SeqCst);
            api.prevent_exit();
            let app_handle_clone = app_handle.clone();

            tauri::async_runtime::spawn(async move {
                info!("应用收到退出指令，正在执行优雅停机...");
                let recorder_state = app_handle_clone.state::<RecorderState>();
                let mut tasks = recorder_state.tasks.lock().await;

                // 1. 发送 'q' 信号优雅退出 FFmpeg
                for (room_id, task) in tasks.iter_mut() {
                    info!("给任务 {} 的子进程发送优雅退出信号", room_id);
                    if let Some(mut stdin) = task.child.stdin.take() {
                        tokio::spawn(async move {
                            use tokio::io::AsyncWriteExt;
                            let _ = stdin.write_all(b"q").await;
                            let _ = stdin.flush().await;
                        });
                    }
                }

                // 2. 收集进程句柄并排空
                let mut children = vec![];
                for (_, task) in tasks.drain() {
                    children.push(task.child);
                }
                drop(tasks);

                // 3. 超时等待 5 秒
                let wait_all = async move {
                    for mut child in children {
                        let _ = child.wait().await;
                    }
                };

                match tokio::time::timeout(std::time::Duration::from_secs(5), wait_all).await {
                    Ok(_) => info!("所有录制子进程优雅退出完成"),
                    Err(_) => warn!("等待录制子进程优雅退出超时，执行强制停机"),
                }

                // 4. 退出应用
                app_handle_clone.exit(0);
            });
        }
    });
}
