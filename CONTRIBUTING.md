# IwaraDownloadTool 贡献指南

感谢你有意为 **IwaraDownloadTool** 做出贡献！

本项目是一个第三方的 Iwara 下载工具，完全独立开发，与 Iwara 官方无任何关联。

为了保持项目的可维护性和可持续发展，请在贡献前认真阅读本指南。

---

## 📌 提交 Issue

在提交 Issue 前，请先查看 [已有 Issues](https://github.com/IwaraEnhance/IwaraDownloadTool/issues)，避免重复。

### 🐛 报告 Bug

如果你发现了可复现的 Bug，请务必提供：

* 复现步骤（越详细越好）
* 操作系统、浏览器或运行环境
* 日志、错误信息、截图（如有）
* 你期望的行为

### 💡 提交功能建议

欢迎提出新功能需求，请尽量说明：

* 这个功能的用途和场景
* 你是否愿意自己尝试实现
* 相关示例或参考实现

---

## 🔀 Pull Request

### 本地开发环境

本项目基于 Node.js 环境，请按以下步骤配置：

1. **安装 Node.js**  
   要求 Node.js v23.6.0+

2. **安装依赖**  
   ```bash
   npm install
   ```

3. **构建脚本**  
   ```bash
   npm run build
   ```

4. **运行测试**  
   ```bash
   npm run test
   ```

---

### 工作流

1. **Fork** 本仓库
2. 请从 `dev` 创建分支进行修改
3. 提交 Pull Request，目标分支请选择 `dev`
4. 等待 Review 并根据反馈修改

---

## 🧩 开发与测试

### 测试要求
- 新增功能需包含基础单元测试（示例见 `test/` 目录，在 `main.ts` 中引用你的测试用例）
- 运行测试：`npm run test`
- UI 变更需提供前后截图对比

### 国际化
- 所有用户可见文本必须使用国际化键（示例见 `src/i18n/`）
- 新增文本需同步更新 `en.json` 和 `zh_cn.json`

---

## ⚠️ 注意事项

* 本项目仅作为 Iwara 的第三方工具，与 Iwara 官方无任何关系，请勿用于违反 Iwara 服务条款的场景。
* 使用本项目产生的一切后果由使用者自行承担。

---

再次感谢你的参与与支持！

🚀 **让我们一起让 IwaraDownloadTool 变得更好！**
