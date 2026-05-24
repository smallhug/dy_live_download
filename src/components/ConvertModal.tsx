import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { RefreshIcon, FolderIcon, SaveIcon, FileIcon, CloseIcon, CheckIcon, LoadingIcon } from "./Icons";

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
  { ext: "mp4", label: "MP4（H.264 / 通用）" },
  { ext: "mkv", label: "MKV（万能容器）" },
  { ext: "flv", label: "FLV（推流存档）" },
  { ext: "ts",  label: "TS（传输流）" },
  { ext: "mov", label: "MOV（苹果 QuickTime）" },
  { ext: "avi", label: "AVI（经典格式）" },
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

// 产生任务ID
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
  const [hoveredExt, setHoveredExt]   = useState<string | null>(null);
  const [sourceFocused, setSourceFocused] = useState(false);
  const [outputFocused, setOutputFocused] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

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
    if (!inputPath.trim()) { alert("请先选择源视频文件路径"); return; }
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

  const hasFinished = tasks.some((t) => t.progress?.status !== "running");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content glass-card"
        style={{ 
          maxWidth: 520, 
          width: "92vw", 
          display: "flex", 
          flexDirection: "column", 
          padding: "16px 20px",
          gap: "12px"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="modal-header" style={{ flexShrink: 0, margin: 0 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "16px" }}>
            <RefreshIcon size={18} style={{ color: "#6366f1" }} /> 视频格式转换
          </h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* 路径配置区 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* 源文件路径 */}
          <div className="form-group">
            <label style={{ fontSize: "12.5px", fontWeight: "600", color: "#475569", marginBottom: "4px", display: "block" }}>
              源文件路径
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                placeholder="请选择或填写：.flv / .mkv / .mp4 等"
                onFocus={() => setSourceFocused(true)}
                onBlur={() => setSourceFocused(false)}
                style={{ 
                  fontSize: "12.5px", 
                  fontFamily: "monospace", 
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1.5px solid ${sourceFocused ? "#6366f1" : "#cbd5e1"}`,
                  backgroundColor: "#ffffff",
                  outline: "none",
                  boxShadow: sourceFocused ? "0 0 0 3px rgba(99, 102, 241, 0.1)" : "none",
                  transition: "all 0.15s ease",
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBrowseInput}
                style={{ 
                  padding: "6px 12px", 
                  fontSize: "12.5px", 
                  borderRadius: "6px",
                  minWidth: "68px"
                }}
              >
                <FolderIcon size={12} /> 浏览
              </button>
            </div>
          </div>

          {/* 输出文件路径 */}
          <div className="form-group">
            <label style={{ fontSize: "12.5px", fontWeight: "600", color: "#475569", marginBottom: "4px", display: "block" }}>
              输出文件路径
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="自动生成，亦可手动修改"
                onFocus={() => setOutputFocused(true)}
                onBlur={() => setOutputFocused(false)}
                style={{ 
                  fontSize: "12.5px", 
                  fontFamily: "monospace", 
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1.5px solid ${outputFocused ? "#6366f1" : "#cbd5e1"}`,
                  backgroundColor: "#ffffff",
                  outline: "none",
                  boxShadow: outputFocused ? "0 0 0 3px rgba(99, 102, 241, 0.1)" : "none",
                  transition: "all 0.15s ease",
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleBrowseOutput}
                style={{ 
                  padding: "6px 12px", 
                  fontSize: "12.5px", 
                  borderRadius: "6px",
                  minWidth: "68px"
                }}
              >
                <SaveIcon size={12} /> 另存为
              </button>
            </div>
          </div>
        </div>

        {/* 输出格式选择 */}
        <div>
          <label style={{ fontSize: "12.5px", fontWeight: "600", color: "#475569", display: "block", marginBottom: "6px" }}>
            目标格式
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
            {OUTPUT_FORMATS.map((fmt) => {
              const isSelected = outputExt === fmt.ext;
              const isHovered = hoveredExt === fmt.ext;
              return (
                <button
                  key={fmt.ext}
                  type="button"
                  onClick={() => setOutputExt(fmt.ext)}
                  onMouseEnter={() => setHoveredExt(fmt.ext)}
                  onMouseLeave={() => setHoveredExt(null)}
                  style={{
                    padding: "8px 4px",
                    borderRadius: 8,
                    border: `1.5px solid ${isSelected ? "#6366f1" : isHovered ? "#cbd5e1" : "#e2e8f0"}`,
                    background: isSelected 
                      ? "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.08) 100%)" 
                      : "#ffffff",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                    transform: isSelected || isHovered ? "translateY(-1px)" : "none",
                    boxShadow: isSelected 
                      ? "0 4px 10px rgba(99,102,241,0.12)" 
                      : isHovered 
                      ? "0 3px 6px rgba(15,23,42,0.04)" 
                      : "0 1px 3px rgba(15,23,42,0.01)",
                    transition: "all 0.18s ease-out",
                    color: isSelected ? "#4f46e5" : "#475569",
                    outline: "none",
                  }}
                  title={fmt.label}
                >
                  <span style={{ fontSize: "12px", fontWeight: 700 }}>
                    .{fmt.ext.toUpperCase()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 开始按钮 */}
        <button
          className="btn"
          style={{ 
            width: "100%", 
            padding: "10px 0", 
            fontSize: "14px", 
            fontWeight: 700, 
            borderRadius: "8px", 
            display: "inline-flex", 
            alignItems: "center", 
            justifyContent: "center", 
            gap: "6px",
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            color: "#ffffff",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(99, 102, 241, 0.2)",
            transition: "all 0.15s ease",
            margin: "4px 0 0 0"
          }}
          onClick={handleStartConvert}
        >
          开始转换
        </button>

        {/* 任务列表 */}
        {tasks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "12.5px", fontWeight: "700", color: "#475569" }}>转换任务</span>
              {hasFinished && (
                <button
                  type="button"
                  onClick={handleClearDone}
                  style={{ fontSize: "11px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  清除已完成
                </button>
              )}
            </div>

            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: "8px", 
              overflowY: "auto", 
              maxHeight: "140px", 
              paddingRight: "2px" 
            }}>
              {tasks.map((task) => {
                const p = task.progress;
                const isDone  = p?.status === "done";
                const isError = p?.status === "error";
                const pct     = p?.percent ?? 0;

                return (
                  <div
                    key={task.taskId}
                    style={{
                      borderRadius: 8,
                      padding: "10px 12px",
                      background: isError
                        ? "linear-gradient(135deg, rgba(254,226,226,0.4) 0%, rgba(254,205,205,0.4) 100%)"
                        : isDone
                        ? "linear-gradient(135deg, rgba(240,253,244,0.6) 0%, rgba(220,252,231,0.6) 100%)"
                        : "linear-gradient(135deg, rgba(248,250,252,0.8) 0%, rgba(241,245,249,0.8) 100%)",
                      border: `1px solid ${isError ? "#fecaca" : isDone ? "#bbf7d0" : "#e2e8f0"}`,
                      boxShadow: "0 2px 8px rgba(15,23,42,0.02)",
                    }}
                  >
                    {/* 文件名行 */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#334155", maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "4px" }} title={task.inputPath}>
                        <FileIcon size={13} style={{ color: "#64748b" }} /> {task.inputPath.split(/[\\/]/).pop()}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 6,
                        background: isError ? "#fee2e2" : isDone ? "#bbf7d0" : "#e0e7ff",
                        color: isError ? "#dc2626" : isDone ? "#15803d" : "#4f46e5",
                        display: "inline-flex", alignItems: "center", gap: "2px"
                      }}>
                        {isError ? (
                          <><CloseIcon size={10} /> 失败</>
                        ) : isDone ? (
                          <><CheckIcon size={10} /> 完成</>
                        ) : (
                          <><LoadingIcon size={10} /> {pct.toFixed(1)}%</>
                        )}
                      </span>
                    </div>

                    {/* 进度条 */}
                    {!isDone && !isError && (
                      <div style={{ background: "#e2e8f0", borderRadius: 3, height: 4, marginBottom: 6, overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                            borderRadius: 3,
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>
                    )}

                    {/* 进度指标 */}
                    {!isError && p && (
                      <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#64748b", alignItems: "center" }}>
                        <span>用时: {p.time}</span>
                        <span>速度: {p.speed}</span>
                        {isDone && (
                          <span
                            style={{ color: "#6366f1", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "2px", marginLeft: "auto", fontWeight: "600" }}
                            title={task.outputPath}
                          >
                            <FolderIcon size={11} style={{ color: "#6366f1" }} /> {task.outputPath.split(/[\\/]/).pop()}
                          </span>
                        )}
                      </div>
                    )}

                    {/* 错误信息 */}
                    {isError && p?.error_msg && (
                      <div style={{ fontSize: 10.5, color: "#dc2626", marginTop: 2, wordBreak: "break-all" }}>
                        {p.error_msg}
                      </div>
                    )}

                    {/* 输出路径 → 目标文件 */}
                    {!isDone && (
                      <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.outputPath}>
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
  );
};
