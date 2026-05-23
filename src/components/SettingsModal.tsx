import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { GlobalConfig } from "../types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: GlobalConfig;
  onSave: (config: GlobalConfig) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
}) => {
  const [saveDir, setSaveDir] = useState("");
  
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSaveDir(config.save_dir);
      
      // 检查是否已登录（通过 cookie 是否存在判断）
      setIsLoggedIn(!!config.cookie && config.cookie.length > 10);
      setIsSyncing(false);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  // 打开内置的抖音扫码窗口
  const handleOpenLoginWindow = async () => {
    try {
      await invoke("open_login_window", { currentUrl: window.location.href });
    } catch (err: any) {
      alert("打开扫码助手窗口失败: " + err.toString());
    }
  };

  // 提取并同步子窗口中的登录 Cookie
  const handleCaptureCookies = async () => {
    setIsSyncing(true);
    try {
      const capturedCookie = await invoke<string>("capture_login_cookies");

      // 更新配置中的 cookie（不展示给用户），监控频率固定为 60 秒
      await onSave({
        ffmpeg_path: config.ffmpeg_path,
        save_dir: saveDir,
        cookie: capturedCookie,
        user_agent: "", // 自动继承 WebView2 原生指纹
        sec_ch_ua: "",   // 自动继承 WebView2 原生指纹
        monitor_interval_secs: 60, // 固定 60 秒
      });

      // 提取成功后自动关闭子窗口
      const loginWin = await WebviewWindow.getByLabel("douyin-login");
      if (loginWin) {
        await loginWin.close();
      }

      setIsLoggedIn(true);
      alert("🎉 登录成功！Cookie 已自动保存。");
    } catch (err: any) {
      alert(err.toString());
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        ffmpeg_path: config.ffmpeg_path,
        save_dir: saveDir,
        cookie: config.cookie,
        user_agent: config.user_agent,
        sec_ch_ua: config.sec_ch_ua,
        monitor_interval_secs: 60, // 固定 60 秒
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
      <div className="modal-content glass-card" style={{ maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>全局配置设置</h2>
          <button className="close-btn" onClick={onClose} disabled={isSaving}>&times;</button>
        </div>

        <form onSubmit={handleSave} className="modal-form">
          {/* 登录区域 */}
          <div 
            className="form-group" 
            style={{ 
              background: isLoggedIn 
                ? "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)" 
                : "linear-gradient(135deg, #e0e7ff 0%, #f0fdf4 100%)", 
              padding: "18px", 
              borderRadius: "12px", 
              border: `1px solid ${isLoggedIn ? "#86efac" : "#c7d2fe"}`, 
              boxShadow: "0 4px 15px rgba(79, 70, 229, 0.08)" 
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <label style={{ color: isLoggedIn ? "#166534" : "#4f46e5", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", margin: 0 }}>
                <span>{isLoggedIn ? "✅" : "🔑"}</span> 
                {isLoggedIn ? "抖音账号已登录" : "抖音账号登录"}
              </label>
              {isLoggedIn && (
                <span style={{ fontSize: "11px", color: "#16a34a", background: "#bbf7d0", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
                  有效
                </span>
              )}
            </div>
            
            <p style={{ fontSize: "12px", color: isLoggedIn ? "#166534" : "#475569", marginTop: "0", marginBottom: "14px", lineHeight: "1.5" }}>
              {isLoggedIn 
                ? "账号已成功连接，可以正常使用监控和录制功能。如需重新登录，请点击下方按钮。"
                : "开启内置的安全扫码窗口，在里面扫码登录后即可开始使用。"
              }
            </p>
            
            <div style={{ display: "flex", gap: "10px" }}>
              <button 
                type="button" 
                className="btn btn-primary" 
                onClick={handleOpenLoginWindow}
                style={{ flex: 1, background: isLoggedIn ? "#6b7280" : "#4f46e5", fontSize: "12px", padding: "10px" }}
              >
                🌐 {isLoggedIn ? "重新登录" : "打开登录窗口"}
              </button>
              {!isLoggedIn && (
                <button 
                  type="button" 
                  className="btn btn-success" 
                  onClick={handleCaptureCookies}
                  disabled={isSyncing}
                  style={{ flex: 1, fontSize: "12px", padding: "10px" }}
                >
                  {isSyncing ? "⏳ 同步中..." : "🔄 同步登录状态"}
                </button>
              )}
            </div>
          </div>

          {/* 保存目录 */}
          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
              <span>📁</span> 视频保存目录
            </label>
            <input
              type="text"
              value={saveDir}
              onChange={(e) => setSaveDir(e.target.value)}
              placeholder="例如: D:\LiveRecords"
              required
              disabled={isSaving}
              style={{ fontSize: "13px" }}
            />
            <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "6px", margin: 0 }}>
              录制的视频文件将保存在此目录中
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="modal-actions" style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #e2e8f0" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "💾 保存中..." : "✅ 保存配置"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
