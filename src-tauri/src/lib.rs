mod commands;
mod files;
mod legacy;
pub mod screenshot;
mod session;

pub fn run() {
    tauri::Builder::default()
        .manage(commands::WorkerGate::default())
        .manage(session::SessionStore::default())
        .invoke_handler(tauri::generate_handler![
            commands::domain,
            commands::startup,
            commands::save_session,
            commands::open_project,
            commands::save_project,
            commands::save_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("Patchbay desktop could not start");
}
