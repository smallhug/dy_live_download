import React from "react";

export interface DialogOptions {
  type: "alert" | "confirm";
  title?: string;
  message: string;
  kind?: "info" | "error" | "warning";
  confirmText?: string;
  cancelText?: string;
}

interface DialogModalProps extends DialogOptions {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const kindConfig = {
  info: { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  error: { color: "#ef4444", bg: "#fef2f2", border: "#fee2e2" },
  warning: { color: "#f59e0b", bg: "#fffbeb", border: "#fde68a" },
};

export const DialogModal: React.FC<DialogModalProps> = ({
  type,
  title,
  message,
  kind = type === "confirm" ? "warning" : "info",
  confirmText = type === "confirm" ? "确定" : "好的",
  cancelText = "取消",
  isOpen,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;
  const cfg = kindConfig[kind];

  return (
    <div className="modal-overlay" onClick={type === "alert" ? onConfirm : onCancel}>
      <div className="modal-content" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="modal-header">
            <h2 style={{ fontSize: "15px" }}>{title}</h2>
            <button className="close-btn" onClick={type === "alert" ? onConfirm : onCancel}>&times;</button>
          </div>
        )}
        <div style={{
          padding: "12px 14px",
          borderRadius: "8px",
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          color: cfg.color,
          fontSize: "13px",
          lineHeight: "1.6",
          marginBottom: "16px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}>
          {message}
        </div>
        <div className="modal-actions">
          {type === "confirm" && (
            <button className="btn btn-secondary" onClick={onCancel}>{cancelText}</button>
          )}
          <button className="btn btn-primary" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
};
