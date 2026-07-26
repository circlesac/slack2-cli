import { describe, expect, it } from "vitest";
import {
  collectRepeatedOption,
  parsePositiveInteger,
  redactSensitive,
  toEpochSeconds,
} from "../src/lib/cli-safety.ts";
import {
  parseBillingOverview,
  summarizeAuthPrefs,
  summarizeBillingHistory,
} from "../src/lib/admin-settings.ts";
import {
  extractWorkspaceClientToken,
  workspaceApiError,
} from "../src/lib/workspace-client.ts";

describe("admin safety", () => {
  it("redacts tokens, secrets, and network identifiers recursively", () => {
    expect(
      redactSensitive({
        token: "xoxp-secret",
        nested: {
          value: "prefix xoxc-client-secret suffix",
          ip_address: "192.0.2.1",
          user_agent: "ExampleBrowser",
        },
      }),
    ).toEqual({
      token: "[REDACTED]",
      nested: {
        value: "prefix [REDACTED] suffix",
        ip_address: "[REDACTED]",
        user_agent: "[REDACTED]",
      },
    });
  });

  it("keeps network fields only when explicitly requested", () => {
    expect(
      redactSensitive(
        { ip: "192.0.2.1", user_agent: "ExampleBrowser" },
        { includeNetwork: true },
      ),
    ).toEqual({ ip: "192.0.2.1", user_agent: "ExampleBrowser" });
  });

  it("parses ISO and Unix timestamps", () => {
    expect(toEpochSeconds("1700000000")).toBe(1700000000);
    expect(toEpochSeconds("2024-01-01T00:00:00Z")).toBe(1704067200);
    expect(() => toEpochSeconds("tomorrow-ish")).toThrow("Invalid timestamp");
  });

  it("accepts only positive integer limits", () => {
    expect(parsePositiveInteger("25", "--limit")).toBe(25);
    expect(() => parsePositiveInteger("0", "--limit")).toThrow(
      "--limit must be a positive integer",
    );
    expect(() => parsePositiveInteger("1.5", "--limit")).toThrow(
      "--limit must be a positive integer",
    );
  });

  it("collects repeated long options in both supported forms", () => {
    expect(
      collectRepeatedOption(
        [
          "--field",
          "Team Code=alpha",
          "--field=Region=west",
          "--json",
        ],
        "field",
      ),
    ).toEqual(["Team Code=alpha", "Region=west"]);
  });
});

describe("admin response parsing", () => {
  it("extracts a workspace client token without exposing unrelated data", () => {
    const html = `{"api_token":"xoxc-example-token","other":"value"}`;
    expect(extractWorkspaceClientToken(html)).toBe("xoxc-example-token");
    expect(extractWorkspaceClientToken("<html>signed out</html>")).toBeNull();
  });

  it("adds actionable guidance to plan and permission failures", () => {
    expect(workspaceApiError("team.accessLogs", "paid_only").message).toContain(
      "eligible paid Slack plan",
    );
    expect(
      workspaceApiError("users.profile.set", "restricted_action").message,
    ).toContain("owner/admin");
  });

  it("summarizes only the supported authentication preferences", () => {
    expect(
      summarizeAuthPrefs({
        auth_mode: "google",
        google_sso_enable: true,
        google_sso_domain: "example.test",
        saml_enable: false,
        sso_sync_with_provider: true,
        sso_change_email: false,
        sso_choose_username: true,
        sso_optional: false,
        two_factor_auth_required: 1,
        secret_internal_pref: "must-not-leak",
      }),
    ).toEqual({
      mode: "google",
      google_enabled: true,
      google_domain: "example.test",
      saml_enabled: false,
      profile_sync_on_login: true,
      email_changes_allowed: false,
      display_name_changes_allowed: true,
      sso_optional: false,
      two_factor_required: true,
    });
  });

  it("parses a redacted billing overview from Slack automount data", () => {
    const props = JSON.stringify({
      productLevelForDisplay: "Example Plan",
      currency: "USD",
      numPaidUsers: 12,
      teamPayDateNext: "January 2, 2030",
      costRecurring: {
        plan: { total: 24000 },
        product: { unit_cost: 2000, term: "1m" },
      },
      planWillRenew: true,
      planWillSwitch: false,
      isOnTrial: false,
      isPayingByInvoice: false,
      emailRecipients: ["private@example.test"],
      cardLastFour: "0000",
    }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const html =
      `<div data-automount-component="AdminBillingOverview" ` +
      `data-automount-props="${props}"></div>`;
    const summary = parseBillingOverview(html);
    expect(summary).toEqual({
      plan: "Example Plan",
      currency: "USD",
      paid_users: 12,
      renewal_date: "January 2, 2030",
      recurring_total: 240,
      recurring_unit_cost: 20,
      term: "1m",
      renews: true,
      switches_plan: false,
      trial: false,
      invoice_billing: false,
    });
    expect(JSON.stringify(summary)).not.toContain("private@example.test");
    expect(JSON.stringify(summary)).not.toContain("0000");
  });

  it("summarizes billing events without invoice or payment URLs", () => {
    const events = summarizeBillingHistory([
      {
        id: 123,
        type: "renewal",
        date_create: 1704067200,
        status: "succeeded",
        invoice: {
          amount: 12500,
          currency: "USD",
          hosted_url: "https://billing.example.test/private",
        },
        product: { level: "plus", term: "1m" },
        audit_id: "EXAMPLE-123",
      },
    ]);
    expect(events).toEqual([
      {
        id: "123",
        type: "renewal",
        date: "2024-01-01T00:00:00.000Z",
        status: "succeeded",
        amount: 125,
        currency: "USD",
        plan: "plus",
        term: "1m",
        users_from: null,
        users_to: null,
        audit_id: "EXAMPLE-123",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("billing.example.test");
  });
});
