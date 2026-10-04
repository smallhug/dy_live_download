import { useState, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppConfig } from "../types";
import { FolderIcon, TimerIcon, LoadingIcon, CheckIcon, ChatIcon } from "../components/Icons";

interface SettingsPageProps {
  config: AppConfig | null;
  onSave: (data: {
    save_dir: string;
    ffmpeg_path: string;
    monitor_interval_secs: number;
    autostart: boolean;
    silent_start: boolean;
    close_to_tray: boolean;
    record_danmaku?: boolean;
    danmaku_format?: 'xml' | 'jsonl';
  }) => Promise<void>;
  showAlert: (message: string, title?: string, kind?: "info" | "error" | "warning") => Promise<boolean>;
}

export default function SettingsPage({ config, onSave, showAlert }: SettingsPageProps) {
  const [settingsSaveDir, setSettingsSaveDir] = useState("");
  const [settingsMonitorInterval, setSettingsMonitorInterval] = useState(60);
  const [autostart, setAutostart] = useState(false);
  const [silentStart, setSilentStart] = useState(false);
  const [closeToTray, setCloseToTray] = useState(false);
  const [recordDanmaku, setRecordDanmaku] = useState(true);
  const [danmakuFormat, setDanmakuFormat] = useState<'xml' | 'jsonl'>('xml');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    if (config?.global) {
      setSettingsSaveDir(config.global.save_dir);
      setSettingsMonitorInterval(config.global.monitor_interval_secs);
      setAutostart(!!config.global.autostart);
      setSilentStart(!!config.global.silent_start);
      setCloseToTray(!!config.global.close_to_tray);
      setRecordDanmaku(config.global.record_danmaku ?? true);
      setDanmakuFormat((config.global.danmaku_format as 'xml' | 'jsonl') || 'xml');
    }
  }, [config]);

  const handleBrowseSaveDir = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: settingsSaveDir || undefined,
      });
      if (selected && typeof selected === "string") {
        setSettingsSaveDir(selected);
      }
    } catch (err) {
      console.error("选择保存目录失败:", err);
    }
  };

  const handleAutostartChange = (checked: boolean) => {
    setAutostart(checked);
    if (!checked) {
      setSilentStart(false);
    }
  };

  const handleSaveSettingsPage = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      await onSave({
        save_dir: settingsSaveDir,
        ffmpeg_path: config?.global.ffmpeg_path ?? "",
        monitor_interval_secs: settingsMonitorInterval,
        autostart,
        silent_start: silentStart,
        close_to_tray: closeToTray,
        record_danmaku: recordDanmaku,
        danmaku_format: danmakuFormat,
      });
      await showAlert("设置保存成功并已立即生效！", "系统设置", "info");
    } catch (err) {
      await showAlert("保存设置失败: " + err, "系统设置", "error");
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="tab-page-content standard-tab-layout" style={{ padding: "8px 0" }}>
      <form onSubmit={handleSaveSettingsPage} className="settings-page-form" style={{ width: "100%", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: "20px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ flex: 1, paddingRight: "32px" }}>
            <h4 style={{ fontSize: "13.5px", fontWeight: "600", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
              <FolderIcon size={15} style={{ color: "#64748b" }} /> 默认视频保存目录
            </h4>
            <p style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "4px", margin: 0, lineHeight: "1.4" }}>
              所有新拉起的直播监控录制任务生成的视频文件将默认保存在此目录下。
            </p>
          </div>
          <div style={{ width: "400px", display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={settingsSaveDir}
              onChange={(e) => setSettingsSaveDir(e.target.value)}
              placeholder="例如: D:\LiveRecords"
              required
              style={{ flex: 1, fontSize: "13px", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            />
            <button
              type="button"
              onClick={handleBrowseSaveDir}
              className="btn btn-secondary"
              style={{ padding: "8px 12px", borderRadius: "6px", fontSize: "12.5px", whiteSpace: "nowrap" }}
            >
              选择目录
            </button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: "24px" }}>
          <div style={{ flex: 1, paddingRight: "32px" }}>
            <h4 style={{ fontSize: "13.5px", fontWeight: "600", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
              <TimerIcon size={15} style={{ color: "#64748b" }} /> 后台自动开播检测周期 (秒)
            </h4>
            <p style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "4px", margin: 0, lineHeight: "1.4" }}>
              后台监视器在轮询检测各大主播开播状态时的等待间隔。由于轮询时不带 Cookie，建议设为 45~90 秒以避免请求过频被暂时拉黑。
            </p>
          </div>
          <div style={{ width: "400px" }}>
            <input
              type="number"
              value={settingsMonitorInterval}
              onChange={(e) => setSettingsMonitorInterval(Math.max(10, Math.min(3600, parseInt(e.target.value) || 60)))}
              min={10}
              max={3600}
              required
              style={{ width: "100%", fontSize: "13px", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}>
          <h4 style={{ fontSize: "13.5px", fontWeight: "600", color: "#0f172a", margin: "0 0 4px 0" }}>
            系统运行行为
          </h4>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ flex: 1, paddingRight: "32px" }}>
              <label htmlFor="closeToTrayCheckbox" style={{ fontSize: "13px", fontWeight: "500", color: "#1e293b", cursor: "pointer" }}>
                点击窗口关闭按钮时最小化到系统托盘
              </label>
              <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", margin: 0, lineHeight: "1.4" }}>
                启用后，点击主窗口右上角的关闭 [X] 按钮程序不会退出，而是隐藏至系统托盘，并继续在后台执行录制或监控任务。
              </p>
            </div>
            <div>
              <input
                id="closeToTrayCheckbox"
                type="checkbox"
                checked={closeToTray}
                onChange={(e) => setCloseToTray(e.target.checked)}
                style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#2563eb" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ flex: 1, paddingRight: "32px" }}>
              <label htmlFor="autostartCheckbox" style={{ fontSize: "13px", fontWeight: "500", color: "#1e293b", cursor: "pointer" }}>
                开机自动启动
              </label>
              <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", margin: 0, lineHeight: "1.4" }}>
                启用后，本程序将在您开机进入 Windows 系统时自动运行。
              </p>
            </div>
            <div>
              <input
                id="autostartCheckbox"
                type="checkbox"
                checked={autostart}
                onChange={(e) => handleAutostartChange(e.target.checked)}
                style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#2563eb" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", opacity: autostart ? 1 : 0.5 }}>
            <div style={{ flex: 1, paddingRight: "32px" }}>
              <label htmlFor="silentStartCheckbox" style={{ fontSize: "13px", fontWeight: "500", color: autostart ? "#1e293b" : "#64748b", cursor: autostart ? "pointer" : "not-allowed" }}>
                自启动时隐藏主窗口 (静默启动)
              </label>
              <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", margin: 0, lineHeight: "1.4" }}>
                启用后，开机自动运行本程序时将不会弹出主窗口，仅在托盘区保留图标并静默工作。双击托盘图标可展开界面。(需先勾选开机自启动)
              </p>
            </div>
            <div>
              <input
                id="silentStartCheckbox"
                type="checkbox"
                checked={silentStart}
                disabled={!autostart}
                onChange={(e) => setSilentStart(e.target.checked)}
                style={{ width: "16px", height: "16px", cursor: autostart ? "pointer" : "not-allowed", accentColor: "#2563eb" }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}>
          <h4 style={{ fontSize: "13.5px", fontWeight: "600", color: "#0f172a", margin: "0 0 4px 0", display: "flex", alignItems: "center", gap: "6px" }}>
            <ChatIcon size={16} style={{ color: "#64748b" }} /> 默认弹幕与互动保存偏好
          </h4>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ flex: 1, paddingRight: "32px" }}>
              <label htmlFor="recordDanmakuCheckbox" style={{ fontSize: "13px", fontWeight: "500", color: "#1e293b", cursor: "pointer" }}>
                录制视频时默认同步录制弹幕与礼物
              </label>
              <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", margin: 0, lineHeight: "1.4" }}>
                启用后，开启录制时将同时捕获直播间的弹幕、礼物、醒目留言等消息并写入同名文件。
              </p>
            </div>
            <div>
              <input
                id="recordDanmakuCheckbox"
                type="checkbox"
                checked={recordDanmaku}
                onChange={(e) => setRecordDanmaku(e.target.checked)}
                style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#2563eb" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", opacity: recordDanmaku ? 1 : 0.5 }}>
            <div style={{ flex: 1, paddingRight: "32px" }}>
              <label htmlFor="danmakuFormatSelect" style={{ fontSize: "13px", fontWeight: "500", color: recordDanmaku ? "#1e293b" : "#64748b" }}>
                默认弹幕文件保存格式
              </label>
              <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px", margin: 0, lineHeight: "1.4" }}>
                XML 格式完美兼容各种播放器及 DanmakuFactory 渲染弹幕字幕；JSONL 格式保存完整的结构化事件流数据。
              </p>
            </div>
            <div style={{ width: "220px" }}>
              <select
                id="danmakuFormatSelect"
                value={danmakuFormat}
                disabled={!recordDanmaku}
                onChange={(e) => setDanmakuFormat(e.target.value as 'xml' | 'jsonl')}
                style={{
                  width: "100%",
                  fontSize: "13px",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: recordDanmaku ? "#ffffff" : "#f1f5f9",
                  color: recordDanmaku ? "#1e293b" : "#94a3b8",
                  cursor: recordDanmaku ? "pointer" : "not-allowed",
                  outline: "none"
                }}
              >
                <option value="xml">XML (播放器外挂弹幕)</option>
                <option value="jsonl">JSONL (结构化日志)</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "16px" }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSavingSettings}
            style={{ minWidth: "120px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
          >
            {isSavingSettings ? <><LoadingIcon size={14} /> 保存中...</> : <><CheckIcon size={14} /> 保存配置</>}
          </button>
        </div>
      </form>
    </div>
  );
}
