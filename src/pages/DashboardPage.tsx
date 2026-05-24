import React from "react";
import { AppConfig, RoomConfig, RecordProgress } from "../types";
import { RoomCard } from "../components/RoomCard";
import { TvIcon } from "../components/Icons";

interface DashboardPageProps {
  config: AppConfig | null;
  filteredRooms: RoomConfig[];
  activeTasks: string[];
  progressMap: Record<string, RecordProgress>;
  roomStatuses: Record<string, { is_live: boolean; title?: string }>;
  checkingRooms: Record<string, boolean>;
  recordLoading: Record<string, "starting" | "stopping" | null>;
  onAddRoom: () => void;
  onCheckStatus: (room: RoomConfig) => void;
  onStartRecord: (roomId: string) => void;
  onStopRecord: (roomId: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onOpenSettings: (room: RoomConfig) => void;
}

const DashboardPage: React.FC<DashboardPageProps> = ({
  config,
  filteredRooms,
  activeTasks,
  progressMap,
  roomStatuses,
  checkingRooms,
  recordLoading,
  onAddRoom,
  onCheckStatus,
  onStartRecord,
  onStopRecord,
  onDeleteRoom,
  onOpenSettings,
}) => {
  if (!config || !config.rooms || config.rooms.length === 0) {
    return (
      <div className="tab-page-content" style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        <div className="empty-state glass-card" style={{ margin: "auto" }}>
          <div className="empty-icon"><TvIcon size={48} style={{ color: "#94a3b8" }} /></div>
          <h3>任务列表空空如也</h3>
          <p>点击顶部的 "添加主播" 按钮，输入抖音直播间数字 ID 开始实时监控吧！</p>
          <button className="btn btn-primary" onClick={onAddRoom}>
            立即添加
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-page-content" style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div className="room-grid">
        {filteredRooms.map((room) => {
          const isRecording = activeTasks.includes(room.room_id);
          const progress = progressMap[room.room_id];
          const status = roomStatuses[room.room_id];
          const isChecking = checkingRooms[room.room_id];
          return (
            <RoomCard
              key={room.room_id}
              room={room}
              isLive={status?.is_live || false}
              title={status?.title || ""}
              isChecking={isChecking}
              isRecording={isRecording}
              recordProgress={progress}
              recordLoading={recordLoading[room.room_id] || null}
              onCheckStatus={() => onCheckStatus(room)}
              onStartRecord={() => onStartRecord(room.room_id)}
              onStopRecord={() => onStopRecord(room.room_id)}
              onDelete={() => onDeleteRoom(room.room_id)}
              onSettings={() => onOpenSettings(room)}
            />
          );
        })}
      </div>
    </div>
  );
};

export default DashboardPage;
