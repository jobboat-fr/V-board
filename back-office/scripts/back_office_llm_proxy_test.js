const fs = require('fs');

const authPath = '/home/ubuntu/.agent-runtime/agents/main/agent/auth-profiles.json';
const raw = fs.readFileSync(authPath, 'utf8');
const token = (raw.match(/hf_[A-Za-z0-9_-]+/) || [])[0];

if (!token) {
  throw new Error(`No remote LLM provider token found in ${authPath}`);
}

async function main() {
  const res = await fetch('http://127.0.0.1:18888/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'provider/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Reply exactly OK.' }],
      max_tokens: 12,
    }),
  });

  const text = await res.text();
  let body = text;
  try {
    const parsed = JSON.parse(text);
    body = parsed.choices?.[0]?.message?.content || parsed.error?.message || text;
  } catch {}

  console.log(JSON.stringify({
    status: res.status,
    ok: res.ok,
    body: String(body).slice(0, 300),
  }, null, 2));

  if (!res.ok) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
