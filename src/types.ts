export interface CookieItem {
  id: string;
  nickname: string;
  value: string;
  acquired_at: string;
  use_count: number;
  platform: string;
}

export interface GlobalConfig {
  ffmpeg_path: string;
  save_dir: string;
  cookies: CookieItem[];
  user_agent: string;
  sec_ch_ua: string;
  monitor_interval_secs: number;
  autostart: boolean;
  silent_start: boolean;
  close_to_tray: boolean;
  has_seen_guide: boolean;
  record_danmaku?: boolean;
  danmaku_format?: 'xml' | 'jsonl';
  external_player_path?: string;
}

export interface RoomConfig {
  room_id: string;
  anchor_name: string;
  is_monitoring: boolean;
  preferred_quality: string;
  segment_duration_mins: number;
  auto_record: boolean;
  platform: string;
  record_danmaku?: boolean;
  danmaku_format?: 'xml' | 'jsonl';
}


export interface AppConfig {
  global: GlobalConfig;
  rooms: RoomConfig[];
}

export interface LiveStream {
  quality_name: string;
  flv_url?: string;
  m3u8_url?: string;
}

export interface LiveRoomInfo {
  room_id: string;
  anchor_name: string;
  title: string;
  is_live: boolean;
  streams: LiveStream[];
  internal_room_id?: string;
}

export interface RecordProgress {
  room_id: string;
  time: string;
  status: 'recording' | 'stopped' | 'error';
  error_msg?: string;
  title?: string;
}

export interface TelemetryPayload {
  cpu_usage: number;
  net_recv: number;
  net_sent: number;
}

export type LiveMessageType = 'chat' | 'gift' | 'like' | 'enter' | 'superchat';

export interface LiveMessageUser {
  user_id: string;
  nickname: string;
  avatar_url?: string;
  badge_name?: string;
  badge_level?: number;
}

export interface LiveMessagePayload {
  type: LiveMessageType;
  content?: string;
  color?: string;
  gift_name?: string;
  gift_id?: number;
  count?: number;
  price_cents?: number;
  combo_count?: number;
  price_rmb?: number;
  duration_secs?: number;
  total?: number;
}

export interface LiveMessage {
  id: string;
  platform: 'douyin' | 'bilibili';
  room_id: string;
  timestamp_ms: number;
  user: LiveMessageUser;
  payload: LiveMessagePayload;
}
