//! MD Tiptap. 파일 I/O · 검색 · 감시 · PDF · 진단은 `md-core`.
//! git · 설정 · "MD Notepad 로 열기" 는 md-sync-note 에서, 명령줄 · 파일 연결은
//! md-editor 에서 가져온 모듈 그대로다.

mod cli;
mod config;
mod git;
mod open_with;
mod win_assoc;

/// 폰의 저장소 자리. 폰에서는 폴더 고르기 창이 평범한 경로를 주지 않으므로(content:// 주소)
/// 앱 데이터 폴더 아래에 저장소를 만든다. 같은 이름이 있으면 그것을 그대로 쓴다
#[tauri::command(async)]
fn app_repo_dir(app: tauri::AppHandle, name: String) -> Result<String, String> {
    use tauri::Manager;
    let safe: String = name.chars().filter(|c| !r#"\/:*?"<>|"#.contains(*c)).collect();
    let safe = if safe.trim().is_empty() { "노트".to_string() } else { safe.trim().to_string() };
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("repos").join(safe);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Obsidian 식 `[[노트]]` 가 가리키는 파일을 찾는다.
///
/// Obsidian 은 경로가 아니라 **이름**으로 잇는다. 그래서 먼저 지금 문서의 폴더를 보고,
/// 없으면 저장소들을 훑어 같은 이름의 파일을 찾는다. `[[폴더/노트]]` 처럼 경로가 섞여
/// 있으면 경로 끝이 맞는 것을 고른다. 확장자가 없으면 `.md` 를 붙여 본다.
/// 점(.)으로 시작하는 폴더(.git · .obsidian · .image …)와 node_modules 는 보지 않는다.
#[tauri::command(async)]
fn find_note(roots: Vec<String>, near: Option<String>, name: String) -> Option<String> {
    use std::path::{Path, PathBuf};
    let name = name.trim().replace('\\', "/");
    if name.is_empty() {
        return None;
    }
    let has_ext = Path::new(&name).extension().is_some();
    let wants: Vec<String> = if has_ext { vec![name.clone()] } else { vec![format!("{name}.md"), name.clone()] };
    let lower: Vec<String> = wants.iter().map(|w| w.to_lowercase()).collect();

    if let Some(dir) = near.as_deref() {
        for w in &wants {
            let p = Path::new(dir).join(w);
            if p.is_file() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }

    let hit = |p: &Path| {
        let s = p.to_string_lossy().replace('\\', "/").to_lowercase();
        lower.iter().any(|w| s == *w || s.ends_with(&format!("/{w}")))
    };
    for root in roots {
        let mut stack: Vec<PathBuf> = vec![PathBuf::from(root)];
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                let fname = e.file_name().to_string_lossy().to_string();
                if p.is_dir() {
                    if !fname.starts_with('.') && fname != "node_modules" {
                        stack.push(p);
                    }
                } else if hit(&p) {
                    return Some(p.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 설치 스크립트에서 창 없이 파일 연결만 등록/해제할 수 있게 한다
    if let Some(cmd) = cli::early_exit_command() {
        let r = if cmd == "register" { win_assoc::assoc_register() } else { win_assoc::assoc_unregister() };
        match r {
            Ok(m) => println!("{m}"),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let builder = tauri::Builder::default();

    // 이미 떠 있으면 새 창을 띄우지 않고 그 창의 탭으로 연다. MD Notepad 는 탐색기에서
    // 여러 파일을 열면 창이 여러 개 떴다 (README "아직 안 되는 것")
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        use tauri::{Emitter, Manager};
        let files = cli::md_files(argv.into_iter().skip(1));
        if !files.is_empty() {
            let _ = app.emit("open-files", files);
        }
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            // 폰은 실행 파일 자리에 쓸 수 없다 — 설정은 앱 데이터 폴더에
            #[cfg(mobile)]
            {
                use tauri::Manager;
                if let Ok(dir) = _app.path().app_data_dir() {
                    config::set_dir(dir);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            md_core::commands::read_file,
            md_core::commands::write_file,
            md_core::commands::save_binary_b64,
            md_core::commands::read_binary_base64,
            md_core::commands::read_dir,
            md_core::commands::create_dir,
            md_core::commands::create_file,
            md_core::commands::rename_path,
            md_core::commands::delete_path,
            md_core::commands::open_external,
            md_core::search::search_repo,
            md_core::watcher::watch_file,
            md_core::watcher::unwatch_file,
            md_core::pdf::save_pdf,
            git::git_status,
            git::git_init,
            git::git_commit,
            open_with::open_in_md_editor,
            open_with::md_notepad_path,
            config::config_load,
            config::config_save,
            config::config_path,
            cli::startup_file,
            win_assoc::assoc_status,
            win_assoc::assoc_register,
            win_assoc::assoc_unregister,
            md_core::diag::log_write,
            md_core::diag::log_dir,
            md_core::diag::log_tail,
            app_repo_dir,
            find_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::find_note;

    #[test]
    fn 내부_링크는_이름으로_찾는다() {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("findnote-{n}"));
        let deep = root.join("업무").join("이슈");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(root.join(".obsidian")).unwrap();
        std::fs::write(deep.join("회의 정리.md"), "x").unwrap();
        std::fs::write(root.join(".obsidian").join("숨김.md"), "x").unwrap();
        std::fs::write(root.join("그림.png"), "x").unwrap();
        let roots = vec![root.to_string_lossy().to_string()];

        // 이름만으로 · 대소문자 무시 · 경로 일부 · 확장자 있는 것
        assert!(find_note(roots.clone(), None, "회의 정리".into()).unwrap().ends_with("회의 정리.md"));
        assert!(find_note(roots.clone(), None, "이슈/회의 정리".into()).is_some());
        assert!(find_note(roots.clone(), None, "그림.png".into()).unwrap().ends_with("그림.png"));
        // 점 폴더는 보지 않는다 · 없는 것
        assert!(find_note(roots.clone(), None, "숨김".into()).is_none());
        assert!(find_note(roots.clone(), None, "없는 노트".into()).is_none());
        // 지금 문서의 폴더가 먼저
        std::fs::write(root.join("회의 정리.md"), "x").unwrap();
        let near = Some(root.to_string_lossy().to_string());
        let got = find_note(roots, near, "회의 정리".into()).unwrap();
        assert_eq!(std::path::Path::new(&got).parent().unwrap(), root.as_path());
    }
}
