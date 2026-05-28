use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};



#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlobalConfig {
    pub ffmpeg_path: String,
    pub save_dir: String,
    pub cookies: Vec<CookieItem>, // Cookie 列表
    pub user_agent: String,
    pub sec_ch_ua: String,
    pub monitor_interval_secs: u64,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub silent_start: bool,
    #[serde(default)]
    pub close_to_tray: bool,
}

fn default_true() -> bool {
  true
}

fn default_platform() -> String {
  "douyin".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CookieItem {
    pub id: String,            // 唯一标识 (例如时间戳)
    pub nickname: String,      // 账号昵称
    pub value: String,         // 实际的 Cookie 字符串内容
    pub acquired_at: String,   // 获取时间 (YYYY-MM-DD HH:MM:SS)
    pub use_count: u32,        // 使用次数
    #[serde(default = "default_platform")]
    pub platform: String,      // 平台
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RoomConfig {
    pub room_id: String,          // 直播间唯一标识
    pub anchor_name: String,      // 主播昵称
    pub is_monitoring: bool,      // 是否开启监控
    pub preferred_quality: String, // 偏好画质: 原画, 蓝光, 超清, 高清
    pub segment_duration_mins: u64, // 分段时长(分钟)，0表示不分段
    #[serde(default = "default_true")]
    pub auto_record: bool,         // 开播后是否自动录制
    #[serde(default = "default_platform")]
    pub platform: String,          // 平台
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub global: GlobalConfig,
    pub rooms: Vec<RoomConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            global: GlobalConfig {
                ffmpeg_path: "".to_string(),
                save_dir: "".to_string(),
                cookies: Vec::new(),
                user_agent: "".to_string(),
                sec_ch_ua: "".to_string(),
                monitor_interval_secs: 180,
                autostart: false,
                silent_start: false,
                close_to_tray: false,
            },
            rooms: Vec::new(),
        }
    }
}

// 获取配置文件路径
fn get_config_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| {
        // 兜底到用户主目录下
        std::env::current_dir().unwrap_or_default()
    });
    // 确保 app_data 目录存在
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path.push("config.json");
    path
}

// 自动检测 FFmpeg 路径
fn detect_ffmpeg_path(app: &AppHandle) -> String {
    // 1. 优先检查打包后随软件分发的资源目录 binaries/ffmpeg.exe
    if let Ok(resource_dir) = app.path().resource_dir() {
        let embedded_ffmpeg = resource_dir.join("binaries").join("ffmpeg.exe");
        if embedded_ffmpeg.exists() {
            return embedded_ffmpeg.to_string_lossy().to_string();
        }
    }

    // 2. 检查开发环境下的相对路径 src-tauri/binaries/ffmpeg.exe
    let dev_tauri_ffmpeg = std::env::current_dir().unwrap_or_default().join("src-tauri").join("binaries").join("ffmpeg.exe");
    if dev_tauri_ffmpeg.exists() {
        return dev_tauri_ffmpeg.to_string_lossy().to_string();
    }
    let dev_ffmpeg = std::env::current_dir().unwrap_or_default().join("binaries").join("ffmpeg.exe");
    if dev_ffmpeg.exists() {
        return dev_ffmpeg.to_string_lossy().to_string();
    }

    // 3. 检查系统 PATH 环境变量
    if let Ok(path) = std::env::var("PATH") {
        for p in path.split(';') {
            let ffmpeg_exe = Path::new(p).join("ffmpeg.exe");
            if ffmpeg_exe.exists() {
                return ffmpeg_exe.to_string_lossy().to_string();
            }
        }
    }

    // 4. 检查当前目录下是否有 ffmpeg.exe
    if Path::new("ffmpeg.exe").exists() {
        return "ffmpeg.exe".to_string();
    }

    "".to_string()
}

// 自动获取默认保存目录 (下载目录)
fn detect_save_dir(app: &AppHandle) -> String {
    if let Ok(download_dir) = app.path().download_dir() {
        download_dir.to_string_lossy().to_string()
    } else {
        std::env::current_dir().unwrap_or_default().to_string_lossy().to_string()
    }
}

// 加载配置
pub fn load_config(app: &AppHandle) -> AppConfig {
    let path = get_config_path(app);
    let mut config = if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            serde_json::from_str::<AppConfig>(&content).unwrap_or_default()
        } else {
            AppConfig::default()
        }
    } else {
        AppConfig::default()
    };

    // 自动补充默认值 (如果为空，或者配置的 FFmpeg 路径在本地已不复存在，则重新检测内置打包的)
    let mut modified = false;
    let path_invalid = !config.global.ffmpeg_path.is_empty() && !Path::new(&config.global.ffmpeg_path).exists();
    if config.global.ffmpeg_path.is_empty() || path_invalid {
        config.global.ffmpeg_path = detect_ffmpeg_path(app);
        modified = true;
    }
    if config.global.save_dir.is_empty() {
        config.global.save_dir = detect_save_dir(app);
        modified = true;
    }

    if modified {
        let _ = save_config(app, &config);
    }

    config
}

// 保存配置
pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = get_config_path(app);
    let tmp_path = path.with_extension("tmp");
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(&tmp_path, content)
        .map_err(|e| format!("写入临时配置文件失败: {}", e))?;
    fs::rename(tmp_path, path)
        .map_err(|e| format!("保存配置文件失败: {}", e))?;
    Ok(())
}

pub struct AppConfigState(pub std::sync::RwLock<AppConfig>);
