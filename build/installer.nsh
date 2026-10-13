!include "WinVer.nsh"

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Patchbay requires Windows 10 or Windows 11 (64-bit)."
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    IfSilent +2
      MessageBox MB_OK|MB_ICONEXCLAMATION "Save your drawing and close Patchbay before continuing."
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend
