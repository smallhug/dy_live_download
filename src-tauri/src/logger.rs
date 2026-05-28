use log::LevelFilter;
use simplelog::{CombinedLogger, WriteLogger};
use std::fs::{self, OpenOptions};
use tauri::{AppHandle, Manager};

const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;

fn rotate_if_needed(path: &std::path::Path) {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };

    if meta.len() <= MAX_LOG_SIZE {
        return;
    }

    let mut backup_path = path.to_path_buf();
    backup_path.set_extension("log.old");

    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }

    let _ = fs::rename(path, backup_path);
}

pub fn init_logger(app: &AppHandle) {
    let mut log_path = app.path().app_data_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default()
    });

    if !log_path.exists() {
        let _ = fs::create_dir_all(&log_path);
    }

    log_path.push("app.log");

    rotate_if_needed(&log_path);

    let log_file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("无法打开日志文件 {:?}: {}", log_path, e);
            return;
        }
    };

    let mut config_builder = simplelog::ConfigBuilder::new();
    let _ = config_builder.set_time_offset_to_local();
    let config = config_builder.build();

    let _ = CombinedLogger::init(vec![
        WriteLogger::new(LevelFilter::Info, config, log_file),
    ]);

    log::info!("日志系统初始化完成，日志文件: {:?}", log_path);
}
