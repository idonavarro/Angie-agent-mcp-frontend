import type { LayoutScanResult, MultiViewportResult } from "../scripts/layout-evaluate.js";
import type { ScanScreenshot } from "../browser/screenshot.js";

type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

function stripScreenshotForJson(result: LayoutScanResult): Record<string, unknown> {
  const { screenshot, ...rest } = result;
  if (!screenshot) return rest as Record<string, unknown>;
  return {
    ...rest,
    screenshot_meta: {
      mimeType: screenshot.mimeType,
      mode: screenshot.mode,
      width: screenshot.width,
      height: screenshot.height,
      bytes: screenshot.bytes,
      included_in_response: true,
    },
  };
}

export function buildLayoutScanToolContent(result: LayoutScanResult): {
  content: McpContentBlock[];
} {
  const content: McpContentBlock[] = [
    { type: "text", text: JSON.stringify(stripScreenshotForJson(result), null, 2) },
  ];

  if (result.screenshot?.base64) {
    content.push({
      type: "image",
      data: result.screenshot.base64,
      mimeType: result.screenshot.mimeType,
    });
  }

  return { content };
}

export function buildMultiViewportToolContent(result: MultiViewportResult): {
  content: McpContentBlock[];
} {
  const scans = result.scans.map((scan) => stripScreenshotForJson(scan));
  const payload = { ...result, scans };

  const content: McpContentBlock[] = [
    { type: "text", text: JSON.stringify(payload, null, 2) },
  ];

  for (const scan of result.scans) {
    if (scan.screenshot?.base64) {
      content.push({
        type: "image",
        data: scan.screenshot.base64,
        mimeType: scan.screenshot.mimeType,
      });
    }
  }

  return { content };
}
