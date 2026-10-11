#!/usr/bin/env node

/**
 * Auto-Commit & Auto-Push Watcher
 * 
 * Periodically checks for:
 * 1. Uncommitted working tree changes (modified, added, untracked, deleted files) -> stages, commits, and pushes.
 * 2. Unpushed local commits -> pushes to the remote repository.
 * 
 * Default interval: 1 hour (60 minutes).
 * Default push: ENABLED (pushes automatically to remote).
 * 
 * Usage:
 *   node scripts/auto-commit.mjs
 *   npm run auto-commit
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

function printHelp() {
  console.log(`
Auto-Commit & Auto-Push Watcher (1-Hour Interval Git Monitor)

Usage:
  node scripts/auto-commit.mjs [options]
  npm run auto-commit

Options:
  -i, --interval <minutes>    Interval in minutes between checks (default: 60)
  -s, --seconds <seconds>     Interval in seconds (convenient for testing)
  -o, --once                  Run a single check and exit immediately
  -d, --dry-run               Check and show changes/unpushed commits without committing or pushing
      --no-push               Disable automatic git push
  -m, --message <prefix>      Commit message prefix (default: "auto(checkpoint)")
  -w, --wait-first            Wait the interval before the first check (default: runs immediately)
  -h, --help                  Show this help text
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    intervalMinutes: 60,
    intervalSeconds: null,
    once: false,
    dryRun: false,
    push: true, // Enabled by default as requested
    waitFirst: false,
    messagePrefix: "auto(checkpoint)",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--interval" || arg === "-i") {
      const val = parseFloat(args[++i]);
      if (!isNaN(val) && val > 0) options.intervalMinutes = val;
    } else if (arg === "--seconds" || arg === "-s") {
      const val = parseFloat(args[++i]);
      if (!isNaN(val) && val > 0) options.intervalSeconds = val;
    } else if (arg === "--once" || arg === "-o") {
      options.once = true;
    } else if (arg === "--dry-run" || arg === "-d") {
      options.dryRun = true;
    } else if (arg === "--no-push") {
      options.push = false;
    } else if (arg === "--push" || arg === "-p") {
      options.push = true;
    } else if (arg === "--wait-first" || arg === "-w") {
      options.waitFirst = true;
    } else if (arg === "--message" || arg === "-m") {
      options.messagePrefix = args[++i] || options.messagePrefix;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function runGit(args, options = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (err) {
    if (options.ignoreError) return null;
    throw err;
  }
}

function getGitBranch() {
  try {
    return runGit(["branch", "--show-current"]);
  } catch {
    return "unknown";
  }
}

function hasGitRemote() {
  try {
    const remotes = runGit(["remote"]);
    return remotes.length > 0;
  } catch {
    return false;
  }
}

function getRemoteUrl() {
  try {
    return runGit(["remote", "get-url", "origin"]);
  } catch {
    return "none";
  }
}

function getGitStatus() {
  return runGit(["status", "--porcelain"]);
}

function getUnpushedCommitsCount() {
  try {
    const count = runGit(["rev-list", "@{u}..HEAD", "--count"], { ignoreError: true });
    return count ? parseInt(count, 10) : 0;
  } catch {
    return 0;
  }
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function pushToRemote(nowStr, branch) {
  if (!hasGitRemote()) {
    console.log(`[${nowStr}] [NOTE] Push skipped: no git remote is configured.`);
    return false;
  }

  console.log(`[${nowStr}] [+] Running: git push`);
  try {
    runGit(["push"]);
    console.log(`[${nowStr}] [SUCCESS] Pushed commits to remote repository.`);
    return true;
  } catch {
    // If upstream branch is not set, set it automatically
    try {
      console.log(`[${nowStr}] [*] Setting upstream: git push -u origin ${branch}`);
      runGit(["push", "-u", "origin", branch]);
      console.log(`[${nowStr}] [SUCCESS] Pushed and set upstream branch origin/${branch}.`);
      return true;
    } catch (pushErr) {
      console.error(`[${nowStr}] [WARNING] git push failed: ${pushErr.message}`);
      return false;
    }
  }
}

function checkAndCommit(options) {
  const nowStr = formatTimestamp();
  const branch = getGitBranch();
  const statusOutput = getGitStatus();
  const unpushedBefore = getUnpushedCommitsCount();

  let committed = false;

  // 1. Check for working tree changes
  if (statusOutput) {
    const lines = statusOutput.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
    const count = lines.length;
    console.log(`\n[${nowStr}] [!] Detected ${count} modified/untracked file${count === 1 ? "" : "s"}:`);
    for (const line of lines.slice(0, 10)) {
      console.log(`    ${line}`);
    }
    if (lines.length > 10) {
      console.log(`    ... and ${lines.length - 10} more files`);
    }

    if (options.dryRun) {
      console.log(`[${nowStr}] [DRY-RUN] Changes sensed, but dry-run mode is enabled. Skipping commit & push.\n`);
      return;
    }

    // Stage changes
    console.log(`[${nowStr}] [+] Running: git add -A`);
    runGit(["add", "-A"]);

    // Build commit message
    const title = `${options.messagePrefix}: ${nowStr} (${count} file${count === 1 ? "" : "s"} updated)`;
    const fileList = lines.slice(0, 20).map((l) => `  * ${l}`).join("\n");
    const overflow = lines.length > 20 ? `\n  * ... and ${lines.length - 20} more files` : "";
    const body = `Automated checkpoint commit.\nChanged files:\n${fileList}${overflow}`;

    console.log(`[${nowStr}] [+] Running: git commit -m "${title}"`);
    runGit(["commit", "-m", title, "-m", body]);

    const commitHash = runGit(["rev-parse", "--short", "HEAD"]);
    console.log(`[${nowStr}] [SUCCESS] Committed as ${commitHash} on branch [${branch}].`);
    committed = true;
  }

  // 2. Push if changes were just committed OR if unpushed commits exist
  const unpushedNow = getUnpushedCommitsCount();
  if (options.push && (committed || unpushedNow > 0)) {
    if (options.dryRun) {
      console.log(`[${nowStr}] [DRY-RUN] Would push ${unpushedNow} commit(s) to remote.`);
    } else {
      console.log(`[${nowStr}] [!] Pushing ${unpushedNow} commit(s) to remote...`);
      pushToRemote(nowStr, branch);
    }
  } else if (!committed && unpushedNow === 0) {
    console.log(`[${nowStr}] Status: Clean. No uncommitted changes or unpushed commits.`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs();
  const intervalSeconds = options.intervalSeconds ?? (options.intervalMinutes * 60);
  const intervalMs = intervalSeconds * 1000;

  console.log("==================================================");
  console.log("  MilestoneVault Auto-Commit & Auto-Push Watcher");
  console.log("==================================================");
  console.log(`Branch:           ${getGitBranch()}`);
  console.log(`Remote:           ${getRemoteUrl()}`);
  console.log(`Check Interval:   ${intervalSeconds >= 60 ? (intervalSeconds / 60) + " minute(s)" : intervalSeconds + " second(s)"}`);
  console.log(`Commit Prefix:    "${options.messagePrefix}"`);
  console.log(`Auto-Push:        ${options.push ? "Enabled (commits + pushes)" : "Disabled"}`);
  console.log(`Dry-Run Mode:     ${options.dryRun ? "Enabled" : "Disabled"}`);
  console.log(`Single Check:     ${options.once ? "Yes" : "No"}`);
  console.log("==================================================");

  let isRunning = true;

  process.on("SIGINT", () => {
    console.log("\n[!] Received Ctrl+C. Stopping auto-commit watcher gracefully...");
    isRunning = false;
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n[!] Terminating auto-commit watcher...");
    isRunning = false;
    process.exit(0);
  });

  if (options.waitFirst) {
    const nextCheck = new Date(Date.now() + intervalMs);
    console.log(`Waiting ${options.intervalMinutes}m before first check (at ${formatTimestamp(nextCheck)})...`);
    await sleep(intervalMs);
  }

  while (isRunning) {
    try {
      checkAndCommit(options);
    } catch (err) {
      console.error(`[${formatTimestamp()}] [ERROR] Check failed: ${err.message}`);
    }

    if (options.once) {
      break;
    }

    const nextTime = new Date(Date.now() + intervalMs);
    console.log(`Next check scheduled at ${formatTimestamp(nextTime)} (~${options.intervalMinutes >= 1 ? options.intervalMinutes + "m" : intervalSeconds + "s"}).`);
    await sleep(intervalMs);
  }
}

main();
