import { describe, it, expect } from "vitest";
import { extractClientToken } from "../src/lib/distribution.ts";

describe("extractClientToken", () => {
  it("pulls the xoxc api_token out of workspace boot HTML", () => {
    const html = `<script>var boot_data = {"team_id":"T088QRETHPV","api_token":"xoxc-111-222-333-abcdef","no_login":false};</script>`;
    expect(extractClientToken(html)).toBe("xoxc-111-222-333-abcdef");
  });

  it("tolerates whitespace around the key/value", () => {
    const html = `{ "api_token" :  "xoxc-9-9-9-zzz" }`;
    expect(extractClientToken(html)).toBe("xoxc-9-9-9-zzz");
  });

  it("returns null when no xoxc token is present (e.g. logged out)", () => {
    expect(extractClientToken(`<html>You'll need to sign in</html>`)).toBeNull();
    // A non-xoxc api_token (page crumb) must not be mistaken for a client token.
    expect(extractClientToken(`"api_token":"1b88c080a3e6de1a"`)).toBeNull();
  });
});
