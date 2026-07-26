import { loadCookieHeader } from "./app-scraper.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const WORKSPACE_BOOT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

export interface WorkspaceApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

const workspaceTokenPromises = new Map<string, Promise<string>>();

export function extractWorkspaceClientToken(html: string): string | null {
  return html.match(/"api_token"\s*:\s*"(xoxc-[^"]+)"/)?.[1] ?? null;
}

export function normalizeWorkspaceDomain(workspace: string): string {
  const normalized = workspace.trim().toLowerCase().replace(/\.slack\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error(`Invalid workspace domain: ${workspace}`);
  }
  return normalized;
}

export function browserPageHeaders(cookieHeader: string): Record<string, string> {
  return {
    Cookie: cookieHeader,
    "User-Agent": USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9," +
      "image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
  };
}

export async function getWorkspaceClientToken(
  workspace: string,
  cookieHeader = loadCookieHeader(),
): Promise<string> {
  const domain = normalizeWorkspaceDomain(workspace);
  const existing = workspaceTokenPromises.get(domain);
  if (existing) return existing;

  const tokenPromise = (async () => {
    const response = await fetch(`https://${domain}.slack.com/`, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": WORKSPACE_BOOT_USER_AGENT,
      },
    });
    if (response.status !== 200) {
      const retryAfter = response.headers.get("retry-after");
      const hint =
        response.status === 429 && retryAfter
          ? ` Retry after ${retryAfter} seconds.`
          : "";
      throw new Error(
        `Failed to load ${domain}.slack.com: HTTP ${response.status}.${hint}`,
      );
    }
    const token = extractWorkspaceClientToken(await response.text());
    if (!token) {
      throw new Error(
        `Couldn't open the ${domain} workspace session. ` +
          'The browser session may be expired — run "slack2 login".',
      );
    }
    return token;
  })();
  workspaceTokenPromises.set(domain, tokenPromise);
  try {
    return await tokenPromise;
  } catch (error) {
    workspaceTokenPromises.delete(domain);
    throw error;
  }
}

function encodeArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function workspaceApiError(method: string, error?: string): Error {
  const code = error ?? "unknown_error";
  const guidance: Record<string, string> = {
    invalid_auth: 'Run "slack2 login" and try again.',
    not_authed: 'Run "slack2 login" and try again.',
    token_expired: 'Run "slack2 login" and try again.',
    missing_scope:
      "The authenticated Slack app or user token does not have the required scope.",
    no_permission:
      "The signed-in member does not have permission for this workspace operation.",
    restricted_action:
      "The signed-in member does not have the required owner/admin role.",
    paid_only: "This operation requires an eligible paid Slack plan.",
    not_enterprise: "This operation is only available on Slack Enterprise.",
  };
  const suffix = guidance[code] ? ` ${guidance[code]}` : "";
  return new Error(`Slack API ${method}: ${code}.${suffix}`);
}

export async function workspaceApi(
  workspace: string,
  method: string,
  args: Record<string, unknown> = {},
  reason = `slack2-admin-${method}`,
): Promise<WorkspaceApiResponse> {
  const domain = normalizeWorkspaceDomain(workspace);
  const cookieHeader = loadCookieHeader();
  const token = await getWorkspaceClientToken(domain, cookieHeader);
  const body = new FormData();
  body.set("token", token);
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    body.set(key, encodeArgument(value));
  }
  body.set("_x_reason", reason);
  body.set("_x_mode", "online");
  body.set("_x_app_name", "slack2");

  const response = await fetch(`https://${domain}.slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
    },
    body,
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const retryHint =
      response.status === 429 && retryAfter
        ? ` Retry after ${retryAfter} seconds.`
        : "";
    throw new Error(
      `Slack API ${method}: HTTP ${response.status}.${retryHint}`,
    );
  }
  const data = (await response.json()) as WorkspaceApiResponse;
  if (!data.ok) throw workspaceApiError(method, data.error);
  return data;
}

export async function fetchWorkspaceAdminPage(
  workspace: string,
  path: string,
): Promise<string> {
  const domain = normalizeWorkspaceDomain(workspace);
  if (!path.startsWith("/admin/")) {
    throw new Error(`Refusing to fetch a non-admin path: ${path}`);
  }
  const cookieHeader = loadCookieHeader();
  const response = await fetch(`https://${domain}.slack.com${path}`, {
    headers: browserPageHeaders(cookieHeader),
  });
  if (response.status !== 200) {
    throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  }
  const html = await response.text();
  if (
    html.includes("You'll need to sign in") ||
    html.includes("You’ll need to sign in")
  ) {
    throw new Error('Session expired. Run "slack2 login" to re-authenticate.');
  }
  return html;
}
