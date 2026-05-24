mod config;
mod parser;
mod recorder;
mod monitor;
mod telemetry;

use config::{load_config, save_config, AppConfig, RoomConfig, CookieItem};
use parser::{parse_douyin_live, LiveRoomInfo};
use recorder::{get_active_recordings, start_recording, stop_recording, RecorderState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

// 1. 获取配置
#[tauri::command]
fn get_config(app: AppHandle) -> AppConfig {
    load_config(&app)
}

// 2. 保存全局配置
#[tauri::command]
fn update_global_config(
    app: AppHandle,
    ffmpeg_path: String,
    save_dir: String,
    cookies: Vec<CookieItem>,
    user_agent: String,
    sec_ch_ua: String,
    monitor_interval_secs: u64,
) -> Result<(), String> {
    let mut config = load_config(&app);
    config.global.ffmpeg_path = ffmpeg_path;
    config.global.save_dir = save_dir;
    config.global.cookies = cookies;
    config.global.user_agent = user_agent;
    config.global.sec_ch_ua = sec_ch_ua;
    config.global.monitor_interval_secs = monitor_interval_secs;
    save_config(&app, &config)
}

// 3. 解析直播间基本信息（仅用于手动状态检测，不携带 Cookie）
#[tauri::command]
async fn parse_room(app: AppHandle, url: String) -> Result<LiveRoomInfo, String> {
    let config = load_config(&app);
    // 状态检测不需要 Cookie，传入空字符串以避免泄露登录凭据
    parse_douyin_live(&url, "", &config.global.user_agent, &config.global.sec_ch_ua).await
}

// 4. 添加直播间
#[tauri::command]
async fn add_room(
    app: AppHandle,
    url: String,
    is_monitoring: bool,
    preferred_quality: String,
    segment_duration_mins: u64,
) -> Result<RoomConfig, String> {
    // 负载均衡选择并自增一个 Cookie 
    let cookie = get_and_increment_cookie(&app);
    let mut config = load_config(&app);

    // 解析直播间，以获取真实的 anchor_name 和 room_id
    let info = parse_douyin_live(&url, &cookie, &config.global.user_agent, &config.global.sec_ch_ua).await?;

    // 检查是否重复
    if config.rooms.iter().any(|r| r.room_id == info.room_id) {
        return Err("该直播间已在任务列表中".to_string());
    }

    let new_room = RoomConfig {
        room_id: info.room_id,
        anchor_name: info.anchor_name,
        is_monitoring,
        preferred_quality,
        segment_duration_mins,
        auto_record: false,
    };


    config.rooms.push(new_room.clone());
    save_config(&app, &config)?;

    Ok(new_room)
}

// 5. 删除直播间
#[tauri::command]
async fn delete_room(app: AppHandle, state: State<'_, RecorderState>, room_id: String) -> Result<(), String> {
    // 如果该房间正在录制，先强行停止录制
    let _ = stop_recording(state, &room_id).await;

    let mut config = load_config(&app);
    config.rooms.retain(|r| r.room_id != room_id);
    save_config(&app, &config)
}

// 6. 更新单个直播间配置
#[tauri::command]
fn update_room_config(app: AppHandle, room: RoomConfig) -> Result<(), String> {
    let mut config = load_config(&app);
    if let Some(idx) = config.rooms.iter().position(|r| r.room_id == room.room_id) {
        config.rooms[idx] = room;
        save_config(&app, &config)?;
        Ok(())
    } else {
        Err("找不到该直播间".to_string())
    }
}

// 7. 手动开始录制
#[tauri::command]
async fn start_record_task(
    app: AppHandle,
    state: State<'_, RecorderState>,
    room_id: String,
) -> Result<(), String> {
    println!("[🎬 录制] ========== 开始手动录制任务 ==========");
    println!("[🎬 录制] room_id: {}", room_id);

    // 负载均衡选择并自增一个 Cookie 
    let cookie = get_and_increment_cookie(&app);
    let config = load_config(&app);
    let room = config
        .rooms
        .iter()
        .find(|r| r.room_id == room_id)
        .ok_or_else(|| "找不到该直播间配置".to_string())?;

    println!("[🎬 录制] 主播: {}, 房间ID: {}", room.anchor_name, room.room_id);

    // 开始解析流地址
    let info = parse_douyin_live(&room.room_id, &cookie, &config.global.user_agent, &config.global.sec_ch_ua).await?;
    
    println!("[🎬 录制] 解析结果 - is_live: {}, streams数量: {}", info.is_live, info.streams.len());
    
    if !info.is_live {
        return Err("主播未开播，无法手动录制".to_string());
    }
    if info.streams.is_empty() {
        return Err("未解析到可录制的直播流".to_string());
    }

    // 打印所有可用的流
    for (idx, stream) in info.streams.iter().enumerate() {
        println!("[🎬 录制] 流[{}]: 画质={}, FLV={}, M3U8={}", 
            idx, 
            stream.quality_name,
            stream.flv_url.as_ref().map(|s| if s.len() > 50 { &s[..50] } else { s.as_str() }).unwrap_or("无"),
            stream.m3u8_url.as_ref().map(|s| if s.len() > 50 { &s[..50] } else { s.as_str() }).unwrap_or("无")
        );
    }

    // 匹配首选画质
    let selected_stream = info
        .streams
        .iter()
        .find(|s| s.quality_name == room.preferred_quality)
        .or_else(|| info.streams.first())
        .ok_or_else(|| "无有效画质流".to_string())?;

    println!("[🎬 录制] 选择流: 画质={}", selected_stream.quality_name);

    // ✅ 优先使用 FLV 流（原始推流质量最高），M3U8 是转码后的低质量流
    let stream_url = selected_stream
        .flv_url
        .clone()
        .or_else(|| selected_stream.m3u8_url.clone())
        .ok_or_else(|| "无可用推流地址（FLV和M3U8都为空）".to_string())?;

    println!("[🎬 录制] 最终使用URL: {}...", 
        if stream_url.len() > 80 { &stream_url[..80] } else { &stream_url }
    );

    println!("[🎬 录制] 调用 start_recording...");
    start_recording(
        app,
        state,
        room_id,
        info.anchor_name,
        info.title, // 传入直播标题
        stream_url,
        config.global.ffmpeg_path,
        config.global.save_dir,
        room.segment_duration_mins,
        config.global.user_agent,  // 传入用户配置的 UA
    )
    .await?;

    println!("[🎬 录制] ✅ 录制任务启动成功！");
    Ok(())
}

// 8. 手动停止录制
#[tauri::command]
async fn stop_record_task(state: State<'_, RecorderState>, room_id: String) -> Result<(), String> {
    stop_recording(state, &room_id).await
}

// 9. 获取当前正在录制的直播间列表
#[tauri::command]
async fn get_active_tasks(state: State<'_, RecorderState>) -> Result<Vec<String>, String> {
    Ok(get_active_recordings(state).await)
}

// 获取当前正在录制的直播间标题映射
#[tauri::command]
async fn get_active_task_titles(
    state: State<'_, RecorderState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let tasks = state.tasks.lock().await;
    let mut map = std::collections::HashMap::new();
    for (room_id, task) in tasks.iter() {
        map.insert(room_id.clone(), task.title.clone());
    }
    Ok(map)
}

// 10. 从内置的"douyin-login"子窗口中动态截取包含 HttpOnly 在内的所有 Cookie
// ⚠️ 重要：Tauri 2.0 Windows 环境下必须使用 async 命令读取 cookies，否则会导致死锁！
// 参考：https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html
#[tauri::command]
async fn capture_login_cookies(app: AppHandle) -> Result<String, String> {
    use url::Url;

    println!("[Login Assistant Debug] Attempting to capture cookies (async version)...");
    // 获取名为 "douyin-login" 的子窗口
    if let Some(window) = app.get_webview_window("douyin-login") {
        let target_url = Url::parse("https://www.douyin.com")
            .map_err(|e| {
                let err_msg = format!("解析抖音域名URL失败: {}", e);
                println!("[Login Assistant Error] {}", err_msg);
                err_msg
            })?;

        println!("[Login Assistant Debug] Retrieving cookies for target URL: {} (async)", target_url);
        // 提取该 WebView 底层的 Cookie 存储（async 命令中调用是安全的）
        match window.cookies_for_url(target_url) {
            Ok(cookies) => {
                println!("[Login Assistant Debug] Successfully called cookies_for_url. Total cookies count: {}", cookies.len());
                for (idx, c) in cookies.iter().enumerate() {
                    println!(
                        "[Login Assistant Cookie Info {}] Name: {}, Value Length: {}, Domain: {:?}, Secure: {:?}, HttpOnly: {:?}",
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
                    println!("[Login Assistant Debug] Found critical session cookies (sessionid/passport_csrf_token). Capture success!");
                    Ok(cookie_str)
                } else {
                    println!("[Login Assistant Warning] Cookies captured, but missing critical 'sessionid' or 'passport_csrf_token'. User might not have completed login/verification.");
                    Err("未在子窗口中检测到您的抖音登录信息，请确保您在扫码助手窗口中已经完成了验证和登录！".to_string())
                }
            }
            Err(e) => {
                let err_msg = format!("从底层 WebView 获取 Cookie 失败: {}", e);
                println!("[Login Assistant Error] {}", err_msg);
                Err(err_msg)
            }
        }
    } else {
        println!("[Login Assistant Error] The 'douyin-login' window instance does not exist in Manager.");
        Err("登录助手窗口未打开。请先点击【开启扫码登录助手】按钮拉起窗口！".to_string())
    }
}

// 11. 打开内置的抖音登录辅助窗口 (由后端拉起，避开前端 Capabilities 权限限制)
// ⚠️ 重要：Tauri 2.0 Windows 环境下必须使用 async 命令创建窗口，否则会导致死锁！
// 参考：https://github.com/tauri-apps/wry/issues/583
#[tauri::command]
async fn open_login_window(app: AppHandle, _current_url: String) -> Result<(), String> {
    use url::Url;

    // 如果已存在旧窗口，先关闭以清除会话
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

    // 通过 JS 清除所有 Cookie，确保未登录状态
    let _ = window.eval("document.cookie.split(';').forEach(c => { document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.douyin.com'; }); setTimeout(() => location.reload(), 200);");

    #[cfg(debug_assertions)]
    {
        let _ = window.open_devtools();
    }

    Ok(())
}

// ──────────────────────────────────────────────
// 格式转换进度事件结构体
// ──────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConvertProgress {
    pub task_id: String,
    pub status: String,       // "running" | "done" | "error"
    pub percent: f32,         // 0.0 ~ 100.0
    pub time: String,         // 当前处理到的时间戳 "00:01:23"
    pub speed: String,        // 例如 "1.5x"
    pub error_msg: Option<String>,
    pub output_path: String,
}

// 12. 格式转换命令
// 将指定视频文件用 FFmpeg 转换为目标格式，边转边向前端发送进度事件
#[tauri::command]
async fn convert_video(
    app: AppHandle,
    task_id: String,
    input_path: String,
    output_path: String,
    ffmpeg_path: String,
) -> Result<(), String> {
    use std::path::Path;
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;
    use regex::Regex;

    println!("[转换] 任务 {} 开始: {} → {}", task_id, input_path, output_path);

    // 校验输入文件
    if !Path::new(&input_path).exists() {
        return Err(format!("输入文件不存在: {}", input_path));
    }

    // 确保输出目录存在
    if let Some(parent) = Path::new(&output_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建输出目录失败: {}", e))?;
        }
    }

    let ffmpeg_exe = if ffmpeg_path.trim().is_empty() {
        "ffmpeg".to_string()
    } else {
        ffmpeg_path.clone()
    };

    // 先用 ffprobe 或 -i 探测总时长（用于计算百分比）
    // FFmpeg 在遇到 -i 且无输出时会打印媒体信息到 stderr
    let duration_secs: f64 = {
        let mut probe_cmd = Command::new(&ffmpeg_exe);
        probe_cmd
            .args(["-i", &input_path])
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            probe_cmd.creation_flags(0x08000000);
        }
        let probe_output = probe_cmd
            .output()
            .await
            .map_err(|e| format!("无法运行 FFmpeg 探测时长: {}", e))?;
        let stderr_str = String::from_utf8_lossy(&probe_output.stderr);
        // 从 "Duration: HH:MM:SS.ms" 中提取
        let re_dur = Regex::new(r"Duration:\s*(\d+):(\d+):([\d\.]+)").unwrap();
        if let Some(caps) = re_dur.captures(&stderr_str) {
            let h: f64 = caps[1].parse().unwrap_or(0.0);
            let m: f64 = caps[2].parse().unwrap_or(0.0);
            let s: f64 = caps[3].parse().unwrap_or(0.0);
            h * 3600.0 + m * 60.0 + s
        } else {
            0.0
        }
    };
    println!("[转换] 探测总时长: {:.1}s", duration_secs);

    // 构建转换参数
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_path.clone(),
        "-c".to_string(),
        "copy".to_string(),        // 默认无损封装转换
        "-progress".to_string(),   // 输出结构化进度信息
        "pipe:2".to_string(),      // 输出到 stderr
        output_path.clone(),
    ];

    // 如果输出是 MP4，加入 faststart
    let out_ext = Path::new(&output_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if out_ext == "mp4" {
        // 在 output_path 前插入 -movflags +faststart
        let last = args.pop().unwrap();
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
        args.push(last);
    }

    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    let stderr = child.stderr.take()
        .ok_or_else(|| "无法获取 FFmpeg stderr".to_string())?;

    let task_id_clone = task_id.clone();
    let output_path_clone = output_path.clone();
    let app_clone = app.clone();

    // 异步监控转换进度
    tauri::async_runtime::spawn(async move {
        let re_time = Regex::new(r"out_time_ms=(\d+)").unwrap();
        let re_speed = Regex::new(r"speed=\s*([\d\.]+x)").unwrap();
        let re_time_human = Regex::new(r"out_time=([\d:]+\.\d+)").unwrap();
        let re_error = Regex::new(r"(?i)(error|invalid|no such file|permission denied)").unwrap();

        let mut reader = BufReader::new(stderr).lines();
        let mut current_ms: f64 = 0.0;
        let mut current_speed = String::from("--");
        let mut current_time = String::from("00:00:00");
        let mut last_error: Option<String> = None;

        while let Ok(Some(line)) = reader.next_line().await {
            // -progress 输出的格式化字段
            if let Some(caps) = re_time.captures(&line) {
                current_ms = caps[1].parse::<f64>().unwrap_or(0.0);
            }
            if let Some(caps) = re_speed.captures(&line) {
                current_speed = caps[1].to_string();
            }
            if let Some(caps) = re_time_human.captures(&line) {
                current_time = caps[1][..8.min(caps[1].len())].to_string();
            }
            // 错误检测
            if re_error.is_match(&line) && !line.contains("speed") {
                eprintln!("[转换 ERROR] {}", line);
                last_error = Some(line.clone());
            }

            // progress=end 表示转换完成
            let is_done = line.trim() == "progress=end";
            let percent = if duration_secs > 0.0 {
                ((current_ms / 1_000_000.0) / duration_secs * 100.0).min(100.0) as f32
            } else if is_done {
                100.0_f32
            } else {
                0.0_f32
            };

            if line.starts_with("out_time") || line.starts_with("speed") || is_done {
                let _ = app_clone.emit(
                    "convert-progress",
                    ConvertProgress {
                        task_id: task_id_clone.clone(),
                        status: if is_done { "done".to_string() } else { "running".to_string() },
                        percent,
                        time: current_time.clone(),
                        speed: current_speed.clone(),
                        error_msg: None,
                        output_path: output_path_clone.clone(),
                    },
                );
                if is_done { break; }
            }
        }

        // 等待进程退出
        let exit_ok = match child.wait().await {
            Ok(s) => s.success(),
            Err(_) => false,
        };

        let (final_status, error_msg) = if exit_ok {
            ("done".to_string(), None)
        } else {
            (
                "error".to_string(),
                Some(last_error.unwrap_or_else(|| "FFmpeg 异常退出，请检查输入文件或 FFmpeg 路径".to_string())),
            )
        };

        let _ = app_clone.emit(
            "convert-progress",
            ConvertProgress {
                task_id: task_id_clone.clone(),
                status: final_status,
                percent: 100.0,
                time: current_time,
                speed: current_speed,
                error_msg,
                output_path: output_path_clone,
            },
        );

        println!("[转换] 任务 {} 结束 (exit_ok={})", task_id_clone, exit_ok);
    });

    Ok(())
}

// 辅助函数：挑选当前使用次数最少的 Cookie，并递增计数后保存
fn get_and_increment_cookie(app: &AppHandle) -> String {
    let mut config = load_config(app);
    if config.global.cookies.is_empty() {
        return "".to_string();
    }

    // 寻找 use_count 最小的项
    let mut min_idx = 0;
    let mut min_count = u32::MAX;
    for (idx, item) in config.global.cookies.iter().enumerate() {
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

// 13. 提供根据 Cookie 自动解析其登录账号昵称的命令
#[tauri::command]
async fn get_cookie_nickname(app: AppHandle, cookie: String) -> Result<Option<String>, String> {
    let config = load_config(&app);
    let ua = if config.global.user_agent.trim().is_empty() {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    } else {
        &config.global.user_agent
    };

    Ok(parser::fetch_nickname_from_cookie(&cookie, ua).await)
}

#[tauri::command]
async fn check_login_status(app: AppHandle) -> Result<bool, String> {
    use url::Url;

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

#[tauri::command]
async fn validate_cookie(app: AppHandle, cookie: String) -> Result<bool, String> {
    let config = load_config(&app);
    let ua = if config.global.user_agent.trim().is_empty() {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    } else {
        &config.global.user_agent
    };

    match parser::fetch_nickname_from_cookie(&cookie, ua).await {
        Some(_) => Ok(true),
        None => Ok(false),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RecorderState::new()) // 注入全局录制状态管理器
        .setup(|app| {
            // 启动后台监控循环
            let app_handle = app.handle().clone();
            monitor::start_monitor_loop(app_handle.clone());

            // 启动性能遥测循环
            telemetry::start_telemetry_loop(app_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            update_global_config,
            parse_room,
            add_room,
            delete_room,
            update_room_config,
            start_record_task,
            stop_record_task,
            get_active_tasks,
            get_active_task_titles,
            capture_login_cookies,
            open_login_window,
            get_cookie_nickname,
            check_login_status,
            validate_cookie,
            convert_video
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
