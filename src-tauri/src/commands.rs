use crate::{
    files,
    session::{self, SavedSession, SessionStore, Startup},
};
use patchbay_core::{DomainError, DomainRequest, DomainResponse};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[derive(Debug, Serialize)]
pub struct DesktopError {
    pub code: String,
    pub message: String,
    pub details: Vec<String>,
}
impl DesktopError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: vec![],
        }
    }
    pub fn io(message: &str) -> Self {
        Self::new("io", message)
    }
}
impl From<DomainError> for DesktopError {
    fn from(error: DomainError) -> Self {
        let code = serde_json::to_value(error.code)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "internal".into());
        Self {
            code,
            message: error.message,
            details: error.details,
        }
    }
}

pub struct WorkerGate {
    domain: Arc<tokio::sync::Semaphore>,
    dialog: Arc<tokio::sync::Semaphore>,
}
impl Default for WorkerGate {
    fn default() -> Self {
        Self {
            domain: Arc::new(tokio::sync::Semaphore::new(2)),
            dialog: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
}

fn main_window(window: &WebviewWindow) -> Result<(), DesktopError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(DesktopError::new(
            "validation",
            "This command is restricted to the Patchbay window.",
        ))
    }
}
async fn worker<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, DesktopError> + Send + 'static,
) -> Result<T, DesktopError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| DesktopError::new("internal", "The desktop operation could not finish."))?
}
fn session_path(app: &AppHandle) -> Result<PathBuf, DesktopError> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("PATCHBAY_TEST_DATA_DIR") {
        return Ok(PathBuf::from(path).join("session.json"));
    }
    app.path()
        .app_data_dir()
        .map(|path| path.join("session.json"))
        .map_err(|_| DesktopError::io("The local session directory is unavailable."))
}

#[tauri::command]
pub async fn domain(
    window: WebviewWindow,
    gate: State<'_, WorkerGate>,
    request: DomainRequest,
) -> Result<DomainResponse, DesktopError> {
    main_window(&window)?;
    let _permit = gate
        .domain
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| DesktopError::new("internal", "The domain worker is unavailable."))?;
    worker(move || patchbay_core::execute(request).map_err(DesktopError::from)).await
}

#[tauri::command]
pub async fn startup(
    window: WebviewWindow,
    app: AppHandle,
    store: State<'_, SessionStore>,
) -> Result<Startup, DesktopError> {
    main_window(&window)?;
    let path = session_path(&app)?;
    let legacy_profile = app
        .path()
        .data_dir()
        .ok()
        .map(|directory| directory.join("Patchbay"));
    #[cfg(debug_assertions)]
    let legacy_profile = if std::env::var_os("PATCHBAY_TEST_NO_LEGACY").is_some() {
        None
    } else {
        legacy_profile
    };
    let lock = store.lock.clone();
    worker(move || {
        let _guard = lock
            .lock()
            .map_err(|_| DesktopError::new("internal", "Session storage is unavailable."))?;
        Ok(session::startup(path, legacy_profile))
    })
    .await
}

#[tauri::command]
pub async fn save_session(
    window: WebviewWindow,
    app: AppHandle,
    store: State<'_, SessionStore>,
    session: SavedSession,
) -> Result<(), DesktopError> {
    main_window(&window)?;
    let path = session_path(&app)?;
    // The frontend queues snapshots. This lock also protects native callers
    // from racing the atomic temporary file against another session write.
    let lock = store.lock.clone();
    worker(move || {
        let _guard = lock
            .lock()
            .map_err(|_| DesktopError::new("internal", "Session storage is unavailable."))?;
        session::save(&path, session)
    })
    .await
}

#[derive(Serialize)]
pub struct OpenedProject {
    name: String,
    source: String,
}

#[tauri::command]
pub async fn open_project(
    window: WebviewWindow,
    gate: State<'_, WorkerGate>,
) -> Result<Option<OpenedProject>, DesktopError> {
    main_window(&window)?;
    let _permit = gate
        .dialog
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| DesktopError::new("internal", "The file dialog is unavailable."))?;
    worker(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("Open Patchbay project")
            .add_filter("Patchbay projects", &["txt", "machine", "patchbay"])
            .pick_file()
        else {
            return Ok(None);
        };
        let source = files::read_text(&path, files::PROJECT_LIMIT)?;
        Ok(Some(OpenedProject {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "project".into()),
            source,
        }))
    })
    .await
}

#[tauri::command]
pub async fn save_project(
    window: WebviewWindow,
    gate: State<'_, WorkerGate>,
    source: String,
    format: String,
) -> Result<bool, DesktopError> {
    main_window(&window)?;
    if source.len() > files::PROJECT_LIMIT {
        return Err(DesktopError::new(
            "limit",
            "Project files are limited to 1 MiB.",
        ));
    }
    if format != "text" && format != "graph" {
        return Err(DesktopError::new(
            "validation",
            "Choose a text or graph project.",
        ));
    }
    if format == "graph" {
        patchbay_core::execute(DomainRequest::OpenProject {
            source: source.clone(),
        })
        .map_err(DesktopError::from)?;
    }
    let _permit = gate
        .dialog
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| DesktopError::new("internal", "The file dialog is unavailable."))?;
    worker(move || {
        let (name, extension) = if format == "graph" {
            ("machine.patchbay", "patchbay")
        } else {
            ("machine.txt", "txt")
        };
        let Some(path) = rfd::FileDialog::new()
            .set_title("Save Patchbay project")
            .set_file_name(name)
            .add_filter("Patchbay project", &[extension])
            .save_file()
        else {
            return Ok(false);
        };
        files::write_atomic(&path, source.as_bytes())?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn save_screenshot(
    window: WebviewWindow,
    gate: State<'_, WorkerGate>,
) -> Result<bool, DesktopError> {
    main_window(&window)?;
    let _permit = gate
        .dialog
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| DesktopError::new("internal", "The file dialog is unavailable."))?;
    worker(move || {
        let image = crate::screenshot::capture().map_err(|error| DesktopError::io(&error))?;
        let Some(path) = rfd::FileDialog::new()
            .set_title("Save Patchbay screenshot")
            .set_file_name("patchbay.png")
            .add_filter("PNG image", &["png"])
            .save_file()
        else {
            return Ok(false);
        };
        files::write_atomic(&path, &image)?;
        Ok(true)
    })
    .await
}
