import React from "react";
import { RoomConfig, RecordProgress } from "../types";
import { 
  RefreshIcon, 
  SettingsIcon, 
  TrashIcon, 
  LoadingIcon, 
  TimerIcon
} from "./Icons";

interface RoomCardProps {
  room: RoomConfig;
  isLive: boolean;
  title: string;
  isChecking: boolean;
  isRecording: boolean;
  recordProgress?: RecordProgress;
  recordLoading: "starting" | "stopping" | null;
  onCheckStatus: () => void;
  onStartRecord: () => void;
  onStopRecord: () => void;
  onDelete: () => void;
  onSettings: () => void;
}

export const RoomCard: React.FC<RoomCardProps> = ({
  room,
  isLive,
  title,
  isChecking,
  isRecording,
  recordProgress,
  recordLoading,
  onCheckStatus,
  onStartRecord,
  onStopRecord,
  onDelete,
  onSettings,
}) => {
  return (
    <div className={`room-card glass-card ${isRecording ? "is-recording" : ""}`}>
      {/* 卡片头部：左侧主播信息，右侧三个只显示图标的工具按钮 */}
      <div className="card-header">
        <div className="card-header-left">
          <span className="anchor-name" title={room.anchor_name}>
            {room.anchor_name || "未知主播"}
          </span>
          <span className="room-id">ID: {room.room_id}</span>
        </div>
        <div className="card-header-right" style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <button 
            className="icon-btn" 
            onClick={onCheckStatus} 
            disabled={isChecking || isRecording}
            title="检测主播开播状态"
            style={{ width: "30px", height: "30px", borderRadius: "6px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            {isChecking ? <LoadingIcon size={16} /> : <RefreshIcon size={16} />}
          </button>
          
          <button 
            className="icon-btn" 
            onClick={onSettings} 
            title="高级参数设置"
            style={{ width: "30px", height: "30px", borderRadius: "6px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <SettingsIcon size={16} />
          </button>
          
          <button 
            className="icon-btn icon-btn-danger" 
            onClick={onDelete} 
            title="删除此主播"
            style={{ width: "30px", height: "30px", borderRadius: "6px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </div>

      {/* 卡片中间部分：显示当前标题，画质、分段时间、已录制时间 */}
      <div className="card-body" style={{ paddingBottom: "12px" }}>
        {/* 直播标题 */}
        <div className="info-row" style={{ marginBottom: "8px" }}>
          <span className="info-value" title={title || "暂无"} style={{ fontSize: "13px", color: title ? "#334155" : "#94a3b8", fontWeight: title ? "500" : "normal" }}>
            {title ? (title.length > 24 ? title.slice(0, 24) + "..." : title) : "暂无开播数据"}
          </span>
        </div>

        {/* 参数展示面板 (画质、分段时间、录制时间) */}
        <div className="progress-panel" style={{ marginTop: "4px" }}>
          <div className="progress-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
            <div className="progress-stat">
              <span className="stat-label">画质</span>
              <span className="stat-value" style={{ fontSize: "11.5px", fontWeight: "600" }}>
                {room.preferred_quality === "origin" ? "原画" : 
                 room.preferred_quality === "blue_ray" ? "蓝光" :
                 room.preferred_quality === "uhd" ? "超清" : 
                 room.preferred_quality === "hd" ? "高清" : "标清"}
              </span>
            </div>
            
            <div className="progress-stat">
              <span className="stat-label">分段时长</span>
              <span className="stat-value" style={{ fontSize: "11.5px", fontWeight: "600" }}>
                {room.segment_duration_mins > 0 ? `${room.segment_duration_mins} 分钟` : "不分段"}
              </span>
            </div>
            
            <div className="progress-stat">
              <span className="stat-label" style={{ color: isRecording ? "#ef4444" : "#94a3b8" }}>录制时间</span>
              <span className="stat-value" style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11.5px", color: isRecording ? "#ef4444" : "#334155", fontWeight: isRecording ? "600" : "500" }}>
                <TimerIcon size={13} style={{ color: isRecording ? "#ef4444" : "#94a3b8" }} />
                {isRecording ? (recordProgress?.time || "00:00:00") : "00:00:00"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 卡片底栏：状态统一放在左下角，录制按钮在右下角 */}
      <div className="card-actions" style={{ justifyContent: "space-between", alignItems: "center", padding: "8px 16px" }}>
        {/* 左下角：开播状态与监控状态并排放置 */}
        <div className="action-left" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span className={`status-badge ${isLive ? "live" : "offline"}`} style={{ fontSize: "10px", padding: "2px 6px", height: "20px" }}>
            <span className="dot"></span>
            {isLive ? "直播中" : "未开播"}
          </span>
          
          <span 
            className="status-badge" 
            style={{ 
              backgroundColor: room.is_monitoring ? "#eff6ff" : "#f8fafc", 
              color: room.is_monitoring ? "#2563eb" : "#64748b",
              border: room.is_monitoring ? "1px solid #dbeafe" : "1px solid #f1f5f9",
              fontSize: "10px",
              padding: "2px 6px",
              height: "20px"
            }}
          >
            <span 
              className="dot" 
              style={{ 
                backgroundColor: room.is_monitoring ? "#2563eb" : "#94a3b8" 
              }}
            ></span>
            {room.is_monitoring ? "监控中" : "监控关"}
          </span>
        </div>

        {/* 右下角：录制动作控制按钮 */}
        <div className="action-right">
          {isRecording ? (
            <button 
              className="btn btn-danger btn-sm" 
              onClick={onStopRecord}
              disabled={recordLoading === "stopping"}
              style={{ height: "26px", padding: "0 10px", fontSize: "11px", borderRadius: "5px", gap: "4px" }}
            >
              {recordLoading === "stopping" ? <LoadingIcon size={11} /> : null}
              停止录制
            </button>
          ) : (
            <button 
              className={`btn btn-sm ${isLive ? "btn-primary" : "btn-secondary"}`}
              onClick={onStartRecord}
              disabled={recordLoading === "starting"}
              style={{ height: "26px", padding: "0 10px", fontSize: "11px", borderRadius: "5px", gap: "4px" }}
            >
              {recordLoading === "starting" ? <LoadingIcon size={11} /> : null}
              开始录制
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
