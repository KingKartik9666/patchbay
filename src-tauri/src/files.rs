use crate::commands::DesktopError;
use std::{
    ffi::OsStr,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const PROJECT_LIMIT: usize = 1024 * 1024;

pub(crate) fn physical_sibling(
    temporary: &Path,
    filename: &OsStr,
) -> Result<PathBuf, DesktopError> {
    // Resolve the created file, not its parent: Windows can leave an existing
    // AppData directory on C: but redirect newly created children to another
    // volume. Both sides of an atomic rename must use that child's real folder.
    fs::canonicalize(temporary)
        .map(|path| path.with_file_name(filename))
        .map_err(|_| DesktopError::io("The temporary save location could not be resolved."))
}

pub fn read_bytes(path: &Path, limit: usize) -> Result<Vec<u8>, DesktopError> {
    let mut file =
        File::open(path).map_err(|_| DesktopError::io("The selected file could not be opened."))?;
    if !file
        .metadata()
        .map_err(|_| DesktopError::io("The file could not be inspected."))?
        .is_file()
    {
        return Err(DesktopError::io("Choose a regular project file."));
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((limit as u64).saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopError::io("The selected file could not be read."))?;
    if bytes.len() > limit {
        return Err(DesktopError::new(
            "limit",
            "This file exceeds the supported size.",
        ));
    }
    Ok(bytes)
}

pub fn read_text(path: &Path, limit: usize) -> Result<String, DesktopError> {
    String::from_utf8(read_bytes(path, limit)?)
        .map(|text| text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
        .map_err(|_| {
            DesktopError::new(
                "format",
                "Choose a UTF-8 project file. This file contains invalid text encoding.",
            )
        })
}

/// Write in the destination directory, flush, then replace. A failed write keeps
/// the old file intact; paths come from a native dialog or fixed session location.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), DesktopError> {
    let filename = path
        .file_name()
        .ok_or_else(|| DesktopError::io("The save destination is invalid."))?;
    let directory = path
        .parent()
        .ok_or_else(|| DesktopError::io("The save destination is invalid."))?;
    fs::create_dir_all(directory)
        .map_err(|_| DesktopError::io("The save directory could not be created."))?;
    // Each writer owns an exclusively created file. Close its handle before the
    // atomic replacement so another Windows writer does not find an open,
    // delete-pending destination from the previous replacement.
    let mut temporary = tempfile::Builder::new()
        .prefix(".patchbay-save-")
        .suffix(".tmp")
        .tempfile_in(directory)
        .map_err(|_| DesktopError::io("The project could not be written."))?;
    temporary
        .write_all(bytes)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| DesktopError::io("The project could not be completely written."))?;
    let destination = physical_sibling(temporary.path(), filename)?;
    let mut pending = temporary.into_temp_path();
    let mut retry_delay_ms = 1;
    loop {
        match pending.persist(&destination) {
            Ok(()) => return Ok(()),
            Err(error)
                if cfg!(windows)
                    && matches!(error.error.raw_os_error(), Some(5 | 32 | 33))
                    && retry_delay_ms <= 64 =>
            {
                // A reader can keep a replaced Windows destination pending
                // deletion briefly. Retry the same complete temporary file with
                // 127 ms total requested delay; a persistent lock keeps the old file.
                pending = error.path;
                std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                retry_delay_ms *= 2;
            }
            Err(error) => {
                let mut failure =
                    DesktopError::io("The saved file could not replace its previous version.");
                failure.details.push(error.error.to_string());
                return Err(failure);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_existing_appdata_parent_can_publish_new_and_replacement_files() {
        // Existing parents can remain on C: while newly created children are
        // redirected elsewhere. A newly created tempdir alone misses this case.
        let appdata = std::env::var_os("APPDATA").expect("Windows AppData directory");
        let fixture = tempfile::Builder::new()
            .prefix("patchbay-existing-parent-test-")
            .suffix(".json")
            .tempfile_in(appdata)
            .expect("isolated AppData file")
            .into_temp_path();
        fs::remove_file(&fixture).expect("exercise first publication");
        write_atomic(&fixture, b"original").expect("first file in existing AppData");
        write_atomic(&fixture, b"replacement").expect("replacement in existing AppData");
        assert_eq!(fs::read(&fixture).expect("logical path"), b"replacement");
    }

    #[cfg(windows)]
    #[test]
    fn windows_appdata_save_and_overwrite_use_the_same_physical_directory() {
        // Packaged Windows launchers can virtualize AppData onto another volume.
        // Exercise the logical path used by sessions, not just unredirected TEMP.
        let appdata = std::env::var_os("APPDATA").expect("Windows AppData directory");
        let directory = tempfile::Builder::new()
            .prefix("patchbay-atomic-test-")
            .tempdir_in(appdata)
            .expect("isolated AppData fixture");
        let destination = directory.path().join("saved-λ🙂.json");
        write_atomic(&destination, b"original").expect("first AppData save");
        write_atomic(&destination, b"replacement").expect("AppData overwrite");
        assert_eq!(
            fs::read(&destination).expect("logical path"),
            b"replacement"
        );
        assert_eq!(
            fs::read(fs::canonicalize(&destination).expect("physical path"))
                .expect("physical contents"),
            b"replacement"
        );
        assert_eq!(
            fs::read_dir(directory.path()).expect("directory").count(),
            1
        );
    }

    #[test]
    fn bounded_utf8_round_trip_and_overwrite() {
        let directory = tempfile::tempdir().expect("fixture directory");
        let path = directory.path().join("machine.txt");
        write_atomic(&path, "λ🙂".as_bytes()).expect("write");
        assert_eq!(read_text(&path, 20).expect("read"), "λ🙂");
        write_atomic(&path, b"replacement").expect("overwrite");
        assert_eq!(read_text(&path, 20).expect("read"), "replacement");
        assert_eq!(read_text(&path, 3).expect_err("bounded").code, "limit");
        fs::write(&path, [0xff]).expect("invalid fixture");
        assert_eq!(read_text(&path, 20).expect_err("utf8").code, "format");
    }

    #[test]
    fn utf8_bom_and_exact_byte_bound_are_respected() {
        let directory = tempfile::tempdir().expect("fixture directory");
        let path = directory.path().join("machine.txt");
        let bytes = "\u{feff}λ🙂".as_bytes();
        fs::write(&path, bytes).expect("fixture");
        assert_eq!(read_bytes(&path, bytes.len()).expect("raw"), bytes);
        assert_eq!(read_text(&path, bytes.len()).expect("bom"), "λ🙂");
        assert_eq!(
            read_text(&path, bytes.len() - 1)
                .expect_err("byte limit")
                .code,
            "limit"
        );
    }

    #[test]
    fn concurrent_writers_only_publish_complete_files() {
        use std::sync::{Arc, Barrier};
        const WRITERS: usize = 12;
        let directory = tempfile::tempdir().expect("fixture directory");
        let shared = directory.path().join("shared.txt");
        write_atomic(&shared, b"initial").expect("initial file");
        let start = Arc::new(Barrier::new(WRITERS));
        std::thread::scope(|scope| {
            let mut writers = Vec::new();
            for number in 0..WRITERS {
                let start = start.clone();
                let shared = shared.clone();
                let own = directory.path().join(format!("writer-{number}.txt"));
                writers.push(scope.spawn(move || {
                    let bytes = vec![b'A' + number as u8; 256 * 1024 + number];
                    start.wait();
                    write_atomic(&own, &bytes).expect("independent concurrent save");
                    write_atomic(&shared, &bytes).expect("shared concurrent save");
                    assert_eq!(fs::read(own).expect("independent file"), bytes);
                }));
            }
            for writer in writers {
                writer.join().expect("writer thread");
            }
        });
        let published = fs::read(&shared).expect("complete shared file");
        assert!(published[0] >= b'A' && published[0] < b'A' + WRITERS as u8);
        assert_eq!(
            published.len(),
            256 * 1024 + usize::from(published[0] - b'A')
        );
        assert!(published.iter().all(|byte| *byte == published[0]));
        assert_eq!(
            fs::read_dir(directory.path()).expect("directory").count(),
            WRITERS + 1
        );
    }

    #[test]
    fn failed_replacement_keeps_the_destination_and_cleans_its_temporary_file() {
        let directory = tempfile::tempdir().expect("fixture directory");
        let destination = directory.path().join("existing-directory");
        fs::create_dir(&destination).expect("destination directory");
        fs::write(destination.join("original.txt"), b"original").expect("original");
        assert!(write_atomic(&destination, b"replacement").is_err());
        assert_eq!(
            fs::read(destination.join("original.txt")).expect("unchanged"),
            b"original"
        );
        assert_eq!(
            fs::read_dir(directory.path()).expect("directory").count(),
            1
        );
    }

    #[cfg(windows)]
    #[test]
    fn persistent_windows_lock_keeps_the_original_and_cleans_the_temporary_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().expect("fixture directory");
        let destination = directory.path().join("locked.txt");
        fs::write(&destination, b"original").expect("original");
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&destination)
            .expect("exclusive lock");
        assert!(write_atomic(&destination, b"replacement").is_err());
        drop(lock);
        assert_eq!(fs::read(destination).expect("unchanged"), b"original");
        assert_eq!(
            fs::read_dir(directory.path()).expect("directory").count(),
            1
        );
    }
}
