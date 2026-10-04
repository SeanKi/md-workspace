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

### 문서 안의 링크는 **Ctrl+누르기**로 따라간다

`packages/editor-core/src/linkNav.js`. 위지윅에서 링크를 그냥 누르는 것은 **글자를
고치려는 것**이다. 그래서 따라가기는 Ctrl(또는 가운데 단추)이고, 링크를 눌렀을 때
뜨는 풍선 속 주소는 그냥 눌러도 따라간다. Ctrl 을 누르고 있는 동안에만 손가락
커서가 되어 그 사실이 보인다(`body.md-ctrl`).

**화면에 그려진 `href` 를 읽으면 안 된다.** lexical 의 `formatUrl()`(`@lexical/link`)이
스킴도 없고 `/ # .` 로 시작하지도 않는 주소에 **`https://` 를 붙여서** DOM 에 그린다.
`다른글.md` 가 화면에서는 `https://다른글.md` 가 되고, `.md` 는 몰도바의 실제 최상위
도메인이라 주소로도 말이 되어 되돌릴 방법이 없다. 그래서 진짜 주소는

- 본문에서는 **노드에게 묻는다** — `$getNearestNodeFromDOMNode` → `getURL()`
- 풍선에서는 **`linkDialogPlugin({ onClickLinkCallback })`** 이 넘겨준다

파일로 내보낼 때도 같은 `getURL()` 을 쓰므로(`LexicalLinkVisitor`) **저장되는 파일은
오염되지 않는다.** 화면에 그리는 값만 다르다.

- 상대 경로의 기준은 **문서가 있는 폴더**다. 저장하지 않은 문서에는 기준이 없다
- 여는 일은 앱마다 다르므로 `ctxRef.current.openFile` 로 받는다 (이미지와 같은 ctx)
- 주소에 공백이 있으면 마크다운에서는 `%20` 이어야 링크다 (`[글](내 문서.md)` 는 글자다)
- **경로 비교는 글자 비교가 아니다.** 대화상자는 `C:\a\b.md`, 링크는 `C:/a/b.md` 로
  풀리고 Windows 는 대소문자도 가리지 않는다. `paths.js` 의 `samePath` 를 쓸 것 —
  안 그러면 같은 파일이 탭 두 개로 열린다
- `.md` 가 아닌 것(웹 주소·PDF)은 `open_external` 로 OS 에 넘긴다. 문서는 남이 준
  것일 수 있으므로 **`.exe` · `.bat` 같은 것과 `javascript:` 는 거절한다**(Rust 쪽에서)

### 탭을 다른 창으로 옮기는 길은 **임시 폴더의 우편함**이다

`apps/md-editor/src-tauri/src/handoff.rs`. 창 하나가 프로세스 하나라 "이 탭을 저
창으로" 는 프로세스 사이의 일이다. 파이프도 창 메시지도 아니고 `%TEMP%` 의 파일
하나로 잇는다 — `WindowFromPoint` 로 놓은 자리의 프로세스 번호를 얻고, `<pid>.live`
가 있으면 우리 앱이므로 `<pid>.open` 에 경로를 쓴다.

**받는 쪽이 그 파일을 지우는 것이 "받았다" 는 신호다.** 이 약속이 전부다 — 답장이
따로 없고, 아무도 안 받으면 2초 뒤 포기하고 **새 창으로 연다**. 그래서 상대가
죽었거나 남의 프로세스였어도 탭이 사라지지 않는다.

- 넘겨받는 쪽은 **파일을 다시 읽는다.** 그러니 고친 것이 있으면 보내기 전에 저장한다
- 알림(notify) 대신 300ms 들여다보기다. 끌어다 놓는 손짓보다 훨씬 빠르고, 감시자의
  수명·이벤트 종류를 신경 쓸 일이 없다
- 좌표는 프론트엔드에서 받지 않고 Rust 가 `GetCursorPos` 로 직접 읽는다. CSS 픽셀 →
  물리 픽셀 환산은 모니터마다 배율이 다르면 틀린다

### 탭 끌기도 HTML5 드래그로는 안 된다

`apps/md-editor/src/useTabDrag.js`. 창 밖에서 손을 뗀 자리를 알아야 하는데 HTML5
드래그는 창을 벗어나는 순간 OS 가 가져가 버린다. 포인터 이벤트에 **포인터 캡처**를
걸면 창 밖에서도 move·up 이 계속 온다. 놓은 자리는 셋으로 갈린다 — 탭 줄 위(순서
바꾸기) · 창 안 다른 곳(아무 일 없음) · 창 밖(넘기기).

끌기가 끝난 뒤의 click 한 번은 먹어야 한다. 트리 끌기와 같은 이유로 **깃발이 아니라
시각(300ms)으로** 잰다.

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

### 이미지 붙여넣기는 MDXEditor 보다 먼저 받는다

`packages/editor-core/src/imagePaste.js`. MDXEditor 는 클립보드에 이미지 **말고 다른
것이 하나라도** 있으면 손을 떼고(브라우저 "이미지 복사" 가 그렇다), 올리기 실패를
promise 안에서 삼킨다. 그래서 `BEFORE_CRITICAL` 로 먼저 받는다.
text/plain 이 같이 있으면 넘긴다 — 엑셀 칸 복사에도 표 그림이 딸려 온다.
저장 안 한 문서는 `ctx.ensureSaved` 로 저장부터 받는다(이미지는 문서 폴더 기준이다).

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
- 최근 문서 목록은 **`[recent]` 한 구획에 번호를 매겨** 담는다. 설정값처럼 한 줄에
  이어 붙일 수 없다 — 경로에는 쉼표도 세미콜론도 들어간다. 번호는 글자로 정렬되므로
  (Rust 쪽이 `BTreeMap`) `001` 처럼 자리를 채워야 10 이 2 보다 뒤에 온다

### 같은 문서는 탭 하나뿐이다 — 트리와 탭은 서로를 가리킨다

MDSyncNote 도 탭으로 연다(`NoteTabs.jsx`). 규칙은 둘이다.

- **트리에서 이미 열린 문서를 누르면 새로 열지 않고 그 탭으로 간다.** 같은 문서가
  탭 둘이 되면 한쪽에서 고친 것이 다른 쪽 저장에 덮인다
- **탭을 고르면 트리에서 그 줄이 켜진다.** 접힌 폴더 안이면 **가는 길을 펼친다**
  (`TreeNode.jsx`). 단 **활성 문서가 바뀐 순간에만** 펼친다 — 매번 보면 사용자가 접은
  폴더를 그 자리에서 다시 펼쳐 버려 접을 수가 없다

판정은 `samePath` 다(`editor-core/recent.js`). **글자 비교로는 못 맞춘다** — 트리는
`C:\a\b.md`, 문서 안의 링크는 `C:/a/b.md` 로 오고 Windows 는 대소문자도 가린다.

탭을 닫을 때 고친 것이 있으면 **묻지 않고 저장한다.** 이 앱은 자동 저장이 기본이고
진실의 원천은 실제 파일이다. (MD Notepad 는 묻는다 — 거기는 자동 저장이 없다)

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
| `docs/Release.md` | **릴리스 낼 때 먼저 읽을 것.** 버전 올릴 아홉 자리 · 배포 · 릴리스 노트 쓰는 법 |

## 지금 상태

Phase 1 의 절반을 넘겼다 (v0.9.0 — 창 나누기 · 취소선 · 트리 파일 CRUD 완결.
v0.9.1 — 표 셀 경계를 지켜 정규화. v0.10.0 — 문서 제목을 창·탭에 · 표에서 여러 셀
끌어 복사 · 트리 우클릭 · 검색 결과 수정일자 · 설정을 INI 로.
v0.11.0 — 얼어붙는 원인 둘을 재서 고침 · 글자색/배경색 · 좌우 비교 · 트리 층 맞춤.
v0.13.0 — 문서 안의 링크 따라가기(Ctrl+누르기) · 탭을 다른 창으로 끌어 옮기기 ·
못 읽는 문서는 원본 모드로 · 최근 문서.
v0.14.0 — MDSyncNote 도 탭으로. 같은 문서는 탭 하나 · 탭과 트리가 서로를 가리킨다 ·
탭과 최근 목록은 30개까지.
v0.15.0 — 색 단추를 Word 식 나뉜 단추로 · 이미지 붙여넣기를 우리가 먼저 받는다).
v1.16.1 — Tiptap 판 **MDNotePad+** (`apps/md-tiptap`): WebDAV 동기화 · 단순 모드(기본, 창 여러 개)와
`--sync` 전체 모드(하나만) · 원격 도장으로 빠른 맞추기 (`docs/Update_History.md`).
v1.16.2 — 폰으로 저장소 넘기기(저장소별 QR · 이미 쓰는 주소에서 고르기) · 기본 앱으로 정하기.
다음 우선순위는 **MDSyncNote 에 File Watcher 붙이기** (MD Editor 는 v0.5.0 에서 끝났다).
자세한 것은 `docs/Implementation_Status.md` 마지막 절.
