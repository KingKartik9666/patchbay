param([int]$AppProcessId, [string]$Title, [string]$FilePath, [switch]$Cancel)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeDialog {
  public delegate bool Visitor(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr window, Visitor visit, IntPtr state);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window,StringBuilder text,int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window,int message,IntPtr parameter,string text);
}
'@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Title)
)
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  $dialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
  if (!$dialog) { Start-Sleep -Milliseconds 100 }
} while (!$dialog -and [DateTime]::UtcNow -lt $deadline)
if (!$dialog) { throw "Native dialog not found: $Title" }
if (!$Cancel) {
  # Explorer exposes a virtual FileNameControlHost without ValuePattern on
  # this Windows build. Its native filename Edit remains scoped to this dialog.
  $edits = [System.Collections.Generic.List[IntPtr]]::new()
  $visit = [NativeDialog+Visitor]{param($handle,$state)
    $class = [System.Text.StringBuilder]::new(256)
    [void][NativeDialog]::GetClassName($handle,$class,256)
    if($class.ToString() -eq 'Edit' -and [NativeDialog]::GetDlgCtrlID($handle) -in @(1001,1148) -and [NativeDialog]::IsWindowVisible($handle)) { $edits.Add($handle) }
    return $true
  }
  do {
    $edits.Clear()
    [void][NativeDialog]::EnumChildWindows([IntPtr]$dialog.Current.NativeWindowHandle,$visit,[IntPtr]::Zero)
    if($edits.Count -eq 0) { Start-Sleep -Milliseconds 100 }
  } while($edits.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
  if($edits.Count -ne 1) { throw "Native filename editor is missing or ambiguous ($($edits.Count) visible candidates)." }
  [void][NativeDialog]::SendMessage($edits[0],0x000c,[IntPtr]::Zero,$FilePath)
}
$actionId = if($Cancel) { 2 } else { 1 }
$buttons = [System.Collections.Generic.List[IntPtr]]::new()
$visitButton = [NativeDialog+Visitor]{param($handle,$state)
  $class = [System.Text.StringBuilder]::new(256)
  [void][NativeDialog]::GetClassName($handle,$class,256)
  if($class.ToString() -eq 'Button' -and [NativeDialog]::GetDlgCtrlID($handle) -eq $actionId) { $buttons.Add($handle) }
  return $true
}
[void][NativeDialog]::EnumChildWindows([IntPtr]$dialog.Current.NativeWindowHandle,$visitButton,[IntPtr]::Zero)
if($buttons.Count -ne 1) { throw 'Native dialog action is missing or ambiguous.' }
[void][NativeDialog]::SendMessage($buttons[0],0x00f5,[IntPtr]::Zero,$null)
