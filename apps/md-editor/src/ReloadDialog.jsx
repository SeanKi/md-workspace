import React from 'react'
import { baseName } from './paths.js'

/**
 * 열어 둔 파일이 밖에서 바뀌었는데 내 편집분도 있을 때 고르게 한다.
 *
 * 선택지는 둘뿐이다 — 바뀐 파일을 불러오거나, 내 내용으로 덮어쓰거나.
 * "다른 이름으로 저장" 은 일부러 넣지 않았다.
 */
export default function ReloadDialog({ path, onReload, onOverwrite }) {
  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-title">파일이 밖에서 바뀌었습니다</div>
        <div className="modal-path">{path}</div>
        <p className="modal-body">
          <b>{baseName(path)}</b> 이(가) 다른 프로그램에서 수정됐습니다.
          이 탭에는 저장하지 않은 변경이 있습니다. 어느 쪽을 남길까요?
        </p>
        <div className="modal-buttons">
          <button className="primary" onClick={onReload}>
            바뀐 파일 불러오기
            <span>내 편집 내용은 버립니다</span>
          </button>
          <button onClick={onOverwrite}>
            내 내용으로 덮어쓰기
            <span>밖에서 바뀐 내용은 사라집니다</span>
          </button>
        </div>
      </div>
    </div>
  )
}
