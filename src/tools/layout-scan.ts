import { z } from "zod";
import { runLayoutScan } from "../browser/run-scan.js";
import type { ScreenshotMode } from "../browser/screenshot.js";
import { applySiteContext, resolveAllowedHosts } from "../security/site-context.js";
import type { LayoutScanResult } from "../scripts/layout-evaluate.js";
import type { AllowlistOptions } from "../security/allowlist.js";

const siteContextFields = {
  site_url: z.string().url().optional(),
  wordpress_site_url: z.string().url().optional(),
  home_url: z.string().url().optional(),
  angie_site_url: z.string().url().optional(),
  site_host: z.string().min(1).optional(),
  wordpress_site_host: z.string().min(1).optional(),
};

export const layoutScanInputSchema = z
  .object({
    url: z.string().url(),
    viewport_width: z.number().int().min(320).max(2560).optional().default(375),
    viewport_height: z.number().int().min(400).max(2000).optional().default(812),
    allowed_hosts: z.array(z.string().min(1)).min(1).optional(),
    suspect_element_ids: z.array(z.string()).optional().default([]),
    include_screenshot: z.boolean().optional().default(false),
    screenshot_mode: z
      .enum(["viewport", "full_page", "top_offender"])
      .optional()
      .default("viewport"),
    ...siteContextFields,
  })
  .superRefine((data, ctx) => {
    const hosts = resolveAllowedHosts(data as Record<string, unknown>);
    if (!hosts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "allowed_hosts could not be resolved — provide allowed_hosts, site_url, or a valid page url",
        path: ["allowed_hosts"],
      });
    }
  })
  .transform((data) => ({
    url: data.url,
    viewport_width: data.viewport_width,
    viewport_height: data.viewport_height,
    allowed_hosts: resolveAllowedHosts(data as Record<string, unknown>)!,
    suspect_element_ids: data.suspect_element_ids,
    include_screenshot: data.include_screenshot,
    screenshot_mode: data.screenshot_mode as ScreenshotMode,
  }));

export type LayoutScanInput = z.infer<typeof layoutScanInputSchema>;

export function parseLayoutScanInput(raw: Record<string, unknown>) {
  return layoutScanInputSchema.safeParse(applySiteContext(raw));
}

export async function executeLayoutScan(
  input: LayoutScanInput,
  allowlistOptions: AllowlistOptions
): Promise<LayoutScanResult> {
  return runLayoutScan({
    url: input.url,
    viewportWidth: input.viewport_width,
    viewportHeight: input.viewport_height,
    allowedHosts: input.allowed_hosts,
    suspectElementIds: input.suspect_element_ids,
    allowlistOptions,
    includeScreenshot: input.include_screenshot,
    screenshotMode: input.screenshot_mode,
  });
}
