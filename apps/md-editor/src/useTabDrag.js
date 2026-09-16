import { useCallback, useEffect, useRef, useState } from 'react'

/** 이만큼 움직여야 끌기다. 그 전까지는 그냥 탭을 누른 것 */
const SLIP = 5

/**
 * 탭 끌기 — 순서 바꾸기와 **다른 창으로 옮기기**(크롬처럼).
 *
 * HTML5 드래그를 쓰지 않는다. 창 밖으로 나간 뒤 손을 뗀 자리를 알아야 하는데,
 * HTML5 드래그는 창을 벗어나는 순간 OS 가 가져가 버려 그 자리를 알려주지 않는다.
 * 포인터 이벤트에 **포인터 캡처**를 걸면 창 밖으로 나가도 move·up 이 계속 온다.
 * (트리의 끌기도 같은 이유로 포인터 이벤트다 — `md-sync-note/useTreeDrag.js`)
 *
 * 놓은 자리에 따라 셋으로 갈린다.
 *   탭 줄 위   → 그 자리로 순서를 바꾼다
 *   창 안 다른 곳 → 아무 일도 없다 (실수로 끈 것)
 *   창 밖      → 넘긴다. 다른 MD Notepad 창이면 그 창으로, 아니면 새 창으로
 *
 * @param barRef    탭들이 든 상자 (`.tabbar`)
 * @param onReorder (탭id, 놓을자리) — 같은 창 안에서 순서 바꾸기
 * @param onDetach  (탭) — 창 밖으로 내보내기. 실제 처리는 바깥이 한다
 */
export default function useTabDrag({ barRef, onReorder, onDetach }) {
  const [drag, setDrag] = useState(null)   // { id, name, x, y, at, out }
  const st = useRef({})
  // 끌기가 끝난 직후의 click 한 번은 먹는다(안 그러면 놓자마자 그 탭이 켜진다).
  // 깃발이 아니라 시각으로 재야 한다 — click 이 아예 안 오는 경우가 있다
  const eatUntil = useRef(0)

  const stop = useCallback(() => {
    const { el, pointerId, move, up } = st.current
    try { el?.releasePointerCapture?.(pointerId) } catch { /* 이미 풀렸다 */ }
    if (move) window.removeEventListener('pointermove', move)
    if (up) window.removeEventListener('pointerup', up)
    st.current = {}
    setDrag(null)
  }, [])

  useEffect(() => stop, [stop])

  /** 탭 줄 위라면 몇 번째 자리인가. 아니면 null */
  const spotAt = useCallback((x, y) => {
    const bar = barRef.current
    if (!bar) return null
    const r = bar.getBoundingClientRect()
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
    const tabs = [...bar.querySelectorAll('.tab')]
    for (let i = 0; i < tabs.length; i += 1) {
      const b = tabs[i].getBoundingClientRect()
      if (x < b.left + b.width / 2) return i
    }
    return tabs.length
  }, [barRef])

  const inWindow = (x, y) => x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight

  const press = useCallback((e, tab, name) => {
    if (e.button !== 0) return
    if (e.target.closest?.('.tab-x')) return      // 닫기 단추는 끌기가 아니다
    stop()

    const el = e.currentTarget
    const x0 = e.clientX
    const y0 = e.clientY

    const look = (ev) => {
      const at = spotAt(ev.clientX, ev.clientY)
      return { at, out: at === null && !inWindow(ev.clientX, ev.clientY) }
    }

    const move = (ev) => {
      if (!st.current.armed) {
        if (Math.abs(ev.clientX - x0) < SLIP && Math.abs(ev.clientY - y0) < SLIP) return
        st.current.armed = true
        // 창 밖으로 나가도 계속 받으려면 포인터를 붙잡아 둬야 한다
        try { el.setPointerCapture(ev.pointerId); st.current.pointerId = ev.pointerId } catch { /* 없어도 창 안에서는 된다 */ }
      }
      ev.preventDefault()
      setDrag({ id: tab.id, name, x: ev.clientX, y: ev.clientY, ...look(ev) })
    }

    const up = (ev) => {
      const armed = st.current.armed
      const { at, out } = armed ? look(ev) : { at: null, out: false }
      if (armed) eatUntil.current = Date.now() + 300
      stop()
      if (!armed) return
      if (at !== null) onReorder(tab.id, at)
      else if (out) onDetach(tab)
    }

    st.current = { el, pointerId: e.pointerId, move, up, armed: false }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [onReorder, onDetach, spotAt, stop])

  // Esc 로 그만둘 수 있어야 한다
  useEffect(() => {
    if (!drag) return
    const key = (e) => { if (e.key === 'Escape') { eatUntil.current = Date.now() + 300; stop() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [drag, stop])

  const consumeClick = useCallback(() => Date.now() < eatUntil.current, [])

  return { drag, press, consumeClick }
}
