use prost::Message;

#[derive(Clone, PartialEq, Message)]
pub struct PushFrame {
    #[prost(uint64, tag = "1")]
    pub seq_id: u64,
    #[prost(uint64, tag = "2")]
    pub log_id: u64,
    #[prost(uint64, tag = "3")]
    pub service: u64,
    #[prost(uint64, tag = "4")]
    pub method: u64,
    #[prost(string, tag = "6")]
    pub payload_encoding: ::prost::alloc::string::String,
    #[prost(string, tag = "7")]
    pub payload_type: ::prost::alloc::string::String,
    #[prost(bytes = "vec", tag = "8")]
    pub payload: ::prost::alloc::vec::Vec<u8>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Response {
    #[prost(message, repeated, tag = "1")]
    pub messages_list: ::prost::alloc::vec::Vec<DouyinMessage>,
    #[prost(string, tag = "2")]
    pub cursor: ::prost::alloc::string::String,
    #[prost(uint64, tag = "3")]
    pub fetch_interval: u64,
    #[prost(uint64, tag = "4")]
    pub now: u64,
    #[prost(string, tag = "5")]
    pub internal_ext: ::prost::alloc::string::String,
    #[prost(uint32, tag = "6")]
    pub fetch_type: u32,
    #[prost(bool, tag = "9")]
    pub need_ack: bool,
    #[prost(string, tag = "10")]
    pub push_server: ::prost::alloc::string::String,
}

#[derive(Clone, PartialEq, Message)]
pub struct DouyinMessage {
    #[prost(string, tag = "1")]
    pub method: ::prost::alloc::string::String,
    #[prost(bytes = "vec", tag = "2")]
    pub payload: ::prost::alloc::vec::Vec<u8>,
    #[prost(int64, tag = "3")]
    pub msg_id: i64,
}

#[derive(Clone, PartialEq, Message)]
pub struct Common {
    #[prost(string, tag = "1")]
    pub method: ::prost::alloc::string::String,
    #[prost(int64, tag = "2")]
    pub msg_id: i64,
    #[prost(int64, tag = "3")]
    pub room_id: i64,
    #[prost(int64, tag = "4")]
    pub create_time: i64,
}

#[derive(Clone, PartialEq, Message)]
pub struct Image {
    #[prost(string, repeated, tag = "1")]
    pub url_list: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
}

#[derive(Clone, PartialEq, Message)]
pub struct User {
    #[prost(uint64, tag = "1")]
    pub id: u64,
    #[prost(string, tag = "3")]
    pub nickname: ::prost::alloc::string::String,
}

#[derive(Clone, PartialEq, Message)]
pub struct ChatMessage {
    #[prost(message, optional, tag = "1")]
    pub common: ::core::option::Option<Common>,
    #[prost(message, optional, tag = "2")]
    pub user: ::core::option::Option<User>,
    #[prost(string, tag = "3")]
    pub content: ::prost::alloc::string::String,
}

#[derive(Clone, PartialEq, Message)]
pub struct GiftStruct {
    #[prost(string, tag = "2")]
    pub describe: ::prost::alloc::string::String,
    #[prost(uint64, tag = "5")]
    pub id: u64,
    #[prost(uint32, tag = "12")]
    pub diamond_count: u32,
    #[prost(string, tag = "16")]
    pub name: ::prost::alloc::string::String,
}

#[derive(Clone, PartialEq, Message)]
pub struct GiftMessage {
    #[prost(message, optional, tag = "1")]
    pub common: ::core::option::Option<Common>,
    #[prost(uint64, tag = "2")]
    pub gift_id: u64,
    #[prost(uint64, tag = "3")]
    pub fan_ticket_count: u64,
    #[prost(uint64, tag = "4")]
    pub group_count: u64,
    #[prost(uint64, tag = "5")]
    pub repeat_count: u64,
    #[prost(uint64, tag = "6")]
    pub combo_count: u64,
    #[prost(message, optional, tag = "7")]
    pub user: ::core::option::Option<User>,
    #[prost(message, optional, tag = "8")]
    pub to_user: ::core::option::Option<User>,
    #[prost(message, optional, tag = "15")]
    pub gift: ::core::option::Option<GiftStruct>,
}

#[derive(Clone, PartialEq, Message)]
pub struct LikeMessage {
    #[prost(message, optional, tag = "1")]
    pub common: ::core::option::Option<Common>,
    #[prost(int64, tag = "2")]
    pub count: i64,
    #[prost(int64, tag = "3")]
    pub total: i64,
    #[prost(message, optional, tag = "5")]
    pub user: ::core::option::Option<User>,
}

#[derive(Clone, PartialEq, Message)]
pub struct MemberMessage {
    #[prost(message, optional, tag = "1")]
    pub common: ::core::option::Option<Common>,
    #[prost(message, optional, tag = "2")]
    pub user: ::core::option::Option<User>,
    #[prost(int64, tag = "3")]
    pub member_count: i64,
    #[prost(int64, tag = "10")]
    pub action: i64,
}
