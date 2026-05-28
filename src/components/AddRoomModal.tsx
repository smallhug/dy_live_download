import React, { useState } from "react";

interface AddRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    url: string,
    isMonitoring: boolean,
    preferredQuality: string,
    segmentDurationMins: number,
    platform?: string
  ) => Promise<void>;
}

export const AddRoomModal: React.FC<AddRoomModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState("douyin");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = url.trim();
    if (!cleanId) return;

    if (!/^\d+$/.test(cleanId)) {
      setError("输入格式不正确，仅支持输入直播间的纯数字 ID，不支持输入链接。");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // 默认参数：默认开启监控 (true)，默认原画画质，默认分段 30 分钟，传入所选平台
      await onAdd(cleanId, true, "origin", 30, platform);
      setUrl("");
      onClose();
    } catch (err: any) {
      setError(err.toString() || "添加直播间失败，请确认数字 ID 是否正确及网络状态。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>添加直播间</h2>
          <button className="close-btn" onClick={onClose} disabled={isLoading}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-row">
            <div className="form-group" style={{ width: "95px", flexShrink: 0 }}>
              <label>直播平台</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                disabled={isLoading}
                style={{ cursor: "pointer", paddingRight: "20px" }}
              >
                <option value="douyin">抖音</option>
                <option value="bilibili">B站</option>
              </select>
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label>直播间数字 ID</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder=""
                disabled={isLoading}
                required
              />
              <p style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "6px", marginBottom: 0, lineHeight: "1.4" }}>
                提示：直播间ID为网页地址中“.com/”和“?”之间的数字
              </p>
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={isLoading}>
              {isLoading ? "添加中..." : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
