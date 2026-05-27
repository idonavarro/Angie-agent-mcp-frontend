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

export const MCP_NAME = "angie-browser-layout";
export const MCP_VERSION = "1.0.1";
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
        "Scan a public page URL at a given viewport. Detect horizontal overflow, offending DOM nodes (prioritize Elementor data-id), and active !important CSS rules.",
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
        logger.info(
          { url: safeUrlForLog(urlObj), viewport: args.viewport_width },
          "layout_scan start"
        );
        const result = await executeLayoutScan(args, allowlistOptions);
        logger.info(
          {
            url: safeUrlForLog(urlObj),
            duration_ms: result.duration_ms,
            overflow: result.has_horizontal_scroll,
          },
          "layout_scan done"
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
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
        "Run layout_scan at widths 375, 768, and 1280px. Returns all results plus the first breakpoint with horizontal scroll.",
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
        logger.info({ url: safeUrlForLog(urlObj) }, "layout_scan_multi_viewport start");
        const result = await executeLayoutScanMultiViewport(args, allowlistOptions);
        logger.info({ url: safeUrlForLog(urlObj), summary: result.summary }, "layout_scan_multi_viewport done");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
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
