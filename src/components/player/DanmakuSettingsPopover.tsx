import React from "react";

interface DanmakuSettingsPopoverProps {
  danmakuOpacity: number;
  setDanmakuOpacity: (opacity: number) => void;
  danmakuFontSize: number;
  setDanmakuFontSize: (fontSize: number) => void;
  danmakuSpeed: number;
  setDanmakuSpeed: (speed: number) => void;
}

export const DanmakuSettingsPopover: React.FC<DanmakuSettingsPopoverProps> = ({
  danmakuOpacity,
  setDanmakuOpacity,
  danmakuFontSize,
  setDanmakuFontSize,
  danmakuSpeed,
  setDanmakuSpeed,
}) => {
  return (
    <div className="danmaku-settings-panel" onClick={(e) => e.stopPropagation()}>
      <div className="setting-row">
        <span>不透明度</span>
        <input
          type="range"
          min="0.2"
          max="1"
          step="0.1"
          value={danmakuOpacity}
          onChange={(e) => setDanmakuOpacity(parseFloat(e.target.value))}
        />
        <span>{Math.round(danmakuOpacity * 100)}%</span>
      </div>
      <div className="setting-row">
        <span>字体大小</span>
        <input
          type="range"
          min="14"
          max="28"
          step="2"
          value={danmakuFontSize}
          onChange={(e) => setDanmakuFontSize(parseInt(e.target.value))}
        />
        <span>{danmakuFontSize}px</span>
      </div>
      <div className="setting-row">
        <span>滚动速度</span>
        <div className="segmented-control">
          {[
            { l: "慢", v: 0.7 },
            { l: "正常", v: 1.0 },
            { l: "快", v: 1.4 },
          ].map((s) => (
            <button
              key={s.l}
              className={`seg-btn ${danmakuSpeed === s.v ? "active" : ""}`}
              onClick={() => setDanmakuSpeed(s.v)}
            >
              {s.l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
