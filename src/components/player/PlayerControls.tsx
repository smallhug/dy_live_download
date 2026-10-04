import React from "react";
import { LiveStream } from "../../types";
import { SettingsIcon } from "../Icons";

interface PlayerControlsProps {
  isPlaying: boolean;
  togglePlay: () => void;
  isMuted: boolean;
  volume: number;
  toggleMute: () => void;
  handleVolumeChange: (vol: number) => void;
  reconnectCount: number;
  maxReconnectRetries: number;
  currentQuality: string;
  uniqueStreams: LiveStream[];
  onChangeQuality: (quality: string) => void;
  danmakuVisible: boolean;
  setDanmakuVisible: (visible: boolean) => void;
  showDanmakuSettings: boolean;
  setShowDanmakuSettings: (show: boolean) => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  showControls: boolean;
}

const qualityNameMap: Record<string, string> = {
  origin: "原画",
  blue_ray: "蓝光",
  uhd: "超清",
  hd: "高清",
  sd: "标清",
};

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  isPlaying,
  togglePlay,
  isMuted,
  volume,
  toggleMute,
  handleVolumeChange,
  reconnectCount,
  maxReconnectRetries,
  currentQuality,
  uniqueStreams,
  onChangeQuality,
  danmakuVisible,
  setDanmakuVisible,
  showDanmakuSettings,
  setShowDanmakuSettings,
  isFullscreen,
  toggleFullscreen,
  showControls,
}) => {
  return (
    <div className={`player-control-bar ${showControls ? "visible" : ""}`}>
      <div className="control-left">
        <button
          className="control-btn"
          onClick={togglePlay}
          title={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        <div className="volume-control-wrap">
          <button
            className="control-btn"
            onClick={toggleMute}
            title={isMuted ? "取消静音" : "静音"}
          >
            {isMuted || volume === 0 ? "🔇" : volume > 0.5 ? "🔊" : "🔉"}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="volume-slider"
          />
        </div>

        <span className="live-sync-badge">
          <span
            className="dot"
            style={{
              backgroundColor: reconnectCount > 0 ? "#f59e0b" : "#4ade80",
            }}
          ></span>
          {reconnectCount > 0
            ? `重连中 (${reconnectCount}/${maxReconnectRetries})`
            : "实时直播 (HTTP-FLV)"}
        </span>
      </div>

      <div className="control-right">
        {/* 清晰度切换选择 */}
        <div className="quality-selector-wrap">
          <select
            className="quality-select"
            value={currentQuality}
            onChange={(e) => onChangeQuality(e.target.value)}
          >
            {uniqueStreams.map((s, idx) => (
              <option key={`${s.quality_name}-${idx}`} value={s.quality_name}>
                {qualityNameMap[s.quality_name] || s.quality_name}
              </option>
            ))}
          </select>
        </div>

        {/* 弹幕开关 */}
        <button
          className={`control-btn danmaku-toggle ${
            danmakuVisible ? "active" : ""
          }`}
          onClick={() => setDanmakuVisible(!danmakuVisible)}
          title={danmakuVisible ? "关闭弹幕" : "开启弹幕"}
        >
          弹
        </button>

        {/* 弹幕设置气泡触发 */}
        <button
          className="control-btn"
          onClick={() => setShowDanmakuSettings(!showDanmakuSettings)}
          title="弹幕样式设置"
        >
          <SettingsIcon size={16} />
        </button>

        {/* 全屏按钮 */}
        <button
          className="control-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "退出全屏" : "全屏"}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>
    </div>
  );
};
