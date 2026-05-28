pub mod douyin;
pub mod bilibili;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveStream {
    pub quality_name: String, // 例如: origin, blue_ray, uhd, hd, sd
    pub flv_url: Option<String>,
    pub m3u8_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveRoomInfo {
    pub room_id: String,
    pub anchor_name: String,
    pub title: String,
    pub is_live: bool,
    pub streams: Vec<LiveStream>,
}

pub trait LiveParser: Send + Sync {
    async fn parse(
        &self,
        client: &reqwest::Client,
        room_id: &str,
        cookie: &str,
        user_agent: &str,
        sec_ch_ua: &str,
        preferred_quality: &str,
    ) -> Result<LiveRoomInfo, String>;
}

// 平台分发函数
pub async fn parse_live(
    client: &reqwest::Client,
    platform: &str,
    room_id: &str,
    cookie: &str,
    user_agent: &str,
    sec_ch_ua: &str,
    preferred_quality: &str,
) -> Result<LiveRoomInfo, String> {
    match platform {
        "douyin" => {
            let parser = douyin::DouyinParser;
            parser.parse(client, room_id, cookie, user_agent, sec_ch_ua, preferred_quality).await
        }
        "bilibili" => {
            let parser = bilibili::BilibiliParser;
            parser.parse(client, room_id, cookie, user_agent, sec_ch_ua, preferred_quality).await
        }
        other => Err(format!("不支持的直播平台: {}", other)),
    }
}

// 获取各平台 Cookie 对应的账号昵称
pub async fn fetch_nickname(
    client: &reqwest::Client,
    platform: &str,
    cookie: &str,
    user_agent: &str,
) -> Option<String> {
    match platform {
        "douyin" => douyin::fetch_nickname_from_cookie(client, cookie, user_agent).await,
        "bilibili" => bilibili::fetch_nickname_from_cookie(client, cookie, user_agent).await,
        _ => None,
    }
}

// 获取画质的优先级，数字越大清晰度越高
pub fn get_quality_priority(q: &str) -> i32 {
    match q {
        "origin" => 5,
        "blue_ray" => 4,
        "uhd" => 3,
        "hd" => 2,
        "sd" => 1,
        _ => 0,
    }
}

// 智能画质匹配降级查找算法 (通用)
pub fn select_best_stream<'a>(streams: &'a [LiveStream], preferred: &str) -> Option<&'a LiveStream> {
    if streams.is_empty() {
        return None;
    }

    let fallback_order = match preferred {
        "origin" => vec!["origin", "blue_ray", "uhd", "hd", "sd"],
        "blue_ray" => vec!["blue_ray", "uhd", "hd", "sd", "origin"],
        "uhd" => vec!["uhd", "hd", "sd", "blue_ray", "origin"],
        "hd" => vec!["hd", "sd", "uhd", "blue_ray", "origin"],
        "sd" => vec!["sd", "hd", "uhd", "blue_ray", "origin"],
        _ => vec!["origin", "blue_ray", "uhd", "hd", "sd"],
    };

    for quality in fallback_order {
        if let Some(stream) = streams.iter().find(|s| s.quality_name == quality) {
            return Some(stream);
        }
    }

    streams.first()
}
