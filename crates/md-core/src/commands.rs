//! 공용 Tauri 커맨드 구현.
//!
//! `#[tauri::command]` 가 만드는 보조 매크로가 크레이트 루트와
//! 충돌하므로 반드시 별도 모듈에 둔다.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::path::Path;

// 무거운 일은 **스레드 풀로 보낸다** — `#[tauri::command(async)]`.
// Tauri 는 그냥 `#[tauri::command]` 를 **메인 스레드에서** 돌린다
// (매크로의 ExecutionContext::Blocking → "sync"). 파일을 읽고 쓰는 동안 창이
// 통째로 멎고, 글자를 치던 중이면 한글 조합 글자까지 화면에 안 나타난다.
// `(async)` 를 붙이면 "sync_threadpool" 로 간다. 함수는 그대로 동기 함수다.

#[tauri::command(async)]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    if let Some(dir) = Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // 쓰기 **전에** 알려야 한다. 쓰고 나서 알리면 감시 스레드가 먼저 깨어
    // "밖에서 바뀌었다" 고 판정해 버린다 (watcher.rs 참고)
    crate::watcher::expect_write(&path, contents.as_bytes());
    std::fs::write(&path, &contents).map_err(|e| e.to_string())?;
    Ok(())
}

/// 붙여넣은 이미지를 저장한다. 상위 폴더가 없으면 만든다.
#[tauri::command(async)]
pub fn save_binary_b64(path: String, b64: String) -> Result<(), String> {
    let bytes = STANDARD.decode(b64.as_bytes()).map_err(|e| e.to_string())?;
    if let Some(dir) = Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// WebView 는 file:// 을 직접 읽지 못하므로 화면 표시용으로 바이트를 넘겨준다.
#[tauri::command(async)]
pub fn read_binary_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

/* ---------- 문서 안의 링크 (linkNav.js) ---------- */

/// 눌렀다고 실행해 줄 수는 없는 것들. 문서는 남이 준 것일 수 있다 —
/// `[보고서](setup.exe)` 를 눌렀다고 프로그램이 돌면 안 된다.
const RISKY: [&str; 16] = [
    "exe", "bat", "cmd", "com", "scr", "pif", "msi", "msp", "hta", "cpl", "lnk", "reg", "ps1",
    "vbs", "vbe", "wsf",
];

/// 여는 주소 — `http` · `https` · `mailto` 만. `javascript:` 같은 것은 막는다
const SAFE_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// `주소:` 의 스킴. `C:\...` 는 드라이브지 스킴이 아니므로(한 글자) 걸리지 않는다.
fn scheme_of(s: &str) -> Option<String> {
    let head = s.split_once(':')?.0;
    if head.len() < 2 || !head.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    if !head.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
        return None;
    }
    Some(head.to_lowercase())
}

/// 이 앱이 열지 않는 링크(웹 주소 · PDF · 그림)를 운영체제에 넘긴다.
/// 마크다운 링크는 `linkNav.js` 가 먼저 갈라서 `.md` 는 여기로 오지 않는다.
#[tauri::command(async)]
pub fn open_external(target: String) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("빈 주소입니다".into());
    }
    match scheme_of(t) {
        Some(s) if SAFE_SCHEMES.contains(&s.as_str()) => {}
        Some(s) => return Err(format!("{s}: 로 시작하는 주소는 열지 않습니다")),
        None => {
            let ext = Path::new(t)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if RISKY.contains(&ext.as_str()) {
                return Err(format!(".{ext} 파일은 링크로 실행하지 않습니다"));
            }
            if !Path::new(t).exists() {
                return Err(format!("파일이 없습니다: {t}"));
            }
        }
    }
    sys_open(t)
}

#[cfg(windows)]
fn sys_open(target: &str) -> Result<(), String> {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            op: *const u16,
            file: *const u16,
            params: *const u16,
            dir: *const u16,
            show: i32,
        ) -> isize;
    }

    let wide = |s: &str| OsStr::new(s).encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (op, file) = (wide("open"), wide(target));
    // ShellExecuteW 는 성공하면 32 보다 큰 값을 준다 (옛 HINSTANCE 자리)
    let r = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1, // SW_SHOWNORMAL
        )
    };
    if r > 32 {
        Ok(())
    } else {
        Err(format!("열 수 없습니다 (코드 {r}): {target}"))
    }
}

#[cfg(not(windows))]
fn sys_open(_target: &str) -> Result<(), String> {
    Err("이 플랫폼에서는 지원하지 않습니다".into())
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 폴더 한 단계만 읽는다. 트리는 펼칠 때마다 이 커맨드를 호출한다(지연 로딩).
/// 숨김 항목은 건너뛰고, 파일은 마크다운만 돌려준다.
#[tauri::command(async)]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            let lower = name.to_lowercase();
            if !(lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".mdx")) {
                continue;
            }
        }
        out.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/* ---------- 파일·폴더 만들기 / 이름 바꾸기 / 지우기 ---------- */

/// 이미 있는 것을 덮어쓰지 않는다. 트리에서 만드는 동작은 "새로" 만드는 것이지
/// 남의 파일을 지우는 것이 아니다.
fn must_not_exist(path: &str) -> Result<(), String> {
    if Path::new(path).exists() {
        return Err("같은 이름이 이미 있습니다.".into());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn create_dir(path: String) -> Result<(), String> {
    must_not_exist(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// 빈 노트를 만든다. 상위 폴더가 없으면 함께 만든다.
#[tauri::command(async)]
pub fn create_file(path: String, contents: Option<String>) -> Result<(), String> {
    must_not_exist(&path)?;
    if let Some(dir) = Path::new(&path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents.unwrap_or_default()).map_err(|e| e.to_string())
}

/// 이름 바꾸기 · 옮기기. 대상이 이미 있으면 거부한다 —
/// std::fs::rename 은 조용히 덮어쓰기 때문에 여기서 막아야 한다.
#[tauri::command(async)]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if !Path::new(&from).exists() {
        return Err("원본이 없습니다.".into());
    }
    // 대소문자만 바꾸는 경우(Windows 에서 같은 파일)는 통과시킨다
    if from.to_lowercase() != to.to_lowercase() {
        must_not_exist(&to)?;
    }
    if let Some(dir) = Path::new(&to).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// **휴지통으로** 보낸다. 영영 지우지 않는다 — 트리에서 잘못 누르는 일은 반드시 생긴다.
#[tauri::command(async)]
pub fn delete_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("없는 경로입니다.".into());
    }
    trash::delete(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> String {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("mdcrud-{tag}-{n}"));
        std::fs::create_dir_all(&p).unwrap();
        p.to_string_lossy().to_string()
    }

    #[test]
    fn 폴더와_노트를_만든다() {
        let root = tmp_dir("make");
        let dir = format!("{root}/새 폴더");
        create_dir(dir.clone()).unwrap();
        assert!(Path::new(&dir).is_dir());

        let note = format!("{dir}/새 노트.md");
        create_file(note.clone(), None).unwrap();
        assert!(Path::new(&note).is_file());
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "");
    }

    #[test]
    fn 같은_이름이_있으면_덮어쓰지_않는다() {
        let root = tmp_dir("dup");
        let note = format!("{root}/a.md");
        create_file(note.clone(), Some("원본".into())).unwrap();

        assert!(create_file(note.clone(), Some("새것".into())).is_err());
        assert!(create_dir(note.clone()).is_err());
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "원본", "원본이 살아 있어야 한다");
    }

    #[test]
    fn 이름을_바꾼다_대상이_있으면_거부한다() {
        let root = tmp_dir("rename");
        let a = format!("{root}/a.md");
        let b = format!("{root}/b.md");
        let c = format!("{root}/c.md");
        create_file(a.clone(), Some("가".into())).unwrap();
        create_file(c.clone(), Some("다".into())).unwrap();

        rename_path(a.clone(), b.clone()).unwrap();
        assert!(!Path::new(&a).exists() && Path::new(&b).is_file());

        // 이미 있는 이름으로는 못 바꾼다 (fs::rename 은 그냥 덮어쓴다)
        assert!(rename_path(b.clone(), c.clone()).is_err());
        assert_eq!(std::fs::read_to_string(&c).unwrap(), "다", "덮어쓰지 않았다");
        assert!(rename_path(format!("{root}/없음.md"), b.clone()).is_err());
    }

    /// 문서는 남이 준 것일 수 있다. 눌렀다고 무엇이든 실행해 주면 안 된다.
    /// (여는 데 성공하는 쪽은 실제로 브라우저가 떠 버리므로 테스트하지 않는다)
    #[test]
    fn 위험한_링크는_열지_않는다() {
        for bad in ["setup.exe", "C:/tmp/a.bat", "x.LNK", "note.ps1"] {
            let e = open_external(bad.into()).unwrap_err();
            assert!(e.contains("실행하지 않습니다"), "{bad} — {e}");
        }
        assert!(open_external("javascript:alert(1)".into())
            .unwrap_err()
            .contains("열지 않습니다"));
        assert!(open_external("C:/이런/파일은/없다.pdf".into())
            .unwrap_err()
            .contains("파일이 없습니다"));
    }

    #[test]
    fn 드라이브_문자는_스킴이_아니다() {
        assert_eq!(scheme_of("https://a.com"), Some("https".into()));
        assert_eq!(scheme_of(r"C:\문서\a.md"), None);
        assert_eq!(scheme_of("images/a.png"), None);
    }

    /// 휴지통으로 보낸다. 테스트가 남기는 것은 임시 파일 하나뿐이다.
    #[test]
    fn 지우면_휴지통으로_간다() {
        let root = tmp_dir("trash");
        let note = format!("{root}/버릴 노트.md");
        create_file(note.clone(), Some("x".into())).unwrap();

        delete_path(note.clone()).unwrap();
        assert!(!Path::new(&note).exists(), "원래 자리에서는 사라진다");
        assert!(delete_path(note).is_err(), "없는 경로는 오류");
    }
}
