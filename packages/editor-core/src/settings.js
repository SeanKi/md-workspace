export const DEFAULT_SETTINGS = {
  // 이미지 붙여넣기 시 저장할 하위 폴더 이름.
  // '' 또는 '.' 이면 문서와 같은 폴더에 저장한다.
  imageDir: 'images',
  // 자동 저장 간격(초). 0 이면 사용하지 않는다.
  autoSaveSec: 0,
  // 본문 폭. false 면 인쇄물처럼 고정 폭(가운데), true 면 화면 전체 폭.
  wideLayout: false,
}

export function loadSettings(key, defaults = DEFAULT_SETTINGS) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(key, s) {
  try { localStorage.setItem(key, JSON.stringify(s)) } catch { /* 무시 */ }
}
