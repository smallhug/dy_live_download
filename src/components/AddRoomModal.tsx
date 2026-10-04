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
    let cleanInput = url.trim();
    if (!cleanInput) return;

    let targetPlatform = platform;
    let targetId = cleanInput;

    // 智能识别：如果用户粘贴了完整的直播间 URL，自动提取数字 ID 及识别平台
    if (cleanInput.includes("douyin.com")) {
      targetPlatform = "douyin";
      setPlatform("douyin");
      // 兼容匹配: live.douyin.com/884280331889 或 douyin.com/root/live/884280331889
      const match = cleanInput.match(/(?:live|root\/live)\/(\d+)/);
      if (match) targetId = match[1];
    } else if (cleanInput.includes("bilibili.com")) {
      targetPlatform = "bilibili";
      setPlatform("bilibili");
      const match = cleanInput.match(/(?:live\.bilibili\.com\/|bilibili\.com\/live\/)(\d+)/);
      if (match) targetId = match[1];
    }

    // 若依然包含链接或非数字字符，尝试正则提取连续数字串
    if (!/^\d+$/.test(targetId)) {
      const match = targetId.match(/(\d{4,})/);
      if (match) {
        targetId = match[1];
      } else {
        setError("输入格式不正确，请提供直播间的纯数字 ID 或有效的直播间网页链接。");
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    try {
      // 默认参数：默认开启监控 (true)，默认原画画质，默认分段 30 分钟，传入所选平台
      await onAdd(targetId, true, "origin", 30, targetPlatform);
      setUrl("");
      onClose();
    } catch (err: any) {
      const errMsg = typeof err === "string" ? err : err?.message || JSON.stringify(err);
      setError(errMsg || "添加直播间失败，请确认数字 ID 是否正确及网络状态。");
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
