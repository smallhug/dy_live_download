import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { LiveMessage } from "../../types";
import { TrashIcon } from "../Icons";
import { formatCount, formatCurrency } from "../../utils";

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

interface LiveChatPanelProps {
  messages: LiveMessage[];
  filter: "all" | "chat" | "gift" | "other";
  setFilter: (filter: "all" | "chat" | "gift" | "other") => void;
  onClear: () => void;
  chatListEndRef?: React.RefObject<HTMLDivElement | null>;
  totalLikes?: number;
  stats: {
    chatCount: number;
    giftCount: number;
    giftTotalRmb: number;
    giftBreakdown: GiftSummaryItem[];
    topGifters: GifterItem[];
  };
}

// 记忆化单条消息组件：避免高频新消息追加时历史节点重复执行重排重绘
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

export const LiveChatPanel: React.FC<LiveChatPanelProps> = ({
  messages,
  filter,
  setFilter,
  onClear,
  totalLikes = 0,
  stats,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);

  // 硬件加速极速吸底（彻底替代 scrollIntoView smooth 动画插值引发的重排风暴）
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setHasNewMessagesBelow(false);
    } else {
      setHasNewMessagesBelow(true);
    }
  }, [messages]);

  // 滚动监听判断是否贴紧底部
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

  return (
    <div className="player-chat-panel">
      <div className="chat-panel-header">
        <div className="header-left">
          <span className="chat-title">实时互动与弹幕</span>
          <span className="chat-count">({messages.length})</span>
        </div>
        <button className="icon-btn" onClick={onClear} title="清空聊天记录">
          <TrashIcon size={14} />
        </button>
      </div>

      {/* 实时统计状态栏 */}
      <div className="player-chat-stats-bar">
        <div className="chat-stat-item">
          <span className="label">弹幕:</span>
          <span className="val">{stats.chatCount}</span>
        </div>
        <div
          className="chat-stat-item"
          title={`累计礼物: ${stats.giftCount} 件，估值: ${formatCurrency(stats.giftTotalRmb)}`}
        >
          <span className="label">礼物:</span>
          <span className="val gift">
            {stats.giftCount}
            {stats.giftTotalRmb > 0 && ` (¥${stats.giftTotalRmb.toFixed(0)})`}
          </span>
        </div>
        <div
          className="chat-stat-item"
          title={`当前直播间累计总点赞: ${totalLikes.toLocaleString()} 次`}
        >
          <span className="label">总点赞:</span>
          <span className="val like">{formatCount(totalLikes)}</span>
        </div>
      </div>

      {/* 过滤切换标签 */}
      <div
        className="danmaku-tabs"
        style={{
          padding: "6px 14px",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc",
        }}
      >
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

      {/* 礼物专区统计概览卡片 */}
      {filter === "gift" && (
        <div className="gift-summary-banner player-mode">
          <div className="gift-summary-row">
            <div className="summary-item">
              <span className="summary-label">礼物数</span>
              <span className="summary-num">{stats.giftCount} 件</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">预估收益</span>
              <span className="summary-num highlight">{formatCurrency(stats.giftTotalRmb)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">种类</span>
              <span className="summary-num">{stats.giftBreakdown.length} 种</span>
            </div>
          </div>

          {stats.giftBreakdown.length > 0 && (
            <div className="gift-tags-scroll">
              {stats.giftBreakdown.slice(0, 5).map((g) => (
                <span key={g.name} className="gift-tag-badge">
                  <span className="tag-name">{g.name}</span>
                  <span className="tag-count">x{g.count}</span>
                  {g.totalRmb > 0 && <span className="tag-rmb">¥{g.totalRmb.toFixed(1)}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 消息滚动列表（硬件加速瞬时滚动，零平滑死锁） */}
      <div
        className="chat-message-stream"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ position: "relative" }}
      >
        {filteredMessages.length === 0 ? (
          <div className="chat-empty-hint">
            <p>正在接收弹幕中...</p>
            <span>发条弹幕和主播打个招呼吧</span>
          </div>
        ) : (
          filteredMessages.map((msg, index) => (
            <MessageItem key={`${msg.id}_${index}`} msg={msg} />
          ))
        )}
      </div>

      {/* 向上翻阅历史消息时的快速回到底部提示按钮 */}
      {hasNewMessagesBelow && (
        <button
          className="danmaku-scroll-bottom-btn"
          style={{ position: "relative", margin: "4px 8px 8px" }}
          onClick={scrollToBottom}
        >
          ↓ 底部有新消息（点击回到底部）
        </button>
      )}
    </div>
  );
};
