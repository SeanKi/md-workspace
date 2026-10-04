//! Windows 파일 연결(.md 우클릭 메뉴 · 연결 프로그램 목록).
//!
//! HKCU 만 건드리므로 관리자 권한이 필요 없다.
//! Windows 10 부터는 "기본 앱"을 프로그램이 마음대로 바꿀 수 없다(설정에 해시가
//! 걸려 있어 사용자가 직접 골라야만 한다). 그래서 여기서 할 수 있는 것은
//!   1. 연결 프로그램 목록에 MD Notepad 를 올리고,
//!   2. .md 우클릭 메뉴에 "MD Notepad로 열기" 를 넣는 것
//! 까지다. 기본 앱 지정은 사용자가 한 번 눌러야 한다.

use serde::Serialize;

#[derive(Serialize)]
pub struct AssocStatus {
    /// 이 플랫폼에서 파일 연결을 지원하는가
    pub supported: bool,
    /// 지금 실행 중인 exe 로 등록돼 있는가
    pub registered: bool,
    /// 레지스트리에 적혀 있는 exe (다른 빌드로 등록됐는지 확인용)
    pub registered_exe: String,
    /// 지금 실행 중인 exe
    pub current_exe: String,
}

const EXTS: [&str; 3] = [".md", ".markdown", ".mdx"];
// md-editor/win_assoc.rs 에서 가져왔다. 키 이름을 MD Notepad 와 달리 해야
// 두 앱을 함께 등록해도 서로의 등록을 덮지 않는다
const PROG_ID: &str = "MDTiptap.md";
const VERB: &str = "MDTiptap.Open";
const MENU_TEXT: &str = "MDNotePad+로 열기";
/// "기본 앱" 목록에 보일 이름과 그 설명 키 (RegisteredApplications)
const APP_NAME: &str = "MDNotePad+";
const CAPS_KEY: &str = r"Software\MDNotePadPlus\Capabilities";

fn current_exe() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::ffi::c_void;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0x0000;

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(event_id: i32, flags: u32, item1: *const c_void, item2: *const c_void);
    }

    /// 탐색기가 바뀐 연결을 바로 반영하도록 알린다. 없으면 재로그인해야 보인다.
    fn notify_shell() {
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) }
    }

    fn classes() -> Result<RegKey, String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(r"Software\Classes")
            .map(|(k, _)| k)
            .map_err(|e| e.to_string())
    }

    /// `키 경로` 를 만들고 기본값을 넣는다.
    fn set_default(root: &RegKey, path: &str, value: &str) -> Result<(), String> {
        let (k, _) = root.create_subkey(path).map_err(|e| e.to_string())?;
        k.set_value("", &value.to_string()).map_err(|e| e.to_string())
    }

    fn exe_file_name(exe: &str) -> String {
        exe.replace('/', "\\").rsplit('\\').next().unwrap_or("md-tiptap.exe").to_string()
    }

    pub fn status() -> AssocStatus {
        let current = current_exe().unwrap_or_default();
        let registered_exe = classes()
            .ok()
            .and_then(|c| c.open_subkey(format!(r"{PROG_ID}\shell\open\command")).ok())
            .and_then(|k| k.get_value::<String, _>("").ok())
            .unwrap_or_default();
        AssocStatus {
            supported: true,
            // 명령줄에 exe 경로가 그대로 들어 있으므로 포함 여부로 판정한다
            registered: !current.is_empty() && registered_exe.contains(&current),
            registered_exe,
            current_exe: current,
        }
    }

    pub fn register() -> Result<String, String> {
        let exe = current_exe()?;
        let app = exe_file_name(&exe);
        // 옵션 없이 = 단순 모드(메모장처럼)가 기본이다. 저장소·동기화는 `--sync` 로 띄운 전체 모드에서
        let command = format!("\"{exe}\" \"%1\"");
        let icon = format!("\"{exe}\",0");
        let c = classes()?;

        // 1. ProgId — 실제로 파일을 여는 방법
        set_default(&c, PROG_ID, "Markdown 문서")?;
        set_default(&c, &format!(r"{PROG_ID}\DefaultIcon"), &icon)?;
        set_default(&c, &format!(r"{PROG_ID}\shell\open\command"), &command)?;

        // 2. Applications\<exe> — "연결 프로그램" 목록에 이름과 아이콘으로 보이게
        let app_key = format!(r"Applications\{app}");
        let (k, _) = c.create_subkey(&app_key).map_err(|e| e.to_string())?;
        k.set_value("FriendlyAppName", &"MDNotePad+".to_string()).map_err(|e| e.to_string())?;
        set_default(&c, &format!(r"{app_key}\shell\open\command"), &command)?;
        let (types, _) = c
            .create_subkey(format!(r"{app_key}\SupportedTypes"))
            .map_err(|e| e.to_string())?;

        for ext in EXTS {
            // 3. 확장자 → ProgId 후보 등록 (기본 앱을 빼앗지 않는다)
            let (owp, _) = c
                .create_subkey(format!(r"{ext}\OpenWithProgids"))
                .map_err(|e| e.to_string())?;
            owp.set_value(PROG_ID, &String::new()).map_err(|e| e.to_string())?;
            types.set_value(ext, &String::new()).map_err(|e| e.to_string())?;

            // 4. 우클릭 메뉴 — 기본 앱이 무엇이든 항상 보인다
            let verb = format!(r"SystemFileAssociations\{ext}\shell\{VERB}");
            set_default(&c, &verb, MENU_TEXT)?;
            let (vk, _) = c.create_subkey(&verb).map_err(|e| e.to_string())?;
            vk.set_value("Icon", &icon).map_err(|e| e.to_string())?;
            set_default(&c, &format!(r"{verb}\command"), &command)?;
        }

        // 5. "기본 앱" 목록에 이름으로 — 설정 → 기본 앱 에 MDNotePad+ 쪽이 생겨 거기서 .md 를 고를 수 있다
        //    (choose_default 가 그 쪽을 바로 연다). 기본 앱을 정하는 건 여전히 사용자다
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (caps, _) = hkcu.create_subkey(CAPS_KEY).map_err(|e| e.to_string())?;
        caps.set_value("ApplicationName", &APP_NAME.to_string()).map_err(|e| e.to_string())?;
        caps.set_value("ApplicationDescription", &"마크다운 위지윅 편집기".to_string()).map_err(|e| e.to_string())?;
        let (fa, _) = hkcu.create_subkey(format!(r"{CAPS_KEY}\FileAssociations")).map_err(|e| e.to_string())?;
        for ext in EXTS {
            fa.set_value(ext, &PROG_ID.to_string()).map_err(|e| e.to_string())?;
        }
        let (ra, _) = hkcu.create_subkey(r"Software\RegisteredApplications").map_err(|e| e.to_string())?;
        ra.set_value(APP_NAME, &CAPS_KEY.to_string()).map_err(|e| e.to_string())?;

        notify_shell();
        Ok(format!("등록 완료 · {}", EXTS.join(" ")))
    }

    /// 설정 → 기본 앱 의 MDNotePad+ 쪽을 연다. 거기서 .md 를 눌러 이 앱으로 바꾸면 두 번 눌러 열기가 이 앱이 된다.
    /// Windows 8 부터 프로그램이 스스로 기본 앱이 될 수는 없다 (UserChoice 해시) — 사용자가 한 번 골라야 한다
    pub fn choose_default() -> Result<String, String> {
        let registered = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\RegisteredApplications")
            .and_then(|k| k.get_value::<String, _>(APP_NAME))
            .is_ok();
        let uri = if registered {
            // `+` 는 주소에서 공백으로 읽히므로 %2B
            format!("ms-settings:defaultapps?registeredAppUser={}", APP_NAME.replace('+', "%2B"))
        } else {
            "ms-settings:defaultapps".to_string()
        };
        std::process::Command::new("explorer")
            .arg(&uri)
            .spawn()
            .map_err(|e| format!("설정을 열지 못했습니다: {e}"))?;
        Ok(if registered {
            "설정이 열렸습니다 — .md 를 눌러 MDNotePad+ 를 고르세요".into()
        } else {
            "설정이 열렸습니다 — 먼저 “등록” 을 누르면 MDNotePad+ 쪽이 바로 열립니다".into()
        })
    }

    pub fn unregister() -> Result<String, String> {
        let c = classes()?;
        let app = exe_file_name(&current_exe()?);

        // 없는 키를 지우는 건 오류가 아니다 — 남은 것만 정리한다
        let _ = c.delete_subkey_all(PROG_ID);
        let _ = c.delete_subkey_all(format!(r"Applications\{app}"));
        for ext in EXTS {
            let _ = c.delete_subkey_all(format!(r"SystemFileAssociations\{ext}\shell\{VERB}"));
            if let Ok(k) = c.open_subkey_with_flags(
                format!(r"{ext}\OpenWithProgids"),
                winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
            ) {
                let _ = k.delete_value(PROG_ID);
            }
        }

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(r"Software\MDNotePadPlus");
        if let Ok(k) = hkcu.open_subkey_with_flags(r"Software\RegisteredApplications", winreg::enums::KEY_READ | winreg::enums::KEY_WRITE) {
            let _ = k.delete_value(APP_NAME);
        }

        notify_shell();
        Ok("해제 완료".into())
    }
}

#[cfg(not(windows))]
mod win {
    use super::*;
    pub fn status() -> AssocStatus {
        AssocStatus {
            supported: false,
            registered: false,
            registered_exe: String::new(),
            current_exe: current_exe().unwrap_or_default(),
        }
    }
    pub fn register() -> Result<String, String> {
        Err("Windows 에서만 지원합니다.".into())
    }
    pub fn unregister() -> Result<String, String> {
        Err("Windows 에서만 지원합니다.".into())
    }
    pub fn choose_default() -> Result<String, String> {
        Err("Windows 에서만 지원합니다.".into())
    }
}

#[tauri::command]
pub fn assoc_status() -> AssocStatus {
    win::status()
}

#[tauri::command]
pub fn assoc_register() -> Result<String, String> {
    win::register()
}

#[tauri::command]
pub fn assoc_unregister() -> Result<String, String> {
    win::unregister()
}

#[tauri::command]
pub fn assoc_choose_default() -> Result<String, String> {
    win::choose_default()
}
