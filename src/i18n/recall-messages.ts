import type { LangCode } from './translations'
import {
  detectDefaultLang,
  loadLangFromChrome,
  readLangFromLocalStorage,
  writeLangToLocalStorage,
  LANG_STORAGE_KEY,
} from './lang-storage'

const RECALL_MESSAGES: Record<
  LangCode,
  {
    promptEmpty: string
    alreadyRecalled: string
    noMemories: string
    noRelevantMemories: string
    searchFailed: (error: string) => string
  }
> = {
  'zh-TW': {
    promptEmpty: '[Threadline] 請先輸入你的問題，再點擊 Recall。',
    alreadyRecalled:
      '[Threadline] 已經注入過記憶。請先清空文字框，再輸入新的問題並重新點擊 Recall。',
    noMemories: '[Threadline] 還沒有已儲存的聊天記錄。請先保存一些對話，再使用 Recall。',
    noRelevantMemories: '[Threadline] 沒有找到與這次查詢相關的記憶。',
    searchFailed: (error) => `[Threadline] 搜尋失敗：${error}`,
  },
  'zh-CN': {
    promptEmpty: '[Threadline] 请先输入你的问题，然后再点击 Recall。',
    alreadyRecalled:
      '[Threadline] 已经注入过记忆。请先清空输入框，再输入新的问题并重新点击 Recall。',
    noMemories: '[Threadline] 还没有已保存的聊天记录。请先保存一些对话，再使用 Recall。',
    noRelevantMemories: '[Threadline] 没有找到与这次查询相关的记忆。',
    searchFailed: (error) => `[Threadline] 搜索失败：${error}`,
  },
  en: {
    promptEmpty: '[Threadline] Please type your question first, then click Recall.',
    alreadyRecalled:
      '[Threadline] Memories already recalled. Clear the text and type your question again to recall fresh memories.',
    noMemories: '[Threadline] No saved conversations yet. Save some chats first, then use Recall.',
    noRelevantMemories: '[Threadline] No relevant memories found for your query.',
    searchFailed: (error) => `[Threadline] Search failed: ${error}`,
  },
  ja: {
    promptEmpty: '[Threadline] まず質問を入力してから、Recall をクリックしてください。',
    alreadyRecalled:
      '[Threadline] すでにメモリが注入されています。入力欄をいったんクリアしてから、新しい質問を入力して再度 Recall をクリックしてください。',
    noMemories: '[Threadline] 保存済みの会話がまだありません。先にいくつかの会話を保存してから Recall を使用してください。',
    noRelevantMemories: '[Threadline] このクエリに関連するメモリは見つかりませんでした。',
    searchFailed: (error) => `[Threadline] 検索に失敗しました：${error}`,
  },
  ko: {
    promptEmpty: '[Threadline] 먼저 질문을 입력한 뒤 Recall을 클릭해 주세요.',
    alreadyRecalled:
      '[Threadline] 이미 메모리가 주입되었습니다. 입력창의 내용을 지운 뒤, 새 질문을 입력하고 다시 Recall을 클릭해 주세요.',
    noMemories: '[Threadline] 아직 저장된 대화가 없습니다. 먼저 대화를 저장한 뒤 Recall을 사용하세요.',
    noRelevantMemories: '[Threadline] 이 질문과 관련된 메모리를 찾지 못했습니다.',
    searchFailed: (error) => `[Threadline] 검색 실패: ${error}`,
  },
  es: {
    promptEmpty: '[Threadline] Escribe primero tu pregunta y luego haz clic en Recall.',
    alreadyRecalled:
      '[Threadline] Las memorias ya se han inyectado. Borra el texto, escribe tu pregunta de nuevo y vuelve a hacer clic en Recall para obtener memorias frescas.',
    noMemories: '[Threadline] Todavía no hay conversaciones guardadas. Guarda algunos chats primero y luego usa Recall.',
    noRelevantMemories: '[Threadline] No se encontraron memorias relevantes para tu consulta.',
    searchFailed: (error) => `[Threadline] Error de búsqueda: ${error}`,
  },
  fr: {
    promptEmpty: "[Threadline] Saisissez d'abord votre question, puis cliquez sur Recall.",
    alreadyRecalled:
      "[Threadline] Des souvenirs ont déjà été injectés. Effacez le texte, saisissez à nouveau votre question puis cliquez sur Recall pour rappeler de nouveaux souvenirs.",
    noMemories: "[Threadline] Aucune conversation n'est encore enregistrée. Enregistrez d'abord quelques conversations, puis utilisez Recall.",
    noRelevantMemories: "[Threadline] Aucun souvenir pertinent n'a été trouvé pour votre requête.",
    searchFailed: (error) => `[Threadline] Échec de la recherche : ${error}`,
  },
  de: {
    promptEmpty: "[Threadline] Bitte gib zuerst deine Frage ein und klicke dann auf Recall.",
    alreadyRecalled:
      "[Threadline] Erinnerungen wurden bereits eingefügt. Bitte lösche zuerst den Text, gib deine Frage erneut ein und klicke noch einmal auf Recall, um neue Erinnerungen abzurufen.",
    noMemories: '[Threadline] Es gibt noch keine gespeicherten Gespräche. Speichere zuerst einige Chats und verwende dann Recall.',
    noRelevantMemories: '[Threadline] Keine relevanten Erinnerungen für diese Anfrage gefunden.',
    searchFailed: (error) => `[Threadline] Suche fehlgeschlagen: ${error}`,
  },
}

let cachedLang: LangCode | null = null

// Best-effort async bootstrap from chrome.storage.local so all contexts share one language
void (async () => {
  const fromChrome = await loadLangFromChrome()
  if (fromChrome) {
    cachedLang = fromChrome
    writeLangToLocalStorage(fromChrome)
  }
})()

// Keep cachedLang in sync when other contexts update chrome.storage.local
try {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      const change = changes[LANG_STORAGE_KEY]
      const next = change?.newValue as LangCode | undefined
      if (!next || next === cachedLang) return
      cachedLang = next
      writeLangToLocalStorage(next)
    })
  }
} catch {
  // ignore
}

function detectLangForContentScript(): LangCode {
  if (cachedLang) return cachedLang

  const fromLocal = readLangFromLocalStorage()
  if (fromLocal && fromLocal in RECALL_MESSAGES) {
    cachedLang = fromLocal
    return fromLocal
  }

  const nav = typeof navigator !== 'undefined' ? navigator.language ?? '' : 'en'
  const fallback = detectDefaultLang(nav)
  cachedLang = fallback
  writeLangToLocalStorage(fallback)
  return fallback
}

export function getRecallMessagesForContentScript() {
  const lang = detectLangForContentScript()
  return RECALL_MESSAGES[lang] ?? RECALL_MESSAGES.en
}
