const AGENT_IMG_UPLOAD_URL = "https://agent-img.com/api/upload";

export function getAgentImgToken(): string | undefined {
  const token = process.env.AGENT_IMG_TOKEN?.trim();
  return token || undefined;
}

export type UploadScreenshotResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function uploadScreenshot(
  buffer: Buffer,
  filename = "screenshot.png"
): Promise<UploadScreenshotResult> {
  const token = getAgentImgToken();
  if (!token) {
    return { ok: false, error: "agent_img_token_not_configured" };
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "image/png" }), filename);

    const res = await fetch(AGENT_IMG_UPLOAD_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `upload_http_${res.status}: ${text.slice(0, 200)}` };
    }

    const json = (await res.json()) as { url?: string };
    if (!json.url) {
      return { ok: false, error: "upload_missing_url" };
    }

    return { ok: true, url: json.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "upload_failed" };
  }
}
