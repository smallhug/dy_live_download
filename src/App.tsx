import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppConfig, RoomConfig, RecordProgress, LiveRoomInfo } from "./types";
import { StatusBar } from "./components/StatusBar";
import { SettingsModal } from "./components/SettingsModal";
import { AddRoomModal } from "./components/AddRoomModal";
import { RoomSettingsModal } from "./components/RoomSettingsModal";
import { ConvertModal } from "./components/ConvertModal";
import "./App.css";

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeTasks, setActiveTasks] = useState<string[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, RecordProgress>>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddRoomOpen, setIsAddRoomOpen] = useState(false);
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [selectedRoomForSettings, setSelectedRoomForSettings] = useState<RoomConfig | null>(null);
  const [roomStatuses, setRoomStatuses] = useState<Record<string, { is_live: boolean; title?: string }>>({});
  const [checkingRooms, setCheckingRooms] = useState<Record<string, boolean>>({});

  // 获取全局配置
  const fetchConfig = async () => {
    try {
      const res = await invoke<AppConfig>("get_config");
      setConfig(res);
    } catch (err) {
      console.error("加载配置失败:", err);
    }
  };

  // 获取正在录制的任务
  const fetchActiveTasks = async () => {
    try {
      const res = await invoke<string[]>("get_active_tasks");
      setActiveTasks(res);
    } catch (err) {
      console.error("获取录制列表失败:", err);
    }
  };

  // 初始化加载与事件监听
  useEffect(() => {
    fetchConfig();
    fetchActiveTasks();

    // 监听 Rust 后端发送的进度通知
    const unlistenPromise = listen<RecordProgress>("record-progress", (event) => {
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
        // 既然在录制，说明肯定是在播状态
        setRoomStatuses((prev) => ({
          ...prev,
          [progress.room_id]: { is_live: true },
        }));
      } else if (progress.status === "stopped" || progress.status === "error") {
        setActiveTasks((prev) => prev.filter((id) => id !== progress.room_id));
        setRoomStatuses((prev) => ({
          ...prev,
          [progress.room_id]: { is_live: false },
        }));
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // 保存设置
  const handleSaveSettings = async (globalConfig: any) => {
    await invoke("update_global_config", {
      ffmpegPath: globalConfig.ffmpeg_path,
      saveDir: globalConfig.save_dir,
      cookie: globalConfig.cookie,
      userAgent: globalConfig.user_agent,
      secChUa: globalConfig.sec_ch_ua,
      monitorIntervalSecs: globalConfig.monitor_interval_secs,
    });
    await fetchConfig();
  };

  // 添加直播间
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

  // 删除直播间
  const handleDeleteRoom = async (roomId: string) => {
    console.log("handleDeleteRoom triggered for roomId:", roomId);
    if (window.confirm("确定要删除该主播吗？如果正在录制，录制将强制停止。")) {
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
        alert("删除主播失败: " + err);
      }
    }
  };

  // 打开主播设置弹窗
  const handleOpenRoomSettings = (room: RoomConfig) => {
    setSelectedRoomForSettings(room);
    setIsRoomSettingsOpen(true);
  };

  // 保存主播设置
  const handleSaveRoomSettings = async (updatedRoom: RoomConfig) => {
    try {
      await invoke("update_room_config", { room: updatedRoom });
      await fetchConfig();
    } catch (err) {
      alert("更新直播间配置失败: " + err);
      throw err;
    }
  };

  // 快捷切换监控状态
  const handleToggleMonitor = async (room: RoomConfig) => {
    console.log("handleToggleMonitor triggered for room:", room.room_id, "current is_monitoring:", room.is_monitoring);
    const updated = { ...room, is_monitoring: !room.is_monitoring };
    try {
      await invoke("update_room_config", { room: updated });
      await fetchConfig();
    } catch (err) {
      alert("更新监控状态失败: " + err);
    }
  };

  // 快捷切换偏好画质
  const handleQualityChange = async (room: RoomConfig, quality: string) => {
    console.log("handleQualityChange triggered for room:", room.room_id, "new quality:", quality);
    const updated = { ...room, preferred_quality: quality };
    try {
      await invoke("update_room_config", { room: updated });
      await fetchConfig();
    } catch (err) {
      alert("更新画质偏好失败: " + err);
    }
  };

  // 手动检测直播间开播状态
  const handleCheckRoomStatus = async (room: RoomConfig) => {
    console.log("handleCheckRoomStatus triggered for room:", room.room_id);
    setCheckingRooms((prev) => ({ ...prev, [room.room_id]: true }));
    try {
      const info = await invoke<LiveRoomInfo>("parse_room", { url: room.url });
      console.log("parse_room success info:", info);
      setRoomStatuses((prev) => ({
        ...prev,
        [room.room_id]: { is_live: info.is_live, title: info.title },
      }));
      // 同时更新主播名字，以防开播时获取了真实名称
      if (info.anchor_name && info.anchor_name !== room.anchor_name) {
        const updated = { ...room, anchor_name: info.anchor_name };
        await invoke("update_room_config", { room: updated });
        await fetchConfig();
      }
    } catch (err: any) {
      console.error(`解析房间 ${room.anchor_name} 失败:`, err);
      alert(`检测直播状态失败: ${err.toString()}`);
    } finally {
      setCheckingRooms((prev) => ({ ...prev, [room.room_id]: false }));
    }
  };

  // 手动开始录制
  const handleStartRecord = async (roomId: string) => {
    console.log("🎬 [前端] ========== 开始手动录制 ==========");
    console.log("🎬 [前端] roomId:", roomId);
    
    try {
      console.log("🎬 [前端] 调用后端 start_record_task...");
      const result = await invoke("start_record_task", { roomId });
      console.log("🎬 [前端] ✅ 后端返回成功:", result);
      // 成功启动后，Tauri Event 会接管后续的录制进度展示
    } catch (err: any) {
      console.error("❌ [前端] 启动录制失败，完整错误:", err);
      console.error("❌ [前端] 错误类型:", typeof err);
      console.error("❌ [前端] 错误消息:", err?.message || err?.toString() || "未知错误");
      
      // 显示详细的错误信息
      const errorMsg = err?.message || err?.toString() || "未知错误（请查看终端日志）";
      alert(`⚠️ 启动录制失败\n\n${errorMsg}\n\n请查看终端窗口的详细日志获取更多信息。`);
    }
  };

  // 手动停止录制
  const handleStopRecord = async (roomId: string) => {
    console.log("handleStopRecord triggered for roomId:", roomId);
    try {
      await invoke("stop_record_task", { roomId });
    } catch (err: any) {
      alert("停止录制失败: " + err.toString());
    }
  };

  // 计算正在监控的主播数量
  const monitoringCount = config?.rooms?.filter((r) => r.is_monitoring).length || 0;

  return (
    <div className="app-container">
      {/* 头部区域 */}
      <header className="app-header">
        <div className="header-title">
          <h1>
            <span style={{ color: "#6366f1" }}>●</span> 抖音直播录制管理
          </h1>
          <p>实时监控、多路并发下载、无损自动分段封装</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => setIsConvertOpen(true)}>
            🔄 格式转换
          </button>
          <button className="btn btn-secondary" onClick={() => setIsSettingsOpen(true)}>
            ⚙️ 全局设置
          </button>
          <button className="btn btn-primary" onClick={() => setIsAddRoomOpen(true)}>
            ➕ 添加主播
          </button>
        </div>
      </header>

      {/* 主体卡片网格 */}
      <main className="content-area">
        {!config || !config.rooms || config.rooms.length === 0 ? (
          <div className="empty-state glass-card">
            <div className="empty-icon">📺</div>
            <h3>任务列表空空如也</h3>
            <p>点击右上角的 “添加主播” 按钮，输入抖音直播间链接开始实时监控和录制吧！</p>
            <button className="btn btn-primary" onClick={() => setIsAddRoomOpen(true)}>
              立即添加
            </button>
          </div>
        ) : (
          <div className="room-grid">
            {config.rooms?.map((room) => {
              const isRecording = activeTasks.includes(room.room_id);
              const progress = progressMap[room.room_id];
              const status = roomStatuses[room.room_id];
              const isChecking = checkingRooms[room.room_id];
              
              // 综合判断直播状态：若正在录制肯定是 Live，否则以查询到的状态为准
              const isLive = isRecording || (status?.is_live ?? false);

              return (
                <div key={room.room_id} className={`room-card glass-card ${isRecording ? "is-recording" : ""}`}>
                  {/* 卡片头部 */}
                  <div className="card-header">
                    <div className="card-header-left">
                      <div className="anchor-name" title={room.anchor_name}>
                        {room.anchor_name}
                      </div>
                      <div className="room-id">ID: {room.room_id}</div>
                    </div>
                    <div className="card-header-right" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {/* 设置按钮 */}
                      <button
                        className="icon-btn"
                        onClick={() => handleOpenRoomSettings(room)}
                        title="直播间设置（画质、分段等）"
                        style={{ fontSize: "14px", padding: "4px 6px" }}
                      >
                        ⚙️
                      </button>
                      <span className={`status-badge ${isLive ? "live" : "offline"}`}>
                        <span className="dot"></span>
                        {isLive ? "直播中" : "未开播"}
                      </span>
                    </div>
                  </div>

                  {/* 卡片身体 */}
                  <div className="card-body">
                    {status?.title && (
                      <div className="info-row" style={{ marginBottom: "4px" }}>
                        <span className="info-label">直播标题:</span>
                        <span className="info-value" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }} title={status.title}>
                          {status.title}
                        </span>
                      </div>
                    )}
                    
                    {/* 设置摘要显示 */}
                    <div style={{ display: "flex", gap: "12px", marginTop: "6px", marginBottom: "6px" }}>
                      <div style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: "4px",
                        padding: "3px 8px",
                        background: "#f1f5f9",
                        borderRadius: "6px",
                        fontSize: "11.5px",
                        color: "#475569",
                        fontWeight: "500"
                      }}>
                        🎬 {room.preferred_quality || "原画"}
                      </div>
                      <div style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: "4px",
                        padding: "3px 8px",
                        background: "#f1f5f9",
                        borderRadius: "6px",
                        fontSize: "11.5px",
                        color: "#475569",
                        fontWeight: "500"
                      }}>
                        ⏱️ {room.segment_duration_mins > 0 ? `${room.segment_duration_mins}分钟/段` : "不分段"}
                      </div>
                    </div>

                    {/* 录制进度面板 */}
                    {isRecording && progress && (
                      <div className="progress-panel">
                        <div className="progress-title">
                          <span>●</span> 正在实时抓流录制
                        </div>
                        <div className="progress-grid">
                          <div className="progress-stat">
                            <span className="stat-label">已录时长</span>
                            <span className="stat-value">{progress.time}</span>
                          </div>
                          <div className="progress-stat">
                            <span className="stat-label">视频大小</span>
                            <span className="stat-value">{progress.size}</span>
                          </div>
                          <div className="progress-stat">
                            <span className="stat-label">实时码率</span>
                            <span className="stat-value">{progress.bitrate}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 卡片底栏操作区 */}
                  <div className="card-actions">
                    <div className="action-left">
                      <label className="switch-label">
                        <input
                          type="checkbox"
                          className="switch-input"
                          checked={room.is_monitoring}
                          onChange={() => handleToggleMonitor(room)}
                          disabled={isRecording}
                        />
                        <span className="switch-slider"></span>
                        监控开播
                      </label>
                    </div>

                    <div className="action-right">
                      {/* 刷新状态按钮 */}
                      <button
                        className="icon-btn"
                        onClick={() => handleCheckRoomStatus(room)}
                        disabled={isChecking || isRecording}
                        title="检测当前直播间是否开播"
                      >
                        {isChecking ? "⏳" : "🔄"}
                      </button>

                      {/* 删除按钮 */}
                      <button
                        className="icon-btn icon-btn-danger"
                        onClick={() => handleDeleteRoom(room.room_id)}
                        title="删除此任务"
                      >
                        🗑️
                      </button>

                      {/* 录制控制 */}
                      {isRecording ? (
                        <button
                          className="btn btn-danger"
                          style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "12px" }}
                          onClick={() => handleStopRecord(room.room_id)}
                        >
                          停止录制
                        </button>
                      ) : (
                        <button
                          className={`btn ${isLive ? "btn-success" : "btn-secondary"}`}
                          style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "12px" }}
                          onClick={() => handleStartRecord(room.room_id)}
                          title={isLive ? "立即开始录制当前直播" : "点击尝试录制（若主播未开播后端会提示）"}
                        >
                          手动录制
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 弹窗区域 */}
      {config && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          config={config.global}
          onSave={handleSaveSettings}
        />
      )}

      {/* 格式转换弹窗 */}
      <ConvertModal
        isOpen={isConvertOpen}
        onClose={() => setIsConvertOpen(false)}
        ffmpegPath={config?.global.ffmpeg_path || ""}
        defaultSaveDir={config?.global.save_dir || ""}
      />

      <AddRoomModal
        isOpen={isAddRoomOpen}
        onClose={() => setIsAddRoomOpen(false)}
        onAdd={handleAddRoom}
      />

      {/* 主播设置弹窗 */}
      {selectedRoomForSettings && (
        <RoomSettingsModal
          isOpen={isRoomSettingsOpen}
          onClose={() => {
            setIsRoomSettingsOpen(false);
            setSelectedRoomForSettings(null);
          }}
          room={selectedRoomForSettings}
          onSave={handleSaveRoomSettings}
        />
      )}

      {/* 底部固定状态栏 */}
      <StatusBar
        ffmpegPath={config?.global.ffmpeg_path || ""}
        activeRecordingCount={activeTasks.length}
        monitoringCount={monitoringCount}
      />
    </div>
  );
}

export default App;
