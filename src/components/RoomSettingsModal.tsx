import React, { useState, useEffect } from "react";
import { RoomConfig } from "../types";

interface RoomSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: RoomConfig | null;
  onSave: (room: RoomConfig) => Promise<void>;
}

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  isOpen,
  onClose,
  room,
  onSave,
}) => {
  const [quality, setQuality] = useState("原画");
  const [segmentMins, setSegmentMins] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && room) {
      setQuality(room.preferred_quality || "原画");
      setSegmentMins(room.segment_duration_mins || 0);
    }
  }, [isOpen, room]);

  if (!isOpen || !room) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        ...room,
        preferred_quality: quality,
        segment_duration_mins: segmentMins,
      });
      onClose();
    } catch (err) {
      alert("保存设置失败: " + err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content glass-card" 
        style={{ maxWidth: "420px" }} 
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="modal-header">
          <h2 style={{ fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            ⚙️ 直播间设置
          </h2>
          <button className="close-btn" onClick={onClose} disabled={isSaving}>
            &times;
          </button>
        </div>

        {/* 主播信息 */}
        <div style={{ 
          background: "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)", 
          padding: "12px 14px", 
          borderRadius: "10px", 
          marginBottom: "18px",
          border: "1px solid #cbd5e1"
        }}>
          <div style={{ fontWeight: "700", fontSize: "14px", color: "#1e293b", marginBottom: "4px" }}>
            🎤 {room.anchor_name}
          </div>
          <div style={{ fontSize: "11.5px", color: "#64748b" }}>
            房间 ID: {room.room_id}
          </div>
        </div>

        <form onSubmit={handleSave} className="modal-form">
          {/* 画质选择 - 下拉列表 */}
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", fontWeight: "600", fontSize: "13px", color: "#334155" }}>
              <span>🎬</span> 录制画质
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={isSaving}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "14px",
                border: "2px solid #e2e8f0",
                borderRadius: "8px",
                backgroundColor: "#ffffff",
                color: "#1e293b",
                cursor: "pointer",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = "#6366f1"}
              onBlur={(e) => e.currentTarget.style.borderColor = "#e2e8f0"}
            >
              <option value="原画">原画（最高画质）</option>
              <option value="蓝光">蓝光（高清流畅）</option>
              <option value="超清">超清（清晰度高）</option>
              <option value="高清">高清（通用推荐）</option>
              <option value="标清">标清（节省流量）</option>
            </select>
          </div>

          {/* 分段设置 - 下拉列表 */}
          <div className="form-group" style={{ marginTop: "18px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", fontWeight: "600", fontSize: "13px", color: "#334155" }}>
              <span>⏱️</span> 自动分段时长
            </label>
            <select
              value={segmentMins}
              onChange={(e) => setSegmentMins(Number(e.target.value))}
              disabled={isSaving}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "14px",
                border: "2px solid #e2e8f0",
                borderRadius: "8px",
                backgroundColor: "#ffffff",
                color: "#1e293b",
                cursor: "pointer",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = "#6366f1"}
              onBlur={(e) => e.currentTarget.style.borderColor = "#e2e8f0"}
            >
              <option value={0}>不分段（录制为单个完整文件）</option>
              <option value={15}>每 15 分钟自动分段</option>
              <option value={30}>每 30 分钟自动分段（推荐）</option>
              <option value={60}>每 60 分钟自动分段</option>
              <option value={120}>每 120 分钟自动分段</option>
            </select>
            <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "8px", margin: 0 }}>
              💡 设置为"不分段"时，整个直播会录制为一个完整的视频文件
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="modal-actions" style={{ marginTop: "22px", paddingTop: "18px", borderTop: "1px solid #e2e8f0" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "保存中..." : "✅ 保存设置"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
