# 릴리스 내는 법

버전을 올리고, 빌드하고, 배포하고, GitHub 에 올리기까지. 그리고 **릴리스 노트를
어떻게 쓰는가** — 이 문서의 절반은 그 이야기다.

---

## 릴리스 노트 규칙

### 읽는 사람은 개발자가 아니다

릴리스 페이지를 여는 사람은 **이 앱을 쓰는 사람**이다. 그 사람이 알고 싶은 것은
하나뿐이다 — **이제 무엇을 할 수 있는가.**

그래서 파일 이름·함수 이름·라이브러리 이름을 쓰지 않는다. `linkNav.js` 도,
`formatUrl()` 도, "lexical" 도 릴리스 노트에 나오면 안 된다. 그런 이야기가 갈 곳은
`Update_History.md` 다. 두 문서는 **독자가 다르다.**

| | 릴리스 노트 | `Update_History.md` |
|---|---|---|
| 읽는 사람 | 앱을 쓰는 사람 | 다음에 이 코드를 고칠 사람 |
| 담는 것 | 할 수 있게 된 일 | 왜 그렇게 고쳤는지 · 함정 · 검증 |
| 길이 | 화면 한 장 | 필요한 만큼 |

### 제목은 기능 이름이 아니라 할 수 있게 된 일

- 나쁨 — `linkNav 플러그인 추가`, `핸드오프 IPC 구현`
- 좋음 — `문서 안의 링크를 따라갑니다`, `탭을 다른 창으로 끌어 옮깁니다`

### 모양

문단 **4~5개**. 각 문단은 `##` 제목 한 줄 + 두세 문장 + 필요하면 불릿 3개까지.
그보다 길어지면 읽지 않는다.

1. 새로 된 일 — 큰 것부터. 보통 2~3개
2. 고친 것 — **`## 그 밖`** 하나로 묶는다. 한 줄씩
3. **`## 받는 법`** — 표로 파일 이름과 그게 무엇인지

### 말투

- 존댓말(`~합니다`). 문서 안의 다른 글과 달리 **바깥 사람에게 하는 말**이다
- 손짓은 굵게 — **Ctrl+누르기**, **시계 단추**
- 화면에 실제로 보이는 이름을 그대로 쓴다

### 틀

```markdown
## (할 수 있게 된 일)

(두세 문장. 어디를 누르면 되는지까지)

- (경우 1)
- (경우 2)

## (또 하나)

...

## 그 밖

- (고친 것 한 줄)
- (고친 것 한 줄)

## 받는 법

아래 두 파일은 **설치가 필요 없습니다.** 받아서 바로 실행하세요.

| 파일 | 무엇 |
|---|---|
| `MD-Notepad-portable.exe` | 탭으로 여는 마크다운 편집기 |
| `MDSyncNote-portable.exe` | 왼쪽 폴더 트리 + 노트 (git 커밋) |
```

**본보기**: [v0.13.0](https://github.com/SeanKi/md-workspace/releases/tag/v0.13.0)

---

## 절차

### 1. 버전을 올린다 — 아홉 자리가 같아야 한다

기능이 늘면 가운데를, 고치기만 했으면 끝자리를 올린다.

```
package.json
apps/md-editor/package.json          apps/md-sync-note/package.json
apps/md-editor/src-tauri/Cargo.toml  apps/md-sync-note/src-tauri/Cargo.toml
apps/md-editor/src-tauri/tauri.conf.json
apps/md-sync-note/src-tauri/tauri.conf.json
crates/md-core/Cargo.toml            packages/editor-core/package.json
```

창 제목의 버전은 `package.json` 에서 오고(`vite.config.js` 의 `__APP_VERSION__`),
실행 파일 속성의 버전은 `tauri.conf.json` 에서 온다. **어긋나면 어느 것이 도는지
알 수 없게 된다.**

### 2. 확인한다

```bat
npm run build -w md-editor
npm run build -w md-sync-note
cargo test --workspace
```

그리고 **실제로 띄워 본다.** 헤들리스 브라우저로 화면 동작까지 확인해 왔다면 그것도.

### 3. 문서에 남긴다

- `docs/Update_History.md` — 맨 아래 `## 향후 계획` **앞에** 새 절을 넣는다.
  왜 그렇게 고쳤는지와 **검증 표**까지
- `CLAUDE.md` 의 `## 지금 상태` 한 줄
- 새로 생긴 함정이 있으면 `CLAUDE.md` 의 `## 반드시 지킬 것` 에

### 4. 빌드하고 배포한다

`build-portable.bat` · `deploy.bat` 은 사람이 눌러 쓰는 것이라 `pause` 로 멈춘다.
자동으로 돌릴 때는 안에 든 명령을 직접 부른다.

```bat
npm run tauri -w md-editor    -- build --no-bundle
npm run tauri -w md-sync-note -- build --no-bundle
```

`target\release\` 의 exe 두 개를 `release-out\` 에 배포 이름으로 복사한 뒤
쓰는 자리(`C:\utility\Markdown`)로 옮긴다.

**실행 중인 exe 는 덮어쓸 수 없다.** 앱을 먼저 닫아야 하는데, 그 앱은 사람이 쓰고
있을 수 있다 — **묻고 닫는다.**

### 5. 커밋 · 태그 · 릴리스

커밋 제목은 `v0.13.0 — 요약 · 요약 · 요약`. 본문에는 **왜**를 적는다(릴리스 노트와
달리 여기는 개발자가 읽는다).

```bat
git tag -a v0.13.0 -m "v0.13.0 — …"
git push origin main
git push origin v0.13.0

gh release create v0.13.0 ^
  release-out\MD-Notepad-portable.exe release-out\MDSyncNote-portable.exe ^
  --title "v0.13.0 — 링크 따라가기 · 탭 옮기기 · 최근 문서" ^
  --notes-file <노트 파일>
```

실행 파일을 **반드시 첨부한다.** 이 앱은 설치본 없이 쓰는 것이 기본이라, 첨부가
없으면 릴리스에 아무 쓸모가 없다.
