//! The launch is decided before the window exists. Rust reads a lenient hint
//! from the saved session, picks the variant and injects a tiny script that
//! sets `html[data-theme]` and `html[data-launch]` before the document parses,
//! so the first painted frame is already the launch's first frame (or, with
//! the launch off, the right theme) instead of a flash of the default.
use serde_json::Value;
use std::{fs, io::Read, path::Path};

/// Bigger sessions (large drawings) are valid but not worth parsing on the
/// window-creation path; they have certainly been opened before.
const HINT_LIMIT: u64 = 1024 * 1024;

/// What the session file could tell us without validating it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Saved {
    /// No session yet: a first run.
    Missing,
    /// Unreadable, malformed or not a Patchbay session.
    Unreadable,
    /// Larger than [`HINT_LIMIT`]; the user has been here before.
    Oversized,
    Present,
}

/// The preferences the launch needs. Every field is read independently and
/// falls back to its default, so a damaged or future session never blocks the
/// window; full validation happens later in `session::startup`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hint {
    pub theme: &'static str,
    pub launch_animation: bool,
    pub launch_seen: Option<String>,
    pub reduced_motion: bool,
    pub high_contrast: bool,
    pub quality: String,
    pub saved: Saved,
}
impl Default for Hint {
    fn default() -> Self {
        Self {
            theme: "dark",
            launch_animation: true,
            launch_seen: None,
            reduced_motion: false,
            high_contrast: false,
            quality: "medium".into(),
            saved: Saved::Missing,
        }
    }
}

fn read(path: &Path) -> Result<Option<String>, Saved> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Saved::Unreadable),
    };
    let size = file.metadata().map_err(|_| Saved::Unreadable)?.len();
    if size > HINT_LIMIT {
        return Err(Saved::Oversized);
    }
    let mut text = String::new();
    // `take` keeps the bound even if the file grows between stat and read.
    file.take(HINT_LIMIT + 1)
        .read_to_string(&mut text)
        .map_err(|_| Saved::Unreadable)?;
    if text.len() as u64 > HINT_LIMIT {
        return Err(Saved::Oversized);
    }
    Ok(Some(text))
}

/// Parses session text into a hint. Pure, so the table can be tested.
pub fn parse(text: &str) -> Hint {
    let unreadable = Hint {
        saved: Saved::Unreadable,
        ..Hint::default()
    };
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return unreadable;
    };
    if value.get("format").and_then(Value::as_str) != Some("patchbay-session") {
        return unreadable;
    }
    let Some(session) = value.get("session").and_then(Value::as_object) else {
        return unreadable;
    };
    let flag = |name: &str, default: bool| {
        session
            .get(name)
            .and_then(Value::as_bool)
            .unwrap_or(default)
    };
    let defaults = Hint::default();
    Hint {
        theme: match session.get("theme").and_then(Value::as_str) {
            Some("light") => "light",
            _ => "dark",
        },
        launch_animation: flag("launchAnimation", true),
        launch_seen: session
            .get("launchSeen")
            .and_then(Value::as_str)
            .filter(|seen| seen.len() <= 32)
            .map(str::to_owned),
        reduced_motion: flag("reducedMotion", false),
        high_contrast: flag("highContrast", false),
        quality: session
            .get("quality")
            .and_then(Value::as_str)
            .filter(|quality| ["low", "medium", "high"].contains(quality))
            .map_or(defaults.quality, str::to_owned),
        saved: Saved::Present,
    }
}

/// Reads the hint for `path`. Never fails: the worst case is the first-run
/// default (Night, full launch).
pub fn hint(path: &Path) -> Hint {
    match read(path) {
        Ok(Some(text)) => parse(&text),
        Ok(None) => Hint::default(),
        Err(saved) => Hint {
            saved,
            ..Hint::default()
        },
    }
}

/// The variant table, with the environment passed in so it stays pure.
/// `override_mode` is the debug-only `PATCHBAY_LAUNCH`; `test_data` is a debug
/// build running under `PATCHBAY_TEST_DATA_DIR` (every native suite), where
/// the launch is off unless a test asks for it.
pub fn decide(
    hint: &Hint,
    version: &str,
    override_mode: Option<&str>,
    test_data: bool,
) -> &'static str {
    let known = override_mode.and_then(|mode| {
        ["off", "full", "short", "still"]
            .into_iter()
            .find(|known| *known == mode.trim())
    });
    if let Some(mode) = known {
        return mode;
    }
    if test_data && override_mode.is_none() {
        return "off";
    }
    if !hint.launch_animation {
        return "off";
    }
    if hint.reduced_motion || hint.high_contrast || hint.quality == "low" {
        return "still";
    }
    match hint.saved {
        Saved::Present if hint.launch_seen.as_deref() == Some(version) => "short",
        Saved::Oversized => "short",
        _ => "full",
    }
}

/// The variant for this start: `off`, `full`, `short` or `still`.
pub fn mode(hint: &Hint, version: &str) -> &'static str {
    #[cfg(debug_assertions)]
    {
        let override_mode = std::env::var("PATCHBAY_LAUNCH").ok();
        let test_data = std::env::var_os("PATCHBAY_TEST_DATA_DIR").is_some();
        decide(hint, version, override_mode.as_deref(), test_data)
    }
    #[cfg(not(debug_assertions))]
    decide(hint, version, None, false)
}

/// The initialization script WebView2 runs on document creation, before any
/// page script, stylesheet or paint.
pub fn script(hint: &Hint, mode: &str) -> String {
    let boot = serde_json::json!({
        "theme": hint.theme,
        "launch": mode,
        "version": env!("CARGO_PKG_VERSION"),
        "contrast": hint.high_contrast,
    });
    // Only the call site; the lint directive that names the placeholder stays.
    include_str!("launch-init.js").replace("(__PATCHBAY_BOOT__)", &format!("({boot})"))
}

/// The theme's `--mask`, which is also the launch ground and the opaque
/// window's pre-paint fill, so nothing flashes between them.
pub fn mask(theme: &str) -> [u8; 3] {
    if theme == "light" {
        [0xec, 0xee, 0xf2]
    } else {
        [0x0c, 0x0d, 0x0d]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION: &str = env!("CARGO_PKG_VERSION");

    fn session(fields: Value) -> String {
        serde_json::json!({"format": "patchbay-session", "version": 2, "session": fields})
            .to_string()
    }

    #[test]
    fn mode_table_follows_the_documented_order() {
        let first = Hint::default();
        assert_eq!(decide(&first, VERSION, None, false), "full", "first run");
        let seen = parse(&session(serde_json::json!({ "launchSeen": VERSION })));
        assert_eq!(decide(&seen, VERSION, None, false), "short", "same version");
        let older = parse(&session(serde_json::json!({ "launchSeen": "1.9.0" })));
        assert_eq!(decide(&older, VERSION, None, false), "full", "new version");
        let old_session = parse(&session(serde_json::json!({ "theme": "light" })));
        assert_eq!(
            decide(&old_session, VERSION, None, false),
            "full",
            "a session from before the launch existed"
        );
        let disabled = parse(&session(
            serde_json::json!({ "launchAnimation": false, "reducedMotion": true }),
        ));
        assert_eq!(decide(&disabled, VERSION, None, false), "off", "disabled");
        for fields in [
            serde_json::json!({ "reducedMotion": true, "launchSeen": VERSION }),
            serde_json::json!({ "highContrast": true }),
            serde_json::json!({ "quality": "low" }),
        ] {
            let hint = parse(&session(fields));
            assert_eq!(decide(&hint, VERSION, None, false), "still");
        }
    }

    #[test]
    fn environment_overrides_and_test_runs_are_off_unless_asked() {
        let hint = Hint::default();
        assert_eq!(decide(&hint, VERSION, None, true), "off", "test data dir");
        for mode in ["off", "full", "short", "still"] {
            assert_eq!(decide(&hint, VERSION, Some(mode), true), mode);
        }
        let disabled = Hint {
            launch_animation: false,
            ..Hint::default()
        };
        assert_eq!(decide(&disabled, VERSION, Some("full"), false), "full");
        // Any other value (the native helper passes "auto") means the normal rules.
        assert_eq!(decide(&hint, VERSION, Some("auto"), true), "full");
    }

    #[test]
    fn damaged_and_oversized_sessions_never_block_the_window() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        assert_eq!(hint(&path), Hint::default(), "missing file");

        fs::write(&path, b"{unfinished JSON").expect("malformed");
        let malformed = hint(&path);
        assert_eq!(malformed.saved, Saved::Unreadable);
        assert_eq!(malformed.theme, "dark");
        assert_eq!(decide(&malformed, VERSION, None, false), "full");

        fs::write(&path, br#"{"format":"other","session":{"theme":"light"}}"#).expect("foreign");
        assert_eq!(hint(&path).saved, Saved::Unreadable);

        let mut big = session(serde_json::json!({ "theme": "light" }));
        big.push_str(&" ".repeat(HINT_LIMIT as usize));
        fs::write(&path, big).expect("oversized");
        let oversized = hint(&path);
        assert_eq!(oversized.saved, Saved::Oversized);
        assert_eq!(oversized.theme, "dark");
        assert_eq!(decide(&oversized, VERSION, None, false), "short");
    }

    #[test]
    fn fields_are_read_leniently_one_by_one() {
        let hint = parse(&session(serde_json::json!({
            "theme": "light",
            "launchAnimation": "yes",
            "launchSeen": "x".repeat(64),
            "quality": "ultra",
            "highContrast": 1,
            "futureField": {"nested": true}
        })));
        assert_eq!(hint.theme, "light");
        assert!(hint.launch_animation, "a wrong type keeps the default");
        assert_eq!(hint.launch_seen, None, "an implausible version is ignored");
        assert_eq!(hint.quality, "medium");
        assert!(!hint.high_contrast);
        assert_eq!(hint.saved, Saved::Present);
        assert_eq!(
            parse(&session(serde_json::json!({"theme": "sepia"}))).theme,
            "dark"
        );
    }

    #[test]
    fn script_embeds_the_boot_payload_as_json() {
        let hint = parse(&session(
            serde_json::json!({"theme": "light", "highContrast": true}),
        ));
        let script = script(&hint, "still");
        assert!(!script.contains("(__PATCHBAY_BOOT__)"));
        let start = script.find("({\"").expect("payload") + 1;
        let end = start + script[start..].find('}').expect("payload end") + 1;
        let boot: Value = serde_json::from_str(&script[start..end]).expect("boot json");
        assert_eq!(
            boot,
            serde_json::json!({"theme": "light", "launch": "still", "version": VERSION, "contrast": true})
        );
        assert_eq!(mask("light"), [0xec, 0xee, 0xf2]);
        assert_eq!(mask("dark"), [0x0c, 0x0d, 0x0d]);
    }
}
