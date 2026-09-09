//! 지금 열려 있는 문서를 PDF 파일로 저장한다.
//!
//! WebView2 의 `PrintToPdf` 를 부른다. 인쇄 대화상자가 뜨지 않고 파일이 바로
//! 만들어진다. 중요한 것은 **화면이 아니라 인쇄용 규칙(`@media print`)으로
//! 그려진다**는 점이다. 그래서 툴바·탭·표 손잡이가 빠지고, 화면에서 전체 폭을
//! 쓰고 있어도 PDF 는 항상 같은(고정 폭) 모양으로 나온다.
//! 짝이 되는 CSS 는 `packages/editor-core/src/editor.css` 의 `@media print` 절이다.

/// A4 세로. WebView2 설정은 인치 단위다.
#[cfg(windows)]
const PAGE_W: f64 = 8.27;
#[cfg(windows)]
const PAGE_H: f64 = 11.69;
#[cfg(windows)]
const MARGIN: f64 = 0.5;

// **반드시 `(async)` 여야 한다.** 아래에서 `recv_timeout` 으로 기다리는데, 이 커맨드가
// 메인 스레드에서 돌면 PrintToPdf 의 완료 알림이 그 메인 스레드로 오지 못해
// 자기가 기다리는 것을 자기가 막는다. 실제 기록에 남은 모습 —
//
//     오류  save_pdf — PDF 저장이 시간 안에 끝나지 않았습니다.
//     느림  save_pdf 120119ms — …OKC_MES_설정가이드.pdf
#[cfg(windows)]
#[tauri::command(async)]
pub fn save_pdf(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let tx_start = tx.clone();

    // 클로저는 메인 스레드에서 돌고, 커맨드 자체는 작업 스레드(위의 `async`)라
    // 여기서 기다려도 메인 스레드를 막지 않는다.
    window
        .with_webview(move |webview| {
            if let Err(e) = unsafe { win::start(&webview, &path, tx.clone()) } {
                let _ = tx_start.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;

    rx.recv_timeout(Duration::from_secs(120))
        .map_err(|_| "PDF 저장이 시간 안에 끝나지 않았습니다.".to_string())?
}

#[cfg(not(windows))]
#[tauri::command]
pub fn save_pdf(_window: tauri::WebviewWindow, _path: String) -> Result<(), String> {
    Err("PDF 저장은 Windows 에서만 지원합니다.".into())
}

#[cfg(windows)]
mod win {
    use super::{MARGIN, PAGE_H, PAGE_W};
    use std::sync::mpsc::Sender;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_2, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    /// PDF 생성을 시작한다. 완료는 핸들러가 채널로 알려 준다.
    pub unsafe fn start(
        webview: &tauri::webview::PlatformWebview,
        path: &str,
        done: Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let err = |e: windows::core::Error| e.to_string();

        let core = webview.controller().CoreWebView2().map_err(err)?;

        // 인쇄 설정 — 배경색을 켜야 표 머리글의 바탕색이 PDF 에 남는다
        let env = core.cast::<ICoreWebView2_2>().map_err(err)?.Environment().map_err(err)?;
        let settings = env
            .cast::<ICoreWebView2Environment6>()
            .map_err(err)?
            .CreatePrintSettings()
            .map_err(err)?;
        settings.SetShouldPrintBackgrounds(true).map_err(err)?;
        settings.SetShouldPrintHeaderAndFooter(false).map_err(err)?;
        settings.SetPageWidth(PAGE_W).map_err(err)?;
        settings.SetPageHeight(PAGE_H).map_err(err)?;
        settings.SetMarginTop(MARGIN).map_err(err)?;
        settings.SetMarginBottom(MARGIN).map_err(err)?;
        settings.SetMarginLeft(MARGIN).map_err(err)?;
        settings.SetMarginRight(MARGIN).map_err(err)?;

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
            let _ = done.send(match (result, ok) {
                (Ok(()), true) => Ok(()),
                (Err(e), _) => Err(e.to_string()),
                (_, false) => Err("WebView2 가 PDF 를 만들지 못했습니다.".into()),
            });
            Ok(())
        }));

        core.cast::<ICoreWebView2_7>()
            .map_err(err)?
            .PrintToPdf(&HSTRING::from(path), &settings, &handler)
            .map_err(err)
    }
}
