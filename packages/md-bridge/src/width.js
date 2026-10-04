/** 한글·한자·전각은 고정폭 글꼴에서 두 칸이다 — 줄 맞춤 표가 VS Code 에서 맞게 */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u

export function displayWidth(s) {
  let w = 0
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1
  return w
}
