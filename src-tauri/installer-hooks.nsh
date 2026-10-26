; Require the shared Evergreen Runtime before installation; this package is offline.
; https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  ; Tauri selects the x64 registry view. EdgeUpdate's machine key is in the x86 view.
  ReadRegStr $R0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $R0 != ""
  ${AndIf} $R0 != "0.0.0.0"
    Goto patchbay_webview_ready
  ${EndIf}
  ${If} $R1 != ""
  ${AndIf} $R1 != "0.0.0.0"
    Goto patchbay_webview_ready
  ${EndIf}
  Pop $R1
  Pop $R0
  MessageBox MB_OK|MB_ICONSTOP "Patchbay requires Microsoft Edge WebView2 Runtime. Install Microsoft's Evergreen Standalone Installer (x64), then run this installer again. This package does not download the runtime." /SD IDOK
  SetErrorLevel 2
  Abort
  patchbay_webview_ready:
  Pop $R1
  Pop $R0
!macroend
