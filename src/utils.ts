export const formatDateTime = (date: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
};

export const formatSpeed = (bytesPerSec: number): string => {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
};

export const formatCount = (num: number): string => {
  if (!num || num < 0) return "0";
  if (num < 10000) return num.toLocaleString();
  if (num < 100000000) {
    const wan = (num / 10000).toFixed(1).replace(/\.0$/, "");
    return `${wan}万`;
  }
  const yi = (num / 100000000).toFixed(2).replace(/\.00$/, "");
  return `${yi}亿`;
};

export const formatCurrency = (rmbYuan: number): string => {
  if (!rmbYuan || rmbYuan <= 0) return "¥0.0";
  return `¥${rmbYuan.toFixed(1)}`;
};

let taskCounter = 0;
export const genTaskId = (): string => `convert-${Date.now()}-${++taskCounter}`;
