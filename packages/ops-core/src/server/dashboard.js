"use strict";

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VBOARD Ops Live</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0e1117;
      --panel: #161b22;
      --panel-2: #0f1623;
      --text: #e6edf3;
      --muted: #8b949e;
      --line: #30363d;
      --ok: #3fb950;
      --warn: #d29922;
      --bad: #f85149;
      --accent: #58a6ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: #0b0f15;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    h1 { font-size: 18px; margin: 0; letter-spacing: 0; }
    .sub { color: var(--muted); font-size: 12px; }
    main { padding: 18px; max-width: 1440px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 12px; }
    .wide { grid-column: span 2; }
    .full { grid-column: 1 / -1; }
    section, .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-width: 0;
    }
    h2 { font-size: 13px; margin: 0 0 10px; color: #c9d1d9; letter-spacing: 0; }
    .metric { font-size: 26px; font-weight: 700; margin-top: 4px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 12px; }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid var(--line); padding: 9px 0; }
    .row:first-child { border-top: 0; padding-top: 0; }
    label { display: block; color: var(--muted); font-size: 12px; margin-bottom: 5px; }
    input, textarea, select {
      width: 100%;
      background: #0b111b;
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      font: inherit;
      min-height: 38px;
    }
    textarea { min-height: 76px; resize: vertical; }
    button {
      border: 1px solid #2f81f7;
      background: #1f6feb;
      color: white;
      border-radius: 6px;
      padding: 9px 12px;
      font-weight: 650;
      cursor: pointer;
      white-space: nowrap;
    }
    button.secondary { background: #21262d; border-color: var(--line); }
    pre {
      margin: 0;
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      overflow: auto;
      max-height: 390px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--line); padding: 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 650; font-size: 12px; }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
      .wide { grid-column: span 1; }
      header { align-items: flex-start; flex-direction: column; gap: 10px; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>VBOARD Ops Live</h1>
      <div class="sub">API health, routing, auth scopes, request logs, event sink</div>
    </div>
    <div class="pill" id="refreshState">Starting</div>
  </header>
  <main>
    <div class="grid">
      <section>
        <h2>API Health</h2>
        <div class="metric" id="healthMetric">...</div>
        <div class="sub" id="healthSub">waiting</div>
      </section>
      <section>
        <h2>Ready</h2>
        <div class="metric" id="readyMetric">...</div>
        <div class="sub" id="readySub">waiting</div>
      </section>
      <section>
        <h2>Events</h2>
        <div class="metric" id="eventMetric">0</div>
        <div class="sub" id="eventSub">local JSONL</div>
      </section>
      <section>
        <h2>Errors</h2>
        <div class="metric" id="errorMetric">0</div>
        <div class="sub" id="errorSub">last 1000 events</div>
      </section>

      <section class="wide">
        <h2>Access Token</h2>
        <label for="token">Bearer token for protected observability endpoints</label>
        <input id="token" type="password" placeholder="Paste OWNER_ADMIN_API_KEY or DEVOPS_AUDIT_API_KEY">
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <button id="saveToken">Save locally</button>
          <button class="secondary" id="clearToken">Clear</button>
          <button class="secondary" id="refreshNow">Refresh now</button>
        </div>
      </section>

      <section class="wide">
        <h2>Event Sink</h2>
        <div id="eventSinkRows"></div>
      </section>

      <section class="wide">
        <h2>Department Dispatch Test</h2>
        <div class="row">
          <div style="flex:1">
            <label for="department">Department</label>
            <select id="department">
              <option value="crm">crm</option>
              <option value="front-desk">front-desk</option>
              <option value="finance">finance</option>
              <option value="legal">legal</option>
              <option value="devops">devops</option>
              <option value="quality">quality</option>
            </select>
          </div>
          <div style="width:120px">
            <label for="urgency">Urgency</label>
            <select id="urgency">
              <option>P3</option><option>P2</option><option>P1</option><option>P0</option>
            </select>
          </div>
        </div>
        <label for="prompt">Prompt</label>
        <textarea id="prompt">Add CRM note for a cold public prospect, no commitment.</textarea>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <button id="sendDispatch">Run dispatch</button>
          <button class="secondary" id="sendObsTest">Write test log</button>
        </div>
      </section>

      <section class="wide">
        <h2>Last Action Result</h2>
        <pre id="actionResult">No action yet.</pre>
      </section>

      <section class="full">
        <h2>Recent API Events</h2>
        <table>
          <thead><tr><th>Time</th><th>Status</th><th>Method</th><th>Path</th><th>Key</th><th>Route</th><th>Duration</th></tr></thead>
          <tbody id="eventsBody"></tbody>
        </table>
      </section>
    </div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const tokenInput = $("token");
    tokenInput.value = localStorage.getItem("vboard.ops.token") || "";

    function authHeaders() {
      const token = tokenInput.value.trim();
      return token ? { authorization: "Bearer " + token } : {};
    }
    async function getJson(path, protectedRoute = false) {
      const headers = protectedRoute ? authHeaders() : {};
      const response = await fetch(path, { headers });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      if (!response.ok) throw Object.assign(new Error(body.error || response.statusText), { body, status: response.status });
      return body;
    }
    async function postJson(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(body)
      });
      const json = await response.json();
      if (!response.ok) throw Object.assign(new Error(json.error || response.statusText), { body: json, status: response.status });
      return json;
    }
    function setMetric(id, value, cls) {
      const el = $(id);
      el.textContent = value;
      el.className = "metric " + (cls || "");
    }
    function rows(map) {
      return Object.entries(map || {}).map(([k, v]) => '<div class="row"><span>' + k + '</span><strong>' + v + '</strong></div>').join("") || '<div class="sub">No data yet</div>';
    }
    async function refresh() {
      $("refreshState").textContent = "Refreshing";
      try {
        const health = await getJson("/health");
        setMetric("healthMetric", health.ok ? "OK" : "BAD", health.ok ? "ok" : "bad");
        $("healthSub").textContent = health.service + " " + health.version + " at " + health.time;
      } catch (error) {
        setMetric("healthMetric", "BAD", "bad");
        $("healthSub").textContent = error.message;
      }
      try {
        const ready = await getJson("/ready");
        setMetric("readyMetric", ready.ok ? "READY" : "NO", ready.ok ? "ok" : "bad");
        $("readySub").textContent = "auth=" + ready.authConfigured + " council=" + ready.councilConfigured;
      } catch (error) {
        setMetric("readyMetric", "BAD", "bad");
        $("readySub").textContent = error.message;
      }
      try {
        const summary = await getJson("/v1/observability/summary", true);
        setMetric("eventMetric", summary.totalEvents || 0, "ok");
        setMetric("errorMetric", summary.errorEvents || 0, summary.errorEvents ? "warn" : "ok");
        $("eventSub").textContent = summary.logsPath || "local JSONL";
        $("eventSinkRows").innerHTML = rows({
          configured: summary.eventSink?.configured,
          ok: summary.eventSink?.ok,
          tokenConfigured: summary.eventSink?.tokenConfigured,
          lastSuccessAt: summary.eventSink?.lastSuccessAt || "n/a",
          lastError: summary.eventSink?.lastError || "none"
        });
      } catch (error) {
        $("eventSinkRows").innerHTML = '<div class="bad">Protected endpoints need a valid token: ' + error.message + '</div>';
      }
      try {
        const events = await getJson("/v1/observability/events?limit=60", true);
        $("eventsBody").innerHTML = (events.events || []).map((event) => '<tr>' +
          '<td>' + (event.ts || "") + '</td>' +
          '<td>' + (event.status || "") + '</td>' +
          '<td>' + (event.method || "") + '</td>' +
          '<td>' + (event.path || "") + '</td>' +
          '<td>' + (event.keyName || "") + '</td>' +
          '<td>' + (event.route || "") + '</td>' +
          '<td>' + (event.durationMs || "") + 'ms</td>' +
        '</tr>').join("");
      } catch {}
      $("refreshState").textContent = "Live";
    }
    $("saveToken").onclick = () => { localStorage.setItem("vboard.ops.token", tokenInput.value.trim()); refresh(); };
    $("clearToken").onclick = () => { localStorage.removeItem("vboard.ops.token"); tokenInput.value = ""; refresh(); };
    $("refreshNow").onclick = refresh;
    $("sendObsTest").onclick = async () => {
      try {
        $("actionResult").textContent = JSON.stringify(await postJson("/v1/observability/test", { source: "dashboard" }), null, 2);
        refresh();
      } catch (error) {
        $("actionResult").textContent = JSON.stringify(error.body || { error: error.message }, null, 2);
      }
    };
    $("sendDispatch").onclick = async () => {
      try {
        $("actionResult").textContent = JSON.stringify(await postJson("/v1/departments/dispatch", {
          department: $("department").value,
          payload: { prompt: $("prompt").value, urgency: $("urgency").value }
        }), null, 2);
        refresh();
      } catch (error) {
        $("actionResult").textContent = JSON.stringify(error.body || { error: error.message }, null, 2);
      }
    };
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}

module.exports = { dashboardHtml };
