import React, { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RoomConfig, LiveMessage } from "../types";
import { CloseIcon, TrashIcon } from "./Icons";

interface DanmakuDrawerProps {
  room: RoomConfig;
  isOpen: boolean;
  isRecording: boolean;
  onClose: () => void;
}

export const DanmakuDrawer: React.FC<DanmakuDrawerProps> = ({
  room,
  isOpen,
  isRecording,
  onClose,
}) => {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [filter, setFilter] = useState<'all' | 'chat' | 'gift' | 'other'>('all');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'stopped'>('connecting');
  const [isHovered, setIsHovered] = useState(false);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);

  const listEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 监听并启动弹幕预览
  useEffect(() => {
    if (!isOpen) return;

    let unlistenFn: (() => void) | null = null;
    let isMounted = true;

    const setupDanmaku = async () => {
      setStatus('connecting');
      try {
        // 1. 监听全局弹幕事件
        const unlisten = await listen<LiveMessage>("live-danmaku", (event) => {
          if (!isMounted) return;
          const msg = event.payload;
          if (msg.room_id === room.room_id) {
            setStatus('connected');
            setMessages((prev) => {
              const next = [...prev, msg];
              if (next.length > 500) {
                return next.slice(next.length - 500);
              }
              return next;
            });
          }
        });
        unlistenFn = unlisten;

        // 2. 检查是否正在运行，如果没在运行则启动独立预览
        const active = await invoke<boolean>("is_danmaku_active", { roomId: room.room_id });
        if (!active) {
          await invoke("start_danmaku_preview", {
            roomId: room.room_id,
            platform: room.platform,
          });
        }
        setStatus('connected');
      } catch (err) {
        console.error("Failed to start danmaku preview:", err);
        if (isMounted) setStatus('stopped');
      }
    };

    setupDanmaku();

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();

      // 如果当前没有在进行视频录制，则在抽屉关闭时停止弹幕连接以节省网络
      if (!isRecording) {
        invoke("stop_danmaku_preview", { roomId: room.room_id }).catch(() => {});
      }
    };
  }, [isOpen, room.room_id, room.platform, isRecording]);

  // 自动平滑滚动到底部
  useEffect(() => {
    if (!isHovered && listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: "smooth" });
      setHasNewMessagesBelow(false);
    } else if (isHovered) {
      setHasNewMessagesBelow(true);
    }
  }, [messages, isHovered]);

  const scrollToBottom = () => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setHasNewMessagesBelow(false);
  };

  const filteredMessages = useMemo(() => {
    if (filter === 'all') return messages;
    if (filter === 'chat') {
      return messages.filter(m => m.payload.type === 'chat' || m.payload.type === 'superchat');
    }
    if (filter === 'gift') {
      return messages.filter(m => m.payload.type === 'gift' || m.payload.type === 'superchat');
    }
    return messages.filter(m => m.payload.type === 'enter' || m.payload.type === 'like');
  }, [messages, filter]);

  // 统计数据
  const stats = useMemo(() => {
    let chatCount = 0;
    let giftCount = 0;
    let likeCount = 0;

    for (const m of messages) {
      if (m.payload.type === 'chat' || m.payload.type === 'superchat') chatCount++;
      else if (m.payload.type === 'gift') giftCount += m.payload.count || 1;
      else if (m.payload.type === 'like') likeCount += m.payload.count || 1;
    }

    return { chatCount, giftCount, likeCount };
  }, [messages]);

  if (!isOpen) return null;

  return (
    <div className="danmaku-drawer-backdrop" onClick={onClose}>
      <div className="danmaku-drawer" onClick={(e) => e.stopPropagation()}>
        {/* 顶部标题栏 */}
        <div className="danmaku-header">
          <div className="danmaku-header-left">
            <span className={`platform-pill ${room.platform}`}>
              {room.platform === "bilibili" ? "B站" : "抖音"}
            </span>
            <div className="danmaku-title-wrap">
              <span className="danmaku-anchor-name">{room.anchor_name}</span>
              <span className="danmaku-room-id">ID: {room.room_id}</span>
            </div>
            <span className={`danmaku-status-dot ${status}`}>
              {status === 'connected' ? '实时接收中' : status === 'connecting' ? '连接中...' : '已断开'}
            </span>
          </div>
          <div className="danmaku-header-right">
            <button
              className="icon-btn"
              title="清屏"
              onClick={() => setMessages([])}
            >
              <TrashIcon />
            </button>
            <button className="icon-btn" title="关闭" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* 实时互动统计栏 */}
        <div className="danmaku-stats-bar">
          <div className="stat-pill">
            <span className="stat-label">弹幕</span>
            <span className="stat-val">{stats.chatCount}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">礼物</span>
            <span className="stat-val gift">{stats.giftCount}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label">点赞</span>
            <span className="stat-val like">{stats.likeCount}</span>
          </div>
        </div>

        {/* 过滤切换标签 */}
        <div className="danmaku-tabs">
          <button
            className={`tab-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部 ({messages.length})
          </button>
          <button
            className={`tab-btn ${filter === 'chat' ? 'active' : ''}`}
            onClick={() => setFilter('chat')}
          >
            弹幕 ({stats.chatCount})
          </button>
          <button
            className={`tab-btn ${filter === 'gift' ? 'active' : ''}`}
            onClick={() => setFilter('gift')}
          >
            礼物
          </button>
          <button
            className={`tab-btn ${filter === 'other' ? 'active' : ''}`}
            onClick={() => setFilter('other')}
          >
            进场/互动
          </button>
        </div>

        {/* 消息滚动流 */}
        <div
          className="danmaku-message-list"
          ref={scrollContainerRef}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {filteredMessages.length === 0 ? (
            <div className="danmaku-empty-placeholder">
              <p>暂无消息，正在实时监听直播间...</p>
              <span className="empty-sub">主播开播时，观众发送的弹幕和礼物将在这里实时呈现</span>
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const timeStr = new Date(msg.timestamp_ms).toLocaleTimeString("zh-CN", {
                hour12: false,
              });

              if (msg.payload.type === 'superchat') {
                return (
                  <div key={msg.id} className="danmaku-msg-item superchat-card">
                    <div className="sc-header">
                      <span className="user-nickname">{msg.user.nickname}</span>
                      <span className="sc-price">¥{msg.payload.price_rmb?.toFixed(1)}</span>
                    </div>
                    <div className="sc-body">{msg.payload.content}</div>
                    <div className="sc-time">{timeStr}</div>
                  </div>
                );
              }

              if (msg.payload.type === 'gift') {
                return (
                  <div key={msg.id} className="danmaku-msg-item gift-item">
                    <span className="msg-time">{timeStr}</span>
                    <span className="user-nickname">{msg.user.nickname}</span>
                    <span className="gift-text">
                      送出 <span className="gift-name">{msg.payload.gift_name}</span> x
                      <span className="gift-count">{msg.payload.count}</span>
                    </span>
                  </div>
                );
              }

              if (msg.payload.type === 'enter') {
                return (
                  <div key={msg.id} className="danmaku-msg-item enter-item">
                    <span className="msg-time">{timeStr}</span>
                    <span className="user-nickname">{msg.user.nickname}</span>
                    <span className="enter-text">进入了直播间</span>
                  </div>
                );
              }

              if (msg.payload.type === 'like') {
                return (
                  <div key={msg.id} className="danmaku-msg-item like-item">
                    <span className="msg-time">{timeStr}</span>
                    <span className="user-nickname">{msg.user.nickname}</span>
                    <span className="like-text">为主播点赞了</span>
                  </div>
                );
              }

              // Normal chat message
              return (
                <div key={msg.id} className="danmaku-msg-item chat-item">
                  <span className="msg-time">{timeStr}</span>
                  {msg.user.badge_name && (
                    <span className="user-badge" title={`等级 ${msg.user.badge_level || 1}`}>
                      {msg.user.badge_name}
                      {msg.user.badge_level ? ` ${msg.user.badge_level}` : ''}
                    </span>
                  )}
                  <span className="user-nickname">{msg.user.nickname}:</span>
                  <span
                    className="chat-content"
                    style={{ color: msg.payload.color || undefined }}
                  >
                    {msg.payload.content}
                  </span>
                </div>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* 鼠标悬停暂停滚动时的提示按钮 */}
        {hasNewMessagesBelow && (
          <button className="danmaku-scroll-bottom-btn" onClick={scrollToBottom}>
            ↓ 底部有新消息（点击回到底部）
          </button>
        )}
      </div>
    </div>
  );
};
