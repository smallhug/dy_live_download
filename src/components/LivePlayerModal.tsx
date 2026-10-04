import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RoomConfig, LiveMessage } from "../types";
import { DanmakuEngine } from "../utils/danmakuEngine";
import { CloseIcon, LoadingIcon } from "./Icons";
import { useLivePlayer } from "../hooks/useLivePlayer";
import { LiveChatPanel } from "./player/LiveChatPanel";
import { PlayerControls } from "./player/PlayerControls";
import { DanmakuSettingsPopover } from "./player/DanmakuSettingsPopover";

interface LivePlayerModalProps {
  room: RoomConfig;
  isOpen: boolean;
  isRecording: boolean;
  onClose: () => void;
}

export const LivePlayerModal: React.FC<LivePlayerModalProps> = ({
  room,
  isOpen,
  isRecording,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const danmakuEngineRef = useRef<DanmakuEngine | null>(null);
  const chatListEndRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);

  // 播放器状态管理 Hook
  const {
    uniqueStreams,
    currentQuality,
    isPlaying,
    isBuffering,
    reconnectCount,
    hasFatalError,
    volume,
    isMuted,
    MAX_RECONNECT_RETRIES,
    setIsBuffering,
    togglePlay,
    toggleMute,
    handleVolumeChange,
    handleManualRetry,
    changeQuality,
  } = useLivePlayer({
    room,
    isOpen,
    videoRef,
    onPlayStateChange: (playing) => {
      if (playing) {
        danmakuEngineRef.current?.resume();
      } else {
        danmakuEngineRef.current?.pause();
      }
    },
  });

  // 控制条与全屏状态
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // 弹幕参数设置
  const [danmakuVisible, setDanmakuVisible] = useState<boolean>(true);
  const [danmakuOpacity, setDanmakuOpacity] = useState<number>(0.9);
  const [danmakuFontSize, setDanmakuFontSize] = useState<number>(18);
  const [danmakuSpeed, setDanmakuSpeed] = useState<number>(1.0);
  const [showDanmakuSettings, setShowDanmakuSettings] = useState<boolean>(false);

  // 聊天消息与分类
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [filter, setFilter] = useState<"all" | "chat" | "gift" | "other">("all");
  const [totalLikes, setTotalLikes] = useState<number>(0);

  // 会话级累计统计数据（只增不减，不随 200 条视窗截断而丢失）
  const [stats, setStats] = useState({
    chatCount: 0,
    giftCount: 0,
    giftTotalRmb: 0,
    giftBreakdown: [] as { name: string; count: number; totalRmb: number }[],
    topGifters: [] as { userId: string; nickname: string; totalRmb: number; giftCount: number }[],
  });

  // 内部高频缓冲区与引用
  const incomingBufferRef = useRef<LiveMessage[]>([]);
  const maxLikesRef = useRef<number>(0);
  const giftMapRef = useRef<Map<string, { count: number; totalRmb: number }>>(new Map());
  const gifterMapRef = useRef<Map<string, { userId: string; nickname: string; totalRmb: number; giftCount: number }>>(new Map());
  const emittedIdsRef = useRef<Set<string>>(new Set());

  // 1. 初始化 Canvas 弹幕引擎
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const engine = new DanmakuEngine(canvasRef.current);
    danmakuEngineRef.current = engine;
    engine.updateSettings({
      visible: danmakuVisible,
      opacity: danmakuOpacity,
      fontSize: danmakuFontSize,
      speed: danmakuSpeed,
    });

    return () => {
      engine.destroy();
      danmakuEngineRef.current = null;
    };
  }, [isOpen]);

  // 更新弹幕设置
  useEffect(() => {
    danmakuEngineRef.current?.updateSettings({
      visible: danmakuVisible,
      opacity: danmakuOpacity,
      fontSize: danmakuFontSize,
      speed: danmakuSpeed,
    });
  }, [danmakuVisible, danmakuOpacity, danmakuFontSize, danmakuSpeed]);

  // 2. 批量排空定时器（120ms 节流合并写入，阻断 React 高频重渲染与 UI 线程卡顿）
  useEffect(() => {
    if (!isOpen) return;

    const flushTimer = setInterval(() => {
      const buffer = incomingBufferRef.current;
      if (buffer.length === 0) return;

      incomingBufferRef.current = [];

      let chatInc = 0;
      let giftInc = 0;
      let giftRmbInc = 0;
      let canvasEmittedCount = 0;

      for (const msg of buffer) {
        if (msg.payload.type === "chat") {
          chatInc++;
        } else if (msg.payload.type === "superchat") {
          chatInc++;
          const rmb = msg.payload.price_rmb || 0;
          giftInc++;
          giftRmbInc += rmb;

          const cur = giftMapRef.current.get("醒目留言") || { count: 0, totalRmb: 0 };
          cur.count++;
          cur.totalRmb += rmb;
          giftMapRef.current.set("醒目留言", cur);

          const uid = msg.user.user_id || msg.user.nickname;
          const gifter = gifterMapRef.current.get(uid) || {
            userId: uid,
            nickname: msg.user.nickname,
            totalRmb: 0,
            giftCount: 0,
          };
          gifter.totalRmb += rmb;
          gifter.giftCount++;
          gifterMapRef.current.set(uid, gifter);
        } else if (msg.payload.type === "gift") {
          const count = msg.payload.count || 1;
          const rmb = ((msg.payload.price_cents || 0) * count) / 100;
          giftInc += count;
          giftRmbInc += rmb;

          const name = msg.payload.gift_name || "未知礼物";
          const cur = giftMapRef.current.get(name) || { count: 0, totalRmb: 0 };
          cur.count += count;
          cur.totalRmb += rmb;
          giftMapRef.current.set(name, cur);

          const uid = msg.user.user_id || msg.user.nickname;
          const gifter = gifterMapRef.current.get(uid) || {
            userId: uid,
            nickname: msg.user.nickname,
            totalRmb: 0,
            giftCount: 0,
          };
          gifter.totalRmb += rmb;
          gifter.giftCount += count;
          gifterMapRef.current.set(uid, gifter);
        }

        // Canvas 弹幕发射频次保护：每批次最多发射 5 条，避免暴风式刷屏压垮 Canvas 绘制线程
        if (canvasEmittedCount < 5 && !emittedIdsRef.current.has(msg.id)) {
          emittedIdsRef.current.add(msg.id);
          if (emittedIdsRef.current.size > 400) {
            emittedIdsRef.current.clear();
          }

          if (msg.payload.type === "chat" && msg.payload.content) {
            danmakuEngineRef.current?.emit(
              msg.payload.content,
              msg.payload.color || "#FFFFFF",
              false
            );
            canvasEmittedCount++;
          } else if (msg.payload.type === "superchat" && msg.payload.content) {
            danmakuEngineRef.current?.emit(
              `[醒目留言 ¥${msg.payload.price_rmb?.toFixed(0)}] ${msg.payload.content}`,
              "#F59E0B",
              false
            );
            canvasEmittedCount++;
          } else if (msg.payload.type === "gift") {
            danmakuEngineRef.current?.emit(
              `[礼物] ${msg.user.nickname} 送出 ${msg.payload.gift_name} x${msg.payload.count}`,
              "#FB923C",
              false
            );
            canvasEmittedCount++;
          }
        }
      }

      // 批量更新累计指标
      setStats((prev) => ({
        chatCount: prev.chatCount + chatInc,
        giftCount: prev.giftCount + giftInc,
        giftTotalRmb: prev.giftTotalRmb + giftRmbInc,
        giftBreakdown: Array.from(giftMapRef.current.entries())
          .map(([name, data]) => ({ name, count: data.count, totalRmb: data.totalRmb }))
          .sort((a, b) => b.totalRmb - a.totalRmb || b.count - a.count),
        topGifters: Array.from(gifterMapRef.current.values())
          .sort((a, b) => b.totalRmb - a.totalRmb || b.giftCount - a.giftCount)
          .slice(0, 5),
      }));

      // 批量更新总点赞
      setTotalLikes(maxLikesRef.current);

      // 批量将消息推入视窗（维持最多 200 条节点以保证 DOM 极速渲染）
      setMessages((prev) => {
        const next = prev.concat(buffer);
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    }, 120);

    return () => clearInterval(flushTimer);
  }, [isOpen]);

  // 3. 监听全局弹幕事件并写入缓冲区（纯 JS 内存操作，耗时 < 0.01ms）
  useEffect(() => {
    if (!isOpen) return;

    let unlistenFn: (() => void) | null = null;
    let isMounted = true;

    const setupDanmakuListener = async () => {
      try {
        const unlisten = await listen<LiveMessage>("live-danmaku", (event) => {
          if (!isMounted) return;
          const msg = event.payload;
          if (msg.room_id === room.room_id) {
            // 累计点赞数
            if (msg.payload.type === "like") {
              if (msg.payload.total && msg.payload.total > 0) {
                maxLikesRef.current = Math.max(maxLikesRef.current, msg.payload.total);
              } else {
                maxLikesRef.current += msg.payload.count || 1;
              }
            }

            // 推入待渲染缓冲池
            incomingBufferRef.current.push(msg);
          }
        });

        if (!isMounted) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }

        // 启动后台弹幕流
        const active = await invoke<boolean>("is_danmaku_active", { roomId: room.room_id });
        if (!active) {
          await invoke("start_danmaku_preview", {
            roomId: room.room_id,
            platform: room.platform,
          });
        }
      } catch (err) {
        console.error("Failed to start danmaku listener:", err);
      }
    };

    setupDanmakuListener();

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
      if (!isRecording) {
        invoke("stop_danmaku_preview", { roomId: room.room_id }).catch(() => {});
      }
    };
  }, [isOpen, room.room_id, room.platform, isRecording]);

  // 控制条自动隐藏
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  // 全屏切换与事件监听
  const toggleFullscreen = () => {
    const container = document.getElementById("live-player-theater-container");
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay player-modal-overlay" onClick={onClose}>
      <div
        id="live-player-theater-container"
        className="live-player-theater glass-card"
        onClick={(e) => e.stopPropagation()}
        onMouseMove={handleMouseMove}
      >
        {/* 左侧：视频观影舞台 (含叠层 Canvas 弹幕) */}
        <div className="player-video-stage">
          {/* 顶部简易标题栏 */}
          <div className={`stage-top-bar ${showControls ? "visible" : ""}`}>
            <div className="stage-title-wrap">
              <span className={`platform-pill ${room.platform}`}>
                {room.platform === "bilibili" ? "B站" : "抖音"}
              </span>
              <span className="stage-anchor-name">{room.anchor_name}</span>
              <span className="live-dot-pulse">● 正在直播</span>
            </div>
            <button className="icon-btn stage-close-btn" title="关闭播放器" onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          </div>

          {/* 视频容器 */}
          <div className="video-viewport">
            <video
              ref={videoRef}
              className="player-video-element"
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => setIsBuffering(false)}
              onClick={togglePlay}
            />
            {/* 60fps Canvas 弹幕层 */}
            <canvas ref={canvasRef} className="player-danmaku-canvas" />

            {/* 缓冲加载指示器与自动重连提示 */}
            {isBuffering && !hasFatalError && (
              <div className="player-buffering-overlay">
                <LoadingIcon size={36} />
                <span>
                  {reconnectCount > 0
                    ? `网络连接抖动，正在重新连接 (${reconnectCount}/${MAX_RECONNECT_RETRIES})...`
                    : "正在连接超低延迟推流..."}
                </span>
              </div>
            )}

            {/* 重试耗尽断流提示 */}
            {hasFatalError && (
              <div className="player-buffering-overlay" style={{ gap: "10px" }}>
                <span style={{ color: "#ef4444", fontWeight: 600, fontSize: "15px" }}>
                  直播推流已中断
                </span>
                <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>
                  多次重试未成功，主播可能已下播或网络异常
                </span>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: "6px", padding: "6px 16px", fontSize: "12.5px" }}
                  onClick={handleManualRetry}
                >
                  重新连接
                </button>
              </div>
            )}

            {/* 悬浮控制底栏 */}
            <PlayerControls
              isPlaying={isPlaying}
              togglePlay={togglePlay}
              isMuted={isMuted}
              volume={volume}
              toggleMute={toggleMute}
              handleVolumeChange={handleVolumeChange}
              reconnectCount={reconnectCount}
              maxReconnectRetries={MAX_RECONNECT_RETRIES}
              currentQuality={currentQuality}
              uniqueStreams={uniqueStreams}
              onChangeQuality={changeQuality}
              danmakuVisible={danmakuVisible}
              setDanmakuVisible={setDanmakuVisible}
              showDanmakuSettings={showDanmakuSettings}
              setShowDanmakuSettings={setShowDanmakuSettings}
              isFullscreen={isFullscreen}
              toggleFullscreen={toggleFullscreen}
              showControls={showControls}
            />

            {/* 弹幕参数设置弹出框 */}
            {showDanmakuSettings && (
              <DanmakuSettingsPopover
                danmakuOpacity={danmakuOpacity}
                setDanmakuOpacity={setDanmakuOpacity}
                danmakuFontSize={danmakuFontSize}
                setDanmakuFontSize={setDanmakuFontSize}
                danmakuSpeed={danmakuSpeed}
                setDanmakuSpeed={setDanmakuSpeed}
              />
            )}
          </div>
        </div>

        {/* 右侧：实时互动聊天流与过滤面板 */}
        <LiveChatPanel
          messages={messages}
          filter={filter}
          setFilter={setFilter}
          onClear={() => {
            setMessages([]);
            incomingBufferRef.current = [];
          }}
          chatListEndRef={chatListEndRef}
          totalLikes={totalLikes}
          stats={stats}
        />
      </div>
    </div>
  );
};
