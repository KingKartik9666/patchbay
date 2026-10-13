# Shareable Windows release implementation plan

> **For agentic workers:** Use Superpowers executing-plans and verification-before-completion. The user has authorized completion and distribution-file preparation; no publishing or signing service is requested.

**Goal:** Produce current, usable Windows x64 Setup and portable ZIP files that require no development environment.

**Architecture:** Rebuild the existing curated Electron bundle, verify its source identity, then wrap the same prepackaged folder with a pinned NSIS builder. Publish local versioned artifacts, end-user instructions and SHA-256 checksums. Installer and portable smoke checks use extracted/temporary destinations and an isolated app profile.

**Tech Stack:** Electron Packager, electron-builder 26.15.3 / NSIS, Node, PowerShell, Playwright Electron.

**Spec:** Active user goal: “after everything is done, update the app package and setup files so anyone can use this.” Existing Patchbay 1.2 features remain the packaged application.

## Constraints

- Deliver Windows x64 Setup EXE and portable ZIP; label platform and version clearly.
- Bundle all runtime assets; no Node/npm/server/account required by recipients.
- Per-user installation defaults to LocalAppData/Programs/Patchbay, preserving the existing profile and drafts.
- Installer offers shortcuts and uninstall support; uninstall must preserve app data.
- Distribute application, Electron/Chromium and Nunito licenses. No personal scripts, profiles or development dependencies in artifacts.
- No signing credentials are configured: document unsigned status accurately.
- Do not interrupt an open user app or overwrite unrelated installer registrations during testing.

## Review focus

- ZIP extracted outside the checkout starts without workspace paths or Node in PATH.
- Installer payload matches the verified current bundle, including version and licenses.
- Install and reinstall preserve profile data; uninstall removes only its chosen application directory.
- Installer tests restore pre-existing desktop shortcuts and leave no temporary uninstall registration.
- The shareable artifact set includes concise instructions, checksums and reproducible build commands.

## Tasks

- [ ] Add pinned NSIS configuration, local release pipeline, licenses and end-user instructions. Build Setup and ZIP from the verified bundle.
- [ ] Verify artifact contents/checksums and launch the extracted ZIP independently of the workspace.
- [ ] Exercise actual installer install/reinstall/uninstall in a temporary destination, verify profile preservation and restore shortcut state.
- [ ] Review the final release, record evidence and provide the two user-facing download paths.
