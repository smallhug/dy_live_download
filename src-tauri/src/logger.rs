use log::LevelFilter;
use simplelog::{CombinedLogger, Config, WriteLogger};
use std::fs::{self, OpenOptions};
use tauri::{AppHandle, Manager};

pub fn init_logger(app: &AppHandle) {
    let mut log_dir = app.path().app_data_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default()
    });

    if !log_dir.exists() {
        let _ = fs::create_dir_all(&log_dir);
    }

    log_dir.push("app.log");

    let log_file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_dir)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("无法打开日志文件 {:?}: {}", log_dir, e);
            return;
        }
    };

    let _ = CombinedLogger::init(vec![
        WriteLogger::new(LevelFilter::Info, Config::default(), log_file),
    ]);

    log::info!("日志系统初始化完成，日志文件: {:?}", log_dir);
}
