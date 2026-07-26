import { defineCommand } from "citty";
import {
  applyProfileFieldChanges,
  flattenProfileFields,
  getAdminProfileSections,
  parseFieldAssignments,
  profileDataSource,
  resolveMember,
  resolveProfileField,
  setAdminProfileSections,
  summarizeProfileField,
  type ProfileDataSource,
  type SlackMember,
} from "../lib/admin-profile.ts";
import { fetchAuditLogs } from "../lib/audit-logs.ts";
import {
  confirmMutation,
  collectRepeatedOption,
  formatEpoch,
  parsePositiveInteger,
  printJson,
  redactSensitive,
  toEpochSeconds,
} from "../lib/cli-safety.ts";
import {
  parseBillingOverview,
  summarizeBillingHistory,
  summarizeAuthPrefs,
} from "../lib/admin-settings.ts";
import {
  fetchWorkspaceAdminPage,
  workspaceApi,
} from "../lib/workspace-client.ts";
import {
  adminChannelCommand,
  adminChannelPolicyCommand,
  adminEmojiCommand,
  adminInvitationCommand,
  adminMemberCommand,
  adminProfilePolicyCommand,
  adminRetentionCommand,
  adminWorkspaceCommand,
} from "./admin-resources.ts";

const workspaceArg = {
  workspace: {
    type: "string" as const,
    alias: "w",
    description: "Slack workspace domain",
    required: true,
  },
};

const jsonArg = {
  json: {
    type: "boolean" as const,
    description: "Output as JSON",
    default: false,
  },
};

const mutationArgs = {
  "dry-run": {
    type: "boolean" as const,
    description: "Show the planned change without applying it",
    default: false,
  },
  yes: {
    type: "boolean" as const,
    alias: "y",
    description: "Skip the interactive confirmation",
    default: false,
  },
};

function parseSource(value: string | undefined): ProfileDataSource | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "member" || normalized === "api" || normalized === "scim") {
    return normalized;
  }
  throw new Error(`Invalid source "${value}". Use member, api, or scim.`);
}

function printFieldTable(
  fields: ReturnType<typeof summarizeProfileField>[],
): void {
  if (fields.length === 0) {
    console.log("(no profile fields)");
    return;
  }
  const rows = fields.map((field) => ({
    id: field.id,
    label: field.label,
    section: field.section,
    source: field.source,
    visible: field.visible ? "yes" : "no",
    writers:
      field.source === "api"
        ? field.allowed_writers.map((role) => role.replace(/^WORKSPACE_/, "WS_")).join(",")
        : field.allowed_writers.join(","),
  }));
  const widths = {
    id: Math.max(8, ...rows.map((row) => row.id.length)),
    label: Math.max(5, ...rows.map((row) => row.label.length)),
    section: Math.max(7, ...rows.map((row) => row.section.length)),
    source: 6,
    visible: 7,
  };
  console.log(
    `${"ID".padEnd(widths.id)}  ${"LABEL".padEnd(widths.label)}  ` +
      `${"SECTION".padEnd(widths.section)}  ${"SOURCE".padEnd(widths.source)}  ` +
      `${"VISIBLE".padEnd(widths.visible)}  WRITERS`,
  );
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(widths.id)}  ${row.label.padEnd(widths.label)}  ` +
        `${row.section.padEnd(widths.section)}  ${row.source.padEnd(widths.source)}  ` +
        `${row.visible.padEnd(widths.visible)}  ${row.writers}`,
    );
  }
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

function profileFieldValue(
  profile: Record<string, any>,
  fieldId: string,
): string {
  return String(profile.fields?.[fieldId]?.value ?? "");
}

function required(value: string | undefined, option: string): string {
  if (!value) throw new Error(`${option} is required.`);
  return value;
}

export const adminWhoamiCommand = defineCommand({
  meta: {
    name: "whoami",
    description: "Show the signed-in member and workspace admin role",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const auth = await workspaceApi(workspace, "auth.test");
    const userId = String(auth.user_id ?? "");
    const info = await workspaceApi(workspace, "users.info", {
      user: userId,
    });
    const user = (info.user ?? {}) as Record<string, unknown>;
    const result = {
      workspace,
      team_id: auth.team_id ?? null,
      user_id: userId,
      admin: Boolean(user.is_admin),
      owner: Boolean(user.is_owner),
      primary_owner: Boolean(user.is_primary_owner),
    };
    if (args.json) {
      printJson(result);
    } else {
      for (const [key, value] of Object.entries(result)) {
        console.log(`${key}: ${value}`);
      }
    }
  },
});

export const adminProfileFieldListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List workspace profile fields and their effective writers",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const sections = await getAdminProfileSections(
      required(args.workspace, "--workspace"),
    );
    const fields = flattenProfileFields(sections)
      .map(summarizeProfileField)
      .sort((a, b) =>
        a.section.localeCompare(b.section) || a.label.localeCompare(b.label)
      );
    if (args.json) printJson(fields);
    else printFieldTable(fields);
  },
});

export const adminProfileFieldGetCommand = defineCommand({
  meta: {
    name: "get",
    description: "Inspect one workspace profile field",
  },
  args: {
    field: {
      type: "positional",
      description: "Field ID, key, or exact label",
      required: true,
    },
    ...workspaceArg,
    ...jsonArg,
  },
  async run({ args }) {
    const sections = await getAdminProfileSections(
      required(args.workspace, "--workspace"),
    );
    const field = summarizeProfileField(
      resolveProfileField(sections, required(args.field, "<field>")),
    );
    if (args.json) printJson(field);
    else {
      for (const [key, value] of Object.entries(field)) {
        console.log(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
      }
    }
  },
});

export const adminProfileFieldUpdateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Change a profile field's data source or visibility",
  },
  args: {
    field: {
      type: "positional",
      description: "Field ID, key, or exact label",
      required: true,
    },
    ...workspaceArg,
    source: {
      type: "string",
      description: "Data source: member, api, or scim",
    },
    visible: {
      type: "boolean",
      description: "Show the field in member profiles",
      default: false,
    },
    hidden: {
      type: "boolean",
      description: "Hide the field from member profiles",
      default: false,
    },
    ...mutationArgs,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const fieldQuery = required(args.field, "<field>");
    if (args.visible && args.hidden) {
      throw new Error("--visible and --hidden cannot be used together.");
    }
    const source = parseSource(args.source);
    const visible = args.visible ? true : args.hidden ? false : undefined;
    if (source === undefined && visible === undefined) {
      throw new Error("Pass --source, --visible, or --hidden.");
    }

    const sections = await getAdminProfileSections(workspace);
    const mutation = applyProfileFieldChanges(sections, fieldQuery, {
      source,
      visible,
    });
    const diff = {
      workspace,
      field: mutation.before.id,
      dry_run: Boolean(args["dry-run"]),
      before: {
        source: mutation.before.source,
        visible: mutation.before.visible,
      },
      after: {
        source: mutation.after.source,
        visible: mutation.after.visible,
      },
    };
    if (args.json) printJson(diff);
    else {
      console.log(`Field: ${mutation.before.label} (${mutation.before.id})`);
      console.log(
        `  source:  ${mutation.before.source} -> ${mutation.after.source}`,
      );
      console.log(
        `  visible: ${mutation.before.visible} -> ${mutation.after.visible}`,
      );
    }
    if (args["dry-run"]) {
      if (!args.json) console.log("Dry run: no workspace changes were made.");
      return;
    }
    const confirmed = await confirmMutation(
      `Publish this profile field change to ${workspace}?`,
      { yes: args.yes },
    );
    if (!confirmed) {
      console.error("Cancelled.");
      return;
    }
    await setAdminProfileSections(workspace, mutation.sections);
    if (!args.json) {
      console.log(`Updated profile field: ${mutation.before.label}`);
    }
  },
});

export const adminProfileFieldCommand = defineCommand({
  meta: {
    name: "profile-field",
    description: "Inspect and configure workspace profile fields",
  },
  subCommands: {
    list: adminProfileFieldListCommand,
    get: adminProfileFieldGetCommand,
    update: adminProfileFieldUpdateCommand,
  },
});

export const adminMemberProfileGetCommand = defineCommand({
  meta: {
    name: "get",
    description: "Read a member's workspace profile",
  },
  args: {
    member: {
      type: "positional",
      description: "Member ID, email, username, or exact display name",
      required: true,
    },
    ...workspaceArg,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const [members, sections] = await Promise.all([
      listMembers(workspace),
      getAdminProfileSections(workspace),
    ]);
    const member = resolveMember(members, required(args.member, "<member>"));
    const response = await workspaceApi(workspace, "users.profile.get", {
      user: member.id,
    });
    const profile = (response.profile ?? {}) as Record<string, any>;
    const labels = new Map(
      flattenProfileFields(sections).map(({ element }) => [
        element.legacyFieldId,
        element.label,
      ]),
    );
    const customFields = Object.entries(profile.fields ?? {}).map(
      ([id, value]: [string, any]) => ({
        id,
        label: labels.get(id) ?? id,
        value: value?.value ?? "",
      }),
    );
    const result = {
      user_id: member.id,
      display_name: profile.display_name ?? profile.real_name ?? "",
      title: profile.title ?? "",
      phone: profile.phone ?? "",
      fields: customFields,
    };
    if (args.json) printJson(result);
    else {
      console.log(`user_id: ${result.user_id}`);
      console.log(`display_name: ${result.display_name}`);
      console.log(`title: ${result.title}`);
      console.log(`phone: ${result.phone}`);
      for (const field of customFields) {
        console.log(`${field.label} (${field.id}): ${field.value}`);
      }
    }
  },
});

export const adminMemberProfileUpdateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update API-managed fields on a member profile",
  },
  args: {
    member: {
      type: "positional",
      description: "Member ID, email, username, or exact display name",
      required: true,
    },
    ...workspaceArg,
    title: {
      type: "string",
      description: "Set the standard Title field",
    },
    field: {
      type: "string",
      description: "Set a field as <name-or-id>=<value>; may be repeated",
    },
    ...mutationArgs,
    ...jsonArg,
  },
  async run({ args, rawArgs }) {
    const workspace = required(args.workspace, "--workspace");
    const repeatedFields = collectRepeatedOption(rawArgs, "field");
    const assignments = parseFieldAssignments(
      repeatedFields.length > 0 ? repeatedFields : args.field,
    );
    if (args.title === undefined && assignments.length === 0) {
      throw new Error("Pass --title or at least one --field assignment.");
    }

    const [members, sections] = await Promise.all([
      listMembers(workspace),
      getAdminProfileSections(workspace),
    ]);
    const member = resolveMember(members, required(args.member, "<member>"));
    const response = await workspaceApi(workspace, "users.profile.get", {
      user: member.id,
    });
    const current = (response.profile ?? {}) as Record<string, any>;
    const profile: Record<string, unknown> = {};
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};

    if (args.title !== undefined) {
      const title = resolveProfileField(sections, "title");
      if (profileDataSource(title.element.permissions) !== "api") {
        throw new Error(
          'The workspace Title field is not API-managed. Use "slack2 admin profile-field update title --source api" first.',
        );
      }
      profile.title = args.title;
      before.title = String(current.title ?? "");
      after.title = args.title;
    }

    const fields: Record<string, { value: string; alt: string }> = {};
    for (const assignment of assignments) {
      const resolved = resolveProfileField(sections, assignment.field);
      if (profileDataSource(resolved.element.permissions) !== "api") {
        throw new Error(
          `Field "${resolved.element.label}" is not API-managed.`,
        );
      }
      const fieldId = resolved.element.legacyFieldId;
      if (!fieldId) {
        throw new Error(
          `Field "${resolved.element.label}" has no Web API field ID.`,
        );
      }
      fields[fieldId] = { value: assignment.value, alt: "" };
      before[fieldId] = profileFieldValue(current, fieldId);
      after[fieldId] = assignment.value;
    }
    if (Object.keys(fields).length > 0) profile.fields = fields;

    const changedKeys = Object.keys(after).filter(
      (key) => before[key] !== after[key],
    );
    if (changedKeys.length === 0) {
      throw new Error("The requested member profile values are already set.");
    }
    const diff = {
      workspace,
      user_id: member.id,
      dry_run: Boolean(args["dry-run"]),
      changes: Object.fromEntries(
        changedKeys.map((key) => [
          key,
          { before: before[key], after: after[key] },
        ]),
      ),
    };
    if (args.json) printJson(diff);
    else {
      console.log(`Member: ${member.id}`);
      for (const key of changedKeys) {
        console.log(`  ${key}: ${before[key]} -> ${after[key]}`);
      }
    }
    if (args["dry-run"]) {
      if (!args.json) console.log("Dry run: no member profile changes were made.");
      return;
    }
    const confirmed = await confirmMutation(
      `Update this member profile in ${workspace}?`,
      { yes: args.yes },
    );
    if (!confirmed) {
      console.error("Cancelled.");
      return;
    }
    await workspaceApi(
      workspace,
      "users.profile.set",
      { user: member.id, profile },
      "slack2-admin-member-profile-update",
    );
    if (!args.json) console.log(`Updated member profile: ${member.id}`);
  },
});

export const adminMemberProfileCommand = defineCommand({
  meta: {
    name: "member-profile",
    description: "Read or update member profile values",
  },
  subCommands: {
    get: adminMemberProfileGetCommand,
    update: adminMemberProfileUpdateCommand,
  },
});

export const adminAuthShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show workspace authentication settings (read-only)",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const response = await workspaceApi(
      required(args.workspace, "--workspace"),
      "team.prefs.get",
    );
    const summary = summarizeAuthPrefs(
      (response.prefs ?? response) as Record<string, unknown>,
    );
    if (args.json) printJson(summary);
    else {
      for (const [key, value] of Object.entries(summary)) {
        console.log(`${key}: ${value}`);
      }
    }
  },
});

export const adminAuthCommand = defineCommand({
  meta: {
    name: "auth",
    description: "Inspect workspace authentication configuration",
  },
  subCommands: { show: adminAuthShowCommand },
});

export const adminBillingShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show a redacted workspace billing summary (read-only)",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const html = await fetchWorkspaceAdminPage(
      required(args.workspace, "--workspace"),
      "/admin/billing",
    );
    const summary = parseBillingOverview(html);
    if (args.json) printJson(summary);
    else {
      for (const [key, value] of Object.entries(summary)) {
        console.log(`${key}: ${value}`);
      }
    }
  },
});

export const adminBillingHistoryCommand = defineCommand({
  meta: {
    name: "history",
    description: "Show redacted billing events (read-only)",
  },
  args: {
    ...workspaceArg,
    since: {
      type: "string",
      description: "Oldest event time (ISO timestamp or Unix seconds)",
    },
    limit: {
      type: "string",
      description: "Maximum number of events",
      default: "50",
    },
    ...jsonArg,
  },
  async run({ args }) {
    const response = await workspaceApi(
      required(args.workspace, "--workspace"),
      "payments.billing.history.list",
    );
    let items = summarizeBillingHistory(
      (response.billing_items as Array<Record<string, any>> | undefined) ?? [],
    );
    if (args.since) {
      const since = toEpochSeconds(args.since);
      items = items.filter(
        (item) => Date.parse(item.date) / 1000 >= since,
      );
    }
    const limit = parsePositiveInteger(args.limit, "--limit");
    items = items.slice(0, limit);
    if (args.json) {
      printJson(items);
      return;
    }
    if (items.length === 0) {
      console.log("(no billing history)");
      return;
    }
    for (const item of items) {
      const amount =
        item.amount === null
          ? "-"
          : `${item.amount.toFixed(2)} ${item.currency ?? ""}`.trim();
      const users =
        item.users_from === null
          ? ""
          : ` users=${item.users_from}->${item.users_to}`;
      console.log(
        `${item.date}  ${item.type}  ${amount}  ${item.status}${users}`,
      );
    }
  },
});

export const adminBillingCommand = defineCommand({
  meta: {
    name: "billing",
    description: "Inspect redacted workspace billing information",
  },
  subCommands: {
    show: adminBillingShowCommand,
    history: adminBillingHistoryCommand,
  },
});

export const adminAuditLogListCommand = defineCommand({
  meta: {
    name: "list",
    description: "Read Enterprise Audit Logs API events",
  },
  args: {
    ...workspaceArg,
    "app-id": {
      type: "string",
      description: "Installed app whose user token has auditlogs:read",
    },
    since: {
      type: "string",
      description: "Oldest event time (ISO timestamp or Unix seconds)",
    },
    until: {
      type: "string",
      description: "Latest event time (ISO timestamp or Unix seconds)",
    },
    action: {
      type: "string",
      description: "Filter by audit action",
    },
    actor: {
      type: "string",
      description: "Filter by actor ID",
    },
    limit: {
      type: "string",
      description: "Maximum number of events",
      default: "100",
    },
    cursor: {
      type: "string",
      description: "Pagination cursor",
    },
    "include-network": {
      type: "boolean",
      description: "Include IP address, ISP, and user-agent fields",
      default: false,
    },
    ...jsonArg,
  },
  async run({ args }) {
    const data = await fetchAuditLogs({
      workspace: required(args.workspace, "--workspace"),
      appId: args["app-id"],
      oldest: args.since ? toEpochSeconds(args.since) : undefined,
      latest: args.until ? toEpochSeconds(args.until) : undefined,
      action: args.action,
      actor: args.actor,
      limit: parsePositiveInteger(args.limit, "--limit"),
      cursor: args.cursor,
    });
    const safe = redactSensitive(data, {
      includeNetwork: args["include-network"],
    }) as Record<string, any>;
    if (args.json) {
      printJson(safe);
      return;
    }
    const entries = safe.entries ?? [];
    if (entries.length === 0) {
      console.log("(no audit log entries)");
      return;
    }
    for (const entry of entries) {
      const actor =
        entry.actor?.user?.id ?? entry.actor?.app?.id ?? entry.actor?.type ?? "-";
      const entity =
        entry.entity?.user?.id ??
        entry.entity?.channel?.id ??
        entry.entity?.workspace?.id ??
        entry.entity?.type ??
        "-";
      console.log(
        `${formatEpoch(entry.date_create)}  ${entry.action ?? "-"}  ` +
          `actor=${actor}  entity=${entity}`,
      );
    }
    const cursor = safe.response_metadata?.next_cursor;
    if (cursor) console.log(`next_cursor: ${cursor}`);
  },
});

export const adminAuditLogCommand = defineCommand({
  meta: {
    name: "audit-log",
    description: "Read Enterprise organization audit events",
  },
  subCommands: { list: adminAuditLogListCommand },
});

export const adminAccessLogListCommand = defineCommand({
  meta: {
    name: "list",
    description: "Read paid-workspace access logs",
  },
  args: {
    ...workspaceArg,
    before: {
      type: "string",
      description: "Newest access time (ISO timestamp or Unix seconds)",
    },
    limit: {
      type: "string",
      description: "Maximum number of rows",
      default: "100",
    },
    cursor: {
      type: "string",
      description: "Pagination cursor",
    },
    "include-network": {
      type: "boolean",
      description: "Include IP address, ISP, and user-agent fields",
      default: false,
    },
    ...jsonArg,
  },
  async run({ args }) {
    const response = await workspaceApi(
      required(args.workspace, "--workspace"),
      "team.accessLogs",
      {
        limit: parsePositiveInteger(args.limit, "--limit"),
        ...(args.before ? { before: toEpochSeconds(args.before) } : {}),
        ...(args.cursor ? { cursor: args.cursor } : {}),
      },
    );
    const safe = redactSensitive(response, {
      includeNetwork: args["include-network"],
    }) as Record<string, any>;
    if (args.json) {
      printJson(safe);
      return;
    }
    const logins = safe.logins ?? [];
    if (logins.length === 0) {
      console.log("(no access log entries)");
      return;
    }
    for (const login of logins) {
      console.log(
        `${formatEpoch(login.date_last)}  user=${login.user_id ?? login.username ?? "-"}  ` +
          `count=${login.count ?? "-"}  ${login.country ?? "-"} ${login.region ?? ""}`.trimEnd(),
      );
    }
    const cursor = safe.response_metadata?.next_cursor;
    if (cursor) console.log(`next_cursor: ${cursor}`);
  },
});

export const adminAccessLogCommand = defineCommand({
  meta: {
    name: "access-log",
    description: "Read workspace sign-in/access activity",
  },
  subCommands: { list: adminAccessLogListCommand },
});

export const adminCommand = defineCommand({
  meta: {
    name: "admin",
    description: "Workspace administration and audit commands",
  },
  subCommands: {
    whoami: adminWhoamiCommand,
    workspace: adminWorkspaceCommand,
    member: adminMemberCommand,
    channel: adminChannelCommand,
    emoji: adminEmojiCommand,
    invitation: adminInvitationCommand,
    "profile-field": adminProfileFieldCommand,
    "member-profile": adminMemberProfileCommand,
    "profile-policy": adminProfilePolicyCommand,
    "channel-policy": adminChannelPolicyCommand,
    retention: adminRetentionCommand,
    auth: adminAuthCommand,
    billing: adminBillingCommand,
    "audit-log": adminAuditLogCommand,
    "access-log": adminAccessLogCommand,
  },
});
