# CLAUDE.md

MD Editor / MDSyncNote 모노레포. 이 파일은 매 세션 자동으로 읽히니, 여기 적힌
규약과 함정을 먼저 확인하고 작업할 것.

## 이 프로젝트가 무엇인가

마크다운을 **위지윅으로 편집**하는 Windows 데스크톱 앱 두 개.

- **MD Notepad** — 단일 창 에디터. 탭, 드래그앤드롭, 이미지 붙여넣기
  (패키지·폴더 이름은 `md-editor` 그대로다. 보이는 이름만 v0.12.0 에서 바뀌었다)
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
deploy.bat [폴더]            :: 빌드한 exe 두 개를 쓰는 자리에 복사 (기본 C:\utility\Markdown)
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

MD Editor 는 **맨 위(`.topzone` = 탭 줄)에 놓았을 때만** 파일을 연다.
v0.10.0 에서 제목줄을 없애며 이 자리가 한 줄로 얇아졌다.
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

### 파일 열기 정규화는 **GFM 이 읽는 순서**대로 읽어야 한다

`mdSegments.js` + `normalizeMarkdown.js`. MDXEditor 는 마크다운을 MDX 로 읽어서
`<br>` · `A <- B` · XML 로그가 든 파일을 못 연다. 그래서 열 때 다듬는데, **"어디를
건드리면 안 되는가" 판정이 틀리면 고쳐야 할 곳을 통째로 놓친다.**

GFM 은 **표를 `|` 로 셀부터 가른 뒤** 셀 안을 인라인으로 읽는다. 그래서

- 인라인 코드는 셀 경계를 넘지 못한다. 셀마다 백틱이 하나씩 든 줄을 한 줄로
  뭉뚱그려 짝을 맞추면 가운데 셀이 통째로 "코드"로 잡혀 그 안의 `<br>` 을 놓친다
- JSX 도 셀 경계를 넘지 못한다. `| <b>굵게 | 계속</b> |` 는 문서 전체로는 짝이
  맞지만 MDX 는 실패한다. 태그 짝은 **셀 안에서만** 센다
- 백틱 묶음은 **길이가 같아야** 닫힌다(CommonMark). 짝 없는 백틱은 그냥 글자다

검증은 반드시 **정규화한 결과를 MDXEditor 와 같은 확장 구성의 실제 파서에 다시
통과**시켜서 한다. 출력 문자열만 보면 "고쳤는데 여전히 안 열리는" 경우를 놓친다.

### 표는 겉만 진짜 `<table>` 이다 — 셀 안쪽만 편집기다

`packages/editor-core/tableSelect.js`. MDXEditor 의 표는 **셀 하나하나가 독립된
lexical 편집기**라(`plugins/table/TableEditor.js`) 브라우저 선택이 셀 경계를 넘지
못한다. 그건 못 고친다.

그런데 **바깥은 진짜 `<table>`·`<tr>`·`<td>` 다.** 그래서 여러 셀 끌어 복사는
"선택을 우리가 그리는" 방식으로 붙였다 — 표 플러그인을 갈아엎을 필요가 없다.
`data-tool-cell` 이 붙은 칸(행·열 추가 단추)은 표가 아니므로 세지 않는다.

한 셀 안에서만 끄는 동안은 **건드리지 않아야 한다.** 그래야 평소의 글자 선택이 산다.

### 무거운 Rust 커맨드는 `#[tauri::command(async)]` 다

Tauri 는 `#[tauri::command]` 를 **메인 스레드에서** 돌린다(`ExecutionContext::Blocking`).
파일 I/O · 폴더 걷기 · 저장소 검색 · `git commit` 대기가 전부 창을 붙잡는다.
`(async)` 를 붙이면 스레드 풀(`sync_threadpool`)로 간다 — 함수는 그대로 동기 함수다.

새 커맨드가 **조금이라도 기다리는 일**을 한다면 `(async)` 를 붙일 것.
화면을 만지는 것(예: `save_pdf` 의 WebviewWindow)만 메인 스레드에 둔다.

"빠르겠지" 하고 넘기지 말 것 — `watch_file` 이 그랬다가 **17초 동안 창을 얼렸다**
(파일을 통째로 읽어 해시하고 폴더 감시를 건다. 네트워크 폴더면 몇 초씩 걸린다).

### 편집 중인 내용은 상태가 아니라 ref 에 둔다

`App.jsx` (두 앱). `onChange` 마다 문서를 상태에 넣으면 글자 하나에 앱 전체가 다시
그려진다. 268KB 문서에서 재어 보니 **그것만으로 한 글자에 0.35초**가 더 들었다.

화면에 보이는 것은 제목과 `●` 뿐이다. `●` 는 꺼짐→켜짐 **한 번만** 상태를 바꾸고,
제목은 타이핑이 멎고 0.5초 뒤에 다시 센다. 저장은 ref 에서 꺼내 쓴다.

남은 비용(한 글자 0.59초)은 **MDXEditor 가 글자마다 문서 전체를 마크다운으로 다시
쓰는 것**이라 우리가 못 고친다(코어의 update listener). 원본 모드는 0.014초다.

### 한글 조합이 늦는 것 — 짐작하지 말고 `.mdlog` 를 볼 것

큰 문서에서 **조합 한 단계에 250~600ms** 가 든다. 그중 MDXEditor 의 직렬화는 50ms 뿐이고
나머지는 **Lexical 이 큰 트리를 다시 맞추는 비용**이라 우리가 줄일 수 없다(재서 확인).
그래서 10만 자가 넘으면 **원본 모드로 연다** — 같은 문서에서 40배 빠르다.

`imeWatch.js` 가 조합 단계마다 **그 글자가 실제로 DOM 에 나타났는지** 다음 프레임에
확인해서, 안 나타났을 때만 적는다. 이 증상은 재현이 안 되므로 그 기록이 유일한 단서다.

### 멎으면 기록이 남는다 — `.mdlog`

`md-core/src/diag.rs` + `editor-core/src/diag.js`. 심장 박동이 600ms 넘게 늦으면
직전 호출과 함께 적고, 300ms 넘는 커맨드도 적는다. 실행 파일 옆 숨김 폴더에
날짜별로 쌓이고 2주 뒤 스스로 지워진다. **Rust 는 `invoke` 대신
`@md/editor-core` 의 `invoke` 로 부른다** — 그래야 시간이 재진다.

### 문서 전환은 `key=` 로 리마운트한다

`<Editor key={tabId} markdown={...} />`. 하나의 인스턴스에 `setMarkdown` 을 호출하면
상태가 섞이고 되돌리기 이력이 엉킨다.

### 창 제목을 바꾸려면 권한이 따로 필요하다

`capabilities/default.json` 에 **`core:window:allow-set-title`**. `core:default` 에는
읽기(`allow-title`)만 들어 있어서 `setTitle` 이 **조용히 거절된다.**

v0.10.0 에서 넣은 창 제목이 v0.12.0 까지 동작하지 않았던 이유가 이것이고,
`.catch(() => {})` 로 오류를 삼키던 코드가 그 사실을 숨겼다.
**Tauri 호출의 실패는 삼키지 말고 `note()` 로 남길 것** — `.mdlog` 에 쌓인다.

### Windows 파일 연결은 HKCU 만 건드린다

`win_assoc.rs`. `.md` 의 (기본값)은 절대 바꾸지 않고 `OpenWithProgids` 에 후보로
더하기만 한다. **기본 앱 지정은 프로그램이 못 한다** (Win8+ `UserChoice` 해시).
`md-editor.exe --register` / `--unregister` 로 창 없이 등록·해제할 수 있다.
자세한 건 `docs/Windows_File_Association.md`.

### MDSyncNote 의 설정은 실행 파일 옆 `MDSyncNote.ini` 다

`config.rs` + `config.js`. localStorage 에 두면 WebView2 의 사용자 데이터 폴더 안에
숨어 **어디 있는지 알 수 없고 옮길 수도 없다.** portable 앱이니 설정도 실행 파일을
따라다녀야 한다.

- 값에 이스케이프가 없는 고전 INI 다. `C:\내 문서` 가 있는 그대로 들어간다
- 통째로 다시 쓴다. 조각내 고치면 사람이 손댄 파일과 어긋난다
- 쓰기는 모아서 한 번(400ms) + 창 닫을 때. 사이드바 폭을 끌 때마다 쓸 수는 없다
- 파일이 없고 localStorage 에 쓰던 것이 있으면 **한 번 옮겨 담는다**

### git 은 `git` 실행 파일을 부른다 (git2 아님)

`apps/md-sync-note/src-tauri/src/git.rs`. 빌드가 가벼워지고 자격증명·훅·gitignore 가
사용자 설정 그대로 동작한다. Windows 에서는 `CREATE_NO_WINDOW` 를 줘야 콘솔이
깜빡이지 않는다.

**등록한 폴더가 이미 다른 저장소의 하위 폴더일 수 있다.** 그래서

- `git init` 은 저장소 안이면 거부한다 (중첩 저장소 금지)
- `add` · `status` · `commit` 은 전부 `-- .` 으로 등록 폴더 아래만 다룬다

이 범위 제한이 깨지면 남의 작업물이 노트 커밋에 딸려 들어간다. 테스트로 막아 뒀다
(`cargo test -p md-sync-note`).

### 파일 감시는 폴더를 보고, 판단은 내용 해시로

`crates/md-core/src/watcher.rs`. 편집기들이 "임시 파일 + 이름 바꾸기" 로 저장하므로
**파일이 아니라 상위 폴더**를 감시해야 감시가 안 끊긴다. 그리고 "우리가 저장한 것"과
"밖에서 바뀐 것"을 시간으로 가르려 하지 말 것 — 마지막으로 아는 **내용 해시**와
비교한다. `write_file` 이 쓴 내용을 `watcher::remember` 로 알려 주는 게 그 연결이다.

### 파일을 만들거나 이름을 바꿀 때는 먼저 존재를 확인한다

`std::fs::rename` 은 대상이 있어도 **조용히 덮어쓴다.** 트리에서 이름을 바꾸다 남의
파일을 날리는 사고가 여기서 난다. `md-core::commands` 의 만들기·이름 바꾸기는 모두
`must_not_exist` 를 거치고, 삭제는 `trash` 로 **휴지통**에 보낸다.

### MDXEditor 는 자리표시자에도 `contentEditableClassName` 을 붙인다

`.prose` 에 흰 배경·테두리·그림자를 주면 **자리표시자에도 그대로 걸려** 빈 문서에서
종이 카드가 두 겹으로 보인다. 자리표시자는 `position:absolute` 라 자리까지 어긋난다.
`editor.css` 의 `.prose[class*="_placeholder_"]` 규칙이 그것을 걷어낸다.
클래스 이름의 해시(`_er3ed_`)는 버전마다 바뀌므로 부분 일치로 잡는다.

### 창 나누기 — 편집 중인 화면에는 `setMarkdown` 을 하지 않는다

`packages/editor-core/SplitEditor.jsx`. 두 화면은 각자 진짜 MDXEditor 인스턴스다.
내용은 **"방금 고친 쪽 → 놀고 있는 쪽" 한 방향으로만** 옮겨 담는다. 편집 중인 쪽에
`setMarkdown` 을 하면 커서와 되돌리기 이력이 통째로 날아간다.
옮겨 담기 전에 스크롤 위치를 적어 두고 다음 프레임에 되돌린다.

### "누르고 있다가 끌기" 는 HTML5 드래그로 못 만든다

브라우저는 **누르기 전에** `draggable` 이 서 있어야 끌기를 시작한다. 도중에 켜도
그 손짓은 이어지지 않는다. 그래서 트리의 3초 길게 누르기는 포인터 이벤트로 직접
만들었다 (`useTreeDrag.js`). 놓을 자리는 `elementFromPoint` + `data-drop` 으로 찾는다.

끌기가 끝난 뒤의 click 한 번은 먹어야 한다(안 그러면 옮기자마자 문서가 열린다).
불리언 깃발로 하면 안 된다 — **누른 줄과 놓은 줄이 다르면 click 이 아예 오지 않아서**
깃발이 남아 다음 클릭을 잡아먹는다. 시각(300ms)으로 재야 스스로 풀린다.

### 트리에서 한 파일 조작도 커밋으로 남긴다 — 저장보다 **먼저**

`usePendingCommits.js`. 이름 바꾸기·옮기기·삭제를 모아 뒀다가 자동 저장 박자에
맞춰 한 커밋으로 남긴다. 순서가 중요하다 — 파일 조작을 먼저 커밋해야 "무엇이 어떻게
바뀌었는지" 가 문서 저장 커밋에 엉뚱한 이름으로 섞이지 않는다.
자동 저장을 꺼 뒀어도(0) 파일 조작만은 60초마다 커밋한다.

### dev 서버에서는 React 를 한 벌로 못 박아야 한다

공유 패키지를 `optimizeDeps.exclude` 해 두면 vite 가 그 안의 `@lexical/react` 를
따로 묶으면서 **React 를 한 벌 더** 끌어들인다. "Invalid hook call" 로 dev 화면이
통째로 죽는다(빌드는 멀쩡하다). 두 앱의 `vite.config.js` 에
`resolve: { dedupe: ['react', 'react-dom'] }` 가 그 못이다.

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
cargo test -p md-core             :: 파일 감시 테스트
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

Phase 1 의 절반을 넘겼다 (v0.9.0 — 창 나누기 · 취소선 · 트리 파일 CRUD 완결.
v0.9.1 — 표 셀 경계를 지켜 정규화. v0.10.0 — 문서 제목을 창·탭에 · 표에서 여러 셀
끌어 복사 · 트리 우클릭 · 검색 결과 수정일자 · 설정을 INI 로.
v0.11.0 — 얼어붙는 원인 둘을 재서 고침 · 글자색/배경색 · 좌우 비교 · 트리 층 맞춤).
다음 우선순위는 **MDSyncNote 에 File Watcher 붙이기** (MD Editor 는 v0.5.0 에서 끝났다).
자세한 것은 `docs/Implementation_Status.md` 마지막 절.
