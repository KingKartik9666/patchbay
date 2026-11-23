use std::{
    io::{Cursor, Write},
    process::Command,
};

const HELPER_FLAG: &str = "--patchbay-capture-window";
// The page's opaque --mask colours. A translucent window's system backdrop
// is not part of the captured pixels, so anything left transparent is laid
// over the colour the page itself uses when it is solid.
const LIGHT_MASK: [u8; 3] = [0xec, 0xee, 0xf2]; // Pearl --mask #ECEEF2
const DARK_MASK: [u8; 3] = [0x0c, 0x0d, 0x0d]; // Night --mask #0C0D0D

/// xcap intentionally omits its own process from Windows enumeration. Capture
/// in a short-lived copy of this executable while the main event loop remains
/// free to answer Windows paint messages. No desktop-wide capture is exposed.
pub fn capture(theme: Option<tauri::Theme>) -> Result<Vec<u8>, String> {
    let executable = std::env::current_exe().map_err(|_| "The capture helper is unavailable.")?;
    let mut command = Command::new(executable);
    command.args([HELPER_FLAG, &std::process::id().to_string()]);
    match theme {
        Some(tauri::Theme::Dark) => {
            command.arg("dark");
        }
        Some(tauri::Theme::Light) => {
            command.arg("light");
        }
        _ => {}
    }
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
        let background = match arguments.next().as_deref() {
            None | Some("light") => LIGHT_MASK,
            Some("dark") => DARK_MASK,
            Some(_) => return Err("The capture command is invalid.".into()),
        };
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
        let mut image = window
            .capture_image()
            .map_err(|_| "The app window could not be captured.")?;
        flatten(&mut image, background);
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

/// Composites straight-alpha RGBA pixels over an opaque background so the PNG
/// never shows a transparent or black frame where the backdrop was.
fn flatten(pixels: &mut [u8], background: [u8; 3]) {
    for pixel in pixels.as_chunks_mut::<4>().0 {
        let alpha = u32::from(pixel[3]);
        if alpha == 255 {
            continue;
        }
        for (channel, back) in pixel[..3].iter_mut().zip(background) {
            let blended =
                (u32::from(*channel) * alpha + u32::from(back) * (255 - alpha) + 127) / 255;
            *channel = blended as u8;
        }
        pixel[3] = 255;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flatten_composites_every_pixel_to_opaque() {
        let mut pixels = [
            0, 0, 0, 0, // fully transparent: becomes the background
            200, 100, 50, 255, // opaque: unchanged
            255, 255, 255, 153, // 60% white over the light mask
        ];
        flatten(&mut pixels, LIGHT_MASK);
        assert_eq!(&pixels[0..4], &[0xec, 0xee, 0xf2, 255]);
        assert_eq!(&pixels[4..8], &[200, 100, 50, 255]);
        assert_eq!(&pixels[8..12], &[247, 248, 250, 255]);
        let mut dark = [12, 34, 56, 0];
        flatten(&mut dark, DARK_MASK);
        assert_eq!(dark, [0x0c, 0x0d, 0x0d, 255]);
    }
}
