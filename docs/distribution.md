PATCHBAY @VERSION@ — WINDOWS X64

Mealy and Moore machine studio: draw states and transitions, edit definitions,
run binary/multiple-variable/event inputs, and follow the trace. Includes a
3D glass scene, floating Patchbay lettering and translucent interface panels.

REQUIREMENTS
Windows 10 or Windows 11, 64-bit. The Electron runtime is included.
No Node, npm, server, account or internet connection is required to use the app.

INSTALL
Run Patchbay-@VERSION@-Setup-x64.exe and follow the setup wizard.
The default folder is %LOCALAPPDATA%\Programs\Patchbay. Installation is for
your Windows account; desktop and Start menu shortcuts are created.
Close an existing Patchbay window after saving before installing an update.

PORTABLE
Extract Patchbay-@VERSION@-Windows-x64.zip completely, then open Patchbay.exe.
Keep the executable together with every extracted file and folder.

DATA AND UNINSTALL
Drawings and preferences recover under your Windows profile in
%APPDATA%\Patchbay. Save drawings as .patchbay files to share them.
Use Windows Settings > Apps to uninstall the installed application.
The uninstaller retains saved application data. The portable copy stores its
preferences in the same user profile and can be removed by deleting its folder.

SIGNING AND INTEGRITY
This build is unsigned; Windows may show an unknown publisher notice.
SHA256SUMS.txt lists the hashes of the shared files. In PowerShell, run
Get-FileHash -Algorithm SHA256 <file> and compare the result to that list.

LICENSES
Patchbay uses the MIT license (PATCHBAY-LICENSE.txt).
Electron/Chromium notices are LICENSE and LICENSES.chromium.html.
Nunito font license is licenses\Nunito-OFL.txt.

QUICK START
Choose a preset in Machines, load its input and press Play or Step.
In Editor, add or double-click to place states. Drag to arrange them; Connect
draws an arrow from a source to a target. The inspector edits labels/outputs.
Text opens the manual definition editor. Multi-character inputs use spaces,
for example 11 01 10 00 or coin push. Reduced motion and Solid panels in
Settings provide a static scene and opaque panels when preferred.
