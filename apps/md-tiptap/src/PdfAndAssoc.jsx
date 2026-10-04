import React, { useCallback, useEffect, useState } from 'react'
import { invoke, isTauri } from './core.js'
import { baseName } from './repos.js'

/*
 * 설정 줄 아래의 두 줄 — MD Notepad 의 SavePdf.jsx · WinAssoc.jsx 를 가져왔다.
 *
 * PDF: 인쇄 대화상자 없이 WebView2 가 바로 만든다(md-core/pdf.rs). 화면이 아니라
 *   인쇄용 규칙(@media print — app.css · editor-core/editor.css)으로 그려져 툴바·탭·트리가 빠지고,
 *   화면에서 전체 폭을 써도 PDF 는 고정 폭이다.
 * 파일 연결: HKCU 만 건드린다. 기본 앱 지정은 Windows 정책상 사용자가 직접 고른다.
 */

const IS_WINDOWS = /Windows/i.test(navigator.userAgent)
const pickPath = (r) => (typeof r === 'string' ? r : r?.path ?? null)
const suggest = (p) => (p ? p.replace(/\.[^.\\/]+$/, '') + '.pdf' : '문서.pdf')

export function SavePdf({ docPath }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!isTauri || !IS_WINDOWS) return null

  const run = async () => {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const target = pickPath(await save({ filters: [{ name: 'PDF', extensions: ['pdf'] }], defaultPath: suggest(docPath) }))
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
    <div className="row-line">
      <span>PDF</span>
      <button type="button" onClick={run} disabled={busy}>{busy ? '만드는 중…' : '지금 문서를 PDF로'}</button>
      <span className="hint">A4 세로 · 여백 0.5인치 · 언제나 고정 폭.{msg && <b> {msg}</b>}</span>
    </div>
  )
}

export function WinAssoc() {
  const [st, setSt] = useState(null)
  const [msg, setMsg] = useState('')
  const refresh = useCallback(async () => {
    if (!isTauri) return
    try { setSt(await invoke('assoc_status')) } catch (e) { setMsg(String(e)) }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  if (!isTauri || !IS_WINDOWS || (st && !st.supported)) return null

  const run = async (cmd) => {
    try { setMsg(await invoke(cmd)); await refresh() } catch (e) { setMsg(`실패: ${e}`) }
  }
  const stale = st && !st.registered && st.registered_exe

  return (
    <div className="row-line">
      <span>Windows 연결</span>
      <button type="button" onClick={() => run('assoc_register')}>{st?.registered ? '다시 등록' : '등록'}</button>
      <button type="button" onClick={() => run('assoc_unregister')} disabled={!st?.registered && !stale}>해제</button>
      <span className="hint">
        {st?.registered
          ? '등록됨 — 탐색기에서 .md 우클릭 → “MDNotePad+로 열기”. 메모장처럼 새 창(단순 모드)으로 열린다.'
          : stale ? '다른 빌드로 등록돼 있습니다. “다시 등록”을 누르세요.'
            : '.md · .markdown · .mdx 우클릭 메뉴와 연결 프로그램 목록에 추가합니다.'}
        {msg && <b> · {msg}</b>}
      </span>
    </div>
  )
}
