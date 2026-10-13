$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bundleRoot = Join-Path $projectRoot 'release\Patchbay-win32-x64'
$localPrograms = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'
$installRoot = Join-Path $localPrograms 'Patchbay'
$installedExe = Join-Path $installRoot 'Patchbay.exe'
$bundleArchive = Join-Path $bundleRoot 'resources\app.asar'

if (!(Test-Path -LiteralPath $bundleArchive -PathType Leaf)) {
    throw 'Package Patchbay before installing it.'
}
$runningApp = Get-Process -Name Patchbay -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExe }
if ($runningApp) {
    # Install beside an open older copy so its current session is never interrupted.
    $appVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
    if ($appVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected application version.' }
    $installRoot = Join-Path $localPrograms "Patchbay-$appVersion"
    $installedExe = Join-Path $installRoot 'Patchbay.exe'
    if (Get-Process -Name Patchbay -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedExe }) {
        throw 'The update version is already open. Close it after saving your drawing before reinstalling.'
    }
    Write-Output 'The older Patchbay session remains open. Installing the update beside it.'
}
$resolvedPrograms = [System.IO.Path]::GetFullPath($localPrograms).TrimEnd('\') + '\'
$resolvedInstall = [System.IO.Path]::GetFullPath($installRoot)
if (!$resolvedInstall.StartsWith($resolvedPrograms, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected installation target.' }

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Get-ChildItem -LiteralPath $bundleRoot | Copy-Item -Destination $installRoot -Recurse -Force
$installedArchive = Join-Path $installRoot 'resources\app.asar'
if ((Get-FileHash -LiteralPath $bundleArchive -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $installedArchive -Algorithm SHA256).Hash) {
    throw 'Installed application archive did not match the package.'
}
if ((Get-FileHash -LiteralPath (Join-Path $bundleRoot 'Patchbay.exe') -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash) {
    throw 'Installed executable did not match the package.'
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'Patchbay.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $installedExe
$shortcut.WorkingDirectory = $installRoot
$shortcut.IconLocation = "$installedExe,0"
$shortcut.Description = 'Patchbay - graphical Mealy and Moore machine studio'
$shortcut.Save()
if ($shortcutShell.CreateShortcut($shortcutPath).TargetPath -ne $installedExe) { throw 'Desktop shortcut target did not match the installed app.' }

Write-Output "Installed: $installedExe"
Write-Output "Desktop shortcut: $shortcutPath"
Write-Output "Archive SHA256: $((Get-FileHash -LiteralPath $installedArchive -Algorithm SHA256).Hash)"
$report = [ordered]@{
    version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
    executable = $installedExe
    shortcut = $shortcutPath
    archiveHash = (Get-FileHash -LiteralPath $installedArchive -Algorithm SHA256).Hash
    executableHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
    matchesPackage = $true
    olderSessionPreserved = [bool]$runningApp
}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'artifacts\install-report.json') -Encoding UTF8
