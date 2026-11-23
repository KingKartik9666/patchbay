use crate::{appearance::Backdrop, commands::DesktopError, files, legacy};
use patchbay_core::GraphDraft;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const SESSION_LIMIT: usize = 8 * files::PROJECT_LIMIT;
// Keep all earlier recoveries, but bound automatic disk use and directory scans.
const MAX_RECOVERY_FILES: u32 = 32;
// Version 1 sessions were written while the frontend forced glass to "solid".
// Version 2 is the first that records a real Window material choice.
const SESSION_VERSION: u32 = 2;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedSession {
    pub source: String,
    pub input: String,
    pub manual_draft: Option<String>,
    pub route: String,
    pub graph: Option<GraphDraft>,
    pub theme: String,
    pub motion_blur: bool,
    pub quality: String,
    pub glass: String,
    pub reduced_motion: bool,
    pub focus_mode: bool,
    pub high_contrast: bool,
    pub moore_initial: bool,
    // Added after version 2 shipped. Defaults keep older sessions loading
    // unchanged, so SESSION_VERSION stays 2 (an older Patchbay reading a newer
    // session falls back to its recovery path).
    #[serde(default = "default_true")]
    pub launch_animation: bool,
    /// The app version whose launch was last played or skipped.
    #[serde(default)]
    pub launch_seen: Option<String>,
    #[serde(default = "default_frame_rate")]
    pub frame_rate: String,
}
fn default_true() -> bool {
    true
}
fn default_frame_rate() -> String {
    "match".into()
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionFile {
    format: String,
    version: u32,
    session: SavedSession,
}

#[derive(Serialize)]
pub struct Startup {
    pub session: Option<SavedSession>,
    pub migrated: bool,
    pub warnings: Vec<String>,
    pub version: String,
    pub backdrop: Backdrop,
    /// Filled by `commands::startup` from the monitor the window is on.
    pub display: crate::display::DisplayInfo,
}

#[derive(Default)]
pub struct SessionStore {
    pub lock: Arc<Mutex<()>>,
}

pub fn validate(session: &SavedSession) -> Result<(), DesktopError> {
    for source in [
        &session.source,
        session.manual_draft.as_deref().unwrap_or(""),
    ] {
        if source.len() > files::PROJECT_LIMIT {
            return Err(DesktopError::new(
                "limit",
                "Machine definitions are limited to 1 MiB.",
            ));
        }
    }
    if session.input.encode_utf16().count() > 4096 {
        return Err(DesktopError::new(
            "limit",
            "Inputs are limited to 4096 characters.",
        ));
    }
    if !["light", "dark"].contains(&session.theme.as_str())
        || !["low", "medium", "high"].contains(&session.quality.as_str())
        || !["solid", "baked"].contains(&session.glass.as_str())
        || !["bench", "machines", "editor", "learn"].contains(&session.route.as_str())
        || !["match", "60", "30"].contains(&session.frame_rate.as_str())
        || session.launch_seen.as_deref().is_some_and(|seen| {
            seen.is_empty()
                || seen.len() > 32
                || !seen
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
        })
    {
        return Err(DesktopError::new(
            "validation",
            "Session preferences are invalid.",
        ));
    }
    // Persist editing data independently of derived traces and export text.
    // A runtime/output limit must not prevent saving a valid last machine.
    let parsed = patchbay_core::parse(&session.source).map_err(DesktopError::from)?;
    if parsed.machine.is_none() {
        return Err(DesktopError::new(
            "validation",
            "The session needs a valid last applied machine.",
        ));
    }
    if let Some(draft) = &session.graph {
        patchbay_core::validate_structure(draft).map_err(DesktopError::from)?;
    }
    Ok(())
}

pub fn save(path: &Path, session: SavedSession) -> Result<(), DesktopError> {
    validate(&session)?;
    let wrapper = SessionFile {
        format: "patchbay-session".into(),
        version: SESSION_VERSION,
        session,
    };
    let bytes = serde_json::to_vec(&wrapper)
        .map_err(|_| DesktopError::new("internal", "The session could not be serialized."))?;
    if bytes.len() > SESSION_LIMIT {
        return Err(DesktopError::new(
            "limit",
            "The session is too large to save.",
        ));
    }
    // Startup can fall back to defaults. Preserve unrecognized on-disk data
    // before autosave (or any other caller) replaces it with those defaults.
    match fs::symlink_metadata(path) {
        Ok(_) if load(path).is_err() => {
            preserve_session(path)?;
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => {
            return Err(DesktopError::io(
                "The existing session could not be inspected. It has not been changed.",
            ));
        }
    }
    files::write_atomic(path, &bytes)
}

fn load(path: &Path) -> Result<SavedSession, DesktopError> {
    let text = files::read_text(path, SESSION_LIMIT)?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| DesktopError::new("format", "The saved session is invalid."))?;
    if value.get("format").and_then(serde_json::Value::as_str) != Some("patchbay-session") {
        return Err(DesktopError::new(
            "format",
            "The saved file is not a Patchbay session.",
        ));
    }
    let version = value.get("version").and_then(serde_json::Value::as_u64);
    if version != Some(1) && version != Some(u64::from(SESSION_VERSION)) {
        return Err(DesktopError::new(
            "format",
            "This session version is not supported.",
        ));
    }
    let mut wrapper: SessionFile = serde_json::from_value(value)
        .map_err(|_| DesktopError::new("format", "The saved session is invalid."))?;
    if wrapper.version == 1 {
        // Version 1 stored a "solid" the user never chose, so start from the
        // translucent default once. The next save writes the current version.
        wrapper.session.glass = "baked".into();
    }
    validate(&wrapper.session)?;
    Ok(wrapper.session)
}

/// Recovery files are visible beside the session and never replace an earlier
/// recovery. Reusing an identical copy makes repeated startup/save idempotent.
fn preserve_session(path: &Path) -> Result<PathBuf, DesktopError> {
    let bytes = files::read_bytes(path, SESSION_LIMIT).map_err(|error| {
        if error.code == "limit" {
            DesktopError::new("limit", "The existing session is too large to back up automatically. It has not been changed.")
        } else {
            DesktopError::io("The existing session could not be backed up. It has not been changed.")
        }
    })?;
    let directory = path
        .parent()
        .ok_or_else(|| DesktopError::io("The session directory is invalid."))?;
    let name = path
        .file_name()
        .ok_or_else(|| DesktopError::io("The session filename is invalid."))?;
    for number in 1..=MAX_RECOVERY_FILES {
        let mut recovery_name = name.to_os_string();
        recovery_name.push(format!(".recovery-{number}.bak"));
        let recovery = directory.join(&recovery_name);
        if recovery.try_exists().map_err(|_| DesktopError::io("The session recovery location could not be inspected. The original has not been changed."))? {
            if files::read_bytes(&recovery, bytes.len()).is_ok_and(|existing| existing == bytes) {
                return Ok(recovery);
            }
            continue;
        }
        let mut temporary = tempfile::Builder::new().prefix(".patchbay-recovery-").suffix(".tmp")
            .tempfile_in(directory).map_err(|_| DesktopError::io("The session recovery copy could not be created. The original has not been changed."))?;
        temporary.write_all(&bytes).and_then(|()| temporary.as_file().sync_all())
            .map_err(|_| DesktopError::io("The session recovery copy could not be completely written. The original has not been changed."))?;
        // Preserve through the same physical folder as the created temporary
        // file; report the logical path from the merged Windows view to users.
        let physical_recovery = files::physical_sibling(temporary.path(), &recovery_name)?;
        match temporary.persist_noclobber(&physical_recovery) {
            Ok(_) => return Ok(recovery),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                return Err(DesktopError::io(
                    "The session recovery copy could not be kept. The original has not been changed.",
                ));
            }
        }
    }
    Err(DesktopError::io(
        "All 32 session recovery slots are occupied. Move older recovery files to another folder before retrying. The original has not been changed.",
    ))
}

struct LegacySession {
    session: Option<SavedSession>,
    warnings: Vec<String>,
}

fn legacy_session(profile: &Path) -> Result<LegacySession, DesktopError> {
    let recovered = legacy::read_session(profile)?;
    let values = recovered.values;
    let mut warnings = recovered.warnings;
    let Some(nav) = values
        .get("patchbay:nav:v1")
        .or_else(|| values.get("patchbay-session"))
    else {
        return Ok(LegacySession {
            session: None,
            warnings,
        });
    };
    let mut nav: serde_json::Value = serde_json::from_str(nav).map_err(|_| {
        DesktopError::new("format", "The previous session preferences are invalid.")
    })?;
    let object = nav.as_object_mut().ok_or_else(|| {
        DesktopError::new("format", "The previous session preferences are invalid.")
    })?;
    for (name, value) in [
        ("theme", serde_json::json!("light")),
        ("motionBlur", serde_json::json!(true)),
        ("manualDraft", serde_json::Value::Null),
        ("quality", serde_json::json!("medium")),
        ("glass", serde_json::json!("baked")),
        ("reducedMotion", serde_json::json!(false)),
        ("focusMode", serde_json::json!(false)),
        ("highContrast", serde_json::json!(false)),
        ("mooreInitial", serde_json::json!(true)),
        ("route", serde_json::json!("bench")),
    ] {
        object.entry(name).or_insert(value);
    }
    object.insert("graph".into(), serde_json::Value::Null);
    if let Some(graph) = values.get("patchbay:graph:v1") {
        // Recovery preserves editing data even when its derived machine text
        // cannot be generated within the export budget.
        match patchbay_core::parse_draft(graph) {
            Ok(draft) => {
                object.insert("graph".into(), serde_json::to_value(draft).map_err(|_| DesktopError::new("format", "The previous drawing could not be recovered."))?);
            }
            Err(error) => warnings.push(format!("The previous drawing could not be recovered: {} Its original Electron profile is preserved.", error.message)),
        }
    }
    // Legacy releases persisted only these preferences; do not let an unrelated
    // old field silently become an IPC option in the new application.
    object.retain(|name, _| {
        [
            "source",
            "input",
            "manualDraft",
            "route",
            "graph",
            "theme",
            "motionBlur",
            "quality",
            "glass",
            "reducedMotion",
            "focusMode",
            "highContrast",
            "mooreInitial",
        ]
        .contains(&name.as_str())
    });
    let session: SavedSession = serde_json::from_value(nav)
        .map_err(|_| DesktopError::new("format", "The previous session could not be decoded."))?;
    validate(&session)?;
    Ok(LegacySession {
        session: Some(session),
        warnings,
    })
}

pub fn startup(path: PathBuf, legacy_profile: Option<PathBuf>) -> Startup {
    let mut result = Startup {
        session: None,
        migrated: false,
        warnings: vec![],
        version: env!("CARGO_PKG_VERSION").into(),
        backdrop: Backdrop::default(),
        display: Default::default(),
    };
    let exists = match path.try_exists() {
        Ok(exists) => exists,
        Err(_) => {
            result.warnings.push(
                "The saved session could not be inspected. Its original file has not been changed."
                    .into(),
            );
            return result;
        }
    };
    if exists {
        match load(&path) {
            Ok(session) => result.session = Some(session),
            Err(error) => match preserve_session(&path) {
                Ok(recovery) => result.warnings.push(format!(
                    "{} A recovery copy was saved to {}. The original file has not been changed.",
                    error.message,
                    recovery.display()
                )),
                Err(backup_error) => result.warnings.push(format!(
                    "{} {} Automatic replacement is blocked until the original can be backed up.",
                    error.message, backup_error.message
                )),
            },
        }
    } else if let Some(profile) = legacy_profile {
        match legacy_session(&profile) {
            Ok(recovered) => {
                result.warnings.extend(recovered.warnings);
                if let Some(session) = recovered.session {
                    // The recovered in-memory session remains usable even if
                    // writing the new app's copy fails.
                    match save(&path, session.clone()) {
                        Ok(()) => result.migrated = true,
                        Err(error) => result.warnings.push(error.message),
                    }
                    result.session = Some(session);
                }
            }
            Err(error) => result.warnings.push(error.message),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use patchbay_core::{DomainRequest, MachineKind};
    use rusty_leveldb::{DB, Options};
    use std::collections::BTreeMap;

    #[cfg(windows)]
    #[test]
    fn windows_existing_appdata_parent_preserves_recovery_before_autosave() {
        let appdata = std::env::var_os("APPDATA").expect("Windows AppData directory");
        let fixture = tempfile::Builder::new()
            .prefix("patchbay-existing-recovery-test-")
            .suffix(".json")
            .tempfile_in(appdata)
            .expect("isolated AppData file")
            .into_temp_path();
        fs::write(&fixture, b"unrecognized original").expect("original fixture");
        let recovery = preserve_session(&fixture).expect("recovery in existing AppData");
        assert_eq!(
            fs::read(&fixture).expect("original"),
            b"unrecognized original"
        );
        assert_eq!(
            fs::read(&recovery).expect("recovery"),
            b"unrecognized original"
        );
        assert_eq!(
            preserve_session(&fixture).expect("reuse recovery"),
            recovery
        );
        save(&fixture, sample()).expect("autosave after preservation");
        assert_eq!(load(&fixture).expect("new session").source, sample().source);
        assert_eq!(
            fs::read(&recovery).expect("retained recovery"),
            b"unrecognized original"
        );
        fs::remove_file(recovery).expect("remove isolated recovery fixture");
    }

    fn sample() -> SavedSession {
        SavedSession {
            source: "type mealy\nstart A\nA 0 A 1".into(),
            input: "000".into(),
            manual_draft: Some("invalid pending draft".into()),
            route: "editor".into(),
            graph: None,
            theme: "dark".into(),
            motion_blur: true,
            quality: "low".into(),
            glass: "solid".into(),
            reduced_motion: true,
            focus_mode: false,
            high_contrast: false,
            moore_initial: true,
            launch_animation: true,
            launch_seen: None,
            frame_rate: "match".into(),
        }
    }

    #[test]
    fn sessions_written_before_launch_and_frame_rate_load_with_defaults() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        let mut old = serde_json::to_value(sample()).expect("json");
        let object = old.as_object_mut().expect("object");
        for name in ["launchAnimation", "launchSeen", "frameRate"] {
            assert!(object.remove(name).is_some(), "{name} is serialized");
        }
        let file = serde_json::json!({"format": "patchbay-session", "version": 2, "session": old});
        fs::write(&path, serde_json::to_vec(&file).expect("json")).expect("old fixture");
        let loaded = startup(path, None);
        assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
        let session = loaded.session.expect("old session loads");
        assert!(session.launch_animation);
        assert_eq!(session.launch_seen, None);
        assert_eq!(session.frame_rate, "match");
        assert_eq!(session.source, sample().source);
    }

    #[test]
    fn launch_and_frame_rate_preferences_round_trip_and_are_validated() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        let mut expected = sample();
        expected.launch_animation = false;
        expected.launch_seen = Some("2.0.0-beta.1+win".into());
        expected.frame_rate = "30".into();
        save(&path, expected.clone()).expect("save new fields");
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("saved")).expect("json");
        assert_eq!(saved["version"], serde_json::json!(SESSION_VERSION));
        assert_eq!(
            saved["session"]["launchAnimation"],
            serde_json::json!(false)
        );
        assert_eq!(saved["session"]["frameRate"], serde_json::json!("30"));
        assert_eq!(
            serde_json::to_value(load(&path).expect("round trip")).expect("json"),
            serde_json::to_value(&expected).expect("json")
        );
        let original = fs::read(&path).expect("bytes");
        for (frame_rate, launch_seen) in [
            ("144", None),
            ("match", Some("")),
            ("match", Some("2.0.0\"</script>")),
            ("match", Some("1".repeat(33).as_str())),
        ] {
            let mut invalid = expected.clone();
            invalid.frame_rate = frame_rate.into();
            invalid.launch_seen = launch_seen.map(str::to_owned);
            assert_eq!(
                save(&path, invalid).expect_err("invalid").code,
                "validation"
            );
        }
        assert_eq!(fs::read(&path).expect("unchanged"), original);
    }

    fn unfinished_graph(kind: MachineKind) -> GraphDraft {
        serde_json::from_value(serde_json::json!({
            "kind": kind, "start": "", "nextId": 42, "alphabet": ["β", "ping"],
            "states": [
                {"id": "s9", "name": "λ", "output": "🙂", "x": 150.25, "y": 90},
                {"id": "s2", "name": "é", "output": "", "x": 0, "y": 340.75}
            ],
            "transitions": [
                {"id": "t17", "from": "s9", "to": "s2", "input": "ping", "output": "saved-output"}
            ]
        }))
        .expect("graph fixture")
    }

    fn recovery_files(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .expect("recovery directory")
            .map(|entry| entry.expect("entry").path())
            .filter(|path| {
                path.file_name()
                    .expect("filename")
                    .to_string_lossy()
                    .contains(".recovery-")
            })
            .collect()
    }

    fn encoded_utf16(text: &str) -> Vec<u8> {
        let mut bytes = vec![0];
        for unit in text.encode_utf16() {
            bytes.extend(unit.to_le_bytes());
        }
        bytes
    }

    fn encoded_latin1(text: &str) -> Vec<u8> {
        let mut bytes = vec![1];
        for ch in text.chars() {
            bytes.push(u8::try_from(ch as u32).expect("Latin1 fixture"));
        }
        bytes
    }

    fn legacy_fixture(profile: &Path, values: &[(&str, Vec<u8>)]) -> PathBuf {
        let database = profile.join("Local Storage").join("leveldb");
        fs::create_dir_all(&database).expect("database directory");
        let mut db = DB::open(&database, Options::default()).expect("legacy database");
        for (name, bytes) in values {
            db.put(format!("_file://\0\u{1}{name}").as_bytes(), bytes)
                .expect("legacy value");
        }
        db.flush().expect("legacy flush");
        drop(db);
        database
    }

    fn snapshot(directory: &Path) -> BTreeMap<std::ffi::OsString, Vec<u8>> {
        fs::read_dir(directory)
            .expect("directory")
            .map(|entry| {
                let entry = entry.expect("entry");
                (entry.file_name(), fs::read(entry.path()).expect("file"))
            })
            .collect()
    }

    fn minimal_legacy_nav() -> String {
        serde_json::json!({
            "source": "type mealy\nstart é\né 0 é 1", "input": "000",
            "manualDraft": "ébauche invalid pending text", "route": "learn",
            "unrelatedOldField": "must not enter the new session"
        })
        .to_string()
    }

    #[test]
    fn invalid_pending_text_is_preserved_with_a_valid_machine() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        save(&path, sample()).expect("save");
        let session = load(&path).expect("load");
        assert_eq!(
            session.manual_draft.as_deref(),
            Some("invalid pending draft")
        );
        assert_eq!(session.input, "000");
        let mut corrupt = sample();
        corrupt.source = "invalid machine".into();
        assert!(save(&path, corrupt).is_err());
        assert_eq!(
            load(&path).expect("original preserved").source,
            sample().source
        );
    }

    #[test]
    fn full_session_round_trip_preserves_unfinished_graphs_and_inactive_outputs() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        for kind in [MachineKind::Mealy, MachineKind::Moore] {
            let mut expected = sample();
            expected.graph = Some(unfinished_graph(kind));
            expected.input = "🙂 λ".into();
            expected.manual_draft = Some("# unfinished é\nλ ??? 🙂".into());
            expected.focus_mode = true;
            expected.high_contrast = true;
            expected.moore_initial = false;
            expected.motion_blur = false;
            assert!(
                patchbay_core::inspect_graph(expected.graph.clone().expect("graph"))
                    .expect("unfinished graph allowed")
                    .machine
                    .is_none()
            );
            save(&path, expected.clone()).expect("save all fields");
            let loaded = startup(path.clone(), None);
            assert!(loaded.warnings.is_empty());
            assert!(!loaded.migrated);
            assert_eq!(
                serde_json::to_value(loaded.session.expect("loaded")).expect("json"),
                serde_json::to_value(expected).expect("json")
            );
        }
        assert!(recovery_files(directory.path()).is_empty());
    }

    #[test]
    fn version_one_sessions_move_to_the_translucent_window_material_once() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        let forced_solid =
            serde_json::json!({"format":"patchbay-session","version":1,"session":sample()});
        fs::write(&path, serde_json::to_vec(&forced_solid).expect("json")).expect("v1 fixture");
        let loaded = startup(path.clone(), None);
        assert!(loaded.warnings.is_empty());
        let mut session = loaded.session.expect("version 1 session loads");
        assert_eq!(session.glass, "baked");
        assert_eq!(session.source, sample().source);

        session.glass = "solid".into();
        save(&path, session).expect("save a deliberate solid choice");
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("saved")).expect("json");
        assert_eq!(saved["version"], serde_json::json!(SESSION_VERSION));
        assert_eq!(load(&path).expect("version 2 session").glass, "solid");
        assert!(recovery_files(directory.path()).is_empty());
    }

    #[test]
    fn malformed_and_future_sessions_survive_startup_followed_by_default_autosave() {
        let future =
            br#"{"format":"patchbay-session","version":99,"session":{"futureField":true}}"#
                .to_vec();
        let mut invalid_machine =
            serde_json::json!({"format":"patchbay-session","version":1,"session":sample()});
        invalid_machine["session"]["source"] = serde_json::json!("invalid applied machine");
        let mut unknown_field =
            serde_json::json!({"format":"patchbay-session","version":1,"session":sample()});
        unknown_field["session"]["unexpected"] = serde_json::json!(true);
        for bytes in [
            b"{unfinished JSON".to_vec(),
            future,
            vec![0xff, 0x00, 0xfe],
            serde_json::to_vec(&invalid_machine).expect("json"),
            serde_json::to_vec(&unknown_field).expect("json"),
        ] {
            let directory = tempfile::tempdir().expect("fixture");
            let path = directory.path().join("session.json");
            fs::write(&path, &bytes).expect("invalid fixture");
            for _ in 0..2 {
                let loaded = startup(path.clone(), None);
                assert!(loaded.session.is_none());
                assert!(!loaded.migrated);
                assert_eq!(loaded.warnings.len(), 1);
                assert!(loaded.warnings[0].contains("session.json.recovery-1.bak"));
                assert_eq!(fs::read(&path).expect("original before save"), bytes);
            }
            save(&path, sample()).expect("default autosave");
            assert_eq!(load(&path).expect("saved default").source, sample().source);
            let backups = recovery_files(directory.path());
            assert_eq!(
                backups.len(),
                1,
                "startup and autosave reuse the identical recovery"
            );
            assert_eq!(
                fs::read(&backups[0]).expect("recoverable original bytes"),
                bytes
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_appdata_recovery_keeps_original_bytes_and_logical_warning_path() {
        for bytes in [
            b"{unfinished JSON".as_slice(),
            br#"{"format":"patchbay-session","version":99,"session":{"futureField":true}}"#
                .as_slice(),
        ] {
            let appdata = std::env::var_os("APPDATA").expect("Windows AppData directory");
            let directory = tempfile::Builder::new()
                .prefix("patchbay-recovery-test-")
                .tempdir_in(appdata)
                .expect("isolated AppData fixture");
            let path = directory.path().join("session.json");
            let recovery = directory.path().join("session.json.recovery-1.bak");
            fs::write(&path, bytes).expect("unrecognized session");
            for _ in 0..2 {
                let loaded = startup(path.clone(), None);
                assert!(loaded.session.is_none());
                assert_eq!(loaded.warnings.len(), 1);
                assert!(
                    loaded.warnings[0].contains(&recovery.display().to_string()),
                    "recovery warning must show its accessible logical path: {:?}",
                    loaded.warnings
                );
                assert_eq!(fs::read(&path).expect("unchanged original"), bytes);
                assert_eq!(fs::read(&recovery).expect("recovery bytes"), bytes);
            }
            save(&path, sample()).expect("safe default autosave");
            assert_eq!(load(&path).expect("saved defaults").source, sample().source);
            assert_eq!(fs::read(&recovery).expect("preserved original"), bytes);
            assert_eq!(recovery_files(directory.path()).len(), 1);
            assert_eq!(
                fs::read_dir(directory.path()).expect("directory").count(),
                2
            );
        }
    }

    #[test]
    fn direct_save_preserves_each_distinct_unrecognized_session() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        for bytes in [
            b"first damaged session".as_slice(),
            b"second damaged session".as_slice(),
        ] {
            fs::write(&path, bytes).expect("invalid fixture");
            save(&path, sample()).expect("safe replacement without startup");
        }
        assert_eq!(
            fs::read(directory.path().join("session.json.recovery-1.bak")).expect("first"),
            b"first damaged session"
        );
        assert_eq!(
            fs::read(directory.path().join("session.json.recovery-2.bak")).expect("second"),
            b"second damaged session"
        );
    }

    #[test]
    fn full_recovery_slots_preserve_the_original_and_reuse_an_identical_copy() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        for number in 1..=MAX_RECOVERY_FILES {
            fs::write(
                directory
                    .path()
                    .join(format!("session.json.recovery-{number}.bak")),
                format!("previous damaged session {number}"),
            )
            .expect("earlier recovery");
        }
        fs::write(&path, b"new damaged session").expect("invalid session");
        let loaded = startup(path.clone(), None);
        assert!(loaded.session.is_none());
        assert!(loaded.warnings[0].contains("32 session recovery slots"));
        assert!(save(&path, sample()).is_err());
        assert_eq!(
            fs::read(&path).expect("original remains"),
            b"new damaged session"
        );
        assert_eq!(
            recovery_files(directory.path()).len(),
            MAX_RECOVERY_FILES as usize
        );
        fs::write(&path, b"previous damaged session 32").expect("already backed up session");
        save(&path, sample()).expect("reuse matching last slot");
        assert_eq!(
            recovery_files(directory.path()).len(),
            MAX_RECOVERY_FILES as usize
        );
    }

    #[test]
    fn oversized_original_blocks_autosave_without_losing_bytes() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        let original = vec![b'?'; SESSION_LIMIT + 1];
        fs::write(&path, &original).expect("oversized fixture");
        let loaded = startup(path.clone(), None);
        assert!(loaded.session.is_none());
        assert!(loaded.warnings[0].contains("Automatic replacement is blocked"));
        assert_eq!(
            save(&path, sample())
                .expect_err("cannot preserve safely")
                .code,
            "limit"
        );
        assert_eq!(fs::read(&path).expect("original remains"), original);
        assert!(recovery_files(directory.path()).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn unreadable_original_blocks_autosave_without_losing_bytes() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        fs::write(&path, b"locked original").expect("fixture");
        let exclusive = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&path)
            .expect("exclusive lock");
        let loaded = startup(path.clone(), None);
        assert!(loaded.session.is_none());
        assert!(loaded.warnings[0].contains("Automatic replacement is blocked"));
        assert!(save(&path, sample()).is_err());
        drop(exclusive);
        assert_eq!(
            fs::read(&path).expect("original remains"),
            b"locked original"
        );
        assert!(recovery_files(directory.path()).is_empty());
    }

    #[test]
    fn utf8_source_and_pending_text_limits_and_utf16_input_limit_are_enforced() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        let mut session = sample();
        session.source.push_str("\n#");
        session
            .source
            .push_str(&"x".repeat(files::PROJECT_LIMIT - session.source.len()));
        session.manual_draft = Some("🙂".repeat(files::PROJECT_LIMIT / 4));
        session.input = "🙂".repeat(2048);
        save(&path, session.clone()).expect("exact bounds");
        assert_eq!(
            load(&path).expect("bounded round trip").input,
            session.input
        );
        let original = fs::read(&path).expect("original");
        for field in ["source", "manual", "input"] {
            let mut invalid = session.clone();
            match field {
                "source" => invalid.source.push('x'),
                "manual" => invalid.manual_draft.as_mut().expect("draft").push('x'),
                _ => invalid.input.push('x'),
            }
            assert_eq!(save(&path, invalid).expect_err("bounded").code, "limit");
            assert_eq!(fs::read(&path).expect("unchanged"), original);
        }
    }

    #[test]
    fn aggregate_serialization_limit_preserves_the_previous_valid_session() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        save(&path, sample()).expect("original");
        let original = fs::read(&path).expect("original bytes");
        let mut session = sample();
        session.source.push_str("\n#");
        session
            .source
            .push_str(&"\0".repeat(files::PROJECT_LIMIT - session.source.len()));
        session.manual_draft = Some("\0".repeat(files::PROJECT_LIMIT));
        assert_eq!(
            save(&path, session).expect_err("JSON expansion limit").code,
            "limit"
        );
        assert_eq!(fs::read(&path).expect("preserved"), original);
    }

    #[test]
    fn invalid_preferences_and_graph_references_do_not_replace_a_valid_session() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        save(&path, sample()).expect("original");
        let original = fs::read(&path).expect("bytes");
        let mut invalid = sample();
        invalid.route = "unknown-page".into();
        assert_eq!(
            save(&path, invalid).expect_err("invalid route").code,
            "validation"
        );
        let mut invalid = sample();
        let mut graph = unfinished_graph(MachineKind::Mealy);
        graph.transitions[0].to = "missing-id".into();
        invalid.graph = Some(graph);
        assert_eq!(
            save(&path, invalid).expect_err("invalid graph").code,
            "validation"
        );
        assert_eq!(fs::read(&path).expect("unchanged"), original);
    }

    #[test]
    fn valid_session_survives_a_simulation_that_exceeds_the_trace_budget() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        let mut expected = sample();
        expected.source = format!("type mealy\nstart A\nA 0 A {}", "x".repeat(20_000));
        expected.input = "0".repeat(4096);
        assert_eq!(
            patchbay_core::execute(DomainRequest::Parse {
                source: expected.source.clone(),
                input: expected.input.clone(),
                moore_initial: expected.moore_initial,
            })
            .expect_err("trace is too large to run")
            .code,
            patchbay_core::ErrorCode::Limit
        );
        save(&path, expected.clone()).expect("valid session should remain saveable");
        let loaded = startup(path, None);
        assert!(loaded.warnings.is_empty());
        assert_eq!(
            serde_json::to_value(loaded.session.expect("saved session")).expect("json"),
            serde_json::to_value(expected).expect("json")
        );
    }

    #[test]
    fn structurally_valid_graph_remains_saveable_when_generated_text_exceeds_export_limit() {
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        let mut expected = sample();
        let graph: GraphDraft = serde_json::from_value(serde_json::json!({
            "kind": "mealy", "start": "s0", "nextId": 2, "alphabet": ["0"],
            "states": [{"id": "s0", "name": "q".repeat(350_000), "output": "inactive", "x": 0, "y": 0}],
            "transitions": [{"id": "t1", "from": "s0", "to": "s0", "input": "0", "output": "1"}]
        }))
        .expect("graph fixture");
        patchbay_core::validate_structure(&graph).expect("valid editing data");
        assert_eq!(
            patchbay_core::inspect_graph(graph.clone())
                .expect_err("generated text is too large to export")
                .code,
            patchbay_core::ErrorCode::Limit
        );
        expected.graph = Some(graph);
        save(&path, expected.clone()).expect("valid graph should remain saveable");
        let loaded = startup(path, None);
        assert!(loaded.warnings.is_empty());
        assert_eq!(
            serde_json::to_value(loaded.session.expect("saved graph")).expect("json"),
            serde_json::to_value(expected).expect("json")
        );
    }

    #[test]
    fn concurrent_session_saves_load_as_one_complete_snapshot() {
        use std::sync::{Arc, Barrier};
        const WRITERS: usize = 8;
        let directory = tempfile::tempdir().expect("fixture");
        let path = directory.path().join("session.json");
        save(&path, sample()).expect("original");
        let start = Arc::new(Barrier::new(WRITERS));
        std::thread::scope(|scope| {
            let mut writers = Vec::new();
            for number in 0..WRITERS {
                let start = start.clone();
                let path = path.clone();
                writers.push(scope.spawn(move || {
                    let mut session = sample();
                    session.input = number.to_string();
                    session.manual_draft = Some(format!("pending-{number}").repeat(4096));
                    start.wait();
                    save(&path, session).expect("concurrent session save");
                }));
            }
            for writer in writers {
                writer.join().expect("writer");
            }
        });
        let loaded = load(&path).expect("complete saved session");
        let number: usize = loaded.input.parse().expect("winning input");
        assert!(number < WRITERS);
        assert_eq!(
            loaded.manual_draft,
            Some(format!("pending-{number}").repeat(4096))
        );
        assert!(recovery_files(directory.path()).is_empty());
    }

    #[test]
    fn legacy_latin1_navigation_and_utf16_graph_migrate_without_modifying_the_profile() {
        let profile = tempfile::tempdir().expect("profile");
        let destination = tempfile::tempdir().expect("new app data");
        let path = destination.path().join("session.json");
        let graph = unfinished_graph(MachineKind::Moore);
        let graph_file = patchbay_core::serialize_draft(&graph).expect("graph v1");
        let database = legacy_fixture(
            profile.path(),
            &[
                ("patchbay:nav:v1", encoded_latin1(&minimal_legacy_nav())),
                ("patchbay:graph:v1", encoded_utf16(&graph_file)),
            ],
        );
        let before = snapshot(&database);
        let loaded = startup(path.clone(), Some(profile.path().to_owned()));
        assert!(loaded.migrated);
        assert!(loaded.warnings.is_empty());
        let session = loaded.session.expect("migrated session");
        assert_eq!(session.route, "learn");
        assert_eq!(
            session.manual_draft.as_deref(),
            Some("ébauche invalid pending text")
        );
        assert_eq!(session.theme, "light");
        assert_eq!(session.quality, "medium");
        assert_eq!(session.glass, "baked");
        assert_eq!(session.graph.as_ref(), Some(&graph));
        assert_eq!(
            serde_json::to_value(load(&path).expect("new app round trip")).expect("json"),
            serde_json::to_value(session).expect("json")
        );
        assert_eq!(snapshot(&database), before);
        let restarted = startup(path, Some(profile.path().to_owned()));
        assert!(restarted.session.is_some());
        assert!(!restarted.migrated);
        assert!(restarted.warnings.is_empty());
        assert_eq!(snapshot(&database), before);
    }

    #[test]
    fn legacy_graph_migrates_when_generated_machine_text_exceeds_the_export_limit() {
        let profile = tempfile::tempdir().expect("profile");
        let destination = tempfile::tempdir().expect("new app data");
        let path = destination.path().join("session.json");
        let graph: GraphDraft = serde_json::from_value(serde_json::json!({
            "kind": "mealy", "start": "s0", "nextId": 2, "alphabet": ["0"],
            "states": [{"id": "s0", "name": "q".repeat(350_000), "output": "inactive", "x": 0, "y": 0}],
            "transitions": [{"id": "t1", "from": "s0", "to": "s0", "input": "0", "output": "1"}]
        }))
        .expect("graph fixture");
        let graph_file = patchbay_core::serialize_draft(&graph).expect("graph fits project limit");
        assert_eq!(
            patchbay_core::inspect_graph(graph.clone())
                .expect_err("derived machine text exceeds the export limit")
                .code,
            patchbay_core::ErrorCode::Limit
        );
        let database = legacy_fixture(
            profile.path(),
            &[
                ("patchbay:nav:v1", encoded_latin1(&minimal_legacy_nav())),
                ("patchbay:graph:v1", encoded_utf16(&graph_file)),
            ],
        );
        let before = snapshot(&database);
        let loaded = startup(path.clone(), Some(profile.path().to_owned()));
        assert!(loaded.migrated);
        assert!(loaded.warnings.is_empty(), "{:?}", loaded.warnings);
        assert_eq!(
            loaded.session.expect("migrated session").graph,
            Some(graph.clone())
        );
        assert_eq!(load(&path).expect("persisted graph").graph, Some(graph));
        assert_eq!(snapshot(&database), before);
    }

    #[test]
    fn damaged_legacy_graph_keeps_valid_navigation_with_a_warning() {
        for graph in [
            encoded_latin1("{broken graph"),
            vec![0, 0xd8, 0xd8],
            encoded_latin1("{\"format\":\"patchbay-graph\",\"version\":99,\"draft\":{}}"),
        ] {
            let profile = tempfile::tempdir().expect("profile");
            let destination = tempfile::tempdir().expect("new app data");
            let path = destination.path().join("session.json");
            let database = legacy_fixture(
                profile.path(),
                &[
                    ("patchbay:nav:v1", encoded_latin1(&minimal_legacy_nav())),
                    ("patchbay:graph:v1", graph),
                ],
            );
            let before = snapshot(&database);
            let loaded = startup(path.clone(), Some(profile.path().to_owned()));
            assert!(loaded.migrated);
            assert_eq!(loaded.warnings.len(), 1);
            assert!(loaded.warnings[0].contains("previous drawing"));
            assert!(loaded.warnings[0].contains("Electron profile is preserved"));
            let session = loaded.session.expect("navigation recovered independently");
            assert_eq!(session.route, "learn");
            assert_eq!(session.input, "000");
            assert_eq!(
                session.manual_draft.as_deref(),
                Some("ébauche invalid pending text")
            );
            assert!(session.graph.is_none());
            assert_eq!(
                load(&path).expect("persisted navigation").source,
                session.source
            );
            assert_eq!(snapshot(&database), before);
        }
    }

    #[test]
    fn legacy_fallback_key_migrates_and_invalid_navigation_is_reported() {
        let profile = tempfile::tempdir().expect("profile");
        let destination = tempfile::tempdir().expect("new app data");
        let path = destination.path().join("session.json");
        legacy_fixture(
            profile.path(),
            &[("patchbay-session", encoded_latin1(&minimal_legacy_nav()))],
        );
        assert!(startup(path, Some(profile.path().to_owned())).migrated);

        let invalid_profile = tempfile::tempdir().expect("invalid profile");
        let invalid_path = destination.path().join("invalid-session.json");
        let database = legacy_fixture(
            invalid_profile.path(),
            &[("patchbay:nav:v1", encoded_latin1("{invalid"))],
        );
        let before = snapshot(&database);
        let loaded = startup(
            invalid_path.clone(),
            Some(invalid_profile.path().to_owned()),
        );
        assert!(loaded.session.is_none());
        assert!(!loaded.migrated);
        assert_eq!(loaded.warnings.len(), 1);
        assert!(!invalid_path.exists());
        assert_eq!(snapshot(&database), before);
    }
}
