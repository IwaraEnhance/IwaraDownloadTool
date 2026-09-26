[English](.github/README/README.md) <sup>\*We need volunteer translators for English localization.</sup>

[日本語](.github/README/README_ja.md) <sup>\*日本語ローカライズを提供してくれる翻訳ボランティアを必要としています。</sup>

# Iwara 视频下载工具

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool?ref=badge_shield)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool.svg?type=shield&issueType=security)](https://app.fossa.com/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool?ref=badge_shield&issueType=security)
![GitHub All Releases](https://img.shields.io/github/downloads/IwaraEnhance/IwaraDownloadTool/total)

- 批量下载视频
- 多下载器支持：Aria2（RPC）、iwaradl（RPC）、浏览器 API 直下、其他（新标签页）
- Aria2 任务自动追踪：自动接管现有任务、失败/暂停自动恢复、速度过慢自动重启、重复任务自动去重合并
- 自动检查视频简介以及评论区中是否存在第三方网盘下载连接
- 自定义保存位置以及文件名（路径变量 + NFKC 规范化 / Emoji 替换 / 非法字符清理 / 长度截断） <sup>\*完整路径仅支持Aria2、iwaradl，其他下载模式仅支持自定义文件名</sup>
- 批量选择：视频卡片注入复选框，支持全选/反选/取消、悬浮卡片按空格快选
- 手动下载：输入单个或 `|` 分隔的多个视频 ID 批量创建任务
- 自动关注选中的视频作者 <sup>\*默认关闭，需手动开启该功能</sup>
- 自动点赞/喜欢选中的视频 <sup>\*默认关闭，需手动开启该功能</sup>
- 不公开和私有视频强制显示 <sup>\*默认关闭，需要关注作者</sup>
- 过滤订阅页中的不公开和私有视频（与强制显示互斥）、过滤时间线已喜欢视频 <sup>\*默认关闭</sup>
- 支持下载私有视频 <sup>\*需要使用已与作者成为好友的账号进行下载</sup>
- 支持下载隐藏视频 <sup>\*需要知道视频ID</sup>
- 视频元数据自动下载（JSON，与视频同名的 `.json` 文件）<sup>\*默认关闭</sup>
- MediaCenter 联动 <sup>\*实验性功能，需开启"实验性功能"并配置 API 地址与密钥</sup>
    - Aria2 下载完成后自动推送元数据到 MediaCenter，失败自动退避重试
    - 一键同步本地视频缓存到 MediaCenter（自动建立 ID↔MediaCenter ID 双向映射）
    - 本地数据库导出（videos / follows / friends / idmap 分表 JSON）
- 好友请求一键审批 <sup>\*默认关闭，需在设置中开启</sup>
    - 审批条件可配置（OR 语义，任一满足即批准）<sup>\*默认无条件批准</sup>
    - 无条件 / 对方已关注我 / 我已关注对方 / 对方是 Premium / 对方 30 天内活跃过 / 对方注册满 30 天 / 对方账号状态正常
    - 评论证据：对方在我的个人主页评论过 / 对方在指定论坛帖下评论过（证据帖 ID 可配置）
- 界面自定义：侧边悬浮菜单、美化样式、宽屏适配、多语言（简体中文 / English / 日本語）、配置导入导出

## 使用说明

### 安装脚本

- 从 GreasyFork 安装
  **[前往](https://sleazyfork.org/scripts/422239)**
- GitHub Release
  **[安装](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/latest/IwaraDownloadTool.user.js)**
- GitHub Release \[预览版\]
  **[安装](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/preview/IwaraDownloadTool.user.js)**

#### 支持以下浏览器

- Chrome 或 基于 Chromium 内核的浏览器 (如Edge) <sup>\*版本≥110</sup>
- Firefox <sup>\*版本≥110</sup>

#### 推荐脚本管理器插件

- Tampermonkey (篡改猴) **[前往官网](https://www.tampermonkey.net/)**

#### 详细使用说明

前往 [Wiki](https://github.com/IwaraEnhance/IwaraDownloadTool/wiki)

## 数据与隐私

- 视频元数据缓存、关注/好友信息存储在浏览器本地 IndexedDB（库名 `IwaraDownloadTool`），不回传任何第三方
- 配置与跨页同步状态存放在脚本管理器提供的 GM 存储；登录凭证仅在请求 Iwara API 时使用
- 脚本会拦截页面 fetch 用于凭证维护与元数据缓存，不收集、不上传任何数据

## 参与贡献

我们欢迎所有形式的贡献！请查看 [贡献指南](https://github.com/IwaraEnhance/IwaraDownloadTool/blob/master/CONTRIBUTING.md) 了解如何开始，其中包含本地开发环境、项目结构、构建系统与开发约定。

## 鸣谢

感谢以下开发者对 IwaraDownloadTool 作出的贡献，有你们 IwaraDownloadTool 才能变得更好！

[![Contributors](https://contrib.rocks/image?repo=IwaraEnhance/IwaraDownloadTool&max=1000)](https://github.com/IwaraEnhance/IwaraDownloadTool/graphs/contributors)

## 依赖库

### 运行时依赖

- [day.js](https://github.com/iamkun/dayjs) - [MIT License](https://opensource.org/licenses/MIT)
- [idb](https://github.com/jakearchibald/idb) - [ISC License](https://opensource.org/license/isc)
- [emoji-regex](https://github.com/slevithan/emoji-regex-xs) - [MIT License](https://opensource.org/licenses/MIT) <sup>\*内嵌源码（vendored），见 src/core/env.ts</sup>

### 开发依赖

- [TypeScript](https://github.com/microsoft/TypeScript) - [Apache-2.0](https://opensource.org/licenses/Apache-2.0)
- [esbuild](https://github.com/evanw/esbuild) - [MIT License](https://opensource.org/licenses/MIT)
- [tsx](https://github.com/privatenumber/tsx) - [MIT License](https://opensource.org/licenses/MIT)

## 同类项目

- [iwaradl](https://github.com/Izumiko/iwaradl) - [MIT License](https://opensource.org/licenses/MIT) CLI Iwara 视频下载器

## 开源许可

本项目基于 [MIT License](https://opensource.org/licenses/MIT) 协议开源，请遵守相关协议条款。

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool?ref=badge_large)
