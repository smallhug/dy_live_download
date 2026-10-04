import React from "react";
import { LiveMessage } from "../../types";
import { TrashIcon } from "../Icons";
import { formatCount, formatCurrency } from "../../utils";

interface LiveChatPanelProps {
  messages: LiveMessage[];
  filter: "all" | "chat" | "gift" | "other";
  setFilter: (filter: "all" | "chat" | "gift" | "other") => void;
  onClear: () => void;
  chatListEndRef: React.RefObject<HTMLDivElement | null>;
  totalLikes?: number;
  stats: {
    chatCount: number;
    giftCount: number;
    giftTotalRmb: number;
    giftBreakdown: GiftSummaryItem[];
    topGifters: GifterItem[];
  };
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

export const LiveChatPanel: React.FC<LiveChatPanelProps> = ({
  messages,
  filter,
  setFilter,
  onClear,
  chatListEndRef,
  totalLikes = 0,
  stats,
}) => {
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
              if (filter === "chat")
                return m.payload.type === "chat" || m.payload.type === "superchat";
              if (filter === "gift")
                return m.payload.type === "gift" || m.payload.type === "superchat";
              return m.payload.type === "enter" || m.payload.type === "like";
            })
            .map((m) => {
              const time = new Date(m.timestamp_ms).toLocaleTimeString("zh-CN", {
                hour12: false,
              });

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
                const totalRmb = ((m.payload.price_cents || 0) * (m.payload.count || 1)) / 100;
                return (
                  <div key={m.id} className="danmaku-msg-item gift-item">
                    <span className="msg-time">{time}</span>
                    <span className="user-nickname">{m.user.nickname}</span>
                    <span className="gift-text">
                      送出 <span className="gift-name">{m.payload.gift_name}</span> x
                      <span className="gift-count">{m.payload.count}</span>
                      {totalRmb > 0 && (
                        <span className="gift-value-tag"> (¥{totalRmb.toFixed(1)})</span>
                      )}
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
                    <span className="user-nickname">{m.user.nickname || "观众"}</span>
                    <span className="like-text">
                      为主播点赞了
                      {m.payload.count && m.payload.count > 1 ? ` x${m.payload.count}` : ""}
                    </span>
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
                  <span
                    className="chat-content"
                    style={{ color: m.payload.color || undefined }}
                  >
                    {m.payload.content}
                  </span>
                </div>
              );
            })
        )}
        <div ref={chatListEndRef} />
      </div>
    </div>
  );
};
