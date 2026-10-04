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

// ──────────────────────────────────────────────
// 底层通用 Protobuf Wire 格式健壮扫描器 (Fallback)
// 用于当结构体定义与抖音私有版本产生微小歧义时提供 100% 容错提取能力
// ──────────────────────────────────────────────
fn read_varint(bytes: &[u8], offset: &mut usize) -> Option<u64> {
    let mut val: u64 = 0;
    let mut shift = 0;
    while *offset < bytes.len() {
        let b = bytes[*offset];
        *offset += 1;
        val |= ((b & 0x7f) as u64) << shift;
        if (b & 0x80) == 0 {
            return Some(val);
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

fn skip_field(wire_type: u64, bytes: &[u8], offset: &mut usize) -> bool {
    match wire_type {
        0 => read_varint(bytes, offset).is_some(),
        1 if *offset + 8 <= bytes.len() => {
            *offset += 8;
            true
        }
        2 => {
            let len = match read_varint(bytes, offset) {
                Some(l) => l as usize,
                None => return false,
            };
            if *offset + len <= bytes.len() {
                *offset += len;
                true
            } else {
                false
            }
        }
        5 if *offset + 4 <= bytes.len() => {
            *offset += 4;
            true
        }
        _ => false,
    }
}

pub struct RawGiftInfo {
    pub gift_id: u64,
    pub fan_ticket_count: u64,
    pub repeat_count: u64,
    pub combo_count: u64,
    pub group_count: u64,
    pub user_id: u64,
    pub nickname: String,
    pub gift_name: String,
    pub diamond_count: u32,
}

pub fn decode_gift_raw(bytes: &[u8]) -> Option<RawGiftInfo> {
    let mut offset = 0;
    let mut gift_id = 0u64;
    let mut fan_ticket_count = 0u64;
    let mut repeat_count = 0u64;
    let mut combo_count = 0u64;
    let mut group_count = 0u64;
    let mut user_id = 0u64;
    let mut nickname = String::new();
    let mut gift_name = String::new();
    let mut diamond_count = 0u32;

    while offset < bytes.len() {
        let key = read_varint(bytes, &mut offset)?;
        let field_num = key >> 3;
        let wire_type = key & 7;

        match (field_num, wire_type) {
            (2, 0) => {
                gift_id = read_varint(bytes, &mut offset)?;
            }
            (3, 0) => {
                fan_ticket_count = read_varint(bytes, &mut offset)?;
            }
            (4, 0) => {
                group_count = read_varint(bytes, &mut offset)?;
            }
            (5, 0) => {
                repeat_count = read_varint(bytes, &mut offset)?;
            }
            (6, 0) => {
                combo_count = read_varint(bytes, &mut offset)?;
            }
            (7 | 8, 2) => {
                let len = read_varint(bytes, &mut offset)? as usize;
                if offset + len > bytes.len() {
                    return None;
                }
                let sub = &bytes[offset..offset + len];
                offset += len;

                // 解析 User 子字段 (1: id, 3: nickname)
                let mut sub_offset = 0;
                while sub_offset < sub.len() {
                    let sub_key = match read_varint(sub, &mut sub_offset) {
                        Some(k) => k,
                        None => break,
                    };
                    let sub_fn = sub_key >> 3;
                    let sub_wt = sub_key & 7;
                    match (sub_fn, sub_wt) {
                        (1, 0) => {
                            if let Some(uid) = read_varint(sub, &mut sub_offset) {
                                if user_id == 0 {
                                    user_id = uid;
                                }
                            }
                        }
                        (3, 2) => {
                            if let Some(str_len) = read_varint(sub, &mut sub_offset) {
                                let str_len = str_len as usize;
                                if sub_offset + str_len <= sub.len() {
                                    let name_str = String::from_utf8_lossy(&sub[sub_offset..sub_offset + str_len]).to_string();
                                    sub_offset += str_len;
                                    if nickname.is_empty() {
                                        nickname = name_str;
                                    }
                                }
                            }
                        }
                        _ => {
                            if !skip_field(sub_wt, sub, &mut sub_offset) {
                                break;
                            }
                        }
                    }
                }
            }
            (15, 2) => {
                let len = read_varint(bytes, &mut offset)? as usize;
                if offset + len > bytes.len() {
                    return None;
                }
                let sub = &bytes[offset..offset + len];
                offset += len;

                // 解析 GiftStruct 子字段 (2: describe, 5: id, 12: diamond_count, 16: name)
                let mut sub_offset = 0;
                let mut fallback_desc = String::new();
                while sub_offset < sub.len() {
                    let sub_key = match read_varint(sub, &mut sub_offset) {
                        Some(k) => k,
                        None => break,
                    };
                    let sub_fn = sub_key >> 3;
                    let sub_wt = sub_key & 7;
                    match (sub_fn, sub_wt) {
                        (2, 2) => {
                            if let Some(str_len) = read_varint(sub, &mut sub_offset) {
                                let str_len = str_len as usize;
                                if sub_offset + str_len <= sub.len() {
                                    fallback_desc = String::from_utf8_lossy(&sub[sub_offset..sub_offset + str_len]).to_string();
                                    sub_offset += str_len;
                                }
                            }
                        }
                        (5, 0) => {
                            if let Some(gid) = read_varint(sub, &mut sub_offset) {
                                if gift_id == 0 {
                                    gift_id = gid;
                                }
                            }
                        }
                        (12, 0) => {
                            if let Some(dc) = read_varint(sub, &mut sub_offset) {
                                diamond_count = dc as u32;
                            }
                        }
                        (16, 2) => {
                            if let Some(str_len) = read_varint(sub, &mut sub_offset) {
                                let str_len = str_len as usize;
                                if sub_offset + str_len <= sub.len() {
                                    gift_name = String::from_utf8_lossy(&sub[sub_offset..sub_offset + str_len]).to_string();
                                    sub_offset += str_len;
                                }
                            }
                        }
                        _ => {
                            if !skip_field(sub_wt, sub, &mut sub_offset) {
                                break;
                            }
                        }
                    }
                }

                if gift_name.is_empty() && !fallback_desc.is_empty() {
                    gift_name = fallback_desc;
                }
            }
            _ => {
                if !skip_field(wire_type, bytes, &mut offset) {
                    break;
                }
            }
        }
    }

    if gift_id > 0 || !gift_name.is_empty() {
        Some(RawGiftInfo {
            gift_id,
            fan_ticket_count,
            repeat_count,
            combo_count,
            group_count,
            user_id,
            nickname,
            gift_name,
            diamond_count,
        })
    } else {
        None
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
        let method = msg.method.as_str();

        if method == "WebcastChatMessage" {
            if let Ok(chat) = ChatMessage::decode(&msg.payload[..]) {
                let user = chat.user.unwrap_or_default();

                results.push(LiveMessage {
                    id: format!("dy_chat_{}_{}", user.id, msg.msg_id),
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
                    payload: LiveMessagePayload::Chat {
                        content: chat.content,
                        color: None,
                    },
                });
            }
        } else if method == "WebcastGiftMessage" || method.contains("Gift") {
            // 双重鲁棒解析：优先使用 Prost typed decode，若遇字节不兼容则自动回退到底层 Wire 扫描器
            let gift_opt = if let Ok(gift_msg) = GiftMessage::decode(&msg.payload[..]) {
                let user = gift_msg.user.or(gift_msg.to_user).unwrap_or_default();
                let user_id = user.id;
                let nickname = user.nickname;
                let (gift_name_extracted, diamond_count) = if let Some(ref g) = gift_msg.gift {
                    let name = if !g.name.is_empty() {
                        g.name.clone()
                    } else {
                        g.describe.clone()
                    };
                    (name, g.diamond_count)
                } else {
                    (String::new(), 0)
                };

                Some(RawGiftInfo {
                    gift_id: gift_msg.gift_id,
                    fan_ticket_count: gift_msg.fan_ticket_count,
                    repeat_count: gift_msg.repeat_count,
                    combo_count: gift_msg.combo_count,
                    group_count: gift_msg.group_count,
                    user_id,
                    nickname,
                    gift_name: gift_name_extracted,
                    diamond_count,
                })
            } else {
                decode_gift_raw(&msg.payload[..])
            };

            if let Some(gift_data) = gift_opt {
                let user_id_str = if gift_data.user_id > 0 {
                    gift_data.user_id.to_string()
                } else {
                    format!("dy_user_{}", msg.msg_id)
                };

                let nickname = if !gift_data.nickname.is_empty() {
                    gift_data.nickname
                } else {
                    "观众".to_string()
                };

                let gift_name = if !gift_data.gift_name.is_empty() {
                    gift_data.gift_name
                } else if let Some(preset) = get_douyin_preset_gift_name(gift_data.gift_id) {
                    preset.to_string()
                } else {
                    format!("礼物{}", gift_data.gift_id)
                };

                let count = gift_data
                    .repeat_count
                    .max(gift_data.combo_count)
                    .max(gift_data.group_count)
                    .max(1) as u32;

                let price_cents = if gift_data.diamond_count > 0 {
                    (gift_data.diamond_count as u64) * 10
                } else if gift_data.gift_id == 4 {
                    // 小心心单价 1 抖币 = 10 分
                    10 * (count as u64)
                } else if gift_data.fan_ticket_count > 0 {
                    gift_data.fan_ticket_count * 10
                } else {
                    0
                };

                log::info!(
                    "[Danmaku/Douyin] 成功解析礼物消息: 用户={} 送出 {} x{} (价值{}分)",
                    nickname,
                    gift_name,
                    count,
                    price_cents
                );

                results.push(LiveMessage {
                    id: format!("dy_gift_{}_{}", user_id_str, msg.msg_id),
                    platform: "douyin".to_string(),
                    room_id: room_id.to_string(),
                    timestamp_ms: now_ms,
                    user: LiveMessageUser {
                        user_id: user_id_str,
                        nickname,
                        avatar_url: None,
                        badge_name: None,
                        badge_level: None,
                    },
                    payload: LiveMessagePayload::Gift {
                        gift_name,
                        gift_id: gift_data.gift_id,
                        count,
                        price_cents,
                        combo_count: if gift_data.combo_count > 1 {
                            Some(gift_data.combo_count as u32)
                        } else {
                            None
                        },
                    },
                });
            } else {
                log::warn!(
                    "[Danmaku/Douyin] 无法解码礼物消息 (方法: {}), payload 大小: {} 字节",
                    method,
                    msg.payload.len()
                );
            }
        } else if method == "WebcastLikeMessage" {
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
        } else if method == "WebcastMemberMessage" {
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
            }),
            to_user: None,
            gift: Some(GiftStruct {
                describe: "小心心".to_string(),
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

    #[test]
    fn test_raw_fallback_gift_parsing() {
        // 构造带有未知扩展标签 (tag 99, 100) 的原始礼物数据包，测试底层解码器容错性
        let gift = GiftMessage {
            common: None,
            gift_id: 4, // 小心心预设
            fan_ticket_count: 10,
            group_count: 1,
            repeat_count: 5,
            combo_count: 5,
            user: Some(User {
                id: 112233,
                nickname: "粉丝大哥".to_string(),
            }),
            to_user: None,
            gift: None, // 无 GiftStruct，测试预设字典回退
        };

        let response = Response {
            messages_list: vec![DouyinMessage {
                method: "WebcastGiftEffectGameMessage".to_string(),
                payload: gift.encode_to_vec(),
                msg_id: 3003,
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
        assert_eq!(msg.user.nickname, "粉丝大哥");
        match &msg.payload {
            LiveMessagePayload::Gift {
                gift_name,
                count,
                price_cents,
                ..
            } => {
                assert_eq!(gift_name, "小心心");
                assert_eq!(*count, 5);
                assert_eq!(*price_cents, 50); // 5 * 10分
            }
            _ => panic!("Expected Gift payload"),
        }
    }
}
