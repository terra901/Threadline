<div align="center">

<img src="assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — Save and map your AI conversations

**A local-first browser extension for saving, searching, and visualizing AI chat history.**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![Built with Plasmo](https://img.shields.io/badge/Built%20with-Plasmo-6E56CF.svg)](https://docs.plasmo.com)
[![Local First](https://img.shields.io/badge/Data-local%20IndexedDB-0A84FF.svg)](#privacy--security)

Languages: [English](README-multi-lan/README.en.md) | [简体中文](README-multi-lan/README.zh-CN.md) | [繁體中文](README-multi-lan/README.zh-TW.md) | [日本語](README-multi-lan/README.ja.md) | [한국어](README-multi-lan/README.ko.md) | [Español](README-multi-lan/README.es.md) | [Français](README-multi-lan/README.fr.md) | [Deutsch](README-multi-lan/README.de.md)

</div>

---

Threadline captures conversations from supported AI websites, stores them in your browser's IndexedDB, embeds them locally for recall, and renders each conversation as a branch-aware graph. It is built for people who revise prompts, compare answer paths, and want their AI work to become searchable memory instead of a disappearing scrollback.

This project is based on [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory). The Memory Graph direction and branch-style visualization are inspired by [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh).

## Status

Threadline is an unpacked Chrome/Chromium extension for local use and active development. It is distributed from this repository for now.

Supported providers:

| Provider | Capture | Recall | Import |
|---|---:|---:|---:|
| ChatGPT | Yes | Yes | `conversations.json` |
| Claude | Yes | Yes | `conversations.json` |
| Gemini | Yes | Yes | Google Takeout JSON |
| Perplexity | Yes | Yes | Visit each thread |
| Grok | Yes | Yes | Grok export JSON |

## What Threadline Adds

Threadline keeps the local-first memory foundation from the upstream project and extends it into a conversation browser:

| Area | What it does |
|---|---|
| Memory Graph | Opens a full tab for browsing saved and pending sessions as graph-like conversation timelines. |
| Branch view | Groups edits/retries into branch paths instead of flattening everything by timestamp. |
| Auto / Manual save | Auto mode saves captures immediately; Manual mode keeps current sessions pending until you choose to persist them. |
| Current-session sync | Opening Memory Graph can sync an already-open conversation from the page DOM before browsing it. |
| Session actions | Save pending sessions, export one session, or delete a session from the graph sidebar. |
| Recall result panel | Shows top-k recall results above the chat input; selected results can be injected into the composer. |
| Open original | Recall results can jump into Memory Graph and briefly highlight the source message. |
| Threadline branding | Extension name, panel title, backup metadata, docs, and floating icon use the Threadline identity. |

## Installation

### Build Locally

Requirements:

- Node.js 18 or newer
- pnpm
- Chrome, Edge, Brave, or another Chromium browser with Manifest V3 support

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

The production extension is generated at:

```text
build/chrome-mv3-prod
```

### Load the Extension

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `build/chrome-mv3-prod`.
5. Pin Threadline from the browser extension menu if you want quick access.

After any code change, run `pnpm build`, click **Reload** on the Threadline extension card, and refresh open AI tabs.

### Development Mode

```bash
pnpm dev
```

Then load:

```text
build/chrome-mv3-dev
```

## How to Use

### 1. Capture Conversations

Open a supported AI site and use it normally. Threadline captures supported provider traffic and, where needed, performs DOM sync to recover messages already visible on the page.

The floating Threadline button appears on supported AI pages. Click it to open the floating panel.

### 2. Choose Auto or Manual Save

Open the floating panel settings.

| Mode | Behavior |
|---|---|
| Auto | Captured messages are written to IndexedDB immediately and queued for embedding. |
| Manual | Captured messages are kept as pending sessions. You can inspect them in Memory Graph before saving. |

The floating panel header shows the active mode:

- Auto is green.
- Manual is blue.

### 3. Open Memory Graph

Use **Memory Graph** from the popup or floating panel.

The graph tab shows:

- saved sessions from IndexedDB
- pending sessions from Manual mode
- provider filters
- search over session title, provider, source, and model
- session-level actions: save, export, delete
- branch-aware message layout
- selected-message detail panel with copy and export actions
- canvas pan and zoom

When opened from an active AI page, Threadline attempts to infer the current session and sync the visible conversation before the graph loads.

### 4. Use Recall

Type a question in the AI site's composer and click **Recall**.

Threadline searches saved memories and displays a **Recall Result** panel above the input:

- Shows the matched source text preview.
- Supports selecting one or more results.
- **Confirm** injects selected memories into the input as context.
- **Open original** jumps to the message in Memory Graph.
- The source node flashes briefly so you can see where the memory came from.

## Data Storage

Threadline stores memory locally in browser extension storage.

| Storage | Purpose |
|---|---|
| IndexedDB `AIMemoryDB` | Saved conversation messages, metadata, embeddings, soft-delete flags. |
| `chrome.storage.local` | Settings, theme, language, favorite prompts, prompt folders, pending sessions. |
| Offscreen document | Runs local embedding inference when a message needs a vector. |

The IndexedDB name is intentionally kept as `AIMemoryDB` for compatibility with existing local installations.

The main IndexedDB table is `memories`.

Important fields include:

| Field | Meaning |
|---|---|
| `id` | Primary key for a record or chunk. |
| `role` | `user` or `assistant`. |
| `content` | Message text or chunk text. |
| `provider` | `openai`, `anthropic`, `google`, `perplexity`, or `xai`. |
| `sessionId` | Provider-scoped conversation id. |
| `timestamp` / `createdAt` | Source message time and local capture time. |
| `turnIndex` | Provider or DOM order. |
| `roundIndex` | Conversation round used by Memory Graph. |
| `branchIndex` | Branch inside a round. |
| `branchId` / `pathId` | Stable grouping keys for branch visualization. |
| `parentMessageId` | Parent link when the provider exposes one or DOM sync can infer it. |
| `chunkIndex` / `parentId` | Chunk metadata for long messages. |
| `embedding` | Local semantic vector. |
| `hasEmbedding` | `0` pending, `1` embedded, `-1` failed. |
| `metadata` | Provider-specific details and capture source. |

## Search and Recall

Threadline uses hybrid retrieval:

```text
query
  -> local embedding
  -> vector search with time decay
  -> BM25 keyword search
  -> reciprocal rank fusion
  -> top-k recall results
```

### Vector Route

- Model: `paraphrase-multilingual-MiniLM-L12-v2`
- Runtime: Transformers.js / ONNX in a Chrome offscreen document
- Score: dot product with a time-decay multiplier

### Keyword Route

- Engine: MiniSearch
- Supports prefix matching
- Useful when exact names, tools, code tokens, or uncommon terms are present

### Fusion

The vector route and keyword route are merged with reciprocal rank fusion. If embedding fails, Threadline falls back to keyword search where possible.

## Chunking

Long messages are split before embedding:

| Setting | Value |
|---|---:|
| Chunk size | 500 characters |
| Overlap | 75 characters |

Chunks let long answers be searchable without forcing one huge embedding. Memory Graph merges chunks back into logical messages for display and shows chunk count when relevant.

## Import and Export

### Full Backup

Use the popup's export action to download a full backup.

New Threadline backups use:

```json
{
  "metadata": {
    "app": "Threadline"
  },
  "payload": []
}
```

Old `PersonalAIMemoryLayer` backups are still accepted for compatibility.

### Session Export

Memory Graph can export a single session as graph JSON. This is useful when you want to archive or share one conversation tree instead of the whole database.

### Provider Imports

Threadline can parse exports from:

- ChatGPT `conversations.json`
- Claude `conversations.json`
- Gemini Google Takeout activity JSON
- Grok account export JSON

Perplexity currently has no official export path, so visit individual Perplexity threads to let Threadline capture them.

## Project Structure

```text
src/
├── background/
│   ├── index.ts              message router, capture handler, import/export
│   ├── db.ts                 Dexie IndexedDB schema and DAO
│   ├── search.ts             hybrid vector/BM25 recall
│   ├── domSync.ts            visible-page conversation sync
│   ├── pendingSessions.ts    Manual-mode pending session cache
│   ├── offscreen.ts          embedding bridge to offscreen page
│   ├── syncEmbeddings.ts     background embedding queue
│   ├── chunking.ts           long-message chunking
│   └── adapters/             provider payload parsers
├── contents/
│   ├── interceptor.ts        isolated-world bridge
│   ├── memory-float-ui.tsx   floating panel entry
│   └── *-injector.tsx        provider Recall / DOM hooks
├── popup/
│   ├── index.tsx             popup root
│   └── components/           floating panel, settings, import/export, prompts
├── tabs/
│   ├── memory-graph.tsx      graph browser tab
│   ├── offscreen.tsx         local embedding compute host
│   └── onboarding.tsx        onboarding tab
├── importers/                provider export parsers
├── i18n/                     language and theme contexts
├── ui/                       shared tokens, icons, mode colors
├── utils/                    recall, message passing, storage, graph helpers
└── types/                    memory and message contracts
```

## Development

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm test:integration
pnpm test:e2e
```

Useful browser debug targets:

| Target | Where |
|---|---|
| Service worker | `chrome://extensions/` -> Threadline -> **Service worker** |
| Popup | right-click extension icon -> **Inspect popup** |
| Memory Graph | open the graph tab and use page DevTools |
| IndexedDB | DevTools -> Application -> IndexedDB -> `AIMemoryDB` |
| Content scripts | DevTools -> Sources -> Content scripts |

## Privacy and Security

Threadline is designed as a local-first tool.

| Question | Answer |
|---|---|
| Does my chat content leave the browser? | No conversation content is sent to a Threadline server. There is no Threadline server. |
| Where are memories stored? | In the browser profile's extension IndexedDB and `chrome.storage.local`. |
| Does embedding require a remote API? | No. Embeddings run locally through Transformers.js in the browser. The model may be downloaded by the extension runtime if not already cached. |
| Can websites read my memories? | No. Memories live in extension storage, isolated from page JavaScript. |
| Can I delete memories? | Yes. Use Memory Graph session deletion or settings deletion for all saved memories. |
| What about pending sessions? | Manual-mode pending sessions are held in `chrome.storage.local` until saved or deleted. |

Because Threadline observes supported AI pages, treat it like a local diary. Review the source before using it for sensitive work.

## Relationship to Upstream

Threadline is based on [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory). The upstream project provided the original local capture, IndexedDB, embedding, import/export, Recall, and floating panel foundation.

Threadline adds a branch-aware Memory Graph, manual save workflow, session graph export, recall result selection panel, current-session sync, Threadline branding, and related UI/documentation changes.

Memory Graph's visual direction is inspired by [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh), especially the idea that AI conversations can be inspected as connected message paths rather than a flat transcript.

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Acknowledgements

- [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory) for the original extension foundation.
- [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh) for the graph-based conversation-management inspiration.
- Plasmo, Dexie, Transformers.js, MiniSearch, React, and the broader local-first web tooling ecosystem.
