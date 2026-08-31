import React, { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@md/editor-core'
import { baseName } from './paths.js'

const pickPath = (r) => (typeof r === 'string' ? r : r?.path ?? null)

/** `a.md` → `a.pdf`. 저장한 적 없는 문서면 이름을 지어 준다. */
function suggest(path) {
  if (!path) return '문서.pdf'
  return path.replace(/\.[^.\\/]+$/, '') + '.pdf'
}

/**
 * 지금 문서를 PDF 로 저장한다.
 *
 * 인쇄 대화상자는 뜨지 않는다 — 저장 위치만 고르면 WebView2 가 바로 만든다.
 * 화면에서 전체 폭을 쓰고 있어도 PDF 는 언제나 고정 폭 모양이다(인쇄용 CSS).
 */
export default function SavePdf({ path }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (!isTauri) return null

  const run = async () => {
    const target = pickPath(await save({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      defaultPath: suggest(path),
    }))
    if (!target) return
    setBusy(true)
    setMsg('')
    try {
      await invoke('save_pdf', { path: target })
      setMsg(`저장됨 · ${baseName(target)}`)
    } catch (e) {
      setMsg(`실패: ${e}`)
    }
    setBusy(false)
  }

  return (
    <div className="row">
      <span className="row-title">PDF</span>
      <button onClick={run} disabled={busy}>{busy ? '만드는 중…' : 'PDF로 저장'}</button>
      <span className="hint">
        A4 세로 · 여백 0.5인치. 화면 폭 설정과 무관하게 <b>고정 폭</b>으로 나가고,
        툴바·탭·표 손잡이는 빠집니다. 표 머리글 바탕색은 그대로 인쇄됩니다.
        {msg && <b> · {msg}</b>}
      </span>
    </div>
  )
}
