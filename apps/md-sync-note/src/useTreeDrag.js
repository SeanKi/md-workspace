import { useCallback, useEffect, useRef, useState } from 'react'

/** 이만큼 누르고 있어야 끌 수 있게 된다 */
const HOLD_MS = 3000
/** 누르고 있는 동안 이보다 많이 움직이면 "누르고 있던 것"이 아니다 */
const SLIP = 6

/**
 * 트리에서 **3초 누르고 있으면** 끌어서 다른 폴더로 옮길 수 있게 되는 동작.
 *
 * HTML5 드래그는 누르기 전에 draggable 이 정해져 있어야 시작되므로,
 * "누르고 있다가 끌기"는 만들 수 없다. 그래서 포인터 이벤트로 직접 만든다.
 * 놓을 자리는 화면에서 직접 찾는다 — 폴더 줄에 `data-drop` 이 붙어 있다.
 *
 * 실수로 문서가 열리거나 폴더가 접히지 않도록, 한 번 끌기가 시작되면
 * 뒤따라오는 click 한 번을 `consumeClick()` 으로 잡아먹는다.
 *
 * @param onDrop (entry, 놓은폴더경로) — 실제로 옮기는 일은 바깥이 한다
 */
export default function useTreeDrag({ onDrop }) {
  const [holding, setHolding] = useState(null)    // 누르고 있는 항목의 path
  const [drag, setDrag] = useState(null)          // { entry, x, y, over }
  const st = useRef({})
  // 끌기가 끝난 직후의 click 한 번만 먹는다. 그 click 이 아예 안 올 수도 있으므로
  // (누른 줄과 놓은 줄이 다르면 click 은 발생하지 않는다) 시각으로 재야 다음 클릭이 살아난다.
  const eatUntil = useRef(0)

  const stop = useCallback(() => {
    clearTimeout(st.current.timer)
    window.removeEventListener('pointermove', st.current.move)
    window.removeEventListener('pointerup', st.current.up)
    st.current = {}
    setHolding(null)
    setDrag(null)
  }, [])

  useEffect(() => stop, [stop])

  const press = useCallback((e, entry) => {
    if (e.button !== 0) return
    stop()

    const hit = (x, y) => document.elementFromPoint(x, y)?.closest('[data-drop]')
      ?.getAttribute('data-drop') ?? null

    const move = (ev) => {
      if (!st.current.armed) {
        // 아직 3초가 안 됐다 — 움직였으면 끌기가 아니라 그냥 스크롤·오조작이다
        if (Math.abs(ev.clientX - st.current.x0) > SLIP ||
            Math.abs(ev.clientY - st.current.y0) > SLIP) stop()
        return
      }
      ev.preventDefault()
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, over: hit(ev.clientX, ev.clientY) } : d))
    }

    const up = (ev) => {
      const armed = st.current.armed
      const target = armed ? hit(ev.clientX, ev.clientY) : null
      if (armed) eatUntil.current = Date.now() + 300   // 뒤따라오는 click 은 먹는다
      stop()
      if (target) onDrop(entry, target)
    }

    st.current = {
      entry, x0: e.clientX, y0: e.clientY, move, up, armed: false,
      timer: setTimeout(() => {
        st.current.armed = true
        setHolding(null)
        setDrag({ entry, x: st.current.x0, y: st.current.y0, over: null })
      }, HOLD_MS),
    }
    setHolding(entry.path)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [onDrop, stop])

  // Esc 로 끌기를 그만둘 수 있어야 한다
  useEffect(() => {
    if (!drag) return
    const key = (e) => { if (e.key === 'Escape') { eatUntil.current = Date.now() + 300; stop() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [drag, stop])

  const consumeClick = useCallback(() => Date.now() < eatUntil.current, [])

  return { holding, dragging: drag?.entry.path ?? null, over: drag?.over ?? null, drag, press, consumeClick }
}
