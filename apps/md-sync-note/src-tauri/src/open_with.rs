//! 노트를 MD Editor 로 넘겨 연다.
//!
//! 두 앱은 배포 스크립트가 **같은 폴더에** 넣는다(`deploy.bat` → `C:\utility\Markdown`).
//! 그래서 지금 실행 파일 옆을 본다. 개발 중에는 `target/debug` 가 그 자리다.
//! 경로를 레지스트리나 설정에서 찾지 않는 이유 — 옆에 두는 것이 이 저장소의 배포
//! 방식이고, 설정을 하나 더 두면 그것이 낡는다.

use std::path::PathBuf;
use std::process::Command;

/// portable 빌드는 이름이 다르다 (`build-portable.bat` 참고)
const CANDIDATES: [&str; 2] = ["md-editor.exe", "MD-Editor-portable.exe"];

fn find_editor() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    CANDIDATES.iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

#[tauri::command]
pub fn open_in_md_editor(path: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(format!("파일이 없습니다: {path}"));
    }
    let exe = find_editor().ok_or(
        "MD Editor 실행 파일을 옆에서 찾지 못했습니다. 두 앱이 같은 폴더에 있어야 합니다.",
    )?;
    Command::new(&exe)
        .arg(&file)
        .spawn()
        .map_err(|e| format!("MD Editor 를 실행하지 못했습니다: {e}"))?;
    Ok(())
}

/// 실행 파일이 옆에 있는가. 메뉴에 항목을 보일지 정하는 데 쓴다.
#[tauri::command]
pub fn has_md_editor() -> bool {
    find_editor().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 없는_파일은_거절한다() {
        let e = open_in_md_editor("C:/이런/파일은/없다.md".into()).unwrap_err();
        assert!(e.contains("파일이 없습니다"));
    }

    #[test]
    fn 후보_이름은_실행_파일_옆에서만_찾는다() {
        // 찾았다면 반드시 지금 실행 파일과 같은 폴더여야 한다
        if let Some(p) = find_editor() {
            let here = std::env::current_exe().unwrap();
            assert_eq!(p.parent(), here.parent());
        }
    }
}
