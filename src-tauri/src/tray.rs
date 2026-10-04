use crate::config::AppConfigState;
use log::info;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager};

pub fn setup_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();

    // 1. 初始化系统托盘菜单
    let show_i = MenuItem::with_id(&app_handle, "show", "显示主界面", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(&app_handle, "quit", "退出应用", true, None::<&str>)?;
    let tray_menu = Menu::with_items(&app_handle, &[&show_i, &quit_i])?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&tray_menu)
        .on_menu_event(|app, event| {
            info!("托盘菜单事件触发: ID={}", event.id.as_ref());
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    info!("托盘收到退出菜单点击，触发 app.exit(0)");
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });

    if let Some(icon) = app_handle.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    let tray = tray_builder.build(app)?;
    app.manage(tray);

    // 2. 窗口关闭到托盘监听
    if let Some(window) = app.get_webview_window("main") {
        let app_handle_clone = app_handle.clone();
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = {
                    let state = app_handle_clone.state::<AppConfigState>();
                    let config = state.0.read().unwrap();
                    config.global.close_to_tray
                };
                if close_to_tray {
                    api.prevent_close();
                    let _ = window_clone.hide();
                    info!("主窗口已隐藏到系统托盘");
                }
            }
        });
    }

    Ok(())
}

pub fn handle_silent_start(app: &AppHandle, silent_start: bool) {
    let args: Vec<String> = std::env::args().collect();
    let is_minimized = args.contains(&"--minimized".to_string());
    if is_minimized && silent_start {
        info!("检测到自启动/静默启动参数 --minimized，隐藏主窗口");
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
}
