mod cli;
mod win_assoc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 설치 스크립트에서 창 없이 파일 연결만 등록/해제할 수 있게 한다.
    if let Some(cmd) = cli::early_exit_command() {
        let r = if cmd == "register" {
            win_assoc::assoc_register()
        } else {
            win_assoc::assoc_unregister()
        };
        match r {
            Ok(m) => println!("{m}"),
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            md_core::commands::read_file,
            md_core::commands::write_file,
            md_core::commands::save_binary_b64,
            md_core::commands::read_binary_base64,
            md_core::commands::read_dir,
            md_core::pdf::save_pdf,
            md_core::watcher::watch_file,
            md_core::watcher::unwatch_file,
            cli::startup_file,
            win_assoc::assoc_status,
            win_assoc::assoc_register,
            win_assoc::assoc_unregister,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
