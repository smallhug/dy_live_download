import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import mpegts from "mpegts.js";
import { RoomConfig, LiveRoomInfo, LiveStream, LiveMessage } from "../types";
import { DanmakuEngine } from "../utils/danmakuEngine";
import {
  CloseIcon,
  SettingsIcon,
  TrashIcon,
  LoadingIcon
} from "./Icons";

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
  const playerRef = useRef<mpegts.Player | null>(null);
  const danmakuEngineRef = useRef<DanmakuEngine | null>(null);
  const chatListEndRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);

  const [availableStreams, setAvailableStreams] = useState<LiveStream[]>([]);

  // 相同画质去重，避免重复 key 警告
  const uniqueStreams = useMemo(() => {
    const seen = new Set<string>();
    return availableStreams.filter((s) => {
      if (seen.has(s.quality_name)) return false;
      seen.add(s.quality_name);
      return true;
    });
  }, [availableStreams]);

  const [currentQuality, setCurrentQuality] = useState<string>("origin");
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [reconnectCount, setReconnectCount] = useState<number>(0);
  const [hasFatalError, setHasFatalError] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const MAX_RECONNECT_RETRIES = 5;
  const retryCountRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isReconnectingRef = useRef<boolean>(false);
  const currentQualityRef = useRef<string>("origin");

  // 弹幕图层设置
  const [danmakuVisible, setDanmakuVisible] = useState<boolean>(true);
  const [danmakuOpacity, setDanmakuOpacity] = useState<number>(0.9);
  const [danmakuFontSize, setDanmakuFontSize] = useState<number>(18);
  const [danmakuSpeed, setDanmakuSpeed] = useState<number>(1.0);
  const [showDanmakuSettings, setShowDanmakuSettings] = useState<boolean>(false);

  // 聊天状态
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [filter, setFilter] = useState<'all' | 'chat' | 'gift' | 'other'>('all');
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

  // 4. 安全彻底销毁当前播放器实例
  const destroyPlayer = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.unload();
        playerRef.current.detachMediaElement();
        playerRef.current.destroy();
      } catch (e) {
        console.warn("[Player] Destroy error:", e);
      }
      playerRef.current = null;
    }
  }, []);

  // 5. 解析直播间画质流并挂载 mpegts 播放器
  const loadAndPlayStream = useCallback(async (qualityKey: string) => {
    if (!videoRef.current) return;
    setIsBuffering(true);

    try {
      // 1. 获取最新直播流地址 (重新拉取以确保 CDN token 处于最新状态)
      const roomInfo = await invoke<LiveRoomInfo>("parse_room", {
        url: room.room_id,
        platform: room.platform,
      });

      if (!roomInfo.is_live || roomInfo.streams.length === 0) {
        setIsBuffering(false);
        setHasFatalError(true);
        return;
      }

      setAvailableStreams(roomInfo.streams);

      // 匹配选定的清晰度，或自动回退到第一个最高画质流
      const matched = roomInfo.streams.find((s) => s.quality_name === qualityKey) || roomInfo.streams[0];
      setCurrentQuality(matched.quality_name);
      currentQualityRef.current = matched.quality_name;

      const rawStreamUrl = matched.flv_url || matched.m3u8_url;
      if (!rawStreamUrl) {
        setIsBuffering(false);
        setHasFatalError(true);
        return;
      }

      // 2. 获取本地代理转发地址 (绕过防盗链与跨域)
      const proxyUrl = await invoke<string>("get_stream_proxy_url", {
        streamUrl: rawStreamUrl,
        platform: room.platform,
      });

      // 3. 销毁旧播放器实例
      destroyPlayer();

      // 4. 创建 mpegts.js 极低延迟播放器
      if (mpegts.isSupported()) {
        const player = mpegts.createPlayer(
          {
            type: "flv",
            isLive: true,
            url: proxyUrl,
          },
          {
            enableWorker: true,
            lazyLoad: false,
            stashInitialSize: 256,              // 适度增加初始缓冲，保障推流平稳建立
            liveBufferLatencyChasing: true,     // 开启追帧模式
            liveBufferLatencyMaxLatency: 3.5,   // 延迟允许平滑追帧上限 (3.5s)
            liveBufferLatencyMinRemain: 0.8,    // 保持最低 0.8s 缓冲，坚决防断流与防 Early-EOF
            autoCleanupSourceBuffer: true,
          }
        );

        player.attachMediaElement(videoRef.current);
        player.load();

        const playPromise = player.play();
        if (playPromise) {
          playPromise.catch((e) => {
            console.warn("Autoplay was prevented or interrupted:", e);
          });
        }

        // 监听视频真实起播事件：一旦恢复播放，重置重连计数与失败标记
        if (videoRef.current) {
          videoRef.current.onplaying = () => {
            setIsBuffering(false);
            setReconnectCount(0);
            retryCountRef.current = 0;
            isReconnectingRef.current = false;
            setHasFatalError(false);
          };
        }

        player.on(mpegts.Events.ERROR, (type, detail, info) => {
          console.error("[Player] mpegts error:", type, detail, info);
          triggerReconnect(`推流异常 (${detail || type})`);
        });

        player.on(mpegts.Events.LOADING_COMPLETE, () => {
          console.warn("[Player] mpegts live stream completed unexpectedly");
          triggerReconnect("推流已中断 (Early-EOF)");
        });

        playerRef.current = player;
      } else {
        // 回退到原生 video src
        videoRef.current.src = proxyUrl;
        videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error("Failed to load and play stream:", err);
      triggerReconnect("接口请求失败");
    }
  }, [room.room_id, room.platform, destroyPlayer]);

  // 6. 触发断线自愈与指数退避重连机制
  const triggerReconnect = useCallback((reason: string) => {
    if (isReconnectingRef.current) return;
    isReconnectingRef.current = true;

    destroyPlayer();

    if (retryCountRef.current < MAX_RECONNECT_RETRIES) {
      retryCountRef.current += 1;
      const currentAttempt = retryCountRef.current;
      const backoffDelay = Math.min(1000 * currentAttempt, 4000);

      console.warn(`[Player] ${reason}. 正在尝试第 ${currentAttempt}/${MAX_RECONNECT_RETRIES} 次自动重连 (${backoffDelay}ms)...`);
      setReconnectCount(currentAttempt);
      setIsBuffering(true);

      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }

      reconnectTimeoutRef.current = window.setTimeout(() => {
        isReconnectingRef.current = false;
        loadAndPlayStream(currentQualityRef.current);
      }, backoffDelay);
    } else {
      console.error("[Player] 重连重试次数已耗尽");
      isReconnectingRef.current = false;
      setIsBuffering(false);
      setHasFatalError(true);
    }
  }, [destroyPlayer, loadAndPlayStream]);

  // 手动点击重试
  const handleManualRetry = () => {
    setHasFatalError(false);
    retryCountRef.current = 0;
    isReconnectingRef.current = false;
    setReconnectCount(0);
    loadAndPlayStream(currentQualityRef.current);
  };

  useEffect(() => {
    if (isOpen) {
      loadAndPlayStream(room.preferred_quality || "origin");
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      destroyPlayer();
    };
  }, [isOpen, room.preferred_quality, loadAndPlayStream, destroyPlayer]);

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

  // 播放 / 暂停切换
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
      danmakuEngineRef.current?.resume();
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      danmakuEngineRef.current?.pause();
    }
  };

  // 音量调整
  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      videoRef.current.muted = newVol === 0;
      setIsMuted(newVol === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    videoRef.current.muted = nextMuted;
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

  const qualityNameMap: Record<string, string> = {
    origin: "原画",
    blue_ray: "蓝光",
    uhd: "超清",
    hd: "高清",
    sd: "标清",
  };

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
                <span style={{ color: "#ef4444", fontWeight: 600, fontSize: "15px" }}>直播推流已中断</span>
                <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>多次重试未成功，主播可能已下播或网络异常</span>
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
            <div className={`player-control-bar ${showControls ? "visible" : ""}`}>
              <div className="control-left">
                <button className="control-btn" onClick={togglePlay} title={isPlaying ? "暂停" : "播放"}>
                  {isPlaying ? (
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </button>

                <div className="volume-control-wrap">
                  <button className="control-btn" onClick={toggleMute} title={isMuted ? "取消静音" : "静音"}>
                    {isMuted || volume === 0 ? "🔇" : volume > 0.5 ? "🔊" : "🔉"}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="volume-slider"
                  />
                </div>

                <span className="live-sync-badge">
                  <span className="dot" style={{ backgroundColor: reconnectCount > 0 ? "#f59e0b" : "#4ade80" }}></span>
                  {reconnectCount > 0 ? `重连中 (${reconnectCount}/${MAX_RECONNECT_RETRIES})` : "实时直播 (HTTP-FLV)"}
                </span>
              </div>

              <div className="control-right">
                {/* 清晰度切换选择 */}
                <div className="quality-selector-wrap">
                  <select
                    className="quality-select"
                    value={currentQuality}
                    onChange={(e) => {
                      if (reconnectTimeoutRef.current) {
                        window.clearTimeout(reconnectTimeoutRef.current);
                      }
                      retryCountRef.current = 0;
                      isReconnectingRef.current = false;
                      setReconnectCount(0);
                      setHasFatalError(false);
                      loadAndPlayStream(e.target.value);
                    }}
                  >
                    {uniqueStreams.map((s, idx) => (
                      <option key={`${s.quality_name}-${idx}`} value={s.quality_name}>
                        {qualityNameMap[s.quality_name] || s.quality_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 弹幕开关 */}
                <button
                  className={`control-btn danmaku-toggle ${danmakuVisible ? "active" : ""}`}
                  onClick={() => setDanmakuVisible(!danmakuVisible)}
                  title={danmakuVisible ? "关闭弹幕" : "开启弹幕"}
                >
                  弹
                </button>

                {/* 弹幕设置气泡触发 */}
                <button
                  className="control-btn"
                  onClick={() => setShowDanmakuSettings(!showDanmakuSettings)}
                  title="弹幕样式设置"
                >
                  <SettingsIcon size={16} />
                </button>

                {/* 全屏按钮 */}
                <button className="control-btn" onClick={toggleFullscreen} title={isFullscreen ? "退出全屏" : "全屏"}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 弹幕参数设置弹出框 */}
            {showDanmakuSettings && (
              <div className="danmaku-settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="setting-row">
                  <span>不透明度</span>
                  <input
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.1"
                    value={danmakuOpacity}
                    onChange={(e) => setDanmakuOpacity(parseFloat(e.target.value))}
                  />
                  <span>{Math.round(danmakuOpacity * 100)}%</span>
                </div>
                <div className="setting-row">
                  <span>字体大小</span>
                  <input
                    type="range"
                    min="14"
                    max="28"
                    step="2"
                    value={danmakuFontSize}
                    onChange={(e) => setDanmakuFontSize(parseInt(e.target.value))}
                  />
                  <span>{danmakuFontSize}px</span>
                </div>
                <div className="setting-row">
                  <span>滚动速度</span>
                  <div className="segmented-control">
                    {[
                      { l: "慢", v: 0.7 },
                      { l: "正常", v: 1.0 },
                      { l: "快", v: 1.4 },
                    ].map((s) => (
                      <button
                        key={s.l}
                        className={`seg-btn ${danmakuSpeed === s.v ? "active" : ""}`}
                        onClick={() => setDanmakuSpeed(s.v)}
                      >
                        {s.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：实时互动聊天流与发送底栏 */}
        <div className="player-chat-panel">
          <div className="chat-panel-header">
            <div className="header-left">
              <span className="chat-title">实时弹幕与互动</span>
              <span className="chat-count">({messages.length})</span>
            </div>
            <button className="icon-btn" onClick={() => setMessages([])} title="清空聊天记录">
              <TrashIcon size={14} />
            </button>
          </div>

          {/* 过滤切换标签 */}
          <div className="danmaku-tabs" style={{ padding: "6px 14px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
            <button
              className={`tab-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              全部
            </button>
            <button
              className={`tab-btn ${filter === "chat" ? "active" : ""}`}
              onClick={() => setFilter("chat")}
            >
              弹幕
            </button>
            <button
              className={`tab-btn ${filter === "gift" ? "active" : ""}`}
              onClick={() => setFilter("gift")}
            >
              礼物
            </button>
            <button
              className={`tab-btn ${filter === "other" ? "active" : ""}`}
              onClick={() => setFilter("other")}
            >
              互动
            </button>
          </div>

          {/* 消息滚动列表 */}
          <div className="chat-message-stream">
            {messages.length === 0 ? (
              <div className="chat-empty-hint">
                <p>正在接收弹幕中...</p>
                <span>发条弹幕和主播打个招呼吧</span>
              </div>
            ) : (
              messages
                .filter((m) => {
                  if (filter === "all") return true;
                  if (filter === "chat") return m.payload.type === "chat" || m.payload.type === "superchat";
                  if (filter === "gift") return m.payload.type === "gift" || m.payload.type === "superchat";
                  return m.payload.type === "enter" || m.payload.type === "like";
                })
                .map((m) => {
                  const time = new Date(m.timestamp_ms).toLocaleTimeString("zh-CN", { hour12: false });

                  if (m.payload.type === "superchat") {
                    return (
                      <div key={m.id} className="danmaku-msg-item superchat-card">
                        <div className="sc-header">
                          <span className="user-nickname">{m.user.nickname}</span>
                          <span className="sc-price">¥{m.payload.price_rmb?.toFixed(1)}</span>
                        </div>
                        <div className="sc-body">{m.payload.content}</div>
                        <div className="sc-time">{time}</div>
                      </div>
                    );
                  }

                  if (m.payload.type === "gift") {
                    return (
                      <div key={m.id} className="danmaku-msg-item gift-item">
                        <span className="msg-time">{time}</span>
                        <span className="user-nickname">{m.user.nickname}</span>
                        <span className="gift-text">
                          送出 <span className="gift-name">{m.payload.gift_name}</span> x
                          <span className="gift-count">{m.payload.count}</span>
                        </span>
                      </div>
                    );
                  }

                  if (m.payload.type === "enter") {
                    return (
                      <div key={m.id} className="danmaku-msg-item enter-item">
                        <span className="msg-time">{time}</span>
                        <span className="user-nickname">{m.user.nickname}</span>
                        <span className="enter-text">进入了直播间</span>
                      </div>
                    );
                  }

                  if (m.payload.type === "like") {
                    return (
                      <div key={m.id} className="danmaku-msg-item like-item">
                        <span className="msg-time">{time}</span>
                        <span className="user-nickname">{m.user.nickname}</span>
                        <span className="like-text">为主播点赞了</span>
                      </div>
                    );
                  }

                  return (
                    <div key={m.id} className="danmaku-msg-item chat-item">
                      <span className="msg-time">{time}</span>
                      {m.user.badge_name && (
                        <span className="user-badge">{m.user.badge_name}</span>
                      )}
                      <span className="user-nickname">{m.user.nickname}:</span>
                      <span className="chat-content" style={{ color: m.payload.color || undefined }}>
                        {m.payload.content}
                      </span>
                    </div>
                  );
                })
            )}
            <div ref={chatListEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
