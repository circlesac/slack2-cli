import { createHash } from "node:crypto";
import {
  flattenProfileFields,
  getAdminProfileSections,
  summarizeProfileField,
  type ProfileFieldSummary,
  type SlackMember,
} from "./admin-profile.ts";
import {
  parseBillingOverview,
  summarizeAuthPrefs,
  type AuthSummary,
  type BillingSummary,
} from "./admin-settings.ts";
import {
  fetchWorkspaceAdminPage,
  workspaceApi,
} from "./workspace-client.ts";

export const ADMIN_SNAPSHOT_SCHEMA_VERSION = 1;

export type SnapshotSourceStatus =
  | "ok"
  | "unsupported_by_plan"
  | "permission_denied"
  | "authentication_required"
  | "rate_limited"
  | "unknown";

export interface SnapshotSource {
  status: SnapshotSourceStatus;
  detail?: string;
}

export interface MemberSummary {
  total: number;
  active_humans: number;
  deactivated: number;
  bots: number;
  guests: number;
  restricted_guests: number;
  admins: number;
  owners: number;
  primary_owners: number;
}

export interface CustomizationSummary {
  custom_emoji_count: number;
  custom_emoji_alias_count: number;
  custom_emoji_fingerprint: string;
}

export interface AdminSnapshot {
  schema_version: number;
  captured_at: string;
  workspace: string;
  sources: Record<string, SnapshotSource>;
  plan: BillingSummary | null;
  capabilities: Record<string, string>;
  authentication: AuthSummary | null;
  profile_fields: Record<string, Omit<ProfileFieldSummary, "id" | "admin_id">>;
  members: MemberSummary | null;
  preferences: Record<string, Record<string, unknown>>;
  customization: CustomizationSummary | null;
}

export type AdminDiffClassification =
  | "different"
  | "only_in_from"
  | "only_in_to"
  | "unsupported_by_plan"
  | "permission_denied"
  | "authentication_required"
  | "rate_limited"
  | "unknown";

export interface AdminDiffEntry {
  path: string;
  classification: AdminDiffClassification;
  from?: unknown;
  to?: unknown;
}

export interface AdminSnapshotDiff {
  schema_version: number;
  from_workspace: string;
  to_workspace: string;
  differences: AdminDiffEntry[];
  counts: Record<AdminDiffClassification, number>;
}

const TRANSIENT_PREFERENCE_PATTERNS = [
  /^image_(?:34|44|68|88|102|132|230|original)$/,
  /^has_seen_/,
  /^has_redeemed_/,
  /^was_treatment_/,
  /^received_/,
  /^is_eligible_/,
  /^solutions_onboarding_tracker$/,
  /^show_legacy_paid_benefits_page$/,
  /^filepicker_app_first_install$/,
  /^premium_workflow_notifications$/,
  /^allow_feature_request$/,
  /^allow_free_automated_trials$/,
  /^enterprise_mdm_token$/,
  /^custom_contact_email$/,
];

const FINGERPRINT_PREFERENCES = new Set([
  "ip_restriction_ranges",
  "ntlm_credential_domains",
  "mcp_safe_link_domains",
  "slackbot_ai_web_search_domain_filter",
  "frontline_allowed_workspaces",
  "slack_ai_allowed_workspaces",
  "slack_connect_allowed_workspaces",
]);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function fingerprint(value: unknown): string {
  const stable = JSON.stringify(stableValue(value));
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function summarizeRestrictedValue(value: unknown): Record<string, unknown> {
  return {
    configured:
      value !== null &&
      value !== undefined &&
      value !== "" &&
      (!Array.isArray(value) || value.length > 0),
    count: Array.isArray(value)
      ? value.length
      : value && typeof value === "object"
        ? Object.keys(value as Record<string, unknown>).length
        : null,
    fingerprint: fingerprint(value),
  };
}

function sanitizePreferenceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePreferenceValue(entry));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (
        /xox[abcdoprst]-/i.test(value) ||
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
      ) {
        return "[REDACTED]";
      }
      if (/^U[A-Z0-9]{8,}$/.test(value)) return "[REDACTED_USER_ID]";
      if (/^https?:\/\//i.test(value)) {
        return `[REDACTED_URL:${fingerprint(value.replace(/[?#].*$/, ""))}]`;
      }
      if (
        /^(?:\+?[\d ()-]{8,}|(?:\d{1,3}\.){3}\d{1,3})$/.test(value)
      ) {
        return `[REDACTED_NETWORK_OR_PHONE:${fingerprint(value)}]`;
      }
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(token|secret|password|cookie)/i.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sanitizePreferenceValue(entry)]),
  );
}

function normalizeStatusPresets(value: unknown): unknown {
  if (!Array.isArray(value)) return sanitizePreferenceValue(value);
  return value.map((preset) => {
    if (!Array.isArray(preset)) return sanitizePreferenceValue(preset);
    return {
      emoji: preset[0] ?? "",
      text: preset[1] ?? "",
      localized_text: preset[2] ?? "",
      expiration: preset[3] ?? "",
    };
  });
}

function normalizeAiApps(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const input = value as {
    is_enabled?: boolean;
    allowed_apps?: Array<Record<string, unknown>>;
  };
  return {
    enabled: Boolean(input.is_enabled),
    allowed_apps: (input.allowed_apps ?? [])
      .map((app) => ({
        app_id: String(app.app_id ?? ""),
        visible_in_ai_surface: Boolean(app.should_show_in_sunroof),
      }))
      .sort((left, right) => left.app_id.localeCompare(right.app_id)),
  };
}

export function preferenceCategory(key: string): string {
  if (
    /^(auth_|google_sso_|saml_|sso_|sign_in_with_slack_|no_email_user_provision)/.test(
      key,
    )
  ) {
    return "authentication";
  }
  if (
    /^(two_factor_|session_|warn_user_before_logout|security_|ip_restriction_)/.test(
      key,
    )
  ) {
    return "security";
  }
  if (
    /^(display_|atlas_|who_can_change_team_profile|hide_person_opt_out|display_.*celebration)/.test(
      key,
    )
  ) {
    return "profiles";
  }
  if (
    /^(invite|invites_|invited_|joiner_|loading_only_admins|stats_only_admins|who_has_team_visibility|can_create_external_limited_invite|who_can_create_external_limited_invite)/.test(
      key,
    )
  ) {
    return "members_and_invites";
  }
  if (
    /^(retention_|dm_retention_|group_retention_|file_retention_|record_channel_|private_retention_|public_retention_|canvas_retention_|sales_home_retention_|ext_audit_log_retention_|allow_retention|allow_admin_retention|compliance_|has_compliance|single_user_exports|channel_audit_export|gdpr_)/.test(
      key,
    )
  ) {
    return "retention_and_exports";
  }
  if (
    /^(disable_file_|block_file_|block_file_types|allowed_file_|file_limit_|disallow_public_file_urls|allow_box_cfs|content_review|flag_content|flag_message|thorn_)/.test(
      key,
    )
  ) {
    return "files_and_content";
  }
  if (
    /^(slack_connect_|enable_shared_channels|allow_shared_channels|can_accept_slack_connect|can_create_slack_connect|can_receive_shared|who_can_accept_slack_connect|who_can_create_shared|who_can_create_slack_connect|who_can_manage_ext_shared|allow_.*_sharing_slack_connect)/.test(
      key,
    )
  ) {
    return "slack_connect";
  }
  if (/^(allow_calls|calls_|allow_huddles|allow_.*clips|allow_.*transcriptions)/.test(key)) {
    return "calls_huddles_and_clips";
  }
  if (
    /^(workflow_|workflows_|wfb_|hermes_|default_function_|who_can_create_workflows|restrict_workflow)/.test(
      key,
    )
  ) {
    return "workflows";
  }
  if (/^(ai_|slack_ai_|slackbot_ai_|mcp_)/.test(key)) return "ai";
  if (
    /^(app_|allow_external_skill|allow_receiving_external_skill|gdrive_|onedrive_|box_|magic_unfurls|who_can_manage_integrations|disable_sidebar_.*prompts)/.test(
      key,
    )
  ) {
    return "apps_and_integrations";
  }
  if (/^(canvas_|allow_lists|list_|read_only_canvas)/.test(key)) {
    return "canvas_and_lists";
  }
  if (/^(mobile_|enterprise_mdm_|enterprise_mobile_|ntlm_)/.test(key)) {
    return "mobile_and_device";
  }
  if (/^(developer_sandbox_|allow_developer_sandboxes)/.test(key)) {
    return "developer_sandboxes";
  }
  if (
    /^(allow_message_deletion|msg_edit_window|private_message_forwarding|default_channel|default_create_private_channel|show_join_leave|loud_channel_mentions|warn_before_at_channel|allow_lock_thread|channel_email_addresses|enable_mpdm|default_rxns|rich_previews)/.test(
      key,
    )
  ) {
    return "channels_and_messages";
  }
  return "workspace_experience";
}

export function normalizeWorkspacePreferences(
  prefs: Record<string, unknown>,
  options: {
    defaultChannels?: string[] | null;
  } = {},
): Record<string, Record<string, unknown>> {
  const categories: Record<string, Record<string, unknown>> = {};
  for (const [key, rawValue] of Object.entries(prefs).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (TRANSIENT_PREFERENCE_PATTERNS.some((pattern) => pattern.test(key))) {
      continue;
    }
    let value: unknown;
    if (
      key === "default_channels" &&
      Object.hasOwn(options, "defaultChannels")
    ) {
      if (options.defaultChannels === null) continue;
      value = options.defaultChannels;
    } else if (key === "custom_status_presets") {
      value = normalizeStatusPresets(rawValue);
    } else if (key === "ai_apps") {
      value = normalizeAiApps(rawValue);
    } else if (FINGERPRINT_PREFERENCES.has(key)) {
      value = summarizeRestrictedValue(rawValue);
    } else {
      value = sanitizePreferenceValue(rawValue);
    }
    const category = preferenceCategory(key);
    (categories[category] ??= {})[key] = value;
  }
  const customContact = prefs.custom_contact_email;
  (categories.workspace_experience ??= {}).custom_contact_email = {
    configured:
      typeof customContact === "string" && customContact.trim().length > 0,
  };
  const image = prefs.image_original;
  (categories.workspace_experience ??= {}).workspace_icon = {
    custom: prefs.image_default === false && Boolean(image),
    fingerprint:
      typeof image === "string"
        ? fingerprint(image.replace(/[?#].*$/, ""))
        : fingerprint(null),
  };
  return Object.fromEntries(
    Object.entries(categories)
      .filter(([, entries]) => Object.keys(entries).length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function profileFieldSnapshot(
  fields: ProfileFieldSummary[],
): AdminSnapshot["profile_fields"] {
  return Object.fromEntries(
    fields
      .map((field) => {
        const { id: _id, admin_id: _adminId, ...stable } = field;
        return [
          field.key.toLowerCase(),
          {
            ...stable,
            valid_sources: [...stable.valid_sources].sort(),
            allowed_writers: [...stable.allowed_writers].sort(),
          },
        ] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function summarizeMembers(members: SlackMember[]): MemberSummary {
  const active = members.filter((member) => !member.deleted);
  return {
    total: members.length,
    active_humans: active.filter(
      (member) => !member.is_bot && !member.is_app_user,
    ).length,
    deactivated: members.filter((member) => member.deleted).length,
    bots: active.filter((member) => member.is_bot || member.is_app_user).length,
    guests: active.filter(
      (member) => member.is_restricted || member.is_ultra_restricted,
    ).length,
    restricted_guests: active.filter((member) => member.is_ultra_restricted)
      .length,
    admins: active.filter((member) => member.is_admin).length,
    owners: active.filter((member) => member.is_owner).length,
    primary_owners: active.filter((member) => member.is_primary_owner).length,
  };
}

function classifySnapshotError(error: unknown): SnapshotSource {
  const message = error instanceof Error ? error.message : String(error);
  if (/paid_only|not_enterprise|requires .*plan|only available on/i.test(message)) {
    return { status: "unsupported_by_plan", detail: message };
  }
  if (/permission|restricted_action|owner\/admin|missing_scope/i.test(message)) {
    return { status: "permission_denied", detail: message };
  }
  if (/invalid_auth|not_authed|expired|login/i.test(message)) {
    return { status: "authentication_required", detail: message };
  }
  if (/rate|429/i.test(message)) {
    return { status: "rate_limited", detail: message };
  }
  return { status: "unknown", detail: message };
}

async function collectSource<T>(
  operation: () => Promise<T>,
): Promise<{ source: SnapshotSource; value: T | null }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return { source: { status: "ok" }, value: await operation() };
    } catch (error) {
      const classified = classifySnapshotError(error);
      if (classified.status !== "rate_limited" || attempt === 2) {
        return { source: classified, value: null };
      }
      const retrySeconds = Number(
        classified.detail?.match(/Retry after (\d+) seconds/i)?.[1],
      );
      const delay = Number.isFinite(retrySeconds)
        ? Math.min(retrySeconds * 1000, 10_000)
        : 500 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return {
    source: { status: "unknown", detail: "Snapshot collection failed." },
    value: null,
  };
}

async function listMembers(workspace: string): Promise<SlackMember[]> {
  const members: SlackMember[] = [];
  let cursor = "";
  do {
    const response = await workspaceApi(workspace, "users.list", {
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    members.push(...((response.members as SlackMember[] | undefined) ?? []));
    const metadata = response.response_metadata as
      | { next_cursor?: string }
      | undefined;
    cursor = metadata?.next_cursor ?? "";
  } while (cursor);
  return members;
}

async function resolveDefaultChannels(
  workspace: string,
  ids: unknown,
): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.map(String));
  const names = new Map<string, string>();
  let cursor = "";
  do {
    const response = await workspaceApi(workspace, "conversations.list", {
      limit: 200,
      types: "public_channel,private_channel",
      exclude_archived: false,
      ...(cursor ? { cursor } : {}),
    });
    for (const channel of (
      response.channels as Array<{ id?: string; name?: string }> | undefined
    ) ?? []) {
      if (channel.id && channel.name && wanted.has(channel.id)) {
        names.set(channel.id, channel.name);
      }
    }
    const metadata = response.response_metadata as
      | { next_cursor?: string }
      | undefined;
    cursor = metadata?.next_cursor ?? "";
  } while (cursor && names.size < wanted.size);
  return ids.map((id) =>
    names.get(String(id)) ?? `unresolved:${fingerprint(id)}`
  );
}

async function customizationSummary(
  workspace: string,
): Promise<CustomizationSummary> {
  const response = await workspaceApi(workspace, "emoji.list");
  const emoji = (response.emoji ?? {}) as Record<string, string>;
  const names = Object.keys(emoji).sort();
  return {
    custom_emoji_count: names.length,
    custom_emoji_alias_count: Object.values(emoji).filter((value) =>
      value.startsWith("alias:")
    ).length,
    custom_emoji_fingerprint: fingerprint(names),
  };
}

function planLevel(plan: string | undefined): number {
  const value = (plan ?? "").toLowerCase();
  if (value.includes("enterprise")) return 3;
  if (value.includes("business") || value.includes("plus")) return 2;
  if (value.includes("pro") || value === "std") return 1;
  if (value.includes("free")) return 0;
  return -1;
}

export function deriveCapabilities(
  plan: BillingSummary | null,
  fields: AdminSnapshot["profile_fields"],
  prefs: Record<string, unknown> | null,
): Record<string, string> {
  const level = planLevel(plan?.plan);
  const fieldValues = Object.values(fields);
  const scim = fieldValues.some((field) =>
    field.valid_sources.includes("scim")
  );
  const samlConfigured = Boolean(prefs?.saml_enable);
  return {
    access_logs:
      level >= 1
        ? "supported"
        : level === 0
          ? "unsupported_by_plan"
          : "unknown",
    audit_logs:
      level >= 3
        ? "supported_requires_org_owner_token"
        : level >= 0
          ? "unsupported_by_plan"
          : "unknown",
    profile_api_updates: fieldValues.some((field) => field.source === "api")
      ? "supported"
      : "not_exposed_by_schema",
    profile_scim:
      scim ? "supported" : "not_exposed_by_workspace_schema",
    saml_sso:
      samlConfigured || level >= 2
        ? "supported"
        : level >= 0
          ? "not_exposed_by_plan_or_integration"
          : "unknown",
    google_auth: prefs?.google_sso_enable ? "configured" : "not_configured",
  };
}

export async function collectAdminSnapshot(
  workspace: string,
): Promise<AdminSnapshot> {
  const preferencesResult = await collectSource(async () => {
    const response = await workspaceApi(workspace, "team.prefs.get");
    return (response.prefs ?? response) as Record<string, unknown>;
  });
  const profileResult = await collectSource(async () => {
    const sections = await getAdminProfileSections(workspace);
    return flattenProfileFields(sections).map(summarizeProfileField);
  });
  const billingResult = await collectSource(async () =>
    parseBillingOverview(
      await fetchWorkspaceAdminPage(workspace, "/admin/billing"),
    )
  );
  const membersResult = await collectSource(async () =>
    summarizeMembers(await listMembers(workspace))
  );
  const emojiResult = await collectSource(async () =>
    customizationSummary(workspace)
  );

  const rawPreferences = preferencesResult.value;
  const defaultChannelsResult = rawPreferences
    ? await collectSource(async () =>
      resolveDefaultChannels(workspace, rawPreferences.default_channels)
    )
    : {
        source: preferencesResult.source,
        value: null,
      };
  const fields = profileFieldSnapshot(profileResult.value ?? []);
  const plan = billingResult.value;
  return {
    schema_version: ADMIN_SNAPSHOT_SCHEMA_VERSION,
    captured_at: new Date().toISOString(),
    workspace,
    sources: {
      preferences: preferencesResult.source,
      default_channels: defaultChannelsResult.source,
      profile_schema: profileResult.source,
      billing: billingResult.source,
      members: membersResult.source,
      customization: emojiResult.source,
    },
    plan,
    capabilities: deriveCapabilities(plan, fields, rawPreferences),
    authentication: rawPreferences
      ? summarizeAuthPrefs(rawPreferences)
      : null,
    profile_fields: fields,
    members: membersResult.value,
    preferences: rawPreferences
      ? normalizeWorkspacePreferences(rawPreferences, {
          defaultChannels: defaultChannelsResult.value,
        })
      : {},
    customization: emojiResult.value,
  };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function specialClassification(
  left: unknown,
  right: unknown,
): AdminDiffClassification | null {
  const values = [left, right];
  if (
    values.some(
      (value) =>
        typeof value === "string" &&
        (value === "unsupported_by_plan" ||
          value.includes("not_exposed_by_plan")),
    )
  ) {
    return "unsupported_by_plan";
  }
  if (values.includes("permission_denied")) return "permission_denied";
  if (values.includes("authentication_required")) {
    return "authentication_required";
  }
  if (values.includes("rate_limited")) return "rate_limited";
  if (values.includes("unknown")) return "unknown";
  return null;
}

function walkDiff(
  left: unknown,
  right: unknown,
  path: string,
  output: AdminDiffEntry[],
): void {
  if (valuesEqual(left, right)) return;
  if (left === undefined) {
    output.push({ path, classification: "only_in_to", to: right });
    return;
  }
  if (right === undefined) {
    output.push({ path, classification: "only_in_from", from: left });
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    output.push({
      path,
      classification: specialClassification(left, right) ?? "different",
      from: left,
      to: right,
    });
    return;
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    for (const key of [...new Set([
      ...Object.keys(leftObject),
      ...Object.keys(rightObject),
    ])].sort()) {
      walkDiff(
        leftObject[key],
        rightObject[key],
        path ? `${path}.${key}` : key,
        output,
      );
    }
    return;
  }
  output.push({
    path,
    classification: specialClassification(left, right) ?? "different",
    from: left,
    to: right,
  });
}

export function diffAdminSnapshots(
  from: AdminSnapshot,
  to: AdminSnapshot,
  section?: string,
): AdminSnapshotDiff {
  const sourceStatus = (
    snapshot: AdminSnapshot,
    name: string,
  ): SnapshotSourceStatus => snapshot.sources[name]?.status ?? "unknown";
  const bothAvailable = (name: string): boolean =>
    sourceStatus(from, name) === "ok" && sourceStatus(to, name) === "ok";
  const left: Record<string, unknown> = {
    sources: Object.fromEntries(
      Object.entries(from.sources).map(([name, source]) => [
        name,
        source.status,
      ]),
    ),
  };
  const right: Record<string, unknown> = {
    sources: Object.fromEntries(
      Object.entries(to.sources).map(([name, source]) => [
        name,
        source.status,
      ]),
    ),
  };
  if (bothAvailable("billing")) {
    left.plan = from.plan;
    right.plan = to.plan;
  }
  if (
    bothAvailable("billing") &&
    bothAvailable("preferences") &&
    bothAvailable("profile_schema")
  ) {
    left.capabilities = from.capabilities;
    right.capabilities = to.capabilities;
  }
  if (bothAvailable("preferences")) {
    left.authentication = from.authentication;
    right.authentication = to.authentication;
    const fromPreferences = structuredClone(from.preferences);
    const toPreferences = structuredClone(to.preferences);
    if (!bothAvailable("default_channels")) {
      delete fromPreferences.channels_and_messages?.default_channels;
      delete toPreferences.channels_and_messages?.default_channels;
    }
    left.preferences = fromPreferences;
    right.preferences = toPreferences;
  }
  if (bothAvailable("profile_schema")) {
    left.profile_fields = from.profile_fields;
    right.profile_fields = to.profile_fields;
  }
  if (bothAvailable("members")) {
    left.members = from.members;
    right.members = to.members;
  }
  if (bothAvailable("customization")) {
    left.customization = from.customization;
    right.customization = to.customization;
  }
  const allSections = [
    "sources",
    "plan",
    "capabilities",
    "authentication",
    "profile_fields",
    "members",
    "preferences",
    "customization",
  ];
  if (section && !(section in left)) {
    if (!allSections.includes(section)) {
      throw new Error(
        `Unknown snapshot section "${section}". Valid sections: ${
          allSections.join(", ")
        }.`,
      );
    }
    const sourceForSection: Record<string, string[]> = {
      plan: ["billing"],
      capabilities: ["billing", "preferences", "profile_schema"],
      authentication: ["preferences"],
      profile_fields: ["profile_schema"],
      members: ["members"],
      preferences: ["preferences", "default_channels"],
      customization: ["customization"],
    };
    const sources = sourceForSection[section] ?? [];
    const differences: AdminDiffEntry[] = [];
    for (const source of sources) {
      walkDiff(
        sourceStatus(from, source),
        sourceStatus(to, source),
        `sources.${source}`,
        differences,
      );
    }
    return buildSnapshotDiff(from, to, differences);
  }
  const differences: AdminDiffEntry[] = [];
  if (section) {
    walkDiff(left[section], right[section], section, differences);
  } else {
    walkDiff(left, right, "", differences);
  }
  reclassifyProfileCapabilityGaps(differences, from, to);
  return buildSnapshotDiff(from, to, differences);
}

function reclassifyProfileCapabilityGaps(
  differences: AdminDiffEntry[],
  from: AdminSnapshot,
  to: AdminSnapshot,
): void {
  for (const entry of differences) {
    if (!/^profile_fields\.[^.]+$/.test(entry.path)) continue;
    if (
      entry.classification === "only_in_to" &&
      from.capabilities.profile_scim !== "supported" &&
      Array.isArray((entry.to as { valid_sources?: unknown })?.valid_sources) &&
      (
        (entry.to as { valid_sources: unknown[] }).valid_sources
      ).includes("scim")
    ) {
      entry.classification = "unsupported_by_plan";
    }
    if (
      entry.classification === "only_in_from" &&
      to.capabilities.profile_scim !== "supported" &&
      Array.isArray((entry.from as { valid_sources?: unknown })?.valid_sources) &&
      (
        (entry.from as { valid_sources: unknown[] }).valid_sources
      ).includes("scim")
    ) {
      entry.classification = "unsupported_by_plan";
    }
  }
}

function buildSnapshotDiff(
  from: AdminSnapshot,
  to: AdminSnapshot,
  differences: AdminDiffEntry[],
): AdminSnapshotDiff {
  const classifications: AdminDiffClassification[] = [
    "different",
    "only_in_from",
    "only_in_to",
    "unsupported_by_plan",
    "permission_denied",
    "authentication_required",
    "rate_limited",
    "unknown",
  ];
  return {
    schema_version: ADMIN_SNAPSHOT_SCHEMA_VERSION,
    from_workspace: from.workspace,
    to_workspace: to.workspace,
    differences,
    counts: Object.fromEntries(
      classifications.map((classification) => [
        classification,
        differences.filter((entry) => entry.classification === classification)
          .length,
      ]),
    ) as Record<AdminDiffClassification, number>,
  };
}
