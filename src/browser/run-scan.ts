import { chromium, type Browser } from "playwright";
import {
  LAYOUT_EVALUATE_SCRIPT,
  type LayoutEvaluateResult,
  type LayoutOffender,
  type LayoutScanResult,
} from "../scripts/layout-evaluate.js";
import {
  validateFinalUrl,
  validateUrl,
  safeUrlForLog,
  type AllowlistOptions,
} from "../security/allowlist.js";
import { captureScreenshot, type ScreenshotMode } from "./screenshot.js";

export interface ScanOptions {
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  allowedHosts: string[];
  suspectElementIds?: string[];
  allowlistOptions: AllowlistOptions;
  navigationTimeoutMs?: number;
  totalTimeoutMs?: number;
  includeScreenshot?: boolean;
  screenshotMode?: ScreenshotMode;
}

const NAVIGATION_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 45_000;

export async function runLayoutScan(options: ScanOptions): Promise<LayoutScanResult> {
  const start = Date.now();
  const {
    url,
    viewportWidth,
    viewportHeight,
    allowedHosts,
    suspectElementIds = [],
    allowlistOptions,
    navigationTimeoutMs = NAVIGATION_TIMEOUT_MS,
    totalTimeoutMs = TOTAL_TIMEOUT_MS,
    includeScreenshot = false,
    screenshotMode = "viewport",
  } = options;

  const urlValidation = validateUrl(url, allowedHosts, allowlistOptions);
  if (!urlValidation.ok) {
    return {
      url,
      viewport: { width: viewportWidth, height: viewportHeight },
      scroll: { width: 0, height: 0 },
      has_horizontal_scroll: false,
      horizontal_overflow_px: 0,
      offenders: [],
      elementor_offenders: [],
      important_rules: [],
      duration_ms: Date.now() - start,
      http_status: null,
      error: urlValidation.error.code,
    };
  }

  let browser: Browser | null = null;
  let httpStatus: number | null = null;
  let scanError: string | undefined;

  const deadline = start + totalTimeoutMs;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
    });
    const page = await context.newPage();

    let response;
    try {
      response = await page.goto(urlValidation.url.href, {
        waitUntil: "networkidle",
        timeout: Math.min(navigationTimeoutMs, deadline - Date.now()),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Timeout") || message.includes("timeout")) {
        scanError = "navigation_timeout";
      } else {
        scanError = "navigation_failed";
      }
    }

    if (response) {
      httpStatus = response.status();
    }

    const finalUrl = page.url();
    const redirectCheck = validateFinalUrl(finalUrl, allowedHosts, allowlistOptions);
    if (!redirectCheck.ok) {
      return {
        url,
        viewport: { width: viewportWidth, height: viewportHeight },
        scroll: { width: 0, height: 0 },
        has_horizontal_scroll: false,
        horizontal_overflow_px: 0,
        offenders: [],
        elementor_offenders: [],
        important_rules: [],
        duration_ms: Date.now() - start,
        http_status: httpStatus,
        error: redirectCheck.error.code,
      };
    }

    const evaluateFn = new Function(`return (${LAYOUT_EVALUATE_SCRIPT})`)() as () => LayoutEvaluateResult;
    const evalResult = await page.evaluate(evaluateFn);

    const result: LayoutScanResult = {
      url,
      viewport: evalResult.viewport,
      scroll: evalResult.scroll,
      has_horizontal_scroll: evalResult.has_horizontal_scroll,
      horizontal_overflow_px: evalResult.horizontal_overflow_px,
      offenders: evalResult.offenders,
      elementor_offenders: evalResult.elementor_offenders,
      important_rules: evalResult.important_rules,
      duration_ms: Date.now() - start,
      http_status: httpStatus,
    };

    if (scanError) {
      result.error = scanError;
    }

    if (suspectElementIds.length > 0) {
      const suspectSet = new Set(suspectElementIds);
      result.suspect_matches = evalResult.offenders.filter(
        (o): o is LayoutOffender & { data_id: string } =>
          o.data_id !== null && suspectSet.has(o.data_id)
      );
    }

    if (includeScreenshot) {
      const topOffender =
        evalResult.elementor_offenders[0] ?? evalResult.offenders[0] ?? null;
      const mode =
        screenshotMode === "top_offender" && !topOffender?.data_id
          ? "viewport"
          : screenshotMode;
      const screenshot = await captureScreenshot(page, mode, topOffender);
      if (screenshot) {
        result.screenshot = screenshot;
        result.screenshot_meta = {
          mimeType: screenshot.mimeType,
          mode: screenshot.mode,
          width: screenshot.width,
          height: screenshot.height,
          bytes: screenshot.bytes,
          included_in_response: true,
        };
      } else {
        result.screenshot_meta = {
          mimeType: "image/png",
          mode,
          width: viewportWidth,
          height: viewportHeight,
          bytes: 0,
          included_in_response: false,
          capture_failed: true,
        };
      }
    }

    return result;
  } catch (err) {
    return {
      url,
      viewport: { width: viewportWidth, height: viewportHeight },
      scroll: { width: 0, height: 0 },
      has_horizontal_scroll: false,
      horizontal_overflow_px: 0,
      offenders: [],
      elementor_offenders: [],
      important_rules: [],
      duration_ms: Date.now() - start,
      http_status: httpStatus,
      error: err instanceof Error ? err.message : "scan_failed",
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

export { safeUrlForLog };
