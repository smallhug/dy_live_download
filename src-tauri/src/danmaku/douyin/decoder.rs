use crate::danmaku::douyin::proto::{
    ChatMessage, GiftMessage, LikeMessage, MemberMessage, PushFrame, Response,
};
use crate::danmaku::model::{LiveMessage, LiveMessagePayload, LiveMessageUser};
use chrono::Utc;
use flate2::read::GzDecoder;
use prost::Message;
use std::io::Read;

// 常用抖音礼物预设字典（防止在轻量礼物包未携带完整 GiftStruct 时的名称回退）
pub fn get_douyin_preset_gift_name(gift_id: u64) -> Option<&'static str> {
    match gift_id {
        1 => Some("赞"),
        2 => Some("玫瑰"),
        3 => Some("为你打call"),
        4 => Some("小心心"),
        5 => Some("比心"),
        9 => Some("大啤酒"),
        24 => Some("么么哒"),
        48 => Some("抖音"),
        120 => Some("告白气球"),
        131 => Some("保时捷"),
        142 => Some("嘉年华"),
        2002 => Some("棒棒糖"),
        2003 => Some("能量药水"),
        2004 => Some("闪耀之星"),
        3334 => Some("粉丝团灯牌"),
        _ => None,
    }
}

pub fn decode_push_frame(raw_bytes: &[u8]) -> Result<(PushFrame, Option<Response>), String> {
    let frame = PushFrame::decode(raw_bytes)
        .map_err(|e| format!("Failed to decode PushFrame: {}", e))?;

    if frame.payload.is_empty() {
        return Ok((frame, None));
    }

    let decompressed = if frame.payload_encoding == "gzip" {
        let mut gz = GzDecoder::new(&frame.payload[..]);
        let mut out = Vec::new();
        gz.read_to_end(&mut out)
            .map_err(|e| format!("Gzip decompression failed: {}", e))?;
        out
    } else {
        frame.payload.clone()
    };

    let response = Response::decode(&decompressed[..])
        .map_err(|e| format!("Failed to decode Response: {}", e))?;

    Ok((frame, Some(response)))
}

pub fn parse_douyin_messages(room_id: &str, response: &Response) -> Vec<LiveMessage> {
    let mut results = Vec::new();
    let now_ms = Utc::now().timestamp_millis() as u64;

    for msg in &response.messages_list {
        match msg.method.as_str() {
            "WebcastChatMessage" => {
                if let Ok(chat) = ChatMessage::decode(&msg.payload[..]) {
                    let user = chat.user.unwrap_or_default();
                    let avatar = user.avatar_thumb.and_then(|img| img.url_list.into_iter().next());

                    results.push(LiveMessage {
                        id: format!("dy_chat_{}_{}", user.id, msg.msg_id),
                        platform: "douyin".to_string(),
                        room_id: room_id.to_string(),
                        timestamp_ms: now_ms,
                        user: LiveMessageUser {
                            user_id: user.id.to_string(),
                            nickname: user.nickname,
                            avatar_url: avatar,
                            badge_name: None,
                            badge_level: None,
                        },
                        payload: LiveMessagePayload::Chat {
                            content: chat.content,
                            color: None,
                        },
                    });
                }
            }
            "WebcastGiftMessage" | "WebcastGiftEffectGameMessage" | "WebcastGiftBroadcastMessage" => {
                match GiftMessage::decode(&msg.payload[..]) {
                    Ok(gift_msg) => {
                        let user = gift_msg.user.or(gift_msg.to_user).unwrap_or_default();
                        let user_id = if user.id > 0 {
                            user.id.to_string()
                        } else {
                            format!("dy_user_{}", msg.msg_id)
                        };
                        let nickname = if !user.nickname.is_empty() {
                            user.nickname
                        } else {
                            "观众".to_string()
                        };

                        let gift_name = gift_msg
                            .gift
                            .as_ref()
                            .and_then(|g| {
                                if !g.name.is_empty() {
                                    Some(g.name.clone())
                                } else if !g.describe.is_empty() {
                                    Some(g.describe.clone())
                                } else {
                                    None
                                }
                            })
                            .or_else(|| get_douyin_preset_gift_name(gift_msg.gift_id).map(|s| s.to_string()))
                            .unwrap_or_else(|| format!("礼物{}", gift_msg.gift_id));

                        let count = gift_msg
                            .repeat_count
                            .max(gift_msg.combo_count)
                            .max(gift_msg.group_count)
                            .max(1) as u32;

                        let price_cents = if let Some(ref g) = gift_msg.gift {
                            if g.diamond_count > 0 {
                                (g.diamond_count as u64) * 10
                            } else {
                                gift_msg.fan_ticket_count * 10
                            }
                        } else if gift_msg.gift_id == 4 {
                            // 小心心单价 1 抖币 = 10 分
                            10 * (count as u64)
                        } else {
                            gift_msg.fan_ticket_count * 10
                        };

                        log::info!(
                            "[Danmaku/Douyin] 成功解析礼物消息: 用户={} 送出 {} x{} (价值{}分)",
                            nickname,
                            gift_name,
                            count,
                            price_cents
                        );

                        results.push(LiveMessage {
                            id: format!("dy_gift_{}_{}", user_id, msg.msg_id),
                            platform: "douyin".to_string(),
                            room_id: room_id.to_string(),
                            timestamp_ms: now_ms,
                            user: LiveMessageUser {
                                user_id,
                                nickname,
                                avatar_url: None,
                                badge_name: None,
                                badge_level: None,
                            },
                            payload: LiveMessagePayload::Gift {
                                gift_name,
                                gift_id: gift_msg.gift_id,
                                count,
                                price_cents,
                                combo_count: if gift_msg.combo_count > 1 {
                                    Some(gift_msg.combo_count as u32)
                                } else {
                                    None
                                },
                            },
                        });
                    }
                    Err(e) => {
                        log::warn!(
                            "[Danmaku/Douyin] 解码 {} 失败: {}, payload 长度: {}",
                            msg.method,
                            e,
                            msg.payload.len()
                        );
                    }
                }
            }
            "WebcastLikeMessage" => {
                if let Ok(like) = LikeMessage::decode(&msg.payload[..]) {
                    let user = like.user.unwrap_or_default();
                    results.push(LiveMessage {
                        id: format!("dy_like_{}_{}", user.id, msg.msg_id),
                        platform: "douyin".to_string(),
                        room_id: room_id.to_string(),
                        timestamp_ms: now_ms,
                        user: LiveMessageUser {
                            user_id: user.id.to_string(),
                            nickname: user.nickname,
                            avatar_url: None,
                            badge_name: None,
                            badge_level: None,
                        },
                        payload: LiveMessagePayload::Like {
                            count: like.count as u64,
                            total: Some(like.total as u64),
                        },
                    });
                }
            }
            "WebcastMemberMessage" => {
                if let Ok(member) = MemberMessage::decode(&msg.payload[..]) {
                    let user = member.user.unwrap_or_default();
                    results.push(LiveMessage {
                        id: format!("dy_enter_{}_{}", user.id, msg.msg_id),
                        platform: "douyin".to_string(),
                        room_id: room_id.to_string(),
                        timestamp_ms: now_ms,
                        user: LiveMessageUser {
                            user_id: user.id.to_string(),
                            nickname: user.nickname,
                            avatar_url: None,
                            badge_name: None,
                            badge_level: None,
                        },
                        payload: LiveMessagePayload::Enter,
                    });
                }
            }
            _ => {}
        }
    }

    results
}

pub fn create_ack_frame(log_id: u64, internal_ext: &str) -> Vec<u8> {
    let frame = PushFrame {
        seq_id: 0,
        log_id,
        service: 0,
        method: 0,
        payload_encoding: String::new(),
        payload_type: "ack".to_string(),
        payload: internal_ext.as_bytes().to_vec(),
    };
    frame.encode_to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::danmaku::douyin::proto::{ChatMessage, DouyinMessage, GiftMessage, GiftStruct, User};

    #[test]
    fn test_create_and_decode_ack_frame() {
        let ack_bytes = create_ack_frame(12345678, "internal_route");
        let decoded = PushFrame::decode(&ack_bytes[..]).expect("decode PushFrame failed");

        assert_eq!(decoded.log_id, 12345678);
        assert_eq!(decoded.payload_type, "ack");
        assert_eq!(decoded.payload, b"internal_route");
    }

    #[test]
    fn test_parse_douyin_chat_message() {
        let chat = ChatMessage {
            common: None,
            user: Some(User {
                id: 998877,
                nickname: "测试老哥".to_string(),
                display_id: "test_bro".to_string(),
                sec_uid: "sec_uid_123".to_string(),
                avatar_thumb: None,
            }),
            content: "主播今天录制很清晰！".to_string(),
        };

        let response = Response {
            messages_list: vec![DouyinMessage {
                method: "WebcastChatMessage".to_string(),
                payload: chat.encode_to_vec(),
                msg_id: 1001,
            }],
            cursor: "1".to_string(),
            fetch_interval: 1000,
            now: 1700000000,
            internal_ext: "".to_string(),
            fetch_type: 0,
            need_ack: false,
            push_server: "".to_string(),
        };

        let parsed = parse_douyin_messages("7392817291", &response);
        assert_eq!(parsed.len(), 1);
        let msg = &parsed[0];
        assert_eq!(msg.platform, "douyin");
        assert_eq!(msg.user.user_id, "998877");
        assert_eq!(msg.user.nickname, "测试老哥");

        match &msg.payload {
            LiveMessagePayload::Chat { content, .. } => {
                assert_eq!(content, "主播今天录制很清晰！");
            }
            _ => panic!("Expected Chat payload"),
        }
    }

    #[test]
    fn test_parse_douyin_gift_message() {
        let gift = GiftMessage {
            common: None,
            gift_id: 1024,
            fan_ticket_count: 520,
            group_count: 1,
            repeat_count: 10,
            combo_count: 10,
            user: Some(User {
                id: 666888,
                nickname: "土豪老板".to_string(),
                display_id: "boss666".to_string(),
                sec_uid: "sec_uid_888".to_string(),
                avatar_thumb: None,
            }),
            to_user: None,
            gift: Some(GiftStruct {
                image: None,
                describe: "小心心".to_string(),
                notify: false,
                duration: 0,
                id: 1024,
                diamond_count: 52,
                name: "爱心发射".to_string(),
            }),
        };

        let response = Response {
            messages_list: vec![DouyinMessage {
                method: "WebcastGiftMessage".to_string(),
                payload: gift.encode_to_vec(),
                msg_id: 2002,
            }],
            cursor: "1".to_string(),
            fetch_interval: 1000,
            now: 1700000000,
            internal_ext: "".to_string(),
            fetch_type: 0,
            need_ack: false,
            push_server: "".to_string(),
        };

        let parsed = parse_douyin_messages("71564838536", &response);
        assert_eq!(parsed.len(), 1);
        let msg = &parsed[0];
        assert_eq!(msg.platform, "douyin");
        assert_eq!(msg.user.user_id, "666888");
        assert_eq!(msg.user.nickname, "土豪老板");

        match &msg.payload {
            LiveMessagePayload::Gift {
                gift_name,
                count,
                price_cents,
                combo_count,
                ..
            } => {
                assert_eq!(gift_name, "爱心发射");
                assert_eq!(*count, 10);
                assert_eq!(*price_cents, 520); // 52 钻石 * 10 = 520 分
                assert_eq!(*combo_count, Some(10));
            }
            _ => panic!("Expected Gift payload"),
        }
    }
}
