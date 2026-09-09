/**
 * 큰 문서는 위지윅 편집이 느리다. 열 때 한 번 알려 준다.
 *
 * 왜 느린가 — MDXEditor 는 **글자 하나가 바뀔 때마다 문서 전체를 마크다운으로 다시
 * 쓴다**(`plugins/core` 의 update listener). 이건 코어에 박혀 있어 끌 수 없다.
 *
 * 실측(268KB · 3541줄, 배포 빌드)
 *
 *   위지윅  한 글자 0.59초 · 한글 조합 한 단계 0.35초
 *   원본    한 글자 0.014초
 *
 * 40배다. 그래서 "느리다" 로 끝내지 않고 **원본 모드**라는 길을 함께 알려 준다.
 */

/** 이보다 길면 알린다 (글자 수) */
export const BIG_DOC_CHARS = 100_000

/** 이 문서를 처음 볼 모드. 큰 문서는 원본으로 연다 */
export const initialViewMode = (text, useSourceForBig = true) => (
  useSourceForBig && (text?.length ?? 0) >= BIG_DOC_CHARS ? 'source' : 'rich-text'
)

export function bigDocNotice(text) {
  const n = text?.length ?? 0
  if (n < BIG_DOC_CHARS) return ''
  return `문서가 큽니다(약 ${Math.round(n / 1000)}천 자) — 원본 모드로 열었습니다. `
    + '위지윅은 글자마다 문서 전체를 다시 셈해 한 글자에 0.6초가 듭니다(원본 모드는 0.014초). '
    + '툴바 오른쪽 끝에서 언제든 바꿀 수 있습니다.'
}
