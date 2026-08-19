# IwaraDownloadTool 贡献指南

感谢你有意为 **IwaraDownloadTool** 做出贡献！

本项目是一个第三方的 Iwara 下载工具，完全独立开发，与 Iwara 官方无任何关联。

为了保持项目的可维护性和可持续发展，请在贡献前认真阅读本指南。

---

## 📌 提交 Issue

在提交 Issue 前，请先查看 [已有 Issues](https://github.com/IwaraEnhance/IwaraDownloadTool/issues)，避免重复。

### 🐛 报告 Bug

如果你发现了可复现的 Bug，请务必提供：

- 复现步骤（越详细越好）
- 操作系统、浏览器或运行环境
- 日志、错误信息、截图（如有）
- 你期望的行为

### 💡 提交功能建议

欢迎提出新功能需求，请尽量说明：

- 这个功能的用途和场景
- 你是否愿意自己尝试实现
- 相关示例或参考实现

---

## 🔀 Pull Request

### 本地开发环境

#### 环境要求

- **Node.js** v23.6.0+（推荐 24.16.0 lts）
- **npm** (随 Node.js 一并安装)
- **VS Code**（推荐，已配置自动化任务）

#### 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/IwaraEnhance/IwaraDownloadTool.git
cd IwaraDownloadTool

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build

# 4. 运行测试
npm run test
```

#### VS Code 自动化任务

项目已配置 VS Code 任务（`.vscode/tasks.json`），打开文件夹时自动执行：

| 任务       | 触发方式              | 说明                                                  |
| ---------- | --------------------- | ----------------------------------------------------- |
| `install`  | 打开文件夹时自动      | 安装项目依赖                                          |
| `dev:i18n` | 打开文件夹时自动      | 监听 `src/i18n/` 中 JSON 文件变更，自动生成 i18n 代码 |
| `build`    | 手动 (`Ctrl+Shift+B`) | 执行 TypeScript 类型检查 + esbuild 构建               |
| `test`     | 手动                  | 运行全部单元测试                                      |

---

### 工作流

1. **Fork** 本仓库
2. 请从 `dev` 创建分支进行修改
3. 提交 Pull Request，目标分支请选择 `dev`
4. 等待 Review 并根据反馈修改

---

## 📁 项目结构

```
IwaraDownloadTool/
├── build/                  # 构建工具脚本
│   ├── build.ts            # 主构建脚本（类型检查 + esbuild 打包）
│   ├── release.ts          # 发布脚本（测试 → 构建 → 版本号 → 标签 → 推送）
│   ├── generate-i18n.ts    # i18n 代码生成器（支持 --watch 监听模式）
│   ├── git.ts              # Git 辅助工具（run/exec/checkCleanWorkingTree）
│   ├── inlineCSS.ts        # esbuild 插件：内联 CSS
│   ├── minifyModules.ts    # esbuild 插件：压缩 node_modules 代码
│   ├── log.ts              # 统一日志输出工具
│   └── tsconfig.json
├── src/                    # 源代码
│   ├── main.ts             # 入口文件
│   ├── i18n/               # 国际化 JSON 文件
│   │   ├── en.json
│   │   ├── ja.json
│   │   └── zh_cn.json
│   ├── i18n.ts             # 自动生成的 i18n 索引（勿手动编辑）
│   ├── css/                # 样式文件
│   ├── types/              # TypeScript 类型定义
│   └── mata/               # Tampermonkey 元数据模板
├── test/                   # 测试
│   ├── main.ts             # 测试入口（自动扫描 tests/ 目录）
│   ├── framework.ts        # 轻量测试框架（断言 + 测试组 + 运行器）
│   ├── setup.ts            # 全局环境 Mock
│   └── tests/              # 测试用例（*.test.ts）
├── dist/                   # 构建输出（生成目录）
└── .vscode/tasks.json      # VS Code 自动化任务配置
```

---

## 🧩 开发指南

### 可用脚本

| 命令                       | 说明                                                      |
| -------------------------- | --------------------------------------------------------- |
| `npm run build`            | 类型检查 + esbuild 打包构建                               |
| `npm run test`             | 类型检查 + 运行全部测试                                   |
| `npm run dev:i18n`         | 监听 `src/i18n/` 目录，JSON 变更时自动生成 `src/i18n.ts`  |
| `npm run release`          | 发布流程（测试 → 构建 → 升级版本 → 提交 → 打标签 → 推送） |
| `npm run release -- minor` | 升级 minor 版本并发布                                     |
| `npm run release -- major` | 升级 major 版本并发布                                     |

### 构建系统

构建工具位于 `build/` 目录

- **`npm run build`** 执行流程：TypeScript 类型检查 → 清空 `dist/` → 解析元数据模板 → esbuild 打包（生成 `.user.js` 和 `.min.user.js`）

### 国际化（i18n）

- 所有用户可见文本必须使用国际化键
- 新增文本需同步更新 `src/i18n/` 下所有语言的 JSON 文件
- 开发时推荐运行 `npm run dev:i18n`，它会监听 JSON 文件变更并自动重新生成 `src/i18n.ts`

### 测试

- 测试用例放在 `test/tests/` 目录下，命名 `*.test.ts`，会被自动扫描注册
- 运行全部测试：`npm run test`（会自动先做 TypeScript 类型检查）

### 发布流程

`npm run release` 会自动执行以下步骤：

1. **检查工作区** — 确保无未提交更改
2. **运行测试** — `npm test`，失败则终止
3. **构建编译** — `npm run build`，失败则终止
4. **升级版本号** — 默认 `patch`，可通过参数指定 `minor`/`major`
5. **提交并打标签** — `git commit` + `git tag vX.Y.Z`
6. **推送** — 推送代码及标签到远程

任何步骤失败会自动回滚。

> **发布由版本标签触发**：CI 仅当推送 `vX.Y.Z` 标签时才构建发布。标签指向 dev → 构建预览版（preview）；合并 dev → master 后，将同一标签重新指向 master 合并提交并推送，才构建正式版（latest）：
>
> ```bash
> git checkout master && git pull
> git tag -f vX.Y.Z && git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z
> ```

### 代码规范

- 使用 **TypeScript**（v6），启用严格模式
- 使用 **ES Modules**（`"type": "module"`）

---

## ⚠️ 注意事项

- 本项目仅作为 Iwara 的第三方工具，与 Iwara 官方无任何关系，请勿用于违反 Iwara 服务条款的场景。
- 使用本项目产生的一切后果由使用者自行承担。

---

再次感谢你的参与与支持！

🚀 **让我们一起让 IwaraDownloadTool 变得更好！**
