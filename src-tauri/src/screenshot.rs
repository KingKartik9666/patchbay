use std::{
    io::{Cursor, Write},
    process::Command,
};

const HELPER_FLAG: &str = "--patchbay-capture-window";

/// xcap intentionally omits its own process from Windows enumeration. Capture
/// in a short-lived copy of this executable while the main event loop remains
/// free to answer Windows paint messages. No desktop-wide capture is exposed.
pub fn capture() -> Result<Vec<u8>, String> {
    let executable = std::env::current_exe().map_err(|_| "The capture helper is unavailable.")?;
    let mut command = Command::new(executable);
    command.args([HELPER_FLAG, &std::process::id().to_string()]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command
        .output()
        .map_err(|_| "The capture helper could not start.")?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    if output.stdout.len() > 64 * 1024 * 1024 || !output.stdout.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The app window could not be captured.".into());
    }
    Ok(output.stdout)
}

/// Handles only the private capture command, before Tauri creates any windows.
pub fn run_helper() -> Option<Result<(), String>> {
    let mut arguments = std::env::args().skip(1);
    if arguments.next().as_deref() != Some(HELPER_FLAG) {
        return None;
    }
    Some((|| {
        let pid = arguments
            .next()
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|pid| *pid != 0 && *pid != std::process::id())
            .ok_or("The capture target is unavailable.")?;
        if arguments.next().is_some() {
            return Err("The capture command is invalid.".into());
        }
        let window = xcap::Window::all()
            .map_err(|_| "The app window could not be captured.")?
            .into_iter()
            .find(|window| {
                window.pid().ok() == Some(pid)
                    && window
                        .title()
                        .is_ok_and(|title| title.starts_with("Patchbay"))
            })
            .ok_or("Focus the Patchbay window and try again.")?;
        let image = window
            .capture_image()
            .map_err(|_| "The app window could not be captured.")?;
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, xcap::image::ImageFormat::Png)
            .map_err(|_| "The screenshot could not be encoded.")?;
        std::io::stdout()
            .lock()
            .write_all(encoded.get_ref())
            .map_err(|_| "The screenshot could not be returned.".to_owned())
    })())
}
