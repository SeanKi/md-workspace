import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { frontmatterToMarkdown } from 'mdast-util-frontmatter'
import { blockToMdast } from './fromPm.js'
import { unescapeMinimal, meaning } from './norm.js'
import { displayWidth } from './width.js'

/*
 * 저장 = **손대지 않은 블록은 원문 그대로, 고친 블록만 새로 쓴다.**
 *
 * "손대지 않았다" 를 판정하는 방법: ProseMirror 노드는 바뀌지 않는 객체라, 트랜잭션이
 * 건드리지 않은 최상위 블록은 **같은 객체로 남는다.** 열 때 블록 객체 → 원문을
 * WeakMap 에 묶어 두면, 저장할 때 그 객체가 아직 문서에 있는지만 보면 된다.
 * 노드 속성(attrs)에 원문을 담지 않는 이유 — 복사·붙여넣기로 속성이 딸려 가면
 * 반쪽짜리 문단이 문단 전체의 원문을 들고 다니게 된다.
 */

/**
 * 편집기에 실린 문서의 최상위 블록을 원문과 묶는다. 편집기가 열면서 손본 블록
 * (예: 표 정리)은 구조가 달라 묶이지 않는다 — 그 블록은 새로 쓴다.
 */
export function bindOrigin(doc, parsed, schema) {
  const origin = new WeakMap()
  let bound = 0
  parsed.blocks.forEach((b, i) => {
    if (i >= doc.childCount) return
    const child = doc.child(i)
    let same = false
    try { same = child.eq(schema.nodeFromJSON(b.json)) } catch { same = false }
    if (same) { origin.set(child, b); bound++ }
  })
  return { map: origin, bound, total: parsed.blocks.length }
}

const handlers = {
  // 원래 줄 끝 공백 두 칸이던 줄바꿈은 그대로 둔다 (기본은 `\`)
  break: (node) => (node.data?.kind === 'spaces' ? '  \n' : '\\\n'),
}

/**
 * 줄바꿈 바로 뒤에 HTML 이 오면 직렬화기가 그 줄바꿈을 공백으로 바꾼다(줄 첫머리의
 * `<div>` 는 HTML 블록을 시작할 수 있어서). 붙여 넣은 XML 로그나 줄 첫머리의 색 span 이
 * 한 줄로 뭉개진다. 줄바꿈을 HTML 쪽으로 옮겨 그대로 나가게 한다 — 뜻이 바뀌는지는
 * writeBlock 이 다시 읽어 확인한다.
 */
function keepBreaksBeforeHtml(node) {
  const kids = node.children
  if (!kids) return node
  kids.forEach(keepBreaksBeforeHtml)
  for (let i = 0; i + 1 < kids.length; i++) {
    const a = kids[i], b = kids[i + 1]
    // 줄바꿈 뒤의 들여쓰기(붙여 넣은 XML 의 탭)도 함께 옮긴다
    const tail = a.type === 'text' && b.type === 'html' && /\n[ \t]*$/.exec(a.value)
    if (tail) {
      a.value = a.value.slice(0, tail.index)
      b.value = tail[0] + b.value
    }
  }
  return node
}

export function blockToMarkdown(node, style = {}, { keepBreaks = false } = {}) {
  const block = blockToMdast(node)
  const tree = { type: 'root', children: [keepBreaks ? keepBreaksBeforeHtml(block) : block] }
  // 표는 원래 모양(줄 맞춤 · 칸 안 공백)을 따른다 (toPm.js tableStyle)
  const t = node.type.name === 'table' ? node.attrs : null
  const gfm = gfmToMarkdown({
    tablePipeAlign: t ? !!t.pipeAlign : false,
    tableCellPadding: t ? t.padding !== false : true,
    stringLength: displayWidth,
  })
  const md = toMarkdown(tree, {
    extensions: [gfm, frontmatterToMarkdown(['yaml'])],
    bullet: style.bullet ?? '-',
    emphasis: style.emphasis ?? '*',
    strong: style.strong ?? '*',
    rule: '-',
    fence: '`',
    fences: true,
    listItemIndent: 'one',
    handlers,
  }).replace(/\n+$/, '')
  return t && !t.pipeAlign ? widenDelimiters(md) : md
}

/** 줄 맞춤을 안 하면 구분줄이 `| - |` 가 된다. 맞는 문법이지만 낯설다 — `---` 로 */
function widenDelimiters(md) {
  const lines = md.split('\n')
  if (lines.length > 1) lines[1] = lines[1].replace(/(:?)-+(:?)/g, (_, a, b) => `${a}---${b}`)
  return lines.join('\n')
}

/** 고친 블록 하나를 쓴다. 이스케이프는 뜻이 같다는 것이 증명되는 만큼 걷어낸다 (norm.js) */
export function writeBlock(node, style) {
  const plain = blockToMarkdown(node, style)
  const kept = blockToMarkdown(node, style, { keepBreaks: true })
  // 줄바꿈과 공백의 차이 말고는 같은 뜻이어야 줄바꿈을 살린 쪽을 쓴다
  // (meaning 은 JSON 이라 줄바꿈이 `\n` 두 글자로 들어 있다)
  const loose = (md) => meaning(md).replace(/\\n|\s+/g, ' ')
  const md = kept !== plain && loose(kept) === loose(plain) ? kept : plain
  return unescapeMinimal(md)
}

const toEol = (s, eol) => (eol === '\n' ? s : s.replace(/\n/g, eol))
const blankLines = (gap) => (gap.match(/\n/g) || []).length

/**
 * @param doc     편집기의 ProseMirror 문서
 * @param parsed  parseMarkdown 결과 (틈·줄바꿈 종류·BOM·문서 버릇)
 * @param origin  bindOrigin 결과. 없으면 전부 새로 쓴다
 * @returns {{ text, rewritten }} rewritten = 새로 쓴 블록 수
 */
export function serializeDoc(doc, parsed, origin) {
  const eol = parsed?.eol ?? '\n'
  let out = ''
  let prev = -2          // 바로 앞에 원문 그대로 나간 블록의 번호
  let rewritten = 0
  doc.forEach((child) => {
    const o = origin?.map.get(child)
    if (o) {
      // 원래 바로 이웃이던 블록 사이는 원래 틈 그대로. 사이에 무언가 끼었거나
      // 빠졌으면 빈 줄 하나를 보장한다 — 안 그러면 문단이 앞 블록에 들러붙는다
      // 블록 첫 줄의 들여쓰기는 틈에 들어 있다. 원문 둘째 줄부터는 그 들여쓰기를 기준으로
      // 적혀 있으므로 빈 줄을 새로 넣을 때도 들여쓰기는 살린다
      const indent = /[ 	]*$/.exec(o.gap)[0]
      const gap = !out ? o.gap : (o.index === prev + 1 || blankLines(o.gap) >= 2 ? o.gap : eol + eol + indent)
      out += gap + o.src
      prev = o.index
      return
    }
    // 빈 문단은 마크다운으로 적을 수 없다 (빈 줄은 블록 사이 틈일 뿐이다)
    if (child.type.name === 'paragraph' && child.childCount === 0) return
    out += (out ? eol + eol : '') + toEol(writeBlock(child, parsed?.style), eol)
    prev = -2
    rewritten++
  })
  // 문서 끝의 틈. 원래 문서의 끝을 그대로 따른다(마지막 줄바꿈이 없던 파일은 없는 채로)
  let tail
  if (!parsed) tail = out ? '\n' : ''
  else if (!out || parsed.blocks.length) tail = parsed.trailing
  else tail = eol
  return { text: (parsed?.bom ? '﻿' : '') + out + tail, rewritten }
}
