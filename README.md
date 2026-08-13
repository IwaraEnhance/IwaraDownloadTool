[English](.github/README/README.md) <sup>\*We need volunteer translators for English localization.</sup>

[日本語](.github/README/README_ja.md) <sup>\*日本語ローカライズを提供してくれる翻訳ボランティアを必要としています。</sup>

# Iwara 视频下载工具

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool?ref=badge_shield)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool.svg?type=shield&issueType=security)](https://app.fossa.com/projects/git%2Bgithub.com%2FIwaraEnhance%2FIwaraDownloadTool?ref=badge_shield&issueType=security)
![GitHub All Releases](https://img.shields.io/github/downloads/IwaraEnhance/IwaraDownloadTool/total)

- 批量下载视频
- 支持基于Aria2实现的下载器
- 自动检查视频简介以及评论区中是否存在第三方网盘下载连接
- 自定义保存位置以及文件名 <sup>\*仅支持Aria2、iwaradl，其他下载模式仅支持自定义文件名</sup>
- 自动关注选中的视频作者 <sup>\*默认关闭，需手动开启该功能</sup>
- 自动点赞/喜欢选中的视频 <sup>\*默认关闭，需手动开启该功能</sup>
- 不公开和私有视频强制显示 <sup>\*默认关闭，需要关注作者</sup>
- 过滤订阅页中的不公开和私有视频 <sup>\*默认关闭，与强制显示互斥</sup>
- 支持下载私有视频 <sup>\*需要使用已与作者成为好友的账号进行下载</sup>
- 支持下载隐藏视频 <sup>\*需要知道视频ID</sup>
- Aria2 任务自动追踪：自动接管现有任务，速度过慢时自动重启

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

## 参与贡献

我们欢迎所有形式的贡献！请查看 [贡献指南](https://github.com/IwaraEnhance/IwaraDownloadTool/blob/master/CONTRIBUTING.md) 了解如何开始。

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
