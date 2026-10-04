# 모바일(Android → iOS · 웹) 편집기 전환 + WebDAV 블록 동기화 계획

작성: 2026-10-03 · 기준 v0.15.0 · 상태: **제안 (결정 대기)**

***

## 0. 한 줄 결론

- **편집기는 Tiptap v3 (ProseMirror)** 로 간다. 마크다운 변환은 Tiptap 기본 것이 아니라
  **remark(mdast) 기반으로 직접** 잇는다 — 지금 MDXEditor 가 쓰는 것과 같은 파서다.
- **셸은 Tauri v2 모바일**. `md-core` Rust 를 그대로 Android·iOS 로 가져간다.
- **동기화는 WebDAV 위의 "블록 매니페스트 + 3-way 병합"**. 서버 코드가 없고,
  각 기기는 **자기 파일만 쓰고**, 공유 파일은 ETag(`If-Match`)로만 바꾼다.
- **파일이 진실이라는 원칙은 그대로다.** 블록 계층은 `.md` 에서 언제든 다시 만들 수
  있는 파생물이다 (Handoff 4.1 의 권고와 같은 방향).

***

## 1. 왜 MDXEditor 를 바꿔야 하나

MDXEditor 자체의 문제라기보다 그 **아래층 두 개**가 모바일과 맞지 않는다.

| 원인 | 지금 데스크톱에서 이미 보이는 증상 | 모바일에서 |
|---|---|---|
| **Lexical 의 입력 처리**가 `beforeinput` 에 크게 기댄다 | 큰 문서에서 조합 한 단계 250~600ms (`imeWatch.js` 기록) | Android Chrome 은 조합 중 `beforeinput` 을 취소할 수 없고, 삼성 키보드·Gboard 마다 이벤트 순서가 다르다. 글자 중복·커서 튐이 오랜 이슈였다 |
| **MDX 파서** | `<br>` · `A <- B` · XML 로그에서 열기 실패 → `normalizeMarkdown.js` 166줄 + `mdSegments.js` 153줄로 막고 있다 | 그대로 따라간다 |
| **글자마다 문서 전체 직렬화** | 한 글자 0.59초 (268KB) | 모바일 CPU 에선 몇 배 |
| **표 셀마다 독립 편집기** | 여러 셀 선택 불가 → `tableSelect.js` 205줄로 흉내 | 터치 선택은 더 어렵다 |

즉 지금 쌓아 둔 우회 코드의 상당수가 **편집기를 바꾸면 필요 없어진다.**

***

## 2. 후보 비교

평가 기준은 요청 그대로 — ① 한글 입력 ② 위지윅 ③ Android·iOS 웹뷰 ④ 웹 ⑤ (추가) `.md` 를
건드리지 않고 왕복할 수 있는가 ⑥ 블록 ID 를 붙일 수 있는가.

| | 엔진 | ① 한글/IME | ⑤ md 왕복 | ⑥ 블록 ID | 유지보수·생태계 | 판정 |
|---|---|---|---|---|---|---|
| **Tiptap v3** | ProseMirror | ◎ DOM 변이 관찰 방식이라 Android 조합에 가장 강하다 | ○ 직접 이으면 ◎ | ◎ `UniqueID` 확장 (2025년 MIT 공개) | ◎ 가장 크다. Yjs(`y-prosemirror`) 공식 | **채택** |
| Milkdown | ProseMirror + remark | ◎ (같은 엔진) | ◎ remark 기반 | ○ 플러그인 직접 | △ 사실상 1인 유지 | 차선. 엔진이 같아 나중에 갈아타기 쉽다 |
| BlockNote | Tiptap 위 | ◎ | ✕ **마크다운 내보내기가 "lossy" 라고 스스로 밝힌다** | ◎ 기본 | ○ 일부 패키지 GPL/상용 | 탈락 — "파일이 진실" 원칙과 충돌 |
| Remirror | ProseMirror | ◎ | ○ | ○ | ✕ 활동 둔화 | 탈락 |
| Lexical (직접) | Lexical | △ 지금 겪는 그것 | △ `@lexical/markdown` 은 GFM 표가 약하다 | ○ | ◎ | 탈락 — 문제의 원인 그대로 |

### 왜 Tiptap 기본 마크다운이 아니라 remark 로 잇나

`@tiptap/markdown` 도 있지만, 이 프로젝트의 원칙("열기만 하면 파일은 바뀌지 않는다",
`p.62~65` → `p.62~~65` 같은 재작성 문제)을 지키려면 **원본 바이트를 보존하는 변환**이
필요하다. remark(`mdast-util-from-markdown` + GFM)는 노드마다 원본 위치(offset)를 준다.

```
.md ──remark──▶ mdast (블록마다 원본 offset)
                   │
                   ▼
         ProseMirror 문서. 최상위 블록마다
         attrs = { id, src: "원본 그대로의 조각", srcHash }
                   │  편집
                   ▼
         건드린 블록만 src 를 지운다 (appendTransaction)
                   │
                   ▼  저장
         src 가 남은 블록 → 원본 그대로 출력
         src 가 지워진 블록 → 그 블록만 직렬화
```

이 하나로 세 가지가 함께 풀린다.

1. **안 고친 곳은 한 글자도 안 바뀐다** — 지금 README "아직 안 되는 것"의 이스케이프 문제 해소
2. **어느 블록이 바뀌었는지를 공짜로 안다** — 동기화의 dirty 집합이 그대로 나온다 (6절)
3. **저장 비용이 고친 블록 크기에 비례한다** — 글자마다 전체 직렬화가 없어진다

MDX 가 아니라 CommonMark/GFM 으로 읽으므로 `<` 문제도 없다. 진짜 HTML 은 raw 블록/인라인
노드로 그대로 들고 다닌다. → `normalizeMarkdown.js` · `mdSegments.js` 는 대부분 은퇴.

***

## 3. 셸: Tauri v2 모바일

| | Tauri v2 (Android/iOS) | Capacitor |
|---|---|---|
| `md-core` Rust 재사용 | ◎ 그대로 | ✕ 다시 짜야 함 |
| 데스크톱과 한 코드베이스 | ◎ | △ 두 셸 |
| 모바일 플러그인 생태계 | △ 작다 | ◎ |

**Tauri 로 간다.** 모자란 네이티브 기능(키 저장소, 백그라운드 작업)은 Tauri 모바일
플러그인으로 Kotlin/Swift 를 조금 쓴다. 막히는 지점이 생기면 프론트엔드는 그대로 두고
Capacitor 로 옮길 수 있게 **앱 코드는 `@md/platform` 어댑터 너머에서만 네이티브를 부른다.**

### Rust 쪽에서 갈라야 할 것

| 지금 | 모바일 |
|---|---|
| `trash` 크레이트 (휴지통) | 없음 → 저장소 안 `.mdtrash/` 로 옮기기 |
| `notify` 파일 감시 | 불필요 (앱이 파일의 유일한 작성자) → `cfg` 로 끔 |
| `git` 실행 파일 | **Android 에 없다** → 모바일은 git 없이 WebDAV 동기화만 |
| `win_assoc.rs` · `handoff.rs` · `open_with.rs` · `pdf.rs` | 데스크톱 전용 `cfg(desktop)` |
| `search.rs` · `commands.rs` 파일 I/O | 그대로 |
| 실행 파일 옆 `.ini` · `.mdlog` | 앱 데이터 폴더로 (`app_data_dir`) |

### 파일은 어디에 두나

- **1차: 앱 전용 저장소** (Android `files/`, iOS `Documents/` + `UIFileSharingEnabled` 로 "파일" 앱에 노출).
  SAF(`content://`) 없이 평범한 경로라 `md-core` 가 그대로 돈다. 기기 간 공유는 WebDAV 가 맡는다
- 2차(필요하면): 사용자가 고른 폴더(SAF). Tauri fs 의 SAF 지원이 얕아서 비용이 크다 — 미룬다

***

## 4. 기능 이식표 — md-workspace → 모바일

✅ 그대로 · 🔁 다시 만듦(편집기 교체) · 📱 모바일용으로 바꿈 · 🖥 데스크톱 전용

| 지금 기능 (위치) | 모바일 | 방법 |
|---|---|---|
| 위지윅 · 툴바 (`Editor.jsx`) | 🔁📱 | Tiptap StarterKit + 키보드 위에 붙는 하단 툴바 (`visualViewport` 로 키보드 높이 추적) |
| 3모드: 위지윅/원본/비교 | 🔁 | 원본 = CodeMirror 6 (모바일 OK). 비교(`DiffView`)는 태블릿·데스크톱만 |
| Mermaid (`MermaidBlock.jsx`) | 🔁 | 코드블록 NodeView. 렌더 로직 재사용 |
| 코드 문법 강조 | 🔁 | `code-block-lowlight` (가볍다) |
| 이미지 붙여넣기 (`imagePaste.js`, `images.js`) | 🔁📱 | 모바일은 "갤러리/카메라에서 넣기". **저장 경로 ↔ 표시 URL 분리 원칙 유지** — 표시는 `convertFileSrc` |
| 표 셀 `<br />` (`tableCellBreak.jsx`) | 🔁 | 셀 안 HardBreak → 직렬화 시 `<br />`. 셀 내용은 인라인만 허용(GFM 으로 못 쓰는 표를 못 만들게) |
| 여러 셀 복사 (`tableSelect.js`) | ✅ 삭제 | ProseMirror `CellSelection` 이 원래 된다 |
| 글자색·배경색 (`colorTools.jsx`) | 🔁 | `TextStyle`+`Color`+`Highlight`, 직렬화는 지금처럼 `<span style>` |
| 남의 md 열기 (`normalizeMarkdown.js`) | ✅ 대부분 삭제 | MDX 가 아니므로 불필요. 회귀 테스트 문서들은 **왕복 테스트 말뭉치로 재활용** |
| 링크 따라가기 Ctrl+누르기 (`linkNav.js`) | 📱 | 탭하면 풍선 → [열기]. 경로 규칙(`samePath`, 실행 파일 거절)은 그대로 |
| 큰 문서 원본 모드 (`bigDoc.js`) | ✅ | 기준값은 재측정 (ProseMirror 는 훨씬 높게 잡힐 것) |
| IME 감시 (`imeWatch.js`) · `.mdlog` | ✅ | **Android 한글 검증의 핵심 도구.** 그대로 가져간다 |
| 창 나누기 (`SplitEditor.jsx`) | 🖥 | |
| 탭 (`TabBar`, `NoteTabs`) | 📱 | 최근 문서 스택 + 뒤로 가기 |
| 저장소 트리 (`RepoTree`, `TreeNode`) | 📱 | 왼쪽 서랍(drawer). 3초 누르고 끌기 → 길게 눌러 메뉴 [옮기기] |
| 파일 CRUD (`useTreeOps`) | ✅ | 삭제만 `.mdtrash/` |
| 저장소 검색 (`search.rs`) | ✅ | Rust 그대로 |
| 자동 저장 | ✅📱 | 앱이 백그라운드로 갈 때도 즉시 저장 |
| git 자동 커밋 (`git.rs`) | 🖥 | 모바일은 동기화 이력(6.6)이 대신한다 |
| 파일 감시 (`watcher.rs`) | 🖥 | 데스크톱에서는 **동기화 입력원**이 된다 (6.5) |
| Windows 연결 · 탭 다른 창으로 · PDF | 🖥 | PDF 는 나중에 "공유 → 인쇄" 로 |
| 설정 INI | 📱 | 앱 데이터 폴더 |

### 데스크톱도 같은 편집기로 바꾼다

`editor-core` 를 공유하는 구조를 지키려면 편집기가 하나여야 한다. 두 편집기를 함께
유지하면 지금 있는 함정 목록(CLAUDE.md)이 두 배가 된다. 그래서 **데스크톱부터 Tiptap 으로
기능을 맞추고**, 그 다음 모바일 셸을 씌운다. 데스크톱에서는 기존 회귀(헤들리스 브라우저
검증)를 그대로 돌릴 수 있어 가장 싸게 검증된다.

***

## 5. 패키지 구조 (목표)

```
md-workspace/
├─ packages/
│  ├─ editor-core/        Tiptap 편집기 (MDXEditor 제거)
│  ├─ md-bridge/          remark ⇄ ProseMirror, 원본 보존 직렬화, 블록 분할·해시   ← 신규
│  ├─ sync-core/          WebDAV 블록 동기화 엔진 (순수 TS, 플랫폼 무관)          ← 신규
│  └─ platform/           fs · http · 키 저장소 · 설정 어댑터 (tauri / web)       ← 신규
├─ crates/md-core/        cfg(desktop|mobile) 로 갈라짐
└─ apps/
   ├─ md-editor/          (데스크톱, 그대로)
   ├─ md-sync-note/       (데스크톱, 동기화 UI 추가)
   └─ md-mobile/          Tauri 모바일 (Android → iOS)                          ← 신규
                          + 웹 빌드 타깃 (PWA)
```

동기화 엔진을 **TS 로 두는 이유**: 블록 분할·해시가 `md-bridge`(JS)에 있고, 웹 빌드에서도
같은 코드가 돌아야 한다. HTTP 는 `platform` 어댑터가 고른다 — 네이티브는 Tauri `http`
플러그인(**CORS 를 안 탄다**), 웹은 `fetch`(WebDAV 서버에 CORS 설정 필요).

***

## 6. WebDAV 위의 블록 단위 동기화

### 6.1 WebDAV 가 주는 것과 안 주는 것

| 준다 | 안 준다 |
|---|---|
| `GET` `PUT` `DELETE` `MKCOL` `MOVE` `PROPFIND` | 서버 로직 · 푸시 알림 |
| **ETag + `If-Match` / `If-None-Match`** → 조건부 쓰기(CAS) | 원자적 append · 트랜잭션 |
| (선택) `LOCK` | 여러 파일 묶어 쓰기 |

설계 원칙은 그래서 셋이다.

1. **내용은 내용 주소(해시)로 쓴다** — 같은 이름에 다른 내용이 올 일이 없으니 충돌이 없다
2. **기기는 자기 이름의 파일만 쓴다** — 남과 겹치지 않는다
3. **여럿이 쓰는 파일은 매니페스트 하나뿐이고 `If-Match` 로만 바꾼다** — 412 가 오면 다시 병합

### 6.2 "블록"의 정의

- 블록 = mdast **최상위 자식** 하나 (제목·문단·표·코드블록·인용·목록·HTML 블록·구분선)
- 목록은 1차에서는 통째로 한 블록. 긴 목록이 문제되면 2차에 항목 단위로 쪼갠다
- 블록 내용 = **그 블록의 마크다운 원문** (2절의 `src`). 해시 = `sha256(정규화 안 한 원문)` 앞 16바이트
- 블록 ID = 기기가 만든 무작위 ID (`UniqueID` 확장). **`.md` 파일에는 적지 않는다**

### 6.3 ID 를 파일에 안 적으면 어떻게 유지하나

로컬 사이드카 `.mdsync/` (데스크톱은 저장소 폴더 안, `.gitignore` 에 넣는다)에 문서별로
마지막으로 아는 **[id, hash] 순서 목록**을 둔다. 파일을 열거나 밖에서 바뀌면:

```
새로 읽은 블록 해시들  vs  마지막으로 아는 [id, hash] 목록
        └── LCS(최장 공통 부분열)로 맞춘다
              같은 해시 → 같은 ID 계승
              짝 없이 끼인 자리에서 1:1 로 남은 것 → "수정"으로 보고 ID 계승 (유사도 ≥ 0.5)
              나머지 → 새 블록(새 ID) / 삭제
```

그래서 VS Code·`git pull`·다른 앱이 파일을 통째로 바꿔도 **편집기 안에서 고친 것과 똑같은
블록 변경**으로 바뀐다. "파일이 진실"이 유지된다.

### 6.4 서버(WebDAV)에 놓이는 모양

```
<WebDAV>/<저장소>/
├─ notes/…/a.md                    ← 평범한 마크다운 거울. 사람·다른 도구가 그대로 읽는다
├─ images/…                        ← 첨부도 평범하게
└─ .mdsync/
   ├─ format.json                  { version: 1 }
   ├─ docs/<docId>/
   │   ├─ manifest.json            ★ 유일한 공유 쓰기 파일 (If-Match)
   │   │     { rev, path, blocks: [[id, hash], …], deleted?: true,
   │   │       by: deviceId, at }
   │   └─ blocks/<hash>.md         블록 원문. 내용 주소라 덮어쓸 일 없음
   ├─ devices/<deviceId>.json      그 기기만 쓴다: { name, docs: { docId: rev }, at }
   └─ history/<docId>/<rev>.json   (선택) 지난 매니페스트 — 되돌리기용
```

`docId` 는 경로와 분리한다 — 이름 바꾸기·옮기기는 `manifest.path` 만 바뀐다.

### 6.5 한 번의 동기화

```
① 무엇이 바뀌었나
   PROPFIND Depth:1 .mdsync/devices/   → 각 기기 파일의 ETag 만 비교
   바뀐 기기 파일만 GET → 그 안의 docs 맵에서 내 기준보다 rev 가 높은 문서 = 원격 변경
   + 내 dirty 문서 (편집기가 src 를 지운 블록 / 파일 감시가 잡은 변경)

② 문서마다 (원격 변경 ∪ 로컬 변경)
   a. 새 블록 올리기: PUT blocks/<hash>.md  (If-None-Match: *  → 이미 있으면 412, 무시)
   b. GET manifest.json  → remote, etag
   c. remote.rev == base.rev  → 그냥 내 것으로 (fast-forward)
      아니면               → 3-way 병합(base, local, remote)  (6.6)
   d. PUT manifest.json  If-Match: etag
         412 → b 로 (다른 기기가 먼저 썼다)
   e. 병합 결과로 로컬 .md 다시 쓰기 (원격 블록이 있으면 GET blocks/<hash>.md)
   f. 서버의 거울 notes/…/a.md 갱신 (If-Match, 실패해도 다음 번에 다시 — 진실은 매니페스트)

③ 내 기기 파일 갱신: PUT devices/<me>.json  (나만 쓰므로 조건 없음)
```

**블록 단위인 이유가 여기서 드러난다** — 한 글자 고친 2MB 문서도 오가는 것은
블록 하나 + 매니페스트(수 KB)뿐이다.

### 6.6 병합 규칙

입력은 블록 ID 순서 목록 세 개(base / local / remote).

| 상황 | 결과 |
|---|---|
| 한쪽만 바꾼 블록 | 바뀐 쪽 |
| 서로 다른 블록을 고침 | 둘 다 반영 (노션처럼 "그냥 합쳐짐") |
| 한쪽 추가 | 그쪽의 앞 블록(이웃 ID) 뒤에 넣는다. 이웃이 지워졌으면 그 앞을 찾아 올라간다 |
| 한쪽 삭제 · 다른 쪽 수정 | **수정이 이긴다** (글이 사라지는 쪽이 더 나쁘다) |
| 순서 이동 | 이동 연산으로 보고 remote 우선, 로컬 이동은 다시 적용 |
| **같은 블록을 양쪽이 고침** | ① 블록 원문으로 글자 단위 diff3 → 겹치지 않으면 자동 병합 ② 겹치면 **두 판을 나란히 남긴다**: 로컬 블록 아래에 상대 판 블록을 `> ⚠ 동기화 충돌 — <기기> <시각>` 인용으로 넣고 알림. 파일이 평범한 md 라서 사람이 고치면 끝 |

충돌 블록을 HTML 주석이나 별도 파일이 아니라 **문서 안의 보이는 블록**으로 두는 이유:
어느 기기·어느 도구에서 열어도 보이고, 지우는 것이 곧 해결이다.

### 6.7 언제 동기화하나

| | 트리거 |
|---|---|
| 데스크톱 | 저장 직후 · 30초마다 · 창이 앞으로 올 때 · 파일 감시가 외부 변경을 잡았을 때 |
| Android | 앱이 앞으로 올 때 · 문서를 열 때 · 저장 직후 · 앱이 뒤로 갈 때 마지막 한 번. 백그라운드는 WorkManager 주기 작업(최소 15분) — 2차 |
| iOS | 같음. 백그라운드는 `BGAppRefreshTask` (OS 재량) — 2차 |
| 웹 | 탭이 보일 때 + 30초 |

WebDAV 에 푸시가 없으니 "실시간"은 아니다. 혼자 여러 기기에서 쓰는 용도(Handoff 4.3)에는
이 정도면 충분하다.

### 6.8 그 밖의 것

- **오프라인**: 로컬 큐 = "dirty 문서 목록 + base 매니페스트". 연결되면 6.5 를 돈다. 로컬은 늘 `.md` 가 먼저 쓰이므로 잃을 것이 없다
- **이미지**: 경로 그대로 `PUT`, 해시를 `devices/` 맵에 함께 적어 바뀐 것만 오간다. 문서 블록과 달리 파일 단위 LWW
- **삭제**: 매니페스트에 `deleted: true` (묘비). 블록 파일 청소는 30일 지난 묘비만, 데스크톱에서 수동 "정리"
- **git 과의 관계 (데스크톱)**: git 자동 커밋은 지금처럼 로컬 이력용으로 남긴다. `.mdsync/` 는 커밋하지 않는다. 동기화로 바뀐 파일도 다음 자동 커밋에 "동기화: <기기>" 메시지로 들어간다
- **자격증명**: 앱 비밀번호(Nextcloud 등) 권장. 데스크톱은 Windows 자격 증명 관리자, Android Keystore, iOS Keychain — 설정 INI 에 비밀번호를 쓰지 않는다
- **서버 호환성 검증 목록**: ETag 를 주는가 · `If-Match` 를 지키는가(412) · `If-None-Match: *` · 한글 경로 인코딩 · `Depth:1` PROPFIND. 대상: Nextcloud, Synology WebDAV, Apache `mod_dav`, rclone serve webdav. `If-Match` 를 안 지키는 서버는 `LOCK` 으로 대체하고, 그것도 없으면 지원하지 않는다고 말한다
- **암호화(선택, 나중)**: `blocks/*` 와 매니페스트만 암호화하면 거울 `.md` 를 끄는 것과 같이 가야 한다 — 그때 결정

### 6.9 검토했지만 지금은 안 쓰는 것: Yjs 갱신 로그

각 기기가 자기 파일에 Yjs 업데이트를 덧붙이면 WebDAV 위에서도 충돌 없는 병합이 된다.
그러나 ① 바깥에서 바뀐 `.md` 를 Yjs 연산으로 되번역해야 하고(Handoff 4.1 의 우려 그대로)
② 서버에 사람이 못 읽는 바이너리가 쌓이며 ③ 압축(GC)을 기기들이 합의해야 한다.

블록 ID 를 지금 설계대로 두면, **나중에 블록 하나 = Y.Text 하나**로 붙일 수 있다.
"같은 문단을 두 기기에서 동시에" 가 실제로 자주 일어나면 그때 6.6 의 마지막 줄만 Yjs 로 바꾼다.

***

## 7. 단계별 실행 계획

각 단계는 **통과 기준을 만족해야 다음으로 간다.**

### Phase 0 — 검증 스파이크 (1~2주)

목적: 결정을 실측으로 확정. 버리는 코드라도 좋다.

- [ ] Tiptap 최소 편집기 + `md-bridge` 시제품 (문단·제목·목록·표·코드블록·raw HTML)
- [ ] **왕복 시험**: 사용자의 실제 `.md` 말뭉치 + `normalizeMarkdown` 회귀 문서들을 열고 → 손대지 않고 저장 → **바이트 동일**
- [ ] 같은 화면을 Tauri Android 로 빌드해 **한글 입력 시험표** 수행

  | 키보드 | 시나리오 |
  |---|---|
  | 삼성 키보드 · Gboard (Android) · iOS 기본 · Windows IME | 조합 중 Enter / 조합 중 Backspace / 블록 처음에서 Backspace(앞 블록과 합치기) / 목록 항목 안 / 표 셀 안 / 조합 중 툴바 굵게 / 자동완성 단어 선택 / 붙여넣기 직후 입력 / 10만 자 문서 |

  `imeWatch.js` 를 붙여 "글자가 DOM 에 안 나타난" 사례를 수로 센다
- [ ] 같은 시험을 Milkdown 으로 한 번 (엔진이 같으니 결과도 같아야 정상 — 다르면 Tiptap 설정 문제)
- **통과 기준**: 왕복 바이트 동일 100% · IME 시험 전부 통과(또는 우회가 확인됨) · 10만 자에서 조합 한 단계 < 50ms

### Phase 1 — `editor-core` 를 Tiptap 으로 (데스크톱, 3~5주)

- [ ] `md-bridge` 완성: 원본 보존 직렬화, 블록 분할·해시, `<span style>` 색, 표 `<br />`
- [ ] 4절 표의 🔁 항목 전부. 툴바·Mermaid·이미지·링크·3모드
- [ ] 두 앱의 `App.jsx` 가 쓰는 API(`markdown`, `onChange`, `editorRef.getMarkdown`, `ctxRef`)를 **그대로 유지** → 앱 쪽 수정 최소화
- [ ] CLAUDE.md 의 MDXEditor 함정 절 정리 (사라지는 것 / 새로 생기는 것)
- **통과 기준**: 기존 헤들리스 검증 항목 전부 + 왕복 바이트 동일 + 268KB 문서 한 글자 < 50ms
- 릴리스: v0.16.0 쯤 (버전은 커밋할 때 올린다)

### Phase 2 — Android 앱 `md-mobile` (3~4주)

- [ ] `md-core` 의 `cfg(desktop)` 분리 (3절 표), `cargo check --target aarch64-linux-android`
- [ ] 앱 전용 저장소, 서랍 트리, 문서 스택, 하단 툴바(키보드 위), 갤러리 이미지 넣기
- [ ] `platform` 어댑터 (fs · 설정 · 키 저장소)
- **통과 기준**: 실기기(삼성 1대 + 픽셀 1대)에서 Phase 0 IME 시험표 재통과 · 앱 전환/종료 시 내용 유실 0

### Phase 3 — 블록 동기화 `sync-core` (4~6주)

- [ ] 6.3 ID 재연결(LCS) — **단위 시험 먼저** (삽입·삭제·이동·수정·대량 바꿈)
- [ ] 6.6 병합 — base/local/remote 조합 시험표를 표 주도 테스트로
- [ ] WebDAV 전송 + 6.8 서버 호환성 검사 ("서버 점검" 버튼으로 사용자에게도 노출)
- [ ] 데스크톱 MDSyncNote: 저장소별 동기화 설정, 상태줄(마지막 동기화·대기 중·충돌 n건)
- [ ] Android 연결
- [ ] **혼돈 시험**: 두 기기 + 데스크톱이 같은 문서를 오프라인으로 고친 뒤 순서를 바꿔 가며 연결 → 모든 기기 최종 `.md` 가 같아야 하고 글자 유실 0
- **통과 기준**: 위 혼돈 시험 + Nextcloud·Synology 두 서버에서 통과

### Phase 4 — iOS · 웹 (2~3주)

- [ ] iOS 빌드(Mac 필요), Keychain, "파일" 앱 노출
- [ ] 웹(PWA): 저장소 = WebDAV 직접 + IndexedDB 캐시. CORS 안내 문서
- **통과 기준**: iOS 한글 시험표 · 웹에서 Phase 3 혼돈 시험 한 기기로 참가

### Phase 5 — 선택

백그라운드 동기화 · 블록 단위 Yjs(6.9) · SAF 폴더 · 암호화 · 목록 항목 단위 블록

***

## 8. 위험과 대응

| 위험 | 가능성 | 대응 |
|---|---|---|
| Android 특정 키보드에서 ProseMirror 도 깨지는 경우 | 중 | Phase 0 에서 먼저 잡는다. `imeWatch` 기록 → prosemirror-view 이슈와 대조. 최후에는 그 키보드만 "조합 중 툴바 비활성" 같은 국소 우회 |
| 원본 보존 직렬화의 경계 사례 (블록 사이 빈 줄, 목록 들여쓰기, 참조 링크 정의) | 중 | 블록 사이 간격도 블록의 `src` 에 포함(앞쪽 공백), 참조 링크 정의는 별도 블록으로 취급. 말뭉치 시험으로 고정 |
| WebDAV 서버가 `If-Match` 를 안 지킴 | 중 | 6.8 서버 점검 → `LOCK` 대체 → 미지원 안내 |
| Tauri 모바일 플러그인 부족 | 중 | `platform` 어댑터 뒤로 숨겨 두었으니 필요한 것만 Kotlin/Swift 로, 막히면 Capacitor |
| 블록 ID 재연결 오판 (대량 수정 시 엉뚱한 ID 계승) | 저 | 결과가 틀려도 **내용은 잃지 않는다** — 최악은 "삭제+추가"로 보이는 것. 병합 품질만 떨어진다 |
| 데스크톱 편집기 교체로 기존 사용감 회귀 | 중 | Phase 1 에서 설정에 "이전 편집기" 스위치를 한 릴리스 동안 남긴다 |

***

## 9. 결정이 필요한 것

1. **Phase 0 결과로 Tiptap 확정** — 예상과 다르면 Milkdown(같은 엔진)으로
2. **데스크톱도 편집기를 바꾸는 데 동의하는가** (4절 끝) — 권장: 예
3. **이미지 위치**(Handoff 4.4): 동기화가 들어가면 저장소 공용 `.attachments/` 가 유리하다. Phase 3 전에 결정
4. **목표 WebDAV 서버** — 주로 쓰실 서버(Nextcloud / Synology / 기타)를 먼저 정해 그것부터 통과시킨다
5. **모바일에서 git 이력이 필요한가** — 지금 계획은 "아니오, 동기화 history 로 대신"
