import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { frontmatter } from 'micromark-extension-frontmatter'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { blockToPm } from './toPm.js'

/**
 * MDX 가 아니라 **CommonMark + GFM** 으로 읽는다. `<br>` · `A <- B` · XML 로그가
 * 든 문서도 그대로 열린다 — MDXEditor 때의 `normalizeMarkdown` 이 필요 없다.
 */
export const parseTree = (text) => fromMarkdown(text, {
  extensions: [gfm(), frontmatter(['yaml'])],
  mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(['yaml'])],
})

/**
 * 문서를 **최상위 블록**으로 자른다. 블록마다 원문 조각(src)과 그 앞의 틈(gap)을
 * 들고 있어서, 손대지 않은 블록은 원문 그대로 다시 쓸 수 있다 (serialize.js).
 *
 * gap + src 를 차례로 이으면 원문이 **한 바이트도 다르지 않게** 돌아온다.
 */
export function parseMarkdown(input) {
  const bom = input.startsWith('﻿')
  const text = bom ? input.slice(1) : input
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const tree = parseTree(text)

  const blocks = []
  let at = 0
  tree.children.forEach((node, index) => {
    const s = node.position.start.offset
    const e = node.position.end.offset
    blocks.push({ index, gap: text.slice(at, s), src: text.slice(s, e), json: blockToPm(node, text) })
    at = e
  })
  return { blocks, trailing: text.slice(at), eol, bom, style: guessStyle(text) }
}

const count = (text, re) => (text.match(re) || []).length

/**
 * 새로 쓰는 블록이 문서의 버릇을 따르게 한다. 목록 기호가 `*` 인 문서에 `-` 를
 * 섞어 넣으면 고친 곳만 모양이 달라진다.
 */
function guessStyle(text) {
  const dash = count(text, /^[ \t]*- /gm)
  const star = count(text, /^[ \t]*\* /gm)
  const plus = count(text, /^[ \t]*\+ /gm)
  const bullet = star > dash && star >= plus ? '*' : plus > dash ? '+' : '-'
  const under = count(text, /(^|[\s(])_[^_\s][^_\n]*_(?=[\s.,)!?]|$)/gm)
  const aster = count(text, /(^|[\s(])\*[^*\s][^*\n]*\*(?=[\s.,)!?]|$)/gm)
  const strongUnder = count(text, /__[^_\n]+__/g)
  const strongAster = count(text, /\*\*[^*\n]+\*\*/g)
  return {
    bullet,
    emphasis: under > aster ? '_' : '*',
    strong: strongUnder > strongAster ? '_' : '*',
  }
}
