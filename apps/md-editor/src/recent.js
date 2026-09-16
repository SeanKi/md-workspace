/** 최근에 연 문서. 설정과 함께 담긴다 (`md-editor-settings`). */

import { samePath } from './paths.js'

/** 이보다 많이 쌓이지 않는다. 더 늘리면 고르는 일이 더 번거로워진다 */
export const RECENT_MAX = 12

/**
 * 맨 앞에 넣는다. **같은 파일은 하나만 남는다.**
 *
 * 글자 비교로는 중복이 걸러지지 않는다 — 대화상자는 `C:\a\b.md` 를 주고 문서 안의
 * 링크는 `C:/a/b.md` 로 풀리며, Windows 는 대소문자도 가리지 않는다 (`samePath`).
 */
export function pushRecent(list, path) {
  if (!path) return list ?? []
  return [path, ...(list ?? []).filter((p) => !samePath(p, path))].slice(0, RECENT_MAX)
}

/** 목록에서 뺀다. 열리지 않는 것(지웠거나 옮긴 파일)을 걷어내는 데 쓴다 */
export const dropRecent = (list, path) => (list ?? []).filter((p) => !samePath(p, path))
