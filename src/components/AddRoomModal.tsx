import React, { useState } from "react";

interface AddRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    url: string,
    isMonitoring: boolean,
    preferredQuality: string,
    segmentDurationMins: number
  ) => Promise<void>;
}

export const AddRoomModal: React.FC<AddRoomModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = url.trim();
    if (!cleanId) return;

    if (!/^\d+$/.test(cleanId)) {
      setError("输入格式不正确，仅支持输入纯数字的直播间 ID，不支持输入链接。");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // 默认参数：默认开启监控 (true)，默认标清画质，默认分段 30 分钟
      await onAdd(cleanId, true, "标清", 30);
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

          <div className="form-group">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="输入直播间ID"
              disabled={isLoading}
              required
            />
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
