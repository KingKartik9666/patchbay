use crate::{commands::DesktopError, files::PROJECT_LIMIT};
use rusty_leveldb::{DB, Options};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read},
    path::Path,
};

const PROFILE_LIMIT: u64 = 64 * 1024 * 1024;

fn copy_snapshot_file(
    source: &Path,
    destination: &Path,
    remaining: u64,
) -> Result<u64, DesktopError> {
    let input = fs::File::open(source).map_err(|_| {
        DesktopError::io(
            "The previous session could not be copied. Close the previous app and try again.",
        )
    })?;
    let mut output = fs::File::create(destination)
        .map_err(|_| DesktopError::io("The previous session could not be copied."))?;
    // Bound bytes actually read; the previous app may append to a LevelDB log
    // after its metadata was inspected. The private snapshot is dropped on error.
    let copied =
        io::copy(&mut input.take(remaining.saturating_add(1)), &mut output).map_err(|_| {
            DesktopError::io(
                "The previous session could not be copied. Close the previous app and try again.",
            )
        })?;
    if copied > remaining {
        return Err(DesktopError::new(
            "limit",
            "The previous session storage exceeds 64 MiB. Export its project in the previous app to import it.",
        ));
    }
    Ok(copied)
}

fn decode(value: &[u8]) -> Result<String, DesktopError> {
    let Some((&encoding, bytes)) = value.split_first() else {
        return Ok(String::new());
    };
    if bytes.len() > PROJECT_LIMIT * 12 {
        return Err(DesktopError::new(
            "limit",
            "The previous session is too large to import.",
        ));
    }
    let text = match encoding {
        1 => bytes.iter().map(|byte| char::from(*byte)).collect(),
        0 if bytes.len() % 2 == 0 => {
            let units: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16(&units).map_err(|_| {
                DesktopError::new("format", "The previous session has invalid Unicode.")
            })?
        }
        _ => {
            return Err(DesktopError::new(
                "format",
                "The previous session has an unknown text encoding.",
            ));
        }
    };
    if text.len() > PROJECT_LIMIT * 6 {
        return Err(DesktopError::new(
            "limit",
            "The previous session is too large to import.",
        ));
    }
    Ok(text)
}

#[derive(Default)]
pub struct RecoveredValues {
    pub values: BTreeMap<String, String>,
    pub warnings: Vec<String>,
}

/// Chromium LevelDB recovery runs exclusively on a private copy. Opening a
/// LevelDB may replay logs or compact tables; the user's Electron profile is
/// never opened by the database library and is left available for rollback.
pub fn read_session(profile: &Path) -> Result<RecoveredValues, DesktopError> {
    let source = profile.join("Local Storage").join("leveldb");
    if !source.is_dir() {
        return Ok(RecoveredValues::default());
    }
    let snapshot = tempfile::tempdir()
        .map_err(|_| DesktopError::io("The previous session could not be copied."))?;
    let mut total = 0_u64;
    for entry in fs::read_dir(&source)
        .map_err(|_| DesktopError::io("The previous session could not be inspected."))?
    {
        let entry =
            entry.map_err(|_| DesktopError::io("The previous session could not be inspected."))?;
        let file_type = entry
            .file_type()
            .map_err(|_| DesktopError::io("The previous session could not be inspected."))?;
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name_string = name.to_string_lossy();
        if name_string == "LOCK" || name_string == "LOG" || name_string == "LOG.old" {
            continue;
        }
        let allowed = name_string == "CURRENT"
            || name_string.starts_with("MANIFEST-")
            || name_string.ends_with(".log")
            || name_string.ends_with(".ldb")
            || name_string.ends_with(".sst");
        if !allowed {
            continue;
        }
        total += copy_snapshot_file(
            &entry.path(),
            &snapshot.path().join(name),
            PROFILE_LIMIT - total,
        )?;
    }
    let options = Options {
        create_if_missing: false,
        paranoid_checks: true,
        compressor: 1,
        ..Options::default()
    };
    let mut db = DB::open(snapshot.path(), options).map_err(|_| {
        DesktopError::new(
            "format",
            "The previous session could not be recovered. Its original files are preserved.",
        )
    })?;
    let mut result = RecoveredValues::default();
    for name in ["patchbay:nav:v1", "patchbay-session", "patchbay:graph:v1"] {
        let key = format!("_file://\0\u{1}{name}");
        if let Some(value) = db.get(key.as_bytes()) {
            match decode(&value) {
                Ok(value) => {
                    result.values.insert(name.into(), value);
                }
                Err(error) => {
                    let record = if name == "patchbay:graph:v1" {
                        "drawing"
                    } else {
                        "navigation settings"
                    };
                    result.warnings.push(format!("The previous {record} could not be decoded: {} Its original Electron profile is preserved.", error.message));
                }
            }
        }
    }
    drop(db);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_copy_bounds_actual_bytes_and_preserves_the_original() {
        let directory = tempfile::tempdir().expect("fixture");
        let source = directory.path().join("original.log");
        let destination = directory.path().join("private.log");
        fs::write(&source, b"original log").expect("original");
        assert_eq!(
            copy_snapshot_file(&source, &destination, 4)
                .expect_err("copy limit")
                .code,
            "limit"
        );
        assert_eq!(
            fs::read(&destination).expect("bounded partial copy"),
            b"origi"
        );
        assert_eq!(
            fs::read(&source).expect("unchanged original"),
            b"original log"
        );
        assert_eq!(
            copy_snapshot_file(&source, &destination, 12).expect("exact bound"),
            12
        );
        assert_eq!(
            fs::read(&destination).expect("complete copy"),
            b"original log"
        );
    }
    #[test]
    fn decodes_chromium_latin1_and_utf16() {
        assert_eq!(decode(&[1, b'A', 0xe9]).expect("latin1"), "Aé");
        let mut bytes = vec![0];
        for unit in "λ🙂".encode_utf16() {
            bytes.extend(unit.to_le_bytes());
        }
        assert_eq!(decode(&bytes).expect("unicode"), "λ🙂");
        assert!(decode(&[0, 0xd8, 0xd8]).is_err());
    }
    #[test]
    fn reads_a_private_copy_and_preserves_the_original() {
        let profile = tempfile::tempdir().expect("fixture");
        let database = profile.path().join("Local Storage/leveldb");
        fs::create_dir_all(&database).expect("mkdir");
        {
            let mut db = DB::open(&database, Options::default()).expect("fixture db");
            db.put(b"_file://\0\x01patchbay:nav:v1", b"\x01{\"input\":\"01\"}")
                .expect("put");
            db.flush().expect("flush");
        }
        let before: BTreeMap<_, _> = fs::read_dir(&database)
            .expect("list")
            .map(|entry| {
                let entry = entry.expect("entry");
                (entry.file_name(), fs::read(entry.path()).expect("read"))
            })
            .collect();
        let recovered = read_session(profile.path()).expect("import");
        assert_eq!(recovered.values["patchbay:nav:v1"], "{\"input\":\"01\"}");
        assert!(recovered.warnings.is_empty());
        let after: BTreeMap<_, _> = fs::read_dir(&database)
            .expect("list")
            .map(|entry| {
                let entry = entry.expect("entry");
                (entry.file_name(), fs::read(entry.path()).expect("read"))
            })
            .collect();
        assert_eq!(before, after);
    }
}
