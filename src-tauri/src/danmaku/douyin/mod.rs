pub mod decoder;
pub mod proto;

use crate::danmaku::model::LiveMessage;
use decoder::parse_douyin_messages;
use proto::Response;
use prost::Message;
use reqwest::header::{COOKIE, ORIGIN, REFERER, USER_AGENT};
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio_util::sync::CancellationToken;

pub async fn fetch_ttwid(client: &reqwest::Client, room_id: &str) -> Option<String> {
    let url = format!("https://live.douyin.com/{}", room_id);
    if let Ok(resp) = client
        .get(&url)
        .header(
            USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
        )
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .send()
        .await
    {
        for header in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = header.to_str() {
                if let Some(start) = s.find("ttwid=") {
                    let rest = &s[start + 6..];
                    let end = rest.find(';').unwrap_or(rest.len());
                    let ttwid = rest[..end].to_string();
                    return Some(ttwid);
                }
            }
        }
    }

    let reg_url = "https://ttwid.bytedance.com/ttwid/union/register/";
    let body = r#"{"region":"cn","aid":1768,"needFid":false,"service":"www.ixigua.com","migrate_info":{"ticket":"","src_union_id":""},"cbUrlProtocol":"https","union":true}"#;
    if let Ok(resp) = client
        .post(reg_url)
        .header("Content-Type", "application/json")
        .header(
            USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        )
        .body(body)
        .send()
        .await
    {
        for header in resp.headers().get_all(reqwest::header::SET_COOKIE) {
            if let Ok(s) = header.to_str() {
                if let Some(start) = s.find("ttwid=") {
                    let rest = &s[start + 6..];
                    let end = rest.find(';').unwrap_or(rest.len());
                    let ttwid = rest[..end].to_string();
                    return Some(ttwid);
                }
            }
        }
    }

    None
}

pub async fn run_douyin_danmaku_loop(
    room_id: String,
    internal_room_id: Option<String>,
    mut cookie: String,
    user_agent: String,
    tx: Sender<LiveMessage>,
    cancel_token: CancellationToken,
) {
    let target_room_id = internal_room_id.unwrap_or_else(|| room_id.clone());

    let actual_ua = if user_agent.trim().is_empty() {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0"
    } else {
        &user_agent
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    // 如果 Cookie 中没有 ttwid，自动获取
    if !cookie.contains("ttwid=") {
        if let Some(ttwid) = fetch_ttwid(&client, &room_id).await {
            log::info!("[Danmaku/Douyin] 自动获取到 ttwid: {}", ttwid);
            if cookie.is_empty() {
                cookie = format!("ttwid={}", ttwid);
            } else {
                cookie = format!("ttwid={}; {}", ttwid, cookie);
            }
        }
    }

    log::info!(
        "[Danmaku/Douyin] 启动抖音直播间 Protobuf 消息流监听 (room_id: {})",
        target_room_id
    );

    let mut cursor = String::new();
    let mut internal_ext = String::new();
    let mut seen_ids: std::collections::VecDeque<String> = std::collections::VecDeque::with_capacity(400);

    loop {
        if cancel_token.is_cancelled() {
            log::info!("[Danmaku/Douyin] 收到取消信号，停止监听 room_id: {}", room_id);
            break;
        }

        let mut fetch_url = format!(
            "https://live.douyin.com/webcast/im/fetch/?room_id={}&aid=6383&live_id=1&did_rule=3&identity=audience&device_platform=web&browser_language=zh-CN&browser_platform=Win32&browser_name=Mozilla&browser_version=5.0&resp_content_type=protobuf",
            target_room_id
        );
        if !cursor.is_empty() {
            fetch_url.push_str(&format!("&cursor={}", cursor));
        }
        if !internal_ext.is_empty() {
            fetch_url.push_str(&format!("&internal_ext={}", internal_ext));
        }

        let resp_result = client
            .get(&fetch_url)
            .header(USER_AGENT, actual_ua)
            .header(ORIGIN, "https://live.douyin.com")
            .header(REFERER, format!("https://live.douyin.com/{}", room_id))
            .header(COOKIE, &cookie)
            .send()
            .await;

        let mut delay_ms = 1000u64;

        match resp_result {
            Ok(resp) => {
                if resp.status().is_success() {
                    let bytes = resp.bytes().await.unwrap_or_default();
                    if !bytes.is_empty() {
                        if let Ok(response) = Response::decode(&bytes[..]) {
                            cursor = response.cursor.clone();
                            internal_ext = response.internal_ext.clone();

                            if response.fetch_interval > 0 {
                                delay_ms = response.fetch_interval.clamp(800, 3000);
                            }

                            let messages = parse_douyin_messages(&room_id, &response);
                            for msg in messages {
                                if !seen_ids.contains(&msg.id) {
                                    if seen_ids.len() >= 300 {
                                        seen_ids.pop_front();
                                    }
                                    seen_ids.push_back(msg.id.clone());
                                    let _ = tx.send(msg).await;
                                }
                            }
                        }
                    }
                } else {
                    log::warn!(
                        "[Danmaku/Douyin] HTTP fetch status: {}",
                        resp.status()
                    );
                    delay_ms = 2000;
                }
            }
            Err(e) => {
                log::warn!("[Danmaku/Douyin] HTTP fetch request error: {}", e);
                delay_ms = 2000;
            }
        }

        tokio::select! {
            _ = cancel_token.cancelled() => {
                log::info!("[Danmaku/Douyin] 监听结束: room_id={}", room_id);
                break;
            }
            _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
        }
    }
}
