<#
.SYNOPSIS
    MilestoneVault Auto-Commit Watcher (PowerShell)
    Monitors the git repository and commits changes every 1 hour (or custom interval).

.DESCRIPTION
    Checks 'git status --porcelain' periodically.
    If modified, added, or deleted files are detected, stages and commits them.

.PARAMETER IntervalMinutes
    Interval between checks in minutes. Default: 60 (1 hour).

.PARAMETER Once
    Run a single check and exit.

.PARAMETER DryRun
    Check for changes without staging or committing.

.PARAMETER Push
    Push commits to remote if a remote is configured.

.PARAMETER WaitFirst
    Wait the interval before running the first check.

.PARAMETER Prefix
    Commit message prefix. Default: 'auto(checkpoint)'.

.EXAMPLE
    .\scripts\auto-commit.ps1
    .\scripts\auto-commit.ps1 -IntervalMinutes 30 -Push
    .\scripts\auto-commit.ps1 -DryRun
#>

param(
    [int]$IntervalMinutes = 60,
    [switch]$Once,
    [switch]$DryRun,
    [switch]$Push,
    [switch]$WaitFirst,
    [string]$Prefix = "auto(checkpoint)"
)

function Get-Timestamp {
    return (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

function Check-And-Commit {
    $nowStr = Get-Timestamp
    $status = git status --porcelain

    if (-not $status) {
        Write-Host "[$nowStr] Status: Clean. No uncommitted changes detected." -ForegroundColor DarkGray
        return
    }

    $lines = $status -split "`r?`n" | Where-Object { $_ -ne "" }
    $count = $lines.Count

    Write-Host "`n[$nowStr] [!] Detected $count modified/untracked file(s):" -ForegroundColor Yellow
    foreach ($line in ($lines | Select-Object -First 10)) {
        Write-Host "    $line" -ForegroundColor Yellow
    }
    if ($count -gt 10) {
        Write-Host "    ... and ($($count - 10)) more files" -ForegroundColor DarkGray
    }

    if ($DryRun) {
        Write-Host "[$nowStr] [DRY-RUN] Changes sensed, but -DryRun is enabled. Skipping commit.`n" -ForegroundColor Cyan
        return
    }

    Write-Host "[$nowStr] [+] Running: git add -A" -ForegroundColor Cyan
    git add -A

    $branch = git branch --show-current
    $title = "$Prefix`: $nowStr ($count file(s) updated)"
    $fileList = ($lines | Select-Object -First 20 | ForEach-Object { "  * $_" }) -join "`n"
    $overflow = if ($count -gt 20) { "`n  * ... and ($($count - 20)) more files" } else { "" }
    $body = "Automated checkpoint commit.`nChanged files:`n$fileList$overflow"

    Write-Host "[$nowStr] [+] Running: git commit" -ForegroundColor Cyan
    git commit -m "$title" -m "$body"

    $hash = git rev-parse --short HEAD
    Write-Host "[$nowStr] [SUCCESS] Committed as $hash on branch [$branch]." -ForegroundColor Green

    if ($Push) {
        $remotes = git remote
        if ($remotes) {
            Write-Host "[$nowStr] [+] Running: git push" -ForegroundColor Cyan
            git push
            Write-Host "[$nowStr] [SUCCESS] Pushed to remote." -ForegroundColor Green
        } else {
            Write-Host "[$nowStr] [NOTE] -Push enabled, but no git remote is configured." -ForegroundColor DarkGray
        }
    }
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  MilestoneVault Auto-Commit Watcher (PowerShell) " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Interval:      $IntervalMinutes minute(s)"
Write-Host "Commit Prefix: '$Prefix'"
Write-Host "Dry Run:       $($DryRun.IsPresent)"
Write-Host "Auto Push:     $($Push.IsPresent)"
Write-Host "Single Run:    $($Once.IsPresent)"
Write-Host "==================================================" -ForegroundColor Cyan

$intervalSeconds = [int]($IntervalMinutes * 60)

if ($WaitFirst) {
    $nextDate = (Get-Date).AddSeconds($intervalSeconds).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "Waiting $IntervalMinutes minute(s) before first check (at $nextDate)..."
    Start-Sleep -Seconds $intervalSeconds
}

while ($true) {
    try {
        Check-And-Commit
    } catch {
        Write-Host "[$((Get-Timestamp))] [ERROR] Check failed: $_" -ForegroundColor Red
    }

    if ($Once) {
        break
    }

    $nextDate = (Get-Date).AddSeconds($intervalSeconds).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "Next check scheduled at $nextDate (~$IntervalMinutes minute(s)). Press Ctrl+C to stop." -ForegroundColor DarkGray
    Start-Sleep -Seconds $intervalSeconds
}
