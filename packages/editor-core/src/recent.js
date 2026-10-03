/**
 * "같은 문서인가" 판정과 최근에 연 문서 목록. 두 앱이 함께 쓴다.
 *
 * 이 둘이 한 파일에 있는 이유는 **같은 함정을 공유하기 때문**이다 —
 * 경로는 글자로 비교하면 안 된다. 대화상자는 `C:\a\b.md` 를 주고, 문서 안의 링크는
 * `C:/a/b.md` 로 풀리며(`linkNav.js`), Windows 는 대소문자도 가리지 않는다.
 * 이걸 놓치면 **같은 파일이 탭 두 개로 열리고** 최근 목록에도 두 줄로 남는다.
 */

/** 이보다 많이 쌓이지 않는다. 더 늘리면 고르는 일이 더 번거로워진다 */
export const RECENT_MAX = 30

/** 같은 파일인가 (구분자·대소문자를 가리지 않는다) */
export const samePath = (a, b) =>
  !!a && !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** 맨 앞에 넣는다. 같은 파일은 하나만 남는다 */
export function pushRecent(list, path, max = RECENT_MAX) {
  if (!path) return list ?? []
  return [path, ...(list ?? []).filter((p) => !samePath(p, path))].slice(0, max)
}

/** 목록에서 뺀다. 열리지 않는 것(지웠거나 옮긴 파일)을 걷어내는 데 쓴다 */
export const dropRecent = (list, path) => (list ?? []).filter((p) => !samePath(p, path))
