import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppConfig, GlobalConfig, RoomConfig, RecordProgress, LiveRoomInfo, TelemetryPayload } from "./types";
import { AddRoomModal } from "./components/AddRoomModal";
import { RoomSettingsModal } from "./components/RoomSettingsModal";
import { DialogModal, DialogOptions } from "./components/DialogModal";
import { formatDateTime, formatSpeed } from "./utils";
import DashboardPage from "./pages/DashboardPage";
import CredentialsPage from "./pages/CredentialsPage";
import ConverterPage from "./pages/ConverterPage";
import SettingsPage from "./pages/SettingsPage";
import { 
  RefreshIcon, 
  SettingsIcon, 
  TvIcon, 
  PlusIcon,
  KeyIcon,
} from "./components/Icons";
import "./App.css";

const Clock: React.FC = () => {
  const [time, setTime] = useState(formatDateTime(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setTime(formatDateTime(new Date())), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{time}</>;
};

interface TelemetryBarProps {
  onlineCount: number;
  activeRecordCount: number;
}

const TelemetryBar: React.FC<TelemetryBarProps> = ({ onlineCount, activeRecordCount }) => {
  const [telemetry, setTelemetry] = useState<TelemetryPayload>({ cpu_usage: 0, net_recv: 0, net_sent: 0 });

  useEffect(() => {
    const unlistenTelemetryPromise = listen<TelemetryPayload>("telemetry", (event) => {
      setTelemetry(event.payload);
    });

    return () => {
      unlistenTelemetryPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <footer className="app-telemetry-bar">
      <div className="telemetry-left">
        <span className="telemetry-item">
          <span className="telemetry-label">在线主播:</span>
          <span className="telemetry-value">{onlineCount} 个</span>
        </span>
        <span className="telemetry-divider">|</span>
        <span className="telemetry-item">
          <span className="telemetry-label">录制通道:</span>
          <span className="telemetry-value active">{activeRecordCount} 路</span>
        </span>
      </div>

      <div className="telemetry-right">
        <span className="telemetry-item">
          <span className="telemetry-label">↓</span>
          <span className="telemetry-value speed">{formatSpeed(telemetry.net_recv)}</span>
        </span>
        <span className="telemetry-divider">|</span>
        <span className="telemetry-item">
          <span className="telemetry-label">↑</span>
          <span className="telemetry-value speed">{formatSpeed(telemetry.net_sent)}</span>
        </span>
        <span className="telemetry-divider">|</span>
        <span className="telemetry-item time-display">
          <Clock />
        </span>
      </div>
    </footer>
  );
};

function App() {
  // ── 核心框架状态 ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"dashboard" | "credentials" | "converter" | "settings">("dashboard");
  const [searchQuery, setSearchQuery] = useState("");

  // ── 系统设置与大盘原有状态 ──────────────────────────────────────────
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeTasks, setActiveTasks] = useState<string[]>([]);
  const configRef = useRef<AppConfig | null>(null);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const [progressMap, setProgressMap] = useState<Record<string, RecordProgress>>({});
  const [isAddRoomOpen, setIsAddRoomOpen] = useState(false);
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [selectedRoomForSettings, setSelectedRoomForSettings] = useState<RoomConfig | null>(null);

  // ── 自定义对话框状态 ──────────────────────────────────────────
  const [dialogState, setDialogState] = useState<(DialogOptions & { resolve: (v: boolean) => void }) | null>(null);

  const showDialog = useCallback((opts: DialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({ ...opts, resolve });
    });
  }, []);

  const alertAsync = useCallback((message: string, title?: string, kind?: "info" | "error" | "warning") => {
    return showDialog({ type: "alert", message, title, kind });
  }, [showDialog]);

  const confirmAsync = useCallback((message: string, title?: string) => {
    return showDialog({ type: "confirm", message, title });
  }, [showDialog]);
  const [roomStatuses, setRoomStatuses] = useState<Record<string, { is_live: boolean; title?: string }>>({});
  const [checkingRooms, setCheckingRooms] = useState<Record<string, boolean>>({});
  const [recordLoading, setRecordLoading] = useState<Record<string, "starting" | "stopping" | null>>({});

  // ── 获取全局配置 ──────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    try {
      const res = await invoke<AppConfig>("get_config");
      setConfig(res);
    } catch (err) {
      console.error("加载配置失败:", err);
    }
  }, []);

  // ── 获取正在录制的任务 ────────────────────────────────────────────
  const fetchActiveTasks = useCallback(async () => {
    try {
      const res = await invoke<string[]>("get_active_tasks");
      setActiveTasks(res);

      const titles = await invoke<Record<string, string>>("get_active_task_titles");
      setRoomStatuses((prev) => {
        const next = { ...prev };
        for (const [roomId, title] of Object.entries(titles)) {
          next[roomId] = {
            is_live: true,
            title: title || next[roomId]?.title || "",
          };
        }
        return next;
      });
    } catch (err) {
      console.error("获取录制列表或标题失败:", err);
    }
  }, []);

  // ── 初始化加载与事件监听 ────────────────────────────────────────────
  useEffect(() => {
    fetchConfig();
    fetchActiveTasks();

    // 监听 Rust 后端发送的进度通知
    const unlistenProgress = listen<RecordProgress>("record-progress", (event) => {
      const progress = event.payload;
      setProgressMap((prev) => ({
        ...prev,
        [progress.room_id]: progress,
      }));

      if (progress.status === "recording") {
        setActiveTasks((prev) => {
          if (!prev.includes(progress.room_id)) {
            return [...prev, progress.room_id];
          }
          return prev;
        });
        setRoomStatuses((prev) => {
          const current = prev[progress.room_id];
          return {
            ...prev,
            [progress.room_id]: { 
              is_live: true,
              title: progress.title || current?.title || ""
            },
          };
        });
      } else if (progress.status === "stopped" || progress.status === "error") {
        setActiveTasks((prev) => prev.filter((id) => id !== progress.room_id));
        setRoomStatuses((prev) => {
          const current = prev[progress.room_id];
          return {
            ...prev,
            [progress.room_id]: { 
              is_live: false,
              title: progress.title || current?.title || ""
            },
          };
        });

        if (progress.status === "error" && progress.error_msg) {
          const rooms = configRef.current?.rooms || [];
          const anchor = rooms.find((r) => r.room_id === progress.room_id)?.anchor_name || "未知主播";
          alertAsync(`主播【${anchor}】的录制任务异常中断！\n\n错误信息：\n${progress.error_msg}`, "录制异常中断", "error");
        }
      }
    });

    // 监听 Rust 后端发送的直播状态通知
    const unlistenRoomStatus = listen<{ room_id: string; is_live: boolean; title: string }>("room-status", (event) => {
      const payload = event.payload;
      setRoomStatuses((prev) => {
        const prevStatus = prev[payload.room_id];
        const nextTitle = payload.is_live ? payload.title : (prevStatus?.title || payload.title);
        return {
          ...prev,
          [payload.room_id]: { 
            is_live: payload.is_live, 
            title: nextTitle 
          },
        };
      });
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenRoomStatus.then((fn) => fn());
    };
  }, [fetchConfig, fetchActiveTasks, alertAsync]);

  // ── 添加直播间 ──────────────────────────────────────────────
  const handleAddRoom = useCallback(async (
    url: string,
    isMonitoring: boolean,
    preferredQuality: string,
    segmentDurationMins: number,
    platform: string = "douyin"
  ) => {
    await invoke("add_room", {
      url,
      isMonitoring,
      preferredQuality,
      segmentDurationMins,
      platform,
    });
    await fetchConfig();
  }, [fetchConfig]);

  // ── 删除直播间 ──────────────────────────────────────────────
  const handleDeleteRoom = useCallback(async (roomId: string) => {
    if (await confirmAsync("确定要删除该主播吗？如果正在录制，录制将强制停止。", "删除主播")) {
      try {
        await invoke("delete_room", { roomId });
        await fetchConfig();
        await fetchActiveTasks();
        setProgressMap((prev) => {
          const next = { ...prev };
          delete next[roomId];
          return next;
        });
      } catch (err) {
        alertAsync("删除主播失败: " + err, "错误", "error");
      }
    }
  }, [fetchConfig, fetchActiveTasks, confirmAsync, alertAsync]);

  // ── 更新直播间配置 ────────────────────────────────────────────
  const handleUpdateRoomConfig = useCallback(async (updatedRoom: RoomConfig) => {
    try {
      await invoke("update_room_config", { room: updatedRoom });
      await fetchConfig();
    } catch (err) {
      alertAsync("更新直播间配置失败: " + err, "错误", "error");
      throw err;
    }
  }, [fetchConfig, alertAsync]);

  // ── 手动检测开播状态 ────────────────────────────────────────────
  const handleCheckRoomStatus = useCallback(async (room: RoomConfig) => {
    setCheckingRooms((prev) => ({ ...prev, [room.room_id]: true }));
    try {
      const info = await invoke<LiveRoomInfo>("parse_room", { url: room.room_id, platform: room.platform });
      setRoomStatuses((prev) => {
        const prevStatus = prev[room.room_id];
        const nextTitle = info.is_live ? info.title : (prevStatus?.title || info.title);
        return {
          ...prev,
          [room.room_id]: { is_live: info.is_live, title: nextTitle },
        };
      });
      if (info.is_live && info.anchor_name && info.anchor_name !== "未知主播" && info.anchor_name !== room.anchor_name) {
        const updated = { ...room, anchor_name: info.anchor_name };
        await invoke("update_room_config", { room: updated });
        await fetchConfig();
      }
    } catch (err) {
      console.error("检测失败:", err);
    } finally {
      setCheckingRooms((prev) => ({ ...prev, [room.room_id]: false }));
    }
  }, [fetchConfig]);

  // ── 手动开始录制 ──────────────────────────────────────────────
  const handleStartRecord = useCallback(async (roomId: string) => {
    setRecordLoading((prev) => ({ ...prev, [roomId]: "starting" }));
    try {
      await invoke("start_record_task", { roomId });
      await fetchConfig();
    } catch (err: any) {
      const errorMsg = err?.message || err?.toString() || "未知错误";
      alertAsync(`录制启动失败！\n\n错误详情:\n${errorMsg}`, "启动录制失败", "error");
    } finally {
      setRecordLoading((prev) => ({ ...prev, [roomId]: null }));
    }
  }, [fetchConfig, alertAsync]);

  // ── 手动停止录制 ──────────────────────────────────────────────
  const handleStopRecord = useCallback(async (roomId: string) => {
    setRecordLoading((prev) => ({ ...prev, [roomId]: "stopping" }));
    try {
      await invoke("stop_record_task", { roomId });
      await fetchActiveTasks();
    } catch (err) {
      alertAsync("停止录制失败: " + err, "错误", "error");
    } finally {
      setRecordLoading((prev) => ({ ...prev, [roomId]: null }));
    }
  }, [fetchActiveTasks, alertAsync]);

  const handleSaveGlobalConfig = useCallback(async (patch: Partial<GlobalConfig>) => {
    const currentConfig = configRef.current;
    if (!currentConfig?.global) return;
    try {
      const fullConfig = {
        ffmpeg_path: currentConfig.global.ffmpeg_path,
        save_dir: currentConfig.global.save_dir,
        cookies: currentConfig.global.cookies,
        user_agent: currentConfig.global.user_agent,
        sec_ch_ua: currentConfig.global.sec_ch_ua,
        monitor_interval_secs: currentConfig.global.monitor_interval_secs,
        ...patch
      };
      await invoke("update_global_config", {
        ffmpegPath: fullConfig.ffmpeg_path,
        saveDir: fullConfig.save_dir,
        cookies: fullConfig.cookies,
        userAgent: fullConfig.user_agent,
        secChUa: fullConfig.sec_ch_ua,
        monitorIntervalSecs: fullConfig.monitor_interval_secs,
      });
      await fetchConfig();
    } catch (err) {
      alertAsync("更新全局配置失败: " + err, "错误", "error");
    }
  }, [fetchConfig, alertAsync]);

  // ── 过滤搜索主播卡片 ────────────────────────────────────────────
  const filteredRooms = useMemo(() => {
    return config?.rooms.filter(room => {
      const status = roomStatuses[room.room_id];
      const query = searchQuery.trim().toLowerCase();
      if (!query) return true;
      const nameMatch = room.anchor_name.toLowerCase().includes(query);
      const titleMatch = status?.title?.toLowerCase().includes(query) || false;
      const idMatch = room.room_id.includes(query);
      return nameMatch || titleMatch || idMatch;
    }) || [];
  }, [config?.rooms, roomStatuses, searchQuery]);

  return (
    <div className="app-layout">
      {/* 1. 左侧 72px Sidebar 占位包装层 */}
      <div className="app-sidebar-wrapper">
        <aside className="app-sidebar">
          <div className="sidebar-logo">
            <img src="/icon.png" alt="Logo" className="logo-indicator" />
          </div>
          <nav className="sidebar-nav">
            <button 
              className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
              title="录制面板"
            >
              <TvIcon size={22} />
            </button>
            
            <button 
              className={`nav-item ${activeTab === "credentials" ? "active" : ""}`}
              onClick={() => setActiveTab("credentials")}
              title="凭证中心"
            >
              <KeyIcon size={22} />
            </button>

            <button 
              className={`nav-item ${activeTab === "converter" ? "active" : ""}`}
              onClick={() => setActiveTab("converter")}
              title="格式转换"
            >
              <RefreshIcon size={22} />
            </button>

            <button 
              className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => setActiveTab("settings")}
              title="系统设置"
            >
              <SettingsIcon size={22} />
            </button>
          </nav>
        </aside>
      </div>

      {/* 右侧主版面 */}
      <div className="app-main-content">
        {/* 2. 仅在录制面板渲染顶部 Command Bar */}
        {activeTab === "dashboard" && (
          <header className="app-command-bar">
            <div className="bar-left">
              {/* 极简左侧留空 */}
            </div>
            
            <div className="bar-center">
              <input 
                type="text" 
                placeholder="搜索主播昵称、开播标题或房间 ID..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
            
            <div className="bar-right">
              {/* 移除了右上角的绿色圆形斑点 */}
              <button 
                className="btn btn-primary" 
                onClick={() => setIsAddRoomOpen(true)}
                title="添加录制主播"
                style={{ height: "32px", padding: "0 12px", gap: "4px", fontSize: "12px", borderRadius: "6px" }}
              >
                <PlusIcon size={13} />
                添加直播
              </button>
            </div>
          </header>
        )}

        {/* 3. 中间可滚动的主内容页面区 */}
        <main className="app-page-container">
          {activeTab === "dashboard" && (
            <DashboardPage
              config={config}
              filteredRooms={filteredRooms}
              activeTasks={activeTasks}
              progressMap={progressMap}
              roomStatuses={roomStatuses}
              checkingRooms={checkingRooms}
              recordLoading={recordLoading}
              onAddRoom={() => setIsAddRoomOpen(true)}
              onCheckStatus={handleCheckRoomStatus}
              onStartRecord={handleStartRecord}
              onStopRecord={handleStopRecord}
              onDeleteRoom={handleDeleteRoom}
              onOpenSettings={(room) => { setSelectedRoomForSettings(room); setIsRoomSettingsOpen(true); }}
            />
          )}

          {activeTab === "credentials" && (
            <CredentialsPage
              config={config}
              onSaveCookies={async (cookies) => { await handleSaveGlobalConfig({ cookies }); }}
              confirmAsync={confirmAsync}
              alertAsync={alertAsync}
            />
          )}

          {activeTab === "converter" && (
            <ConverterPage config={config} />
          )}

          {activeTab === "settings" && (
            <SettingsPage
              config={config}
              onSave={async ({ save_dir, ffmpeg_path, monitor_interval_secs }) => {
                await handleSaveGlobalConfig({ save_dir, ffmpeg_path, monitor_interval_secs });
              }}
              showAlert={alertAsync}
            />
          )}
        </main>

        {/* 4. 底部 Telemetry Status Bar */}
        <TelemetryBar 
          onlineCount={config?.rooms.filter(r => roomStatuses[r.room_id]?.is_live).length || 0}
          activeRecordCount={activeTasks.length}
        />
      </div>

      {/* 5. 原有的主播与卡片设置弹出 modal 层（依然维持高阶 Modal 的精致弹出） */}
      {isAddRoomOpen && (
        <AddRoomModal
          isOpen={isAddRoomOpen}
          onClose={() => setIsAddRoomOpen(false)}
          onAdd={handleAddRoom}
        />
      )}

      {isRoomSettingsOpen && selectedRoomForSettings && (
        <RoomSettingsModal
          isOpen={isRoomSettingsOpen}
          room={selectedRoomForSettings}
          onClose={() => {
            setIsRoomSettingsOpen(false);
            setSelectedRoomForSettings(null);
          }}
          onSave={handleUpdateRoomConfig}
        />
      )}

      {/* 通用自定义对话框 */}
      {dialogState && (
        <DialogModal
          isOpen={!!dialogState}
          type={dialogState.type}
          title={dialogState.title}
          message={dialogState.message}
          kind={dialogState.kind}
          confirmText={dialogState.confirmText}
          cancelText={dialogState.cancelText}
          onConfirm={() => { dialogState.resolve(true); setDialogState(null); }}
          onCancel={() => { dialogState.resolve(false); setDialogState(null); }}
        />
      )}
    </div>
  );
}

export default App;
