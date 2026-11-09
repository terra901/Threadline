export interface BulkDeleteCopy {
  toolbarTitle: (provider: string) => string
  selectionCount: (selected: number, max: number) => string
  maxReached: (max: number) => string
  exit: string
  deletingTitle: string
  completedTitle: string
  continueDeleting: string
  done: string
  deleteSelected: (count: number) => string
  progress: (done: number, total: number, title: string) => string
  success: (count: number) => string
  failed: (title: string, deleted: number) => string
  localCleanupFailed: (titles: string) => string
  noChats: string
}

const copy: Record<string, BulkDeleteCopy> = {
  'zh-CN': {
    toolbarTitle: (provider) => `批量删除 ${provider} 对话`,
    selectionCount: (selected, max) => `已选 ${selected} / ${max} 条`,
    maxReached: (max) => `每批最多选择 ${max} 条对话。`,
    exit: '退出',
    deletingTitle: '正在删除',
    completedTitle: '删除完成',
    continueDeleting: '继续删除',
    done: '完成',
    deleteSelected: (count) => `删除所选 ${count} 条`,
    progress: (done, total, title) => `正在删除 ${done} / ${total}：${title}`,
    success: (count) => `已通过网站删除 ${count} 条对话。`,
    failed: (title, deleted) => `删除在“${title}”处停止；已删除 ${deleted} 条，其余未处理。`,
    localCleanupFailed: (titles) => `网站已删除这些对话，但 Threadline 本地记忆未能清理：${titles}`,
    noChats: '此页面侧栏中未找到可删除的对话。',
  },
  'zh-TW': {
    toolbarTitle: (provider) => `批量刪除 ${provider} 對話`,
    selectionCount: (selected, max) => `已選 ${selected} / ${max} 條`,
    maxReached: (max) => `每批最多選擇 ${max} 條對話。`,
    exit: '退出',
    deletingTitle: '正在刪除',
    completedTitle: '刪除完成',
    continueDeleting: '繼續刪除',
    done: '完成',
    deleteSelected: (count) => `刪除所選 ${count} 條`,
    progress: (done, total, title) => `正在刪除 ${done} / ${total}：${title}`,
    success: (count) => `已透過網站刪除 ${count} 條對話。`,
    failed: (title, deleted) => `刪除在「${title}」處停止；已刪除 ${deleted} 條，其餘未處理。`,
    localCleanupFailed: (titles) => `網站已刪除這些對話，但 Threadline 本地記憶未能清理：${titles}`,
    noChats: '此頁面側欄中找不到可刪除的對話。',
  },
  en: {
    toolbarTitle: (provider) => `Batch delete ${provider} chats`,
    selectionCount: (selected, max) => `${selected} of ${max} selected`,
    maxReached: (max) => `A batch can contain at most ${max} chats.`,
    exit: 'Exit',
    deletingTitle: 'Deleting chats',
    completedTitle: 'Deletion complete',
    continueDeleting: 'Delete more',
    done: 'Done',
    deleteSelected: (count) => `Delete ${count} selected`,
    progress: (done, total, title) => `Deleting ${done} of ${total}: ${title}`,
    success: (count) => `Deleted ${count} chats through the site.`,
    failed: (title, deleted) => `Stopped at “${title}” after deleting ${deleted}. The remaining selected chats were not processed.`,
    localCleanupFailed: (titles) => `The site deleted these chats, but their Threadline memories could not be cleared: ${titles}`,
    noChats: 'No deletable chats were found in this page sidebar.',
  },
  ja: {
    toolbarTitle: (provider) => `${provider} のチャットを一括削除`,
    selectionCount: (selected, max) => `${selected} / ${max} 件を選択`,
    maxReached: (max) => `1 回に選択できるチャットは最大 ${max} 件です。`,
    exit: '終了',
    deletingTitle: '削除中',
    completedTitle: '削除しました',
    continueDeleting: '続けて削除',
    done: '完了',
    deleteSelected: (count) => `選択項目を削除 (${count})`,
    progress: (done, total, title) => `${done} / ${total} 件目を削除中：${title}`,
    success: (count) => `サイト上で ${count} 件削除しました。`,
    failed: (title, deleted) => `「${title}」で停止しました。${deleted} 件削除済みで、残りは処理していません。`,
    localCleanupFailed: (title) => `サイト上の「${title}」は削除されましたが、Threadline の記憶を消去できませんでした。`,
    noChats: 'このページのサイドバーに削除できるチャットがありません。',
  },
  ko: {
    toolbarTitle: (provider) => `${provider} 대화 일괄 삭제`,
    selectionCount: (selected, max) => `${selected} / ${max}개 선택됨`,
    maxReached: (max) => `한 번에 최대 ${max}개까지 선택할 수 있습니다.`,
    exit: '종료',
    deletingTitle: '삭제 중',
    completedTitle: '삭제 완료',
    continueDeleting: '계속 삭제',
    done: '완료',
    deleteSelected: (count) => `선택 항목 삭제 (${count})`,
    progress: (done, total, title) => `${done} / ${total}개 삭제 중: ${title}`,
    success: (count) => `사이트에서 대화 ${count}개를 삭제했습니다.`,
    failed: (title, deleted) => `“${title}”에서 중단했습니다. ${deleted}개 삭제했고 나머지는 처리하지 않았습니다.`,
    localCleanupFailed: (titles) => `사이트에서 대화를 삭제했지만 Threadline 메모리를 정리하지 못했습니다: ${titles}`,
    noChats: '이 페이지 사이드바에서 삭제할 대화를 찾지 못했습니다.',
  },
  es: {
    toolbarTitle: (provider) => `Eliminar chats de ${provider} en lote`,
    selectionCount: (selected, max) => `${selected} de ${max} seleccionados`,
    maxReached: (max) => `Puedes seleccionar como máximo ${max} chats por lote.`,
    exit: 'Salir',
    deletingTitle: 'Eliminando chats',
    completedTitle: 'Eliminación completada',
    continueDeleting: 'Eliminar más',
    done: 'Listo',
    deleteSelected: (count) => `Eliminar ${count} seleccionados`,
    progress: (done, total, title) => `Eliminando ${done} de ${total}: ${title}`,
    success: (count) => `El sitio eliminó ${count} chats.`,
    failed: (title, deleted) => `Se detuvo en “${title}” tras eliminar ${deleted}. No se procesaron los demás chats seleccionados.`,
    localCleanupFailed: (titles) => `El sitio eliminó estos chats, pero no se pudieron borrar sus memorias de Threadline: ${titles}`,
    noChats: 'No se encontraron chats eliminables en la barra lateral.',
  },
  fr: {
    toolbarTitle: (provider) => `Supprimer des conversations ${provider} en lot`,
    selectionCount: (selected, max) => `${selected} sur ${max} sélectionnée(s)`,
    maxReached: (max) => `Vous pouvez sélectionner au plus ${max} conversations par lot.`,
    exit: 'Quitter',
    deletingTitle: 'Suppression en cours',
    completedTitle: 'Suppression terminée',
    continueDeleting: 'Supprimer d’autres',
    done: 'Terminé',
    deleteSelected: (count) => `Supprimer ${count} sélectionnées`,
    progress: (done, total, title) => `Suppression ${done} sur ${total} : ${title}`,
    success: (count) => `${count} conversations supprimées par le site.`,
    failed: (title, deleted) => `Arrêt sur « ${title} » après ${deleted} suppression(s). Les autres conversations n’ont pas été traitées.`,
    localCleanupFailed: (titles) => `Le site a supprimé ces conversations, mais leurs souvenirs Threadline n’ont pas été effacés : ${titles}`,
    noChats: 'Aucune conversation supprimable dans la barre latérale.',
  },
  de: {
    toolbarTitle: (provider) => `${provider}-Chats gesammelt löschen`,
    selectionCount: (selected, max) => `${selected} von ${max} ausgewählt`,
    maxReached: (max) => `Pro Vorgang können höchstens ${max} Chats ausgewählt werden.`,
    exit: 'Beenden',
    deletingTitle: 'Chats werden gelöscht',
    completedTitle: 'Löschen abgeschlossen',
    continueDeleting: 'Weitere löschen',
    done: 'Fertig',
    deleteSelected: (count) => `${count} ausgewählte löschen`,
    progress: (done, total, title) => `Lösche ${done} von ${total}: ${title}`,
    success: (count) => `${count} Chats wurden über die Website gelöscht.`,
    failed: (title, deleted) => `Bei „${title}“ nach ${deleted} Löschungen angehalten. Die übrigen Chats wurden nicht verarbeitet.`,
    localCleanupFailed: (titles) => `Die Website hat diese Chats gelöscht, aber die Threadline-Erinnerungen konnten nicht entfernt werden: ${titles}`,
    noChats: 'In der Seitenleiste wurden keine löschbaren Chats gefunden.',
  },
}

export function getBulkDeleteCopy(language: string): BulkDeleteCopy {
  return copy[language] ?? copy.en
}
