import React from "react";
import { LiveMessage } from "../../types";
import { TrashIcon } from "../Icons";

interface LiveChatPanelProps {
  messages: LiveMessage[];
  filter: "all" | "chat" | "gift" | "other";
  setFilter: (filter: "all" | "chat" | "gift" | "other") => void;
  onClear: () => void;
  chatListEndRef: React.RefObject<HTMLDivElement | null>;
}

export const LiveChatPanel: React.FC<LiveChatPanelProps> = ({
  messages,
  filter,
  setFilter,
  onClear,
  chatListEndRef,
}) => {
  return (
    <div className="player-chat-panel">
      <div className="chat-panel-header">
        <div className="header-left">
          <span className="chat-title">实时弹幕与互动</span>
          <span className="chat-count">({messages.length})</span>
        </div>
        <button className="icon-btn" onClick={onClear} title="清空聊天记录">
          <TrashIcon size={14} />
        </button>
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
