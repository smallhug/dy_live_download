import React, { useState, useEffect } from "react";
import { RoomConfig } from "../types";
import { SettingsIcon, MovieIcon, TimerIcon, BroadcastIcon, CameraIcon, TipIcon, CheckIcon } from "./Icons";

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
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [autoRecord, setAutoRecord] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && room) {
      const q = room.preferred_quality || "";
      let mapped = q === "原画" ? "origin" : q === "蓝光" ? "blue_ray" : q === "超清" ? "uhd" : q === "高清" ? "hd" : q === "标清" ? "sd" : q || "origin";
      // B站不支持高清和标清，若配置不合理则自动纠正到超清
      if (room.platform === "bilibili" && (mapped === "hd" || mapped === "sd")) {
        mapped = "uhd";
      }
      setQuality(mapped);
      setSegmentMins(room.segment_duration_mins || 0);
      setIsMonitoring(room.is_monitoring ?? false);
      setAutoRecord(room.auto_record ?? true);
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
        is_monitoring: isMonitoring,
        auto_record: autoRecord,
      });
      onClose();
    } catch (err) {
      // 错误已由父组件处理
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content glass-card" 
        style={{ maxWidth: "380px" }} 
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="modal-header">
          <h2 style={{ fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <SettingsIcon size={18} style={{ color: "#6366f1" }} /> 直播间设置
          </h2>
          <button className="close-btn" onClick={onClose} disabled={isSaving}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSave} className="modal-form" style={{ gap: "12px" }}>
          {/* 录制画质 & 自动分段 - 并排 */}
          <div style={{ display: "flex", gap: "12px" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px", color: "#334155" }}>
                <MovieIcon size={13} /> 录制画质
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={isSaving}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "13px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  backgroundColor: "#ffffff",
                  color: "#1e293b",
                  outline: "none",
                }}
              >
                <option value="origin">原画</option>
                <option value="blue_ray">蓝光</option>
                <option value="uhd">超清</option>
                {room.platform !== "bilibili" && (
                  <>
                    <option value="hd">高清</option>
                    <option value="sd">标清</option>
                  </>
                )}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px", color: "#334155" }}>
                <TimerIcon size={13} /> 分段时长
              </label>
              <select
                value={segmentMins}
                onChange={(e) => setSegmentMins(Number(e.target.value))}
                disabled={isSaving}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "13px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  backgroundColor: "#ffffff",
                  color: "#1e293b",
                  outline: "none",
                }}
              >
                <option value={0}>不分段</option>
                <option value={15}>15分钟</option>
                <option value={30}>30分钟</option>
                <option value={60}>60分钟</option>
                <option value={120}>120分钟</option>
              </select>
            </div>
          </div>

          {/* 自动监控 & 自动录制 - 并排 */}
          <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px", color: "#334155" }}>
                <BroadcastIcon size={13} /> 自动监控
              </label>
              <select
                value={isMonitoring ? "true" : "false"}
                onChange={(e) => setIsMonitoring(e.target.value === "true")}
                disabled={isSaving}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "13px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  backgroundColor: "#ffffff",
                  color: "#1e293b",
                  outline: "none",
                }}
              >
                <option value="true">开启监控</option>
                <option value="false">关闭监控</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px", color: "#334155" }}>
                <CameraIcon size={13} /> 自动录制
              </label>
              <select
                value={autoRecord ? "true" : "false"}
                onChange={(e) => setAutoRecord(e.target.value === "true")}
                disabled={isSaving || !isMonitoring}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "13px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  backgroundColor: isMonitoring ? "#ffffff" : "#f1f5f9",
                  color: isMonitoring ? "#1e293b" : "#94a3b8",
                  cursor: isMonitoring ? "pointer" : "not-allowed",
                  outline: "none",
                }}
              >
                <option value="true">开启录制</option>
                <option value="false">关闭录制</option>
              </select>
            </div>
          </div>

          <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "6px", margin: 0, display: "flex", alignItems: "center", gap: "4px" }}>
            <TipIcon size={12} style={{ color: "#94a3b8" }} /> 提示: 必须开启“自动监控”后，才能触发自动录制。
          </p>

          {/* 操作按钮 */}
          <div className="modal-actions" style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e2e8f0" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving} style={{ padding: "6px 12px", fontSize: "12.5px" }}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "6px 12px", fontSize: "12.5px" }}>
              {isSaving ? "保存中..." : <><CheckIcon size={13} /> 保存设置</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
