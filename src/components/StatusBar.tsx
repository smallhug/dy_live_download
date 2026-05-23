import React from "react";

interface StatusBarProps {
  ffmpegPath: string;
  activeRecordingCount: number;
  monitoringCount: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  ffmpegPath,
  activeRecordingCount,
  monitoringCount,
}) => {
  const isFfmpegReady = ffmpegPath.trim().length > 0;

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className="status-label">FFmpeg 状态:</span>
        <span className={`status-value ${isFfmpegReady ? "ready" : "missing"}`}>
          <span className="status-dot"></span>
          {isFfmpegReady ? "已就绪" : "未配置"}
        </span>
        {isFfmpegReady && (
          <span className="ffmpeg-path-tooltip" title={ffmpegPath}>
            ({ffmpegPath.split("\\").pop()})
          </span>
        )}
      </div>

      <div className="status-right">
        <div className="status-item">
          <span className="status-label">后台监控中:</span>
          <span className="status-value highlight">{monitoringCount} 个</span>
        </div>
        <div className="status-separator"></div>
        <div className="status-item">
          <span className="status-label">正在录制:</span>
          <span className="status-value recording-pulse">{activeRecordingCount} 路</span>
        </div>
      </div>
    </div>
  );
};
