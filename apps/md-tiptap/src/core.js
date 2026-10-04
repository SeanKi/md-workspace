/*
 * editor-core 에서 쓰는 것만 하위 경로로 가져온다. `@md/editor-core` 를 통째로 부르면
 * MDXEditor 가 함께 묶인다 (그 index 가 MDXEditor 편집기를 내보낸다).
 */
export { invoke, startDiag, note, flush as flushDiag, logDir, logTail, useBusy } from '@md/editor-core/src/diag.js'
export { isTauri } from '@md/editor-core/src/tauriBridge.js'
export { default as RecentMenu } from '@md/editor-core/src/RecentMenu.jsx'
export { samePath, pushRecent, dropRecent, RECENT_MAX } from '@md/editor-core/src/recent.js'
export { BIG_DOC_CHARS } from '@md/editor-core/src/bigDoc.js'

/** `./.image/` · `.image\` → `.image`. editor-core 의 normalizeImageDir 는 앞의 점을 떼므로 쓰지 않는다 */
export const normalizeImageDir = (v) => String(v ?? '').trim().replace(/^\.[\/]+/, '').replace(/[\/]+$/, '')
