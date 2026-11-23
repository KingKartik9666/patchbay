use crate::launch;
use serde::Serialize;
use tauri::{AppHandle, WebviewWindow, WebviewWindowBuilder, utils::config::Color};

const OPAQUE_FLAG: &str = "PATCHBAY_OPAQUE";

/// What the native window material actually is. The page stays opaque unless
/// `kind` is "mica", which is reported only after DWM accepted the backdrop.
#[derive(Clone, Debug, Serialize)]
pub struct Backdrop {
    pub kind: &'static str,
    pub reason: Option<String>,
}
impl Default for Backdrop {
    fn default() -> Self {
        Self {
            kind: "none",
            reason: None,
        }
    }
}

/// Transparency is fixed when the window is created, so decide before
/// building it. Windows 10 gets an ordinary opaque window instead of a
/// see-through one with no backdrop behind it.
fn translucency() -> Result<(), String> {
    if std::env::var_os(OPAQUE_FLAG).is_some() {
        return Err(format!("{OPAQUE_FLAG} is set."));
    }
    #[cfg(windows)]
    {
        // The same build gate window-vibrancy uses for apply_mica.
        if windows_version::OsVersion::current().build >= 22000 {
            Ok(())
        } else {
            Err("Window material needs Windows 11.".into())
        }
    }
    #[cfg(not(windows))]
    Err("Window material is available only on Windows 11.".into())
}

/// Builds the main window from its `create: false` config. Must run on the
/// main thread (Tauri's setup hook does) so Mica can be applied directly and
/// its result kept: Tauri's own window effects discard failures.
pub fn create_main_window(app: &AppHandle) -> tauri::Result<(WebviewWindow, Backdrop)> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    // The saved theme and launch variant are known before the window exists,
    // so the first frame WebView2 paints is already themed (and, when the
    // launch plays, already its first frame). No session path is a first run.
    let hint = crate::commands::session_path(app)
        .map(|path| launch::hint(&path))
        .unwrap_or_default();
    let mode = launch::mode(&hint, env!("CARGO_PKG_VERSION"));
    let support = translucency();
    config.transparent = support.is_ok();
    if config.transparent {
        // The pre-paint fill drops alpha, so a colour here would sit behind
        // Mica as opaque-looking pixels. Without one the fill is clear.
        config.background_color = None;
    } else {
        // Opaque: the theme's --mask, which is also the launch ground.
        let [r, g, b] = launch::mask(hint.theme);
        config.background_color = Some(Color(r, g, b, 255));
    }
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(launch::script(&hint, mode))
        .build()?;
    // Before Mica, so the tint matches the page from the first frame.
    pin_theme(&window, hint.theme);
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut backdrop = Backdrop {
        kind: "none",
        reason: support.err(),
    };
    #[cfg(windows)]
    if config.transparent {
        // Leave the tint to the window theme (set_theme) rather than fixing
        // it here, so light and dark switch without re-applying the backdrop.
        match window_vibrancy::apply_mica(&window, None) {
            Ok(()) => backdrop.kind = "mica",
            Err(error) => backdrop.reason = Some(error.to_string()),
        }
    }
    Ok((window, backdrop))
}

/// Pins the native theme so the Mica tint and WebView2's colour scheme follow
/// the app instead of the OS.
pub fn pin_theme(window: &WebviewWindow, theme: &str) {
    let theme = if theme == "dark" {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    };
    // A failed theme request only leaves the OS tint in place.
    let _ = window.set_theme(Some(theme));
}
