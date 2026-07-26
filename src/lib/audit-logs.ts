import { getApp, loadApps } from "./config.ts";

export interface AuditLogOptions {
  workspace: string;
  appId?: string;
  oldest?: number;
  latest?: number;
  action?: string;
  actor?: string;
  limit?: number;
  cursor?: string;
}

export function resolveAuditToken(
  workspace: string,
  appId?: string,
  environment = process.env,
): string {
  let token: string | undefined;
  if (appId) {
    const app = getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} was not found in the local slack2 registry.`);
    }
    if (app.workspace !== workspace) {
      throw new Error(
        `App ${appId} belongs to workspace "${app.workspace}", not "${workspace}".`,
      );
    }
    token = app.user_token;
    if (!token) {
      throw new Error(
        `App ${appId} has no installed user token. Reinstall it with the auditlogs:read user scope.`,
      );
    }
  } else if (environment.SLACK2_AUDIT_TOKEN) {
    token = environment.SLACK2_AUDIT_TOKEN;
  } else {
    const candidates = loadApps().filter(
      (app) => app.workspace === workspace && app.user_token,
    );
    if (candidates.length === 1) token = candidates[0]!.user_token;
    if (candidates.length > 1) {
      throw new Error(
        `Multiple installed apps have user tokens for "${workspace}". ` +
          "Pass --app-id to select the app with auditlogs:read.",
      );
    }
  }
  if (!token) {
    throw new Error(
      "No Audit Logs API token is available. Install an Enterprise org app with " +
        "the auditlogs:read user scope and pass --app-id, or set SLACK2_AUDIT_TOKEN.",
    );
  }
  if (!token.startsWith("xoxp-")) {
    throw new Error("The Audit Logs API requires an xoxp user token.");
  }
  return token;
}

export async function fetchAuditLogs(
  options: AuditLogOptions,
): Promise<Record<string, unknown>> {
  const token = resolveAuditToken(
    options.workspace,
    options.appId,
  );
  const url = new URL("https://api.slack.com/audit/v1/logs");
  if (options.oldest !== undefined) {
    url.searchParams.set("oldest", String(options.oldest));
  }
  if (options.latest !== undefined) {
    url.searchParams.set("latest", String(options.latest));
  }
  if (options.action) url.searchParams.set("action", options.action);
  if (options.actor) url.searchParams.set("actor", options.actor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.cursor) url.searchParams.set("cursor", options.cursor);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const code =
      (data.error as string | undefined) ??
      (data.message as string | undefined) ??
      `HTTP ${response.status}`;
    const hint =
      response.status === 403 || /enterprise|plan|scope|permission/i.test(code)
        ? " The Audit Logs API requires Slack Enterprise, an org-owner user token, " +
          "and the auditlogs:read scope."
        : "";
    throw new Error(`Slack Audit Logs API: ${code}.${hint}`);
  }
  return data;
}
