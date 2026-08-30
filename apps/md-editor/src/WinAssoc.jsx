import React, { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@md/editor-core'

/**
 * Windows 파일 연결 등록 UI.
 *
 * Win10 부터 "기본 앱"은 프로그램이 바꿀 수 없다. 등록으로 얻는 것은
 * 우클릭 메뉴 "MD Editor로 열기" 와 연결 프로그램 목록 노출까지다.
 */
export default function WinAssoc() {
  const [st, setSt] = useState(null)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (!isTauri) return
    try { setSt(await invoke('assoc_status')) } catch (e) { setMsg(String(e)) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const run = async (cmd) => {
    try {
      setMsg(await invoke(cmd))
      await refresh()
    } catch (e) {
      setMsg(`실패: ${e}`)
    }
  }

  if (!isTauri || (st && !st.supported)) return null

  const stale = st && !st.registered && st.registered_exe

  return (
    <div className="assoc">
      <span className="assoc-title">Windows 연결</span>
      <button onClick={() => run('assoc_register')}>
        {st?.registered ? '다시 등록' : '등록'}
      </button>
      <button onClick={() => run('assoc_unregister')} disabled={!st?.registered && !stale}>
        해제
      </button>
      <span className="hint">
        {st?.registered
          ? '등록됨 — 탐색기에서 .md 우클릭 → “MD Editor로 열기”.'
          : stale
            ? '다른 빌드로 등록돼 있습니다. “다시 등록”을 누르세요.'
            : '.md · .markdown · .mdx 우클릭 메뉴와 연결 프로그램 목록에 추가합니다.'}
        {' '}기본 앱 지정은 Windows 정책상 사용자가 직접 골라야 합니다.
        {msg && <b> · {msg}</b>}
      </span>
    </div>
  )
}
