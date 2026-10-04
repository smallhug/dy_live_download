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

  // 2. 监听全局弹幕事件
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
            // 右侧聊天列表（严格按消息唯一 ID 去重）
            setMessages((prev) => {
              if (prev.some((item) => item.id === msg.id)) {
                return prev;
              }
              const next = [...prev, msg];
              return next.length > 300 ? next.slice(next.length - 300) : next;
            });

            // 视频上层 Canvas 弹幕发射（去重）
            if (!emittedIdsRef.current.has(msg.id)) {
              emittedIdsRef.current.add(msg.id);
              if (emittedIdsRef.current.size > 500) {
                emittedIdsRef.current.clear();
              }

              if (msg.payload.type === "chat" && msg.payload.content) {
                danmakuEngineRef.current?.emit(
                  msg.payload.content,
                  msg.payload.color || "#FFFFFF",
                  false
                );
              } else if (msg.payload.type === "superchat" && msg.payload.content) {
                danmakuEngineRef.current?.emit(
                  `[醒目留言 ¥${msg.payload.price_rmb?.toFixed(0)}] ${msg.payload.content}`,
                  "#F59E0B",
                  false
                );
              } else if (msg.payload.type === "gift") {
                danmakuEngineRef.current?.emit(
                  `[礼物] ${msg.user.nickname} 送出 ${msg.payload.gift_name} x${msg.payload.count}`,
                  "#FB923C",
                  false
                );
              }
            }
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

  // 聊天列表平滑自底滚动
  useEffect(() => {
    chatListEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
          onClear={() => setMessages([])}
          chatListEndRef={chatListEndRef}
        />
      </div>
    </div>
  );
};
