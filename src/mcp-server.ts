import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import {
  executeLayoutScan,
  layoutScanInputSchema,
  parseLayoutScanInput,
  type LayoutScanInput,
} from "./tools/layout-scan.js";
import {
  executeLayoutScanMultiViewport,
  layoutScanMultiInputSchema,
  parseLayoutScanMultiInput,
  type LayoutScanMultiInput,
} from "./tools/layout-scan-multi.js";
import type { AllowlistOptions } from "./security/allowlist.js";
import { safeUrlForLog } from "./security/allowlist.js";
import {
  buildLayoutScanToolContent,
  buildMultiViewportToolContent,
} from "./mcp/tool-result.js";
import { isMcpTrafficLogEnabled, sanitizeForLog } from "./mcp/traffic-log.js";

export const MCP_NAME = "angie-browser-layout";
export const MCP_VERSION = "1.3.0";
export const MCP_DESCRIPTION =
  "Live DOM layout diagnostics for Elementor CX: horizontal overflow, Elementor element offenders, !important CSS detection";

export interface McpServerDeps {
  allowlistOptions: AllowlistOptions;
  logger: Logger;
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const { allowlistOptions, logger } = deps;

  const server = new McpServer(
    {
      name: MCP_NAME,
      version: MCP_VERSION,
      description: MCP_DESCRIPTION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.registerTool(
    "layout_scan",
    {
      description:
        "Scan a public page URL at a given viewport. Detect horizontal overflow, Elementor data-id offenders, and !important CSS. Set include_screenshot:true to return a PNG (base64 image in MCP response; uploaded URL in screenshot_meta when AGENT_IMG_TOKEN is set).",
      inputSchema: layoutScanInputSchema as any,
    },
    async (rawArgs: Record<string, unknown>) => {
      const parsed = parseLayoutScanInput(rawArgs);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: parsed.error.flatten() }) }],
          isError: true,
        };
      }

      const args: LayoutScanInput = parsed.data;

      try {
        const urlObj = new URL(args.url);
        if (isMcpTrafficLogEnabled()) {
          logger.info(
            { tool: "layout_scan", args: sanitizeForLog(args) },
            "MCP tool call"
          );
        }
        logger.info(
          { url: safeUrlForLog(urlObj), viewport: args.viewport_width },
          "layout_scan start"
        );
        const result = await executeLayoutScan(args, allowlistOptions);
        const toolContent = buildLayoutScanToolContent(result);
        if (isMcpTrafficLogEnabled()) {
          logger.info(
            {
              tool: "layout_scan",
              result: sanitizeForLog({
                ...result,
                screenshot: result.screenshot
                  ? { ...result.screenshot, base64: `[${result.screenshot.base64.length} chars]` }
                  : undefined,
              }),
              contentBlocks: toolContent.content.map((c) => c.type),
            },
            "MCP tool result"
          );
        }
        logger.info(
          {
            url: safeUrlForLog(urlObj),
            duration_ms: result.duration_ms,
            overflow: result.has_horizontal_scroll,
          },
          "layout_scan done"
        );
        return toolContent;
      } catch (err) {
        logger.error({ err }, "layout_scan failed");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "layout_scan_multi_viewport",
    {
      description:
        "Run layout_scan at 375, 768, and 1280px. Optional include_screenshot returns PNG per viewport in MCP response (uploaded URLs in screenshot_urls when AGENT_IMG_TOKEN is set).",
      inputSchema: layoutScanMultiInputSchema as any,
    },
    async (rawArgs: Record<string, unknown>) => {
      const parsed = parseLayoutScanMultiInput(rawArgs);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: parsed.error.flatten() }) }],
          isError: true,
        };
      }

      const args: LayoutScanMultiInput = parsed.data;

      try {
        const urlObj = new URL(args.url);
        if (isMcpTrafficLogEnabled()) {
          logger.info(
            { tool: "layout_scan_multi_viewport", args: sanitizeForLog(args) },
            "MCP tool call"
          );
        }
        logger.info({ url: safeUrlForLog(urlObj) }, "layout_scan_multi_viewport start");
        const result = await executeLayoutScanMultiViewport(args, allowlistOptions);
        const toolContent = buildMultiViewportToolContent(result);
        if (isMcpTrafficLogEnabled()) {
          logger.info(
            {
              tool: "layout_scan_multi_viewport",
              summary: result.summary,
              contentBlocks: toolContent.content.length,
            },
            "MCP tool result"
          );
        }
        logger.info({ url: safeUrlForLog(urlObj) }, "layout_scan_multi_viewport done");
        return toolContent;
      } catch (err) {
        logger.error({ err }, "layout_scan_multi_viewport failed");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
