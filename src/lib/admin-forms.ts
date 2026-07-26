import { loadCookieHeader } from "./app-scraper.ts";
import {
  browserPageHeaders,
  fetchWorkspaceAdminPage,
  normalizeWorkspaceDomain,
} from "./workspace-client.ts";

export interface AdminForm {
  action: string;
  hidden: Record<string, string>;
  values: Record<string, string>;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findAdminForm(html: string, marker: string): AdminForm {
  const markerPattern = new RegExp(
    `\\bname=["']${escapeRegex(marker)}["']`,
  );
  for (const match of html.matchAll(
    /<form\b[^>]*action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/gi,
  )) {
    const body = match[2] ?? "";
    if (!markerPattern.test(body)) continue;
    const hidden: Record<string, string> = {};
    const values: Record<string, string> = {};
    for (const input of body.matchAll(/<input\b[^>]*>/gi)) {
      const tag = input[0];
      const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
      if (!name) continue;
      const decodedName = decodeHtml(name);
      const value = decodeHtml(
        tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? "",
      );
      if (/\btype=["']hidden["']/i.test(tag)) {
        hidden[decodedName] = value;
        values[decodedName] = value;
      } else if (
        /\btype=["'](?:checkbox|radio)["']/i.test(tag) &&
        /\bchecked(?:\s|>|=)/i.test(tag)
      ) {
        values[decodedName] = value;
      }
    }
    for (const textarea of body.matchAll(
      /<textarea\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/textarea>/gi,
    )) {
      values[decodeHtml(textarea[1]!)] = decodeHtml(
        (textarea[2] ?? "").replace(/<[^>]+>/g, "").trim(),
      );
    }
    for (const select of body.matchAll(
      /<select\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi,
    )) {
      const selected = (select[2] ?? "").match(
        /<option\b[^>]*\bselected(?:\s|>|=)[^>]*\bvalue=["']([^"']*)["'][^>]*>|<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*\bselected(?:\s|>|=)[^>]*>/i,
      );
      const fallback = (select[2] ?? "").match(
        /<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*>/i,
      );
      const value = selected?.[1] ?? selected?.[2] ?? fallback?.[1];
      if (value !== undefined) {
        values[decodeHtml(select[1]!)] = decodeHtml(value);
      }
    }
    return { action: decodeHtml(match[1]!), hidden, values };
  }
  throw new Error(
    `Slack does not expose the "${marker}" setting to this workspace owner. ` +
      "It may be unavailable on the current plan or controlled at the organization level.",
  );
}

export function adminFormBody(
  form: AdminForm,
  values: Record<string, string | number | boolean | undefined>,
): URLSearchParams {
  const body = new URLSearchParams(form.hidden);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === false) {
      body.delete(key);
      continue;
    }
    body.set(key, value === true ? "1" : String(value));
  }
  return body;
}

export async function postWorkspaceAdminForm(
  workspace: string,
  pagePath: string,
  marker: string,
  values: Record<string, string | number | boolean | undefined>,
): Promise<void> {
  const domain = normalizeWorkspaceDomain(workspace);
  const html = await fetchWorkspaceAdminPage(domain, pagePath);
  const form = findAdminForm(html, marker);
  if (!form.action.startsWith("/admin/")) {
    throw new Error(`Refusing to submit a non-admin form: ${form.action}`);
  }

  const body = adminFormBody(form, values);

  const cookieHeader = loadCookieHeader();
  const response = await fetch(`https://${domain}.slack.com${form.action}`, {
    method: "POST",
    headers: {
      ...browserPageHeaders(cookieHeader),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: `https://${domain}.slack.com`,
      Referer: `https://${domain}.slack.com${pagePath}`,
    },
    body,
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(
      `Slack admin form "${marker}" failed: HTTP ${response.status}.`,
    );
  }
  const responseHtml = await response.text();
  if (
    /class=["'][^"']*(?:alert_error|c-alert--error)/i.test(responseHtml)
  ) {
    throw new Error(
      `Slack rejected the "${marker}" workspace setting update.`,
    );
  }
}
