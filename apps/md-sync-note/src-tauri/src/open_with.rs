//! 노트를 MD Notepad(옛 이름 MD Editor)로 넘겨 연다.
//!
//! **한 자리만 보면 못 찾는다.** 처음에는 "이 앱 옆" 만 봤는데, portable 을 여기저기
//! 두는 것이 이 앱의 쓰임새라 배포 자리가 여럿이면 바로 실패했다. 그래서 세 곳을 본다.
//!
//!   1. **설정에 적어 둔 경로** — 한 번 골라 주면 그다음부터 그대로 쓴다
//!   2. **이 앱 옆** — `deploy.bat` 이 둘을 같은 폴더에 넣으므로 보통 여기서 걸린다
//!   3. **`.md` 를 여는 것으로 등록된 프로그램** — 레지스트리에 경로가 통째로 적혀
//!      있다. 다른 폴더에 두었어도 이걸로 찾힌다
//!
//! 그래도 없으면 **어디를 봤는지 말해 준다.** "찾을 수 없습니다" 만으로는 사용자가
//! 다음에 무엇을 해야 할지 알 수 없다.

use std::path::PathBuf;
use std::process::Command;

/// 옛 이름도 남겨 둬야 예전에 배포해 둔 자리에서도 열린다
const CANDIDATES: [&str; 4] = [
    "MD-Notepad-portable.exe",
    "md-notepad.exe",
    "MD-Editor-portable.exe",
    "md-editor.exe",
];

fn beside_exe() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    CANDIDATES.iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// `.md` 를 여는 것으로 등록된 프로그램의 경로.
/// 값은 `"C:\...\MD-Notepad-portable.exe" "%1"` 꼴이라 첫 따옴표 안을 꺼낸다.
#[cfg(windows)]
fn from_registry() -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for key in [
        r"Software\Classes\MDEditor.md\shell\open\command",
        r"Software\Classes\.md\shell\open\command",
    ] {
        let Ok(k) = hkcu.open_subkey(key) else { continue };
        let Ok(cmd) = k.get_value::<String, _>("") else { continue };
        let exe = match cmd.strip_prefix('"') {
            Some(rest) => rest.split('"').next().unwrap_or_default().to_string(),
            None => cmd.split_whitespace().next().unwrap_or_default().to_string(),
        };
        let p = PathBuf::from(exe);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

#[cfg(not(windows))]
fn from_registry() -> Option<PathBuf> {
    None
}

/// 설정에 적어 둔 경로가 쓸 만한가
fn from_setting(exe: Option<&str>) -> Option<PathBuf> {
    let p = PathBuf::from(exe?.trim());
    p.is_file().then_some(p)
}

fn find(exe: Option<&str>) -> Option<PathBuf> {
    from_setting(exe).or_else(beside_exe).or_else(from_registry)
}

/// 지금 찾아지는 MD Notepad 의 경로. 없으면 빈 글자.
/// 설정 화면에서 "어느 것을 쓰는지" 보여 주는 데 쓴다.
#[tauri::command(async)]
pub fn md_notepad_path(exe: Option<String>) -> String {
    find(exe.as_deref())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command(async)]
pub fn open_in_md_editor(path: String, exe: Option<String>) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err(format!("파일이 없습니다: {path}"));
    }

    let Some(app) = find(exe.as_deref()) else {
        let here = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_string_lossy().to_string()))
            .unwrap_or_else(|| "(알 수 없음)".into());
        return Err(format!(
            "MD Notepad 실행 파일을 찾지 못했습니다. 본 곳 — 설정에 적어 둔 경로 · \
             이 앱 옆({here}) · .md 연결 프로그램. 설정에서 한 번 골라 주면 기억합니다."
        ));
    };

    Command::new(&app)
        .arg(&file)
        .spawn()
        .map_err(|e| format!("{} 를 실행하지 못했습니다: {e}", app.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 없는_파일은_거절한다() {
        let e = open_in_md_editor("C:/이런/파일은/없다.md".into(), None).unwrap_err();
        assert!(e.contains("파일이 없습니다"));
    }

    #[test]
    fn 설정_경로가_먼저다() {
        // 지금 실행 중인 것(테스트 바이너리)을 가리키면 그것이 뽑혀야 한다
        let me = std::env::current_exe().unwrap();
        assert_eq!(find(Some(me.to_string_lossy().as_ref())).unwrap(), me);
    }

    #[test]
    fn 없는_설정_경로는_무시하고_다음을_본다() {
        assert!(from_setting(Some(r"C:\없는\경로\md-notepad.exe")).is_none());
        assert!(from_setting(Some("  ")).is_none());
        assert!(from_setting(None).is_none());
    }

    #[test]
    fn 옆에서_찾으면_반드시_같은_폴더다() {
        if let Some(p) = beside_exe() {
            assert_eq!(p.parent(), std::env::current_exe().unwrap().parent());
        }
    }

    #[test]
    fn 레지스트리에서_찾은_것은_실제로_있는_파일이다() {
        if let Some(p) = from_registry() {
            assert!(p.is_file(), "{} 가 없다", p.display());
        }
    }
}
