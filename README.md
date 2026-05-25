# angie-browser-layout-mcp

Production-ready hosted MCP server for live DOM layout diagnostics on WordPress/Elementor pages. Exposes **Streamable HTTP** MCP tools for the Angie agent platform (my.elementor).

## Features

- **`layout_scan`** — Single viewport scan for horizontal overflow, Elementor `data-id` offenders, and `!important` CSS rules
- **`layout_scan_multi_viewport`** — Sweeps 375 / 768 / 1280px widths with a summary breakpoint
- Bearer token authentication on MCP endpoints
- URL allow-list validation per tool call
- Rate limiting (30 req/min per token)
- Docker deployment with Playwright Chromium

## Quick start

```bash
cp .env.example .env
# Edit .env and set MCP_AUTH_TOKEN to a long random string

npm install
npx playwright install chromium
npm run build
MCP_AUTH_TOKEN=your-token npm start
```

Verify health:

```bash
curl -s http://localhost:8080/health
# {"status":"ok","version":"1.0.0"}
```

## Docker deployment

```bash
cp .env.example .env
# Set MCP_AUTH_TOKEN in .env

docker compose up -d --build
curl -s http://localhost:8080/health
```

For production, place a reverse proxy (Caddy, Traefik, nginx) in front for TLS.

Angie **Add MCP Server** dialog expects a single **Server URL** (HTTP/SSE endpoint). Auth goes in the query string:

```
https://YOUR_HOST/mcp?token=YOUR_MCP_AUTH_TOKEN
```

(`/api` is also supported as an alias: `https://YOUR_HOST/api?token=...`)

## Smoke test

With the server running:

```bash
MCP_AUTH_TOKEN=your-token npm run smoke
```

Optional live page scan:

```bash
BASE_URL=http://localhost:8080 \
MCP_AUTH_TOKEN=your-token \
SCAN_URL=https://your-site.com/page \
ALLOWED_HOSTS=your-site.com \
npm run smoke
```

## Angie MCP registration (Add MCP Server UI)

In Angie → **Add MCP Server**, fill the form exactly as follows:

| Angie field | Value |
|-------------|-------|
| **Name** | `Browser Layout Scanner` |
| **Description** | `Live DOM layout diagnostics: horizontal overflow, Elementor data-id offenders, !important CSS` |
| **Server URL** | `https://YOUR_HOST/mcp?token=YOUR_MCP_AUTH_TOKEN` |
| **Icon** | Any (e.g. laptop or tools) |
| **Site-scoped tools** | **ON** — Angie injects `site_url` into tool calls; the server auto-fills `allowed_hosts` from the connected WordPress site |

> Angie has no separate auth header field. Put `MCP_AUTH_TOKEN` in the Server URL as `?token=...`.  
> The endpoint supports HTTP + SSE (Streamable HTTP transport).

### Tool inputs with Site-scoped tools ON

The agent only needs to pass `url` (and optionally `viewport_width`, `suspect_element_ids`).  
`allowed_hosts` is derived automatically from Angie-injected `site_url` / `site_host`.

With Site-scoped tools **OFF**, the agent must pass `allowed_hosts` explicitly on every call.

### Legacy JSON config (non-UI integrations)

```json
{
  "name": "angie-browser-layout",
  "transport": "streamable-http",
  "url": "https://YOUR_HOST/mcp?token=YOUR_MCP_AUTH_TOKEN"
}
```

### Exposed tools

| Tool | When to use |
|------|-------------|
| `layout_scan` | Single viewport scan (e.g. 375 mobile, 1280 desktop) |
| `layout_scan_multi_viewport` | Responsive sweep when user mentions mobile/responsive without a specific breakpoint |

### Tool: `layout_scan`

**Input:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `url` | string (uri) | yes | — |
| `viewport_width` | integer | no | 375 |
| `viewport_height` | integer | no | 812 |
| `allowed_hosts` | string[] | no* | — |
| `suspect_element_ids` | string[] | no | `[]` |

\* Required unless **Site-scoped tools** is ON in Angie (then `site_url` is injected automatically).

**Output:** JSON with `has_horizontal_scroll`, `offenders`, `elementor_offenders`, `important_rules`, etc.

### Tool: `layout_scan_multi_viewport`

Same as `layout_scan` except viewport is fixed to 375/768/1280 presets. Returns `scans[]`, `first_breakpoint_with_scroll`, and `summary`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `MCP_AUTH_TOKEN` | — | **Required.** Secret token; use in Angie Server URL as `?token=` |
| `MCP_AUTH_MODE` | `bearer_or_query` | `bearer`, `query`, or `bearer_or_query` |
| `MCP_ENDPOINT_PATH` | `/mcp` | Primary MCP route |
| `MCP_ENDPOINT_ALIASES` | `/api` | Comma-separated alias routes (Angie placeholder uses `/api`) |
| `ALLOW_INSECURE_HTTP` | `false` | Allow `http://` URLs in tool calls |
| `ALLOW_PRIVATE_URLS` | `false` | Allow localhost/private IP targets |
| `NODE_ENV` | `production` | Node environment |
| `LOG_LEVEL` | `info` | Pino log level |

## HTTP routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /health` | no | Health check |
| `GET /` | no | Service info + Angie registration hints |
| `POST /mcp` (and `/api`) | `?token=` or Bearer | MCP Streamable HTTP |
| `GET /mcp` (and `/api`) | `?token=` or Bearer | MCP SSE session stream |
| `DELETE /mcp` (and `/api`) | `?token=` or Bearer | MCP session termination |

## Security

- MCP routes accept `Authorization: Bearer ${MCP_AUTH_TOKEN}` **or** `?token=${MCP_AUTH_TOKEN}` in the Server URL (Angie UI)
- Every tool call must include `allowed_hosts`; URL hostname must match exactly or as subdomain
- Redirects to disallowed hosts return `redirect_blocked`
- Blocked protocols: `file:`, `data:`, `javascript:`
- Rate limit: 30 requests/minute per bearer token
- Navigation timeout: 30s; total tool execution: 45s
- Logs include host + path only (no query strings with secrets)

## Development

```bash
npm run dev          # watch mode
npm test             # unit + integration tests
npm run build        # compile TypeScript
```

## Project structure

```
src/
├── index.ts              # Fastify HTTP server + MCP transport
├── mcp-server.ts         # MCP server + tool registration
├── tools/
│   ├── layout-scan.ts
│   └── layout-scan-multi.ts
├── browser/
│   └── run-scan.ts       # Playwright execution
├── security/
│   ├── allowlist.ts
│   ├── auth.ts
│   └── rate-limit.ts
└── scripts/
    └── layout-evaluate.ts
scripts/
└── smoke-test.ts
```

## License

Internal Elementor CX tooling.
