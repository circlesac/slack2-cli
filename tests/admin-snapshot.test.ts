import { describe, expect, it } from "vitest";
import {
  ADMIN_SNAPSHOT_SCHEMA_VERSION,
  deriveCapabilities,
  diffAdminSnapshots,
  normalizeWorkspacePreferences,
  preferenceCategory,
  profileFieldSnapshot,
  summarizeMembers,
  type AdminSnapshot,
} from "../src/lib/admin-snapshot.ts";
import type { ProfileFieldSummary } from "../src/lib/admin-profile.ts";
import type { BillingSummary } from "../src/lib/admin-settings.ts";

const apiField: ProfileFieldSummary = {
  id: "XfEXAMPLE",
  admin_id: "PeEXAMPLE",
  label: "Title",
  key: "title",
  type: "text",
  section: "Header",
  source: "api",
  visible: true,
  protected: true,
  allowed_writers: ["WORKSPACE_OWNER", "WORKSPACE_ADMIN"],
  valid_sources: ["member", "api"],
};

const proPlan: BillingSummary = {
  plan: "Pro",
  currency: "USD",
  paid_users: 2,
  renewal_date: null,
  recurring_total: null,
  recurring_unit_cost: null,
  term: "1m",
  renews: true,
  switches_plan: false,
  trial: false,
  invoice_billing: false,
};

function snapshot(
  workspace: string,
  overrides: Partial<AdminSnapshot> = {},
): AdminSnapshot {
  return {
    schema_version: ADMIN_SNAPSHOT_SCHEMA_VERSION,
    captured_at: "2030-01-01T00:00:00.000Z",
    workspace,
    sources: {
      preferences: { status: "ok" },
      default_channels: { status: "ok" },
      profile_schema: { status: "ok" },
      billing: { status: "ok" },
      members: { status: "ok" },
      customization: { status: "ok" },
    },
    plan: proPlan,
    capabilities: { access_logs: "supported" },
    authentication: null,
    profile_fields: profileFieldSnapshot([apiField]),
    members: null,
    preferences: {},
    customization: null,
    ...overrides,
  };
}

describe("admin snapshot normalization", () => {
  it("groups preferences and removes or summarizes sensitive values", () => {
    const result = normalizeWorkspacePreferences(
      {
        auth_mode: "google",
        default_channels: ["C111"],
        custom_status_presets: [
          [":calendar:", "Meeting", "Meeting", "30_minutes"],
        ],
        ai_apps: {
          is_enabled: true,
          allowed_apps: [
            {
              app_id: "A111",
              bot_user_id: "U111",
              should_show_in_sunroof: true,
            },
          ],
        },
        ip_restriction_ranges: ["192.0.2.0/24"],
        enterprise_mdm_token: "xoxp-must-not-appear",
        custom_contact_email: "private@example.test",
        image_default: false,
        image_original: "https://cdn.example.test/icon.png?signature=private",
        example_url: "https://private.example.test/path?token=secret",
        example_owner: "U12345678",
        has_seen_partner_promo: true,
      },
      { defaultChannels: ["general"] },
    );

    expect(result.authentication?.auth_mode).toBe("google");
    expect(result.channels_and_messages?.default_channels).toEqual([
      "general",
    ]);
    expect(result.workspace_experience?.custom_status_presets).toEqual([
      {
        emoji: ":calendar:",
        text: "Meeting",
        localized_text: "Meeting",
        expiration: "30_minutes",
      },
    ]);
    expect(result.ai?.ai_apps).toEqual({
      enabled: true,
      allowed_apps: [
        { app_id: "A111", visible_in_ai_surface: true },
      ],
    });
    expect(result.security?.ip_restriction_ranges).toMatchObject({
      configured: true,
      count: 1,
    });
    expect(
      result.workspace_experience?.custom_contact_email,
    ).toEqual({ configured: true });
    expect(result.workspace_experience?.workspace_icon).toMatchObject({
      custom: true,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("xoxp-must-not-appear");
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("bot_user_id");
    expect(serialized).not.toContain("signature=private");
    expect(serialized).not.toContain("private.example.test");
    expect(serialized).not.toContain("U12345678");
    expect(serialized).not.toContain("has_seen_partner_promo");
  });

  it("assigns representative preferences to stable categories", () => {
    expect(preferenceCategory("two_factor_auth_required")).toBe("security");
    expect(preferenceCategory("file_retention_type")).toBe(
      "retention_and_exports",
    );
    expect(preferenceCategory("slack_connect_approval_type")).toBe(
      "slack_connect",
    );
    expect(preferenceCategory("workflow_builder_enabled")).toBe("workflows");
    expect(preferenceCategory("slack_ai_disabled")).toBe("ai");
  });

  it("keys profile fields by stable keys and omits workspace-specific IDs", () => {
    const result = profileFieldSnapshot([apiField]);
    expect(result.title).toMatchObject({
      label: "Title",
      source: "api",
      valid_sources: ["api", "member"],
    });
    expect(result.title).not.toHaveProperty("id");
    expect(result.title).not.toHaveProperty("admin_id");
  });

  it("summarizes membership without retaining member identities", () => {
    expect(
      summarizeMembers([
        {
          id: "U1",
          is_admin: true,
          is_owner: true,
          is_primary_owner: true,
        },
        { id: "U2", is_restricted: true },
        { id: "U3", is_bot: true },
        { id: "U4", deleted: true },
      ]),
    ).toEqual({
      total: 4,
      active_humans: 2,
      deactivated: 1,
      bots: 1,
      guests: 1,
      restricted_guests: 0,
      admins: 1,
      owners: 1,
      primary_owners: 1,
    });
  });

  it("derives plan and schema capabilities independently", () => {
    expect(
      deriveCapabilities(proPlan, profileFieldSnapshot([apiField]), {
        google_sso_enable: false,
      }),
    ).toEqual({
      access_logs: "supported",
      audit_logs: "unsupported_by_plan",
      profile_api_updates: "supported",
      profile_scim: "not_exposed_by_workspace_schema",
      saml_sso: "not_exposed_by_plan_or_integration",
      google_auth: "not_configured",
    });

    const businessPlan = { ...proPlan, plan: "Business+" };
    const scimField = {
      ...apiField,
      source: "scim" as const,
      valid_sources: ["api", "member", "scim"] as const,
    };
    expect(
      deriveCapabilities(
        businessPlan,
        profileFieldSnapshot([
          {
            ...scimField,
            valid_sources: [...scimField.valid_sources],
          },
        ]),
        { google_sso_enable: true },
      ),
    ).toMatchObject({
      access_logs: "supported",
      audit_logs: "unsupported_by_plan",
      profile_scim: "supported",
      saml_sso: "supported",
      google_auth: "configured",
    });
  });
});

describe("admin snapshot diff", () => {
  it("ignores capture metadata and reports normalized setting paths", () => {
    const from = snapshot("from", {
      captured_at: "2030-01-01T00:00:00.000Z",
      preferences: { security: { two_factor_auth_required: false } },
    });
    const to = snapshot("to", {
      captured_at: "2031-01-01T00:00:00.000Z",
      preferences: { security: { two_factor_auth_required: true } },
    });
    const diff = diffAdminSnapshots(from, to);
    expect(diff.differences).toEqual([
      {
        path: "preferences.security.two_factor_auth_required",
        classification: "different",
        from: false,
        to: true,
      },
    ]);
  });

  it("classifies plan and permission gaps separately from value changes", () => {
    const from = snapshot("from", {
      sources: { profile_schema: { status: "unsupported_by_plan" } },
    });
    const to = snapshot("to", {
      sources: { profile_schema: { status: "permission_denied" } },
    });
    const diff = diffAdminSnapshots(from, to);
    expect(diff.differences).toEqual([
      {
        path: "sources.profile_schema",
        classification: "unsupported_by_plan",
        from: "unsupported_by_plan",
        to: "permission_denied",
      },
    ]);
    expect(diff.counts.unsupported_by_plan).toBe(1);
  });

  it("supports a focused top-level section", () => {
    const from = snapshot("from", {
      capabilities: { audit_logs: "unsupported_by_plan" },
    });
    const to = snapshot("to", {
      capabilities: { audit_logs: "supported_requires_org_owner_token" },
    });
    const diff = diffAdminSnapshots(from, to, "capabilities");
    expect(diff.differences[0]).toMatchObject({
      path: "capabilities.audit_logs",
      classification: "unsupported_by_plan",
    });
    expect(() => diffAdminSnapshots(from, to, "missing")).toThrow(
      "Unknown snapshot section",
    );
  });

  it("does not compare values from a source that failed collection", () => {
    const from = snapshot("from", {
      sources: {
        preferences: { status: "rate_limited" },
        default_channels: { status: "ok" },
        profile_schema: { status: "ok" },
        billing: { status: "ok" },
        members: { status: "ok" },
        customization: { status: "ok" },
      },
      preferences: { security: { two_factor_auth_required: false } },
    });
    const to = snapshot("to", {
      preferences: { security: { two_factor_auth_required: true } },
    });
    const diff = diffAdminSnapshots(from, to);
    expect(diff.differences).toContainEqual({
      path: "sources.preferences",
      classification: "rate_limited",
      from: "rate_limited",
      to: "ok",
    });
    expect(
      diff.differences.some((entry) => entry.path.startsWith("preferences.")),
    ).toBe(false);
  });

  it("classifies SCIM-only field absence as a capability gap", () => {
    const scimOnly = {
      ...apiField,
      key: "employeeNumber",
      label: "Employee ID",
      source: "scim" as const,
      valid_sources: ["scim" as const],
    };
    const from = snapshot("from", {
      capabilities: { profile_scim: "not_exposed_by_workspace_schema" },
      profile_fields: {},
    });
    const to = snapshot("to", {
      capabilities: { profile_scim: "supported" },
      profile_fields: profileFieldSnapshot([scimOnly]),
    });
    const diff = diffAdminSnapshots(from, to, "profile_fields");
    expect(diff.differences).toContainEqual(
      expect.objectContaining({
        path: "profile_fields.employeenumber",
        classification: "unsupported_by_plan",
      }),
    );
  });

  it("does not report unresolved default channels as a setting difference", () => {
    const from = snapshot("from", {
      sources: {
        preferences: { status: "ok" },
        default_channels: { status: "rate_limited" },
        profile_schema: { status: "ok" },
        billing: { status: "ok" },
        members: { status: "ok" },
        customization: { status: "ok" },
      },
      preferences: {
        channels_and_messages: {
          default_channels: ["unresolved:example"],
        },
      },
    });
    const to = snapshot("to", {
      preferences: {
        channels_and_messages: { default_channels: ["general"] },
      },
    });
    const diff = diffAdminSnapshots(from, to);
    expect(diff.differences).toContainEqual({
      path: "sources.default_channels",
      classification: "rate_limited",
      from: "rate_limited",
      to: "ok",
    });
    expect(
      diff.differences.some((entry) =>
        entry.path.endsWith("default_channels")
      ),
    ).toBe(true);
    expect(
      diff.differences.some((entry) =>
        entry.path.startsWith(
          "preferences.channels_and_messages.default_channels",
        )
      ),
    ).toBe(false);
  });
});
