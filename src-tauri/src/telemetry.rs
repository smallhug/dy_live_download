use std::time::Duration;
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use sysinfo::{System, Networks};

#[derive(Debug, Serialize, Clone)]
pub struct TelemetryPayload {
    pub cpu_usage: f32,
    pub net_recv: u64, // 接收网速 (B/s)
    pub net_sent: u64, // 发送网速 (B/s)
}

pub fn start_telemetry_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new();
        sys.refresh_cpu_usage();

        let mut networks = Networks::new_with_refreshed_list();

        let mut last_time = std::time::Instant::now();

        loop {
            tokio::time::sleep(Duration::from_millis(1500)).await;

            sys.refresh_cpu_usage();
            networks.refresh();

            // 计算 CPU 占用率
            let cpus = sys.cpus();
            let cpu_usage = if cpus.is_empty() {
                0.0
            } else {
                let total: f32 = cpus.iter().map(|cpu| cpu.cpu_usage()).sum();
                total / cpus.len() as f32
            };

            // 获取时间间隔并重新计时
            let elapsed = last_time.elapsed().as_secs_f32();
            let elapsed = if elapsed > 0.1 { elapsed } else { 1.5 };
            last_time = std::time::Instant::now();

            // 统计所有网卡的收发数据量
            let mut total_recv = 0;
            let mut total_sent = 0;
            for (_interface_name, network) in &networks {
                total_recv += network.received();
                total_sent += network.transmitted();
            }

            // 计算网速 (字节/秒)
            let net_recv = (total_recv as f32 / elapsed) as u64;
            let net_sent = (total_sent as f32 / elapsed) as u64;

            let _ = app.emit("telemetry", TelemetryPayload {
                cpu_usage,
                net_recv,
                net_sent,
            });
        }
    });
}
