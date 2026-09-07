// 마크다운 한 판을 **손대도 되는 조각**과 **그대로 둘 조각**으로 가른다.
// `normalizeMarkdown.js` 가 쓰는 앞단이다.
//
// 그대로 두는 것 — 코드펜스 · 인라인 코드 · 여러 줄 HTML 주석.
// 여기를 고치면 예제 코드나 주석이 망가진다.
//
// 조각마다 **범위(scope)** 를 붙인다. 표 셀은 저마다 다른 번호, 나머지는 전부 0.
// 태그 짝을 셀 때 쓴다 — MDX 에서 JSX 는 표 셀 경계를 넘지 못하기 때문이다.

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

// 구분줄(`|---|---|`). 헤더줄 바로 아래에 있으면 거기서부터 표다
const DELIM_RE = /^\s{0,3}[\s:|-]*$/

function isDelimiterRow(line) {
  const t = line.trim()
  return DELIM_RE.test(t) && t.includes('|') && t.includes('-')
}

/**
 * 여는 백틱 묶음과 **길이가 같은** 묶음의 자리. 없으면 -1.
 * CommonMark 는 길이가 같아야 닫힌 것으로 본다. 짝이 없으면 그냥 글자다.
 * 표 줄에서는 `|` 가 셀 경계라 코드가 그 너머로 닫히지 못한다.
 */
function findCodeEnd(line, from, n, inTable) {
  let i = from
  while (i < line.length) {
    if (inTable && line[i] === '|' && line[i - 1] !== '\\') return -1
    if (line[i] !== '`') { i += 1; continue }
    let k = 0
    while (line[i + k] === '`') k += 1
    if (k === n) return i
    i += k
  }
  return -1
}

/** 한 도막을 인라인 코드 / 그 밖으로 가른다. */
function splitInline(line, inTable, cells) {
  const parts = []
  let plain = ''
  let scope = inTable ? (cells.n += 1) : 0
  const flush = () => { if (plain) { parts.push({ code: false, text: plain, scope }); plain = '' } }

  let i = 0
  while (i < line.length) {
    if (line[i] === '\\' && i + 1 < line.length) { plain += line.slice(i, i + 2); i += 2; continue }
    if (inTable && line[i] === '|') { plain += '|'; flush(); scope = (cells.n += 1); i += 1; continue }
    if (line[i] !== '`') { plain += line[i]; i += 1; continue }

    let n = 0
    while (line[i + n] === '`') n += 1
    const end = findCodeEnd(line, i + n, n, inTable)
    if (end < 0) { plain += line.slice(i, i + n); i += n; continue }   // 짝이 없다 — 글자다

    flush()
    parts.push({ code: true, text: line.slice(i, end + n), scope })
    i = end + n
  }
  flush()
  return parts
}

/** 코드펜스 안에 있는 줄 표시 */
function markFenced(raw) {
  const fenced = raw.map(() => false)
  let fence = null
  raw.forEach((line, i) => {
    const f = FENCE_RE.exec(line)
    if (f) {
      const marker = f[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      fenced[i] = true
      return
    }
    fenced[i] = fence !== null
  })
  return fenced
}

/** 헤더줄 + 구분줄부터 빈 줄 전까지가 표다 */
function markTables(raw, fenced) {
  const inTable = raw.map(() => false)
  raw.forEach((line, i) => {
    if (i === 0 || fenced[i] || !isDelimiterRow(line) || !raw[i - 1].includes('|')) return
    inTable[i - 1] = true
    for (let j = i; j < raw.length && !fenced[j] && raw[j].trim() !== ''; j += 1) inTable[j] = true
  })
  return inTable
}

/**
 * 여러 줄에 걸친 `<!-- ... -->` 의 자리를 줄마다 `[시작, 끝)` 으로 적어 둔다.
 * 한 줄짜리 주석은 뒷단의 scan() 이 알아보므로 여기서는 건너뛴다.
 * 이걸 빼먹으면 `<!--` 가 태그가 아닌 `<` 로 몰려 `&lt;!--` 가 되고,
 * 저장하는 순간 주석이 **눈에 보이는 글자로 바뀐 채 파일에 남는다.**
 */
function commentRanges(raw, fenced) {
  const ranges = raw.map(() => [])
  let open = false
  raw.forEach((line, i) => {
    if (fenced[i]) return
    let at = 0
    while (at <= line.length) {
      if (open) {
        const e = line.indexOf('-->', at)
        if (e < 0) { ranges[i].push([0, line.length]); return }
        ranges[i].push([0, e + 3]); at = e + 3; open = false
        continue
      }
      const s = line.indexOf('<!--', at)
      if (s < 0) return
      const e = line.indexOf('-->', s + 4)
      if (e >= 0) { at = e + 3; continue }              // 한 줄짜리 — scan() 에 맡긴다
      ranges[i].push([s, line.length]); open = true; return
    }
  })
  return ranges
}

/**
 * 마크다운을 줄 → 조각 배열로 가른다.
 * `code: true` 인 조각은 끝까지 그대로 간다.
 *
 * 표 줄을 따로 아는 이유 — GFM 은 **셀을 `|` 로 먼저 가른 뒤** 셀 안을 인라인으로
 * 읽으므로 인라인 코드가 셀 경계를 넘지 못한다. 한 줄로 뭉뚱그리면
 *
 *   | 금지 문자 (`) | 설명<br>둘째줄 | 금지 문자 (`) |
 *
 * 여기서 두 백틱 사이가 코드로 잡혀 그 안의 `<br>` 을 놓치고, 파일이 안 열린다.
 */
export function splitLines(markdown) {
  const raw = markdown.split('\n')
  const fenced = markFenced(raw)
  const inTable = markTables(raw, fenced)
  const comments = commentRanges(raw, fenced)
  const cells = { n: 0 }   // 셀마다 하나씩 늘어나는 범위 번호. 0 은 표 밖 전체

  return raw.map((line, i) => {
    if (fenced[i]) return [{ code: true, text: line, scope: 0 }]

    const parts = []
    let at = 0
    for (const [s, e] of comments[i]) {
      if (s > at) parts.push(...splitInline(line.slice(at, s), inTable[i], cells))
      parts.push({ code: true, text: line.slice(s, e), scope: 0 })
      at = e
    }
    if (at < line.length) parts.push(...splitInline(line.slice(at), inTable[i], cells))
    return parts.length ? parts : [{ code: false, text: line, scope: 0 }]
  })
}
