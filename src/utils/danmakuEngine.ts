export interface DanmakuSettings {
  visible: boolean;
  fontSize: number;    // 14 to 32, default 18
  opacity: number;     // 0.2 to 1.0, default 0.9
  displayArea: number; // 0.5 (top 50%), 1.0 (full screen)
  speed: number;       // 0.7 (slow), 1.0 (normal), 1.4 (fast)
}

interface DanmakuItem {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  width: number;
  speed: number;
  isSelf: boolean;
  trackIndex: number;
}

export class DanmakuEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private isPaused = false;
  private resizeObserver: ResizeObserver | null = null;

  public visible = true;
  public fontSize = 18;
  public opacity = 0.9;
  public displayArea = 0.6; // 默认展示前 60% 屏幕
  public speedMultiplier = 1.0;

  private items: DanmakuItem[] = [];
  private trackLastItem: (DanmakuItem | null)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context not available");
    this.ctx = context;

    this.resize();
    this.setupResizeObserver();
    this.startLoop();
  }

  public resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.scale(dpr, dpr);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.canvas);
  }

  public updateSettings(settings: Partial<DanmakuSettings>): void {
    if (settings.visible !== undefined) this.visible = settings.visible;
    if (settings.fontSize !== undefined) this.fontSize = settings.fontSize;
    if (settings.opacity !== undefined) this.opacity = settings.opacity;
    if (settings.displayArea !== undefined) this.displayArea = settings.displayArea;
    if (settings.speed !== undefined) this.speedMultiplier = settings.speed;
  }

  public emit(text: string, color: string = "#FFFFFF", isSelf: boolean = false): void {
    if (!this.visible || !text.trim()) return;

    const rect = this.canvas.getBoundingClientRect();
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    this.ctx.font = `bold ${this.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const textMetrics = this.ctx.measureText(text);
    const textWidth = Math.ceil(textMetrics.width);

    const trackHeight = Math.round(this.fontSize * 1.5);
    const availableHeight = canvasHeight * this.displayArea;
    const maxTracks = Math.max(1, Math.floor(availableHeight / trackHeight));

    if (this.trackLastItem.length < maxTracks) {
      this.trackLastItem = new Array(maxTracks).fill(null);
    }

    // 寻找最佳可用轨道 (防重叠排布算法)
    let bestTrack = -1;
    const minGap = 20; // 弹幕间最小水平距离

    for (let i = 0; i < maxTracks; i++) {
      const last = this.trackLastItem[i];
      if (!last) {
        bestTrack = i;
        break;
      }
      // 如果上一条弹幕已完全离开屏幕右侧进入屏幕一定距离，且新弹幕速度不会追尾
      const lastTailX = last.x + last.width;
      if (lastTailX + minGap < canvasWidth) {
        bestTrack = i;
        break;
      }
    }

    // 如果所有轨道都在拥挤，轮询分配到尾部最靠左的轨道
    if (bestTrack === -1) {
      let minTailX = Infinity;
      bestTrack = 0;
      for (let i = 0; i < maxTracks; i++) {
        const last = this.trackLastItem[i];
        if (last && last.x + last.width < minTailX) {
          minTailX = last.x + last.width;
          bestTrack = i;
        }
      }
    }

    // 弹幕基准滚动速度 (在屏幕停留约 6~8 秒)
    const baseDurationSec = 7;
    const baseSpeed = (canvasWidth + textWidth) / (baseDurationSec * 60);

    const newItem: DanmakuItem = {
      id: Math.random().toString(36).substring(2, 9),
      text,
      color: isSelf ? "#22d3ee" : color,
      x: canvasWidth,
      y: bestTrack * trackHeight + this.fontSize + 8,
      width: textWidth,
      speed: baseSpeed,
      isSelf,
      trackIndex: bestTrack,
    };

    this.items.push(newItem);
    this.trackLastItem[bestTrack] = newItem;
  }

  private startLoop(): void {
    const loop = () => {
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private render(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    this.ctx.clearRect(0, 0, width, height);
    if (!this.visible || this.isPaused) return;

    this.ctx.save();
    this.ctx.globalAlpha = this.opacity;
    this.ctx.font = `bold ${this.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";

    const remaining: DanmakuItem[] = [];

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      item.x -= item.speed * this.speedMultiplier;

      // 绘制描边高对比度文字
      this.ctx.strokeText(item.text, item.x, item.y);
      this.ctx.fillStyle = item.color;
      this.ctx.fillText(item.text, item.x, item.y);

      // 如果是自己发送的弹幕，增加一个小标识高亮框
      if (item.isSelf) {
        this.ctx.strokeStyle = "#22d3ee";
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(item.x - 4, item.y - this.fontSize, item.width + 8, this.fontSize + 4);
        this.ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        this.ctx.lineWidth = 2.5;
      }

      // 保留尚未完全离开屏幕左侧的弹幕
      if (item.x + item.width > 0) {
        remaining.push(item);
      } else {
        // 如果该项是轨道上的最新项且已离开，置空
        if (this.trackLastItem[item.trackIndex]?.id === item.id) {
          this.trackLastItem[item.trackIndex] = null;
        }
      }
    }

    this.items = remaining;
    this.ctx.restore();
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
  }

  public clear(): void {
    this.items = [];
    this.trackLastItem = [];
  }

  public destroy(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.clear();
  }
}
