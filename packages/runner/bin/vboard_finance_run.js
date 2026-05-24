#!/usr/bin/env node
"use strict";
const WORKSPACE = process.env.VBOARD_WORKSPACE || "/workspace";
const { buildCfoStack, financeStatus } = require(require("path").join(WORKSPACE, "bin/vboard_cfo_stack.js"));
const DATA_ROOT = process.env.VBOARD_DATA_ROOT || WORKSPACE;
const command = process.argv[2] || "build";
if (command === "build") {
  const result = buildCfoStack(DATA_ROOT);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 2;
} else if (command === "status") {
  const status = financeStatus(DATA_ROOT);
  process.stdout.write(JSON.stringify(status, null, 2) + "\n");
} else {
  process.stderr.write("Usage: vboard_finance_run.js [build|status]\n");
  process.exitCode = 1;
}
