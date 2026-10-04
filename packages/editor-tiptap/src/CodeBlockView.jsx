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
