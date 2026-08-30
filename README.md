# md-workspace

마크다운을 **위지윅으로 편집**하는 Windows 데스크톱 앱 두 개.
Tauri v2 + MDXEditor 로 만들었고, 설치본 없이 exe 하나로 돌아간다.

| 앱 | 무엇 |
|---|---|
| **MD Editor** | 단일 창 에디터. 탭 · 드래그앤드롭 · 탐색기 우클릭 연동 |
| **MDSyncNote** | 왼쪽 저장소 트리 + 오른쪽 노트. 자동 저장 · Git 자동 커밋 |

핵심 원칙은 하나다. **실제 `.md` 파일이 진실의 원천이다.**
VS Code · Obsidian · GitHub 에서 그대로 열리는 평범한 마크다운만 쓴다.
독자 포맷도, 잠금도 없다.

---

## 주요 기능

### 편집기 (두 앱 공통)

두 앱은 에디터 코어(`packages/editor-core`)를 **그대로 공유한다.**
MDSyncNote 의 오른쪽 편집 화면은 MD Editor 와 완전히 같은 코드다.

- **위지윅 편집** — `#` 을 치면 즉시 제목이 된다. 툴바에 굵게·목록·표·링크·코드블록·구분선
- **3모드 전환** — 위지윅 ↔ 마크다운 원본 ↔ 변경점 비교
- **Mermaid 다이어그램** — 소스 편집과 오류 표시까지. 코드블록 렌더러를 교체해 붙였다
- **코드블록 문법 강조** — txt · js · ts · python · bash · json · sql
- **이미지 붙여넣기** — 클립보드 이미지를 자동 저장하고 링크를 넣는다.
  저장 폴더는 설정에서 바꾼다 (`images` / `.` / `assets/img` …)
- **표 셀 안 줄바꿈** — 표에서 **Alt+Enter**. 파일에는 `<br />` 로 적어 다른 도구에서도 줄이 나뉜다
- **다른 도구가 만든 마크다운 열기** — MDXEditor 는 `<` 를 전부 JSX 로 읽어
  `<br>` · `A <- B` · `p<0.05` · `<https://…>` · 문서에 붙여 넣은 XML 로그
  (`<root>`, `<P_20260525161121.222>`) 에서 파싱이 실패한다. 열 때 자동으로 맞춰 준다.
  진짜 HTML 태그(`<b>`, `<details>`, `<img>`)는 그대로 살리고,
  코드블록과 인라인 코드 안은 건드리지 않는다

> **이미지는 경로 두 개를 쓴다.** 마크다운 파일에는 상대 경로(`images/x.png`)를 적어
> 다른 편집기와 호환되게 하고, 화면에 그릴 때만 data URI 로 바꾼다
> (WebView2 가 `file://` 을 직접 못 읽는다). 마크다운이 data URI 로 오염되지 않는다.

### MD Editor

- **탭** — 여러 문서를 열고 전환. 탭별 수정 표시(●)와 닫기 확인
- **드래그앤드롭** — 파일을 **창 상단(제목줄·탭바)** 에 놓으면 새 탭으로 열린다
- **탐색기 우클릭 연동** — 설정 → Windows 연결 → 등록.
  `.md` 우클릭에 "MD Editor로 열기" 가 생기고 연결 프로그램 목록에도 올라간다.
  전부 `HKCU` 라 관리자 권한이 필요 없고 기존 `.md` 연결을 빼앗지 않는다.
  설치 스크립트용으로 `md-editor.exe --register` / `--unregister` 도 있다
- **단축키** — Ctrl+O 열기 · S 저장 · Shift+S 다른 이름으로 · T/N 새 탭 · W 닫기 · Tab 전환

### MDSyncNote

- **다중 저장소 트리** — 폴더 여러 개를 저장소로 등록. 펼칠 때만 읽는 지연 로딩
- **자동 저장** — 기본 60초, 설정에서 조정. **변경이 있을 때만** 쓴다
- **Git 초기화 버튼** — 저장소가 git 이 아니면 트리 머리에 뜬다. `git init` + 첫 커밋까지 한 번에
- **저장할 때 자동 커밋** — 파일을 실제로 쓴 경우에만 커밋한다. 설정에서 끌 수 있다.
  커밋 메시지는 `a.md 저장 (2026-08-30 19:48)`

> **남의 저장소를 휩쓸지 않는다.** 등록한 폴더가 이미 다른 git 저장소의 하위
> 폴더라면 새로 `init` 하지 않고 상위 저장소를 알려준다. `add`·`status`·`commit`
> 은 모두 등록한 폴더 아래로 범위를 좁혀, 저장소 루트의 다른 작업물이 노트 커밋에
> 딸려 들어가지 않는다.

---

## 받아서 쓰기

`release-out/` 의 **포터블 exe** 를 받아 실행하면 끝이다. 설치가 필요 없다.

```
MD-Editor-portable.exe     7.7 MB
MDSyncNote-portable.exe    7.7 MB
```

- Windows 10 / 11 (x64). WebView2 는 Windows 11 에 내장돼 있어 따로 받을 것이 없다
- 코드 서명이 없어 처음 실행할 때 SmartScreen 경고가 뜬다 → **추가 정보 → 실행**

---

## 직접 빌드

준비물은 Node.js 20+, Rust, Visual Studio C++ 빌드 도구.
`build-portable.bat` 이 없는 것을 알아서 안내한다.

```bat
npm install                  :: 루트에서 한 번 (두 앱 + 공유 패키지)

run-md-editor.bat            :: 실행 (또는 npm run editor)
run-md-sync-note.bat         :: 실행 (또는 npm run sync-note)

build-portable.bat           :: 포터블 exe 두 개 (설치본 없이, 빠름)
build-all.bat                :: 설치 프로그램(NSIS) + 포터블 exe
```

결과는 `release-out/` 에 모인다. 첫 빌드는 Rust 컴파일로 5~15분, 이후는 수 초.

### 확인

```bat
npm run build -w md-editor        :: 프론트엔드 컴파일
npm run build -w md-sync-note
cargo check --workspace           :: Rust
cargo test -p md-sync-note        :: git 커맨드 테스트
```

---

## 구조

```
md-workspace/                    npm workspaces + cargo workspace
├─ packages/editor-core/         공유 JS — 두 앱이 함께 쓰는 에디터
│                                (MDXEditor 설정 · Mermaid · 이미지 · 표 줄바꿈)
├─ crates/md-core/               공유 Rust — 파일 I/O 커맨드
└─ apps/
   ├─ md-editor/                 단일 창 에디터 (+ Windows 파일 연결)
   └─ md-sync-note/              저장소 트리 + 노트 뷰 (+ git)
```

공유 코드를 고치면 두 앱에 즉시 반영된다. `App.jsx` 는 공유하지 않는다 —
두 앱의 레이아웃이 근본적으로 다르기 때문이다.
cargo workspace 라 `target/` 을 공유해 두 번째 앱 빌드가 훨씬 빠르다.

---

## 지금 상태

전체 계획 대비 **약 35%**, Phase 1(Desktop Markdown Workspace)의 절반을 조금 넘겼다.

| 다음에 할 것 | 왜 |
|---|---|
| 파일/폴더 CRUD (생성·이름변경·삭제) | 트리가 읽기 전용이라 실사용이 안 된다 |
| File Watcher | 외부 편집기와 공존하려면 필수 |
| 커밋 이력 보기·되돌리기 | 커밋은 쌓이는데 꺼내 볼 수단이 없다 |
| SQLite + FTS5 전문 검색 | 한국어는 trigram 이중 인덱스가 필요하다 |
| 서버 저장소 · 동기화 | 위가 다 있어야 한다 |

### 아직 안 되는 것

- 파일/폴더 만들기·이름 바꾸기·삭제 (트리는 읽기 전용)
- 외부에서 파일이 바뀐 것을 감지하지 못한다
- 전문 검색, 서버 저장소, 기기 간 동기화
- **편집해서 저장하면 표기가 조금 바뀐다** — `p.62~65` 가 `p.62~~65` 로,
  `A_B` 가 `A\\_B` 로 다시 쓰인다(MDXEditor 직렬화 규칙). 마크다운 렌더러에서는
  같게 보이지만, 이스케이프를 풀지 않는 PDF·인쇄 도구에서는 `\\` 가 그대로 보인다.
  **열기만 하면 파일은 바뀌지 않는다**
- 다크 모드
- 탐색기에서 파일을 여러 개 열면 창이 여러 개 뜬다 (탭으로 합쳐지지 않는다)
- 기본 앱 지정은 Windows 정책상 사용자가 직접 골라야 한다
- **표를 여러 셀에 걸쳐 긁어 복사할 수 없다** — 셀 하나 안에서만 선택된다.
  MDXEditor 가 표의 셀마다 독립된 편집기를 만들기 때문이고, 브라우저 선택은
  그 경계를 넘지 못한다. 표를 통째로 복사하려면 **원본 모드**로 바꿔서 긁으면 된다

---

## 문서

- [CLAUDE.md](CLAUDE.md) — 개발 규약과 함정. 코드를 고치기 전에 읽을 것
- [docs/Handoff.md](docs/Handoff.md) — 왜 이렇게 됐고 무엇이 아직 안 정해졌나
- [docs/Implementation_Status.md](docs/Implementation_Status.md) — 무엇이 되고 무엇이 안 되나
- [docs/Update_History.md](docs/Update_History.md) — 변경 이력 + 기술 검토
- [docs/Windows_File_Association.md](docs/Windows_File_Association.md) — `.md` 우클릭 연동 (제약과 레지스트리 키)
- [apps/md-editor/README.md](apps/md-editor/README.md) — MD Editor 사용법

---

## 만든 바탕 (Credits)

이 프로젝트는 **처음부터 새로 짠 것이 아니라 남이 만든 좋은 것들 위에 올렸다.**
특히 편집기 알맹이는 직접 구현하지 않았다.

| 가져다 쓴 것 | 라이선스 | 어디에 |
|---|---|---|
| [**MDXEditor**](https://github.com/mdx-editor/editor) | MIT | 편집기 본체. 위지윅 · 툴바 · 마크다운 왕복 · 표 · 3모드 전환이 전부 이것이다 |
| [Lexical](https://github.com/facebook/lexical) | MIT | MDXEditor 가 쓰는 에디터 프레임워크. 표 셀 Alt+Enter 줄바꿈을 여기 노드로 붙였다 |
| [Mermaid](https://github.com/mermaid-js/mermaid) | MIT | 다이어그램 렌더링 |
| [Tauri v2](https://github.com/tauri-apps/tauri) | Apache-2.0 OR MIT | 데스크톱 셸 · 파일 대화상자 · 드래그앤드롭 이벤트 |
| [React](https://github.com/facebook/react) | MIT | UI |

이 저장소가 직접 만든 것은 그 위의 **껍데기와 이어붙임**이다 — 탭, 저장소 트리,
파일 I/O Rust 커맨드, 이미지 저장 경로 규칙, Mermaid 플러그인 연결, 표 셀 줄바꿈
플러그인, Windows 파일 연결, git 자동 커밋.

각 라이브러리의 라이선스 전문은 `node_modules/<패키지>/LICENSE` 에 들어 있다.

---

## 라이선스

[MIT](LICENSE) © 2026 SeanKi
