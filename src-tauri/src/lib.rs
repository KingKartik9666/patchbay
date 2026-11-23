use tauri::Manager;

mod appearance;
mod commands;
mod display;
mod files;
mod launch;
mod legacy;
pub mod screenshot;
mod session;

pub fn run() {
    tauri::Builder::default()
        .manage(commands::WorkerGate::default())
        .manage(session::SessionStore::default())
        .manage(display::DisplayState::default())
        .setup(|app| {
            let (_window, backdrop) = appearance::create_main_window(app.handle())?;
            app.manage(backdrop);
            Ok(())
        })
        .on_window_event(display::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::domain,
            commands::startup,
            commands::save_session,
            commands::open_project,
            commands::save_project,
            commands::save_screenshot,
            commands::display_refresh,
        ])
        .run(tauri::generate_context!())
        .expect("Patchbay desktop could not start");
}
