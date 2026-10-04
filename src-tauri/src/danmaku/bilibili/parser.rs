use crate::danmaku::model::{LiveMessage, LiveMessagePayload, LiveMessageUser};
use chrono::Utc;
use serde_json::Value;

pub fn parse_bilibili_message(room_id: &str, raw_json: &[u8]) -> Option<LiveMessage> {
    let json_val: Value = serde_json::from_slice(raw_json).ok()?;
    let cmd = json_val.get("cmd")?.as_str()?;

    let now_ms = Utc::now().timestamp_millis() as u64;

    if cmd.starts_with("DANMU_MSG") {
        let info = json_val.get("info")?.as_array()?;
        let content = info.get(1)?.as_str()?.to_string();

        let color = info
            .first()
            .and_then(|meta| meta.as_array())
            .and_then(|arr| arr.get(3))
            .and_then(|c| c.as_u64())
            .map(|c| format!("#{:06X}", c));

        let user_info = info.get(2)?.as_array()?;
        let user_id = user_info.first()?.as_i64()?.to_string();
        let nickname = user_info.get(1)?.as_str()?.to_string();

        let (badge_name, badge_level) = if let Some(badge) = info.get(3).and_then(|b| b.as_array()) {
            let level = badge.first().and_then(|l| l.as_u64()).map(|l| l as u32);
            let name = badge.get(1).and_then(|n| n.as_str()).map(|n| n.to_string());
            (name, level)
        } else {
            (None, None)
        };

        return Some(LiveMessage {
            id: format!("bili_dm_{}_{}", user_id, now_ms),
            platform: "bilibili".to_string(),
            room_id: room_id.to_string(),
            timestamp_ms: now_ms,
            user: LiveMessageUser {
                user_id,
                nickname,
                avatar_url: None,
                badge_name,
                badge_level,
            },
            payload: LiveMessagePayload::Chat { content, color },
        });
    }

    if cmd == "SEND_GIFT" {
        let data = json_val.get("data")?;
        let user_id = data.get("uid")?.as_i64()?.to_string();
        let nickname = data.get("uname")?.as_str()?.to_string();
        let gift_name = data.get("giftName")?.as_str()?.to_string();
        let gift_id = data.get("giftId")?.as_u64()?;
        let count = data.get("num")?.as_u64()? as u32;
        let price_cents = data.get("price")?.as_u64().unwrap_or(0);
        let combo_count = data.get("combo_num").and_then(|c| c.as_u64()).map(|c| c as u32);

        let (badge_name, badge_level) = if let Some(medal) = data.get("medal_info") {
            let name = medal.get("medal_name").and_then(|n| n.as_str()).map(|n| n.to_string());
            let level = medal.get("medal_level").and_then(|l| l.as_u64()).map(|l| l as u32);
            (name, level)
        } else {
            (None, None)
        };

        return Some(LiveMessage {
            id: format!("bili_gift_{}_{}", user_id, now_ms),
            platform: "bilibili".to_string(),
            room_id: room_id.to_string(),
            timestamp_ms: now_ms,
            user: LiveMessageUser {
                user_id,
                nickname,
                avatar_url: None,
                badge_name,
                badge_level,
            },
            payload: LiveMessagePayload::Gift {
                gift_name,
                gift_id,
                count,
                price_cents,
                combo_count,
            },
        });
    }

    if cmd == "SUPER_CHAT_MESSAGE" {
        let data = json_val.get("data")?;
        let user_id = data.get("uid")?.as_i64()?.to_string();
        let user_info = data.get("user_info")?;
        let nickname = user_info.get("uname")?.as_str()?.to_string();
        let avatar_url = user_info.get("face").and_then(|f| f.as_str()).map(|f| f.to_string());
        let content = data.get("message")?.as_str()?.to_string();
        let price_rmb = data.get("price")?.as_f64()?;
        let duration_secs = data.get("time")?.as_u64().unwrap_or(30) as u32;

        let (badge_name, badge_level) = if let Some(medal) = data.get("medal_info") {
            let name = medal.get("medal_name").and_then(|n| n.as_str()).map(|n| n.to_string());
            let level = medal.get("medal_level").and_then(|l| l.as_u64()).map(|l| l as u32);
            (name, level)
        } else {
            (None, None)
        };

        return Some(LiveMessage {
            id: format!("bili_sc_{}_{}", user_id, now_ms),
            platform: "bilibili".to_string(),
            room_id: room_id.to_string(),
            timestamp_ms: now_ms,
            user: LiveMessageUser {
                user_id,
                nickname,
                avatar_url,
                badge_name,
                badge_level,
            },
            payload: LiveMessagePayload::SuperChat {
                content,
                price_rmb,
                duration_secs,
            },
        });
    }

    if cmd == "INTERACT_WORD" {
        let data = json_val.get("data")?;
        let user_id = data.get("uid")?.as_i64()?.to_string();
        let nickname = data.get("uname")?.as_str()?.to_string();

        let (badge_name, badge_level) = if let Some(fans_medal) = data.get("fans_medal") {
            let name = fans_medal.get("medal_name").and_then(|n| n.as_str()).map(|n| n.to_string());
            let level = fans_medal.get("medal_level").and_then(|l| l.as_u64()).map(|l| l as u32);
            (name, level)
        } else {
            (None, None)
        };

        return Some(LiveMessage {
            id: format!("bili_enter_{}_{}", user_id, now_ms),
            platform: "bilibili".to_string(),
            room_id: room_id.to_string(),
            timestamp_ms: now_ms,
            user: LiveMessageUser {
                user_id,
                nickname,
                avatar_url: None,
                badge_name,
                badge_level,
            },
            payload: LiveMessagePayload::Enter,
        });
    }

    if cmd == "LIKE_INFO_V3_CLICK" {
        let data = json_val.get("data")?;
        let user_id = data.get("uid").and_then(|u| u.as_i64()).map(|u| u.to_string()).unwrap_or_default();
        let nickname = data.get("uname").and_then(|u| u.as_str()).unwrap_or("观众").to_string();
        let click_count = data.get("click_count").and_then(|c| c.as_u64()).unwrap_or(1);

        return Some(LiveMessage {
            id: format!("bili_like_{}_{}", user_id, now_ms),
            platform: "bilibili".to_string(),
            room_id: room_id.to_string(),
            timestamp_ms: now_ms,
            user: LiveMessageUser {
                user_id,
                nickname,
                avatar_url: None,
                badge_name: None,
                badge_level: None,
            },
            payload: LiveMessagePayload::Like {
                count: click_count,
                total: None,
            },
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_danmu_msg() {
        let json_data = r#"{
            "cmd": "DANMU_MSG",
            "info": [
                [0, 1, 25, 16777215, 1700000000, 0, 0, "", 0, 0, 0],
                "哔哩哔哩乾杯！",
                [1234567, "测试B站用户", 0, 0, 0, 10000, 1, ""],
                [10, "主播粉丝牌", "主播", 0, 0, ""],
                [0, 0, 0],
                [],
                0
            ]
        }"#;

        let parsed = parse_bilibili_message("987654", json_data.as_bytes()).expect("failed to parse DANMU_MSG");
        assert_eq!(parsed.platform, "bilibili");
        assert_eq!(parsed.room_id, "987654");
        assert_eq!(parsed.user.user_id, "1234567");
        assert_eq!(parsed.user.nickname, "测试B站用户");
        assert_eq!(parsed.user.badge_name, Some("主播粉丝牌".to_string()));
        assert_eq!(parsed.user.badge_level, Some(10));

        match parsed.payload {
            LiveMessagePayload::Chat { content, color } => {
                assert_eq!(content, "哔哩哔哩乾杯！");
                assert_eq!(color, Some("#FFFFFF".to_string()));
            }
            _ => panic!("Expected Chat payload"),
        }
    }

    #[test]
    fn test_parse_send_gift() {
        let json_data = r#"{
            "cmd": "SEND_GIFT",
            "data": {
                "uid": 556677,
                "uname": "土豪观众",
                "giftName": "小心心",
                "giftId": 30001,
                "num": 99,
                "price": 100,
                "combo_num": 99,
                "medal_info": {
                    "medal_name": "舰长",
                    "medal_level": 20
                }
            }
        }"#;

        let parsed = parse_bilibili_message("987654", json_data.as_bytes()).expect("failed to parse SEND_GIFT");
        assert_eq!(parsed.user.nickname, "土豪观众");
        match parsed.payload {
            LiveMessagePayload::Gift { gift_name, count, price_cents, combo_count, .. } => {
                assert_eq!(gift_name, "小心心");
                assert_eq!(count, 99);
                assert_eq!(price_cents, 100);
                assert_eq!(combo_count, Some(99));
            }
            _ => panic!("Expected Gift payload"),
        }
    }
}

