# 直播录制工具 - 开发文档

## 目录

1. [项目背景与需求分析](#1-项目背景与需求分析)
2. [系统角色与用例分析](#2-系统角色与用例分析)
3. [系统设计](#3-系统设计)
4. [核心代码实现](#4-核心代码实现)
5. [系统运行演示截图](#5-系统运行演示截图)
6. [总结与优化方向](#6-总结与优化方向)

---

## 1. 项目背景与需求分析

### 1.1 项目背景

随着直播行业的快速发展，抖音、哔哩哔哩等平台成为内容创作者和观众的重要聚集地。用户对于**高质量、自动化、多平台**的直播录制需求日益增长。现有的录制方案存在以下痛点：

| 痛点 | 描述 |
|------|------|
| **平台限制** | 各平台录制工具互不通用，需分别使用不同软件 |
| **手动操作繁琐** | 需要人工监控开播状态，错过开播时间 |
| **画质选择受限** | 无法灵活选择录制画质或自动降级 |
| **格式转换困难** | 录制后需额外工具进行格式转换 |
| **Cookie管理复杂** | 多账号登录凭证管理不便 |

### 1.2 需求目标

基于上述痛点，本项目的核心目标是开发一款**跨平台、智能化、易用性强**的桌面直播录制工具，具体需求如下：

#### 功能性需求 (FR)

| 编号 | 需求描述 | 优先级 | 状态 |
|------|----------|--------|------|
| FR-01 | 支持抖音平台直播流解析与录制 | P0 | ✅ 已实现 |
| FR-02 | 支持哔哩哔哩平台直播流解析与录制 | P0 | ✅ 已实现 |
| FR-03 | 自动监控主播开播状态并触发录制 | P0 | ✅ 已实现 |
| FR-04 | 支持多种画质选择（原画/蓝光/超清/高清/标清） | P0 | ✅ 已实现 |
| FR-05 | 智能画质降级机制（首选不可用时自动降级） | P1 | ✅ 已实现 |
| FR-06 | 分段录制功能（按时间切分文件） | P1 | ✅ 已实现 |
| FR-07 | Cookie 凭证管理（扫码登录 + 手动导入） | P0 | ✅ 已实现 |
| FR-08 | 视频格式无损封装转换（MP4/MKV/FLV等） | P1 | ✅ 已实现 |
| FR-09 | 实时录制进度显示（时间/速度/状态） | P1 | ✅ 已实现 |
| FR-10 | 系统托盘运行与开机自启动 | P1 | ✅ 已实现 |
| FR-11 | 外部专业播放器零负担硬件解码联动 (PotPlayer/mpv/VLC) | P1 | ✅ 已实现 |
| FR-12 | 弹幕伴侣文件离线同步转储 (标准 XML / 结构化 JSONL) | P1 | ✅ 已实现 |
| FR-13 | 直播间弹幕信息懒加载 (1000条环形缓冲+触顶分页回溯) | P1 | ✅ 已实现 |
| FR-14 | 抖音/B站双重鲁棒礼物协议解析与富文本模板清洗 | P1 | ✅ 已实现 |

#### 非功能性需求 (NFR)

| 编号 | 需求描述 | 目标值 |
|------|----------|--------|
| NFR-01 | 应用启动内存占用 < 100MB | Rust后端 + 轻量前端 |
| NFR-02 | CPU 使用率 < 5%（空闲时） | 异步非阻塞架构 |
| NFR-03 | 支持 Windows 10/11 系统 | Tauri 2.0 原生支持 |
| NFR-04 | 配置数据持久化安全 | JSON原子写入 + 备份 |
| NFR-05 | 日志文件大小可控 | 10MB 自动轮转 |
| NFR-06 | 反风控能力 | 随机延迟 + Cookie轮换 |
| NFR-07 | 后台录制常驻内存 < 60MB | IPC 广播按需订阅熔断，后台录制 0 IPC 损耗 |
| NFR-08 | 长列表流畅度 60FPS | content-visibility: auto + 视口位置无感补偿 |

---

## 2. 系统角色与用例分析

### 2.1 系统角色定义

```
┌─────────────────────────────────────────────────────────┐
│                      用户 (User)                         │
│                                                         │
│   角色: 直播内容消费者 / 内容创作者                       │
│   特征: 非技术人员，追求简单易用的操作体验                  │
│   权限: 所有功能的完全操作权限                             │
└─────────────────────────────────────────────────────────┘
```

### 2.2 用例图

```
                        ┌──────────────┐
                        │     用户      │
                        └──────┬───────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  直播间管理    │    │  录制控制      │    │  系统配置      │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        ├─ UC-01: 添加直播间   │                    │
        ├─ UC-02: 删除直播间   │                    │
        ├─ UC-03: 修改房间设置 │                    │
        ├─ UC-04: 搜索过滤     │                    │
        │                    ├─ UC-05: 手动开始录制  │
        │                    ├─ UC-06: 手动停止录制  │
        │                    ├─ UC-07: 自动监控录制  │
        │                    │                    │
        │                    │              ├─ UC-08: 设置保存目录
        │                    │              ├─ UC-09: 配置监控间隔
        │                    │              ├─ UC-10: 托盘/自启动设置
        │                    │              └─ UC-11: Cookie管理
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  辅助功能      │    │  格式转换      │    │  系统监控      │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        ├─ UC-12: 扫码登录    │                    │
        ├─ UC-13: 手动导入    ├─ UC-14: 选择输入文件 │
        │                    ├─ UC-15: 选择输出格式 │
        │                    ├─ UC-16: 监控转换进度 │
        │                    │                    │
        │                    │              ├─ UC-17: 查看CPU使用率
        │                    │              ├─ UC-18: 查看网络速率
        │                    │              └─ UC-19: 查看在线人数
        ▼                    ▼                    ▼
```

### 2.3 核心用例详细说明

#### UC-07: 自动监控录制

**前置条件**: 
- 已添加直播间且开启"自动监控"
- 已配置有效的 Cookie 凭证

**主流程**:
1. 系统按配置间隔（默认180秒）定时检测所有监控中的直播间
2. 对每个房间发起异步 HTTP 请求检测开播状态
3. 若检测到开播：
   - a) 若配置了"自动录制"，立即启动 FFmpeg 录制
   - b) 更新前端卡片状态为"直播中"
4. 若未开播，继续等待下一轮检测
5. 广播 `room-status` 事件更新 UI

**异常流程**:
- 3a: 触发滑块验证 → 记录日志，跳过本次检测
- 3b: 网络超时 → 重试一次，仍失败则跳过
- 3c: Cookie 过期 → 标记该 Cookie 无效，提示用户刷新

---

## 3. 系统设计

### 3.1 技术选型

| 层次 | 技术选型 | 选型理由 |
|------|----------|----------|
| **桌面框架** | Tauri 2.0 | 轻量（<10MB）、Rust 后端安全性高、Web 前端开发效率高 |
| **前端框架** | React 19 + TypeScript | 组件化开发、类型安全、生态成熟 |
| **构建工具** | Vite 7 | 极速 HMR、Tree-shaking、ESM 原生支持 |
| **后端语言** | Rust | 内存安全、零成本抽象、异步并发能力强 |
| **HTTP 客户端** | reqwest | 异步、支持 TLS/Gzip/Brotli |
| **录制引擎** | FFmpeg（内嵌） | 业界标准、支持几乎所有音视频格式 |
| **包管理器** | Bun (前端) / Cargo (后端) | 极速安装、原生 ESM 支持 |

### 3.2 整体架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                        表现层 (Presentation Layer)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Dashboard │  │Credential│  │Converter │  │ Settings │           │
│  │  录制面板  │  │  凭证中心 │  │ 格式转换  │  │ 系统设置  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       └──────────────┴──────────────┴──────────────┘               │
│                          组件层 (Components)                         │
│  RoomCard / AddRoomModal / DialogModal / Icons / TelemetryBar       │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕ IPC (Tauri invoke/event)
┌─────────────────────────────────────────────────────────────────────┐
│                        业务逻辑层 (Business Logic Layer)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Config   │  │ Parser   │  │ Recorder │  │ Monitor  │           │
│  │ 配置管理  │  │ 流解析器  │  │ 录制引擎  │  │ 自动监控  │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │Telemetry │  │  Logger  │  │ LoginAuth │  │ Converter│           │
│  │ 系统遥测  │  │ 日志系统  │  │ 登录助手  │  │ 格式转换  │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕ HTTP / Process
┌─────────────────────────────────────────────────────────────────────┐
│                        外部依赖层 (External Dependencies)            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  抖音直播平台  │  │ B站直播平台   │  │  FFmpeg 引擎  │             │
│  │ live.douyin  │  │ live.bilibili│  │ ffmpeg.exe   │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 数据模型设计

#### 3.3.1 核心实体关系图 (ERD)

```
┌─────────────────────────────────────────────────────────────────┐
│                         AppConfig (顶层配置)                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ global: GlobalConfig                                     │    │
│  │ rooms: Vec<RoomConfig>                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└───────────────────────────────┬─────────────────────────────────┘
                                │ 1
                                │
                ┌───────────────┴───────────────┐
                │                               │
                ▼ 1                             ▼ N
┌──────────────────────────┐    ┌──────────────────────────┐
│      GlobalConfig        │    │       RoomConfig         │
├──────────────────────────┤    ├──────────────────────────┤
│ ffmpeg_path: String      │    │ room_id: String          │
│ save_dir: String         │    │ anchor_name: String      │
│ cookies: Vec<CookieItem> │    │ platform: Platform       │
│ user_agent: String       │    │ preferred_quality: String│
│ monitor_interval_secs: u32│   │ segment_duration_mins: u32│
│ close_to_tray: bool      │    │ is_monitoring: bool      │
│ auto_start: bool         │    │ auto_record: bool        │
│ silent_start: bool       │    │ record_danmaku: bool     │
│ record_danmaku: bool     │    │ danmaku_format: String   │
│ danmaku_format: String   │    └──────────────────────────┘
│ external_player_path: opt│    
└──────────────────────────┘    
                │ 1
                │
                ▼ N
┌──────────────────────────┐
│       CookieItem         │
├──────────────────────────┤
│ id: String               │
│ nickname: String         │
│ value: String            │
│ platform: Platform       │
│ use_count: u64           │
│ created_at: DateTime     │
└──────────────────────────┘
```

### 3.4 模块职责划分

| 模块 | 文件路径 | 核心职责 | 关键接口/函数 |
|------|----------|----------|---------------|
| **Config** | `config.rs` | 配置持久化与管理 | `load_config()` / `save_config()` / `AppConfigState` |
| **Parser-Douyin** | `parsers/douyin.rs` | 抖音直播流解析 (SSR Pace) | `parse_douyin_live()` / 双策略回退提取 |
| **Parser-BiliBili** | `parsers/bilibili.rs` | B站直播流解析 | `parse_bilibili_live()` / API链路调用 |
| **Recorder** | `recorder.rs` | FFmpeg 录制进程管理与优雅停机 | `start_recording()` / `stop_recording()` / 写入 'q' |
| **Monitor** | `monitor.rs` | 定时自动监控循环与开播触发 | `start_monitor_loop()` / 随机打散延迟 |
| **Telemetry** | `telemetry.rs` | 系统性能采集与网速遥测 | `start_telemetry_loop()` / CPU+网卡吞吐 |
| **Logger** | `logger.rs` | 日志记录与自动轮转 | `init_logger()` / 10MB 自动轮转 |
| **LoginAuth** | `auth.rs` | WebView2 扫码登录与 Cookie 嗅探 | `open_login_window()` / `capture_login_cookies()` |
| **Converter** | `converter.rs` | 本地 FFmpeg 视频格式无损封装互转 | `convert_video()` / 进度事件推送 |
| **Tray** | `tray.rs` | 系统托盘与防误触关闭拦截 | `setup_tray()` / `handle_silent_start()` |
| **ExternalPlayer**| `commands/room.rs` | 原生外部专业播放器启动联动 | `open_in_external_player()` / PotPlayer、mpv、VLC |
| **Danmaku-Manager**| `danmaku/manager.rs`| 弹幕生命周期管理与内存环形缓冲 | `get_recent_danmaku()` / 按需订阅广播熔断 |
| **Danmaku-Douyin** | `danmaku/douyin/*` | 抖音实时弹幕与双重鲁棒解码 | Protobuf 解码 + 底层 Wire 扫描器 + 礼物清洗 |
| **Danmaku-Bilibili**| `danmaku/bilibili/*`| B站弹幕 WSS 拆包与解压缩 | 16字节协议头拆解 + Brotli/Zlib 解压 |
| **Danmaku-Writer** | `danmaku/writer/*` | 离线弹幕伴侣文件同步落盘 | XML (B站格式) / JSONL 双格式流式写入器 |

### 3.5 关键流程设计

#### 3.5.1 录制启动流程

```
用户点击"开始录制"
       │
       ▼
┌──────────────────┐
│  1. 解析直播间信息  │ ← parse_room() → LiveRoomInfo
│  (获取可用流地址)  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  2. 选择最佳画质   │ ← select_best_stream() → LiveStream
│  (降级匹配算法)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  3. 组装FFmpeg参数 │ ← -y -progress pipe:2 -headers ...
│  (Referer注入)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  4. 启动子进程    │ ← Command::new("ffmpeg").spawn()
│  (异步监控stderr) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  5. 推送进度事件   │ ← emit("record-progress", RecordProgress)
│  (实时更新UI)    │
└──────────────────┘
```

#### 3.5.2 自动监控循环

```
                    ┌─────────────────────────┐
                    │   等待 monitor_interval  │
                    │   (+ 0~10s 随机抖动)     │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  读取配置,筛选监控中房间   │
                    │  is_monitoring == true   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
          ┌─────────────────┐       ┌─────────────────┐
          │  房间A 并发检测   │ ...   │  房间N 并发检测   │
          │  (随机2~4s延迟)  │       │  (随机2~4s延迟)  │
          └────────┬────────┘       └────────┬────────┘
                   │                         │
                   ▼                         ▼
          ┌─────────────────┐       ┌─────────────────┐
          │  开播?           │       │  未开播/已下播    │
          └────┬────┬───────┘       └────────┬─────────┘
               │    │                        │
     ┌─────────┘    └─────────┐              │
     ▼                        ▼              ▼
┌──────────┐          ┌──────────┐    ┌──────────┐
│auto_record│         │ 更新状态  │    │ 更新状态  │
│= true?   │          │= 直播中  │    │= 未开播   │
└────┬─────┘          └────┬─────┘    └────┬─────┘
     │                     │              │
  ┌──┴──┐                 │              │
  ▼     ▼                 │              │
是     否                 │              │
│     │                 │              │
▼     ▼                 ▼              ▼
启动   仅更新UI         emit事件      emit事件
录制   不录制           room-status   room-status
```

### 3.6 安全设计

| 安全措施 | 实现方式 | 说明 |
|----------|----------|------|
| **Cookie 加密存储** | JSON 文件存储（明文） | ⚠️ 待改进：建议加密或使用系统钥匙串 |
| **Referer 防盗链** | HTTP Header 注入 | B站/抖音流请求必须携带正确 Referer |
| **User-Agent 伪装** | 可配置 UA 字符串 | 模拟浏览器请求特征 |
| **反风控机制** | 随机延迟 + Cookie 轮换 | 降低被平台识别为爬虫的风险 |
| **CSP 策略** | `csp: null` | 允许 WebView 加载外部登录页面 |
| **单实例运行** | single_instance 插件 | 防止多开导致资源冲突 |

---

## 4. 核心代码实现

### 4.1 项目目录结构

```
dy_live_download/
├── src/                           # 前端 React 源码
│   ├── components/                # 可复用组件
│   │   ├── AddRoomModal.tsx       # 添加直播间弹窗
│   │   ├── DialogModal.tsx        # 通用对话框组件
│   │   ├── Icons.tsx              # SVG 图标库
│   │   ├── OnboardingGuide.tsx    # 首次启动引导页
│   │   ├── RoomCard.tsx           # 主播房间卡片组件
│   │   └── RoomSettingsModal.tsx  # 房间设置弹窗
│   ├── pages/                     # 页面级组件
│   │   ├── DashboardPage.tsx      # 录制面板主页
│   │   ├── CredentialsPage.tsx    # Cookie 凭证中心
│   │   ├── ConverterPage.tsx      # 格式转换页面
│   │   └── SettingsPage.tsx       # 系统设置页面
│   ├── App.tsx                    # 根应用组件（核心状态管理）
│   ├── App.css                    # 全局样式
│   ├── types.ts                   # TypeScript 类型定义
│   └── utils.ts                   # 工具函数
├── src-tauri/                     # Tauri/Rust 后端
│   ├── binaries/                  # 内置 FFmpeg 二进制文件
│   ├── capabilities/              # Tauri 能力配置
│   ├── icons/                     # 应用图标（多平台）
│   └── src/                       # Rust 源代码
│       ├── main.rs                # 程序入口点
│       ├── lib.rs                 # 核心库（命令注册、Tauri 配置）
│       ├── config.rs              # 配置管理模块
│       ├── monitor.rs             # 自动监控循环模块
│       ├── recorder.rs            # FFmpeg 录制引擎模块
│       ├── telemetry.rs           # 系统遥测监控模块
│       ├── logger.rs              # 日志系统模块
│       └── parsers/               # 直播流解析器
│           ├── mod.rs             # 解析器入口与公共逻辑
│           ├── douyin.rs          # 抖音直播解析器
│           └── bilibili.rs        # B站直播解析器
├── package.json                   # Node.js/前端依赖配置
├── Cargo.toml                     # Rust 依赖配置
├── tauri.conf.json                # Tauri 应用配置
└── vite.config.ts                 # Vite 构建配置
```

### 4.2 前端核心实现

#### 4.2.1 类型定义 (`types.ts`)

```typescript
// 平台枚举
type Platform = "douyin" | "bilibili";

// Cookie 凭证项
interface CookieItem {
  id: string;
  nickname: string;
  value: string;
  platform: Platform;
  use_count: number;
}

// 全局配置
interface GlobalConfig {
  ffmpeg_path: string;
  save_dir: string;
  cookies: CookieItem[];
  user_agent: string;
  monitor_interval_secs: number;
  close_to_tray: boolean;
  auto_start: boolean;
  silent_start: boolean;
}

// 房间配置
interface RoomConfig {
  room_id: string;
  anchor_name: string;
  platform: Platform;
  preferred_quality: string;  // origin/blue_ray/uhd/hd/sd
  segment_duration_mins: number;
  is_monitoring: boolean;
  auto_record: boolean;
}

// 顶层配置
interface AppConfig {
  global: GlobalConfig;
  rooms: RoomConfig[];
}
```

#### 4.2.2 主应用组件 (`App.tsx`)

**核心职责**:
- 四大 Tab 导航状态管理 (`activeTab`)
- 全局配置获取与更新 (`config` / `setConfig`)
- 直播间 CRUD 操作 (`addRoom` / `deleteRoom` / `updateRoom`)
- 录制启停控制 (`handleStartRecord` / `handleStopRecord`)
- 事件监听 (`record-progress` / `room-status` / `telemetry`)
- 搜索过滤逻辑 (`filteredRooms`)

**关键状态管理**:

```typescript
function App() {
  // 导航状态
  const [activeTab, setActiveTab] = useState<"dashboard" | "credentials" | "converter" | "settings">("dashboard");
  
  // 全局配置
  const [config, setConfig] = useState<AppConfig | null>(null);
  
  // 搜索过滤
  const [searchQuery, setSearchQuery] = useState("");
  
  // 录制任务状态
  const [activeTasks, setActiveTasks] = useState<Set<string>>(new Set());
  
  // 进度映射
  const [progressMap, setProgressMap] = useState<Map<string, RecordProgress>>(new Map());
  
  // 房间状态映射
  const [roomStatuses, setRoomStatuses] = useState<Map<string, "online" | "offline" | "checking">>(new Map());
  
  // 遥测数据
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);
}
```

#### 4.2.3 房间卡片组件 (`RoomCard.tsx`)

**显示要素**:
- 平台水印 SVG 图标（抖音/B站）
- 主播名称 & 房间 ID
- 直播标题（实时更新）
- 当前画质 / 分段设置
- 录制时长统计（时:分:秒）
- 状态徽章：🔴 直播中 / 📡 检测中 / ⚪ 未开播
- 操作按钮：开始/停止录制、检测状态、设置、删除

**性能优化**:
- 使用 `React.memo` 包装，避免不必要的重渲染
- 移除加载图标动画，减少视觉干扰

### 4.3 后端核心实现

#### 4.3.1 Tauri 命令注册 (`lib.rs`)

```rust
#[tauri::command]
async fn get_config(state: State<'_, AppConfigState>) -> Result<AppConfig, String>

#[tauri::command]
async fn update_global_config(state: State<'_, AppConfigState>, config: GlobalConfig) -> Result<(), String>

#[tauri::command]
async fn parse_room(room_id: String, platform: String, state: State<'_, AppConfigState>) -> Result<LiveRoomInfo, String>

#[tauri::command]
async fn add_room(room: RoomConfig, state: State<'_, AppConfigState>) -> Result<AppConfig, String>

#[tauri::command]
async fn delete_room(room_id: String, state: State<'_, AppConfigState>, recorder_state: State<'_, RecorderState>) -> Result<AppConfig, String>

#[tauri::command]
async fn start_record_task(room_id: String, recorder_state: State<'_, RecorderState>, config_state: State<'_, AppConfigState>) -> Result<String, String>

#[tauri::command]
async fn stop_record_task(room_id: String, recorder_state: State<'_, RecorderState>) -> Result<(), String>
```

#### 4.3.2 抖音解析器 (`parsers/douyin.rs`)

**双策略回退机制**:

```rust
pub async fn parse_douyin_room(
    client: &reqwest::Client,
    room_id: &str,
    cookie: Option<&str>,
    user_agent: &str,
) -> Result<LiveRoomInfo> {
    // 策略1: 从 self.__pace_f.push(...) 提取 (Next.js SSR 架构)
    if let Some(info) = extract_from_pace_f(&html) {
        return Ok(info);
    }
    
    // 策略2: 从 <script id="RENDER_DATA"> 提取 (传统架构)
    if let Some(info) = extract_from_render_data(&html) {
        return Ok(info);
    }
    
    // 诊断: 保存原始 HTML 用于调试
    save_error_page(&html, "douyin_error_page.html")?;
    
    Err("无法解析直播间信息".into())
}
```

**画质键映射**:

```rust
const QUALITY_MAP: &[(&str, &str)] = &[
    ("ORIGIN", "原画"),
    ("BLUE_LIGHT", "蓝光"),
    ("FULL_HD", "超清"),
    ("HD", "高清"),
    ("SD", "标清"),
];
```

#### 4.3.3 B站解析器 (`parsers/bilibili.rs`)

**API 调用链路**:

```rust
// Step 1: 获取真实 room_id 和开播状态
let room_init_url = format!("https://api.live.bilibili.com/room/v1/Room/get_info?room_id={}", room_id);

// Step 2: 获取主播信息和标题
let info_url = format!("https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id={}", real_room_id);

// Step 3: 获取流地址列表
let play_url = format!("https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id={}&protocol=0,1&format=0,1,2&codec=0,1", real_room_id);
```

**画质 qn 码映射**:

```rust
const QN_MAP: &[(u32, &str)] = &[
    (10000, "origin"),    // 原画
    (400, "blue_ray"),    // 蓝光
    (250, "uhd"),         // 超清
    (150, "hd"),          // 高清
    (80, "sd"),           // 标清
];
```

#### 4.3.4 录制引擎 (`recorder.rs`)

**FFmpeg 参数组装逻辑**:

```rust
fn build_ffmpeg_command(
    stream: &LiveStream,
    config: &GlobalConfig,
    output_path: &Path,
    segment_duration: Option<u64>,
) -> Command {
    let mut cmd = Command::new(&config.ffmpeg_path);
    
    // 基础参数
    cmd.arg("-y")                                           // 覆盖输出
       .arg("-progress")                                    // 进度输出到 stderr
       .arg("pipe:2")
       .arg("-protocol_whitelist")                           // 协议白名单
       .arg("file,http,https,tcp,tls,crypto")
       .arg("-headers");                                     // 自定义 Headers
    
    // 注入 User-Agent 和 Referer
    let headers = format!(
        "User-Agent: {}\nReferer: {}\n",
        config.user_agent,
        if stream.platform == "bilibili" { "https://live.bilibili.com/" } else { "https://live.douyin.com/" }
    );
    cmd.arg(&headers);
    
    // 输入流 URL
    cmd.arg("-i").arg(&stream.url);
    
    // 视频编码拷贝（无损）
    cmd.arg("-c").arg("copy");
    
    // 分段模式 or 单文件模式
    if let Some(segs) = segment_duration {
        cmd.arg("-f").arg("segment")
           .arg("-segment_time").arg(format!("{}", segs * 60))
           .arg("-reset_timestamps").arg("1");
    } else if output_path.extension().map(|e| e == "mp4").unwrap_or(false) {
        cmd.arg("-movflags").arg("+faststart");  // MP4 优化
    }
    
    // 输出路径
    cmd.arg(output_path);
    
    cmd
}
```

**异步进度监控**:

```rust
async fn monitor_progress(
    mut child: Child,
    app_handle: AppHandle,
    room_id: String,
    title: String,
) {
    let stderr = child.stderr.take().expect("Failed to capture stderr");
    let reader = BufReader::new(stderr);
    
    for line in reader.lines() {
        if let Ok(line) = line {
            // 解析 key=value 结构化进度
            if let Some((key, value)) = line.split_once('=') {
                match key.trim() {
                    "out_time_ms" => { /* 更新录制时长 */ },
                    "speed" => { /* 更新录制速度 */ },
                    _ => {}
                }
            }
            
            // 错误检测
            if ERROR_PATTERN.is_match(&line) {
                emit_error(&app_handle, &room_id, &line);
            }
        }
    }
}
```

#### 4.3.5 自动监控模块 (`monitor.rs`)

**反风控策略实现**:

```rust
async fn start_monitor_loop(app_handle: AppHandle) {
    loop {
        // 读取配置
        let config = get_config(&app_handle)?;
        
        // 等待监控间隔 + 随机抖动 (0~10秒)
        let jitter = rand::thread_rng().gen_range(0..=10);
        sleep(Duration::from_secs(config.global.monitor_interval_secs as u64 + jitter)).await;
        
        // 筛选需要监控的房间
        let monitoring_rooms: Vec<_> = config.rooms.iter()
            .filter(|r| r.is_monitoring)
            .collect();
        
        // 并发检测（带房间间随机延迟 2~4秒）
        let mut handles = vec![];
        for (idx, room) in monitoring_rooms.into_iter().enumerate() {
            let delay = rand::thread_rng().gen_range(2..=4);
            let handle = tokio::spawn(async move {
                sleep(Duration::from_secs(delay * idx)).await;
                check_and_record(room, &app_handle).await;
            });
            handles.push(handle);
        }
        
        // 等待所有检测完成
        futures::future::join_all(handles).await;
    }
}
```

### 4.4 关键算法实现

#### 4.4.1 智能画质降级算法 (`parsers/mod.rs`)

```rust
/// 当首选画质不可用时，按优先级降级查找可用流
pub fn select_best_stream(
    streams: &[LiveStream],
    preferred: &str,
) -> Option<&LiveStream> {
    // 优先级顺序: origin > blue_ray > uhd > hd > sd
    let priority = ["origin", "blue_ray", "uhd", "hd", "sd"];
    
    // 找到首选画质的索引位置
    let start_idx = priority.iter().position(|q| q == preferred).unwrap_or(0);
    
    // 从首选画质开始降级查找
    for quality in &priority[start_idx..] {
        if let Some(stream) = streams.iter().find(|s| s.quality == *quality) {
            return Some(stream);
        }
    }
    
    None
}
```

**示例场景**:

| 用户首选 | 可用画质 | 最终选择 | 原因 |
|----------|----------|----------|------|
| origin | origin/blue_ray/hd | **origin** | 首选可用 |
| blue_ray | origin/uhd/hd/sd | **uhd** | blue_ray 不可用，降级到 uhd |
| sd | origin/hd | **hd** | sd 不可用，但 hd 优先级更高 |

#### 4.4.2 Cookie 负载均衡算法 (`lib.rs`)

```rust
/// 按 use_count 最小值选取 Cookie，分散请求压力
fn get_and_increment_cookie(cookies: &mut Vec<CookieItem>) -> Option<(String, usize)> {
    if cookies.is_empty() {
        return None;
    }
    
    // 找到 use_count 最小的 Cookie 索引
    let min_idx = cookies.iter()
        .enumerate()
        .min_by_key(|(_, c)| c.use_count)
        .map(|(idx, _)| idx)?;
    
    // 递增计数
    cookies[min_idx].use_count += 1;
    
    Some((cookies[min_idx].value.clone(), min_idx))
}
```

**效果**: 多账号场景下均匀分配请求，避免单一 Cookie 触发频率限制。

### 4.5 事件通信机制

#### 前端 → 后端 (Invoke)

```typescript
// 示例: 开始录制
const result = await invoke<string>("start_record_task", { roomId: "123456" });

// 示例: 获取配置
const config = await invoke<AppConfig>("get_config");
```

#### 后端 → 前端 (Event)

| 事件名 | 数据结构 | 触发时机 | 用途 |
|--------|----------|----------|------|
| `record-progress` | RecordProgress | FFmpeg stderr 行解析 | 实时更新录制进度 |
| `room-status` | `{room_id, status}` | 监控检测结果 | 更新卡片在线状态 |
| `telemetry` | TelemetryPayload | 每 1500ms | 更新底部状态栏 |
| `convert-progress` | ConvertProgress | FFmpeg 转换行解析 | 更新转换任务进度 |

#### 前端监听示例:

```typescript
useEffect(() => {
  const unlisten = listen<RecordProgress>("record-progress", (event) => {
    setProgressMap(prev => new Map(prev).set(event.payload.room_id, event.payload));
  });
  
  return () => { unlisten.then(fn => fn()); };
}, []);
```

---

## 5. 系统运行演示截图

> **注**: 以下截图为占位符，实际运行时请替换为真实截图。

### 5.1 主界面 - 录制面板

![主界面](screenshots/main-dashboard.png)

**说明**: 
- 左侧导航栏：录制面板 / 凭证中心 / 格式转换 / 系统设置
- 主工作区：以网格形式展示已添加的主播房间卡片
- 底部状态栏：当前时间、在线人数、活跃录制数、CPU/网络遥测

### 5.2 添加直播间弹窗

![添加直播间](screenshots/add-room-modal.png)

**说明**:
- 平台选择下拉框（抖音 / B站）
- 房间 ID 输入框（仅支持纯数字）
- 默认配置：开启监控、原画画质、30分钟分段

### 5.3 录制进行中状态

![录制中](screenshots/recording-state.png)

**说明**:
- 卡片顶部显示红色"直播中"徽章
- 显示实时录制时长（HH:MM:SS 格式）
- 录制速度和网络流量统计
- "停止录制"按钮高亮显示

### 5.4 Cookie 凭证中心

![凭证中心](screenshots/credentials-page.png)

**说明**:
- 扫码登录区域：打开 WebView 窗口扫描二维码
- 手动导入区域：粘贴 Cookie 字符串
- 凭证列表：展示昵称、哈希值、获取时间、使用次数

### 5.5 格式转换页面

![格式转换](screenshots/converter-page.png)

**说明**:
- 输入/输出路径选择
- 六种输出格式可选（MP4/MKV/FLV/TS/MOV/AVI）
- 任务队列展示：进度条、百分比、速度、耗时

### 5.6 系统设置页面

![系统设置](screenshots/settings-page.png)

**说明**:
- 默认视频保存目录（文件夹浏览器）
- 监控间隔滑块（10~3600秒）
- 关闭到托盘开关
- 开机自启动开关
- 静默启动选项

### 5.7 系统托盘菜单

![托盘菜单](screenshots/tray-menu.png)

**说明**:
- 右键托盘图标弹出上下文菜单
- "显示窗口"选项：恢复主界面
- "退出"选项：优雅关闭应用程序

### 5.8 首次启动引导页

![引导页](screenshots/onboarding-guide.png)

**说明**:
- 新用户首次启动时的操作指引覆盖层
- 四步骤引导：添加直播间 → 配置 Cookie → 开始录制 → 系统设置
- "不再显示"勾选项

---

## 6. 总结与优化方向

### 6.1 项目总结

本项目成功实现了一款**功能完善、架构清晰、用户体验良好**的双平台直播录制工具，主要成果如下：

| 维度 | 成果 |
|------|------|
| **功能完整性** | 覆盖直播录制全流程：解析→监控→录制→转换→管理 |
| **技术先进性** | 采用 Tauri 2.0 + React 19 + Rust 现代技术栈 |
| **代码质量** | TypeScript 类型安全 + Rust 内存安全 + 模块化设计 |
| **用户体验** | 自定义对话框、响应式 UI、实时反馈、首次引导 |
| **稳定性** | 优雅退出、错误恢复、日志轮转、原子写入 |
| **可维护性** | 清晰的模块划分、完善的类型定义、详细的注释 |

### 6.2 当前局限性

| 局限性 | 影响 | 严重程度 |
|--------|------|----------|
| **仅支持 Windows** | macOS/Linux 用户无法使用 | 中 |
| **无云端同步** | 多设备配置无法共享 | 低 |
| **Cookie 明文存储** | 存在安全隐患 | 中 |
| **无批量导入** | 大量直播间需逐个添加 | 低 |
| **无录制计划** | 无法预约未来时段录制 | 低 |
| **无移动端适配** | 仅限桌面端使用 | 低 |

### 6.3 优化方向

#### 6.3.1 短期优化 (1-2周)

| 优化项 | 描述 | 预期收益 |
|--------|------|----------|
| **Cookie 加密存储** | 使用 AES-256 或系统钥匙串加密 Cookie | 提升安全性 |
| **错误重试机制** | 网络失败自动重试（指数退避） | 提高稳定性 |
| **录制断点续传** | 意外中断后从上次位置继续 | 避免数据丢失 |
| **国际化 (i18n)** | 支持多语言切换 | 扩展用户群体 |

#### 6.3.2 中期优化 (1个月)

| 优化项 | 描述 | 预期收益 |
|--------|------|----------|
| **跨平台支持** | 适配 macOS (Intel/Apple Silicon) + Linux | 扩大用户基础 |
| **批量操作** | 支持批量添加/删除/启停录制 | 提高操作效率 |
| **录制模板** | 预设常用配置组合（如"高清连续录制"） | 简化配置流程 |
| **数据统计面板** | 录制历史统计、存储空间占用、趋势图表 | 增强数据分析能力 |

#### 6.3.3 长期规划 (3个月+)

| 优化项 | 描述 | 预期收益 |
|--------|------|----------|
| **更多平台支持** | 接入快手、虎牙、斗鱼等主流直播平台 | 成为通用录制工具 |
| **云端同步服务** | 配置/录制列表跨设备同步 | 多端协同体验 |
| **AI 智能功能** | 自动识别精彩片段、生成摘要、智能标签 | 提升内容价值 |
| **插件系统** | 允许第三方开发者扩展功能 | 构建生态系统 |
| **移动端伴侣 App** | 远程监控和控制录制任务 | 随时随地管理 |

### 6.4 技术债务清单

| 债务项 | 当前状态 | 建议 |
|--------|----------|------|
| CSS 样式分散在 App.css | 单一文件 1000+ 行 | 拆分为模块化 CSS 或采用 CSS-in-JS |
| 部分组件使用 `any` 类型 | 存在类型安全隐患 | 补全所有 TypeScript 接口定义 |
| 测试覆盖率不足 | 仅有 Rust 解析器单元测试 | 添加 React 组件测试 + 集成测试 |
| 错误处理不够统一 | 部分 `unwrap()` 可能 panic | 统一使用 `Result` + 自定义错误类型 |
| 日志级别固定为 Info | 无法动态调整 | 支持通过 UI 切换日志级别 |

### 6.5 性能优化建议

| 优化方向 | 当前瓶颈 | 优化方案 | 预期提升 |
|----------|----------|----------|----------|
| **前端渲染** | 大量房间卡片同时渲染 | 虚拟滚动 (react-window) | 减少 50% DOM 节点 |
| **状态管理** | App.tsx 集中式状态过于庞大 | 拆分为 Context/Reducer | 降低耦合度 |
| **网络请求** | 监控检测串行等待 | 增加并发池大小 (tokio Semaphore) | 缩短检测周期 |
| **内存占用** | 进度字符串频繁创建 | 使用对象池或缓存 | 减少 GC 压力 |
| **启动速度** | 首次加载配置 + 初始化模块 | 懒加载非关键模块 | 提升 30% 启动速度 |

---

## 附录

### A. 依赖版本清单

#### 前端依赖 (`package.json`)

| 包名 | 版本 | 用途 |
|------|------|------|
| react | ^19.1.0 | UI 框架 |
| react-dom | ^19.1.0 | DOM 渲染 |
| @tauri-apps/api | ^2 | Tauri 前端 API |
| @tauri-apps/plugin-dialog | ^2.7.1 | 文件对话框 |
| @tauri-apps/plugin-opener | ^2 | URL 打开器 |
| typescript | ~5.8.3 | 类型检查 |
| vite | ^7.0.4 | 构建工具 |

#### 后端依赖 (`Cargo.toml`)

| 包名 | 版本 | 用途 |
|------|------|------|
| tauri | ^2 | 桌面框架 |
| tauri-plugin-opener | ^2 | URL 打开插件 |
| tauri-plugin-dialog | ^2 | 对话框插件 |
| tauri-plugin-autostart | ^2 | 自启动插件 |
| reqwest | ^0.12 | HTTP 客户端 |
| tokio | ^1 | 异步运行时 |
| serde | ^1 | 序列化 |
| regex | ^1 | 正则表达式 |
| chrono | ^0.4 | 时间处理 |
| url | ^2 | URL 解析 |
| sysinfo | ^0.30 | 系统信息 |
| log | 0.4 | 日志门面 |
| simplelog | 0.12 | 日志实现 |
| rand | ^0.8 | 随机数生成 |

### B. 环境要求

| 环境 | 最低要求 | 推荐版本 |
|------|----------|----------|
| 操作系统 | Windows 10 21H2 | Windows 11 |
| Node.js | >= 18.0.0 | LTS 20.x |
| Bun | >= 1.0.0 | Latest |
| Rust | >= 1.75.0 | Stable |
| 内存 | >= 4 GB RAM | 8 GB RAM |
| 磁盘空间 | >= 500 MB (程序) | >= 10 GB (含录制文件) |

### C. 快速开始

```bash
# 1. 克隆项目
git clone <repository-url>
cd dy_live_download

# 2. 安装前端依赖
bun install

# 3. 启动开发模式
bun tauri dev

# 4. 构建生产版本
bun tauri build
```

### D. 相关文档

- [README.md](./README.md) - 项目介绍与快速上手
- [TEST.md](./TEST.md) - 测试计划与用例

---

**文档版本**: v1.0  
**最后更新**: 2026-06-08  
**作者**: Development Team  
**许可证**: MIT License
