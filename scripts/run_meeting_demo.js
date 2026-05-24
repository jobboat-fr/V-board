#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const demo = path.join(root, "packages", "meeting-room", "scripts", "demo_meeting_room.py");

function candidates() {
  const names = [];
  if (process.env.PYTHON) names.push({ cmd: process.env.PYTHON, args: [] });
  const venv = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  names.push({ cmd: venv, args: [] });
  names.push({ cmd: "python3", args: [] });
  names.push({ cmd: "python", args: [] });
  if (process.platform === "win32") names.push({ cmd: "py", args: ["-3"] });

  const codexRuntime = process.platform === "win32"
    ? path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
    : path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "bin", "python");
  names.push({ cmd: codexRuntime, args: [] });
  return names;
}

function executableExists(cmd) {
  return cmd.includes(path.sep) ? fs.existsSync(cmd) : true;
}

for (const candidate of candidates()) {
  if (!executableExists(candidate.cmd)) continue;
  const version = spawnSync(candidate.cmd, [...candidate.args, "--version"], { encoding: "utf8" });
  if (version.status !== 0) continue;
  const result = spawnSync(candidate.cmd, [...candidate.args, demo], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: path.join(root, "packages", "meeting-room") }
  });
  process.exit(result.status ?? 1);
}

console.error("No usable Python interpreter found. Set PYTHON=/path/to/python and retry npm run demo:meeting.");
process.exit(1);