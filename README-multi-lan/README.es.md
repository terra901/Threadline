<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — Guarda y mapea tus conversaciones con IA

**Una extensión local-first para guardar, buscar, recuperar y visualizar historiales de chat con IA.**

[README principal](../README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

Threadline captura conversaciones de sitios de IA compatibles, las guarda en IndexedDB del navegador, genera embeddings locales para Recall y muestra cada conversación como un Memory Graph con ramas.

Este proyecto está basado en [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory) e inspirado por [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh).

## Funciones

| Función | Descripción |
|---|---|
| Captura local | Guarda conversaciones de ChatGPT, Claude, Gemini, Perplexity y Grok. |
| Memory Graph | Abre una pestaña completa para explorar sesiones guardadas y pendientes. |
| Vista con ramas | Muestra ediciones de prompts y reintentos como rutas alternativas. |
| Guardado Auto / Manual | Auto guarda de inmediato; Manual permite revisar antes de persistir. |
| Panel Recall Result | Muestra memorias top-k sobre la entrada e inyecta solo el texto seleccionado. |
| Importar / Exportar | Soporta backups completos, exportación de una sesión y exports de proveedores. |

## Instalación

Requisitos:

- Node.js 18 o superior
- pnpm
- Chrome, Edge, Brave u otro navegador Chromium

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

Cargar la extensión:

1. Abre `chrome://extensions/`.
2. Activa **Developer mode**.
3. Haz clic en **Load unpacked**.
4. Selecciona `build/chrome-mv3-prod`.

Desarrollo:

```bash
pnpm dev
```

Luego carga `build/chrome-mv3-dev`.

## Uso

1. Abre un sitio de IA compatible y conversa normalmente.
2. Haz clic en el botón flotante de Threadline para abrir el panel.
3. Elige Auto o Manual save mode en settings.
4. Abre **Memory Graph** para explorar sesiones guardadas y pendientes.
5. Usa **Recall** junto a la entrada de IA para buscar memorias relevantes.
6. Selecciona resultados en Recall Result y pulsa **Confirm** para inyectarlos.

## Almacenamiento

Threadline guarda datos en el almacenamiento local de la extensión:

| Almacenamiento | Uso |
|---|---|
| IndexedDB `AIMemoryDB` | Mensajes, metadata, embeddings y marcas de borrado suave. |
| `chrome.storage.local` | Settings, idioma, tema, prompts y pending sessions. |
| Offscreen document | Ejecuta inferencia local de embeddings. |

`AIMemoryDB` se mantiene intencionalmente para compatibilidad con instalaciones locales existentes.

Campos importantes de `memories`: `id`, `role`, `content`, `provider`, `sessionId`, `timestamp`, `turnIndex`, `roundIndex`, `branchIndex`, `branchId`, `pathId`, `parentMessageId`, `chunkIndex`, `parentId`, `embedding`, `hasEmbedding` y `metadata`.

## Recall y fragmentación

Threadline usa recuperación híbrida:

```text
query -> embedding local -> búsqueda vectorial con decaimiento temporal
      -> búsqueda BM25
      -> reciprocal rank fusion
      -> resultados Recall top-k
```

Los mensajes largos se dividen en fragmentos de 500 caracteres con 75 caracteres de solapamiento antes del embedding. Memory Graph vuelve a unir los fragmentos para mostrarlos como mensajes lógicos.

## Importar y exportar

- Los backups completos de Threadline usan `metadata.app = "Threadline"` y un array `payload`.
- Los backups legacy `PersonalAIMemoryLayer` siguen siendo compatibles.
- Memory Graph exporta una sesión como `ThreadlineSessionGraph`.
- Las importaciones soportan ChatGPT, Claude, Gemini Takeout y Grok. Perplexity se captura visitando los threads.

## Privacidad

Threadline no tiene servidor. El contenido de tus conversaciones queda en el perfil del navegador y no se sube a un servicio de Threadline. Los embeddings se ejecutan localmente con Transformers.js / ONNX; el runtime puede descargar el modelo si no está en caché.

## Licencia

Apache License 2.0. Ver [LICENSE](../LICENSE).
