import React, { useState } from "react";
import "./OnboardingGuide.css";

interface OnboardingGuideProps {
  onComplete: () => void;
}

const SparklesIcon = () => (
  <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#2563eb" }}>
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5 5 3Z" />
    <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
  </svg>
);

const KeyIcon = () => (
  <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#2563eb" }}>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6" />
    <path d="m15.5 7.5 3 3M18.5 4.5l3 3" />
  </svg>
);

const MonitorIcon = () => (
  <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#2563eb" }}>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#2563eb" }}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4;

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const stepsContent = [
    {
      title: "欢迎使用直播录制助手",
      description: "本工具专为抖音、B站直播设计，提供稳定且流畅的后台监控录制、视频格式转换等全方位支持。接下来，只需花 1 分钟即可了解核心操作流程！",
      details: [
        "后台自动化：主播开播即录，下播即停",
        "无损封装：无须重编码，直接保存为 FLV 或 MP4",
        "单实例与自启动锁：防止多开冲突，省心可靠"
      ],
      icon: <SparklesIcon />
    },
    {
      title: "第一步：扫码登录与凭证授权",
      description: "部分平台限制未登录用户的拉流画质，且高频轮询易触发风控滑块。我们内置了全异步、安全的扫码助手，轻松解决风控难题。",
      details: [
        "前往「凭证中心」，点击「开启扫码助手」",
        "完成登录后，点击「提取当前 Cookie」自动载入凭证",
        "可配置多账号轮询，软件会自动进行拉流负载均衡"
      ],
      icon: <KeyIcon />
    },
    {
      title: "第二步：添加主播与开播监控",
      description: "您只需要添加一次主播，软件就会一直在后台为您守候。每当主播开播，软件会采用随机防风控时序抖动，静默开始录制工作。",
      details: [
        "在主面板点击「添加直播」，输入房间链接或 ID",
        "开启「是否开启自动监控」与「开播后自动录制」",
        "可单独调整分段时长，例如 60 分钟自动存盘为一个视频文件"
      ],
      icon: <MonitorIcon />
    },
    {
      title: "第三步：常驻托盘与自启动行为",
      description: "我们在软件中集成了系统常驻托盘和开机静默启动，让工具默默为您打工，不再打扰您的日常办公娱乐体验。",
      details: [
        "在「系统设置」中，可勾选「点击关闭最小化到系统托盘」",
        "开启「开机自动启动」与「自启动时隐藏主窗口」",
        "右键点击系统托盘图标，可快捷呼出主界面或优雅安全地退出"
      ],
      icon: <ShieldIcon />
    }
  ];

  const currentContent = stepsContent[currentStep - 1];

  return (
    <div className="onboarding-overlay" id="onboardingOverlay">
      <div className="onboarding-card">
        {/* 关闭按钮或跳过按钮 */}
        <button className="onboarding-skip-btn" onClick={onComplete}>
          跳过
        </button>

        {/* 顶部大图标 */}
        <div className="onboarding-icon-wrapper">
          {currentContent.icon}
        </div>

        {/* 进度提示 */}
        <div className="onboarding-progress-text">
          步骤 {currentStep} / {totalSteps}
        </div>

        {/* 主标题 */}
        <h2 className="onboarding-title">{currentContent.title}</h2>

        {/* 描述内容 */}
        <p className="onboarding-desc">{currentContent.description}</p>

        {/* 核心详情列表 */}
        <ul className="onboarding-details-list">
          {currentContent.details.map((item, index) => (
            <li key={index} className="onboarding-detail-item">
              <span className="bullet">✦</span> {item}
            </li>
          ))}
        </ul>

        {/* 底部导航栏 */}
        <div className="onboarding-footer">
          <button
            className={`onboarding-btn onboarding-btn-sec ${currentStep === 1 ? "disabled-btn" : ""}`}
            onClick={handlePrev}
            disabled={currentStep === 1}
          >
            上一步
          </button>

          {/* 指示小圆点 */}
          <div className="onboarding-dots">
            {stepsContent.map((_, idx) => (
              <span
                key={idx}
                className={`dot-item ${currentStep === idx + 1 ? "active" : ""}`}
                onClick={() => setCurrentStep(idx + 1)}
              />
            ))}
          </div>

          <button className="onboarding-btn onboarding-btn-pri" onClick={handleNext}>
            {currentStep === totalSteps ? "开始体验" : "下一步"}
          </button>
        </div>
      </div>
    </div>
  );
};
