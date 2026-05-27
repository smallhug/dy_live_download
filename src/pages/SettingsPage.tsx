import { useState, useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppConfig } from "../types";
import { FolderIcon, TimerIcon, LoadingIcon, CheckIcon } from "../components/Icons";

interface SettingsPageProps {
  config: AppConfig | null;
  onSave: (data: { save_dir: string; ffmpeg_path: string; monitor_interval_secs: number }) => Promise<void>;
  showAlert: (message: string, title?: string, kind?: "info" | "error" | "warning") => Promise<boolean>;
}

export default function SettingsPage({ config, onSave, showAlert }: SettingsPageProps) {
  const [settingsSaveDir, setSettingsSaveDir] = useState("");
  const [settingsFFmpegPath, setSettingsFFmpegPath] = useState("");
  const [settingsMonitorInterval, setSettingsMonitorInterval] = useState(60);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    if (config?.global) {
      setSettingsSaveDir(config.global.save_dir);
      setSettingsFFmpegPath(config.global.ffmpeg_path);
      setSettingsMonitorInterval(config.global.monitor_interval_secs);
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

  const handleSaveSettingsPage = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      await onSave({
        save_dir: settingsSaveDir,
        ffmpeg_path: settingsFFmpegPath,
        monitor_interval_secs: settingsMonitorInterval,
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
              onChange={(e) => setSettingsMonitorInterval(parseInt(e.target.value) || 60)}
              min={10}
              max={3600}
              required
              style={{ width: "100%", fontSize: "13px", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            />
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
