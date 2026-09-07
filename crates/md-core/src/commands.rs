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
