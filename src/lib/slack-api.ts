/**
 * Minimal Slack API client using fetch.
 * No SDK dependency — just POST to slack.com/api/{method}.
 */

export interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function slackApi(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<SlackResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as SlackResponse;
  if (!data.ok) {
    throw new Error(`Slack API ${method}: ${data.error ?? "unknown error"}`);
  }
  return data;
}
