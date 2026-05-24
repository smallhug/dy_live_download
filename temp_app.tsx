import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { AppConfig, RoomConfig, RecordProgress, LiveRoomInfo } from "./types";
import { StatusBar } from "./components/StatusBar";
import { SettingsModal } from "./components/SettingsModal";
import { AddRoomModal } from "./components/AddRoomModal";
import { RoomSettingsModal } from "./components/RoomSettingsModal";
import { ConvertModal } from "./components/ConvertModal";
import { RefreshIcon, SettingsIcon, TrashIcon, TvIcon, TimerIcon, MovieIcon, LoadingIcon } from "./components/Icons";
import "./App.css";

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeTasks, setActiveTasks] = useState<string[]>([]);
  const configRef = useRef<AppConfig | null>(null);

  useEffect(() => {
    configRef.current = config;
  }, [config]);
  const [progressMap, setProgressMap] = useState<Record<string, RecordProgress>>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddRoomOpen, setIsAddRoomOpen] = useState(false);
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [selectedRoomForSettings, setSelectedRoomForSettings] = useState<RoomConfig | null>(null);
  const [roomStatuses, setRoomStatuses] = useState<Record<string, { is_live: boolean; title?: string }>>({});
  const [checkingRooms, setCheckingRooms] = useState<Record<string, boolean>>({});
  const [recordLoading, setRecordLoading] = useState<Record<string, "starting" | "stopping" | null>>({});

  // 鑾峰彇鍏ㄥ眬閰嶇疆
  const fetchConfig = async () => {
    try {
      const res = await invoke<AppConfig>("get_config");
      setConfig(res);
    } catch (err) {
      console.error("鍔犺浇閰嶇疆澶辫触:", err);
    }
  };

  // 鑾峰彇姝ｅ湪褰曞埗鐨勪换鍔?  const fetchActiveTasks = async () => {
    try {
      const res = await invoke<string[]>("get_active_tasks");
      setActiveTasks(res);

      // 鑾峰彇姝ｅ湪褰曞埗鐩存挱闂寸殑鏍囬鏄犲皠锛屽苟鍐欏叆鐘舵€佺紦瀛?      const titles = await invoke<Record<string, string>>("get_active_task_titles");
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
      console.error("鑾峰彇褰曞埗鍒楄〃鎴栨爣棰樺け璐?", err);
    }
  };

  // 鍒濆鍖栧姞杞戒笌浜嬩欢鐩戝惉
  useEffect(() => {
    fetchConfig();
    fetchActiveTasks();

    // 鐩戝惉 Rust 鍚庣鍙戦€佺殑杩涘害閫氱煡
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
        // 鏃㈢劧鍦ㄥ綍鍒讹紝璇存槑鑲畾鏄湪鎾姸鎬?        setRoomStatuses((prev) => {
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

        // 濡傛灉鏄綍鍒跺彂鐢熼敊璇紝寮瑰嚭绮剧編鐨勭郴缁熷璇濇鎻愮ず鐢ㄦ埛
        if (progress.status === "error" && progress.error_msg) {
          const rooms = configRef.current?.rooms || [];
          const anchor = rooms.find((r) => r.room_id === progress.room_id)?.anchor_name || "鏈煡涓绘挱";
          message(`涓绘挱銆?{anchor}銆戠殑褰曞埗浠诲姟寮傚父涓柇锛乗n\n閿欒淇℃伅锛歕n${progress.error_msg}`, {
            title: "褰曞埗寮傚父涓柇",
            kind: "error",
          });
        }
      }
    });

    // 鐩戝惉 Rust 鍚庣鍙戦€佺殑鐩存挱鐘舵€侀€氱煡
    const unlistenRoomStatusPromise = listen<{ room_id: string; is_live: boolean; title: string }>("room-status", (event) => {
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
      unlistenPromise.then((unlisten) => unlisten());
      unlistenRoomStatusPromise.then((unlisten) => unlisten());
    };
  }, []);

  // 淇濆瓨璁剧疆
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

  // 娣诲姞鐩存挱闂?  const handleAddRoom = async (
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

  // 鍒犻櫎鐩存挱闂?  const handleDeleteRoom = async (roomId: string) => {
    console.log("handleDeleteRoom triggered for roomId:", roomId);
    if (window.confirm("纭畾瑕佸垹闄よ涓绘挱鍚楋紵濡傛灉姝ｅ湪褰曞埗锛屽綍鍒跺皢寮哄埗鍋滄銆?)) {
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
        alert("鍒犻櫎涓绘挱澶辫触: " + err);
      }
    }
  };

  // 鎵撳紑涓绘挱璁剧疆寮圭獥
  const handleOpenRoomSettings = (room: RoomConfig) => {
    setSelectedRoomForSettings(room);
    setIsRoomSettingsOpen(true);
  };

  // 淇濆瓨涓绘挱璁剧疆
  const handleSaveRoomSettings = async (updatedRoom: RoomConfig) => {
    try {
      await invoke("update_room_config", { room: updatedRoom });
      await fetchConfig();
    } catch (err) {
      alert("鏇存柊鐩存挱闂撮厤缃け璐? " + err);
      throw err;
    }
  };


  // 鎵嬪姩妫€娴嬬洿鎾棿寮€鎾姸鎬?  const handleCheckRoomStatus = async (room: RoomConfig) => {
    console.log("handleCheckRoomStatus triggered for room:", room.room_id);
    setCheckingRooms((prev) => ({ ...prev, [room.room_id]: true }));
    try {
      const info = await invoke<LiveRoomInfo>("parse_room", { url: room.url });
      console.log("parse_room success info:", info);
      setRoomStatuses((prev) => {
        const prevStatus = prev[room.room_id];
        const nextTitle = info.is_live ? info.title : (prevStatus?.title || info.title);
        return {
          ...prev,
          [room.room_id]: { is_live: info.is_live, title: nextTitle },
        };
      });
      // 鍚屾椂鏇存柊涓绘挱鍚嶅瓧锛屼互闃插紑鎾椂鑾峰彇浜嗙湡瀹炲悕绉?      // 浠呭湪寮€鎾姸鎬佷笅锛屼笖鑾峰彇鍒颁簡鏈夋晥鐨勪富鎾悕绉版椂锛屾墠鏇存柊鍗＄墖鏄电О
      if (info.is_live && info.anchor_name && info.anchor_name !== "鏈煡涓绘挱" && info.anchor_name !== room.anchor_name) {
        const updated = { ...room, anchor_name: info.anchor_name };
        await invoke("update_room_config", { room: updated });
        await fetchConfig();
      }
    } catch (err: any) {
      console.error(`瑙ｆ瀽鎴块棿 ${room.anchor_name} 澶辫触:`, err);
      alert(`妫€娴嬬洿鎾姸鎬佸け璐? ${err.toString()}`);
    } finally {
      setCheckingRooms((prev) => ({ ...prev, [room.room_id]: false }));
    }
  };

  // 鎵嬪姩寮€濮嬪綍鍒?  const handleStartRecord = async (roomId: string) => {
    console.log("馃幀 [鍓嶇] ========== 寮€濮嬫墜鍔ㄥ綍鍒?==========");
    console.log("馃幀 [鍓嶇] roomId:", roomId);
    setRecordLoading((prev) => ({ ...prev, [roomId]: "starting" }));
    try {
      console.log("馃幀 [鍓嶇] 璋冪敤鍚庣 start_record_task...");
      const result = await invoke("start_record_task", { roomId });
      console.log("馃幀 [鍓嶇] 鉁?鍚庣杩斿洖鎴愬姛:", result);
      // 鎴愬姛鍚姩鍚庯紝Tauri Event 浼氭帴绠″悗缁殑褰曞埗杩涘害灞曠ず
    } catch (err: any) {
      console.error("鉂?[鍓嶇] 鍚姩褰曞埗澶辫触锛屽畬鏁撮敊璇?", err);
      console.error("鉂?[鍓嶇] 閿欒绫诲瀷:", typeof err);
      console.error("鉂?[鍓嶇] 閿欒娑堟伅:", err?.message || err?.toString() || "鏈煡閿欒");
      
      const errorMsg = err?.message || err?.toString() || "鏈煡閿欒锛堣鏌ョ湅缁堢鏃ュ織锛?;
      message(`褰曞埗鍚姩澶辫触锛乗n\n閿欒璇︽儏:\n${errorMsg}`, {
        title: "鍚姩褰曞埗澶辫触",
        kind: "error",
      });
    } finally {
      setRecordLoading((prev) => ({ ...prev, [roomId]: null }));
    }
  };

  // 鎵嬪姩鍋滄褰曞埗
  const handleStopRecord = async (roomId: string) => {
    console.log("handleStopRecord triggered for roomId:", roomId);
    setRecordLoading((prev) => ({ ...prev, [roomId]: "stopping" }));
    try {
      await invoke("stop_record_task", { roomId });
    } catch (err: any) {
      alert("鍋滄褰曞埗澶辫触: " + err.toString());
    } finally {
      setRecordLoading((prev) => ({ ...prev, [roomId]: null }));
    }
  };

  // 璁＄畻姝ｅ湪鐩戞帶鐨勪富鎾暟閲?  const monitoringCount = config?.rooms?.filter((r) => r.is_monitoring).length || 0;

  return (
    <div className="app-container">
      {/* 澶撮儴鍖哄煙 */}
      <header className="app-header">
        <div className="header-title">
          <h1>
            <span style={{ color: "#6366f1" }}>鈼?/span> 鎶栭煶鐩存挱褰曞埗绠＄悊
          </h1>
          <p>瀹炴椂鐩戞帶銆佸璺苟鍙戜笅杞姐€佹棤鎹熻嚜鍔ㄥ垎娈靛皝瑁?/p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => setIsConvertOpen(true)}>
            <RefreshIcon size={14} style={{ marginRight: "6px" }} />鏍煎紡杞崲
          </button>
          <button className="btn btn-secondary" onClick={() => setIsSettingsOpen(true)}>
            <SettingsIcon size={14} style={{ marginRight: "6px" }} />鍏ㄥ眬璁剧疆
          </button>
          <button className="btn btn-primary" onClick={() => setIsAddRoomOpen(true)}>
            <span style={{ marginRight: "4px", fontSize: "14px", fontWeight: "bold" }}>+</span>娣诲姞涓绘挱
          </button>
        </div>
      </header>

      {/* 涓讳綋鍗＄墖缃戞牸 */}
      <main className="content-area">
        {!config || !config.rooms || config.rooms.length === 0 ? (
          <div className="empty-state glass-card">
            <div className="empty-icon"><TvIcon size={48} style={{ color: "#94a3b8" }} /></div>
            <h3>浠诲姟鍒楄〃绌虹┖濡備篃</h3>
            <p>鐐瑰嚮鍙充笂瑙掔殑 鈥滄坊鍔犱富鎾€?鎸夐挳锛岃緭鍏ユ姈闊崇洿鎾棿閾炬帴寮€濮嬪疄鏃剁洃鎺у拰褰曞埗鍚э紒</p>
            <button className="btn btn-primary" onClick={() => setIsAddRoomOpen(true)}>
              绔嬪嵆娣诲姞
            </button>
          </div>
        ) : (
          <div className="room-grid">
            {config.rooms?.map((room) => {
              const isRecording = activeTasks.includes(room.room_id);
              const progress = progressMap[room.room_id];
              const status = roomStatuses[room.room_id];
              const isChecking = checkingRooms[room.room_id];
              
              // 缁煎悎鍒ゆ柇鐩存挱鐘舵€侊細鑻ユ鍦ㄥ綍鍒惰偗瀹氭槸 Live锛屽惁鍒欎互鏌ヨ鍒扮殑鐘舵€佷负鍑?              const isLive = isRecording || (status?.is_live ?? false);

              return (
                <div key={room.room_id} className={`room-card glass-card ${isRecording ? "is-recording" : ""}`}>
                  {/* 鍗＄墖澶撮儴 */}
                  <div className="card-header">
                    <div className="card-header-left" style={{ flex: 1, minWidth: 0, marginRight: "12px" }}>
                      <div className="anchor-name" title={room.anchor_name}>
                        {room.anchor_name}
                      </div>
                      <div className="room-id">ID: {room.room_id}</div>
                      <div className="room-title" style={{ 
                        fontSize: "12px", 
                        color: "#64748b", 
                        overflow: "hidden", 
                        textOverflow: "ellipsis", 
                        whiteSpace: "nowrap", 
                        marginTop: "4px",
                        height: "18px",
                        lineHeight: "18px"
                      }} title={status?.title || ""}>
                        {status?.title ? status.title : <span style={{ color: "#cbd5e1" }}>-</span>}
                      </div>
                    </div>
                    <div className="card-header-right" style={{ display: "flex", alignItems: "center" }}>
                      {/* 璁剧疆鎸夐挳 */}
                      <button
                        className="icon-btn"
                        onClick={() => handleOpenRoomSettings(room)}
                        title="鐩存挱闂磋缃紙鐢昏川銆佸垎娈电瓑锛?
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", padding: 0 }}
                      >
                        <SettingsIcon size={14} />
                      </button>
                    </div>
                  </div>

                  {/* 鍗＄墖韬綋 */}
                  <div className="card-body">
                    
                    {/* 璁剧疆鎽樿鏄剧ず */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 10px", marginTop: "2px", marginBottom: "2px" }}>
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
                        <MovieIcon size={12} style={{ color: "#64748b" }} /> {room.preferred_quality || "鍘熺敾"}
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
                        <TimerIcon size={12} style={{ color: "#64748b" }} /> {room.segment_duration_mins > 0 ? `${room.segment_duration_mins}鍒嗛挓/娈礰 : "涓嶅垎娈?}
                      </div>

                      {/* 鍔ㄦ€佸綍鍒舵椂闀挎爣绛撅紝鎮诞鍙湅澶у皬鍜岀爜鐜?*/}
                      {isRecording && progress && (
                        <div 
                          style={{ 
                            display: "inline-flex", 
                            alignItems: "center", 
                            gap: "5px",
                            padding: "3px 8px",
                            background: "#ecfdf5",
                            borderRadius: "6px",
                            fontSize: "11.5px",
                            color: "#059669",
                            fontWeight: "600",
                            cursor: "help"
                          }}
                          title={`瑙嗛澶у皬: ${progress.size || "璁＄畻涓?} | 瀹炴椂鐮佺巼: ${progress.bitrate || "璁＄畻涓?}`}
                        >
                          <span style={{ 
                            display: "inline-block", 
                            width: "6px", 
                            height: "6px", 
                            borderRadius: "50%", 
                            backgroundColor: "#10b981",
                            animation: "blink 1.5s infinite ease-in-out" 
                          }}></span>
                          褰曞埗 {progress.time || "00:00:00"}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 鍗＄墖搴曟爮鎿嶄綔鍖?*/}
                  <div className="card-actions">
                    <div className="action-left" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span className={`status-badge ${isLive ? "live" : "offline"}`} style={{ padding: "1px 6px", borderRadius: "4px" }}>
                        <span className="dot"></span>
                        {isLive ? "鐩存挱涓? : "鏈紑鎾?}
                      </span>
                      {room.is_monitoring ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#10b981", fontWeight: "600" }} title="褰撳墠宸插紑鍚嚜鍔ㄥ紑鎾洃鎺?>
                          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981", animation: "blink 1.5s infinite ease-in-out" }}></span>
                          鐩戞帶涓?                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#94a3b8", fontWeight: "500" }} title="褰撳墠宸插叧闂洃鎺э紝浠呭彲鎵嬪姩褰曞埗">
                          <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#cbd5e1" }}></span>
                          鏈洃鎺?                        </div>
                      )}
                    </div>

                    <div className="action-right">
                      {/* 鍒锋柊鐘舵€佹寜閽?*/}
                      <button
                        className="icon-btn"
                        onClick={() => handleCheckRoomStatus(room)}
                        disabled={isChecking || isRecording}
                        title="妫€娴嬪綋鍓嶇洿鎾棿鏄惁寮€鎾?
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", padding: 0 }}
                      >
                        {isChecking ? <LoadingIcon size={14} /> : <RefreshIcon size={14} />}
                      </button>

                      {/* 鍒犻櫎鎸夐挳 */}
                      <button
                        className="icon-btn icon-btn-danger"
                        onClick={() => handleDeleteRoom(room.room_id)}
                        title="鍒犻櫎姝や换鍔?
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", padding: 0 }}
                      >
                        <TrashIcon size={14} />
                      </button>

                      {/* 褰曞埗鎺у埗 */}
                      {isRecording ? (
                        <button
                          className="btn btn-danger"
                          style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "12px", minWidth: "80px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                          onClick={() => handleStopRecord(room.room_id)}
                          disabled={recordLoading[room.room_id] === "stopping"}
                        >
                          {recordLoading[room.room_id] === "stopping" ? (
                            <><LoadingIcon size={12} /> 鍋滄涓?/>
                          ) : (
                            "鍋滄褰曞埗"
                          )}
                        </button>
                      ) : (
                        <button
                          className={`btn ${isLive ? "btn-success" : "btn-secondary"}`}
                          style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "12px", minWidth: "80px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                          onClick={() => handleStartRecord(room.room_id)}
                          disabled={!isLive || recordLoading[room.room_id] === "starting"}
                          title={isLive ? "绔嬪嵆寮€濮嬪綍鍒跺綋鍓嶇洿鎾? : "涓绘挱鏈紑鎾紝鏃犳硶褰曞埗"}
                        >
                          {recordLoading[room.room_id] === "starting" ? (
                            <><LoadingIcon size={12} /> 鍚姩涓?/>
                          ) : isLive ? (
                             "寮€濮嬪綍鍒?
                          ) : (
                            "鎵嬪姩褰曞埗"
                          )}
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

      {/* 寮圭獥鍖哄煙 */}
      {config && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          config={config.global}
          onSave={handleSaveSettings}
        />
      )}

      {/* 鏍煎紡杞崲寮圭獥 */}
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

      {/* 涓绘挱璁剧疆寮圭獥 */}
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

      {/* 搴曢儴鍥哄畾鐘舵€佹爮 */}
      <StatusBar
        activeRecordingCount={activeTasks.length}
        monitoringCount={monitoringCount}
      />
    </div>
  );
}

export default App;
