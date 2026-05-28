# 直播录制工具

一款基于 Tauri 2 + React + Rust 构建的跨平台直播录制桌面应用，支持抖音、B站等平台的直播流录制。

## 功能特性

### 多平台直播录制
- 支持抖音、B站直播流录制
- 支持 FLV / M3U8 流自动检测和优先选择
- 支持多画质选择：原画、蓝光、超清、高清、标清
- 支持分段录制（15/30/60/120 分钟）

### 自动监控与录制
- 后台定时轮询检测主播开播状态
- 检测到开播后自动启动录制
- 支持手动开启/关闭自动监控和自动录制

### 凭证管理
- 扫码登录自动捕获 Cookie
- 手动导入 Cookie 凭证
- Cookie 负载均衡（自动选择使用次数最少的凭证）
- 凭证有效性验证

### 视频格式转换
- 基于 FFmpeg 的无损封装转换
- 支持 MP4、MKV、FLV、TS、MOV、AVI 等格式
- 实时进度监控
- 转换任务队列管理

### 其他功能
- 实时系统遥测（网速监控）
- 日志文件记录（自动轮转，10MB 上限）
- 自定义对话框（替代原生弹窗）
- 搜索过滤直播间

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite |
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 包管理器 | Bun |
| 录制工具 | FFmpeg |

## 项目结构

```
├── src/                          # 前端源码
│   ├── App.tsx                   # 主框架（侧边栏、顶部栏、底部栏）
│   ├── App.css                   # 全局样式
│   ├── types.ts                  # TypeScript 类型定义
│   ├── utils.ts                  # 工具函数
│   ├── pages/                    # 页面组件
│   │   ├── DashboardPage.tsx     # 录制面板
│   │   ├── CredentialsPage.tsx   # 凭证中心
│   │   ├── ConverterPage.tsx     # 格式转换
│   │   └── SettingsPage.tsx      # 系统设置
│   └── components/               # 通用组件
│       ├── RoomCard.tsx          # 直播间卡片
│       ├── AddRoomModal.tsx      # 添加直播间弹窗
│       ├── RoomSettingsModal.tsx # 直播间设置弹窗
│       ├── DialogModal.tsx       # 通用对话框
│       └── Icons.tsx             # SVG 图标组件
├── src-tauri/                    # Rust 后端源码
│   ├── src/
│   │   ├── lib.rs                # Tauri 命令路由
│   │   ├── config.rs             # 配置管理
│   │   ├── parser.rs             # 直播流解析
│   │   ├── recorder.rs           # FFmpeg 录制管理
│   │   ├── monitor.rs            # 后台监控轮询
│   │   ├── telemetry.rs          # 系统遥测
│   │   └── logger.rs             # 日志系统
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

## 开发环境

### 前置要求

- [Bun](https://bun.sh/) - 包管理器
- [Rust](https://www.rust-lang.org/tools/install) - 后端语言
- [FFmpeg](https://ffmpeg.org/) - 视频录制和转换
- [Tauri CLI](https://tauri.app/start/prerequisites/) - 桌面框架

### 安装依赖

```bash
# 安装前端依赖
bun install

# 安装 Tauri CLI（如未安装）
cargo install tauri-cli
```

### 开发调试

```bash
# 启动开发服务器
cargo tauri dev
```

### 构建打包

```bash
# 构建生产版本
cargo tauri build
```

构建产物位于 `src-tauri/target/release/bundle/` 目录。

## 配置文件

应用配置文件 `config.json` 存储在系统应用数据目录：

- **Windows**: `C:\Users\{用户名}\AppData\Roaming\com.live-recorder.app\config.json`
- **macOS**: `~/Library/Application Support/com.live-recorder.app/config.json`
- **Linux**: `~/.local/share/com.live-recorder.app/config.json`

日志文件 `app.log` 与配置文件位于同一目录，大小限制 10MB，超出自动清理。

## 使用说明

1. **添加直播间**：点击顶部"添加直播"按钮，输入抖音/B站直播间数字 ID
2. **检测开播**：点击卡片上的刷新图标手动检测主播状态
3. **开始录制**：主播开播后，点击"开始录制"按钮
4. **自动录制**：在直播间设置中开启"自动监控"和"自动录制"
5. **格式转换**：切换到"格式转换"页面，选择源文件和目标格式进行无损转换

## 许可证

MIT License
