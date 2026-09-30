param(
  [Parameter(Mandatory=$true)][string]$ExtensionPath,
  [string]$InstallDirectory = "$env:LOCALAPPDATA\DocsPacedTypingUpdater",
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$GitPath = (Get-Command git -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
$taskTarget = (Resolve-Path -LiteralPath $ExtensionPath).Path
$taskManifest = Get-Content -LiteralPath (Join-Path $taskTarget 'manifest.json') -Raw | ConvertFrom-Json
if ($taskManifest.name -ne 'Docs Paced Typing') { throw 'Select the Docs Paced Typing extension folder.' }
if ($NodePath.Contains('"') -or $InstallDirectory.Contains('"')) { throw 'Unsupported quote in path.' }
New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update.mjs') -Destination (Join-Path $InstallDirectory 'update.mjs') -Force
$taskConfigPath = Join-Path $InstallDirectory 'config.json'
$taskConfigJson = @{ target = $taskTarget; git = $GitPath } | ConvertTo-Json
[IO.File]::WriteAllText($taskConfigPath, $taskConfigJson, [Text.UTF8Encoding]::new($false))
# Run once before registration; authentication or validation failures leave no scheduled task.
& $NodePath (Join-Path $InstallDirectory 'update.mjs') $taskConfigPath
if ($LASTEXITCODE -ne 0) { throw 'Initial update failed. Resolve the error before installing the scheduled task.' }
$taskScript = Join-Path $InstallDirectory 'run-hidden.vbs'
$taskCommand = '"' + $NodePath + '" "' + (Join-Path $InstallDirectory 'update.mjs') + '" "' + $taskConfigPath + '"'
$taskVbs = 'WScript.Quit CreateObject("WScript.Shell").Run("' + $taskCommand.Replace('"','""') + '", 0, True)'
[IO.File]::WriteAllText($taskScript, $taskVbs)
$taskAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument ('"' + $taskScript + '"')
$taskTriggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Docs Paced Typing GitHub Updater' -Action $taskAction -Trigger $taskTriggers -Settings $taskSettings -Principal $taskPrincipal -Description 'Pulls bummah08/docs-paced-typing main every five minutes and updates the configured unpacked extension.' -Force | Out-Null
Write-Output "Updater installed for $taskTarget. Reload the extension once in Opera to activate its update watcher."
