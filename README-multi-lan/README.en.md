<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — Save and map your AI conversations

**A local-first browser extension for saving, searching, recalling, and mapping AI chat history.**

[Back to main README](../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

Threadline captures conversations from supported AI websites, stores them in your browser's IndexedDB, embeds them locally for Recall, and renders each conversation as a branch-aware Memory Graph.

This project is based on [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory) and inspired by [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh).

## Highlights

| Feature | Description |
|---|---|
| Local capture | Saves ChatGPT, Claude, Gemini, Perplexity, and Grok conversations locally. |
| Memory Graph | Opens a full-tab browser for saved and pending sessions. |
| Branch view | Shows prompt edits and retries as alternate paths instead of a flat timeline. |
| Auto / Manual save | Auto saves immediately; Manual lets you review the graph before persisting. |
| Recall Result panel | Shows top-k memories above the input and injects only selected source text. |

## Installation

Requirements:

- Node.js 18 or newer
- pnpm
- Chrome, Edge, Brave, or another Chromium browser

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

Load the extension:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `build/chrome-mv3-prod`.

For development:

```bash
pnpm dev
```

Then load `build/chrome-mv3-dev`.

## Usage

1. Open a supported AI website and chat normally.
2. Click the floating Threadline button to open the panel.
3. Choose Auto or Manual save mode in settings.
4. Open **Memory Graph** to browse saved and pending sessions.
5. Use **Recall** next to the AI input to retrieve relevant memories.
6. Select results in the Recall Result panel and click **Confirm** to inject them into the input.

## Data Storage

Threadline stores data in browser extension storage:

| Storage | Purpose |
|---|---|
| IndexedDB `AIMemoryDB` | Conversation records, metadata, embeddings, soft-delete flags. |
| `chrome.storage.local` | Settings, language, theme, prompts, and pending sessions. |
| Offscreen document | Runs local embedding inference. |

`AIMemoryDB` is intentionally kept for compatibility with existing local installations.

## Privacy

Threadline has no server. Conversation content is stored in your browser profile and is not uploaded to a Threadline service. Embeddings run locally through Transformers.js / ONNX; the model may be downloaded by the extension runtime if not cached.

## License

Apache License 2.0. See [LICENSE](../LICENSE).
