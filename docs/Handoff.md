# 인계 문서 (Handoff)

Cowork 세션에서 Claude CLI 로 작업을 옮기며 정리. 기준 `959a6cd` · 2026-08-30.

먼저 저장소 루트의 [`CLAUDE.md`](../CLAUDE.md) 를 읽을 것. 규약과 함정이 거기 있다.
이 문서는 **왜 그렇게 됐는지**와 **아직 안 정해진 것**을 남긴다.

---

## 1. 어디까지 왔나

네 번의 커밋으로 여기까지 왔다.

| 커밋 | 내용 |
|---|---|
| `c689fe1` | v0.1.0 — Tauri + MDXEditor 위지윅 에디터, 파일 열기/저장, Mermaid |
| `5b069a4` | v0.2.0 — 탭, 드래그앤드롭, 이미지 붙여넣기 (계획서 "MD Editor V1" 두 줄) |
| `446af33` | v0.3.0 — 모노레포 전환 + MDSyncNote 골격 |
| `ca9b649` | fix — 실행 스크립트가 npm install 을 건너뛰던 문제 |
| `959a6cd` | docs — 구현 현황 |
| v0.4.0 | 상단 드롭존 + Windows 파일 연결 + MDSyncNote git init/자동 커밋 |
| v0.4.1 | 표 셀 안 Alt+Enter 줄바꿈 (두 앱 공통) |

기능별 상세는 [Implementation_Status.md](Implementation_Status.md).

---

## 2. 왜 이 기술을 골랐나

나중에 "왜 이걸 썼지" 하고 되묻지 않도록 근거를 남긴다.

| 선택 | 대안 | 고른 이유 |
|---|---|---|
| **MDXEditor** | Milkdown, Tiptap, Toast UI | 마크다운 왕복 정확도가 좋고, **코드블록 렌더러를 교체하는 확장점**을 제공한다. Mermaid 를 플러그인으로 붙일 수 있었던 게 이 확장점 덕분 |
| **Tauri v2** | Electron | Windows 11 에 WebView2 가 내장돼 런타임 동봉이 불필요하고 설치본이 10MB 대. 단점은 Rust 툴체인 설치 부담 |
| **모노레포** | 복사(fork), 경로 참조 | 코드가 530줄일 때가 나누기 가장 싼 시점이었다. 복사는 Mermaid 버그 하나를 두 번 고쳐야 한다 |
| **data URI 이미지 표시** | asset 프로토콜 | 설정 파일을 안 건드려 확실히 동작하고, 저장되는 마크다운이 오염되지 않는다. 문서가 커지면 재검토 대상 |
| **Rust 커맨드 직접 구현** | tauri-plugin-fs | 권한 스코프 설정이 통째로 사라져 오히려 단순하다 (커맨드 5개, 77줄) |

---

## 3. 부딪혔던 문제와 해법

같은 곳에서 다시 막히지 않도록. 해법은 `CLAUDE.md` 에도 요약돼 있다.

### 3.1 `#[tauri::command]` 를 크레이트 루트에 두면 컴파일 실패

공유 크레이트를 만들자마자 터졌다.

```
error[E0255]: the name `__cmd__read_file` is defined multiple times
```

`#[tauri::command]` 가 `#[macro_export]` 매크로를 만드는데, 함수가 크레이트 루트에
있으면 재수출과 충돌한다. **`md_core::commands` 서브모듈**에 넣고
`generate_handler![md_core::commands::read_file]` 로 등록해 해결.

### 3.2 WebView2 는 `file://` 을 못 읽는다

이미지를 저장해도 화면엔 깨져 보인다. 해법은 표현을 둘로 나누는 것 —
파일에는 상대 경로, 화면에는 data URI. `imagePreviewHandler` 가 그 경계다.

asset 프로토콜을 쓰려면 `tauri.conf.json` 의 `assetProtocol.enable` + `scope` +
`convertFileSrc()` 세 곳을 맞춰야 하는데, 검증 없이 설정만 넣기엔 실패 지점이 많아
data URI 를 택했다.

### 3.3 Tauri 가 HTML5 드롭을 가로챈다

에디터 안 `ondrop` 이 오지 않는다. `getCurrentWebview().onDragDropEvent()` 를 쓴다.
**대가**: 에디터에 이미지 파일을 끌어다 놓는 동작이 막힌다. 파일 열기를 드롭으로
하려면 피할 수 없다. 이미지 드롭까지 원하면 드롭 좌표로 분기하는 처리가 필요하다.

### 3.4 툴바가 스크롤하면 사라짐

`position: sticky` 인 툴바의 부모에 `height: 100%` 를 줬더니, sticky 기준 박스가
화면 높이에서 끝나 그 아래로는 같이 밀려 올라갔다. `min-height: 100%` 로 해결.

### 3.5 실행 스크립트가 `npm install` 을 건너뜀

모노레포 전환 때 옛 `node_modules` 를 루트로 옮겼는데 워크스페이스 링크가 없었고,
스크립트는 **폴더 유무만** 보고 설치를 생략했다. `node_modules\@md\editor-core\package.json`
존재로 판단하도록 수정.

### 3.6 표 셀 안에서는 줄바꿈을 `<br />` 로 넣어야 한다

Alt+Enter 를 붙이면서 두 번 걸렸다. 상세는
[Update_History.md](Update_History.md) v0.4.1 절.

**첫째, 저장 형식.** GFM 표는 셀 안에 진짜 개행을 담지 못한다. lexical 기본
줄바꿈 노드를 그대로 내보내면 `&#xA;` 로 이스케이프되어 **GitHub·VS Code·Obsidian
어디서도 줄이 나뉘지 않는다.** `<br />` 로 써야 한다.

**둘째, 편집 중 커서.** 그렇다고 `<br />` 를 MDXEditor 기본 HTML 처리에 맡기면
자식 없는 빈 인라인 요소(GenericHTMLNode)가 되는데, **그 뒤에는 커서가 서지 못해서**
줄바꿈 뒤에 이어 친 글자가 위쪽 줄로 들어간다. `LineBreakNode` 를 상속한 전용
타입(`md-html-br`)으로 다루고 가져오기/내보내기 방문자를 붙여 해결했다.

전용 타입을 판 이유는, 그냥 `LineBreakNode` 로 두면 본문에서 Shift+Enter 로 만든
기존 줄바꿈까지 전부 `<br />` 로 다시 쓰여 **건드리지도 않은 문서가 바뀌기 때문**이다.

셀 Enter 를 MDXEditor 가 `COMMAND_PRIORITY_CRITICAL` 로 선점하므로, 같은 큐의 맨
앞에 꽂히는 `COMMAND_PRIORITY_BEFORE_CRITICAL` 로 등록해야 먼저 돌아간다.

**부작용**: 닫는 슬래시 없는 `<br>` 이 든 파일은 MDXEditor 가 아예 파싱하지 못한다
(이번 변경과 무관한 기존 제약). 이 앱이 쓸 때는 항상 `<br />` 다.

### 3.7 `<br>` 이 든 파일을 못 열던 문제

MDXEditor 는 마크다운을 **MDX 로** 읽는다. MDX 에서 `<br>` 은 JSX 여는 태그라
닫는 태그를 기다리다 파싱이 통째로 실패한다.

```
Error parsing markdown: Expected a closing tag for `<br>` (88:115-88:119)
```

GitHub·VS Code·Obsidian 은 같은 파일을 문제없이 읽으므로 **파일이 잘못된 게 아니라
이 에디터만 못 읽는 것**이다. 파서 쪽에서 끄는 방법은 없다 — mdx-jsx 확장이
MDXEditor 코어에 박혀 있고 제거 API 가 없다(`importMarkdownToLexical.js`).

그래서 **불러올 때 맞춰서** 연다(`packages/editor-core/src/normalizeMarkdown.js`).
`<br>` 뿐 아니라 `A <- B`, `p<0.05`, `<https://x>`, 문서에 붙여 넣은 XML 로그
(`<root>`, `<P_20260525161121.222>`) 가 전부 같은 이유로 실패한다.

**판정 기준이 핵심이다.** "태그처럼 생겼으면 통과" 로 하면 XML 로그가 통과해 버려
여전히 안 열린다. 그래서 (1) **실제 HTML 태그 이름 목록**에 있는 것만 태그로 보고,
(2) 문서 전체에서 **짝이 맞지 않는 태그**도 텍스트로 본다. 나머지 `<` 는 `&lt;` 로
바꾼다 — 어느 도구에서나 `<` 로 보인다.

건드리지 않는 것: 코드블록·인라인 코드 안, 진짜 HTML 태그, 주석.

**주의**: 파일이 실제로 바뀌는 시점은 사용자가 저장할 때다. 열기만 하면 디스크는
그대로다. 고친 개수는 화면에 알려 준다.

### 3.8 열기만 해도 "수정됨"으로 잡히던 문제 ← 파일이 조용히 바뀌던 원인

MDXEditor 는 파일을 연 직후 마크다운을 자기 표기법으로 다시 쓰고 `onChange` 를
부른다. 두 번째 인자 `initialMarkdownNormalize` 가 "이건 사용자의 편집이 아니다"를
알려주는데, 두 앱이 그걸 **무시하고 있었다.**

그래서 파일을 열자마자 수정됨(●)이 되고, MDSyncNote 의 자동 저장(기본 60초)이
손대지도 않은 파일을 다시 썼다. 그 과정에서 `p.62~65` → `p.62~~65`,
`BUFFER_TYPE` → `BUFFER\\_TYPE` 로 바뀐다. **"에디터에서 본 것과 PDF 가 다르다"의
진짜 원인이 이것이다.**

v0.4.3 에서 초기 정규화를 수정으로 치지 않도록 고쳤다. 편집하면 정상적으로 수정
표시가 뜬다(회귀 검사 있음).

**남은 문제**: 한 번이라도 편집해 저장하면 그 파일은 MDXEditor 표기법으로 다시
쓰인다. 단일 물결 취소선도, 이스케이프 양도 끄거나 줄이는 방법이 없다.
상세는 [Update_History.md](Update_History.md) v0.4.3 3절.

### 3.9 Windows 실환경 검증의 한계

Cowork 세션은 리눅스 컨테이너라 Windows 앱을 직접 실행하지 못했다. 대신
헤들리스 브라우저(UI 동작)와 Xvfb 가상 디스플레이(실제 Tauri 바이너리 실행)로 검증했다.

**그래서 아직 Windows 에서 확인 못 한 것** — 파일 저장, 이미지 붙여넣기,
드래그앤드롭. 셋 다 Tauri IPC 를 타므로 로컬에서 먼저 확인할 것.
Claude CLI 는 로컬에서 도니 이 제약이 없다.

---

## 4. 아직 안 정해진 것

이게 정해지기 전에는 동기화 설계를 진행할 수 없다.

### 4.1 파일이 진실인가, DB 가 진실인가 ← 가장 중요

계획서는 "파일이 진실"이라고 못박았는데, 목표는 "노션 수준의 매끄러운 동기화"다.
**이 둘은 서로 반대 방향으로 당긴다.**

노션이 매끄러운 이유는 문서가 곧 DB 안의 CRDT 문서이고, 사용자가 밖에서 건드릴 파일이
없기 때문이다. 파일이 진실이면 VS Code 나 `git pull` 이 파일을 통째로 바꿀 수 있는데,
그렇게 바뀐 파일에는 "누가 어디에 무엇을 했다"는 연산 기록이 없다. diff 를 떠서 Yjs
연산으로 되번역해야 하고, 그 순간 CRDT 의 "충돌 없음" 보장이 깨진다.

**현재 권고**: 파일이 진실을 유지하고, 동기화는 파일 단위 + Git 으로 간다.
Yjs 는 "두 사람이 같은 문단을 동시에 타이핑"이 실제로 필요해질 때 도입.
근거는 [Update_History.md](Update_History.md) 의 "향후 계획 (기술 검토)" 4절.

### 4.2 "서버 경로"의 정체

계획서는 미정으로 남겨뒀다. 후보는 Git / WebDAV / S3 호환 / 자체 HTTP API.
**Git 을 권한다** — 서버를 안 짜도 되고 변경관리가 공짜로 따라온다.

### 4.3 실시간 동시편집이 정말 필요한가

혼자 여러 기기에서 쓰는 것이면 불필요하고, 불필요하면 난이도가 급락한다.

### 4.4 이미지 저장 위치 정책

지금은 **문서 기준** 상대 폴더(기본 `images/`). 계획서 5절은 **저장소 공용**
`.attachments/` 를 권했다. 문서를 옮길 때 경로가 안 깨지는 건 계획서 쪽이다.
설정값 해석만 바꾸면 전환 가능하니, MDSyncNote 를 본격적으로 쓰기 전에 결정할 것.

### 4.5 MDSyncNote 도 탭을 쓸 것인가

지금은 한 번에 한 문서. 탭으로 가면 자동 저장·수정 표시가 전부 탭 단위가 된다.

---

## 5. 다음 작업

| 순위 | 작업 | 왜 |
|:---:|---|---|
| 1 | **파일/폴더 CRUD** — 생성·이름변경·삭제·이동 | 트리가 읽기 전용이면 실사용이 안 된다. 체감이 가장 크다 |
| 2 | ~~File Watcher~~ → **MDSyncNote 에도 적용** | MD Editor 는 v0.5.0 에서 완료. 커맨드는 공유 크레이트에 있다 |
| 3 | ~~git local 자동 commit~~ → **커밋 이력 보기·되돌리기** | 커밋은 v0.4.0 에서 쌓기 시작했다. 이제 꺼내 볼 수단이 없다 |
| 4 | **SQLite + FTS5** | 문서가 쌓여야 의미가 생긴다. 한국어는 `tokenize='trigram'` 이중 인덱스 필요 |
| 5 | **서버 저장소** | `repos.js` 의 `listDir()` 에서 분기 |
| 6 | **동기화** | 위가 다 있어야 한다 |

### 1번 작업 시작점

- Rust: `crates/md-core/src/commands.rs` 에 `create_dir`, `rename_path`, `delete_path` 추가
  (삭제는 휴지통으로 보내는 편이 안전하다 — `trash` 크레이트 검토)
- JS: `apps/md-sync-note/src/RepoTree.jsx` 에 컨텍스트 메뉴
- 두 앱 모두에 필요하지 않으면 `md-core` 말고 앱 쪽에 둘 것

### 4번 작업 주의

한국어 FTS 는 기본 `unicode61` 토크나이저로는 조사 때문에 사실상 동작하지 않는다
("검색어"로 찾으면 "검색어를"이 안 걸린다). `trigram` 을 쓰되 2글자 이하 질의는
`LIKE` 폴백이 필요하다. 상세는 [Update_History.md](Update_History.md) 5절.

---

## 6. 알려진 제약

- **코드 서명 없음** — 배포 exe 첫 실행 시 SmartScreen 경고
- **편집 후 저장하면 표기가 바뀐다** — `~` → `~~`, `_` → `\\_`. PDF·인쇄 도구에서
  역슬래시가 보인다. 값싼 해법이 없다 (위 3.8 절)
- **다크 모드 미대응**
- **표를 여러 셀에 걸쳐 복사할 수 없음** — MDXEditor 가 셀마다 독립된 lexical
  에디터를 만들어서, 브라우저 선택이 `contenteditable` 경계를 넘지 못한다.
  고치려면 표 플러그인을 lexical 기본 표로 갈아끼워야 한다(사실상 재구현).
  상세와 값싼 대안은 [Implementation_Status.md](Implementation_Status.md) 의
  "표 복사 제약" 절
- **Mermaid 확대/축소 없음** — 큰 다이어그램은 가로 스크롤만
- **고아 이미지 정리 없음** — 문서를 지워도 `images/` 에 남는다
- **MD Editor 자동 저장 없음** (MDSyncNote 에는 있음)
- **탐색기에서 파일을 여러 개 열면 창이 여러 개** — 탭으로 합치려면
  `tauri-plugin-single-instance` 가 필요하다. 상세는
  [Windows_File_Association.md](Windows_File_Association.md) 5절
- **기본 앱 지정은 사용자가 직접** — Windows 정책상 프로그램이 못 바꾼다
- 옛 `md-editor` 폴더가 남아 있다면 지울 것 (5GB 짜리 `target` 캐시가 잠겨 삭제 실패했음)
