import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

// ─── 类型定义 ────────────────────────────────────────────
interface ConvertProgress {
  task_id: string;
  status: "running" | "done" | "error";
  percent: number;
  time: string;
  speed: string;
  error_msg?: string;
  output_path: string;
}

interface ConvertTask {
  taskId: string;
  inputPath: string;
  outputPath: string;
  progress: ConvertProgress | null;
}

interface ConvertModalProps {
  isOpen: boolean;
  onClose: () => void;
  ffmpegPath: string;
  defaultSaveDir: string;
}

// ─── 支持的格式 ──────────────────────────────────────────
const OUTPUT_FORMATS = [
  { ext: "mp4", label: "MP4（H.264 / 通用）", icon: "🎬" },
  { ext: "mkv", label: "MKV（万能容器）",     icon: "📦" },
  { ext: "flv", label: "FLV（推流存档）",      icon: "📡" },
  { ext: "ts",  label: "TS（传输流）",         icon: "📺" },
  { ext: "mov", label: "MOV（苹果 QuickTime）", icon: "🍎" },
  { ext: "avi", label: "AVI（经典格式）",       icon: "💾" },
];

// ─── 工具函数 ────────────────────────────────────────────
function guessOutputPath(inputPath: string, ext: string, saveDir: string): string {
  if (!inputPath.trim()) return "";
  // 提取文件名（不含扩展名）
  const sep = inputPath.includes("\\") ? "\\" : "/";
  const parts = inputPath.split(sep);
  const filename = parts[parts.length - 1];
  const basename = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  const dir = saveDir.trim() || parts.slice(0, -1).join(sep);
  const dirSep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${dirSep}${basename}_converted.${ext}`;
}

function genTaskId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── 主组件 ──────────────────────────────────────────────
export const ConvertModal: React.FC<ConvertModalProps> = ({
  isOpen,
  onClose,
  ffmpegPath,
  defaultSaveDir,
}) => {
  const [inputPath, setInputPath]     = useState("");
  const [outputExt, setOutputExt]     = useState("mp4");
  const [outputPath, setOutputPath]   = useState("");
  const [tasks, setTasks]             = useState<ConvertTask[]>([]);
  const [isDragging, setIsDragging]   = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // 自动更新输出路径
  useEffect(() => {
    setOutputPath(guessOutputPath(inputPath, outputExt, defaultSaveDir));
  }, [inputPath, outputExt, defaultSaveDir]);

  // 监听后端事件
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;

    listen<ConvertProgress>("convert-progress", (event) => {
      if (!mounted) return;
      const p = event.payload;
      setTasks((prev) =>
        prev.map((t) =>
          t.taskId === p.task_id ? { ...t, progress: p } : t
        )
      );
    }).then((fn) => {
      unlistenRef.current = fn;
    });

    return () => {
      mounted = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // ── 拖放处理 ──
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      const p: string = (file as any).path || file.name;
      setInputPath(p);
    }
  };

  // ── 系统文件选择器：选择源文件 ──
  const handleBrowseInput = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "视频文件", extensions: ["mp4", "mkv", "flv", "ts", "mov", "avi", "m4v", "wmv", "rmvb", "webm"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (selected && typeof selected === "string") {
      setInputPath(selected);
    }
  };

  // ── 系统文件保存器：选择输出路径 ──
  const handleBrowseOutput = async () => {
    const suggested = outputPath || guessOutputPath(inputPath, outputExt, defaultSaveDir);
    const suggestedName = suggested.split(/[\\/]/).pop() || `output.${outputExt}`;
    const result = await saveDialog({
      defaultPath: suggestedName,
      filters: [
        { name: outputExt.toUpperCase(), extensions: [outputExt] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (result) {
      setOutputPath(result);
    }
  };

  // ── 开始转换 ──
  const handleStartConvert = async () => {
    if (!inputPath.trim()) { alert("请先输入或拖入源视频文件路径"); return; }
    if (!outputPath.trim()) { alert("请设置输出文件路径"); return; }

    const taskId = genTaskId();
    const newTask: ConvertTask = {
      taskId,
      inputPath,
      outputPath,
      progress: { task_id: taskId, status: "running", percent: 0, time: "00:00:00", speed: "--", output_path: outputPath },
    };
    setTasks((prev) => [newTask, ...prev]);

    try {
      await invoke("convert_video", {
        taskId,
        inputPath,
        outputPath,
        ffmpegPath,
      });
    } catch (err: any) {
      setTasks((prev) =>
        prev.map((t) =>
          t.taskId === taskId
            ? { ...t, progress: { ...t.progress!, status: "error", error_msg: err.toString() } }
            : t
        )
      );
    }
  };

  // ── 清除已完成/报错的任务 ──
  const handleClearDone = () => {
    setTasks((prev) => prev.filter((t) => t.progress?.status === "running"));
  };

  const selectedFmt = OUTPUT_FORMATS.find((f) => f.ext === outputExt)!;
  const hasFinished = tasks.some((t) => t.progress?.status !== "running");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content glass-card"
        style={{ maxWidth: 600, width: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🔄</span> 视频格式转换
          </h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* 可滚动主体 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 4px" }}>
          {/* ── 拖放 / 输入区 ── */}
          <div
            ref={dropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? "#6366f1" : "#c7d2fe"}`,
              borderRadius: 14,
              padding: "22px 20px",
              background: isDragging ? "rgba(99,102,241,0.07)" : "rgba(241,245,249,0.6)",
              transition: "all 0.2s",
              marginBottom: 18,
              cursor: "default",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 14, color: isDragging ? "#6366f1" : "#94a3b8", fontSize: 13 }}>
              <span style={{ fontSize: 32, display: "block", marginBottom: 6 }}>📂</span>
              {isDragging ? "松开鼠标以添加文件" : "将视频文件拖拽到此处，或手动填写路径"}
            </div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
              源文件路径
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                placeholder="例如：D:\LiveRecords\直播录像.flv"
                style={{ fontSize: 13, fontFamily: "monospace", flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBrowseInput}
                style={{ flexShrink: 0, padding: "6px 14px", fontSize: 13, whiteSpace: "nowrap" }}
                title="打开系统文件选择器"
              >
                📂 浏览
              </button>
            </div>
          </div>

          {/* ── 输出格式选择 ── */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 10 }}>
              输出格式
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {OUTPUT_FORMATS.map((fmt) => (
                <button
                  key={fmt.ext}
                  type="button"
                  onClick={() => setOutputExt(fmt.ext)}
                  style={{
                    padding: "10px 8px",
                    borderRadius: 10,
                    border: `2px solid ${outputExt === fmt.ext ? "#6366f1" : "#e2e8f0"}`,
                    background: outputExt === fmt.ext ? "rgba(99,102,241,0.1)" : "#fff",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.18s",
                    color: outputExt === fmt.ext ? "#4f46e5" : "#475569",
                  }}
                >
                  <span style={{ fontSize: 20 }}>{fmt.icon}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5 }}>
                    .{fmt.ext.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10, opacity: 0.75, textAlign: "center", lineHeight: 1.3 }}>
                    {fmt.label.split("（")[1]?.replace("）", "") ?? ""}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── 输出路径 ── */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>
              输出文件路径
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="自动填写，也可手动修改"
                style={{ fontSize: 13, fontFamily: "monospace", flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBrowseOutput}
                style={{ flexShrink: 0, padding: "6px 14px", fontSize: 13, whiteSpace: "nowrap" }}
                title="打开系统另存为对话框"
              >
                💾 另存为
              </button>
            </div>
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 5, marginBottom: 0 }}>
              💡 转换采用流拷贝（无损封装），速度极快，不重新编码，画质零损失
            </p>
          </div>

          {/* ── 开始按钮 ── */}
          <button
            className="btn btn-primary"
            style={{ width: "100%", padding: "12px 0", fontSize: 15, fontWeight: 700, borderRadius: 12, marginBottom: 24 }}
            onClick={handleStartConvert}
          >
            {selectedFmt.icon} 开始转换为 .{outputExt.toUpperCase()}
          </button>

          {/* ── 任务列表 ── */}
          {tasks.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>转换任务</span>
                {hasFinished && (
                  <button
                    type="button"
                    onClick={handleClearDone}
                    style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    清除已完成
                  </button>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tasks.map((task) => {
                  const p = task.progress;
                  const isDone  = p?.status === "done";
                  const isError = p?.status === "error";
                  const pct     = p?.percent ?? 0;

                  return (
                    <div
                      key={task.taskId}
                      style={{
                        borderRadius: 12,
                        padding: "14px 16px",
                        background: isError
                          ? "rgba(254,226,226,0.6)"
                          : isDone
                          ? "rgba(220,252,231,0.6)"
                          : "rgba(241,245,249,0.8)",
                        border: `1px solid ${isError ? "#fca5a5" : isDone ? "#86efac" : "#e2e8f0"}`,
                        transition: "background 0.3s",
                      }}
                    >
                      {/* 文件名行 */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#334155", maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.inputPath}>
                          📄 {task.inputPath.split(/[\\/]/).pop()}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8,
                          background: isError ? "#fee2e2" : isDone ? "#bbf7d0" : "#e0e7ff",
                          color: isError ? "#dc2626" : isDone ? "#15803d" : "#4f46e5",
                        }}>
                          {isError ? "❌ 失败" : isDone ? "✅ 完成" : `⏳ ${pct.toFixed(1)}%`}
                        </span>
                      </div>

                      {/* 进度条 */}
                      {!isDone && !isError && (
                        <div style={{ background: "#e2e8f0", borderRadius: 4, height: 6, marginBottom: 8, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                              borderRadius: 4,
                              transition: "width 0.4s ease",
                            }}
                          />
                        </div>
                      )}

                      {/* 进度指标 */}
                      {!isError && p && (
                        <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#64748b" }}>
                          <span>⏱ {p.time}</span>
                          <span>⚡ {p.speed}</span>
                          {isDone && (
                            <span
                              style={{ color: "#4f46e5", cursor: "pointer", textDecoration: "underline", marginLeft: "auto" }}
                              title={task.outputPath}
                            >
                              📁 {task.outputPath.split(/[\\/]/).pop()}
                            </span>
                          )}
                        </div>
                      )}

                      {/* 错误信息 */}
                      {isError && p?.error_msg && (
                        <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4, wordBreak: "break-all" }}>
                          {p.error_msg}
                        </div>
                      )}

                      {/* 输出路径 → 目标文件 */}
                      {!isDone && (
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.outputPath}>
                          → {task.outputPath}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
