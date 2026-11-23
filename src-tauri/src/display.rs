//! The refresh rate of the monitor the window is on. The frontend paces every
//! animation with requestAnimationFrame (vsync), so this value never sets the
//! pace: it labels the Settings row ("Match display · 144 Hz") and lets the
//! frame clock cross-check what it measures.

use serde::Serialize;
use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent};

/// Emitted to the page whenever the detected value changes.
pub const EVENT: &str = "display-refresh";
/// Moves arrive continuously while a window is dragged; detect once it rests.
const MOVE_SETTLE: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// The current mode's refresh rate in Hz, or 0 when unknown. On a variable
    /// refresh display this is the mode's maximum, which is what vsync targets.
    pub refresh_hz: u32,
    /// "win32" when the OS answered, "unknown" otherwise.
    pub source: &'static str,
    /// The GDI device name (for example `\\.\DISPLAY1`), for diagnostics.
    pub device: Option<String>,
}
impl Default for DisplayInfo {
    fn default() -> Self {
        Self {
            refresh_hz: 0,
            source: "unknown",
            device: None,
        }
    }
}

/// `dmDisplayFrequency` reports 0 or 1 for "hardware default"; neither is a
/// rate. Anything above 1000 Hz is not a real mode either.
pub fn normalise_frequency(raw: u32) -> u32 {
    if raw <= 1 || raw > 1000 { 0 } else { raw }
}

/// The last value sent to the page and the generation of the latest move.
#[derive(Default)]
pub struct DisplayState {
    last: Mutex<Option<DisplayInfo>>,
    moves: AtomicU64,
}

pub fn detect(window: &WebviewWindow) -> DisplayInfo {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        return win32::detect(hwnd.0);
    }
    #[cfg(not(windows))]
    let _ = window;
    DisplayInfo::default()
}

#[cfg(windows)]
mod win32 {
    use super::{DisplayInfo, normalise_frequency};
    use windows_sys::Win32::Graphics::Gdi::{
        DEVMODEW, ENUM_CURRENT_SETTINGS, EnumDisplaySettingsW, GetMonitorInfoW,
        MONITOR_DEFAULTTONEAREST, MONITORINFO, MONITORINFOEXW, MonitorFromWindow,
    };

    pub fn detect(hwnd: *mut core::ffi::c_void) -> DisplayInfo {
        // SAFETY: plain Win32 queries on our own live window handle. Both
        // structs are zeroed and carry their own size, as the APIs require;
        // szDevice is NUL-terminated by GetMonitorInfoW on success.
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if monitor.is_null() {
                return DisplayInfo::default();
            }
            let mut info: MONITORINFOEXW = core::mem::zeroed();
            info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
            if GetMonitorInfoW(monitor, (&raw mut info).cast::<MONITORINFO>()) == 0 {
                return DisplayInfo::default();
            }
            let length = info
                .szDevice
                .iter()
                .position(|&unit| unit == 0)
                .unwrap_or(info.szDevice.len());
            let device = String::from_utf16_lossy(&info.szDevice[..length]);
            let mut mode: DEVMODEW = core::mem::zeroed();
            mode.dmSize = size_of::<DEVMODEW>() as u16;
            let ok = EnumDisplaySettingsW(info.szDevice.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode);
            let refresh_hz = if ok == 0 {
                0
            } else {
                normalise_frequency(mode.dmDisplayFrequency)
            };
            DisplayInfo {
                refresh_hz,
                source: if refresh_hz > 0 { "win32" } else { "unknown" },
                device: Some(device),
            }
        }
    }
}

/// Re-detects for the main window and emits only when the value changed.
fn refresh(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let info = detect(&window);
    let state = app.state::<DisplayState>();
    let Ok(mut last) = state.last.lock() else {
        return;
    };
    if last.as_ref() == Some(&info) {
        return;
    }
    *last = Some(info.clone());
    drop(last);
    // A page that is still loading picks the value up from Startup instead.
    let _ = app.emit(EVENT, info);
}

/// Records what the page was told (Startup or the command), so events fire
/// only for real changes.
pub fn remember(app: &AppHandle, info: &DisplayInfo) {
    if let Ok(mut last) = app.state::<DisplayState>().last.lock() {
        *last = Some(info.clone());
    }
}

/// Moving to another monitor, a DPI change (which accompanies most monitor
/// changes) and regaining focus (a mode change made in Windows Settings while
/// the app was in the background) all re-detect. Moves are debounced by a
/// generation counter so a drag across the desktop detects once.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let app = window.app_handle().clone();
    match event {
        WindowEvent::Moved(_) => {
            let generation = app
                .state::<DisplayState>()
                .moves
                .fetch_add(1, Ordering::SeqCst)
                + 1;
            std::thread::spawn(move || {
                std::thread::sleep(MOVE_SETTLE);
                if app.state::<DisplayState>().moves.load(Ordering::SeqCst) == generation {
                    refresh(&app);
                }
            });
        }
        WindowEvent::ScaleFactorChanged { .. } | WindowEvent::Focused(true) => refresh(&app),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hardware_default_and_nonsense_frequencies_are_unknown() {
        assert_eq!(normalise_frequency(0), 0);
        assert_eq!(normalise_frequency(1), 0);
        assert_eq!(normalise_frequency(1001), 0);
        assert_eq!(normalise_frequency(u32::MAX), 0);
    }

    #[test]
    fn real_refresh_rates_pass_through() {
        for hz in [
            24, 30, 48, 50, 59, 60, 75, 90, 100, 120, 144, 165, 175, 240, 360, 500,
        ] {
            assert_eq!(normalise_frequency(hz), hz);
        }
    }

    #[test]
    fn unknown_display_serialises_for_the_page() {
        let value = serde_json::to_value(DisplayInfo::default()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "refreshHz": 0, "source": "unknown", "device": null })
        );
        let value = serde_json::to_value(DisplayInfo {
            refresh_hz: 144,
            source: "win32",
            device: Some(r"\\.\DISPLAY1".into()),
        })
        .unwrap();
        assert_eq!(value["refreshHz"], 144);
        assert_eq!(value["device"], r"\\.\DISPLAY1");
    }
}
