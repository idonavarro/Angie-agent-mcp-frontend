# Project: angie-browser-layout-mcp (Hosted MCP — Option B)

Copy this entire document into a new repo (or paste into Cursor Agent in an empty project) to build the hosted MCP server.

**Goal:** A production-ready hosted MCP server that exposes browser-based layout diagnostics for the Elementor CX Frontend Expert agent. The deliverable is a **public HTTPS MCP endpoint URL** that Angie can register as an external MCP server.

**Consumer:** Angie Agents (my.elementor) — not Cursor IDE.

**Related docs in this repo:**
- Agent workflow: `../skills/Frontend Layout Risk Scanner.md` (Phase B)
- MCP usage instructions: `browser-layout-scan.md`

---

## 1. Mission

Build `angie-browser-layout-mcp`: a Node.js service that:

1. Implements the **Model Context Protocol** over **Streamable HTTP** (remote/hosted transport — NOT stdio).
2. Uses **Playwright (Chromium headless)** to scan live WordPress/Elementor pages.
3. Returns structured JSON for horizontal overflow, Elementor `data-id` offenders, and `!important` CSS rules.
4. Deploys to a server (Docker) and exposes a connectable MCP URL for Angie agent registration.

### Success criteria

- `GET /health` → 200
- MCP discovery works at the configured endpoint
- Tool `layout_scan` returns valid JSON for a test page with intentional horizontal overflow
- Tool `layout_scan_multi_viewport` sweeps 375 / 768 / 1280 widths
- URL allow-list blocks arbitrary domains
- Bearer auth required on MCP endpoints
- README documents the exact URL + headers for Angie MCP connection

---

## 2. Non-goals (MVP)

- No WordPress plugin changes
- No user bookmarklets / no client-side JS for users
- No screenshot storage (optional Phase 2)
- No authenticated WordPress sessions (logged-out scan only for MVP)
- No plugin deactivation or site mutations

---

## 3. Architecture

```
Angie Agent (my.elementor)
    │  MCP Streamable HTTP + Bearer token
    ▼
angie-browser-layout-mcp (Node 20 + Fastify/Express)
    │  Playwright Chromium
    ▼
Customer public WordPress URL (allow-listed host only)
```

### Stack (required)

| Component | Choice |
|-----------|--------|
| Runtime | Node.js 20 LTS |
| Language | TypeScript |
| MCP SDK | `@modelcontextprotocol/sdk` (latest) |
| Browser | `playwright` + Chromium in Docker |
| HTTP | Fastify preferred (Express OK) |
| Validation | `zod` |
| Deploy | Docker + docker-compose |

**Transport:** MCP **Streamable HTTP** server transport from `@modelcontextprotocol/sdk/server/streamableHttp.js` (or current equivalent in SDK docs). Do NOT ship stdio-only — Angie needs HTTPS URL.

If Streamable HTTP setup is unclear, read the latest MCP spec at https://modelcontextprotocol.io/specification — use the remote/server transport documented for HTTP, not legacy SSE-only unless Streamable HTTP is unavailable in the SDK version you pin.

---

## 4. MCP Server Metadata

```json
{
  "name": "angie-browser-layout",
  "version": "1.0.0",
  "description": "Live DOM layout diagnostics for Elementor CX: horizontal overflow, Elementor element offenders, !important CSS detection"
}
```

---

## 5. Tools to implement

### Tool 1: `layout_scan` (required)

**Description:** Scan a public page URL at a given viewport. Detect horizontal overflow, offending DOM nodes (prioritize Elementor `data-id`), and active `!important` CSS rules.

#### Input schema

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `url` | string (uri) | yes | — | Must be https (http allowed only if `ALLOW_INSECURE_HTTP=true`) |
| `viewport_width` | integer | no | 375 | 320–2560 |
| `viewport_height` | integer | no | 812 | 400–2000 |
| `allowed_hosts` | string[] | yes | — | Min 1 host. URL hostname must match one entry (exact or registrable domain suffix) |
| `suspect_element_ids` | string[] | no | `[]` | If provided, also return `suspect_matches` filtered to these `data-id` values |

#### Output shape

Return JSON string in MCP `content[0].text` matching:

```typescript
interface LayoutScanResult {
  url: string;
  viewport: { width: number; height: number };
  scroll: { width: number; height: number };
  has_horizontal_scroll: boolean;
  horizontal_overflow_px: number;
  offenders: Array<{
    tag: string;
    data_id: string | null;
    id: string | null;
    class: string;
    rect: {
      left: number;
      right: number;
      width: number;
      top: number;
      bottom: number;
    };
    overflow_px_right: number;
    overflow_px_left: number;
  }>;
  elementor_offenders: /* offenders filtered data_id != null, max 10 */;
  important_rules: Array<{
    selector: string;
    properties: string[];
    href: string;
  }>;
  suspect_matches?: /* offenders where data_id in suspect_element_ids */;
  duration_ms: number;
  http_status: number | null;
  error?: string;
}
```

#### Browser evaluate script

Embed exactly this logic in `src/scripts/layout-evaluate.ts`:

```javascript
() => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const scrollW = document.documentElement.scrollWidth;
  const scrollH = document.documentElement.scrollHeight;
  const offenders = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);

  while (walker.nextNode()) {
    const el = walker.currentNode;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) continue;

    const dataId = el.getAttribute("data-id");
    const overflowRight = rect.right - vw;
    const overflowLeft = -rect.left;

    if (overflowRight > 1 || overflowLeft > 1) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        data_id: dataId,
        id: el.id || null,
        class: (el.className || "").toString().slice(0, 100),
        rect: {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom)
        },
        overflow_px_right: Math.max(0, Math.round(overflowRight)),
        overflow_px_left: Math.max(0, Math.round(overflowLeft))
      });
    }
  }

  const importantRules = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    if (!rules) continue;
    for (const rule of rules) {
      if (!rule.style || !rule.cssText.includes("!important")) continue;
      const props = [];
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        if (rule.style.getPropertyPriority(prop) === "important") {
          props.push(prop);
        }
      }
      if (props.length) {
        importantRules.push({
          selector: (rule.selectorText || "").slice(0, 120),
          properties: props.slice(0, 10),
          href: sheet.href || "inline"
        });
      }
    }
  }

  offenders.sort((a, b) =>
    (b.overflow_px_right + b.overflow_px_left) - (a.overflow_px_right + a.overflow_px_left)
  );

  return {
    viewport: { width: vw, height: vh },
    scroll: { width: scrollW, height: scrollH },
    has_horizontal_scroll: scrollW > vw + 1,
    horizontal_overflow_px: Math.max(0, scrollW - vw),
    offenders: offenders.slice(0, 20),
    important_rules: importantRules.slice(0, 30),
    elementor_offenders: offenders.filter(o => o.data_id).slice(0, 10)
  };
}
```

#### Playwright execution

- Launch browser once per request (MVP) or use a singleton browser pool (nice-to-have).
- `page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })`
- On timeout → return partial result with `error: 'navigation_timeout'`, do not throw uncaught.
- Always `browser.close()` in finally block.

---

### Tool 2: `layout_scan_multi_viewport` (required)

**Description:** Run `layout_scan` logic at widths **375, 768, 1280** (heights 812 / 1024 / 800). Return array of results + summary of first breakpoint where `has_horizontal_scroll === true`.

**Input:** Same as `layout_scan` except no `viewport_width` / `viewport_height` (uses preset list).

**Output:**

```typescript
interface MultiViewportResult {
  url: string;
  scans: LayoutScanResult[];
  first_breakpoint_with_scroll: number | null; // e.g. 375
  summary: string; // human-readable one-liner for agent
}
```

---

## 6. Security (mandatory)

Implement before any public deploy:

### 6.1 Bearer auth

All MCP routes require:

```
Authorization: Bearer ${MCP_AUTH_TOKEN}
```

Reject 401 if missing or wrong. Health endpoint `/health` is unauthenticated.

### 6.2 URL allow-list

`allowed_hosts` is required on every tool call. Validate:

- Parse URL with `new URL()`
- Reject: `file:`, `data:`, `javascript:`, IP literals (optional flag to allow), localhost/private IPs unless `ALLOW_PRIVATE_URLS=true`
- Host must equal or be subdomain of an entry in `allowed_hosts`
- Redirect chain: after navigation, final URL host must still match allow-list; else error `redirect_blocked`

### 6.3 Rate limiting

30 requests/minute per Bearer token (in-memory OK for MVP).

### 6.4 Timeouts

- Navigation: 30s
- Total tool execution: 45s

### 6.5 Logging

No secrets in logs. Log url host + path only, not full query strings with tokens.

### 6.6 Environment variables

```bash
PORT=8080
MCP_AUTH_TOKEN=generate-a-long-random-string
ALLOW_INSECURE_HTTP=false
ALLOW_PRIVATE_URLS=false
NODE_ENV=production
```

---

## 7. HTTP routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /health` | no | `{ "status": "ok", "version": "1.0.0" }` |
| `GET /` | no | Service info + MCP endpoint path |
| `POST /mcp` | yes | MCP Streamable HTTP handler |
| `GET /mcp` | yes | MCP session init if required by SDK |

Document the **exact MCP URL** Angie should register, e.g.:

```
https://layout-mcp.yourdomain.com/mcp
```

---

## 8. Project structure

```
angie-browser-layout-mcp/
├── src/
│   ├── index.ts              # HTTP server bootstrap
│   ├── mcp-server.ts         # MCP server + tool registration
│   ├── tools/
│   │   ├── layout-scan.ts
│   │   └── layout-scan-multi.ts
│   ├── browser/
│   │   ├── pool.ts           # optional browser reuse
│   │   └── run-scan.ts
│   ├── security/
│   │   ├── allowlist.ts
│   │   └── auth.ts
│   └── scripts/
│       └── layout-evaluate.ts
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── scripts/
    └── smoke-test.ts         # curl health + MCP tool call
```

---

## 9. Docker

### Dockerfile requirements

- Base: `node:20-bookworm-slim`
- Install Playwright deps: `npx playwright install --with-deps chromium`
- Multi-stage build: compile TS → run `dist/`
- Expose port 8080
- `HEALTHCHECK CMD curl -f http://localhost:8080/health || exit 1`

### docker-compose.yml

- Service `mcp` with env from `.env`
- Optional: Caddy/Traefik reverse proxy with TLS (document manual TLS if not in compose)

---

## 10. Deployment guide (README section)

Include step-by-step:

1. Clone, `cp .env.example .env`, set `MCP_AUTH_TOKEN`
2. `docker compose up -d --build`
3. Verify: `curl https://YOUR_HOST/health`
4. Smoke test MCP tool with provided script
5. Register in Angie (see §11)
6. List exposed tools: `layout_scan`, `layout_scan_multi_viewport`

### Quick verify after deploy

```bash
curl -s https://YOUR_HOST/health
# Expect: {"status":"ok","version":"1.0.0"}
```

---

## 11. Angie MCP registration

Copy-paste block for platform team / Angie agent config:

```json
{
  "name": "angie-browser-layout",
  "transport": "streamable-http",
  "url": "https://YOUR_HOST/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
  }
}
```

### Exposed tools

| Tool | When agent uses it |
|------|-------------------|
| `layout_scan` | Single viewport scan (mobile 375, desktop 1280, etc.) |
| `layout_scan_multi_viewport` | User says "mobile" or "responsive" without specifying breakpoint |

If Angie UI expects a different config shape, document both the MCP URL and Bearer header separately.

---

## 12. Angie agent integration

This MCP is **Phase B** of skill **Frontend Layout Risk Scanner** (`../skills/Frontend Layout Risk Scanner.md`).

### Agent flow

1. **Phase A:** REST scan via `bulk_wordpress_request` on `_elementor_data`
2. **Phase B:** Call MCP `layout_scan` with:
   - `url` = page `link` from WordPress REST
   - `allowed_hosts` = `[hostname from connected site]`
   - `suspect_element_ids` = element IDs flagged in Phase A
   - `viewport_width` = 375 for mobile tickets, 1280 for desktop

### Result interpretation

| Field | Agent action |
|-------|--------------|
| `elementor_offenders` | Tell user which Elementor widget/container to fix (match `data_id`) |
| `important_rules` with `href` containing `/themes/` | Theme CSS issue — Customizer Additional CSS |
| `important_rules` with `href` containing `/plugins/` | Route to **wp plugin conflict troubleshooter** |
| `has_horizontal_scroll` + empty `elementor_offenders` | Cause is likely theme/global CSS outside Elementor |

See also: `browser-layout-scan.md` for full Phase B workflow and error handling.

---

## 13. Testing

### Unit tests

- `allowlist.ts`: accept/reject URLs (subdomain, redirect host, `file://`, wrong host)

### Integration test

- Serve static HTML fixture: `<div style="width:1400px">wide</div>`
- Call `layout_scan` at viewport 375 → expect `has_horizontal_scroll: true`, offenders non-empty

### Smoke script (`scripts/smoke-test.ts`)

- Hit `/health`
- Initialize MCP session
- Call `layout_scan` against a known public URL OR local fixture
- Print pass/fail

### WordPress demo scenario

1. Add HTML widget: `<div style="width:1400px;background:#ccc;">Wide block</div>`
2. Call `layout_scan` with `viewport_width: 375`, `allowed_hosts: ["your-site.com"]`
3. Expect `has_horizontal_scroll: true` and non-empty `offenders`

---

## 14. Acceptance checklist

Before marking done, verify:

- [ ] Hosted MCP URL works over HTTPS
- [ ] Bearer auth enforced
- [ ] `layout_scan` + `layout_scan_multi_viewport` registered and callable
- [ ] Horizontal overflow detected on 1400px test HTML
- [ ] Wrong host rejected with clear error
- [ ] Docker build + deploy documented
- [ ] README has Angie connection JSON block (§11)
- [ ] No bookmarklet / no user-side JS instructions

---

## 15. Implementation notes

- Pin dependency versions in `package.json`
- Use structured logging (pino)
- Return MCP errors as tool results with `isError: true` only for unrecoverable failures; navigation timeout should still return JSON payload with `error` field
- Keep tool descriptions concise — Angie agent uses them for routing
- Prefer single-purpose repo; do not merge unrelated tools
- Build the complete project. Do not leave TODO stubs for core paths. Provide working Dockerfile and README.

---

## 16. Agent prompt for Cursor / new repo

Paste this one-liner to kick off implementation in an empty project:

> You are a senior platform engineer. Read the full spec in `hosted-mcp-build-prompt.md` (or this document) and implement `angie-browser-layout-mcp` end-to-end: TypeScript, Playwright, MCP Streamable HTTP, Docker, Bearer auth, URL allow-list, tools `layout_scan` and `layout_scan_multi_viewport`. Deliver working code, Dockerfile, smoke test, and README with Angie registration block. No TODO stubs on core paths.
