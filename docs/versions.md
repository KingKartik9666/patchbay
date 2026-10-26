# Version pins and official references

This table records the versions selected by this checkout on 2026-10-23. It is an
inventory of the build, rather than a claim that each entry is the newest future
upstream release. npm dependencies use exact versions and `package-lock.json`;
Rust dependencies use `Cargo.lock` and exact versions for direct registry crates.
`rust-toolchain.toml` pins the compiler and Cargo to
`1.99.0-x86_64-pc-windows-msvc`, so a different rustup default host cannot select
the GNU Windows toolchain by accident.

| Component | Selected version | Official source |
| --- | --- | --- |
| Patchbay | 2.0.0 | `package.json`, Tauri config and both Rust packages |
| React / React DOM | 19.3.0 | [React release](https://github.com/react/react/releases/tag/v19.3.0) |
| TypeScript | 6.0.3 | [TypeScript release](https://github.com/microsoft/TypeScript/releases/tag/v6.0.3) |
| Vite | 8.3.5 | [Vite release](https://github.com/vitejs/vite/releases/tag/v8.3.5) |
| Vite React plugin | 6.1.2 | [Plugin releases](https://github.com/vitejs/vite-plugin-react/releases) |
| Rust / Cargo | 1.99.0, MSVC x64 | [Rust announcement](https://blog.rust-lang.org/2026/10/01/Rust-1.99.0/) |
| Tauri Rust crate / JavaScript API | 2.12.3 | [Tauri release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.12.3) |
| Tauri CLI | 2.12.2 | [CLI release](https://github.com/tauri-apps/tauri/releases/tag/tauri-cli-v2.12.2) |
| Tauri build crate | 2.7.2 | [Tauri releases](https://github.com/tauri-apps/tauri/releases) |
| Node.js | Minimum 24.20.0 | [Node releases](https://nodejs.org/en/about/previous-releases) |
| npm | 11.12.0 | [npm release](https://github.com/npm/cli/releases/tag/v11.12.0) |
| WebView2 | Installed Evergreen Runtime | [Microsoft distribution guide](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) |
| Nunito | Local Latin variable font | [Font project](https://github.com/googlefonts/nunito), bundled OFL text |

Vite was patched from 8.3.2 to 8.3.5 after `npm audit` identified development-server
and editor-launch advisories in the former pin. Both `npm audit` and
`npm audit --omit=dev` returned zero reported vulnerabilities after the update.
This is a dated dependency-audit result, not a guarantee about later advisories.
The production app embeds static renderer files and does not run Vite.

Tauri's crate, CLI, API and build-crate version numbers are released independently;
they do not need identical patch numbers. Their exact selected versions and
compatibility are verified by the build and lockfiles, not by a shared version
prefix alone.

Build prerequisites and packaging behavior follow [Tauri's Windows setup](https://v2.tauri.app/start/prerequisites/)
and [Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/).
The first development setup may download dependencies and NSIS tools. The shipped
app uses preinstalled WebView2 and needs no Vite server or runtime npm packages.

The notice generator reads installed npm licenses and cached Cargo package files.
For published crates missing license text, `scripts/licenses/provenance.json`
records the exact crate VCS revision, selected declared license, upstream or
license-steward URL, local text and SHA-256. Notice generation checks those bytes
offline and fails when any unaccounted package lacks a license text. Recheck
license provenance and both lockfiles when updating dependencies.
