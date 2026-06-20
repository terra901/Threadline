<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — AI 대화를 저장하고 맵으로 보기

**AI 채팅 기록을 로컬에서 저장, 검색, Recall, 시각화하는 브라우저 확장입니다.**

[Main README](../README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

Threadline은 지원되는 AI 웹사이트의 대화를 캡처하고 브라우저 IndexedDB에 저장합니다. 로컬 embedding을 생성해 Recall에 사용하며, 각 대화를 branch-aware Memory Graph로 표시합니다.

이 프로젝트는 [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory)를 기반으로 하며, 대화를 그래프로 관리하는 방향은 [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh)에서 영감을 받았습니다.

## Highlights

| Feature | Description |
|---|---|
| Local capture | ChatGPT, Claude, Gemini, Perplexity, Grok 대화를 로컬에 저장합니다. |
| Memory Graph | 저장된 session과 pending session을 전체 탭에서 탐색합니다. |
| Branch view | 프롬프트 수정과 재시도를 평면 타임라인이 아니라 분기 경로로 보여줍니다. |
| Auto / Manual save | Auto는 즉시 저장하고 Manual은 확인 후 IndexedDB에 저장합니다. |
| Recall Result panel | 입력창 위에 top-k memory를 보여주고 선택한 원문만 주입합니다. |

## Installation

Requirements:

- Node.js 18+
- pnpm
- Chrome, Edge, Brave 같은 Chromium 브라우저

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

Load the extension:

1. `chrome://extensions/`를 엽니다.
2. **Developer mode**를 켭니다.
3. **Load unpacked**를 클릭합니다.
4. `build/chrome-mv3-prod`를 선택합니다.

Development:

```bash
pnpm dev
```

Then load `build/chrome-mv3-dev`.

## Usage

1. 지원되는 AI 사이트에서 평소처럼 대화합니다.
2. Threadline floating button을 눌러 panel을 엽니다.
3. Settings에서 Auto 또는 Manual save mode를 선택합니다.
4. **Memory Graph**를 열어 저장된 session과 pending session을 봅니다.
5. AI 입력창 옆 **Recall**로 관련 memory를 검색합니다.
6. Recall Result panel에서 결과를 선택하고 **Confirm**으로 입력창에 주입합니다.

## Data Storage

Threadline stores data in browser extension storage:

| Storage | Purpose |
|---|---|
| IndexedDB `AIMemoryDB` | Conversation records, metadata, embeddings, soft-delete flags. |
| `chrome.storage.local` | Settings, language, theme, prompts, pending sessions. |
| Offscreen document | Runs local embedding inference. |

`AIMemoryDB`는 기존 로컬 설치와의 호환성을 위해 유지됩니다.

## Privacy

Threadline has no server. Conversation content stays in your browser profile and is not uploaded to a Threadline service. Embeddings run locally through Transformers.js / ONNX; the model may be downloaded by the extension runtime if not cached.

## License

Apache License 2.0. See [LICENSE](../LICENSE).
