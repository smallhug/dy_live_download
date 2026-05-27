import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { AppConfig } from "../types";
import { genTaskId } from "../utils";
import {
  RefreshIcon,
  LoadingIcon,
  FolderIcon,
  FileIcon,
  SaveIcon,
} from "../components/Icons";

const OUTPUT_FORMATS = [
  { ext: "mp4", label: "MP4（H.264 / 通用）" },
  { ext: "mkv", label: "MKV（万能容器）" },
  { ext: "flv", label: "FLV（推流存档）" },
  { ext: "ts",  label: "TS（传输流）" },
  { ext: "mov", label: "MOV（苹果 QuickTime）" },
  { ext: "avi", label: "AVI（经典格式）" },
];

interface ConvertTask {
  taskId: string;
  inputPath: string;
  outputPath: string;
  progress: ConvertProgressPayload | null;
}

interface ConvertProgressPayload {
  task_id: string;
  status: "running" | "done" | "error";
  percent: number;
  time: string;
  speed: string;
  error_msg?: string;
  output_path: string;
}

function guessOutputPath(inputPath: string, ext: string, saveDir: string): string {
  if (!inputPath.trim()) return "";
  const sep = inputPath.includes("\\") ? "\\" : "/";
  const parts = inputPath.split(sep);
  const filename = parts[parts.length - 1];
  const basename = filename.includes(".") ? filename.slice(0, filename.lastIndexOf(".")) : filename;
  const dir = saveDir.trim() || parts.slice(0, -1).join(sep);
  const dirSep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${dirSep}${basename}_converted.${ext}`;
}

interface ConverterPageProps {
  config: AppConfig | null;
}

export default function ConverterPage({ config }: ConverterPageProps) {
  const [convertInputPath, setConvertInputPath] = useState("");
  const [convertOutputExt, setConvertOutputExt] = useState("mp4");
  const [convertOutputPath, setConvertOutputPath] = useState("");
  const [convertTasks, setConvertTasks] = useState<ConvertTask[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  useEffect(() => {
    const unlistenConvert = listen<ConvertProgressPayload>("convert-progress", (event) => {
      const p = event.payload;
      setConvertTasks((prev) =>
        prev.map((t) =>
          t.taskId === p.task_id ? { ...t, progress: p } : t
        )
      );
    });

    return () => {
      unlistenConvert.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (config?.global) {
      setConvertOutputPath(guessOutputPath(convertInputPath, convertOutputExt, config.global.save_dir));
    }
  }, [convertInputPath, convertOutputExt, config]);

  const handleBrowseConvertInput = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "视频文件", extensions: ["mp4", "mkv", "flv", "ts", "mov", "avi", "m4v", "wmv", "rmvb", "webm"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (selected && typeof selected === "string") {
      setConvertInputPath(selected);
    }
  };

  const handleBrowseConvertOutput = async () => {
    if (!config?.global) return;
    const suggested = convertOutputPath || guessOutputPath(convertInputPath, convertOutputExt, config.global.save_dir);
    const suggestedName = suggested.split(/[\\/]/).pop() || `output.${convertOutputExt}`;
    const result = await saveDialog({
      defaultPath: suggestedName,
      filters: [
        { name: convertOutputExt.toUpperCase(), extensions: [convertOutputExt] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (result) {
      setConvertOutputPath(result);
    }
  };

  const handleStartConvert = async () => {
    if (!convertInputPath.trim()) { await message("请选择源视频文件", { title: "提示", kind: "warning" }); return; }
    if (!convertOutputPath.trim()) { await message("请设置输出路径", { title: "提示", kind: "warning" }); return; }
    if (!config?.global) return;

    const taskId = genTaskId();
    const newTask: ConvertTask = {
      taskId,
      inputPath: convertInputPath,
      outputPath: convertOutputPath,
      progress: { task_id: taskId, status: "running", percent: 0, time: "00:00:00", speed: "--", output_path: convertOutputPath },
    };
    setConvertTasks((prev) => [newTask, ...prev]);

    try {
      setIsConverting(true);
      await invoke("convert_video", {
        taskId,
        inputPath: convertInputPath,
        outputPath: convertOutputPath,
        ffmpegPath: config.global.ffmpeg_path,
      });
    } catch (err: any) {
      setConvertTasks((prev) =>
        prev.map((t) =>
          t.taskId === taskId
            ? { ...t, progress: { ...t.progress!, status: "error", error_msg: err.toString() } }
            : t
        )
      );
    } finally {
      setIsConverting(false);
    }
  };

  const handleClearConvertDone = () => {
    setConvertTasks((prev) => prev.filter((t) => t.progress?.status === "running"));
  };

  return (
    <div className="tab-page-content" style={{ display: "flex", flexDirection: "row", gap: "32px", flex: 1, overflow: "hidden", padding: "8px 0" }}>
      <div style={{ width: "350px", display: "flex", flexDirection: "column", gap: "16px", flexShrink: 0 }}>
        <div style={{ paddingBottom: "12px", borderBottom: "1px solid #e2e8f0" }}>
          <h4 style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a" }}>无损封装转换</h4>
          <p style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0 0", lineHeight: "1.4" }}>
            调用 FFmpeg 无损提取视频和音频流重新打包，不经过重编码，保留最高原始画质且速度极快。
          </p>
        </div>

        <div className="form-group" style={{ marginBottom: "8px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px" }}>
            <FileIcon size={14} /> 源视频文件路径
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              placeholder="请选择源视频文件..."
              value={convertInputPath}
              onChange={(e) => setConvertInputPath(e.target.value)}
              style={{ flex: 1, fontSize: "13px", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            />
            <button type="button" className="btn btn-secondary" onClick={handleBrowseConvertInput} style={{ width: "36px", height: "36px", padding: 0 }} title="选择源视频">
              <FolderIcon size={15} />
            </button>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: "8px" }}>
          <label style={{ marginBottom: "6px", display: "block", fontWeight: "600", fontSize: "12.5px" }}>目标封装格式</label>
          <select
            value={convertOutputExt}
            onChange={(e) => setConvertOutputExt(e.target.value)}
            style={{ width: "100%", height: "36px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", padding: "0 8px", backgroundColor: "#ffffff" }}
          >
            {OUTPUT_FORMATS.map(f => (
              <option key={f.ext} value={f.ext}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: "16px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", fontWeight: "600", fontSize: "12.5px" }}>
            <SaveIcon size={14} /> 目标输出文件路径
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              placeholder="请输入或浏览选择输出的文件名..."
              value={convertOutputPath}
              onChange={(e) => setConvertOutputPath(e.target.value)}
              style={{ flex: 1, fontSize: "13px", padding: "8px 10px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            />
            <button type="button" className="btn btn-secondary" onClick={handleBrowseConvertOutput} style={{ width: "36px", height: "36px", padding: 0 }} title="自定义输出路径">
              <FolderIcon size={15} />
            </button>
          </div>
        </div>

        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleStartConvert}
            disabled={isConverting}
            style={{ width: "100%", height: "36px", fontSize: "13px" }}
          >
            {isConverting ? <><LoadingIcon size={14} /> 处理中...</> : <><RefreshIcon size={14} /> 启动无损封装</>}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #e2e8f0", height: "45px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a" }}>任务队列 ({convertTasks.length})</h4>
          {convertTasks.some((t) => t.progress?.status !== "running") && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleClearConvertDone} style={{ height: "28px", padding: "0 10px", fontSize: "11.5px" }}>
              清除已结束
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingRight: "4px" }}>
          {convertTasks.length === 0 ? (
            <div className="no-data-hint" style={{ padding: "40px 20px" }}>
              暂无转换任务。请在左侧设定文件路径以启动封装转换。
            </div>
          ) : (
            <div className="convert-tasks-container">
              {convertTasks.map((t) => (
                <div className="convert-task-item glass-card" key={t.taskId} style={{ padding: "14px", marginBottom: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: "600", fontSize: "13px", color: "#334155" }}>
                      任务: {t.inputPath.split(/[\\/]/).pop()}
                    </span>
                    <span className={`status-badge ${t.progress?.status}`}>
                      {t.progress?.status === "running" ? "处理中" : t.progress?.status === "done" ? "成功" : "出错"}
                    </span>
                  </div>

                  <div className="progress-bar-container" style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden", margin: "4px 0" }}>
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${t.progress?.percent || 0}%`,
                        height: "100%",
                        background: t.progress?.status === "error" ? "#ef4444" : "#4f46e5",
                        transition: "width 0.2s ease"
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b" }}>
                    <span>进度: {t.progress?.percent.toFixed(1)}% | 耗时: {t.progress?.time} | 速度: {t.progress?.speed}</span>
                    <span style={{ textOverflow: "ellipsis", maxWidth: "60%", overflow: "hidden", whiteSpace: "nowrap" }}>
                      输出: {t.outputPath.split(/[\\/]/).pop()}
                    </span>
                  </div>
                  {t.progress?.status === "error" && t.progress.error_msg && (
                    <div style={{ fontSize: "11px", color: "#ef4444", background: "#fef2f2", padding: "6px", borderRadius: "4px", border: "1px solid #fee2e2", marginTop: "4px" }}>
                      错误: {t.progress.error_msg}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}