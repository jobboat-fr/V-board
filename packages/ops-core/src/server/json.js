"use strict";

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html)
  });
  res.end(html);
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const ct = req.headers["content-type"] || "";
    if (req.method !== "GET" && !ct.startsWith("application/json")) {
      return reject(Object.assign(new Error("CONTENT_TYPE_MUST_BE_JSON"), { status: 415 }));
    }
    let raw = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(Object.assign(new Error("BODY_TOO_LARGE"), { status: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(Object.assign(new Error(`BAD_JSON: ${error.message}`), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

module.exports = { sendJson, sendHtml, readJson };
