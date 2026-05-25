import { z } from "zod";
import { runLayoutScan } from "../browser/run-scan.js";
import { applySiteContext, resolveAllowedHosts } from "../security/site-context.js";
import type { MultiViewportResult, LayoutScanResult } from "../scripts/layout-evaluate.js";
import type { AllowlistOptions } from "../security/allowlist.js";

const siteContextFields = {
  site_url: z.string().url().optional(),
  wordpress_site_url: z.string().url().optional(),
  home_url: z.string().url().optional(),
  angie_site_url: z.string().url().optional(),
  site_host: z.string().min(1).optional(),
  wordpress_site_host: z.string().min(1).optional(),
};

export const layoutScanMultiInputSchema = z
  .object({
    url: z.string().url(),
    allowed_hosts: z.array(z.string().min(1)).min(1).optional(),
    suspect_element_ids: z.array(z.string()).optional().default([]),
    ...siteContextFields,
  })
  .superRefine((data, ctx) => {
    const hosts = resolveAllowedHosts(data as Record<string, unknown>);
    if (!hosts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "allowed_hosts is required, or enable Site-scoped tools in Angie so site_url is injected",
        path: ["allowed_hosts"],
      });
    }
  })
  .transform((data) => ({
    url: data.url,
    allowed_hosts: resolveAllowedHosts(data as Record<string, unknown>)!,
    suspect_element_ids: data.suspect_element_ids,
  }));

export type LayoutScanMultiInput = z.infer<typeof layoutScanMultiInputSchema>;

export function parseLayoutScanMultiInput(raw: Record<string, unknown>) {
  return layoutScanMultiInputSchema.safeParse(applySiteContext(raw));
}

const VIEWPORT_PRESETS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;

function buildSummary(
  url: string,
  scans: LayoutScanResult[],
  firstBreakpoint: number | null
): string {
  if (firstBreakpoint === null) {
    return `No horizontal overflow detected at 375/768/1280px for ${url}`;
  }
  const scan = scans.find((s) => s.viewport.width === firstBreakpoint);
  const overflowPx = scan?.horizontal_overflow_px ?? 0;
  const elementorCount = scan?.elementor_offenders.length ?? 0;
  return `Horizontal overflow at ${firstBreakpoint}px (${overflowPx}px) on ${url}; ${elementorCount} Elementor offender(s)`;
}

export async function executeLayoutScanMultiViewport(
  input: LayoutScanMultiInput,
  allowlistOptions: AllowlistOptions
): Promise<MultiViewportResult> {
  const scans: LayoutScanResult[] = [];

  for (const preset of VIEWPORT_PRESETS) {
    const result = await runLayoutScan({
      url: input.url,
      viewportWidth: preset.width,
      viewportHeight: preset.height,
      allowedHosts: input.allowed_hosts,
      suspectElementIds: input.suspect_element_ids,
      allowlistOptions,
    });
    scans.push(result);
  }

  const firstBreakpoint =
    scans.find((s) => s.has_horizontal_scroll)?.viewport.width ?? null;

  return {
    url: input.url,
    scans,
    first_breakpoint_with_scroll: firstBreakpoint,
    summary: buildSummary(input.url, scans, firstBreakpoint),
  };
}
