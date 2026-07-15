/**
 * Read/write the "Basic Information" (general) page of a Slack app at
 * api.slack.com/apps/<app_id>/general, using the stored browser session
 * cookie. Slack has no public API for an app's display profile (name, short/
 * long description, card color, icon), so we scrape the page's form and re-POST
 * it — the same mechanism the web UI uses. Shared by `icon` and `profile`.
 */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

export function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractInputValue(html: string, name: string): string | null {
  const tag = html.match(new RegExp(`<input[^>]*\\bname="${name}"[^>]*>`, "i"))?.[0];
  const value = tag?.match(/\bvalue="([^"]*)"/i)?.[1];
  return value == null ? null : decodeHtml(value);
}

export function extractTextareaValue(html: string, name: string): string | null {
  const value = html.match(
    new RegExp(`<textarea[^>]*\\bname="${name}"[^>]*>([\\s\\S]*?)<\\/textarea>`, "i"),
  )?.[1];
  return value == null ? null : decodeHtml(value);
}

export function extractIconUrl(html: string, appId: string): string | null {
  const escaped = appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<img[^>]*class="[^"]*icon_for_${escaped}[^"]*"[^>]*src="([^"]+)"`, "i");
  return html.match(re)?.[1]?.replace(/&amp;/g, "&") ?? null;
}

export function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export async function fetchGeneralPage(appId: string, cookieHeader: string): Promise<string> {
  const res = await fetch(`https://api.slack.com/apps/${appId}/general`, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
    },
  });
  if (res.status !== 200) {
    throw new Error(`Failed to load app general page: HTTP ${res.status}`);
  }
  return res.text();
}

export interface GeneralInfoUpdate {
  /** App display name (form field `name`). */
  name?: string;
  /** Short description (form field `desc`). */
  description?: string;
  /** Long description (form field `long_desc`). */
  longDescription?: string;
  /** App card background color, e.g. `#2C2D30` (form field `app_card_color`). */
  backgroundColor?: string;
  /** Optional icon image path — when set, the icon is updated too. */
  iconPath?: string;
}

export interface GeneralInfoResult {
  name: string;
  iconUrl: string | null;
}

/**
 * Update the app's Basic Information. Only the fields provided in `update` are
 * changed; every other value is preserved by seeding from the current page.
 * Omitting `iconPath` leaves the existing icon untouched (no `icon` part sent).
 */
export async function saveGeneralInfo(
  appId: string,
  cookieHeader: string,
  update: GeneralInfoUpdate,
): Promise<GeneralInfoResult> {
  const html = await fetchGeneralPage(appId, cookieHeader);
  const crumb = extractInputValue(html, "crumb");
  if (!crumb) {
    throw new Error(`Failed to find Slack form crumb for ${appId}.`);
  }

  // Seed from the current page so unspecified fields round-trip unchanged.
  const name = update.name ?? extractInputValue(html, "name") ?? "";
  const desc = update.description ?? extractInputValue(html, "desc") ?? "";
  const appCardColor =
    update.backgroundColor ?? extractInputValue(html, "app_card_color") ?? "#2C2D30";
  const longDesc = update.longDescription ?? extractTextareaValue(html, "long_desc") ?? "";

  const form = new FormData();
  form.append("done", "1");
  form.append("crumb", crumb);
  form.append("name", name);
  form.append("desc", desc);
  form.append("app_card_color", appCardColor || "#2C2D30");
  form.append("long_desc", longDesc);
  if (update.iconPath) {
    form.append(
      "icon",
      new Blob([readFileSync(update.iconPath)], { type: mimeType(update.iconPath) }),
      basename(update.iconPath),
    );
  }

  const res = await fetch(`https://api.slack.com/apps/${appId}/general?`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      Origin: "https://api.slack.com",
      Referer: `https://api.slack.com/apps/${appId}/general`,
    },
    body: form,
  });
  if (res.status !== 200) {
    throw new Error(`Failed to save app profile: HTTP ${res.status}`);
  }

  const resultHtml = await res.text();
  if (resultHtml.includes("alert_error") && resultHtml.includes("error_message")) {
    const error = resultHtml.match(/<span class="error_message">([\s\S]*?)<\/span>/)?.[1];
    if (error?.trim()) {
      throw new Error(`Slack rejected the update: ${decodeHtml(error.trim())}`);
    }
  }

  const iconUrl =
    extractIconUrl(resultHtml, appId) ??
    extractIconUrl(await fetchGeneralPage(appId, cookieHeader), appId);

  return { name, iconUrl };
}
