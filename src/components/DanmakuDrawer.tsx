import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
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

// 记忆化单条消息组件：避免列表高频更新时 200 个旧节点重复重排重绘
const MessageItem = React.memo<{ msg: LiveMessage }>(({ msg }) => {
  const timeStr = useMemo(() => {
    return new Date(msg.timestamp_ms).toLocaleTimeString("zh-CN", {
      hour12: false,
    });
  }, [msg.timestamp_ms]);

  if (msg.payload.type === "superchat") {
    return (
      <div className="danmaku-msg-item superchat-card">
        <div className="sc-header">
          <span className="user-nickname">{msg.user.nickname}</span>
          <span className="sc-price">¥{msg.payload.price_rmb?.toFixed(1)}</span>
        </div>
        <div className="sc-body">{msg.payload.content}</div>
        <div className="sc-time">{timeStr}</div>
      </div>
    );
  }

  if (msg.payload.type === "gift") {
    const totalRmb = ((msg.payload.price_cents || 0) * (msg.payload.count || 1)) / 100;
    return (
      <div className="danmaku-msg-item gift-item">
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

  if (msg.payload.type === "enter") {
    return (
      <div className="danmaku-msg-item enter-item">
        <span className="msg-time">{timeStr}</span>
        <span className="user-nickname">{msg.user.nickname}</span>
        <span className="enter-text">进入了直播间</span>
      </div>
    );
  }

  if (msg.payload.type === "like") {
    return (
      <div className="danmaku-msg-item like-item">
        <span className="msg-time">{timeStr}</span>
        <span className="user-nickname">{msg.user.nickname || "观众"}</span>
        <span className="like-text">
          为主播点赞了
          {msg.payload.count && msg.payload.count > 1 ? ` x${msg.payload.count}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="danmaku-msg-item chat-item">
      <span className="msg-time">{timeStr}</span>
      {msg.user.badge_name && (
        <span className="user-badge" title={`等级 ${msg.user.badge_level || 1}`}>
          {msg.user.badge_name}
          {msg.user.badge_level ? ` ${msg.user.badge_level}` : ""}
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
});

MessageItem.displayName = "MessageItem";

export const DanmakuDrawer: React.FC<DanmakuDrawerProps> = ({
  room,
  isOpen,
  isRecording,
  onClose,
}) => {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [filter, setFilter] = useState<"all" | "chat" | "gift" | "other">("all");
  const [status, setStatus] = useState<"connecting" | "connected" | "stopped">("connecting");
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [totalLikes, setTotalLikes] = useState<number>(0);

  // 会话级累计统计数据（只增不减）
  const [stats, setStats] = useState<{
    chatCount: number;
    giftCount: number;
    giftTotalRmb: number;
    giftBreakdown: GiftSummaryItem[];
    topGifters: GifterItem[];
  }>({
    chatCount: 0,
    giftCount: 0,
    giftTotalRmb: 0,
    giftBreakdown: [],
    topGifters: [],
  });

  // 内部高频缓冲区与引用
  const incomingBufferRef = useRef<LiveMessage[]>([]);
  const giftMapRef = useRef<Map<string, { count: number; totalRmb: number }>>(new Map());
  const gifterMapRef = useRef<Map<string, GifterItem>>(new Map());
  const maxLikesRef = useRef<number>(0);
  const isNearBottomRef = useRef<boolean>(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 1. 批量排空定时器（120ms 节流合并写入，将每秒几十次 React 调度降至固定的 ~8 次）
  useEffect(() => {
    if (!isOpen) return;

    const flushTimer = setInterval(() => {
      const buffer = incomingBufferRef.current;
      if (buffer.length === 0) return;

      incomingBufferRef.current = [];

      let chatInc = 0;
      let giftInc = 0;
      let giftRmbInc = 0;

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
      }

      // 批量更新全局累计指标
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

      // 批量将消息推入视窗（严格按 id 去重，最多保留 200 条节点以保证 DOM 极速渲染）
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const uniqueItems: LiveMessage[] = [];
        for (const msg of buffer) {
          if (!existingIds.has(msg.id)) {
            existingIds.add(msg.id);
            uniqueItems.push(msg);
          }
        }
        if (uniqueItems.length === 0) return prev;
        const next = prev.concat(uniqueItems);
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });

      // 硬件加速极速吸底（彻底废除引起浏览器死锁重排的 scrollIntoView smooth）
      if (isNearBottomRef.current && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        setHasNewMessagesBelow(false);
      } else {
        setHasNewMessagesBelow(true);
      }
    }, 120);

    return () => clearInterval(flushTimer);
  }, [isOpen]);

  // 2. 监听全局弹幕事件并写入缓冲区（纯 JS 内存操作，耗时 < 0.01ms）
  useEffect(() => {
    if (!isOpen) return;

    let unlistenFn: (() => void) | null = null;
    let isMounted = true;

    const setupDanmaku = async () => {
      setStatus("connecting");
      try {
        const unlisten = await listen<LiveMessage>("live-danmaku", (event) => {
          if (!isMounted) return;
          const msg = event.payload;
          if (msg.room_id === room.room_id) {
            setStatus("connected");

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
        unlistenFn = unlisten;

        const active = await invoke<boolean>("is_danmaku_active", { roomId: room.room_id });
        if (!active) {
          await invoke("start_danmaku_preview", {
            roomId: room.room_id,
            platform: room.platform,
          });
        }
        // 按需激活后端 IPC 广播
        await invoke("subscribe_danmaku", { roomId: room.room_id });
        setStatus("connected");
      } catch (err) {
        console.error("Failed to start danmaku preview:", err);
        if (isMounted) setStatus("stopped");
      }
    };

    setupDanmaku();

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
      // 熔断后端 IPC 广播，释放系统 CPU 开销
      invoke("unsubscribe_danmaku", { roomId: room.room_id }).catch(() => {});
      if (!isRecording) {
        invoke("stop_danmaku_preview", { roomId: room.room_id }).catch(() => {});
      }
    };
  }, [isOpen, room.room_id, room.platform, isRecording]);

  // 3. 用户滚动监听：判断是否处于视窗底部
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceToBottom < 45;
    isNearBottomRef.current = near;
    if (near) {
      setHasNewMessagesBelow(false);
    }
  }, []);

  const scrollToBottom = () => {
    isNearBottomRef.current = true;
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    setHasNewMessagesBelow(false);
  };

  const filteredMessages = useMemo(() => {
    if (filter === "all") return messages;
    if (filter === "chat") {
      return messages.filter((m) => m.payload.type === "chat" || m.payload.type === "superchat");
    }
    if (filter === "gift") {
      return messages.filter((m) => m.payload.type === "gift" || m.payload.type === "superchat");
    }
    return messages.filter((m) => m.payload.type === "enter" || m.payload.type === "like");
  }, [messages, filter]);

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
              {status === "connected" ? "实时接收中" : status === "connecting" ? "连接中..." : "已断开"}
            </span>
          </div>
          <div className="danmaku-header-right">
            <button
              className="icon-btn"
              title="清空聊天视窗（保留累计点赞与礼物统计）"
              onClick={() => {
                setMessages([]);
                incomingBufferRef.current = [];
              }}
            >
              <TrashIcon />
            </button>
            <button className="icon-btn" title="关闭" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* 实时互动统计栏（累计统计，永不减少） */}
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
            className={`tab-btn ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            全部 ({messages.length})
          </button>
          <button
            className={`tab-btn ${filter === "chat" ? "active" : ""}`}
            onClick={() => setFilter("chat")}
          >
            弹幕 ({stats.chatCount})
          </button>
          <button
            className={`tab-btn ${filter === "gift" ? "active" : ""}`}
            onClick={() => setFilter("gift")}
          >
            礼物 ({stats.giftCount})
          </button>
          <button
            className={`tab-btn ${filter === "other" ? "active" : ""}`}
            onClick={() => setFilter("other")}
          >
            进场/互动
          </button>
        </div>

        {/* 礼物专区统计概览卡片 (仅在切换到礼物 Tab 时展示) */}
        {filter === "gift" && (
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
          onScroll={handleScroll}
        >
          {filteredMessages.length === 0 ? (
            <div className="danmaku-empty-placeholder">
              <p>暂无消息，正在实时监听直播间...</p>
              <span className="empty-sub">主播开播时，观众发送的弹幕和礼物将在这里实时呈现</span>
            </div>
          ) : (
            filteredMessages.map((msg, index) => (
              <MessageItem key={`${msg.id}_${index}`} msg={msg} />
            ))
          )}
        </div>

        {/* 用户往上翻阅时的回到底部快捷按钮 */}
        {hasNewMessagesBelow && (
          <button className="danmaku-scroll-bottom-btn" onClick={scrollToBottom}>
            ↓ 底部有新消息（点击回到底部）
          </button>
        )}
      </div>
    </div>
  );
};
