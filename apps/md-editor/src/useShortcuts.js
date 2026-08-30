import { useEffect, useRef } from 'react'

/**
 * Ctrl 단축키. 핸들러가 매 렌더 바뀌어도 리스너는 한 번만 붙도록 ref 로 넘긴다.
 * O 열기 · S 저장 · Shift+S 다른 이름으로 · N/T 새 탭 · W 닫기 · Tab 탭 전환
 */
export default function useShortcuts(handlers) {
  const h = useRef(handlers)
  h.current = handlers

  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 'o') { e.preventDefault(); h.current.open() }
      else if (k === 's') { e.preventDefault(); h.current.save(e.shiftKey) }
      else if (k === 'n' || k === 't') { e.preventDefault(); h.current.newTab() }
      else if (k === 'w') { e.preventDefault(); h.current.close() }
      else if (e.key === 'Tab') { e.preventDefault(); h.current.cycle(e.shiftKey ? -1 : 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
