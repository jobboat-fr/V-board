const fs = require('fs');
const path = require('path');

const workspace = '/home/ubuntu/.agent-runtime/workspace';
const sessionsDir = '/home/ubuntu/.agent-runtime/agents/main/sessions';
const agentsPath = path.join(workspace, 'AGENTS.md');
const sessionsPath = path.join(sessionsDir, 'sessions.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const archiveDir = path.join(sessionsDir, `model-switch-archive-${stamp}`);

const ownerBlockStart = '<!-- VBOARD_back office_OWNER_COMMANDS_START -->';
const ownerBlockEnd = '<!-- VBOARD_back office_OWNER_COMMANDS_END -->';
const ownerBlock = `${ownerBlockStart}

# VBOARD back office Owner Command Clarification

- Proactive, unsolicited back office-to-owner Telegram contact is reserved for P0 incidents and critical infrastructure alerts.
- Owner-requested Telegram replies, diagnostics, smoke tests, reports, and confirmations are allowed when the owner explicitly asks for them.
- Do not refuse an owner-requested operational confirmation only because it is not P0.
- For non-owner users, remain a professional Example Company representative and do not disclose internal architecture, secrets, legal/accounting data, or private operational details.

${ownerBlockEnd}
`;

if (fs.existsSync(agentsPath)) {
  let agents = fs.readFileSync(agentsPath, 'utf8');
  const pattern = new RegExp(`${ownerBlockStart}[\\s\\S]*?${ownerBlockEnd}\\n?`, 'g');
  agents = agents.replace(pattern, '').trimEnd() + '\n\n' + ownerBlock;
  fs.writeFileSync(agentsPath, agents);
}

let archived = [];
if (fs.existsSync(sessionsPath)) {
  const raw = fs.readFileSync(sessionsPath, 'utf8');
  const sessions = JSON.parse(raw);
  const ids = new Set();
  for (const value of Object.values(sessions)) {
    if (value?.sessionId) ids.add(value.sessionId);
    if (value?.id) ids.add(value.id);
  }

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.copyFileSync(sessionsPath, path.join(archiveDir, 'sessions.json.before'));

  for (const id of ids) {
    for (const file of fs.readdirSync(sessionsDir)) {
      if (file === 'sessions.json') continue;
      if (file.startsWith(id)) {
        fs.renameSync(path.join(sessionsDir, file), path.join(archiveDir, file));
        archived.push(file);
      }
    }
  }

  fs.writeFileSync(sessionsPath, JSON.stringify({}, null, 2));
}

console.log(JSON.stringify({
  ok: true,
  policyUpdated: fs.existsSync(agentsPath),
  archivedSessionFiles: archived.length,
  archiveDir,
}, null, 2));
