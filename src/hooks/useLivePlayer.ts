import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import mpegts from "mpegts.js";
import { RoomConfig, LiveRoomInfo, LiveStream } from "../types";

export interface UseLivePlayerOptions {
  room: RoomConfig;
  isOpen: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export function useLivePlayer({
  room,
  isOpen,
  videoRef,
  onPlayStateChange,
}: UseLivePlayerOptions) {
  const playerRef = useRef<mpegts.Player | null>(null);
  const [availableStreams, setAvailableStreams] = useState<LiveStream[]>([]);
  const [currentQuality, setCurrentQuality] = useState<string>("origin");
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(true);
  const [reconnectCount, setReconnectCount] = useState<number>(0);
  const [hasFatalError, setHasFatalError] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const MAX_RECONNECT_RETRIES = 5;
  const retryCountRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isReconnectingRef = useRef<boolean>(false);
  const currentQualityRef = useRef<string>("origin");

  // 相同画质去重
  const uniqueStreams = useMemo(() => {
    const seen = new Set<string>();
    return availableStreams.filter((s) => {
      if (seen.has(s.quality_name)) return false;
      seen.add(s.quality_name);
      return true;
    });
  }, [availableStreams]);

  // 销毁当前播放器实例
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

  // 解析并挂载推流
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
  }, [room.room_id, room.platform, destroyPlayer, videoRef]);

  // 触发断线自愈与指数退避重连机制
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
  const handleManualRetry = useCallback(() => {
    setHasFatalError(false);
    retryCountRef.current = 0;
    isReconnectingRef.current = false;
    setReconnectCount(0);
    loadAndPlayStream(currentQualityRef.current);
  }, [loadAndPlayStream]);

  // 清晰度切换
  const changeQuality = useCallback((qualityKey: string) => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
    }
    retryCountRef.current = 0;
    isReconnectingRef.current = false;
    setReconnectCount(0);
    setHasFatalError(false);
    loadAndPlayStream(qualityKey);
  }, [loadAndPlayStream]);

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

  // 播放 / 暂停切换
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
      onPlayStateChange?.(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      onPlayStateChange?.(false);
    }
  }, [videoRef, onPlayStateChange]);

  // 音量调整
  const handleVolumeChange = useCallback((newVol: number) => {
    setVolume(newVol);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      videoRef.current.muted = newVol === 0;
      setIsMuted(newVol === 0);
    }
  }, [videoRef]);

  // 静音切换
  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    videoRef.current.muted = nextMuted;
  }, [videoRef, isMuted]);

  return {
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
  };
}
