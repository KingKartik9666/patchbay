fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "domain",
            "startup",
            "save_session",
            "open_project",
            "save_project",
            "save_screenshot",
        ]));
    tauri_build::try_build(attributes).expect("Tauri build configuration is invalid");
}
