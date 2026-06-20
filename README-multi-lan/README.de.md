<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — Speichere und kartiere deine KI-Gespräche

**Eine local-first Browser-Erweiterung zum Speichern, Suchen, Wiederfinden und Visualisieren von KI-Chatverläufen.**

[Haupt-README](../README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md)

</div>

---

Threadline erfasst Gespräche von unterstützten KI-Websites, speichert sie in der IndexedDB des Browsers, erzeugt lokale Embeddings für Recall und zeigt jedes Gespräch als verzweigungsfähigen Memory Graph an.

Dieses Projekt basiert auf [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory) und ist von [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh) inspiriert.

## Funktionen

| Funktion | Beschreibung |
|---|---|
| Lokale Erfassung | Speichert Gespräche von ChatGPT, Claude, Gemini, Perplexity und Grok. |
| Memory Graph | Öffnet einen eigenen Tab zum Durchsuchen gespeicherter und ausstehender Sessions. |
| Branch view | Zeigt Prompt-Bearbeitungen und Wiederholungen als alternative Pfade. |
| Auto / Manual save | Auto speichert sofort; Manual lässt dich vor dem Speichern prüfen. |
| Recall Result panel | Zeigt top-k Memories über dem Eingabefeld und injiziert nur ausgewählten Quelltext. |

## Installation

Voraussetzungen:

- Node.js 18 oder neuer
- pnpm
- Chrome, Edge, Brave oder ein anderer Chromium-Browser

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

Erweiterung laden:

1. Öffne `chrome://extensions/`.
2. Aktiviere **Developer mode**.
3. Klicke auf **Load unpacked**.
4. Wähle `build/chrome-mv3-prod`.

Entwicklung:

```bash
pnpm dev
```

Dann `build/chrome-mv3-dev` laden.

## Nutzung

1. Öffne eine unterstützte KI-Website und chatte normal.
2. Klicke auf den schwebenden Threadline-Button, um das Panel zu öffnen.
3. Wähle Auto oder Manual save mode in den settings.
4. Öffne **Memory Graph**, um gespeicherte und ausstehende Sessions zu durchsuchen.
5. Nutze **Recall** neben dem KI-Eingabefeld, um relevante Memories zu finden.
6. Wähle Ergebnisse im Recall Result panel und klicke **Confirm**, um sie einzufügen.

## Datenspeicherung

Threadline speichert Daten im lokalen Erweiterungsspeicher:

| Speicher | Zweck |
|---|---|
| IndexedDB `AIMemoryDB` | Nachrichten, metadata, embeddings und Soft-Delete-Markierungen. |
| `chrome.storage.local` | Settings, Sprache, Theme, Prompts und pending sessions. |
| Offscreen document | Führt lokale Embedding-Inferenz aus. |

`AIMemoryDB` bleibt absichtlich erhalten, um bestehende lokale Installationen nicht zu brechen.

## Datenschutz

Threadline hat keinen Server. Gesprächsinhalte bleiben im Browserprofil und werden nicht an einen Threadline-Dienst hochgeladen. Embeddings laufen lokal über Transformers.js / ONNX; das Modell kann vom Extension-Runtime heruntergeladen werden, falls es nicht im Cache liegt.

## Lizenz

Apache License 2.0. Siehe [LICENSE](../LICENSE).
