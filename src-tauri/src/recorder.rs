use chrono::{Local, Utc};
use log::{info, warn, error};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
use crate::danmaku::DanmakuManager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordProgress {
    pub room_id: String,
    pub time: String,      // 格式：00:01:23
    pub status: String,    // "recording" | "stopped" | "error"
    pub error_msg: Option<String>,
    pub title: String,     // 直播间标题
}

pub struct RecordTask {
    pub title: String,
    pub child: Child,
}

// 全局录制状态管理器
pub struct RecorderState {
    pub tasks: Arc<Mutex<HashMap<String, RecordTask>>>,
}

impl RecorderState {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

static RE_PROGRESS_KEY_VALUE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\w+)\s*=\s*(.+)$").unwrap());
static RE_ERROR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(error|failed|invalid|permission denied|connection refused|timeout|no such file|\b404\b|\b403\b|\b502\b|\b503\b)").unwrap());

// 启动录制任务
#[allow(clippy::too_many_arguments)]
pub async fn start_recording(
    app: AppHandle,
    state: tauri::State<'_, RecorderState>,
    danmaku_manager: tauri::State<'_, DanmakuManager>,
    room_id: String,
    anchor_name: String,
    title: String,       // 新增：直播间标题
    stream_url: String,
    ffmpeg_path: String,
    save_dir: String,
    segment_duration_mins: u64,
    user_agent: String,  // 新增：用户配置的 UA
    platform: String,    // 新增：平台
    record_danmaku: bool,
    danmaku_format: String,
    internal_room_id: Option<String>,
    cookie: String,
) -> Result<(), String> {
    let mut tasks = state.tasks.lock().await;
    if tasks.contains_key(&room_id) {
        return Err("该直播间已经在录制中".to_string());
    }

    // 检查 ffmpeg 是否有效
    let ffmpeg_exe = if ffmpeg_path.is_empty() {
        "ffmpeg".to_string()
    } else {
        ffmpeg_path.clone()
    };

    // 创建保存目录
    let save_path = Path::new(&save_dir);
    if !save_path.exists() {
        std::fs::create_dir_all(save_path)
            .map_err(|e| format!("创建保存目录失败: {}", e))?;
    }

    let time_str = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let safe_anchor_name = anchor_name.replace(|c: char| !c.is_alphanumeric() && c != '_', "");

    // 根据输入流 URL 自动判断输出格式
    // FLV 直接推流 → 保存为 .flv（避免 FLV 封装到 MP4 的兼容性问题）
    // M3U8/HLS 流 → 保存为 .mp4
    let is_flv_stream = stream_url.contains(".flv") || stream_url.starts_with("rtmp");
    let ext = if is_flv_stream { "flv" } else { "mp4" };

    // 确定 Referer，防止 B 站等平台拉流返回 403 Forbidden
    let is_bilibili = platform.eq_ignore_ascii_case("bilibili")
        || stream_url.contains("bilibili.com")
        || stream_url.contains("bilivideo.com");
    let referer = if is_bilibili {
        "https://live.bilibili.com/"
    } else {
        "https://live.douyin.com/"
    };

    // 组装 FFmpeg 参数（精简版：只使用最通用、最稳定的参数）
    // 注意：FFmpeg 参数顺序必须是：[全局选项] -> [输入选项] -> -i URL -> [输出选项] -> 输出文件
    let mut args = vec![
        "-y".to_string(),                           // [全局] 覆盖输出文件
        "-progress".to_string(),                    // [全局] 输出详细进度信息
        "pipe:2".to_string(),                       // [全局] 输出到stderr
        "-protocol_whitelist".to_string(),           // [全局] 允许的协议
        "file,http,https,tcp,tls,crypto".to_string(),
        // 以下为输入选项（必须在 -i 之前）
        "-headers".to_string(),                     // [输入] HTTP 请求头
        format!("User-Agent: {}\r\nReferer: {}\r\n", if user_agent.trim().is_empty() {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"
        } else {
            &user_agent
        }, referer),
        // 输入源
        "-i".to_string(),                          // 输入URL标记
        stream_url,
        // 以下为输出选项
        "-c".to_string(),                          // [输出] 编码器
        "copy".to_string(),                        // 无损拷贝（不重新编码）
    ];

    // 配置分段
    if segment_duration_mins > 0 {
        let segment_secs = segment_duration_mins * 60;
        let file_pattern = save_path
            .join(format!("{}_{}_%03d.{}", safe_anchor_name, time_str, ext))
            .to_string_lossy()
            .to_string();
        // 注意：-f segment 分段器不支持 -movflags +faststart，必须省略
        args.extend(vec![
            "-f".to_string(),
            "segment".to_string(),
            "-segment_time".to_string(),
            segment_secs.to_string(),
            "-reset_timestamps".to_string(),
            "1".to_string(),
            file_pattern,
        ]);
    } else {
        // 单文件模式：如果是 MP4 则加入 faststart，FLV 不需要
        if !is_flv_stream {
            args.extend(vec![
                "-movflags".to_string(),
                "+faststart".to_string(),
            ]);
        }
        let file_path = save_path
            .join(format!("{}_{}.{}", safe_anchor_name, time_str, ext))
            .to_string_lossy()
            .to_string();
        args.push(file_path);
    }

    // 启动进程
    info!("准备启动 FFmpeg 进程...");
    info!("可执行文件: {}", ffmpeg_exe);
    info!("完整参数列表 (共{}个):", args.len());
    for (idx, arg) in args.iter().enumerate() {
        // 隐藏敏感信息（URL 和 User-Agent）
        if arg.contains("http") || arg.contains("User-Agent") {
            let display = if arg.chars().count() > 60 { format!("{}...", arg.chars().take(60).collect::<String>()) } else { arg.clone() };
            info!("  [{}] {} (已截断)", idx, display);
        } else {
            info!("  [{}] {}", idx, arg);
        }
    }

    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.args(&args)
       .stdout(Stdio::null())
       .stdin(Stdio::piped())
       .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.spawn() {
        Ok(mut child) => {
            info!("FFmpeg 进程启动成功! PID: {:?}", child.id());
            
            let stderr = child.stderr.take().ok_or_else(|| "无法获取 FFmpeg stderr 流".to_string())?;
            
            // 存入任务列表
            let task = RecordTask {
                title: title.clone(),
                child,
            };
            tasks.insert(room_id.clone(), task);

            let danmaku_manager_inner = danmaku_manager.inner().clone();
            if record_danmaku {
                let danmaku_ext = match danmaku_format.as_str() {
                    "jsonl" => "jsonl",
                    _ => "xml",
                };
                let danmaku_file = save_path.join(format!("{}_{}.{}", safe_anchor_name, time_str, danmaku_ext));
                let start_time_ms = Utc::now().timestamp_millis() as u64;
                danmaku_manager_inner.start_session(
                    app.clone(),
                    platform.clone(),
                    room_id.clone(),
                    internal_room_id.clone(),
                    cookie.clone(),
                    user_agent.clone(),
                    Some((danmaku_file, danmaku_format.clone(), start_time_ms)),
                ).await;
            }

            // 启动异步任务监控进度（必须在 Ok 分支内）
            let room_id_clone = room_id.clone();
            let title_clone = title.clone();
            let tasks_clone = state.tasks.clone();
            let app_clone = app.clone();
            let danmaku_cleanup = danmaku_manager.inner().clone();

            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                
                info!("开始监控 FFmpeg 输出 (PID: {})", room_id_clone);
                let mut line_count = 0u64;
                let mut last_error: Option<String> = None;

                // 默认状态通知
                let _ = app_clone.emit(
                    "record-progress",
                    RecordProgress {
                        room_id: room_id_clone.clone(),
                        time: "00:00:00".to_string(),
                        status: "recording".to_string(),
                        error_msg: None,
                        title: title_clone.clone(),
                    },
                );

                // 用于存储结构化进度数据
                let mut progress_data = HashMap::new();
                
                while let Ok(Some(line)) = reader.next_line().await {
                    line_count += 1;
                    
                    // 打印前 20 行 and all error/warning lines to console
                    if line_count <= 20 || RE_ERROR.is_match(&line) || line.contains("Warning") || line.contains("warning") {
                        warn!("FFmpeg STDERR [L{}] {}", line_count, 
                            if line.chars().count() > 150 { format!("{}...", line.chars().take(150).collect::<String>()) } else { line.clone() }
                        );
                    }
                    
                    // 检测是否包含错误信息并记录
                    if RE_ERROR.is_match(&line) {
                        error!("FFmpeg ERROR [L{}] {}", line_count, line);
                        last_error = Some(if line.len() > 200 { line[..200].to_string() } else { line.clone() });
                    }
                    
                    // 解析结构化进度信息 (key=value 格式)
                    if let Some(caps) = RE_PROGRESS_KEY_VALUE.captures(&line) {
                        let key = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                        let value = caps.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                        let is_progress_end = key == "progress";
                        progress_data.insert(key, value);
                        
                        // 当遇到 progress=continue 或 progress=end 时，发送进度更新
                        if is_progress_end {
                            let out_time = progress_data.get("out_time").cloned().unwrap_or_default();
                            
                            // 格式化时间 (移除微秒部分)
                            let clean_time = if let Some(dot_pos) = out_time.find('.') {
                                out_time[..dot_pos].to_string()
                            } else if out_time.is_empty() {
                                "00:00:00".to_string()
                            } else {
                                out_time
                            };
                            
                            let _ = app_clone.emit(
                                "record-progress",
                                RecordProgress {
                                    room_id: room_id_clone.clone(),
                                    time: clean_time,
                                    status: "recording".to_string(),
                                    error_msg: None,
                                    title: title_clone.clone(),
                                },
                            );
                            
                            // 清空进度数据，准备下一次更新
                            progress_data.clear();
                        }
                    }
                }
                
                // stderr 流关闭（FFmpeg 进程退出）
                info!("stderr 流已关闭 (共读取{}行)，等待进程完全退出...", line_count);

                // ffmpeg 结束后的清理
                danmaku_cleanup.stop_session(&room_id_clone).await;

                // 1. 在独立作用域中移除任务，之后锁会被立即释放
                let removed_task = {
                    let mut lock = tasks_clone.lock().await;
                    lock.remove(&room_id_clone)
                };

                // 2. 在没有锁的情况下，安全地 await 等待子进程退出
                if let Some(mut task) = removed_task {
                    let exit_status = task.child.wait().await;
                    let (status, err_msg) = match exit_status {
                        Ok(status) if status.success() => ("stopped".to_string(), None),
                        Ok(_) => (
                            "error".to_string(), 
                            Some(last_error.unwrap_or_else(|| "FFmpeg 进程异常退出，请检查网络或输入源".to_string()))
                        ),
                        Err(e) => ("error".to_string(), Some(format!("等待 FFmpeg 进程退出失败: {}", e))),
                    };

                    let _ = app_clone.emit(
                        "record-progress",
                        RecordProgress {
                            room_id: room_id_clone.clone(),
                            time: "00:00:00".to_string(),
                            status,
                            error_msg: err_msg,
                            title: task.title.clone(),
                        },
                    );
                }
            });

            Ok(())
        }
        Err(e) => {
            let err_msg = format!("启动 FFmpeg 失败! 可执行文件: {}, 错误原因: {}, 请检查: FFmpeg 路径是否正确、文件是否存在、是否有执行权限", ffmpeg_exe, e);
            error!("{}", err_msg);
            Err(err_msg)
        }
    }
}

// 停止录制
pub async fn stop_recording(
    state: tauri::State<'_, RecorderState>,
    danmaku_manager: tauri::State<'_, DanmakuManager>,
    room_id: &str,
) -> Result<(), String> {
    // 停止关联的弹幕会话
    danmaku_manager.stop_session(room_id).await;

    // 1. 获取锁，提取出 child 的 stdin 并写入 'q' 优雅退出
    let mut tasks = state.tasks.lock().await;
    if let Some(task) = tasks.get_mut(room_id) {
        if let Some(mut stdin) = task.child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            // 写入 'q' 字符
            let _ = stdin.write_all(b"q").await;
            let _ = stdin.flush().await;
        } else {
            // 如果 stdin 不可用，尝试强杀
            let _ = task.child.kill().await;
        }
        Ok(())
    } else {
        Err("该直播间未在录制中".to_string())
    }
}

// 获取当前所有正在录制的房间ID
pub async fn get_active_recordings(
    state: tauri::State<'_, RecorderState>,
) -> Vec<String> {
    let tasks = state.tasks.lock().await;
    tasks.keys().cloned().collect()
}
