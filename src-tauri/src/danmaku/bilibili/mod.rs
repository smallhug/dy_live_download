pub mod packet;
pub mod parser;

use crate::danmaku::model::LiveMessage;
use futures_util::{SinkExt, StreamExt};
use packet::{encode_packet, decode_packets, OP_AUTH, OP_HEARTBEAT, PROTO_RAW};
use parser::parse_bilibili_message;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde_json::json;
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio::time::interval;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

#[derive(Debug, serde::Deserialize)]
struct HostItem {
    host: String,
    wss_port: u16,
}

#[derive(Debug, serde::Deserialize)]
struct DanmuInfoData {
    token: String,
    host_list: Vec<HostItem>,
}

#[derive(Debug, serde::Deserialize)]
struct DanmuInfoResponse {
    code: i32,
    data: Option<DanmuInfoData>,
}

pub async fn run_bilibili_danmaku_loop(
    room_id: String,
    cookie: String,
    user_agent: String,
    tx: Sender<LiveMessage>,
    cancel_token: CancellationToken,
) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    // 1. Convert room id if needed or fetch danmu info
    let danmu_info_url = format!(
        "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id={}&type=0",
        room_id
    );

    let mut headers = HeaderMap::new();
    if let Ok(ua_val) = HeaderValue::from_str(&user_agent) {
        headers.insert(USER_AGENT, ua_val);
    }
    if !cookie.is_empty() {
        if let Ok(cookie_val) = HeaderValue::from_str(&cookie) {
            headers.insert(reqwest::header::COOKIE, cookie_val);
        }
    }

    let resp = match client.get(&danmu_info_url).headers(headers).send().await {
        Ok(r) => r,
        Err(e) => {
            log::error!("[Danmaku/Bilibili] Failed to fetch DanmuInfo for room {}: {}", room_id, e);
            return;
        }
    };

    let danmu_data = match resp.json::<DanmuInfoResponse>().await {
        Ok(data) if data.code == 0 && data.data.is_some() => data.data.unwrap(),
        Ok(data) => {
            log::error!("[Danmaku/Bilibili] DanmuInfo API error for room {}: code={}", room_id, data.code);
            return;
        }
        Err(e) => {
            log::error!("[Danmaku/Bilibili] Failed to parse DanmuInfo response for room {}: {}", room_id, e);
            return;
        }
    };

    let host = match danmu_data.host_list.first() {
        Some(h) => h,
        None => {
            log::error!("[Danmaku/Bilibili] Empty host list for room {}", room_id);
            return;
        }
    };

    let ws_url = format!("wss://{}:{}/sub", host.host, host.wss_port);
    log::info!("[Danmaku/Bilibili] Connecting to WebSocket: {}", ws_url);

    let (ws_stream, _) = match connect_async(&ws_url).await {
        Ok(stream) => stream,
        Err(e) => {
            log::error!("[Danmaku/Bilibili] WebSocket connect failed: {}", e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();

    // 2. Send Auth / Handshake packet
    let auth_body = json!({
        "uid": 0,
        "roomid": room_id.parse::<u64>().unwrap_or(0),
        "protover": 3,
        "buvid": "",
        "platform": "web",
        "type": 2,
        "key": danmu_data.token
    })
    .to_string();

    let auth_pkt = encode_packet(OP_AUTH, PROTO_RAW, auth_body.as_bytes());
    if let Err(e) = write.send(Message::Binary(auth_pkt)).await {
        log::error!("[Danmaku/Bilibili] Failed to send auth packet: {}", e);
        return;
    }

    log::info!("[Danmaku/Bilibili] Auth packet sent for room {}", room_id);

    // 3. Heartbeat loop & Message read loop
    let mut heartbeat_timer = interval(Duration::from_secs(30));
    // Trigger immediately once or skip first
    heartbeat_timer.tick().await;

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                log::info!("[Danmaku/Bilibili] Danmaku loop cancelled for room {}", room_id);
                break;
            }
            _ = heartbeat_timer.tick() => {
                let hb_pkt = encode_packet(OP_HEARTBEAT, PROTO_RAW, b"");
                if let Err(e) = write.send(Message::Binary(hb_pkt)).await {
                    log::warn!("[Danmaku/Bilibili] Heartbeat send failed: {}", e);
                    break;
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Binary(bytes))) => {
                        if let Ok(packets) = decode_packets(&bytes) {
                            for (op, payload) in packets {
                                if op == packet::OP_MESSAGE {
                                    if let Some(live_msg) = parse_bilibili_message(&room_id, &payload) {
                                        let _ = tx.send(live_msg).await;
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        log::info!("[Danmaku/Bilibili] WebSocket closed by server for room {}", room_id);
                        break;
                    }
                    Some(Err(e)) => {
                        log::warn!("[Danmaku/Bilibili] WebSocket read error for room {}: {}", room_id, e);
                        break;
                    }
                    None => {
                        log::info!("[Danmaku/Bilibili] WebSocket stream ended for room {}", room_id);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}
