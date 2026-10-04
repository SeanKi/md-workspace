import React from 'react'

/* 커서가 표 안에 있을 때만 보이는 표 단추들 */

const keep = (e) => e.preventDefault()

const ACTIONS = [
  ['addRowBefore', '위에 행', '↑+'],
  ['addRowAfter', '아래에 행', '↓+'],
  ['addColumnBefore', '왼쪽에 열', '←+'],
  ['addColumnAfter', '오른쪽에 열', '→+'],
  ['deleteRow', '행 지우기', '−행'],
  ['deleteColumn', '열 지우기', '−열'],
  ['deleteTable', '표 지우기', '✕표'],
]

export default function TableTools({ editor }) {
  return (
    <span className="tt-table-tools">
      <span className="sep" />
      {ACTIONS.map(([cmd, title, label]) => (
        <button key={cmd} type="button" title={title} aria-label={title} onMouseDown={keep}
          onClick={() => editor.chain().focus()[cmd]().run()}>
          {label}
        </button>
      ))}
    </span>
  )
}
