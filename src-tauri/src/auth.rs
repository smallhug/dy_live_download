use crate::config::{save_config, AppConfigState};
use crate::parsers;
use crate::HttpClientState;
use log::{error, info, warn};
use tauri::{AppHandle, Manager, State};
use url::Url;

// 辅助函数：挑选当前指定平台下使用次数最少的 Cookie，并递增计数后保存
pub fn get_and_increment_cookie(app: &AppHandle, state: &AppConfigState, platform: &str) -> String {
    let mut config = state.0.write().unwrap();
    // 筛选出对应平台的 Cookie
    let mut matched_indices = Vec::new();
    for (idx, item) in config.global.cookies.iter().enumerate() {
        if item.platform == platform {
            matched_indices.push(idx);
        }
    }

    if matched_indices.is_empty() {
        return "".to_string();
    }

    // 寻找 use_count 最小的项
    let mut min_idx = matched_indices[0];
    let mut min_count = u32::MAX;
    for &idx in &matched_indices {
        let item = &config.global.cookies[idx];
        if item.use_count < min_count {
            min_count = item.use_count;
            min_idx = idx;
        }
    }

    let cookie_val = config.global.cookies[min_idx].value.clone();

    // 对其进行自增
    config.global.cookies[min_idx].use_count += 1;
    let _ = save_config(app, &config);

    cookie_val
}

// 提供根据 Cookie 自动解析其登录账号昵称的命令
#[tauri::command]
pub async fn get_cookie_nickname(
    config_state: State<'_, AppConfigState>,
    http_state: State<'_, HttpClientState>,
    cookie: String,
    platform: Option<String>,
) -> Result<Option<String>, String> {
    let platform_str = platform.unwrap_or_else(|| "douyin".to_string());
    let ua = {
        let config = config_state.0.read().unwrap();
        if config.global.user_agent.trim().is_empty() {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string()
        } else {
            config.global.user_agent.clone()
        }
    };

    Ok(parsers::fetch_nickname(&http_state.0, &platform_str, &cookie, &ua).await)
}

#[tauri::command]
pub async fn check_login_status(app: AppHandle, platform: Option<String>) -> Result<bool, String> {
    let platform_str = platform.unwrap_or_else(|| "douyin".to_string());
    if platform_str == "bilibili" {
        let Some(window) = app.get_webview_window("bilibili-login") else {
            return Ok(false);
        };
        let target_url = Url::parse("https://www.bilibili.com")
            .map_err(|e| format!("URL 解析失败: {}", e))?;
        match window.cookies_for_url(target_url) {
            Ok(cookies) => {
                let has_session = cookies.iter().any(|c| c.name() == "SESSDATA" && !c.value().is_empty());
                Ok(has_session)
            }
            Err(e) => Err(format!("获取 Cookie 失败: {}", e)),
        }
    } else {
        let Some(window) = app.get_webview_window("douyin-login") else {
            return Ok(false);
        };
        let target_url = Url::parse("https://www.douyin.com")
            .map_err(|e| format!("URL 解析失败: {}", e))?;
        match window.cookies_for_url(target_url) {
            Ok(cookies) => {
                let has_session = cookies.iter().any(|c| c.name() == "sessionid" && !c.value().is_empty());
                Ok(has_session)
            }
            Err(e) => Err(format!("获取 Cookie 失败: {}", e)),
        }
    }
}

#[tauri::command]
pub async fn validate_cookie(
    config_state: State<'_, AppConfigState>,
    http_state: State<'_, HttpClientState>,
    cookie: String,
    platform: Option<String>,
) -> Result<bool, String> {
    let platform_str = platform.unwrap_or_else(|| "douyin".to_string());
    let ua = {
        let config = config_state.0.read().unwrap();
        if config.global.user_agent.trim().is_empty() {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string()
        } else {
            config.global.user_agent.clone()
        }
    };

    match parsers::fetch_nickname(&http_state.0, &platform_str, &cookie, &ua).await {
        Some(_) => Ok(true),
        None => Ok(false),
    }
}

// 从内置的登录子窗口中动态截取包含 HttpOnly 在内的所有 Cookie
// ⚠️ 重要：Tauri 2.0 Windows 环境下必须使用 async 命令读取 cookies，否则会导致死锁！
#[tauri::command]
pub async fn capture_login_cookies(app: AppHandle, platform: Option<String>) -> Result<String, String> {
    let platform_str = platform.unwrap_or_else(|| "douyin".to_string());
    info!("尝试捕获登录 Cookie (async 版本), 平台: {}", platform_str);

    if platform_str == "bilibili" {
        if let Some(window) = app.get_webview_window("bilibili-login") {
            let target_url = Url::parse("https://www.bilibili.com")
                .map_err(|e| {
                    let err_msg = format!("解析B站域名URL失败: {}", e);
                    error!("{}", err_msg);
                    err_msg
                })?;

            info!("正在为目标 URL 获取 Cookie: {} (async)", target_url);
            match window.cookies_for_url(target_url) {
                Ok(cookies) => {
                    info!("cookies_for_url 调用成功，Cookie 总数: {}", cookies.len());
                    for (idx, c) in cookies.iter().enumerate() {
                        info!(
                            "Cookie[{}] Name: {}, Value Length: {}, Domain: {:?}, Secure: {:?}, HttpOnly: {:?}",
                            idx + 1,
                            c.name(),
                            c.value().len(),
                            c.domain(),
                            c.secure(),
                            c.http_only()
                        );
                    }

                    let cookie_str = cookies
                        .iter()
                        .map(|c| format!("{}={}", c.name(), c.value()))
                        .collect::<Vec<String>>()
                        .join("; ");

                    if cookie_str.contains("SESSDATA") {
                        info!("检测到B站关键会话 Cookie (SESSDATA)，捕获成功");
                        Ok(cookie_str)
                    } else {
                        warn!("Cookie 已捕获，但缺少关键的 SESSDATA，用户可能未完成登录验证");
                        Err("未在子窗口中检测到您的B站登录信息，请确保您在扫码助手窗口中已经完成了验证和登录！".to_string())
                    }
                }
                Err(e) => {
                    let err_msg = format!("从底层 WebView 获取 Cookie 失败: {}", e);
                    error!("{}", err_msg);
                    Err(err_msg)
                }
            }
        } else {
            error!("bilibili-login 窗口实例不存在");
            Err("登录助手窗口未打开。请先点击【开启扫码登录助手】按钮拉起窗口！".to_string())
        }
    } else if let Some(window) = app.get_webview_window("douyin-login") {
        let target_url = Url::parse("https://www.douyin.com")
            .map_err(|e| {
                let err_msg = format!("解析抖音域名URL失败: {}", e);
                error!("{}", err_msg);
                err_msg
            })?;

        info!("正在为目标 URL 获取 Cookie: {} (async)", target_url);
        match window.cookies_for_url(target_url) {
            Ok(cookies) => {
                info!("cookies_for_url 调用成功，Cookie 总数: {}", cookies.len());
                for (idx, c) in cookies.iter().enumerate() {
                    info!(
                        "Cookie[{}] Name: {}, Value Length: {}, Domain: {:?}, Secure: {:?}, HttpOnly: {:?}",
                        idx + 1,
                        c.name(),
                        c.value().len(),
                        c.domain(),
                        c.secure(),
                        c.http_only()
                    );
                }

                let cookie_str = cookies
                    .iter()
                    .map(|c| format!("{}={}", c.name(), c.value()))
                    .collect::<Vec<String>>()
                    .join("; ");

                if cookie_str.contains("sessionid") || cookie_str.contains("passport_csrf_token") {
                    info!("检测到抖音关键会话 Cookie (sessionid/passport_csrf_token)，捕获成功");
                    Ok(cookie_str)
                } else {
                    warn!("Cookie 已捕获，但缺少关键的 sessionid 或 passport_csrf_token，用户可能未完成登录验证");
                    Err("未在子窗口中检测到您的抖音登录信息，请确保您在扫码助手窗口中已经完成了验证和登录！".to_string())
                }
            }
            Err(e) => {
                let err_msg = format!("从底层 WebView 获取 Cookie 失败: {}", e);
                error!("{}", err_msg);
                Err(err_msg)
            }
        }
    } else {
        error!("douyin-login 窗口实例不存在");
        Err("登录助手窗口未打开。请先点击【开启扫码登录助手】按钮拉起窗口！".to_string())
    }
}

// 打开内置的登录辅助窗口
// ⚠️ 重要：Tauri 2.0 Windows 环境下必须使用 async 命令创建窗口，否则会导致死锁！
#[tauri::command]
pub async fn open_login_window(app: AppHandle, platform: Option<String>) -> Result<(), String> {
    let platform_str = platform.unwrap_or_else(|| "douyin".to_string());
    info!("打开登录辅助窗口, 平台: {}", platform_str);

    if platform_str == "bilibili" {
        if let Some(old_window) = app.get_webview_window("bilibili-login") {
            let _ = old_window.close();
        }

        let target_url = Url::parse("https://passport.bilibili.com/login").map_err(|e| format!("解析B站登录URL失败: {}", e))?;

        let window = tauri::WebviewWindowBuilder::new(
            &app,
            "bilibili-login",
            tauri::WebviewUrl::External(target_url),
        )
        .title("哔哩哔哩扫码登录助手")
        .inner_size(1000.0, 700.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| format!("创建登录窗口失败: {}", e))?;

        let _ = window.clear_all_browsing_data();

        #[cfg(debug_assertions)]
        {
            window.open_devtools();
        }
    } else {
        if let Some(old_window) = app.get_webview_window("douyin-login") {
            let _ = old_window.close();
        }

        let target_url = Url::parse("https://www.douyin.com").map_err(|e| format!("解析抖音URL失败: {}", e))?;

        let window = tauri::WebviewWindowBuilder::new(
            &app,
            "douyin-login",
            tauri::WebviewUrl::External(target_url),
        )
        .title("抖音扫码登录助手")
        .inner_size(1000.0, 700.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| format!("创建登录窗口失败: {}", e))?;

        let _ = window.clear_all_browsing_data();

        #[cfg(debug_assertions)]
        {
            window.open_devtools();
        }
    }

    Ok(())
}
