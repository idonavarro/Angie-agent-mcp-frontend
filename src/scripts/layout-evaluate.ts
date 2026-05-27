import type { ScanScreenshot } from "../browser/screenshot.js";

/**
 * Browser-side layout evaluation script.
 * Embedded as a string for page.evaluate().
 */
export const LAYOUT_EVALUATE_SCRIPT = `() => {
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
}`;

export interface LayoutOffender {
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
}

export interface ImportantRule {
  selector: string;
  properties: string[];
  href: string;
}

export interface LayoutEvaluateResult {
  viewport: { width: number; height: number };
  scroll: { width: number; height: number };
  has_horizontal_scroll: boolean;
  horizontal_overflow_px: number;
  offenders: LayoutOffender[];
  important_rules: ImportantRule[];
  elementor_offenders: LayoutOffender[];
}

export interface ScreenshotMeta {
  mimeType: "image/png";
  mode: string;
  width: number;
  height: number;
  bytes: number;
  included_in_response: boolean;
  capture_failed?: boolean;
}

export interface LayoutScanResult {
  url: string;
  viewport: { width: number; height: number };
  scroll: { width: number; height: number };
  has_horizontal_scroll: boolean;
  horizontal_overflow_px: number;
  offenders: LayoutOffender[];
  elementor_offenders: LayoutOffender[];
  important_rules: ImportantRule[];
  suspect_matches?: LayoutOffender[];
  duration_ms: number;
  http_status: number | null;
  error?: string;
  /** Full image payload for MCP handler; omitted from JSON text block */
  screenshot?: ScanScreenshot;
  screenshot_meta?: ScreenshotMeta;
}

export interface MultiViewportResult {
  url: string;
  scans: LayoutScanResult[];
  first_breakpoint_with_scroll: number | null;
  summary: string;
}
