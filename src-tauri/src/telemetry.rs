use std::time::Duration;
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use sysinfo::{System, Networks};

#[derive(Debug, Serialize, Clone)]
pub struct TelemetryPayload {
    pub cpu_usage: f32,
    pub net_recv: u64,
    pub net_sent: u64,
}

pub fn start_telemetry_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new();
        sys.refresh_cpu_usage();

        let mut networks = Networks::new_with_refreshed_list();

        let mut last_time = std::time::Instant::now();
        let mut last_recv: u64 = networks.values().map(|n| n.received()).sum();
        let mut last_sent: u64 = networks.values().map(|n| n.transmitted()).sum();

        loop {
            tokio::time::sleep(Duration::from_millis(1500)).await;

            sys.refresh_cpu_usage();
            networks.refresh();

            let cpus = sys.cpus();
            let cpu_usage = if cpus.is_empty() {
                0.0
            } else {
                let total: f32 = cpus.iter().map(|cpu| cpu.cpu_usage()).sum();
                total / cpus.len() as f32
            };

            let elapsed = last_time.elapsed().as_secs_f64();
            let elapsed = if elapsed > 0.1 { elapsed } else { 1.5 };
            last_time = std::time::Instant::now();

            let cur_recv: u64 = networks.values().map(|n| n.received()).sum();
            let cur_sent: u64 = networks.values().map(|n| n.transmitted()).sum();

            let net_recv = ((cur_recv.saturating_sub(last_recv)) as f64 / elapsed) as u64;
            let net_sent = ((cur_sent.saturating_sub(last_sent)) as f64 / elapsed) as u64;

            last_recv = cur_recv;
            last_sent = cur_sent;

            let _ = app.emit("telemetry", TelemetryPayload {
                cpu_usage,
                net_recv,
                net_sent,
            });
        }
    });
}
