<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — Guarda y mapea tus conversaciones con IA

**Una extensión local-first para guardar, buscar, recuperar y visualizar historiales de chat con IA.**

[README principal](../README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

Threadline captura conversaciones de sitios de IA compatibles, las guarda en IndexedDB del navegador, genera embeddings locales para Recall y muestra cada conversación como un Memory Graph con ramas.

Este proyecto está basado en [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory) e inspirado por [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh).

## Vista Previa

### Panel Recall Result

<p align="center">
  <img src="../assets/threadline-recall-panel.png" alt="Panel Recall Result y panel flotante de Threadline" width="920">
</p>

Los resultados de Recall aparecen sobre la entrada de IA. Puedes revisar el texto fuente, seleccionar memorias, abrir el mensaje original en Memory Graph e inyectar el contexto elegido.

### Memory Graph con ramas

<p align="center">
  <img src="../assets/threadline-memory-graph.png" alt="Memory Graph de Threadline con rutas ramificadas" width="920">
</p>

Memory Graph muestra sesiones guardadas y pendientes, filtros por proveedor, acciones de sesión, conteos, vectores, controles de zoom y rutas ramificadas.

## Funciones

| Función | Descripción |
|---|---|
| Captura local | Guarda conversaciones de ChatGPT, Claude, Gemini, Perplexity y Grok. |
| Memory Graph | Abre una pestaña completa para explorar sesiones guardadas y pendientes. |
| Vista con ramas | Muestra ediciones de prompts y reintentos como rutas alternativas. |
| Guardado Auto / Manual | Auto guarda de inmediato; Manual permite revisar antes de persistir. |
| Panel Recall Result | Muestra memorias top-k sobre la entrada e inyecta solo el texto seleccionado. |

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

Antes de cambiar la fuente de instalación, reinstalar o pasar entre una versión unpacked y una versión de la tienda del navegador, exporta primero una copia de seguridad de Threadline. Los datos de las extensiones del navegador están aislados por extension ID: los datos de IndexedDB y `chrome.storage.local` guardados bajo un extension ID no se pueden leer automáticamente desde otro extension ID.

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

## Privacidad

Threadline no tiene servidor. El contenido de tus conversaciones queda en el perfil del navegador y no se sube a un servicio de Threadline. Los embeddings se ejecutan localmente con Transformers.js / ONNX; el runtime puede descargar el modelo si no está en caché.

## Licencia

Apache License 2.0. Ver [LICENSE](../LICENSE).
