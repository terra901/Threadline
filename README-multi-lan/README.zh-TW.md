<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — 保存並映射你的 AI 對話

**一個本地優先的瀏覽器擴充功能，用來保存、檢索、召回並視覺化 AI 聊天記錄。**

[返回主 README](../README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

Threadline 會捕獲支援的 AI 網站對話，把聊天記錄寫入瀏覽器本地 IndexedDB，生成本地 embedding 用於 Recall，並把每個會話渲染為支援分支的 Memory Graph。

本專案基於 [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory)，圖譜化對話管理的靈感來自 [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh)。

## 功能亮點

| 功能 | 說明 |
|---|---|
| 本地捕獲 | 保存 ChatGPT、Claude、Gemini、Perplexity、Grok 的聊天記錄。 |
| Memory Graph | 以獨立標籤頁瀏覽已落庫和待落庫 session。 |
| 分支視圖 | 將修改提示詞、重試回答呈現為分支路徑，而不是單一時間線。 |
| 自動 / 手動保存 | 自動模式立即寫庫；手動模式先放入 pending，確認後再落庫。 |
| Recall Result 面板 | 在輸入框上方展示 top-k 記憶，只注入使用者選中的原文。 |
| 匯入 / 匯出 | 支援全庫備份、單個會話圖譜匯出、平台原始匯出匯入。 |

## 安裝

要求：

- Node.js 18 或更高版本
- pnpm
- Chrome、Edge、Brave 或其他 Chromium 瀏覽器

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

載入擴充功能：

1. 打開 `chrome://extensions/`。
2. 開啟 **開發人員模式**。
3. 點擊 **載入未封裝項目**。
4. 選擇 `build/chrome-mv3-prod`。

開發模式：

```bash
pnpm dev
```

然後載入 `build/chrome-mv3-dev`。

## 使用方式

1. 打開支援的 AI 網站並正常聊天。
2. 點擊頁面上的 Threadline 懸浮按鈕打開面板。
3. 在設定裡選擇自動保存或手動保存。
4. 打開 **Memory Graph** 瀏覽已保存和待保存會話。
5. 在 AI 輸入框旁點擊 **Recall** 檢索相關記憶。
6. 在 Recall Result 面板裡選擇結果，點擊 **確定** 後注入輸入框。

## 資料存儲

Threadline 使用瀏覽器擴充功能本地存儲：

| 存儲位置 | 用途 |
|---|---|
| IndexedDB `AIMemoryDB` | 聊天記錄、metadata、embedding、軟刪除標記。 |
| `chrome.storage.local` | 設定、語言、主題、收藏 prompt、pending session。 |
| Offscreen document | 執行本地 embedding 推理。 |

`AIMemoryDB` 這個資料庫名會繼續保留，用來相容已有本地安裝的資料。

`memories` 表的重要欄位包括：`id`、`role`、`content`、`provider`、`sessionId`、`timestamp`、`turnIndex`、`roundIndex`、`branchIndex`、`branchId`、`pathId`、`parentMessageId`、`chunkIndex`、`parentId`、`embedding`、`hasEmbedding`、`metadata`。

## Recall 與分塊

Threadline 使用混合檢索：

```text
query -> 本地 embedding -> 帶時間衰減的向量檢索
      -> BM25 關鍵字檢索
      -> RRF 倒數排名融合
      -> top-k Recall 結果
```

長消息會在 embedding 前按 500 字元分塊，分塊重疊 75 字元。Memory Graph 展示時會把 chunk 合併回邏輯消息。

## 匯入與匯出

- Threadline 全庫備份使用 `metadata.app = "Threadline"` 和 `payload` 陣列。
- 舊版 `PersonalAIMemoryLayer` 備份仍可相容匯入。
- Memory Graph 可以匯出單個 session，格式為 `ThreadlineSessionGraph`。
- 平台匯入支援 ChatGPT、Claude、Gemini Takeout、Grok。Perplexity 需要訪問具體 thread 後自動捕獲。

## 隱私

Threadline 沒有伺服器。聊天內容保存在你的瀏覽器 profile 中，不會上傳到 Threadline 服務。Embedding 透過 Transformers.js / ONNX 在本地執行；如果模型未快取，擴充功能執行時可能會下載模型檔案。

## 授權

Apache License 2.0。見 [LICENSE](../LICENSE)。
