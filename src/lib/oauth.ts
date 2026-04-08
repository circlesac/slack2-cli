/**
 * Local OAuth callback server.
 * Starts an HTTP server, opens the browser, waits for the redirect.
 */

import { createServer } from "node:http";
import { execSync } from "node:child_process";

const DEFAULT_PORT = 9876;

export function redirectUri(port = DEFAULT_PORT): string {
  return `http://localhost:${port}/callback`;
}

/**
 * Opens an OAuth URL in the browser and waits for the authorization code.
 */
export async function waitForOAuthCode(
  authorizeUrl: string,
  port = DEFAULT_PORT,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400);
        res.end(`OAuth error: ${error}`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body style="font-family:system-ui;padding:2rem;text-align:center">
          <h2>App installed!</h2>
          <p>Bot token captured. You can close this tab.</p>
        </body></html>`);
        server.close();
        resolve(code);
      }
    });

    server.listen(port, () => {
      console.log(`Listening on http://localhost:${port}/callback`);
      console.log("Opening browser for authorization...\n");
      try {
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        execSync(`${cmd} "${authorizeUrl}"`);
      } catch {
        console.log("Could not open browser. Open this URL manually:");
        console.log(`  ${authorizeUrl}\n`);
      }
    });

    server.on("error", reject);
  });
}

/**
 * Exchange an authorization code for a bot token.
 */
export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirect: string,
): Promise<{ accessToken: string; botUserId: string }> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
    }),
  });

  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
  };

  if (!data.ok || !data.access_token) {
    throw new Error(`oauth.v2.access failed: ${data.error ?? "unknown"}`);
  }

  return {
    accessToken: data.access_token,
    botUserId: data.bot_user_id ?? "",
  };
}
