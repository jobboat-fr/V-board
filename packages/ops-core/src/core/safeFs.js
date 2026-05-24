"use strict";

const fs = require("fs");
const path = require("path");

function resolveSafe(root, requestedPath) {
  const base = path.resolve(root);
  const target = path.resolve(base, requestedPath || ".");
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    const error = new Error("PATH_OUTSIDE_DATA_ROOT");
    error.code = "PATH_OUTSIDE_DATA_ROOT";
    error.status = 403;
    throw error;
  }
  return target;
}

function readText(root, requestedPath) {
  const target = resolveSafe(root, requestedPath);
  return fs.readFileSync(target, "utf8");
}

function writeText(root, requestedPath, content) {
  const target = resolveSafe(root, requestedPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return { path: requestedPath, bytes: Buffer.byteLength(content) };
}

function listFiles(root, requestedPath = ".") {
  const target = resolveSafe(root, requestedPath);
  return fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "directory" : "file"
  }));
}

module.exports = { resolveSafe, readText, writeText, listFiles };
