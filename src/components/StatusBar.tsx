import React from "react";

interface StatusBarProps {
  activeRecordingCount: number;
  monitoringCount: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  activeRecordingCount,
  monitoringCount,
}) => {
  return (
    <div className="status-bar" style={{ justifyContent: "flex-end" }}>
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
