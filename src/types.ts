export interface GlobalConfig {
  ffmpeg_path: string;
  save_dir: string;
  cookie: string;
  user_agent: string;
  sec_ch_ua: string;
  monitor_interval_secs: number;
}

export interface RoomConfig {
  url: string;
  room_id: string;
  anchor_name: string;
  is_monitoring: boolean;
  preferred_quality: string;
  segment_duration_mins: number;
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
}

export interface RecordProgress {
  room_id: string;
  time: string;
  size: string;
  bitrate: string;
  status: 'recording' | 'stopped' | 'error';
  error_msg?: string;
}
