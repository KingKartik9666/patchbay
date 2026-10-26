#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if let Some(result) = patchbay_desktop::screenshot::run_helper() {
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    patchbay_desktop::run();
}
