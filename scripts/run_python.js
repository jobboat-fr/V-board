#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function candidates() {
  const out = [];
  if (process.env.PYTHON) out.push({ cmd: process.env.PYTHON, args: [] });
  out.push({
    cmd: process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python"),
    args: []
  });
  out.push({ cmd: "python3", args: [] });
  out.push({ cmd: "python", args: [] });
  if (process.platform === "win32") out.push({ cmd: "py", args: ["-3"] });
  out.push({
    cmd: process.platform === "win32"
      ? path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
      : path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "bin", "python"),
    args: []
  });
  return out;
}

function maybeExists(cmd) {
  return cmd.includes(path.sep) ? fs.existsSync(cmd) : true;
}

if (!args.length) {
  console.error("Usage: node scripts/run_python.js <python args...>");
  process.exit(2);
}

for (const candidate of candidates()) {
  if (!maybeExists(candidate.cmd)) continue;
  const version = spawnSync(candidate.cmd, [...candidate.args, "--version"], { encoding: "utf8" });
  if (version.status !== 0) continue;
  const result = spawnSync(candidate.cmd, [...candidate.args, ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: path.join(root, "packages", "meeting-room") }
  });
  process.exit(result.status ?? 1);
}

console.error("No usable Python interpreter found. Set PYTHON=/path/to/python and retry.");
process.exit(1);