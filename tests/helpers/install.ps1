param([ValidateSet('Install','Uninstall','Shortcut')][string]$Action, [string]$Installer, [string]$Directory)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\')
$target = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
$testBase = Join-Path $workspace '.cache\install-verification'
$programs = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'
$production = Join-Path $programs 'Patchbay'
if ($target -ne $production -and !$target.StartsWith($testBase+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected Patchbay installation target.' }
$executable = Join-Path $target 'Patchbay.exe'
$result = [ordered]@{ action=$Action; directory=$target }
if ($Action -eq 'Install') {
  if (Get-CimInstance Win32_Process -Filter "name='Patchbay.exe'" | Where-Object ExecutablePath -eq $executable) { throw 'Close Patchbay before updating this installation.' }
  if ($target -eq $production -and (Test-Path -LiteralPath (Join-Path $target 'resources\app.asar'))) {
    $backup = $target+'-Electron-backup'
    if (Test-Path -LiteralPath $backup) { $backup += '-'+[DateTime]::Now.ToString('yyyyMMddHHmmss') }
    $resolvedBackup = [IO.Path]::GetFullPath($backup)
    if (!$resolvedBackup.StartsWith($programs+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $target).LinkType) { throw 'Unexpected legacy backup target.' }
    Move-Item -LiteralPath $target -Destination $resolvedBackup
    $result.legacyBackup = $resolvedBackup
  }
  $process = Start-Process -FilePath $Installer -ArgumentList @('/S',"/D=$target") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Patchbay installer exited with $($process.ExitCode)." }
  if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Installed executable is missing.' }
} elseif ($Action -eq 'Uninstall') {
  $uninstaller = Join-Path $target 'uninstall.exe'
  if (!(Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Patchbay uninstaller is missing.' }
  $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S',"_?=$target") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Patchbay uninstaller exited with $($process.ExitCode)." }
  if (Test-Path -LiteralPath $executable) { throw 'Uninstall left the application executable behind.' }
} else {
  if ($target -ne $production -or !(Test-Path -LiteralPath $executable)) { throw 'Install the production application before creating its shortcut.' }
  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Patchbay.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath=$executable; $shortcut.WorkingDirectory=$target
  $shortcut.IconLocation="$executable,0"; $shortcut.Description='Patchbay - Mealy and Moore machine workbench'
  $shortcut.Save()
  if ($shell.CreateShortcut($shortcutPath).TargetPath -ne $executable) { throw 'Desktop shortcut verification failed.' }
  $result.shortcut=$shortcutPath
}
$result | ConvertTo-Json -Compress
