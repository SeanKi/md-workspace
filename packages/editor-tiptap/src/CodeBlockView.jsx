import React, { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import mermaid from 'mermaid'

/*
 * 코드블록 노드 뷰. 글자는 ProseMirror 가 그대로 편집하고(NodeViewContent),
 * 우리는 머리(언어 고르기)와 Mermaid 그림만 덧붙인다.
 *
 * MDXEditor 때는 Mermaid 소스를 별도 textarea 로 고쳤는데(MermaidBlock.jsx), 여기서는
 * 소스가 문서의 진짜 글자라서 되돌리기·한글 조합·검색이 다른 글과 똑같이 된다.
 */

const LANGS = ['', 'txt', 'js', 'ts', 'python', 'bash', 'json', 'sql', 'xml', 'html', 'css', 'csharp', 'cpp', 'java', 'yaml', 'mermaid']

let ready = false
let seq = 0

const elOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement ?? null)
const inDiagram = (n) => !!elOf(n)?.closest('.mermaid-view')

/*
 * Mermaid 그림 안의 글자를 고를 수 있게 한다.
 *
 * 그림은 편집기 안의 "편집 못 하는 섬" 이다. Tiptap 기본값은 그 안의 mousedown 을 편집기(ProseMirror)에
 * 넘기는데, 편집기는 그 자리를 자기 커서 자리로 바꾸려 하고 — 그림 안의 브라우저 선택을 문서 위치로
 * 옮길 수 없으니 **곧바로 되돌려** 글자가 골라지지 않았다. 그래서
 *   - 그림 안의 이벤트(끌어 고르기 · 복사)는 브라우저에 맡기고 (stopEvent → true)
 *   - 그림 안의 선택 바뀜은 편집기가 못 본 척한다 (ignoreMutation 'selection' → true)
 * 나머지는 Tiptap 기본 동작을 그대로 따른다 — 머리의 고르기 · 단추, 소스 글자 편집
 */
export const codeBlockViewOptions = {
  stopEvent: ({ event }) => {
    const t = elOf(event.target)
    if (!t) return false
    if (t.closest('.mermaid-view')) return true
    // 머리의 언어 고르기 · 소스 단추 — Tiptap 기본값과 같다
    return !!t.closest('select, button, input, textarea')
  },
  ignoreMutation: ({ mutation }) => {
    if (mutation.type === 'selection') return inDiagram(document.getSelection()?.anchorNode)
    // 그 밖은 Tiptap 기본값 그대로: 소스 글자(contentDOM) 안의 바뀜만 편집기가 읽고, contentDOM 자신의 속성 바뀜은 버린다.
    // **진짜 contentDOM 은 `[data-node-view-content-react]`** 다 — 바깥의 `[data-node-view-content]`(NodeViewContent)로
    // 잡았더니 contentDOM 의 style 바뀜을 편집기가 읽어 다시 그리고, 그리면 또 바뀌어 **무한히 돌았다**(CPU 100% · 4GB)
    const el = elOf(mutation.target)
    const content = el?.closest('[data-node-view-content-react]')
    if (!content) return true
    if (mutation.type === 'attributes' && el === content) return true
    return false
  },
}

function MermaidPreview({ code }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(null)
  const id = useRef(`mmd-${++seq}`)
  useEffect(() => {
    if (!ready) { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }); ready = true }
    let alive = true
    const t = setTimeout(() => {
      const text = code.trim()
      if (!text) { setSvg(''); setError(null); return }
      const rid = `${id.current}-${Date.now()}`
      mermaid.render(rid, text)
        .then((r) => { if (alive) { setSvg(r.svg); setError(null) } })
        .catch((e) => {
          document.getElementById(`d${rid}`)?.remove()
          if (alive) setError(e?.message ?? String(e))
        })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [code])
  // 그림이 새로 그려졌다 — 찾기가 그 안의 글자를 다시 칠하게 알린다 (find.js)
  useEffect(() => { if (svg) window.dispatchEvent(new Event('md-mermaid-rendered')) }, [svg])
  if (error) return <pre className="mermaid-error">{error}</pre>
  if (!svg) return <div className="mermaid-empty">다이어그램 소스를 입력하세요</div>
  return <div className="mermaid-view" dangerouslySetInnerHTML={{ __html: svg }} />
}

export default function CodeBlockView({ node, updateAttributes }) {
  const lang = node.attrs.language ?? ''
  const isMermaid = lang === 'mermaid'
  // 그림이 있으면 소스는 접어 둔다. 비어 있으면 처음부터 연다
  const [showSource, setShowSource] = useState(!isMermaid || !node.textContent.trim())

  return (
    <NodeViewWrapper className={`md-code ${isMermaid ? 'is-mermaid' : ''}`}>
      <div className="md-code-head" contentEditable={false}>
        <select value={LANGS.includes(lang) ? lang : '*'} onChange={(e) => updateAttributes({ language: e.target.value || null })}>
          {LANGS.map((l) => <option key={l} value={l}>{l || '(언어 없음)'}</option>)}
          {!LANGS.includes(lang) && <option value="*">{lang}</option>}
        </select>
        {isMermaid && (
          <button type="button" onClick={() => setShowSource((v) => !v)}>
            {showSource ? '소스 숨기기' : '소스 편집'}
          </button>
        )}
      </div>
      <pre className={isMermaid && !showSource ? 'md-code-hidden' : ''}>
        <NodeViewContent as="code" />
      </pre>
      {isMermaid && <div contentEditable={false}><MermaidPreview code={node.textContent} /></div>}
    </NodeViewWrapper>
  )
}
