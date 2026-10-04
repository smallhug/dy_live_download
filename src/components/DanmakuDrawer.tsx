import React, { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RoomConfig, LiveMessage } from "../types";
import { CloseIcon, TrashIcon } from "./Icons";
import { formatCount, formatCurrency } from "../utils";

interface DanmakuDrawerProps {
  room: RoomConfig;
  isOpen: boolean;
  isRecording: boolean;
  onClose: () => void;
}

interface GiftSummaryItem {
  name: string;
  count: number;
  totalRmb: number;
}

interface GifterItem {
  userId: string;
  nickname: string;
  totalRmb: number;
  giftCount: number;
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
  const [totalLikes, setTotalLikes] = useState<number>(0);

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

            // 维护当前直播间累计总点赞数
            if (msg.payload.type === 'like') {
              if (msg.payload.total && msg.payload.total > 0) {
                setTotalLikes((prev) => Math.max(prev, msg.payload.total!));
              } else {
                setTotalLikes((prev) => prev + (msg.payload.count || 1));
              }
            }

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

  // 全面礼物统计与互动数据分析
  const stats = useMemo(() => {
    let chatCount = 0;
    let giftCount = 0;
    let giftTotalRmb = 0;

    const giftMap = new Map<string, { count: number; totalRmb: number }>();
    const gifterMap = new Map<string, GifterItem>();

    for (const m of messages) {
      if (m.payload.type === 'chat') {
        chatCount++;
      } else if (m.payload.type === 'superchat') {
        chatCount++;
        const rmb = m.payload.price_rmb || 0;
        giftCount++;
        giftTotalRmb += rmb;

        // SC 计入礼物榜
        const cur = giftMap.get("醒目留言") || { count: 0, totalRmb: 0 };
        cur.count++;
        cur.totalRmb += rmb;
        giftMap.set("醒目留言", cur);

        // 送礼用户榜
        const uid = m.user.user_id || m.user.nickname;
        const gifter = gifterMap.get(uid) || {
          userId: uid,
          nickname: m.user.nickname,
          totalRmb: 0,
          giftCount: 0,
        };
        gifter.totalRmb += rmb;
        gifter.giftCount++;
        gifterMap.set(uid, gifter);
      } else if (m.payload.type === 'gift') {
        const count = m.payload.count || 1;
        const rmb = ((m.payload.price_cents || 0) * count) / 100;
        giftCount += count;
        giftTotalRmb += rmb;

        // 礼物名称汇总
        const name = m.payload.gift_name || "未知礼物";
        const cur = giftMap.get(name) || { count: 0, totalRmb: 0 };
        cur.count += count;
        cur.totalRmb += rmb;
        giftMap.set(name, cur);

        // 送礼用户榜
        const uid = m.user.user_id || m.user.nickname;
        const gifter = gifterMap.get(uid) || {
          userId: uid,
          nickname: m.user.nickname,
          totalRmb: 0,
          giftCount: 0,
        };
        gifter.totalRmb += rmb;
        gifter.giftCount += count;
        gifterMap.set(uid, gifter);
      }
    }

    // 礼物排行榜
    const giftBreakdown: GiftSummaryItem[] = Array.from(giftMap.entries())
      .map(([name, data]) => ({ name, count: data.count, totalRmb: data.totalRmb }))
      .sort((a, b) => b.totalRmb - a.totalRmb || b.count - a.count);

    // 送礼观众榜单
    const topGifters: GifterItem[] = Array.from(gifterMap.values())
      .sort((a, b) => b.totalRmb - a.totalRmb || b.giftCount - a.giftCount)
      .slice(0, 5);

    return {
      chatCount,
      giftCount,
      giftTotalRmb,
      giftBreakdown,
      topGifters,
    };
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
              title="清空聊天记录（保留点赞与礼物统计）"
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
          <div className="stat-pill" title={`累计礼物: ${stats.giftCount} 件，估值: ${formatCurrency(stats.giftTotalRmb)}`}>
            <span className="stat-label">礼物</span>
            <span className="stat-val gift">
              {stats.giftCount}
              {stats.giftTotalRmb > 0 && (
                <span className="stat-sub-val"> ({formatCurrency(stats.giftTotalRmb)})</span>
              )}
            </span>
          </div>
          <div className="stat-pill" title={`当前直播间累计总点赞: ${totalLikes.toLocaleString()} 次`}>
            <span className="stat-label">总点赞</span>
            <span className="stat-val like">{formatCount(totalLikes)}</span>
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
            礼物 ({stats.giftCount})
          </button>
          <button
            className={`tab-btn ${filter === 'other' ? 'active' : ''}`}
            onClick={() => setFilter('other')}
          >
            进场/互动
          </button>
        </div>

        {/* 礼物专区统计概览卡片 (仅在切换到礼物 Tab 时展示) */}
        {filter === 'gift' && (
          <div className="gift-summary-banner">
            <div className="gift-summary-row">
              <div className="summary-item">
                <span className="summary-label">礼物总数</span>
                <span className="summary-num">{stats.giftCount} 件</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">预估收益</span>
                <span className="summary-num highlight">{formatCurrency(stats.giftTotalRmb)}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">礼物种类</span>
                <span className="summary-num">{stats.giftBreakdown.length} 种</span>
              </div>
            </div>

            {/* 礼物热门排行胶囊 */}
            {stats.giftBreakdown.length > 0 && (
              <div className="gift-tags-scroll">
                {stats.giftBreakdown.slice(0, 6).map((g) => (
                  <span key={g.name} className="gift-tag-badge">
                    <span className="tag-name">{g.name}</span>
                    <span className="tag-count">x{g.count}</span>
                    {g.totalRmb > 0 && (
                      <span className="tag-rmb">¥{g.totalRmb.toFixed(1)}</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* 榜一送礼观众 */}
            {stats.topGifters.length > 0 && stats.topGifters[0].totalRmb > 0 && (
              <div className="gift-top-user">
                <span className="crown-icon">👑 贡献榜首:</span>
                <span className="top-name">{stats.topGifters[0].nickname}</span>
                <span className="top-val">{formatCurrency(stats.topGifters[0].totalRmb)}</span>
              </div>
            )}
          </div>
        )}

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
                const totalRmb = ((msg.payload.price_cents || 0) * (msg.payload.count || 1)) / 100;
                return (
                  <div key={msg.id} className="danmaku-msg-item gift-item">
                    <span className="msg-time">{timeStr}</span>
                    <span className="user-nickname">{msg.user.nickname}</span>
                    <span className="gift-text">
                      送出 <span className="gift-name">{msg.payload.gift_name}</span> x
                      <span className="gift-count">{msg.payload.count}</span>
                      {totalRmb > 0 && (
                        <span className="gift-value-tag"> (¥{totalRmb.toFixed(1)})</span>
                      )}
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
                    <span className="user-nickname">{msg.user.nickname || "观众"}</span>
                    <span className="like-text">
                      为主播点赞了
                      {msg.payload.count && msg.payload.count > 1 ? ` x${msg.payload.count}` : ''}
                    </span>
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
