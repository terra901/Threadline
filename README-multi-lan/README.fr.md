<div align="center">

<img src="../assets/threadline-logo.png" alt="Threadline logo" width="520">

# Threadline — Enregistrez et cartographiez vos conversations IA

**Une extension local-first pour enregistrer, rechercher, rappeler et visualiser vos historiques de chat IA.**

[README principal](../README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Deutsch](README.de.md)

</div>

---

Threadline capture les conversations des sites IA pris en charge, les stocke dans l'IndexedDB du navigateur, génère des embeddings locaux pour Recall et affiche chaque conversation sous forme de Memory Graph avec branches.

Ce projet est basé sur [marswangyang/personal-ai-memory](https://github.com/marswangyang/personal-ai-memory) et inspiré par [Vector-Mesh/VectorMesh](https://github.com/Vector-Mesh/VectorMesh).

## Fonctionnalités

| Fonction | Description |
|---|---|
| Capture locale | Enregistre les conversations ChatGPT, Claude, Gemini, Perplexity et Grok. |
| Memory Graph | Ouvre un onglet complet pour parcourir les sessions enregistrées et en attente. |
| Vue en branches | Affiche les modifications de prompts et les nouvelles tentatives comme chemins alternatifs. |
| Sauvegarde Auto / Manual | Auto enregistre immédiatement ; Manual permet de vérifier avant persistance. |
| Panneau Recall Result | Affiche les mémoires top-k au-dessus de l'entrée et injecte seulement le texte sélectionné. |
| Import / Export | Prend en charge backups complets, export d'une session et exports de fournisseurs. |

## Installation

Prérequis :

- Node.js 18 ou plus récent
- pnpm
- Chrome, Edge, Brave ou un autre navigateur Chromium

```bash
git clone https://github.com/terra901/Threadline.git
cd Threadline
pnpm install
pnpm build
```

Charger l'extension :

1. Ouvrez `chrome://extensions/`.
2. Activez **Developer mode**.
3. Cliquez sur **Load unpacked**.
4. Sélectionnez `build/chrome-mv3-prod`.

Développement :

```bash
pnpm dev
```

Puis chargez `build/chrome-mv3-dev`.

## Utilisation

1. Ouvrez un site IA compatible et discutez normalement.
2. Cliquez sur le bouton flottant Threadline pour ouvrir le panneau.
3. Choisissez Auto ou Manual save mode dans les settings.
4. Ouvrez **Memory Graph** pour parcourir les sessions enregistrées et en attente.
5. Utilisez **Recall** près de l'entrée IA pour rechercher les mémoires pertinentes.
6. Sélectionnez des résultats dans Recall Result et cliquez sur **Confirm** pour les injecter.

## Stockage

Threadline stocke les données dans le stockage local de l'extension :

| Stockage | Usage |
|---|---|
| IndexedDB `AIMemoryDB` | Messages, metadata, embeddings et indicateurs de suppression douce. |
| `chrome.storage.local` | Settings, langue, thème, prompts et pending sessions. |
| Offscreen document | Exécute l'inférence locale d'embeddings. |

`AIMemoryDB` est conservé volontairement pour la compatibilité avec les installations locales existantes.

Champs importants de `memories` : `id`, `role`, `content`, `provider`, `sessionId`, `timestamp`, `turnIndex`, `roundIndex`, `branchIndex`, `branchId`, `pathId`, `parentMessageId`, `chunkIndex`, `parentId`, `embedding`, `hasEmbedding` et `metadata`.

## Recall et découpage

Threadline utilise une récupération hybride :

```text
query -> embedding local -> recherche vectorielle avec décroissance temporelle
      -> recherche BM25
      -> reciprocal rank fusion
      -> résultats Recall top-k
```

Les longs messages sont découpés en fragments de 500 caractères avec 75 caractères de chevauchement avant embedding. Memory Graph fusionne les fragments pour les afficher comme messages logiques.

## Import et export

- Les backups complets Threadline utilisent `metadata.app = "Threadline"` et un tableau `payload`.
- Les anciens backups `PersonalAIMemoryLayer` restent compatibles.
- Memory Graph exporte une session au format `ThreadlineSessionGraph`.
- Les imports prennent en charge ChatGPT, Claude, Gemini Takeout et Grok. Perplexity est capturé en visitant les threads.

## Confidentialité

Threadline n'a pas de serveur. Le contenu des conversations reste dans votre profil navigateur et n'est pas envoyé à un service Threadline. Les embeddings s'exécutent localement via Transformers.js / ONNX ; le runtime peut télécharger le modèle s'il n'est pas en cache.

## Licence

Apache License 2.0. Voir [LICENSE](../LICENSE).
