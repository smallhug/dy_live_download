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

export const RoomCard: React.FC<RoomCardProps> = React.memo(({
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
  const cardClass = [
    "room-card glass-card",
    isRecording ? "is-recording" : "",
    recordLoading === "starting" ? "is-starting" : "",
    recordLoading === "stopping" ? "is-stopping" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={cardClass}>
      {/* 平台水印背景 */}
      <div className="card-platform-watermark">
        {room.platform === "bilibili" ? (
          <svg viewBox="0 0 96 86" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ height: "100%", width: "auto" }}>
            <path fillRule="evenodd" clipRule="evenodd" d="M19.9068 9.24502C17.7722 7.18582 17.7722 3.76656 19.9068 1.70742C21.9355 -0.249681 25.1494 -0.249681 27.1782 1.70742L38.4919 12.6215C38.8133 12.9316 39.0863 13.2725 39.311 13.635H56.4208C56.6459 13.2725 56.9189 12.9316 57.24 12.6215L68.5536 1.70742C70.5824 -0.249681 73.7963 -0.249681 75.8251 1.70742C77.96 3.76656 77.96 7.18582 75.8251 9.24502L71.2747 13.635H74.6667C86.4485 13.635 96 23.1863 96 34.9684V64.3312C96 76.1131 86.4485 85.6645 74.6667 85.6645H21.3333C9.55125 85.6645 0 76.1131 0 64.3312V34.9683C0 23.1862 9.55125 13.635 21.3333 13.635H24.4575L19.9068 9.24502ZM21.3333 23.925C15.4423 23.925 10.6667 28.7006 10.6667 34.5916V64.7077C10.6667 70.5989 15.4423 75.3744 21.3333 75.3744H74.6667C80.5579 75.3744 85.3333 70.5989 85.3333 64.7077V34.5916C85.3333 28.7006 80.5579 23.925 74.6667 23.925H21.3333ZM26.6667 44.6932C26.6667 41.7477 29.0545 39.3598 32 39.3598C34.9455 39.3598 37.3333 41.7477 37.3333 44.6932V49.4613C37.3333 52.4069 34.9455 54.7947 32 54.7947C29.0545 54.7947 26.6667 52.4069 26.6667 49.4613V44.6932ZM64 39.3598C61.0544 39.3598 58.6667 41.7477 58.6667 44.6932V49.4613C58.6667 52.4069 61.0544 54.7947 64 54.7947C66.9456 54.7947 69.3333 52.4069 69.3333 49.4613V44.6932C69.3333 41.7477 66.9456 39.3598 64 39.3598Z" fill="#00AEEC"/>
          </svg>
        ) : (
          <svg viewBox="0 0 38 42" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ height: "100%", width: "auto" }}>
            <path d="M14.4601 16.5325V14.9041C13.8944 14.8362 13.3287 14.791 12.7403 14.791C5.72523 14.791 0 20.4905 0 27.5245C0 31.8217 2.14978 35.644 5.43103 37.951C3.30388 35.6667 2.01401 32.636 2.01401 29.2886C2.03664 22.3452 7.58082 16.6909 14.4601 16.5325Z" fill="#00FAF0"></path>
            <path d="M14.7548 35.0566C17.8776 35.0566 20.4347 32.5687 20.5479 29.4701V1.76414H25.6169C25.5037 1.19871 25.4585 0.610663 25.4585 0H18.5339V27.706C18.4207 30.8046 15.8636 33.2925 12.7408 33.2925C11.7677 33.2925 10.8399 33.0437 10.0479 32.6139C11.1114 34.1067 12.8313 35.0566 14.7548 35.0566Z" fill="#00FAF0"></path>
            <path d="M35.0967 11.1728V9.63479C33.1732 9.63479 31.3628 9.06937 29.8467 8.07422C31.2044 9.61218 33.0374 10.7204 35.0967 11.1728Z" fill="#00FAF0"></path>
            <path d="M29.8703 8.07582C28.3994 6.37953 27.4942 4.18566 27.4942 1.76562H25.6387C26.1365 4.38922 27.6979 6.65094 29.8703 8.07582Z" fill="#FF0050"></path>
            <path d="M12.7406 21.6899C9.52719 21.6899 6.9248 24.2909 6.9248 27.5025C6.9248 29.7416 8.19205 31.6641 10.0477 32.6366C9.36878 31.6867 8.93881 30.5106 8.93881 29.244C8.93881 26.0324 11.5412 23.4314 14.7546 23.4314C15.3429 23.4314 15.9313 23.5219 16.4744 23.7028V16.6463C15.9087 16.5784 15.3429 16.5332 14.7546 16.5332C14.6641 16.5332 14.5509 16.5332 14.4604 16.5332V21.9613C13.9173 21.7804 13.3516 21.6899 12.7406 21.6899Z" fill="#FF0050"></path>
            <path d="M35.0986 11.1729V16.5557C31.5005 16.5557 28.1966 15.4023 25.4811 13.4572V27.5024C25.4811 34.5138 19.7785 40.2359 12.7408 40.2359C10.0252 40.2359 7.51337 39.3765 5.4541 37.929C7.78493 40.4169 11.0888 42.0001 14.7774 42.0001C21.7925 42.0001 27.5177 36.3005 27.5177 29.2666V15.2213C30.2332 17.1664 33.5598 18.3199 37.1352 18.3199V11.399C36.4337 11.3764 35.7548 11.3086 35.0986 11.1729Z" fill="#FF0050"></path>
            <path d="M25.479 27.503V13.4577C28.1945 15.4028 31.5211 16.5563 35.0965 16.5563V11.1734C33.0146 10.721 31.2042 9.61281 29.8465 8.07484C27.6741 6.67258 26.1126 4.41086 25.6374 1.76465H20.5684V29.4707C20.4553 32.5692 17.8982 35.0571 14.7753 35.0571C12.8292 35.0571 11.1094 34.1072 10.0684 32.6371C8.2128 31.6645 6.94556 29.7194 6.94556 27.503C6.94556 24.2913 9.54794 21.6904 12.7613 21.6904C13.3497 21.6904 13.938 21.7808 14.4811 21.9618V16.5336C7.6018 16.692 2.05762 22.3463 2.05762 29.2445C2.05762 32.5918 3.34749 35.6451 5.47465 37.9069C7.53392 39.3544 10.0684 40.2138 12.7613 40.2138C19.7538 40.2364 25.479 34.5143 25.479 27.503Z" fill="black"></path>
          </svg>
        )}
      </div>

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
          <div className="progress-grid">
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
              style={{ height: "26px", padding: "0 10px", fontSize: "11px", borderRadius: "5px", minWidth: "78px" }}
            >
              停止录制
            </button>
          ) : (
            <button 
              className={`btn btn-sm ${isLive ? "btn-primary" : "btn-secondary"}`}
              onClick={onStartRecord}
              disabled={recordLoading === "starting"}
              style={{ height: "26px", padding: "0 10px", fontSize: "11px", borderRadius: "5px", minWidth: "78px" }}
            >
              开始录制
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
