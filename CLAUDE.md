# CLAUDE.md

MD Editor / MDSyncNote 모노레포. 이 파일은 매 세션 자동으로 읽히니, 여기 적힌
규약과 함정을 먼저 확인하고 작업할 것.

## 이 프로젝트가 무엇인가

마크다운을 **위지윅으로 편집**하는 Windows 데스크톱 앱 두 개.

- **MD Editor** — 단일 창 에디터. 탭, 드래그앤드롭, 이미지 붙여넣기
- **MDSyncNote** — 왼쪽 저장소 트리 + 오른쪽 노트 뷰. 최종적으로 다중 기기 동기화

핵심 원칙: **실제 `.md` 파일이 진실의 원천이다.** VS Code·Obsidian·GitHub 와 그대로
호환되어야 한다. DB 는 인덱스·검색·이력·동기화 상태에만 쓴다.

## 구조

```
md-workspace/                    npm workspaces + cargo workspace
├─ packages/editor-core/         공유 JS — 두 앱이 함께 쓰는 에디터
├─ crates/md-core/               공유 Rust — 파일 I/O 커맨드
└─ apps/{md-editor, md-sync-note}/
```

- 공유 코드를 고치면 두 앱에 즉시 반영된다
- `App.jsx` 는 공유하지 않는다 (두 앱의 레이아웃이 근본적으로 다름)
- cargo workspace 라 `target/` 을 공유한다

## 명령어

```bat
npm install                  :: 루트에서. 워크스페이스 전체
npm run editor               :: MD Editor 실행 (tauri dev)
npm run sync-note            :: MDSyncNote 실행
npm run build -w md-editor   :: 프론트엔드만 빌드 (빠른 확인용)
cargo check --workspace      :: Rust 전체 확인
build-portable.bat           :: portable exe 두 개만 (설치본 없음, 빠름)
build-all.bat                :: 설치본(NSIS) + portable exe
```

첫 실행은 Rust 컴파일로 5~15분. 이후는 수 초.

## 반드시 지킬 것

### Rust 커맨드는 `md_core::commands` 모듈에 둔다

`#[tauri::command]` 는 보조 매크로(`__cmd__*`)를 만드는데, 이걸 크레이트 **루트**에
두면 이름이 충돌해 컴파일이 안 된다. 반드시 서브모듈에 넣고 이렇게 등록한다.

```rust
tauri::generate_handler![md_core::commands::read_file, ...]
```

### 이미지는 "저장 경로"와 "표시 URL"을 분리한다

WebView2 는 보안상 `file://` 을 직접 읽지 못한다. 그래서

- **마크다운 파일에 기록**: 상대 경로 (`images/xxx.png`) — 다른 도구와 호환
- **화면에 표시**: Rust 로 읽어 data URI 변환 (`imagePreviewHandler`, 결과 캐시)

이 둘을 절대 섞지 말 것. 마크다운에 data URI 가 들어가면 파일이 오염된다.

### 드래그앤드롭은 `onDragDropEvent` + 좌표 판정

Tauri 가 OS 레벨에서 파일 드롭을 가로채므로 HTML5 `drop` 이벤트는 오지 않는다.
어디에 놓았는지도 알려주지 않으므로 **좌표를 직접 비교**해야 한다.

```js
getCurrentWebview().onDragDropEvent((e) => {
  const { type, paths, position } = e.payload
  // position 은 물리 픽셀. devicePixelRatio 로 나눠 CSS 픽셀에 맞춘다
})
```

MD Editor 는 **상단(`.topzone` = 제목줄+탭바)에 놓았을 때만** 파일을 연다.
판정은 `apps/md-editor/src/useFileDrop.js` 한 곳에 있다.
본문에 이미지를 놓는 동작은 아직 없다 — 붙이려면 이 훅에서 갈라내면 된다.

### 에디터 본문에 `height: 100%` 를 주지 말 것

MDXEditor 툴바는 `position: sticky` 인데, 부모에 `height: 100%` 를 주면 sticky 의
기준 박스가 화면 높이에서 끝나 **아래로 스크롤할 때 툴바가 사라진다.**
`min-height: 100%` 를 쓴다. (`editor-core/src/editor.css` 에 주석 있음)

### 표 셀 안의 줄바꿈은 `<br />` 다

GFM 표는 셀 안에 개행을 담지 못한다. lexical 기본 줄바꿈 노드를 저장하면 `&#xA;`
로 이스케이프되어 어느 뷰어에서도 줄이 나뉘지 않는다. 그래서 Alt+Enter 는 `<br />`
를 넣는다 (`packages/editor-core/src/tableCellBreak.jsx`).

- 셀 Enter 는 MDXEditor 가 CRITICAL 로 선점한다 → `COMMAND_PRIORITY_BEFORE_CRITICAL`
- `<br />` 를 GenericHTMLNode(빈 인라인 요소)로 두면 **그 뒤에 커서가 못 선다.**
  `LineBreakNode` 를 상속한 전용 타입(`md-html-br`)으로 다룬다
- 전용 타입인 이유: 그냥 `LineBreakNode` 로 두면 본문에서 Shift+Enter 로 만든
  기존 줄바꿈까지 전부 `<br />` 로 다시 쓰여 건드리지도 않은 문서가 바뀐다

### 문서 전환은 `key=` 로 리마운트한다

`<Editor key={tabId} markdown={...} />`. 하나의 인스턴스에 `setMarkdown` 을 호출하면
상태가 섞이고 되돌리기 이력이 엉킨다.

### Windows 파일 연결은 HKCU 만 건드린다

`win_assoc.rs`. `.md` 의 (기본값)은 절대 바꾸지 않고 `OpenWithProgids` 에 후보로
더하기만 한다. **기본 앱 지정은 프로그램이 못 한다** (Win8+ `UserChoice` 해시).
`md-editor.exe --register` / `--unregister` 로 창 없이 등록·해제할 수 있다.
자세한 건 `docs/Windows_File_Association.md`.

### git 은 `git` 실행 파일을 부른다 (git2 아님)

`apps/md-sync-note/src-tauri/src/git.rs`. 빌드가 가벼워지고 자격증명·훅·gitignore 가
사용자 설정 그대로 동작한다. Windows 에서는 `CREATE_NO_WINDOW` 를 줘야 콘솔이
깜빡이지 않는다.

**등록한 폴더가 이미 다른 저장소의 하위 폴더일 수 있다.** 그래서

- `git init` 은 저장소 안이면 거부한다 (중첩 저장소 금지)
- `add` · `status` · `commit` 은 전부 `-- .` 으로 등록 폴더 아래만 다룬다

이 범위 제한이 깨지면 남의 작업물이 노트 커밋에 딸려 들어간다. 테스트로 막아 뒀다
(`cargo test -p md-sync-note`).

### 워크스페이스 링크 확인은 폴더 유무가 아니라 링크 유무로

`node_modules` 가 있어도 `node_modules/@md/editor-core` 가 없으면 vite 가 죽는다.
실행 스크립트는 이미 이렇게 처리되어 있다.

## 코딩 규약

- **가능한 한 단순하고 최소한으로.** 추상화는 두 번째 사용처가 생겼을 때 만든다
- 파일 하나가 200줄을 넘으면 역할별로 나눈다
- 주석은 "왜" 를 적는다. "무엇"은 코드가 말한다
- 한국어 주석·UI 문자열 사용
- 새 Rust 커맨드는 두 앱 모두에 필요하면 `md-core`, 아니면 앱 쪽에

## 검증 방법

작업 후 최소한 이만큼은 확인한다.

```bat
npm run build -w md-editor        :: 프론트엔드 컴파일
npm run build -w md-sync-note
cargo check --workspace           :: Rust
cargo test -p md-sync-note        :: git 커맨드 테스트
npm run editor                    :: 실제로 띄워보기
```

이 저장소는 지금까지 **헤들리스 브라우저로 UI 동작을 실제로 확인**해 왔다
(탭 전환 시 내용 보존, Mermaid 렌더링, 트리 펼침 등). 같은 방식을 이어가면 좋다.
MDXEditor 툴바 버튼은 `title` 이 아니라 **`aria-label`** 로 찾아야 한다.

## 문서

| 파일 | 내용 |
|---|---|
| `docs/Handoff.md` | **먼저 읽을 것.** 지금까지의 결정과 미해결 사항 |
| `docs/Implementation_Status.md` | 구현 현황 — 무엇이 되고 무엇이 안 되나 |
| `docs/MD_Editor_Tauri_Planned_Features.md` | 원래 계획서 |
| `docs/Windows_File_Association.md` | .md 우클릭·연결 프로그램 등록 (제약과 레지스트리 키) |
| `docs/Update_History.md` | 변경 이력 + 향후 기술 검토 |

## 지금 상태

Phase 1 의 절반을 조금 넘겼다 (v0.4.0 — 상단 드롭존 · Windows 파일 연결 ·
MDSyncNote git init/자동 커밋). 다음 우선순위는 여전히 **파일/폴더 CRUD**
(트리가 읽기 전용이라 실사용 불가). 자세한 것은 `docs/Implementation_Status.md` 마지막 절.
