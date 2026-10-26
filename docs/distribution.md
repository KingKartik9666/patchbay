# Patchbay @VERSION@ — Windows x64

An offline Mealy and Moore machine workbench. Draw states and transitions, edit
definitions, run binary, multi-variable and event inputs, and follow each step in
the trace. The interface uses solid light and dark themes with bundled Nunito.

## Requirements

Windows 10 or Windows 11, 64-bit, with the **Microsoft Edge WebView2 Evergreen
Runtime** installed. This package uses the shared runtime and does not include
Chromium or download WebView2 during installation.

If WebView2 is missing, install Microsoft's x64 **Evergreen Standalone Installer**
from [the WebView2 download page](https://developer.microsoft.com/microsoft-edge/webview2/),
then run Patchbay setup again. The standalone runtime installer can be transferred
to an offline PC. See Microsoft's [runtime distribution documentation](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution).

Once that prerequisite is present, Patchbay needs no Node, npm, server, account or
internet connection for normal use. Development tools are needed only to build it.

## Install or update

Run `Patchbay-@VERSION@-Setup-x64.exe` and follow the wizard. Installation is for
your Windows account. The wizard displays the destination and shortcut options.
Save your work and close running Patchbay windows before installing or updating.
Keep exported `.patchbay` files as backups when moving between versions.

The build is unsigned unless the distributor has separately configured signing;
Windows may display an unknown-publisher notice.

## Portable copy

Extract `Patchbay-@VERSION@-Windows-x64.zip` completely, then open `Patchbay.exe`.
Keep the executable together with the extracted resources and license files.
The portable and installed copies use the same Windows user session location.
Do not edit the same session concurrently in multiple application copies.

## Saved data and removal

Drawings, unfinished text and preferences recover from
`%APPDATA%\io.patchbay.studio\session.json`. Use **Save draft** to export a drawing
as a `.patchbay` file to a folder you choose. Native save operations replace the
destination atomically. Recovery files, when needed, remain beside the session.

On first startup without a current session, Patchbay can read a previous Electron
profile under `%APPDATA%\Patchbay`. That original profile is preserved; startup
reports migration or recovery warnings in the application.

Uninstall the installed copy through **Windows Settings > Apps**. Leave any
application-data removal option unchecked if you want to retain the session. Removing a
portable copy's extracted folder does not clear the session. Exported project
files are separate from application files. To remove all personal data, close
Patchbay and remove its session directory and any exported project files you no
longer need; the previous `%APPDATA%\Patchbay` profile is separate.

## Verify a download

`SHA256SUMS.txt` records SHA-256 hashes for the release payload and manifest.
In PowerShell, run `Get-FileHash -Algorithm SHA256 <file>` and compare the result
with the corresponding entry. A matching hash detects changed bytes; it does not
identify the publisher or replace a digital signature.

`release-manifest.json` records exact file sizes, hashes and the source snapshot.
Maintainers can run `npm run check:package` from the source checkout to check the
current version's complete release inventory and portable ZIP. Add
`-- --current-source` to also require the source and native build to match the
snapshot. These checks do not launch the app or installer.

## Quick start

Choose a preset in **Machines**, load its input and press **Play** or **Step**.
In **Editor**, add or double-click to place states. Drag to arrange them. Drag a
state's **+** handle to another state to save an arrow directly, using the input
and output in **Draw arrows**. The automatic input uses the next unused alphabet
symbol; occupied inputs open their existing arrow for editing. Click **+** then
the same state for a self-loop. The inspector edits names, inputs and outputs.
**Text** opens the manual definition editor. Multi-character
inputs use spaces, for example `11 01 10 00` or `coin push`.

Settings include light/dark themes, reduced motion, high contrast, diagram
quality and local frame diagnostics. Diagnostics stay on the device.
Trace and settings preserve the workspace and navigation. Trace includes a step
scrubber, next-transition preview and output summary. Escape closes a side panel.

## Licenses

Patchbay: `PATCHBAY-LICENSE.txt` (MIT).

JavaScript and Rust dependency notices: `THIRD-PARTY-NOTICES.txt`. The inventory
also includes Rust build tools, and links to source code for covered versions.
Published crates that omit a license file use authentic upstream or license-steward
texts with recorded revision and hash provenance in the source repository.

Nunito: `licenses\Nunito-OFL.txt` (SIL Open Font License 1.1).

Microsoft Edge WebView2 is a separately installed Microsoft component.
