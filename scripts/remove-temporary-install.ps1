$ErrorActionPreference = 'Stop'
# Remove only this session's generated duplicate files, never unknown contents.
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bundleRoot = Join-Path $projectRoot 'release\Patchbay-win32-x64'
$temporaryRoot = [System.IO.Path]::GetFullPath('C:\Users\HP OMEN 16\AppData\Local\Programs\Patchbay-1.2.0')
$expectedRoot = 'C:\Users\HP OMEN 16\AppData\Local\Programs\Patchbay-1.2.0'
$installedExe = 'C:\Users\HP OMEN 16\AppData\Local\Programs\Patchbay\Patchbay.exe'
if (![StringComparer]::OrdinalIgnoreCase.Equals($temporaryRoot, $expectedRoot)) { throw 'Unexpected duplicate target.' }
if (!(Test-Path -LiteralPath $temporaryRoot)) { Write-Output 'No temporary copy remains.'; exit }
$shortcutShell = New-Object -ComObject WScript.Shell
if ($shortcutShell.CreateShortcut('C:\Users\HP OMEN 16\OneDrive\Desktop\Patchbay.lnk').TargetPath -ne $installedExe) { throw 'Shortcut still uses another installation.' }
if ((Get-FileHash -LiteralPath (Join-Path $bundleRoot 'resources\app.asar')).Hash -ne (Get-FileHash -LiteralPath (Join-Path (Split-Path $installedExe) 'resources\app.asar')).Hash) { throw 'Final installation does not match the package.' }
if (Get-Process -Name Patchbay -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($temporaryRoot + '\', [StringComparison]::OrdinalIgnoreCase) }) { throw 'Temporary app is open.' }
$entries = @(Get-ChildItem -LiteralPath $temporaryRoot -Recurse -Force)
if ($entries | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }) { throw 'Unexpected link in temporary copy.' }
$packageFiles = @(Get-ChildItem -LiteralPath $bundleRoot -File -Recurse -Force)
$temporaryFiles = @($entries | Where-Object { !$_.PSIsContainer })
if ($packageFiles.Count -ne $temporaryFiles.Count) { throw 'Unknown files remain in temporary copy.' }
$verifiedFiles = @()
foreach ($packageFile in $packageFiles) {
    $relative = [System.IO.Path]::GetRelativePath($bundleRoot, $packageFile.FullName)
    $target = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot $relative))
    if (!$target.StartsWith($temporaryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected generated file path.' }
    if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Duplicate file set differs from package.' }
    if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $packageFile.FullName).Hash) { throw "Duplicate contains a changed file: $relative" }
    $verifiedFiles += $target
}
# All ownership and identity checks finish before the first mutation.
foreach ($target in $verifiedFiles) { Remove-Item -LiteralPath $target -Force }
foreach ($directory in ($entries | Where-Object { $_.PSIsContainer } | Sort-Object { $_.FullName.Length } -Descending)) {
    if (@(Get-ChildItem -LiteralPath $directory.FullName -Force).Count -eq 0) { Remove-Item -LiteralPath $directory.FullName -Force }
}
if (@(Get-ChildItem -LiteralPath $temporaryRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $temporaryRoot -Force }
Write-Output "Removed $($verifiedFiles.Count) identical generated files and their empty directories."
