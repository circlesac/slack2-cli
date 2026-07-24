/**
 * Enable / disable Public Distribution for a Slack app.
 *
 * Neither the manifest API (no distribution field) nor the distribute page (a
 * JS SPA with no server-rendered form) exposes this. The actual toggle is a
 * plain internal method the workspace web client calls:
 *
 *   POST https://<workspace>.slack.com/api/developer.apps.(enable|disable)Distribution
 *
 * authenticated by the workspace client token (`xoxc-…`) plus the session `d`
 * cookie. We source the xoxc token the same way the web app does — from the
 * workspace boot HTML — so the caller only needs a normal `slack2 login`
 * session, no manual token handling.
 *
 * Activation still requires the app to satisfy Slack's distribution checklist
 * (https redirect URLs, "Remove Hard Coded Information", …). When it isn't met,
 * the method returns `ok: false` and we surface Slack's error verbatim.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/** Pull the workspace client token (xoxc) out of the boot HTML. */
export function extractClientToken(html: string): string | null {
  return html.match(/"api_token"\s*:\s*"(xoxc-[^"]+)"/)?.[1] ?? null;
}

async function getClientToken(workspace: string, cookieHeader: string): Promise<string> {
  const res = await fetch(`https://${workspace}.slack.com/`, {
    headers: { Cookie: cookieHeader, "User-Agent": USER_AGENT },
  });
  if (res.status !== 200) {
    throw new Error(`Failed to load ${workspace}.slack.com: HTTP ${res.status}`);
  }
  const token = extractClientToken(await res.text());
  if (!token) {
    throw new Error(
      `Couldn't find the workspace client token (xoxc) for ${workspace}. ` +
        `The session may be expired — run "slack2 login".`,
    );
  }
  return token;
}

export interface DistributionResult {
  /** false when it was already in the requested state (idempotent no-op). */
  changed: boolean;
}

/**
 * Turn Public Distribution on (`enabled: true`) or off. Idempotent: a redundant
 * toggle (Slack answers `app_already_distributed` / `app_not_distributed`)
 * resolves to `{ changed: false }` rather than throwing. Any other rejection
 * (e.g. the distribution checklist isn't satisfied) throws with Slack's own
 * error text.
 */
export async function setDistribution(
  workspace: string,
  appId: string,
  enabled: boolean,
  cookieHeader: string,
): Promise<DistributionResult> {
  const token = await getClientToken(workspace, cookieHeader);
  const method = enabled
    ? "developer.apps.enableDistribution"
    : "developer.apps.disableDistribution";

  const body = new URLSearchParams({
    token,
    app_id: appId,
    _x_reason: enabled ? "enable_distribution" : "disable_distribution",
    _x_mode: "online",
    _x_app_name: "app-settings",
  });

  const res = await fetch(`https://${workspace}.slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (data.ok) return { changed: true };

  const alreadyInState = enabled ? "app_already_distributed" : "app_not_distributed";
  if (data.error === alreadyInState) return { changed: false };

  throw new Error(`${method} failed: ${data.error ?? "unknown error"}`);
}
