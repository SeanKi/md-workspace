mod cli;
mod handoff;
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

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            md_core::commands::read_file,
            md_core::commands::write_file,
            md_core::commands::save_binary_b64,
            md_core::commands::read_binary_base64,
            md_core::commands::read_dir,
            md_core::commands::open_external,
            md_core::pdf::save_pdf,
            md_core::watcher::watch_file,
            md_core::watcher::unwatch_file,
            cli::startup_file,
            handoff::hand_off_tab,
            md_core::diag::log_write,
            md_core::diag::log_dir,
            md_core::diag::log_tail,
            win_assoc::assoc_status,
            win_assoc::assoc_register,
            win_assoc::assoc_unregister,
        ])
        .setup(|app| {
            // 다른 창이 탭을 넘겨줄 수 있게 우편함을 연다 (`handoff.rs`)
            handoff::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // 창이 닫히면 우편함 표시를 거둔다. tao 의 이벤트 루프는 돌아오지 않으므로
    // `run` 뒤에 적으면 실행되지 않는다 — Exit 이벤트에서 해야 한다
    app.run(|_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            handoff::cleanup();
        }
    });
}
