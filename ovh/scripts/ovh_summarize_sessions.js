const fs = require('fs');

const p = '/home/ubuntu/.openclaw/agents/main/sessions/sessions.json';
const raw = fs.readFileSync(p, 'utf8');
const parsed = JSON.parse(raw);

function pick(v) {
  return {
    sessionId: v.sessionId || v.id || v.file || null,
    provider: v.provider || v.agentMeta?.provider || null,
    model: v.model || v.agentMeta?.model || null,
    kind: v.kind || null,
    channel: v.channel || v.replyChannel || null,
    target: v.target || v.replyTo || null,
    updatedAt: v.updatedAt || v.updatedAtMs || null,
  };
}

let out;
if (Array.isArray(parsed)) {
  out = parsed.map(pick);
} else {
  out = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, pick(v || {})]));
}

console.log(JSON.stringify(out, null, 2));
