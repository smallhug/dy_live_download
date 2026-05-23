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
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      // 默认参数：默认不监控 (false)，默认标清画质，默认分段 30 分钟
      await onAdd(url, false, "标清", 30);
      setUrl("");
      onClose();
    } catch (err: any) {
      setError(err.toString() || "添加直播间失败，请检查链接格式或网络。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>添加录制主播任务</h2>
          <button className="close-btn" onClick={onClose} disabled={isLoading}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label>抖音直播间链接或数字 ID</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="例如: https://live.douyin.com/481017035403 或 481017035403"
              disabled={isLoading}
              required
            />
            <small className="form-tip">直接粘贴直播网页链接，或者输入纯数字的房间 ID，程序均可自动兼容解析。</small>
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
              {isLoading ? "正在请求并解析..." : "解析并添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
