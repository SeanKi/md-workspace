import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { revealIn } from './reveal.js'

/*
 * Obsidian 식 내부 링크 `[[노트]]` · `[[노트#제목]]` · `[[노트|보이는 이름]]` · `![[그림.png]]`.
 *
 * 마크다운(GFM)에는 이런 문법이 없어서 파일에는 **글자 그대로** 둔다 — 노드나 표시로 바꾸지
 * 않으니 저장해도 한 글자도 바뀌지 않는다. 화면에서만 꾸밈(decoration)으로 링크처럼 보이게
 * 하고, Ctrl+누르기(links.js)와 링크 풍선(LinkBubble.jsx)이 이 꾸밈을 보고 따라간다.
 * 코드(인라인 코드 · 코드블록 · 원문 블록) 안의 `[[ ]]` 는 링크가 아니다.
 */

const WIKI = /(!?)\[\[([^\[\]\n|#]*)(#[^\[\]\n|]*)?(\|[^\[\]\n]*)?\]\]/g

export const wikiKey = new PluginKey('mdWiki')

function scan(doc) {
  const found = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    node.forEach((child, off) => {
      if (!child.isText || child.marks.some((m) => m.type.name === 'code')) return
      WIKI.lastIndex = 0
      for (let m; (m = WIKI.exec(child.text));) {
        if (!m[2].trim() && !m[3]) continue   // `[[]]` 는 링크가 아니다
        const from = pos + 1 + off + m.index
        found.push({
          from, to: from + m[0].length,
          name: m[2].trim(),
          heading: m[3] ? m[3].slice(1).trim() : '',
          embed: !!m[1],
        })
      }
    })
    return false
  })
  return found
}

const decorate = (doc, list) => DecorationSet.create(doc, list.map((w) =>
  Decoration.inline(w.from, w.to, {
    class: 'md-wikilink',
    'data-wiki': w.name + (w.heading ? `#${w.heading}` : ''),
    title: `${w.name || '이 문서'}${w.heading ? ` › ${w.heading}` : ''} — Ctrl+클릭으로 열기`,
  })))

export const wikiLinks = Extension.create({
  name: 'mdWikiLinks',
  addProseMirrorPlugins: () => [new Plugin({
    key: wikiKey,
    state: {
      init: (_, state) => { const list = scan(state.doc); return { list, deco: decorate(state.doc, list) } },
      apply: (tr, old) => {
        if (!tr.docChanged) return old
        const list = scan(tr.doc)
        return { list, deco: decorate(tr.doc, list) }
      },
    },
    props: { decorations: (state) => wikiKey.getState(state).deco },
  })],
})

/** 커서 자리의 내부 링크 (없으면 null) */
export function wikiAt(state, pos) {
  return wikiKey.getState(state)?.list.find((w) => pos > w.from && pos < w.to) ?? null
}

/**
 * `노트#제목` → 따라가기. 다른 노트를 찾는 일은 앱이 한다 (`ctx.openWiki`).
 * `[[#제목]]` 처럼 이름이 없으면 이 문서 안의 제목으로 간다
 */
export function followWiki(target, ctx, editor) {
  const [name, heading = ''] = String(target).split('#')
  if (!name.trim()) { revealIn(editor, { heading }); return }
  if (ctx?.openWiki) ctx.openWiki(name.trim(), heading.trim())
}
