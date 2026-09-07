import { useEffect, useRef } from 'react'
import { invoke, isTauri } from '@md/editor-core'

/**
 * 열려 있는 파일이 밖에서 바뀌면 알려 준다.
 *
 * 감시 대상은 "지금 탭에 열려 있는 경로들". 탭이 열리고 닫힐 때마다 차이만큼만
 * 등록·해제한다. Rust 쪽이 내용 해시로 판단하므로 우리가 저장해서 생긴 이벤트는
 * 여기까지 오지 않는다.
 */
export default function useFileWatch(paths, onChanged) {
  const watching = useRef(new Set())
  const cb = useRef(onChanged)
  cb.current = onChanged

  // 이벤트 구독은 한 번만
  useEffect(() => {
    if (!isTauri) return
    let unlisten
    let cancelled = false
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('file-changed', (e) => { cb.current(e.payload.path) }))
      .then((un) => { if (cancelled) un(); else unlisten = un })
    return () => { cancelled = true; unlisten?.() }
  }, [])

  // 탭 목록이 바뀔 때마다 감시 목록을 맞춘다
  useEffect(() => {
    if (!isTauri) return
    const want = new Set(paths.filter(Boolean))
    const have = watching.current

    for (const p of want) {
      if (have.has(p)) continue
      invoke('watch_file', { path: p }).then(() => have.add(p)).catch(() => {})
    }
    for (const p of [...have]) {
      if (want.has(p)) continue
      have.delete(p)
      invoke('unwatch_file', { path: p }).catch(() => {})
    }
  }, [paths.join('\n')])   // eslint-disable-line react-hooks/exhaustive-deps
}
