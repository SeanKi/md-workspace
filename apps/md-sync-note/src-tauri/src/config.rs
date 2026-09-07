//! 환경 정보를 **실행 파일 옆 `MDSyncNote.ini`** 에 둔다.
//!
//! 여태 브라우저의 localStorage 에 있었다. 그건 WebView2 의 사용자 데이터 폴더 안에
//! 숨어 있어서 **어디에 있는지 알 수 없고, 지우면 같이 날아가고, 다른 기기로 옮길 수도
//! 없다.** portable 로 쓰는 앱이니 설정도 실행 파일을 따라다녀야 한다.
//!
//! INI 를 고른 이유는 사람이 메모장으로 열어 고칠 수 있어서다. 형식은 고전적인 그대로 —
//! 값에 이스케이프가 없다. 그래서 `C:\노트` 같은 경로가 있는 그대로 들어간다.
//!
//! ```ini
//! [settings]
//! autoSaveSec = 60
//!
//! [repo.1]
//! name = 노트
//! path = C:\notes
//! ```

use std::collections::BTreeMap;
use std::path::PathBuf;

pub type Ini = BTreeMap<String, BTreeMap<String, String>>;

const FILE: &str = "MDSyncNote.ini";

fn path_of() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("실행 파일 자리를 알 수 없습니다: {e}"))?;
    let dir = exe.parent().ok_or("실행 파일의 상위 폴더가 없습니다")?;
    Ok(dir.join(FILE))
}

/// 사람이 손으로 고친 파일도 받아들인다 — 주석(`;` `#`), 빈 줄, 낯선 줄은 넘긴다.
fn parse(text: &str) -> Ini {
    let mut out: Ini = Ini::new();
    let mut section = String::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = name.trim().to_string();
            out.entry(section.clone()).or_default();
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        out.entry(section.clone())
            .or_default()
            .insert(k.trim().to_string(), v.trim().to_string());
    }
    out
}

fn render(data: &Ini) -> String {
    let mut s = String::from("; MDSyncNote 환경 설정. 앱을 닫은 뒤 고치세요.\n");
    for (section, kv) in data {
        s.push_str(&format!("\n[{section}]\n"));
        for (k, v) in kv {
            // 줄바꿈이 들어가면 파일이 깨진다. 값에 이스케이프가 없는 형식이라 막는다
            s.push_str(&format!("{k} = {}\n", v.replace(['\r', '\n'], " ")));
        }
    }
    s
}

/// 설정 파일이 있을 자리. 없어도 경로는 돌려준다(화면에 보여 주려고).
#[tauri::command]
pub fn config_path() -> Result<String, String> {
    Ok(path_of()?.to_string_lossy().to_string())
}

/// 없으면 빈 것을 돌려준다 — 처음 실행이 오류일 이유가 없다.
#[tauri::command]
pub fn config_load() -> Result<Ini, String> {
    let p = path_of()?;
    match std::fs::read_to_string(&p) {
        Ok(text) => Ok(parse(text.trim_start_matches('\u{feff}'))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Ini::new()),
        Err(e) => Err(format!("{} 를 읽지 못했습니다: {e}", p.display())),
    }
}

/// 통째로 다시 쓴다. 설정은 작고, 조각내 고치면 사람이 손댄 파일과 어긋난다.
#[tauri::command]
pub fn config_save(data: Ini) -> Result<String, String> {
    let p = path_of()?;
    std::fs::write(&p, render(&data))
        .map_err(|e| format!("{} 에 쓰지 못했습니다: {e}", p.display()))?;
    Ok(p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ini(pairs: &[(&str, &[(&str, &str)])]) -> Ini {
        pairs
            .iter()
            .map(|(s, kv)| {
                (s.to_string(),
                 kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect())
            })
            .collect()
    }

    #[test]
    fn 쓰고_읽으면_그대로다() {
        let a = ini(&[
            ("settings", &[("autoSaveSec", "60"), ("wideLayout", "false")]),
            ("repo.1", &[("name", "노트"), ("path", r"C:\내 문서\notes")]),
        ]);
        assert_eq!(parse(&render(&a)), a, "역슬래시와 한글이 그대로 살아야 한다");
    }

    #[test]
    fn 사람이_고친_파일도_읽는다() {
        let got = parse("; 주석\n# 또 주석\n\n[settings]\n  autoSaveSec=30  \n낯선 줄\n[repo.1]\npath = D:\\a b\n");
        assert_eq!(got["settings"]["autoSaveSec"], "30", "공백은 다듬는다");
        assert_eq!(got["repo.1"]["path"], "D:\\a b", "값 안의 공백은 살린다");
        assert!(!got.contains_key("낯선 줄"));
    }

    #[test]
    fn 값에_줄바꿈이_들어가도_파일이_깨지지_않는다() {
        let a = ini(&[("settings", &[("x", "한\n줄")])]);
        assert_eq!(parse(&render(&a))["settings"]["x"], "한 줄");
    }

    #[test]
    fn 없는_파일은_빈_것이지_오류가_아니다() {
        // 실제 파일이 없을 때의 동작. 있으면 그대로 읽히므로 둘 다 오류가 아니어야 한다
        assert!(config_load().is_ok());
    }
}
