import React, { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { useCodeBlockEditorContext, usePublisher, insertCodeBlock$, ButtonWithTooltip } from '@mdxeditor/editor'

let initialized = false
function initMermaid() {
  if (initialized) return
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
  initialized = true
}

let seq = 0

const SAMPLE = 'graph TD\n  A[시작] --> B{조건}\n  B -->|예| C[처리]\n  B -->|아니오| D[종료]\n  C --> D'

function MermaidEditor({ code }) {
  const { setCode } = useCodeBlockEditorContext()
  const [src, setSrc] = useState(code)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState(null)
  const [showSource, setShowSource] = useState(false)
  const idBase = useRef(`mermaid-${++seq}`)

  useEffect(() => { setSrc(code) }, [code])

  useEffect(() => {
    initMermaid()
    let alive = true
    const timer = setTimeout(() => {
      const text = src.trim()
      if (!text) { setSvg(''); setError(null); return }
      const id = `${idBase.current}-${Date.now()}`
      mermaid.render(id, text)
        .then((res) => { if (alive) { setSvg(res.svg); setError(null) } })
        .catch((e) => {
          document.getElementById(`d${id}`)?.remove()
          if (alive) setError(e?.message ?? String(e))
        })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [src])

  const update = (value) => { setSrc(value); setCode(value) }

  return (
    <div className="mermaid-block" contentEditable={false}>
      <div className="mermaid-head">
        <span className="mermaid-tag">mermaid</span>
        {error && <span className="mermaid-badge">문법 오류</span>}
        <span className="mermaid-spacer" />
        <button type="button" onClick={() => setShowSource((v) => !v)}>
          {showSource ? '소스 숨기기' : '소스 편집'}
        </button>
      </div>

      {showSource && (
        <textarea
          className="mermaid-src"
          value={src}
          spellCheck={false}
          rows={Math.min(20, Math.max(4, src.split('\n').length + 1))}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => e.nativeEvent.stopImmediatePropagation()}
        />
      )}

      {error ? (
        <pre className="mermaid-error">{error}</pre>
      ) : svg ? (
        <div className="mermaid-view" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="mermaid-empty">다이어그램 소스를 입력하세요</div>
      )}
    </div>
  )
}

export const mermaidDescriptor = {
  priority: 100,
  match: (language) => language === 'mermaid',
  Editor: MermaidEditor,
}

export function InsertMermaid() {
  const insert = usePublisher(insertCodeBlock$)
  return (
    <ButtonWithTooltip
      title="Mermaid 다이어그램 삽입"
      onClick={() => insert({ language: 'mermaid', code: SAMPLE })}
    >
      <span style={{ fontSize: 12, fontWeight: 700, padding: '0 4px' }}>M</span>
    </ButtonWithTooltip>
  )
}
