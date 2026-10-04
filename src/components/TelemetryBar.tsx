import React, { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { TelemetryPayload } from "../types";
import { formatDateTime, formatSpeed } from "../utils";

const Clock: React.FC = () => {
  const [time, setTime] = useState(formatDateTime(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setTime(formatDateTime(new Date())), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{time}</>;
};

interface TelemetryBarProps {
  onlineCount: number;
  activeRecordCount: number;
}

export const TelemetryBar: React.FC<TelemetryBarProps> = ({
  onlineCount,
  activeRecordCount,
}) => {
  const [telemetry, setTelemetry] = useState<TelemetryPayload>({
    cpu_usage: 0,
    net_recv: 0,
    net_sent: 0,
  });

  useEffect(() => {
    const unlistenTelemetryPromise = listen<TelemetryPayload>(
      "telemetry",
      (event) => {
        setTelemetry(event.payload);
      }
    );

    return () => {
      unlistenTelemetryPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <footer className="app-telemetry-bar">
      <div className="telemetry-left">
        <span className="telemetry-item">
          <span className="telemetry-label">在线主播:</span>
          <span className="telemetry-value">{onlineCount} 个</span>
        </span>
        <span className="telemetry-divider">|</span>
        <span className="telemetry-item">
          <span className="telemetry-label">录制通道:</span>
          <span className="telemetry-value active">{activeRecordCount} 路</span>
        </span>
      </div>

      <div className="telemetry-right">
        <span className="telemetry-item">
          <span className="telemetry-label">↓</span>
          <span className="telemetry-value speed">
            {formatSpeed(telemetry.net_recv)}
          </span>
        </span>
        <span className="telemetry-divider">|</span>
        <span className="telemetry-item">
          <span className="telemetry-label">↑</span>
          <span className="telemetry-value speed">
            {formatSpeed(telemetry.net_sent)}
          </span>
        </span>
        <span className="telemetry-divider">|</span>
        <span className="telemetry-item time-display">
          <Clock />
        </span>
      </div>
    </footer>
  );
};
