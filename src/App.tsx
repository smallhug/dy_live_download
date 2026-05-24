import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppConfig, RoomConfig, RecordProgress, LiveRoomInfo, TelemetryPayload, CookieItem } from "./types";
import { RoomCard } from "./components/RoomCard";
import { AddRoomModal } from "./components/AddRoomModal";
import { RoomSettingsModal } from "./components/RoomSettingsModal";
import { DialogModal, DialogOptions } from "./components/DialogModal";
import { 
  RefreshIcon, 
  SettingsIcon, 
  TrashIcon, 
  TvIcon, 
  TimerIcon, 
  LoadingIcon, 
  PlusIcon,
  GlobeIcon,
  KeyIcon,
  FolderIcon,
  CheckIcon,
  FileIcon,
  SaveIcon
} from "./components/Icons";
import "./App.css";

// ── 支持的视频转换格式 ──────────────────────────────────────────
const OUTPUT_FORMATS = [
  { ext: "mp4", label: "MP4（H.264 / 通用）" },
  { ext: "mkv", label: "MKV（万能容器）" },
  { ext: "flv", label: "FLV（推流存档）" },
  { ext: "ts",  label: "TS（传输流）" },
  { ext: "mov", label: "MOV（苹果 QuickTime）" },
  { ext: "avi", label: "AVI（经典格式）" },
];

// ── 登录流程步骤指示组件 ──────────────────────────────────────
const LoginStep: React.FC<{ step: number; label: string; state: "pending" | "active" | "done" }> = ({ step, label, state }) => {
  const colors = {
    pending: { bg: "#f1f5f9", border: "#e2e8f0", text: "#94a3b8", dot: "#cbd5e1" },
    active:  { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb", dot: "#2563eb" },
    done:    { bg: "#f0fdf4", border: "#bbf7d0", text: "#16a34a", dot: "#16a34a" },
  }[state];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12.5px" }}>
      <div style={{
        width: "20px", height: "20px", borderRadius: "50%",
        background: colors.bg, border: `1.5px solid ${colors.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "10px", fontWeight: "700", color: colors.text, flexShrink: 0,
      }}>
        {state === "done" ? <CheckIcon size={12} style={{ color: colors.text }} /> : step}
      </div>
      <span style={{ color: colors.text, fontWeight: state === "active" ? "600" : "400" }}>{label}</span>
      {state === "active" && <LoadingIcon size={13} style={{ color: colors.text }} />}
    </div>
  );
};

interface ConvertTask {
  taskId: string;
  inputPath: string;
  outputPath: string;
  progress: {
    task_id: string;
    status: "running" | "done" | "error";
    percent: number;
    time: string;
    speed: string;
    error_msg?: string;
    output_path: string;
  } | null;
}

function guessOutputPath(inputPath: string, ext: string, saveDir: string): string {
  if (!inputPath.trim()) return "";
  const sep = inputPath.includes("\\") ? "\\" : "/";
  const parts = inputPath.split(sep);
  const filename = parts[parts.length - 1];
  const basename = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  const dir = saveDir.trim() || parts.slice(0, -1).join(sep);
  const dirSep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${dirSep}${basename}_converted.${ext}`;
}

function genTaskId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function App() {
  // ── 核心框架状态 ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"dashboard" | "credentials" | "converter" | "settings">("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentTime, setCurrentTime] = useState("");
  const [telemetry, setTelemetry] = useState<TelemetryPayload>({ cpu_usage: 0.0, net_recv: 0, net_sent: 0 });

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

  const showDialog = (opts: DialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({ ...opts, resolve });
    });
  };

  const alertAsync = (message: string, title?: string, kind?: "info" | "error" | "warning") => {
    return showDialog({ type: "alert", message, title, kind });
  };

  const confirmAsync = (message: string, title?: string) => {
    return showDialog({ type: "confirm", message, title });
  };
  const [roomStatuses, setRoomStatuses] = useState<Record<string, { is_live: boolean; title?: string }>>({});
  const [checkingRooms, setCheckingRooms] = useState<Record<string, boolean>>({});
  const [recordLoading, setRecordLoading] = useState<Record<string, "starting" | "stopping" | null>>({});

  // ── 凭证管理页面状态 ────────────────────────────────────────────
  type LoginFlowState = "idle" | "opening" | "waiting_login" | "capturing" | "done" | "error";
  const [loginFlow, setLoginFlow] = useState<LoginFlowState>("idle");
  const [loginFlowMsg, setLoginFlowMsg] = useState("");
  const [loginPollTimer, setLoginPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualNickname, setManualNickname] = useState("");
  const [manualCookieValue, setManualCookieValue] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [pendingCookie, setPendingCookie] = useState<string | null>(null);
  const [pendingNickname, setPendingNickname] = useState("");

  // ── 格式转换页面状态 ────────────────────────────────────────────
  const [convertInputPath, setConvertInputPath] = useState("");
  const [convertOutputExt, setConvertOutputExt] = useState("mp4");
  const [convertOutputPath, setConvertOutputPath] = useState("");
  const [convertTasks, setConvertTasks] = useState<ConvertTask[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  // ── 全局设置表单临时状态 ──────────────────────────────────────────
  const [settingsSaveDir, setSettingsSaveDir] = useState("");
  const [settingsFFmpegPath, setSettingsFFmpegPath] = useState("");
  const [settingsMonitorInterval, setSettingsMonitorInterval] = useState(60);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // ── 系统时间定时器 ─────────────────────────────────────────────
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── 获取全局配置 ──────────────────────────────────────────────
  const fetchConfig = async () => {
    try {
      const res = await invoke<AppConfig>("get_config");
      setConfig(res);
      if (res && res.global) {
        setSettingsSaveDir(res.global.save_dir);
        setSettingsFFmpegPath(res.global.ffmpeg_path);
        setSettingsMonitorInterval(res.global.monitor_interval_secs);
      }
    } catch (err) {
      console.error("加载配置失败:", err);
    }
  };

  // ── 获取正在录制的任务 ────────────────────────────────────────────
  const fetchActiveTasks = async () => {
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
  };

  // ── 初始化加载与事件监听 ────────────────────────────────────────────
  useEffect(() => {
    fetchConfig();
    fetchActiveTasks();

    // 监听 Rust 遙测包广播
    const unlistenTelemetry = listen<TelemetryPayload>("telemetry", (event) => {
      setTelemetry(event.payload);
    });

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

    // 监听格式转换事件推送
    const unlistenConvert = listen<any>("convert-progress", (event) => {
      const p = event.payload;
      setConvertTasks((prev) =>
        prev.map((t) =>
          t.taskId === p.task_id ? { ...t, progress: p } : t
        )
      );
    });

    return () => {
      unlistenTelemetry.then((fn) => fn());
      unlistenProgress.then((fn) => fn());
      unlistenRoomStatus.then((fn) => fn());
      unlistenConvert.then((fn) => fn());
    };
  }, []);

  // ── 格式转换自动更新路径 ──────────────────────────────────────────
  useEffect(() => {
    if (config?.global) {
      setConvertOutputPath(guessOutputPath(convertInputPath, convertOutputExt, config.global.save_dir));
    }
  }, [convertInputPath, convertOutputExt, config]);

  // ── 添加直播间 ──────────────────────────────────────────────
  const handleAddRoom = async (
    url: string,
    isMonitoring: boolean,
    preferredQuality: string,
    segmentDurationMins: number
  ) => {
    await invoke("add_room", {
      url,
      isMonitoring,
      preferredQuality,
      segmentDurationMins,
    });
    await fetchConfig();
  };

  // ── 删除直播间 ──────────────────────────────────────────────
  const handleDeleteRoom = async (roomId: string) => {
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
  };

  // ── 更新直播间配置 ────────────────────────────────────────────
  const handleUpdateRoomConfig = async (updatedRoom: RoomConfig) => {
    try {
      await invoke("update_room_config", { room: updatedRoom });
      await fetchConfig();
    } catch (err) {
      alertAsync("更新直播间配置失败: " + err, "错误", "error");
      throw err;
    }
  };

  // ── 手动检测开播状态 ────────────────────────────────────────────
  const handleCheckRoomStatus = async (room: RoomConfig) => {
    setCheckingRooms((prev) => ({ ...prev, [room.room_id]: true }));
    try {
      const info = await invoke<LiveRoomInfo>("parse_room", { url: room.room_id });
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
  };

  // ── 手动开始录制 ──────────────────────────────────────────────
  const handleStartRecord = async (roomId: string) => {
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
  };

  // ── 手动停止录制 ──────────────────────────────────────────────
  const handleStopRecord = async (roomId: string) => {
    setRecordLoading((prev) => ({ ...prev, [roomId]: "stopping" }));
    try {
      await invoke("stop_record_task", { roomId });
      fetchActiveTasks();
    } catch (err) {
      alertAsync("停止录制失败: " + err, "错误", "error");
    } finally {
      setRecordLoading((prev) => ({ ...prev, [roomId]: null }));
    }
  };

  // ── 凭证管理：扫码登录流程 ────────────────────────────────────────
  const startLoginFlow = async () => {
    setLoginFlow("opening");
    setLoginFlowMsg("正在打开登录窗口...");
    try {
      await invoke("open_login_window", { currentUrl: window.location.href });
      setLoginFlow("waiting_login");
      setLoginFlowMsg("请在弹出的窗口中扫码登录");

      const timer = setInterval(async () => {
        try {
          const loggedIn = await invoke<boolean>("check_login_status");
          if (loggedIn) {
            clearInterval(timer);
            setLoginPollTimer(null);
            await finishLoginFlow();
          }
        } catch {
        }
      }, 2000);
      setLoginPollTimer(timer);
    } catch (err: any) {
      setLoginFlow("error");
      setLoginFlowMsg("打开登录窗口失败: " + err.toString());
    }
  };

  const cancelLoginFlow = async () => {
    if (loginPollTimer) {
      clearInterval(loginPollTimer);
      setLoginPollTimer(null);
    }
    try {
      const loginWin = await WebviewWindow.getByLabel("douyin-login");
      if (loginWin) await loginWin.close();
    } catch {}
    setLoginFlow("idle");
    setLoginFlowMsg("");
  };

  const finishLoginFlow = async () => {
    setLoginFlow("capturing");
    setLoginFlowMsg("已检测到登录，正在获取凭证...");
    try {
      const capturedCookie = await invoke<string>("capture_login_cookies");
      const currentCookies = config?.global.cookies || [];

      if (currentCookies.some(c => c.value === capturedCookie)) {
        setLoginFlow("done");
        setLoginFlowMsg("该账号已在列表中，无需重复添加");
        setTimeout(() => { setLoginFlow("idle"); setLoginFlowMsg(""); }, 2500);
        return;
      }

      setPendingCookie(capturedCookie);
      setPendingNickname("");
      setShowNicknameModal(true);
      setLoginFlow("idle");
      setLoginFlowMsg("");
    } catch (err: any) {
      setLoginFlow("error");
      setLoginFlowMsg(err.toString());
    }
  };

  const handleConfirmNickname = async () => {
    const nickname = pendingNickname.trim();
    if (!nickname || !pendingCookie) return;

    try {
      const loginWin = await WebviewWindow.getByLabel("douyin-login");
      if (loginWin) await loginWin.close();
    } catch {}

    const now = new Date();
    const acquiredAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const newCookie: CookieItem = {
      id: Date.now().toString(),
      nickname,
      value: pendingCookie,
      acquired_at: acquiredAt,
      use_count: 0,
    };

    const currentCookies = config?.global.cookies || [];
    await handleSaveGlobalConfig({ cookies: [...currentCookies, newCookie] });
    setShowNicknameModal(false);
    setPendingCookie(null);
    setPendingNickname("");
  };

  const handleAddManualCookie = async () => {
    setManualError(null);
    const nickname = manualNickname.trim();
    const value = manualCookieValue.trim();

    if (!nickname) { setManualError("账号昵称/备注不能为空"); return; }
    if (!value) { setManualError("Cookie 内容不能为空"); return; }

    if (!value.includes("sessionid") && !value.includes("passport_csrf_token")) {
      if (!await confirmAsync("警告：输入的 Cookie 缺少核心的 sessionid，可能无法正常拉流或添加主播。确定要强制添加吗？", "Cookie 缺失警告")) {
        return;
      }
    }

    const currentCookies = config?.global.cookies || [];
    if (currentCookies.some(c => c.value === value)) {
      setManualError("该 Cookie 内容已存在于列表中");
      return;
    }

    const now = new Date();
    const acquiredAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const newCookie: CookieItem = {
      id: Date.now().toString(),
      nickname,
      value,
      acquired_at: acquiredAt,
      use_count: 0,
    };

    await handleSaveGlobalConfig({ cookies: [...currentCookies, newCookie] });
    setManualNickname("");
    setManualCookieValue("");
    setShowManualInput(false);
  };

  const handleDeleteCookie = async (id: string, name: string) => {
    if (await confirmAsync(`确定要删除账号 [${name}] 的 Cookie 吗？`, "删除凭证")) {
      const currentCookies = config?.global.cookies || [];
      await handleSaveGlobalConfig({ cookies: currentCookies.filter(c => c.id !== id) });
    }
  };

  const handleSaveGlobalConfig = async (patch: Partial<any>) => {
    if (!config?.global) return;
    try {
      const fullConfig = {
        ffmpeg_path: config.global.ffmpeg_path,
        save_dir: config.global.save_dir,
        cookies: config.global.cookies,
        user_agent: config.global.user_agent,
        sec_ch_ua: config.global.sec_ch_ua,
        monitor_interval_secs: config.global.monitor_interval_secs,
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
  };

  // ── 格式转换页面事件处理 ──────────────────────────────────────────
  const handleBrowseConvertInput = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "视频文件", extensions: ["mp4", "mkv", "flv", "ts", "mov", "avi", "m4v", "wmv", "rmvb", "webm"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (selected && typeof selected === "string") {
      setConvertInputPath(selected);
    }
  };

  const handleBrowseConvertOutput = async () => {
    if (!config?.global) return;
    const suggested = convertOutputPath || guessOutputPath(convertInputPath, convertOutputExt, config.global.save_dir);
    const suggestedName = suggested.split(/[\\/]/).pop() || `output.${convertOutputExt}`;
    const result = await saveDialog({
      defaultPath: suggestedName,
      filters: [
        { name: convertOutputExt.toUpperCase(), extensions: [convertOutputExt] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (result) {
      setConvertOutputPath(result);
    }
  };

  const handleStartConvert = async () => {
    if (!convertInputPath.trim()) { alertAsync("请选择源视频文件", "提示", "warning"); return; }
    if (!convertOutputPath.trim()) { alertAsync("请设置输出路径", "提示", "warning"); return; }
    if (!config?.global) return;

    const taskId = genTaskId();
    const newTask: ConvertTask = {
      taskId,
      inputPath: convertInputPath,
      outputPath: convertOutputPath,
      progress: { task_id: taskId, status: "running", percent: 0, time: "00:00:00", speed: "--", output_path: convertOutputPath },
    };
    setConvertTasks((prev) => [newTask, ...prev]);

    try {
      setIsConverting(true);
      await invoke("convert_video", {
        taskId,
        inputPath: convertInputPath,
        outputPath: convertOutputPath,
        ffmpegPath: config.global.ffmpeg_path,
      });
    } catch (err: any) {
      setConvertTasks((prev) =>
        prev.map((t) =>
          t.taskId === taskId
            ? { ...t, progress: { ...t.progress!, status: "error", error_msg: err.toString() } }
            : t
        )
      );
    } finally {
      setIsConverting(false);
    }
  };

  const handleClearConvertDone = () => {
    setConvertTasks((prev) => prev.filter((t) => t.progress?.status === "running"));
  };

  // ── 全局配置保存 ──────────────────────────────────────────────
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
      await handleSaveGlobalConfig({
        save_dir: settingsSaveDir,
        ffmpeg_path: settingsFFmpegPath,
        monitor_interval_secs: settingsMonitorInterval,
      });
      await alertAsync("设置保存成功并已立即生效！", "系统设置", "info");
    } catch (err) {
      await alertAsync("保存设置失败: " + err, "系统设置", "error");
    } finally {
      setIsSavingSettings(false);
    }
  };

  // ── 格式化网速单位 ──────────────────────────────────────────────
  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  // ── 过滤搜索主播卡片 ────────────────────────────────────────────
  const filteredRooms = config?.rooms.filter(room => {
    const status = roomStatuses[room.room_id];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const nameMatch = room.anchor_name.toLowerCase().includes(query);
    const titleMatch = status?.title?.toLowerCase().includes(query) || false;
    const idMatch = room.room_id.includes(query);
    return nameMatch || titleMatch || idMatch;
  }) || [];

  return (
    <div className="app-layout">
      {/* 1. 左侧 72px Sidebar 占位包装层 */}
      <div className="app-sidebar-wrapper">
        <aside className="app-sidebar">
          <div className="sidebar-logo">
            <div className="logo-indicator"></div>
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
                添加主播
              </button>
            </div>
          </header>
        )}

        {/* 3. 中间可滚动的主内容页面区 */}
        <main className="app-page-container">
          {/* TAB 1: 录制面板 */}
          {activeTab === "dashboard" && (
            <div className="tab-page-content" style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              {!config || !config.rooms || config.rooms.length === 0 ? (
                <div className="empty-state glass-card" style={{ margin: "auto" }}>
                  <div className="empty-icon"><TvIcon size={48} style={{ color: "#94a3b8" }} /></div>
                  <h3>任务列表空空如也</h3>
                  <p>点击顶部的 “添加主播” 按钮，输入抖音直播间数字 ID 开始实时监控吧！</p>
                  <button className="btn btn-primary" onClick={() => setIsAddRoomOpen(true)}>
                    立即添加
                  </button>
                </div>
              ) : (
                <div className="room-grid">
                  {filteredRooms.map((room) => {
                    const isRecording = activeTasks.includes(room.room_id);
                    const progress = progressMap[room.room_id];
                    const status = roomStatuses[room.room_id];
                    const isChecking = checkingRooms[room.room_id];
                    return (
                      <RoomCard
                        key={room.room_id}
                        room={room}
                        isLive={status?.is_live || false}
                        title={status?.title || ""}
                        isChecking={isChecking}
                        isRecording={isRecording}
                        recordProgress={progress}
                        recordLoading={recordLoading[room.room_id] || null}
                        onCheckStatus={() => handleCheckRoomStatus(room)}
                        onStartRecord={() => handleStartRecord(room.room_id)}
                        onStopRecord={() => handleStopRecord(room.room_id)}
                        onDelete={() => handleDeleteRoom(room.room_id)}
                        onSettings={() => {
                          setSelectedRoomForSettings(room);
                          setIsRoomSettingsOpen(true);
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: 凭证管理中心 */}
          {activeTab === "credentials" && (
            <div className="tab-page-content standard-tab-layout">
              {/* 扫码登录引导区 */}
              <div className="glass-card" style={{ padding: "20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: loginFlow !== "idle" ? "16px" : "0" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <KeyIcon size={18} style={{ color: "#fff" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a" }}>扫码登录获取凭证</div>
                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>自动打开抖音登录页面，扫码后自动捕获 Cookie</div>
                  </div>
                  {loginFlow === "idle" && (
                    <button className="btn btn-primary btn-sm" onClick={startLoginFlow}>
                      <GlobeIcon size={14} /> 开始登录
                    </button>
                  )}
                  {loginFlow !== "idle" && loginFlow !== "done" && loginFlow !== "error" && (
                    <button className="btn btn-secondary btn-sm" onClick={cancelLoginFlow}>
                      取消
                    </button>
                  )}
                </div>

                {/* 登录流程步骤指示 */}
                {loginFlow !== "idle" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingLeft: "46px" }}>
                    <LoginStep step={1} label="打开登录窗口" state={loginFlow === "opening" ? "active" : loginFlow === "waiting_login" || loginFlow === "capturing" || loginFlow === "done" ? "done" : "pending"} />
                    <LoginStep step={2} label="扫码登录中..." state={loginFlow === "waiting_login" ? "active" : loginFlow === "capturing" || loginFlow === "done" ? "done" : "pending"} />
                    <LoginStep step={3} label="获取凭证" state={loginFlow === "capturing" ? "active" : loginFlow === "done" ? "done" : "pending"} />
                    {loginFlowMsg && (
                      <div style={{ fontSize: "12px", color: loginFlow === "error" ? "#ef4444" : loginFlow === "done" ? "#10b981" : "#64748b", marginTop: "4px" }}>
                        {loginFlowMsg}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 操作栏 */}
              <div className="page-section-header" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: "12px", justifyContent: "flex-end" }}>
                <div className="action-buttons" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <button 
                    type="button" 
                    className="icon-btn" 
                    onClick={() => setShowManualInput(!showManualInput)}
                    title="手动导入凭证"
                    style={{ width: "34px", height: "34px", borderRadius: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <PlusIcon size={18} />
                  </button>
                </div>
              </div>

              {/* 手动导入抽屉区域 */}
              {showManualInput && (
                <div className="manual-import-box glass-card">
                  <h4>手动导入 Cookie 凭证</h4>
                  {manualError && <div className="form-error">{manualError}</div>}
                  <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: "11px", fontWeight: "600", color: "#64748b", marginBottom: "4px", display: "block" }}>账号备注或昵称</label>
                      <input 
                        type="text" 
                        placeholder="例如: 抖音主号1" 
                        value={manualNickname}
                        onChange={(e) => setManualNickname(e.target.value)}
                        style={{ fontSize: "12px", padding: "8px 10px", width: "100%", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                      />
                    </div>
                  </div>
                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#64748b", marginBottom: "4px", display: "block" }}>Cookie 字符串值</label>
                    <textarea 
                      placeholder="直接复制粘贴抓取到的完整的 Cookie 字段值" 
                      value={manualCookieValue}
                      onChange={(e) => setManualCookieValue(e.target.value)}
                      rows={3}
                      style={{ fontSize: "11px", padding: "8px 10px", width: "100%", borderRadius: "6px", border: "1px solid #cbd5e1", resize: "vertical", fontFamily: "monospace" }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button 
                      type="button" 
                      onClick={() => setShowManualInput(false)}
                      className="btn btn-secondary btn-sm"
                    >
                      取消
                    </button>
                    <button 
                      type="button" 
                      onClick={handleAddManualCookie}
                      className="btn btn-primary btn-sm"
                    >
                      确认导入
                    </button>
                  </div>
                </div>
              )}

              {/* Cookie 列表 */}
              {!config || !config.global.cookies || config.global.cookies.length === 0 ? (
                <div className="no-data-hint">
                  当前尚未添加任何抖音账号凭证。未登录凭证运行，自动监控检测和录制可能会触发抖音防爬滑块验证。
                </div>
              ) : (
                <div className="table-wrapper glass-card">
                  <table className="settings-table">
                    <thead>
                      <tr>
                        <th>昵称</th>
                        <th>Cookie 散列</th>
                        <th>获取时间</th>
                        <th style={{ textAlign: "center" }}>已拉流计数</th>
                        <th style={{ textAlign: "center", width: "80px" }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {config.global.cookies.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: "600", color: "#0f172a" }}>{c.nickname}</td>
                          <td style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: "11px" }}>
                            {c.value.length > 30 ? c.value.slice(0, 30) + "..." : c.value}
                          </td>
                          <td style={{ color: "#64748b" }}>{c.acquired_at}</td>
                          <td style={{ textAlign: "center", fontWeight: "500", color: "#4f46e5" }}>{c.use_count} 次</td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              className="btn-text-danger"
                              onClick={() => handleDeleteCookie(c.id, c.nickname)}
                              title="删除此凭证"
                            >
                              <TrashIcon size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: 格式转换工具箱 */}
          {activeTab === "converter" && (
            <div className="tab-page-content" style={{ display: "flex", flexDirection: "row", gap: "32px", flex: 1, overflow: "hidden", padding: "8px 0" }}>
              {/* 左侧分栏：控制配置面板 */}
              <div style={{ width: "400px", display: "flex", flexDirection: "column", gap: "16px", flexShrink: 0 }}>
                <div style={{ paddingBottom: "12px", borderBottom: "1px solid #e2e8f0" }}>
                  <h4 style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a" }}>无损封装转换</h4>
                  <p style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0 0", lineHeight: "1.4" }}>
                    调用 FFmpeg 无损提取视频和音频流重新打包，不经过重编码，保留最高原始画质且速度极快。
                  </p>
                </div>

                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px" }}>
                    <FileIcon size={14} /> 源视频文件路径
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input 
                      type="text" 
                      placeholder="请选择源视频文件..." 
                      value={convertInputPath}
                      onChange={(e) => setConvertInputPath(e.target.value)}
                      style={{ flex: 1, fontSize: "13px", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                    />
                    <button type="button" className="btn btn-secondary" onClick={handleBrowseConvertInput} style={{ width: "36px", height: "36px", padding: 0 }} title="选择源视频">
                      <FolderIcon size={15} />
                    </button>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: "8px" }}>
                  <label style={{ marginBottom: "6px", display: "block", fontWeight: "600", fontSize: "12.5px" }}>目标封装格式</label>
                  <select 
                    value={convertOutputExt} 
                    onChange={(e) => setConvertOutputExt(e.target.value)}
                    style={{ width: "100%", height: "36px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", padding: "0 8px", backgroundColor: "#ffffff" }}
                  >
                    {OUTPUT_FORMATS.map(f => (
                      <option key={f.ext} value={f.ext}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: "16px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px" }}>
                    <SaveIcon size={14} /> 目标输出文件路径
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input 
                      type="text" 
                      placeholder="请输入或浏览选择输出的文件名..." 
                      value={convertOutputPath}
                      onChange={(e) => setConvertOutputPath(e.target.value)}
                      style={{ flex: 1, fontSize: "13px", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                    />
                    <button type="button" className="btn btn-secondary" onClick={handleBrowseConvertOutput} style={{ width: "36px", height: "36px", padding: 0 }} title="自定义输出路径">
                      <FolderIcon size={15} />
                    </button>
                  </div>
                </div>

                <div>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={handleStartConvert}
                    disabled={isConverting}
                    style={{ width: "100%", height: "36px", fontSize: "13px" }}
                  >
                    {isConverting ? <><LoadingIcon size={14} /> 处理中...</> : <><RefreshIcon size={14} /> 启动无损封装</>}
                  </button>
                </div>
              </div>

              {/* 右侧分栏：任务进度队列 */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #e2e8f0", height: "45px" }}>
                  <h4 style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a" }}>任务队列 ({convertTasks.length})</h4>
                  {convertTasks.some((t) => t.progress?.status !== "running") && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleClearConvertDone} style={{ height: "28px", padding: "0 10px", fontSize: "11.5px" }}>
                      清除已结束
                    </button>
                  )}
                </div>

                <div style={{ flex: 1, overflowY: "auto", paddingRight: "4px" }}>
                  {convertTasks.length === 0 ? (
                    <div className="no-data-hint" style={{ padding: "40px 20px" }}>
                      暂无转换任务。请在左侧设定文件路径以启动封装转换。
                    </div>
                  ) : (
                    <div className="convert-tasks-container">
                      {convertTasks.map((t) => (
                        <div className="convert-task-item glass-card" key={t.taskId} style={{ padding: "14px", marginBottom: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: "600", fontSize: "13px", color: "#334155" }}>
                              任务: {t.inputPath.split(/[\\/]/).pop()}
                            </span>
                            <span className={`status-badge ${t.progress?.status}`}>
                              {t.progress?.status === "running" ? "处理中" : t.progress?.status === "done" ? "成功" : "出错"}
                            </span>
                          </div>
                          
                          <div className="progress-bar-container" style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden", margin: "4px 0" }}>
                            <div 
                              className="progress-bar-fill" 
                              style={{ 
                                width: `${t.progress?.percent || 0}%`, 
                                height: "100%", 
                                background: t.progress?.status === "error" ? "#ef4444" : "#4f46e5",
                                transition: "width 0.2s ease" 
                              }}
                            />
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b" }}>
                            <span>进度: {t.progress?.percent.toFixed(1)}% | 耗时: {t.progress?.time} | 速度: {t.progress?.speed}</span>
                            <span style={{ textOverflow: "ellipsis", maxWidth: "60%", overflow: "hidden", whiteSpace: "nowrap" }}>
                              输出: {t.outputPath.split(/[\\/]/).pop()}
                            </span>
                          </div>
                          {t.progress?.status === "error" && t.progress.error_msg && (
                            <div style={{ fontSize: "11px", color: "#ef4444", background: "#fef2f2", padding: "6px", borderRadius: "4px", border: "1px solid #fee2e2", marginTop: "4px" }}>
                              错误: {t.progress.error_msg}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: 全局设置 */}
          {activeTab === "settings" && (
            <div className="tab-page-content standard-tab-layout" style={{ padding: "8px 0" }}>
              <form onSubmit={handleSaveSettingsPage} className="settings-page-form" style={{ width: "100%", display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* 默认视频保存目录 */}
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

                {/* 开播检测轮询间隔 */}
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

                {/* 保存配置按钮 */}
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
          )}
        </main>

        {/* 4. 底部 Telemetry Status Bar */}
        <footer className="app-telemetry-bar">
          <div className="telemetry-left">
            <span className="telemetry-item">
              <span className="telemetry-label">在线主播:</span>
              <span className="telemetry-value">{config?.rooms.filter(r => roomStatuses[r.room_id]?.is_live).length || 0} 个</span>
            </span>
            <span className="telemetry-divider">|</span>
            <span className="telemetry-item">
              <span className="telemetry-label">录制通道:</span>
              <span className="telemetry-value active">{activeTasks.length} 路</span>
            </span>
            {/* 系统就绪状态文字已移除 */}
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
              {currentTime}
            </span>
          </div>
        </footer>
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

      {/* 昵称输入弹窗 */}
      {showNicknameModal && (
        <div className="modal-overlay" onClick={() => { setShowNicknameModal(false); setPendingCookie(null); setPendingNickname(""); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>设置账号昵称</h2>
              <button className="close-btn" onClick={() => { setShowNicknameModal(false); setPendingCookie(null); setPendingNickname(""); }}>&times;</button>
            </div>
            <div className="modal-form">
              <div className="form-group">
                <label>账号备注 / 昵称</label>
                <input
                  type="text"
                  value={pendingNickname}
                  onChange={(e) => setPendingNickname(e.target.value)}
                  placeholder="例如: 抖音主号"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirmNickname(); }}
                />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => { setShowNicknameModal(false); setPendingCookie(null); setPendingNickname(""); }}>取消</button>
                <button className="btn btn-primary" onClick={handleConfirmNickname} disabled={!pendingNickname.trim()}>确认添加</button>
              </div>
            </div>
          </div>
        </div>
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
