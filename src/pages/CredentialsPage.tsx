import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CookieItem, AppConfig } from "../types";
import { KeyIcon, CheckIcon, LoadingIcon, GlobeIcon, PlusIcon, TrashIcon } from "../components/Icons";
import { DialogModal, DialogOptions } from "../components/DialogModal";
import { formatDateTime } from "../utils";

type LoginFlowState = "idle" | "opening" | "waiting_login" | "capturing" | "done" | "error";

const LoginStep: React.FC<{ step: number; label: string; state: "pending" | "active" | "done" }> = ({ step, label, state }) => {
  const colors = {
    pending: { bg: "#f1f5f9", border: "#e2e8f0", text: "#94a3b8", dot: "#cbd5e1" },
    active:  { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb", dot: "#2563eb" },
    done:    { bg: "#f0fdf4", border: "#bbf7d0", text: "#16a34a", dot: "#16a34a" },
  }[state];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12.5px" }}>
      <div style={{
        width: "20px", height: "20px", borderRadius: "50%",
        background: colors.bg, border: `1.5px solid ${colors.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "10px", fontWeight: "700", color: colors.text, flexShrink: 0,
      }}>
        {state === "done" ? <CheckIcon size={12} style={{ color: colors.text }} /> : step}
      </div>
      <span style={{ color: colors.text, fontWeight: state === "active" ? "600" : "400" }}>{label}</span>
      {state === "active" && <LoadingIcon size={13} style={{ color: colors.text }} />}
    </div>
  );
};

interface CredentialsPageProps {
  config: AppConfig | null;
  onSaveCookies: (cookies: CookieItem[]) => Promise<void>;
}

export default function CredentialsPage({ config, onSaveCookies }: CredentialsPageProps) {
  const [loginFlow, setLoginFlow] = useState<LoginFlowState>("idle");
  const [loginFlowMsg, setLoginFlowMsg] = useState("");
  const [loginPollTimer, setLoginPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualNickname, setManualNickname] = useState("");
  const [manualCookieValue, setManualCookieValue] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [pendingCookie, setPendingCookie] = useState<string | null>(null);
  const [pendingNickname, setPendingNickname] = useState("");

  const [dialogState, setDialogState] = useState<(DialogOptions & { resolve: (v: boolean) => void }) | null>(null);

  const showDialog = (opts: DialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({ ...opts, resolve });
    });
  };

  const confirmAsync = (message: string, title?: string) => {
    return showDialog({ type: "confirm", message, title });
  };

  useEffect(() => {
    return () => {
      if (loginPollTimer) {
        clearInterval(loginPollTimer);
      }
    };
  }, [loginPollTimer]);

  const startLoginFlow = async () => {
    setLoginFlow("opening");
    setLoginFlowMsg("正在打开登录窗口...");
    try {
      await invoke("open_login_window", { currentUrl: window.location.href });
      setLoginFlow("waiting_login");
      setLoginFlowMsg("请在弹出的窗口中扫码登录");

      const timer = setInterval(async () => {
        try {
          const loggedIn = await invoke<boolean>("check_login_status");
          if (loggedIn) {
            clearInterval(timer);
            setLoginPollTimer(null);
            await finishLoginFlow();
          }
        } catch {
        }
      }, 2000);
      setLoginPollTimer(timer);
    } catch (err: any) {
      setLoginFlow("error");
      setLoginFlowMsg("打开登录窗口失败: " + err.toString());
    }
  };

  const cancelLoginFlow = async () => {
    if (loginPollTimer) {
      clearInterval(loginPollTimer);
      setLoginPollTimer(null);
    }
    try {
      const loginWin = await WebviewWindow.getByLabel("douyin-login");
      if (loginWin) await loginWin.close();
    } catch {}
    setLoginFlow("idle");
    setLoginFlowMsg("");
  };

  const finishLoginFlow = async () => {
    setLoginFlow("capturing");
    setLoginFlowMsg("已检测到登录，正在获取凭证...");
    try {
      const capturedCookie = await invoke<string>("capture_login_cookies");
      const currentCookies = config?.global.cookies || [];

      if (currentCookies.some(c => c.value === capturedCookie)) {
        setLoginFlow("done");
        setLoginFlowMsg("该账号已在列表中，无需重复添加");
        setTimeout(() => { setLoginFlow("idle"); setLoginFlowMsg(""); }, 2500);
        return;
      }

      setPendingCookie(capturedCookie);
      setPendingNickname("");
      setShowNicknameModal(true);
      setLoginFlow("idle");
      setLoginFlowMsg("");
    } catch (err: any) {
      setLoginFlow("error");
      setLoginFlowMsg(err.toString());
    }
  };

  const handleConfirmNickname = async () => {
    const nickname = pendingNickname.trim();
    if (!nickname || !pendingCookie) return;

    try {
      const loginWin = await WebviewWindow.getByLabel("douyin-login");
      if (loginWin) await loginWin.close();
    } catch {}

    const acquiredAt = formatDateTime(new Date());

    const newCookie: CookieItem = {
      id: Date.now().toString(),
      nickname,
      value: pendingCookie,
      acquired_at: acquiredAt,
      use_count: 0,
    };

    const currentCookies = config?.global.cookies || [];
    await onSaveCookies([...currentCookies, newCookie]);
    setShowNicknameModal(false);
    setPendingCookie(null);
    setPendingNickname("");
  };

  const handleAddManualCookie = async () => {
    setManualError(null);
    const nickname = manualNickname.trim();
    const value = manualCookieValue.trim();

    if (!nickname) { setManualError("账号昵称/备注不能为空"); return; }
    if (!value) { setManualError("Cookie 内容不能为空"); return; }

    if (!value.includes("sessionid") && !value.includes("passport_csrf_token")) {
      if (!await confirmAsync("警告：输入的 Cookie 缺少核心的 sessionid，可能无法正常拉流或添加主播。确定要强制添加吗？", "Cookie 缺失警告")) {
        return;
      }
    }

    const currentCookies = config?.global.cookies || [];
    if (currentCookies.some(c => c.value === value)) {
      setManualError("该 Cookie 内容已存在于列表中");
      return;
    }

    const acquiredAt = formatDateTime(new Date());

    const newCookie: CookieItem = {
      id: Date.now().toString(),
      nickname,
      value,
      acquired_at: acquiredAt,
      use_count: 0,
    };

    await onSaveCookies([...currentCookies, newCookie]);
    setManualNickname("");
    setManualCookieValue("");
    setShowManualInput(false);
  };

  const handleDeleteCookie = async (id: string, name: string) => {
    if (await confirmAsync(`确定要删除账号 [${name}] 的 Cookie 吗？`, "删除凭证")) {
      const currentCookies = config?.global.cookies || [];
      await onSaveCookies(currentCookies.filter(c => c.id !== id));
    }
  };

  return (
    <div className="tab-page-content standard-tab-layout">
      <div className="glass-card" style={{ padding: "20px", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: loginFlow !== "idle" ? "16px" : "0" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <KeyIcon size={18} style={{ color: "#fff" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "600", color: "#0f172a" }}>扫码登录获取凭证</div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>自动打开抖音登录页面，扫码后自动捕获 Cookie</div>
          </div>
          {loginFlow === "idle" && (
            <button className="btn btn-primary btn-sm" onClick={startLoginFlow}>
              <GlobeIcon size={14} /> 开始登录
            </button>
          )}
          {loginFlow !== "idle" && loginFlow !== "done" && loginFlow !== "error" && (
            <button className="btn btn-secondary btn-sm" onClick={cancelLoginFlow}>
              取消
            </button>
          )}
        </div>

        {loginFlow !== "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingLeft: "46px" }}>
            <LoginStep step={1} label="打开登录窗口" state={loginFlow === "opening" ? "active" : loginFlow === "waiting_login" || loginFlow === "capturing" || loginFlow === "done" ? "done" : "pending"} />
            <LoginStep step={2} label="扫码登录中..." state={loginFlow === "waiting_login" ? "active" : loginFlow === "capturing" || loginFlow === "done" ? "done" : "pending"} />
            <LoginStep step={3} label="获取凭证" state={loginFlow === "capturing" ? "active" : loginFlow === "done" ? "done" : "pending"} />
            {loginFlowMsg && (
              <div style={{ fontSize: "12px", color: loginFlow === "error" ? "#ef4444" : loginFlow === "done" ? "#10b981" : "#64748b", marginTop: "4px" }}>
                {loginFlowMsg}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="page-section-header" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: "12px", justifyContent: "flex-end" }}>
        <div className="action-buttons" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button 
            type="button" 
            className="icon-btn" 
            onClick={() => setShowManualInput(!showManualInput)}
            title="手动导入凭证"
            style={{ width: "34px", height: "34px", borderRadius: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <PlusIcon size={18} />
          </button>
        </div>
      </div>

      {/* 手动导入弹窗 */}
      {showManualInput && (
        <div className="modal-overlay" onClick={() => setShowManualInput(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>手动导入 Cookie</h2>
              <button className="close-btn" onClick={() => setShowManualInput(false)}>&times;</button>
            </div>
            <div className="modal-form">
              {manualError && <div className="form-error">{manualError}</div>}
              <div className="form-group">
                <label>账号备注或昵称</label>
                <input
                  type="text"
                  placeholder="例如: 抖音主号1"
                  value={manualNickname}
                  onChange={(e) => setManualNickname(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Cookie 字符串值</label>
                <textarea
                  placeholder="直接复制粘贴抓取到的完整的 Cookie 字段值"
                  value={manualCookieValue}
                  onChange={(e) => setManualCookieValue(e.target.value)}
                  style={{ fontFamily: "monospace", fontSize: "12px", height: "100px", resize: "none", scrollbarWidth: "none" }}
                />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowManualInput(false)}>取消</button>
                <button className="btn btn-primary" onClick={handleAddManualCookie}>确认导入</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!config || !config.global.cookies || config.global.cookies.length === 0 ? (
        <div className="no-data-hint">
          当前尚未添加任何抖音账号凭证。未登录凭证运行，自动监控检测和录制可能会触发抖音防爬滑块验证。
        </div>
      ) : (
        <div className="table-wrapper glass-card">
          <table className="settings-table">
            <thead>
              <tr>
                <th>昵称</th>
                <th>Cookie 散列</th>
                <th>获取时间</th>
                <th style={{ textAlign: "center" }}>已拉流计数</th>
                <th style={{ textAlign: "center", width: "80px" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {config.global.cookies.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: "600", color: "#0f172a" }}>{c.nickname}</td>
                  <td style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: "11px" }}>
                    {c.value.length > 30 ? c.value.slice(0, 30) + "..." : c.value}
                  </td>
                  <td style={{ color: "#64748b" }}>{c.acquired_at}</td>
                  <td style={{ textAlign: "center", fontWeight: "500", color: "#4f46e5" }}>{c.use_count} 次</td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      className="btn-text-danger"
                      onClick={() => handleDeleteCookie(c.id, c.nickname)}
                      title="删除此凭证"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNicknameModal && (
        <div className="modal-overlay" onClick={() => { setShowNicknameModal(false); setPendingCookie(null); setPendingNickname(""); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>设置账号昵称</h2>
              <button className="close-btn" onClick={() => { setShowNicknameModal(false); setPendingCookie(null); setPendingNickname(""); }}>&times;</button>
            </div>
            <div className="modal-form">
              <div className="form-group">
                <label>账号备注 / 昵称</label>
                <input
                  type="text"
                  value={pendingNickname}
                  onChange={(e) => setPendingNickname(e.target.value)}
                  placeholder="例如: 抖音主号"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirmNickname(); }}
                />
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => { setShowNicknameModal(false); setPendingCookie(null); setPendingNickname(""); }}>取消</button>
                <button className="btn btn-primary" onClick={handleConfirmNickname} disabled={!pendingNickname.trim()}>确认添加</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialogState && (
        <DialogModal
          isOpen={!!dialogState}
          type={dialogState.type}
          title={dialogState.title}
          message={dialogState.message}
          kind={dialogState.kind}
          confirmText={dialogState.confirmText}
          cancelText={dialogState.cancelText}
          onConfirm={() => { dialogState.resolve(true); setDialogState(null); }}
          onCancel={() => { dialogState.resolve(false); setDialogState(null); }}
        />
      )}
    </div>
  );
}
