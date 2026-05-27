import type { Page } from "playwright";
import type { LayoutOffender } from "../scripts/layout-evaluate.js";

export type ScreenshotMode = "viewport" | "full_page" | "top_offender";

export interface ScanScreenshot {
  mimeType: "image/png";
  base64: string;
  width: number;
  height: number;
  mode: ScreenshotMode;
  bytes: number;
}

const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;

export async function captureScreenshot(
  page: Page,
  mode: ScreenshotMode,
  topOffender?: LayoutOffender | null
): Promise<ScanScreenshot | null> {
  try {
    let buffer: Buffer;

    if (mode === "top_offender" && topOffender?.data_id) {
      const locator = page.locator(`[data-id="${topOffender.data_id}"]`).first();
      const count = await locator.count();
      if (count === 0) {
        buffer = await page.screenshot({ type: "png", fullPage: false });
      } else {
        buffer = await locator.screenshot({ type: "png" });
      }
    } else if (mode === "full_page") {
      buffer = await page.screenshot({ type: "png", fullPage: true });
    } else {
      buffer = await page.screenshot({ type: "png", fullPage: false });
    }

    if (buffer.length > MAX_SCREENSHOT_BYTES) {
      return null;
    }

    const viewport = page.viewportSize();
    return {
      mimeType: "image/png",
      base64: buffer.toString("base64"),
      width: viewport?.width ?? 0,
      height: viewport?.height ?? 0,
      mode,
      bytes: buffer.length,
    };
  } catch {
    return null;
  }
}
