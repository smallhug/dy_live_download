use std::path::Path;
use std::process::Stdio;
use log::{error, info};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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

// 格式转换命令
// 将指定视频文件用 FFmpeg 转换为目标格式，边转边向前端发送进度事件
#[tauri::command]
pub async fn convert_video(
    app: AppHandle,
    task_id: String,
    input_path: String,
    output_path: String,
    ffmpeg_path: String,
) -> Result<(), String> {
    info!("转换任务 {} 开始: {} → {}", task_id, input_path, output_path);

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
            #[allow(unused_imports)]
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
    info!("探测总时长: {:.1}s", duration_secs);

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
        #[allow(unused_imports)]
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
                error!("转换错误: {}", line);
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

        info!("转换任务 {} 结束 (exit_ok={})", task_id_clone, exit_ok);
    });

    Ok(())
}
