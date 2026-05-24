#!/usr/bin/env node
"use strict";
const fs = require("fs");
const text = fs.readFileSync(0, "utf8");
const bad = [/let me check/i, /i'?ll (read|check|inspect|look)/i, /to assemble the\s*$/i, /what do you want me to tackle/i, /no TASKS\.md/i, /no TODO\.md/i];
const failures = [];
if (text.trim().length < 120) failures.push("TOO_SHORT");
if (!/[.!?)]\s*$/.test(text.trim())) failures.push("PARTIAL_SENTENCE_END");
for (const re of bad) if (re.test(text)) failures.push(`FORBIDDEN_PROCESS_NARRATION:${re}`);
console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
process.exit(failures.length ? 2 : 0);