<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — 保存并映射你的 AI 对话

**一个本地优先的浏览器扩展，用来保存、检索、召回并可视化 AI 聊天记录。**

[返回主 README](../README.md) · [English](README.en.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

Threadline 会捕获支持的 AI 网站对话，把聊天记录写入浏览器本地 IndexedDB，生成本地 embedding 用于 Recall，并把每个会话渲染为支持分支的 Memory Graph。

本项目基于 [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory)，图谱化对话管理的灵感来自 [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh)。

## 产品预览

### Recall Result 面板

<p align="center">
  <img src="../assets/threadline-recall-panel.png" alt="Threadline Recall Result 面板和悬浮面板" width="920">
</p>

Recall 结果会显示在 AI 输入框上方。你可以查看匹配到的原文，选择需要注入的记忆，也可以打开 Memory Graph 定位原始消息。

### 支持分支的 Memory Graph

<p align="center">
  <img src="../assets/threadline-memory-graph.png" alt="Threadline 支持分支路径的 Memory Graph" width="920">
</p>

Memory Graph 会以独立标签页展示已保存和待保存的会话，并提供 provider 过滤、session 操作、消息统计、向量状态、缩放控制和分支路径视图。

## 功能亮点

| 功能 | 说明 |
|---|---|
| 本地捕获 | 保存 ChatGPT、Claude、Gemini、Perplexity、Grok 的聊天记录。 |
| Memory Graph | 以独立标签页浏览已落库和待落库 session。 |
| 分支视图 | 将修改提示词、重试回答呈现为分支路径，而不是单一时间线。 |
| 自动 / 手动保存 | 自动模式立即写库；手动模式先放入 pending，确认后再落库。 |
| Recall Result 面板 | 在输入框上方展示 top-k 记忆，只注入用户选中的原文。 |

## 安装

要求：

- Node.js 18 或更高版本
- pnpm
- Chrome、Edge、Brave 或其他 Chromium 浏览器

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

加载扩展：

1. 打开 `chrome://extensions/`。
2. 开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择 `build/chrome-mv3-prod`。

开发模式：

```bash
pnpm dev
```

然后加载 `build/chrome-mv3-dev`。

## 使用方式

1. 打开支持的 AI 网站并正常聊天。
2. 点击页面上的 Threadline 悬浮按钮打开面板。
3. 在设置里选择自动保存或手动保存。
4. 打开 **Memory Graph** 浏览已保存和待保存会话。
5. 在 AI 输入框旁点击 **Recall** 检索相关记忆。
6. 在 Recall Result 面板里选择结果，点击 **确定** 后注入输入框。

## 数据存储

Threadline 使用浏览器扩展本地存储：

| 存储位置 | 用途 |
|---|---|
| IndexedDB `AIMemoryDB` | 聊天记录、metadata、embedding、软删除标记。 |
| `chrome.storage.local` | 设置、语言、主题、收藏 prompt、pending session。 |
| Offscreen document | 运行本地 embedding 推理。 |

`AIMemoryDB` 这个数据库名会继续保留，用来兼容已有本地安装的数据。

## 隐私

Threadline 没有服务器。聊天内容保存在你的浏览器 profile 中，不会上传到 Threadline 服务。Embedding 通过 Transformers.js / ONNX 在本地运行；如果模型未缓存，扩展运行时可能会下载模型文件。

## 许可证

Apache License 2.0。见 [LICENSE](../LICENSE)。
