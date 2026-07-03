import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { getApp } from "../lib/config.ts";
import { loadCookieHeader } from "../lib/app-scraper.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractInputValue(html: string, name: string): string | null {
  const tag = html.match(new RegExp(`<input[^>]*\\bname="${name}"[^>]*>`, "i"))?.[0];
  const value = tag?.match(/\bvalue="([^"]*)"/i)?.[1];
  return value == null ? null : decodeHtml(value);
}

function extractTextareaValue(html: string, name: string): string | null {
  const value = html.match(
    new RegExp(`<textarea[^>]*\\bname="${name}"[^>]*>([\\s\\S]*?)<\\/textarea>`, "i"),
  )?.[1];
  return value == null ? null : decodeHtml(value);
}

function extractIconUrl(html: string, appId: string): string | null {
  const escaped = appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<img[^>]*class="[^"]*icon_for_${escaped}[^"]*"[^>]*src="([^"]+)"`, "i");
  return html.match(re)?.[1]?.replace(/&amp;/g, "&") ?? null;
}

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".png":
    default:
      return "image/png";
  }
}

async function fetchGeneralPage(appId: string, cookieHeader: string): Promise<string> {
  const res = await fetch(`https://api.slack.com/apps/${appId}/general`, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
    },
  });
  if (res.status !== 200) {
    throw new Error(`Failed to fetch app page: HTTP ${res.status}`);
  }

  const html = await res.text();
  if (html.includes("You'll need to sign in") || html.includes("You’ll need to sign in")) {
    throw new Error('Session expired. Run "slack2 login" to re-authenticate.');
  }
  return html;
}

export const iconCommand = defineCommand({
  meta: {
    name: "icon",
    description: "Upload a Slack app icon from an image file",
  },
  args: {
    "app-id": {
      type: "positional",
      description: "App ID to update",
      required: true,
    },
    image: {
      type: "string",
      alias: "i",
      description: "Path to a PNG/JPEG/WebP/GIF icon image",
      required: true,
    },
    name: {
      type: "string",
      description: "App display name to keep/update while saving display info",
    },
    description: {
      type: "string",
      alias: "d",
      description: "Short app description to keep/update while saving display info",
    },
    "background-color": {
      type: "string",
      description: "App card background color, e.g. #2C2D30",
    },
    "long-description": {
      type: "string",
      description: "Long app description to keep/update while saving display info",
    },
  },
  async run({ args }) {
    const appId = args["app-id"];
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found in local config.`);
    }

    const imagePath = resolve(args.image);
    if (!existsSync(imagePath)) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    const cookieHeader = loadCookieHeader();
    const html = await fetchGeneralPage(appId, cookieHeader);
    const crumb = extractInputValue(html, "crumb");
    if (!crumb) {
      throw new Error(`Failed to find Slack form crumb for ${appId}.`);
    }

    const name = args.name ?? extractInputValue(html, "name") ?? app.name;
    const desc = args.description ?? extractInputValue(html, "desc") ?? "";
    const appCardColor =
      args["background-color"] ?? extractInputValue(html, "app_card_color") ?? "#2C2D30";
    const longDesc = args["long-description"] ?? extractTextareaValue(html, "long_desc") ?? "";

    const form = new FormData();
    form.append("done", "1");
    form.append("crumb", crumb);
    form.append("name", name);
    form.append("desc", desc);
    form.append("app_card_color", appCardColor || "#2C2D30");
    form.append("long_desc", longDesc);
    form.append(
      "icon",
      new Blob([readFileSync(imagePath)], { type: mimeType(imagePath) }),
      basename(imagePath),
    );

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
      throw new Error(`Failed to upload icon: HTTP ${res.status}`);
    }

    const resultHtml = await res.text();
    if (resultHtml.includes("alert_error") && resultHtml.includes("error_message")) {
      const error = resultHtml.match(/<span class="error_message">([\s\S]*?)<\/span>/)?.[1];
      if (error?.trim()) {
        throw new Error(`Slack rejected icon upload: ${decodeHtml(error.trim())}`);
      }
    }

    const iconUrl = extractIconUrl(resultHtml, appId) ?? extractIconUrl(
      await fetchGeneralPage(appId, cookieHeader),
      appId,
    );

    console.log(`Uploaded icon for: ${app.name} (${appId})`);
    if (iconUrl) {
      console.log(`  icon: ${iconUrl}`);
    }
  },
});
