<#
.SYNOPSIS
    MilestoneVault Auto-Commit & Auto-Push Watcher (PowerShell)
    Monitors the git repository and commits & pushes changes every 1 hour.

.DESCRIPTION
    Checks 'git status --porcelain' and unpushed commits periodically.
    Stages, commits, and pushes to remote automatically.

.PARAMETER IntervalMinutes
    Interval between checks in minutes. Default: 60 (1 hour).

.PARAMETER Once
    Run a single check and exit.

.PARAMETER DryRun
    Check for changes without staging, committing, or pushing.

.PARAMETER NoPush
    Disable automatic git push.

.PARAMETER WaitFirst
    Wait the interval before running the first check.

.PARAMETER Prefix
    Commit message prefix. Default: 'auto(checkpoint)'.
#>

param(
    [int]$IntervalMinutes = 60,
    [switch]$Once,
    [switch]$DryRun,
    [switch]$NoPush,
    [switch]$WaitFirst,
    [string]$Prefix = "auto(checkpoint)"
)

$Push = -not $NoPush

function Get-Timestamp {
    return (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

function Get-UnpushedCount {
    try {
        $count = git rev-list '@{u}..HEAD' --count 2>$null
        if ($LASTEXITCODE -eq 0 -and $count) {
            return [int]$count
        }
    } catch {}
    return 0
}

function Push-To-Remote {
    param([string]$Branch)
    $remotes = git remote
    if (-not $remotes) {
        Write-Host "[$((Get-Timestamp))] [NOTE] Push skipped: no remote configured." -ForegroundColor DarkGray
        return
    }

    Write-Host "[$((Get-Timestamp))] [+] Running: git push" -ForegroundColor Cyan
    git push 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[$((Get-Timestamp))] [*] Setting upstream: git push -u origin $Branch" -ForegroundColor Cyan
        git push -u origin $Branch
    }
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$((Get-Timestamp))] [SUCCESS] Pushed to remote repository." -ForegroundColor Green
    } else {
        Write-Host "[$((Get-Timestamp))] [WARNING] git push failed." -ForegroundColor Red
    }
}

function Check-And-Commit {
    $nowStr = Get-Timestamp
    $branch = git branch --show-current
    $status = git status --porcelain
    $committed = $false

    if ($status) {
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
            Write-Host "[$nowStr] [DRY-RUN] Changes sensed, but -DryRun is enabled. Skipping commit & push.`n" -ForegroundColor Cyan
            return
        }

        Write-Host "[$nowStr] [+] Running: git add -A" -ForegroundColor Cyan
        git add -A

        $title = "$Prefix`: $nowStr ($count file(s) updated)"
        $fileList = ($lines | Select-Object -First 20 | ForEach-Object { "  * $_" }) -join "`n"
        $overflow = if ($count -gt 20) { "`n  * ... and ($($count - 20)) more files" } else { "" }
        $body = "Automated checkpoint commit.`nChanged files:`n$fileList$overflow"

        Write-Host "[$nowStr] [+] Running: git commit" -ForegroundColor Cyan
        git commit -m "$title" -m "$body"

        $hash = git rev-parse --short HEAD
        Write-Host "[$nowStr] [SUCCESS] Committed as $hash on branch [$branch]." -ForegroundColor Green
        $committed = $true
    }

    $unpushed = Get-UnpushedCount
    if ($Push -and ($committed -or $unpushed -gt 0)) {
        if ($DryRun) {
            Write-Host "[$nowStr] [DRY-RUN] Would push $unpushed commit(s) to remote." -ForegroundColor Cyan
        } else {
            Write-Host "[$nowStr] [!] Pushing commit(s) to remote..." -ForegroundColor Cyan
            Push-To-Remote -Branch $branch
        }
    } elseif (-not $committed -and $unpushed -eq 0) {
        Write-Host "[$nowStr] Status: Clean. No uncommitted changes or unpushed commits." -ForegroundColor DarkGray
    }
}

$remoteUrl = try { (git remote get-url origin 2>$null) } catch { "none" }
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  MilestoneVault Auto-Commit & Push (PowerShell)  " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Remote:        $remoteUrl"
Write-Host "Interval:      $IntervalMinutes minute(s)"
Write-Host "Commit Prefix: '$Prefix'"
Write-Host "Auto Push:     $Push"
Write-Host "Dry Run:       $($DryRun.IsPresent)"
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
