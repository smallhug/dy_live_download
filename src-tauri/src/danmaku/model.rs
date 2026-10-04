use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LiveMessagePayload {
    Chat {
        content: String,
        color: Option<String>,
    },
    Gift {
        gift_name: String,
        gift_id: u64,
        count: u32,
        price_cents: u64,
        combo_count: Option<u32>,
    },
    Like {
        count: u64,
        total: Option<u64>,
    },
    Enter,
    SuperChat {
        content: String,
        price_rmb: f64,
        duration_secs: u32,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LiveMessageUser {
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub badge_name: Option<String>,
    pub badge_level: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiveMessage {
    pub id: String,
    pub platform: String, // "douyin" | "bilibili"
    pub room_id: String,
    pub timestamp_ms: u64,
    pub user: LiveMessageUser,
    pub payload: LiveMessagePayload,
}
