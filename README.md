# 直播录制工具 (Live Recorder)

一款基于 **Tauri 2 + React 19 + Rust** 构建的高性能、轻量级、跨平台直播录制与归档桌面应用，支持抖音、哔哩哔哩（Bilibili）等主流平台的直播流自动化监控、无损录制及弹幕离线同步转储。

---

## 核心特性与功能亮点

### 1. 多平台全自动直播录制与监控 (P0)
- **多平台推流解析**：原生支持抖音、B站直播间，自动提取 FLV 与 M3U8 流地址，优先匹配推流质量最高的原画 FLV 直播流。
- **智能画质降级**：支持原画、蓝光、超清、高清、标清画质匹配；当首选画质不可用时自动无缝向下回退降级。
- **后台开播巡检与自动录制**：异步定时轮询主播开播状态（带随机延迟打散与 Cookie 轮换，有效规避风控拦截），开播后秒级触发自动录制。
- **无损封装与智能切片**：基于 FFmpeg 执行 `-c copy` 无损流直存；支持按时间分段录制（15 / 30 / 60 / 120 分钟），以及单文件 `faststart` 头部优化。
- **进程安全与优雅停机**：对 FFmpeg 子进程进行异步生命周期接管与输出流监控；应用退出或停止录制时向进程 stdin 发送 `q` 信号并超时等待，确保视频文件索引 (`moov atom`) 完整写入不损坏。

### 2. 离线弹幕伴侣转储与懒加载回溯 (P1)
- **弹幕伴侣文件同步落盘**：录制视频时，后台静默捕获 WebSocket / Protobuf 数据流，同步生成同名同时间戳的标准 XML 弹幕文件（完美兼容 PotPlayer、mpv 及 DanmakuFactory 渲染字幕）或 JSONL 结构化事件日志。
- **双重鲁棒礼物协议解析**：深度逆向抖音 Webcast 与 B 站长连接封包，引入底层通用 Protobuf Wire 扫描器（`decode_gift_raw`），即使官方协议字段微调也能 100% 提取礼物 ID、送礼用户、金额与礼物名称。
- **富文本礼物与粉丝团灯牌清洗**：自动清洗剥离公屏模板占位符（如 `【图片】`、`送出了` 等），将加团广播与微额灯牌（1 抖币 / 10 分）标准化为纯净礼物呈现。
- **弹幕信息多级懒加载**：
  - **后端环形缓冲**：每个录制会话在 Rust 内存中维护定长 1,000 条双端环形队列，会话期间始终保留最新弹幕，仅占 1~2 MB 内存。
  - **首屏秒开**：打开抽屉瞬间毫秒级加载最近 50 条历史弹幕并吸底展示，彻底消除空白等待。
  - **向上触顶分页回溯**：滑到顶部自动懒加载更早的历史弹幕，并利用 `scrollHeight` 差值无感补偿滚动条位置，阅读视线静止不跳动。
  - **IPC 按需订阅熔断**：后台静默录制期间 **0 前端 IPC 广播**，仅在抽屉打开时发送事件，彻底消除事件风暴。
  - **样式与长列表优化**：采用 `content-visibility: auto`，跳过视口外部 DOM 渲染，保证 60fps 丝滑流畅。

### 3. 外部专业播放器零负担联动 (P1)
- **原生硬件解码播放**：支持一键调用系统默认或自定义的外部专业播放器（如 **PotPlayer / mpv / VLC**），自动注入平台鉴权与防盗链请求头（User-Agent、Referer、Origin）。
- **零渲染开销**：彻底移除了应用内置重型 MSE 播放器与 Canvas 跑马灯图层，主程序常驻内存保持在 **30MB ~ 50MB**，外部播放器即使崩溃或卡顿也绝不影响后台录制。

### 4. 账号凭证与反风控体系 (P0)
- **扫码登录助手**：通过 Tauri 后端拉起独立 WebView2 窗口进行扫码登录，底层自动嗅探捕获包含 HttpOnly 在内的关键会话 Cookie（抖音 `sessionid`、B站 `SESSDATA`）。
- **多凭证负载均衡**：支持维护多账号 Cookie 池，根据历史使用次数最少 (`use_count`) 自动轮换调度，有效分散请求频次。
- **有效性检测与昵称抓取**：自动检测 Cookie 存活状态并拉取对应账号昵称。

### 5. 视频无损格式转换工具箱 (P1)
- **本地秒级混流**：基于 FFmpeg 对本地视频文件进行无损封装互转（支持 MP4、MKV、FLV、TS、MOV、AVI 等）。
- **实时进度解析**：实时解析处理速度倍率（如 `2.5x`）、已转换时间戳与百分比进度条。

### 6. 系统健康遥测与桌面常驻 (P1)
- **网速与系统遥测**：基于 `sysinfo` 实时采集网卡实时上下行网速、在线主播数与录制通道数。
- **托盘驻留与开机自启**：支持点击关闭按钮最小化到托盘、自启动静默运行、单实例互斥唤起。

---

## 技术架构

| 层级 / 模块 | 技术选型 | 版本 / 说明 |
| :--- | :--- | :--- |
| **桌面运行时** | Tauri 2 (tauri-apps) | `^2.0`（高性能 Rust 驱动桌面运行时） |
| **前端框架** | React 19 + TypeScript | `^19.1.0` + TypeScript `~5.8.3` |
| **前端构建与包管理** | Vite + Bun | Vite `^7.0.4`, Bun 作为包管理器 |
| **后端语言** | Rust | Edition 2021 |
| **异步运行时** | Tokio | `1.x` (多线程 full features) |
| **网络与长连接** | Reqwest, Tokio-Tungstenite | TLS, gzip, brotli, HTTP 流与 WebSocket 长连接 |
| **二进制编解码** | Prost, Flate2, Brotli, Bytes | Protocol Buffers 解码、Gzip 与 Brotli 解压、大端序解包 |
| **视频流处理** | FFmpeg | 本地执行外部 FFmpeg 进程或使用打包二进制 |

---

## 项目结构

```
├── src/                          # 前端源码 (React 19 + TypeScript)
│   ├── App.tsx                   # 主应用框架（侧边栏、Tab路由导航、状态同步）
│   ├── App.css                   # 全局样式系统
│   ├── types.ts                  # TypeScript 核心类型定义
│   ├── utils.ts                  # 通用工具函数 (日期、网速、数值格式化)
│   ├── pages/                    # 页面组件
│   │   ├── DashboardPage.tsx     # 录制主面板 (卡片网格、开播指示、弹幕抽屉唤起)
│   │   ├── CredentialsPage.tsx   # 凭证中心 (扫码登录助手、Cookie负载均衡池)
│   │   ├── ConverterPage.tsx     # 视频格式转换工具箱 (无损封装重构)
│   │   └── SettingsPage.tsx      # 系统设置 (目录、检测周期、自启、外置播放器路径)
│   └── components/               # 通用组件
│       ├── RoomCard.tsx          # 单个直播间卡片 (外置播放、弹幕控制台、录制控制)
│       ├── DanmakuDrawer.tsx     # 独立弹幕控制台 (懒加载分页、首屏秒开、礼物统计)
│       ├── AddRoomModal.tsx      # 添加直播间弹窗 (URL 智能正则提取平台与ID)
│       ├── RoomSettingsModal.tsx # 直播间参数设置 (偏好画质、分段时长、弹幕开关)
│       ├── TelemetryBar.tsx      # 底部遥测状态栏 (上下行网速、时钟、通道指示)
│       ├── DialogModal.tsx       # 通用无阻塞 Promise 提示对话框
│       ├── Icons.tsx             # 轻量级纯 SVG 矢量图标集
│       └── OnboardingGuide.tsx   # 新手操作引导页
├── src-tauri/                    # Rust 后端源码
│   ├── src/
│   │   ├── main.rs               # 后端应用启动入口
│   │   ├── lib.rs                # 模块组织、全局状态托管与 IPC 命令注册中心
│   │   ├── config.rs             # 配置管理与原子化持久化写入
│   │   ├── converter.rs          # FFmpeg 视频封装互转与进度事件监听
│   │   ├── auth.rs               # WebView2 扫码登录嗅探与 Cookie 负载均衡
│   │   ├── tray.rs               # 系统托盘菜单构建与窗口关闭防误退监听
│   │   ├── recorder.rs           # FFmpeg 录制子进程管理、进度解析与优雅停机
│   │   ├── monitor.rs            # 后台多房间轮询巡检与自动开播录制触发
│   │   ├── telemetry.rs          # 网卡收发流量与 CPU 占用率遥测循环
│   │   ├── logger.rs             # 本地日志记录与自动轮转管理
│   │   ├── commands/             # Tauri IPC 命令处理模块
│   │   │   ├── mod.rs
│   │   │   ├── config.rs         # 全局配置读取与更新
│   │   │   ├── room.rs           # 房间增删改查、流解析与外置播放器拉起
│   │   │   ├── record.rs         # 手动录制启停与任务状态查询
│   │   │   └── danmaku.rs        # 弹幕预览启停、按需订阅与懒加载分页接口
│   │   ├── parsers/              # 直播流解析模块
│   │   │   ├── mod.rs            # LiveParser Trait 与画质智能降级算法
│   │   │   ├── douyin.rs         # 抖音直播解析 (SSR Pace 提取长房间号与画质流)
│   │   │   └── bilibili.rs       # B站直播解析 (room_init 与清晰度流获取)
│   │   └── danmaku/              # 弹幕捕获与写入子系统
│   │       ├── mod.rs
│   │       ├── model.rs          # 规范化弹幕消息数据结构 (LiveMessage)
│   │       ├── manager.rs        # 弹幕会话生命周期、环形缓冲区与按需广播调度
│   │       ├── douyin/           # 抖音弹幕 (Protobuf 解码、底层 Wire 回退扫描器)
│   │       ├── bilibili/         # B站弹幕 (WebSocket 协议拆包、Brotli/Zlib 解压)
│   │       └── writer/           # 离线弹幕文件转储 (XML / JSONL 流式写入器)
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## 开发与构建

### 前置环境要求

- [Bun](https://bun.sh/)（推荐包管理器，极速构建）
- [Rust & Cargo](https://www.rust-lang.org/tools/install)（Rust 2021 Edition）
- [FFmpeg](https://ffmpeg.org/)（视频录制与格式转换必备工具）

### 依赖安装

```bash
# 安装前端依赖
bun install
```

### 调试运行

```bash
# 启动本地开发环境（前端热更新 + Rust 编译）
bun run tauri dev
```

### 自动化测试与代码规范检查

```bash
# 执行 Rust 全量单元测试（包含抖音/B站协议解码、环形缓冲懒加载、礼物清洗等测试）
cargo test --manifest-path src-tauri/Cargo.toml

# 执行严格代码风格与静态分析检查
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 执行前端 TypeScript 严格类型检查
bun run tsc --noEmit

# 执行前端生产构建
bun run build
```

### 生产环境安装包打包

```bash
# 构建 Windows 生产安装包 (生成 NSIS 64位安装向导 .exe 文件)
bun run tauri build
```
生成的安装包默认位于：
`src-tauri/target/release/bundle/nsis/直播录制_{version}_x64-setup.exe`

---

## 协议与致谢

- 本项目基于 MIT 许可证开源。
- 遵循各大直播平台网络规范，仅供个人学习、技术研究与离线内容归档使用。
