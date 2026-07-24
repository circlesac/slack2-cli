/**
 * Activate "Public Distribution" for a Slack app via
 * api.slack.com/apps/<app_id>/distribute, using the stored browser session.
 *
 * Slack has no public API for this, so we drive the page's own form — the same
 * mechanism as general-page.ts (fetch page → read `crumb` → re-POST). Rather
 * than hard-code the activation form's field names (which aren't documented and
 * can drift), we *discover* the form on the page and replay its own action +
 * inputs, exactly as the browser would on submit.
 *
 * Why this matters: an app can only be installed into workspaces OTHER than the
 * one it was created in once Public Distribution is active. Slack's checklist
 * requires at least one https redirect URL (it rejects localhost/http) before
 * activation — if that isn't satisfied, Slack rejects the POST and we surface
 * its message verbatim.
 */

import { decodeHtml, extractInputValue } from "./general-page.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

export async function fetchDistributePage(
  appId: string,
  cookieHeader: string,
): Promise<string> {
  const res = await fetch(`https://api.slack.com/apps/${appId}/distribute`, {
    headers: { Cookie: cookieHeader, "User-Agent": USER_AGENT },
  });
  if (res.status !== 200) {
    throw new Error(`Failed to load app distribute page: HTTP ${res.status}`);
  }
  const html = await res.text();
  if (html.includes("You'll need to sign in") || html.includes("You’ll need to sign in")) {
    throw new Error('Session expired. Run "slack2 login" to re-authenticate.');
  }
  return html;
}

/**
 * True when the app is already publicly distributed. Slack surfaces this by
 * offering the *deactivate* control (or the "Publicly Distributed" badge) once
 * distribution is on, so either signal means "already active".
 */
export function isDistributed(html: string): boolean {
  return (
    /deactivate\s+public\s+distribution/i.test(html) ||
    /Publicly Distributed/i.test(html)
  );
}

export interface ActivateForm {
  /** Absolute POST target for the form. */
  action: string;
  /** All input name→value pairs the form carries (incl. crumb). */
  fields: Record<string, string>;
}

/**
 * Find the form that activates public distribution and return its action + the
 * inputs it would submit. We locate the `<form>` whose block contains the
 * activation control ("Activate Public Distribution"), then harvest its hidden/
 * text inputs — so we submit exactly what Slack's own UI would, no guessing at
 * field names. Returns null when no such form is present (e.g. the checklist is
 * incomplete and Slack hasn't rendered the activation form yet).
 */
export function extractActivateForm(html: string, appId: string): ActivateForm | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const form = forms.find(
    (f) =>
      /activate\s+public\s+distribution/i.test(f) ||
      /\bname="activate"/i.test(f) ||
      /data-qa="[^"]*activate[^"]*distribut/i.test(f),
  );
  if (!form) return null;

  const rawAction = form.match(/<form\b[^>]*\baction="([^"]*)"/i)?.[1];
  const action = rawAction
    ? new URL(decodeHtml(rawAction), `https://api.slack.com/apps/${appId}/distribute`).toString()
    : `https://api.slack.com/apps/${appId}/distribute`;

  const fields: Record<string, string> = {};
  for (const input of form.match(/<input\b[^>]*>/gi) ?? []) {
    const name = input.match(/\bname="([^"]*)"/i)?.[1];
    if (!name) continue;
    const value = input.match(/\bvalue="([^"]*)"/i)?.[1] ?? "";
    fields[name] = decodeHtml(value);
  }
  return { action, fields };
}

export interface ActivateResult {
  /** True when nothing was done because it was already distributed. */
  alreadyDistributed: boolean;
}

/**
 * Activate Public Distribution for the app. Idempotent: a no-op (with
 * `alreadyDistributed: true`) if it's already on. Throws with Slack's own error
 * text if activation is rejected (most commonly: no https redirect URL yet).
 */
export async function activateDistribution(
  appId: string,
  cookieHeader: string,
): Promise<ActivateResult> {
  const html = await fetchDistributePage(appId, cookieHeader);
  if (isDistributed(html)) return { alreadyDistributed: true };

  const crumb = extractInputValue(html, "crumb");
  if (!crumb) {
    throw new Error(`Failed to find Slack form crumb on the distribute page for ${appId}.`);
  }

  const form = extractActivateForm(html, appId);
  if (!form) {
    throw new Error(
      `Couldn't find the "Activate Public Distribution" form for ${appId}. ` +
        `Slack usually hides it until the distribution checklist is met — ` +
        `ensure the app has at least one https redirect URL (its manifest may only have localhost).`,
    );
  }

  // Replay the form. Seed crumb from the page in case the form didn't carry it
  // as an <input>, and mark the submit so Slack treats this as the activation.
  const body = new URLSearchParams({ crumb, ...form.fields });
  if (!body.has("activate")) body.set("activate", "1");

  const res = await fetch(form.action, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://api.slack.com",
      Referer: `https://api.slack.com/apps/${appId}/distribute`,
    },
    body,
    redirect: "manual",
  });

  // 2xx or a redirect back to the distribute page both mean "accepted".
  if (res.status >= 400) {
    const resultHtml = await res.text().catch(() => "");
    const error = resultHtml.match(/<span class="error_message">([\s\S]*?)<\/span>/)?.[1];
    throw new Error(
      error?.trim()
        ? `Slack rejected activation: ${decodeHtml(error.trim())}`
        : `Slack rejected activation: HTTP ${res.status}`,
    );
  }

  // Confirm it actually took, rather than trusting the POST status alone.
  const after = await fetchDistributePage(appId, cookieHeader);
  if (!isDistributed(after)) {
    const error = after.match(/<span class="error_message">([\s\S]*?)<\/span>/)?.[1];
    throw new Error(
      error?.trim()
        ? `Activation did not take effect: ${decodeHtml(error.trim())}`
        : `Activation POST was accepted but the app still shows "Not distributed" — ` +
          `the distribution checklist is likely unmet (needs an https redirect URL).`,
    );
  }

  return { alreadyDistributed: false };
}
