import { defineCommand } from "citty";
import {
  parseBillingOverview,
} from "../lib/admin-settings.ts";
import {
  resolveMember,
  type SlackMember,
} from "../lib/admin-profile.ts";
import {
  findAdminForm,
  postWorkspaceAdminForm,
} from "../lib/admin-forms.ts";
import {
  confirmMutation,
  parsePositiveInteger,
  printJson,
} from "../lib/cli-safety.ts";
import {
  fetchWorkspaceAdminPage,
  workspaceApi,
} from "../lib/workspace-client.ts";

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

function required(value: string | undefined, option: string): string {
  if (!value) throw new Error(`${option} is required.`);
  return value;
}

async function getPreferences(
  workspace: string,
): Promise<Record<string, unknown>> {
  const response = await workspaceApi(workspace, "team.prefs.get");
  return (response.prefs ?? response) as Record<string, unknown>;
}

function preferenceSubset(
  prefs: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(prefs, key))
      .map((key) => [key, prefs[key]]),
  );
}

function printRecord(result: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(result)) {
    console.log(
      `${key}: ${
        value && typeof value === "object" ? JSON.stringify(value) : value
      }`,
    );
  }
}

function parseEnabled(
  value: string | undefined,
  option: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  throw new Error(`${option} must be enabled or disabled.`);
}

function requireOneChange(
  changes: Array<{ name: string; value: unknown }>,
): { name: string; value: unknown } {
  const requested = changes.filter(({ value }) => value !== undefined);
  if (requested.length === 0) throw new Error("Pass one setting to update.");
  if (requested.length > 1) {
    throw new Error(
      "Update one setting at a time so each Slack admin form is independently verified.",
    );
  }
  return requested[0]!;
}

async function applyVerifiedPreferenceChange(options: {
  workspace: string;
  resource: string;
  key: string;
  before: unknown;
  after: unknown;
  marker: string;
  values: Record<string, string | number | boolean | undefined>;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}): Promise<void> {
  findAdminForm(
    await fetchWorkspaceAdminPage(options.workspace, "/admin/settings"),
    options.marker,
  );
  const result = {
    workspace: options.workspace,
    resource: options.resource,
    dry_run: options.dryRun,
    change: {
      key: options.key,
      before: options.before,
      after: options.after,
    },
  };
  if (options.json) printJson(result);
  else {
    console.log(`${options.resource}.${options.key}`);
    console.log(`  before: ${options.before}`);
    console.log(`  after:  ${options.after}`);
  }
  if (options.before === options.after) {
    throw new Error(`The requested ${options.key} value is already set.`);
  }
  if (options.dryRun) {
    if (!options.json) console.log("Dry run: no workspace changes were made.");
    return;
  }
  const confirmed = await confirmMutation(
    `Update ${options.resource}.${options.key} in ${options.workspace}?`,
    { yes: options.yes },
  );
  if (!confirmed) {
    console.error("Cancelled.");
    return;
  }
  await postWorkspaceAdminForm(
    options.workspace,
    "/admin/settings",
    options.marker,
    options.values,
  );
  const verified = await getPreferences(options.workspace);
  if (verified[options.key] !== options.after) {
    throw new Error(
      `Slack accepted the form but ${options.key} did not become the requested value.`,
    );
  }
  if (!options.json) console.log(`Updated ${options.resource}.${options.key}`);
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
    cursor = String(
      (response.response_metadata as { next_cursor?: string } | undefined)
        ?.next_cursor ?? "",
    );
  } while (cursor);
  return members;
}

export const adminWorkspaceShowCommand = defineCommand({
  meta: { name: "show", description: "Show workspace identity and plan" },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const [teamResponse, prefs, billingHtml] = await Promise.all([
      workspaceApi(workspace, "team.info"),
      getPreferences(workspace),
      fetchWorkspaceAdminPage(workspace, "/admin/billing"),
    ]);
    const team = (teamResponse.team ?? {}) as Record<string, unknown>;
    const billing = parseBillingOverview(billingHtml);
    const result = {
      id: team.id ?? null,
      name: team.name ?? null,
      domain: team.domain ?? workspace,
      plan: billing.plan,
      paid_users: billing.paid_users,
      locale: prefs.locale ?? null,
      dnd: {
        enabled: Boolean(prefs.dnd_enabled),
        start: prefs.dnd_start_hour ?? null,
        end: prefs.dnd_end_hour ?? null,
      },
      default_channel_count: Array.isArray(prefs.default_channels)
        ? prefs.default_channels.length
        : 0,
    };
    if (args.json) printJson(result);
    else printRecord(result);
  },
});

export const adminWorkspaceUpdateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a workspace-wide locale or notification window",
  },
  args: {
    ...workspaceArg,
    locale: {
      type: "string",
      description: "Workspace locale, for example en-US or ko-KR",
    },
    name: {
      type: "string",
      description: "Workspace display name",
    },
    dnd: {
      type: "string",
      description: "Default Do Not Disturb state: enabled or disabled",
    },
    "dnd-start": {
      type: "string",
      description: "DND start time in HH:MM",
    },
    "dnd-end": {
      type: "string",
      description: "DND end time in HH:MM",
    },
    ...mutationArgs,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const dnd = parseEnabled(args.dnd, "--dnd");
    const hasDndWindow =
      args["dnd-start"] !== undefined || args["dnd-end"] !== undefined;
    const change = requireOneChange([
      { name: "name", value: args.name },
      { name: "locale", value: args.locale },
      {
        name: "dnd",
        value: dnd !== undefined || hasDndWindow ? true : undefined,
      },
    ]);
    const prefs = await getPreferences(workspace);
    if (change.name === "name") {
      const teamResponse = await workspaceApi(workspace, "team.info");
      const team = (teamResponse.team ?? {}) as Record<string, unknown>;
      const before = String(team.name ?? "");
      const after = String(change.value).trim();
      if (!after) throw new Error("--name cannot be empty.");
      const form = findAdminForm(
        await fetchWorkspaceAdminPage(workspace, "/admin/name"),
        "done",
      );
      const result = {
        workspace,
        resource: "workspace",
        dry_run: Boolean(args["dry-run"]),
        change: { key: "name", before, after },
      };
      if (args.json) printJson(result);
      else {
        console.log("workspace.name");
        console.log(`  before: ${before}`);
        console.log(`  after:  ${after}`);
      }
      if (before === after) {
        throw new Error("The requested workspace name is already set.");
      }
      if (args["dry-run"]) {
        if (!args.json) console.log("Dry run: no workspace changes were made.");
        return;
      }
      if (
        !(await confirmMutation(
          `Rename workspace ${workspace} from "${before}" to "${after}"?`,
          { yes: Boolean(args.yes) },
        ))
      ) {
        console.error("Cancelled.");
        return;
      }
      await postWorkspaceAdminForm(workspace, "/admin/name", "done", {
        done: "1",
        name: after,
        url: form.values.url ?? String(team.domain ?? workspace),
      });
      const verified = await workspaceApi(workspace, "team.info");
      if (
        String(
          ((verified.team ?? {}) as Record<string, unknown>).name ?? "",
        ) !== after
      ) {
        throw new Error("Slack did not retain the requested workspace name.");
      }
      if (!args.json) console.log("Updated workspace.name");
      return;
    }
    if (change.name === "locale") {
      await applyVerifiedPreferenceChange({
        workspace,
        resource: "workspace",
        key: "locale",
        before: prefs.locale,
        after: args.locale,
        marker: "change_locale",
        values: { locale: args.locale },
        dryRun: Boolean(args["dry-run"]),
        yes: Boolean(args.yes),
        json: Boolean(args.json),
      });
      return;
    }
    const start = args["dnd-start"] ?? String(prefs.dnd_start_hour ?? "");
    const end = args["dnd-end"] ?? String(prefs.dnd_end_hour ?? "");
    if (!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(start)) {
      throw new Error("--dnd-start must be an HH:00 or HH:30 time.");
    }
    if (!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(end)) {
      throw new Error("--dnd-end must be an HH:00 or HH:30 time.");
    }
    const enabled = dnd ?? Boolean(prefs.dnd_enabled);
    const before = {
      enabled: Boolean(prefs.dnd_enabled),
      start: prefs.dnd_start_hour,
      end: prefs.dnd_end_hour,
    };
    const after = { enabled, start, end };
    const result = {
      workspace,
      resource: "workspace.dnd",
      dry_run: Boolean(args["dry-run"]),
      before,
      after,
    };
    if (args.json) printJson(result);
    else {
      console.log("workspace.dnd");
      console.log(`  before: ${JSON.stringify(before)}`);
      console.log(`  after:  ${JSON.stringify(after)}`);
    }
    if (JSON.stringify(before) === JSON.stringify(after)) {
      throw new Error("The requested DND values are already set.");
    }
    findAdminForm(
      await fetchWorkspaceAdminPage(workspace, "/admin/settings"),
      "dnd_enabled",
    );
    if (args["dry-run"]) {
      if (!args.json) console.log("Dry run: no workspace changes were made.");
      return;
    }
    if (
      !(await confirmMutation(
        `Update workspace.dnd in ${workspace}?`,
        { yes: Boolean(args.yes) },
      ))
    ) {
      console.error("Cancelled.");
      return;
    }
    await postWorkspaceAdminForm(workspace, "/admin/settings", "dnd_enabled", {
      dnd_enabled: enabled,
      dnd_start_hour: start,
      dnd_end_hour: end,
    });
    const verified = await getPreferences(workspace);
    if (
      Boolean(verified.dnd_enabled) !== enabled ||
      verified.dnd_start_hour !== start ||
      verified.dnd_end_hour !== end
    ) {
      throw new Error("Slack did not retain the requested default DND window.");
    }
    if (!args.json) console.log("Updated workspace.dnd");
  },
});

export const adminWorkspaceCommand = defineCommand({
  meta: { name: "workspace", description: "Manage workspace-wide settings" },
  subCommands: {
    show: adminWorkspaceShowCommand,
    update: adminWorkspaceUpdateCommand,
  },
});

export const adminMemberListCommand = defineCommand({
  meta: { name: "list", description: "List workspace members" },
  args: {
    ...workspaceArg,
    status: {
      type: "string",
      description: "Filter: active, deactivated, or all",
      default: "active",
    },
    role: {
      type: "string",
      description: "Filter: member, guest, admin, owner, or all",
      default: "all",
    },
    limit: {
      type: "string",
      description: "Maximum members to print",
      default: "100",
    },
    "include-email": {
      type: "boolean",
      description: "Include member email addresses",
      default: false,
    },
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const status = args.status ?? "active";
    const role = args.role ?? "all";
    if (!["active", "deactivated", "all"].includes(status)) {
      throw new Error("--status must be active, deactivated, or all.");
    }
    if (!["member", "guest", "admin", "owner", "all"].includes(role)) {
      throw new Error("--role must be member, guest, admin, owner, or all.");
    }
    let members = await listMembers(workspace);
    if (status !== "all") {
      members = members.filter((member) =>
        status === "deactivated" ? member.deleted : !member.deleted
      );
    }
    if (role !== "all") {
      members = members.filter((member) => {
        if (role === "owner") return member.is_owner;
        if (role === "admin") return member.is_admin && !member.is_owner;
        if (role === "guest") {
          return member.is_restricted || member.is_ultra_restricted;
        }
        return !member.is_admin &&
          !member.is_owner &&
          !member.is_restricted &&
          !member.is_ultra_restricted &&
          !member.is_bot &&
          !member.is_app_user &&
          member.id !== "USLACKBOT";
      });
    }
    const limit = parsePositiveInteger(args.limit ?? "100", "--limit");
    const result = members.slice(0, limit).map((member) => ({
      id: member.id,
      name:
        member.profile?.display_name ||
        member.profile?.real_name ||
        member.name ||
        "",
      ...(args["include-email"]
        ? { email: member.profile?.email ?? "" }
        : {}),
      status: member.deleted ? "deactivated" : "active",
      role: member.is_primary_owner
        ? "primary_owner"
        : member.is_owner
          ? "owner"
          : member.is_admin
            ? "admin"
            : member.is_ultra_restricted
              ? "single_channel_guest"
              : member.is_restricted
                ? "guest"
              : member.is_bot || member.is_app_user || member.id === "USLACKBOT"
                  ? "bot"
                  : "member",
    }));
    if (args.json) {
      printJson(result);
      return;
    }
    if (result.length === 0) {
      console.log("(no members)");
      return;
    }
    for (const member of result) {
      console.log(
        `${member.id}  ${member.role.padEnd(20)} ${member.status.padEnd(11)} ${member.name}` +
          ("email" in member ? `  ${member.email}` : ""),
      );
    }
  },
});

export const adminMemberGetCommand = defineCommand({
  meta: { name: "get", description: "Inspect one workspace member" },
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
    const memberQuery = required(args.member, "<member>");
    const member = resolveMember(await listMembers(workspace), memberQuery);
    const result = {
      id: member.id,
      username: member.name ?? "",
      display_name: member.profile?.display_name ?? "",
      real_name: member.profile?.real_name ?? "",
      email: member.profile?.email ?? "",
      active: !member.deleted,
      admin: Boolean(member.is_admin),
      owner: Boolean(member.is_owner),
      primary_owner: Boolean(member.is_primary_owner),
      guest: Boolean(member.is_restricted),
      single_channel_guest: Boolean(member.is_ultra_restricted),
      bot: Boolean(member.is_bot || member.is_app_user),
    };
    if (args.json) printJson(result);
    else printRecord(result);
  },
});

export const adminMemberCommand = defineCommand({
  meta: { name: "member", description: "Inspect workspace membership" },
  subCommands: {
    list: adminMemberListCommand,
    get: adminMemberGetCommand,
  },
});

async function listChannels(
  workspace: string,
  types: string,
): Promise<Array<Record<string, any>>> {
  const channels: Array<Record<string, any>> = [];
  let cursor = "";
  do {
    const response = await workspaceApi(workspace, "conversations.list", {
      limit: 200,
      types,
      exclude_archived: false,
      ...(cursor ? { cursor } : {}),
    });
    channels.push(
      ...((response.channels as Array<Record<string, any>> | undefined) ?? []),
    );
    cursor = String(
      (response.response_metadata as { next_cursor?: string } | undefined)
        ?.next_cursor ?? "",
    );
  } while (cursor);
  return channels;
}

export const adminChannelListCommand = defineCommand({
  meta: { name: "list", description: "List channels visible to the admin" },
  args: {
    ...workspaceArg,
    type: {
      type: "string",
      description: "Filter: public, private, or all",
      default: "all",
    },
    archived: {
      type: "boolean",
      description: "Include archived channels",
      default: false,
    },
    limit: {
      type: "string",
      description: "Maximum channels to print",
      default: "100",
    },
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const type = args.type ?? "all";
    if (!["public", "private", "all"].includes(type)) {
      throw new Error("--type must be public, private, or all.");
    }
    const types = type === "public"
      ? "public_channel"
      : type === "private"
        ? "private_channel"
        : "public_channel,private_channel";
    let channels = await listChannels(workspace, types);
    if (!args.archived) {
      channels = channels.filter((channel) => !channel.is_archived);
    }
    const result = channels
      .slice(0, parsePositiveInteger(args.limit ?? "100", "--limit"))
      .map((channel) => ({
        id: String(channel.id ?? ""),
        name: String(channel.name ?? ""),
        private: Boolean(channel.is_private),
        archived: Boolean(channel.is_archived),
        member_count: Number(channel.num_members ?? 0),
      }));
    if (args.json) {
      printJson(result);
      return;
    }
    if (result.length === 0) {
      console.log("(no channels visible to this admin session)");
      return;
    }
    for (const channel of result) {
      console.log(
        `${channel.id}  ${channel.private ? "private" : "public "}  ` +
          `${channel.archived ? "archived" : "active  "}  ` +
          `${String(channel.member_count).padStart(4)}  #${channel.name}`,
      );
    }
  },
});

export const adminChannelGetCommand = defineCommand({
  meta: { name: "get", description: "Inspect one channel" },
  args: {
    channel: {
      type: "positional",
      description: "Channel ID or exact channel name",
      required: true,
    },
    ...workspaceArg,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    let channelId = required(args.channel, "<channel>");
    if (!/^C[A-Z0-9]+$/i.test(channelId)) {
      const channels = await listChannels(
        workspace,
        "public_channel,private_channel",
      );
      const matches = channels.filter(
        (channel) =>
          String(channel.name ?? "").toLowerCase() ===
            channelId.replace(/^#/, "").toLowerCase(),
      );
      if (matches.length !== 1) {
        throw new Error(
          matches.length === 0
            ? `Channel "${args.channel}" was not found.`
            : `Channel name "${args.channel}" is ambiguous; use an ID.`,
        );
      }
      channelId = String(matches[0]!.id);
    }
    const response = await workspaceApi(workspace, "conversations.info", {
      channel: channelId,
      include_num_members: true,
    });
    const channel = (response.channel ?? {}) as Record<string, any>;
    const result = {
      id: channel.id ?? channelId,
      name: channel.name ?? "",
      private: Boolean(channel.is_private),
      archived: Boolean(channel.is_archived),
      general: Boolean(channel.is_general),
      shared: Boolean(channel.is_shared),
      externally_shared: Boolean(channel.is_ext_shared),
      member_count: Number(channel.num_members ?? 0),
      topic: channel.topic?.value ?? "",
      purpose: channel.purpose?.value ?? "",
    };
    if (args.json) printJson(result);
    else printRecord(result);
  },
});

export const adminChannelCommand = defineCommand({
  meta: { name: "channel", description: "Inspect workspace channels" },
  subCommands: {
    list: adminChannelListCommand,
    get: adminChannelGetCommand,
  },
});

export const adminEmojiListCommand = defineCommand({
  meta: { name: "list", description: "List custom emoji and aliases" },
  args: {
    ...workspaceArg,
    aliases: {
      type: "boolean",
      description: "Only show emoji aliases",
      default: false,
    },
    ...jsonArg,
  },
  async run({ args }) {
    const response = await workspaceApi(
      required(args.workspace, "--workspace"),
      "emoji.list",
    );
    let emoji = Object.entries(
      (response.emoji ?? {}) as Record<string, string>,
    ).map(([name, value]) => ({
      name,
      type: value.startsWith("alias:") ? "alias" : "image",
      target: value.startsWith("alias:") ? value.slice(6) : null,
    }));
    if (args.aliases) emoji = emoji.filter((item) => item.type === "alias");
    emoji.sort((left, right) => left.name.localeCompare(right.name));
    if (args.json) {
      printJson(emoji);
      return;
    }
    for (const item of emoji) {
      console.log(
        `:${item.name}:  ${item.type}${
          item.target ? ` -> :${item.target}:` : ""
        }`,
      );
    }
  },
});

export const adminEmojiCommand = defineCommand({
  meta: { name: "emoji", description: "Inspect workspace custom emoji" },
  subCommands: { list: adminEmojiListCommand },
});

function emailDomain(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

function invitationTimestamp(value: unknown): string | null {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp * 1000).toISOString()
    : null;
}

export const adminInvitationListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List pending, accepted, or requested workspace invitations",
  },
  args: {
    ...workspaceArg,
    type: {
      type: "string",
      description: "Invitation type: pending, accepted, or requests",
      default: "pending",
    },
    query: {
      type: "string",
      description: "Filter invitations using Slack's admin search",
    },
    limit: {
      type: "string",
      description: "Maximum invitations to print",
      default: "100",
    },
    "include-email": {
      type: "boolean",
      description: "Include invited email addresses",
      default: false,
    },
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const type = args.type ?? "pending";
    if (!["pending", "accepted", "requests"].includes(type)) {
      throw new Error("--type must be pending, accepted, or requests.");
    }
    const limit = parsePositiveInteger(args.limit ?? "100", "--limit");
    const invitations: Array<Record<string, any>> = [];
    let cursor = "";
    do {
      const response = type === "requests"
        ? await workspaceApi(workspace, "users.admin.fetchInviteRequests", {
          sortDir: "DESC",
          ...(args.query ? { query: args.query } : {}),
          ...(cursor ? { cursor } : {}),
        })
        : await workspaceApi(workspace, "users.admin.fetchInvitesHistory", {
          type,
          sortDir: "DESC",
          ...(args.query ? { query: args.query } : {}),
          ...(cursor ? { cursor } : {}),
        });
      invitations.push(
        ...(((type === "requests" ? response.requests : response.invites) as
          | Array<Record<string, any>>
          | undefined) ?? []),
      );
      cursor = String(response.next_cursor ?? "");
    } while (cursor && invitations.length < limit);

    const result = invitations.slice(0, limit).map((invitation) => {
      const email = invitation.email ?? invitation.invitee_email;
      return {
        id: String(invitation.id ?? invitation.request_id ?? ""),
        type,
        status: String(invitation.status ?? type),
        ...(args["include-email"] ? { email: String(email ?? "") } : {}),
        email_domain: emailDomain(email),
        created_at: invitationTimestamp(
          invitation.date_create ?? invitation.date_created,
        ),
        accepted_at: invitationTimestamp(invitation.date_accepted),
        inviter_id:
          invitation.inviter?.id ??
          invitation.inviter_id ??
          invitation.requester_id ??
          null,
        user_id: invitation.user?.id ?? invitation.user_id ?? null,
      };
    });
    if (args.json) {
      printJson(result);
      return;
    }
    if (result.length === 0) {
      console.log(`(no ${type} invitations)`);
      return;
    }
    for (const invitation of result) {
      console.log(
        `${invitation.id}  ${invitation.status.padEnd(12)} ` +
          `${invitation.created_at ?? "-"}  ` +
          `${
            "email" in invitation
              ? invitation.email
              : invitation.email_domain
                ? `@${invitation.email_domain}`
                : ""
          }`,
      );
    }
  },
});

export const adminInvitationShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show invitation policy and approved join domains",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const [prefs, html] = await Promise.all([
      getPreferences(workspace),
      fetchWorkspaceAdminPage(workspace, "/admin/settings"),
    ]);
    const form = findAdminForm(html, "change_signup_mode");
    const domains = (form.values.signupdomains ?? "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    const result = {
      approved_domain_join: form.values.signupmode === "email",
      approved_domains: domains,
      invitations_restricted_to_admins: Boolean(prefs.invites_only_admins),
      invite_requests_enabled: Boolean(prefs.invite_requests_enabled),
      external_guest_invites: prefs.who_can_create_external_limited_invite ??
        null,
    };
    if (args.json) printJson(result);
    else printRecord(result);
  },
});

function parseDomains(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const domains = value
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  for (const domain of domains) {
    if (
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        domain,
      )
    ) {
      throw new Error(`Invalid approved email domain: ${domain}`);
    }
  }
  return [...new Set(domains)];
}

export const adminInvitationUpdateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update approved-domain self-join policy",
  },
  args: {
    ...workspaceArg,
    "domain-join": {
      type: "string",
      description: "Approved-domain self-join: enabled or disabled",
    },
    domains: {
      type: "string",
      description: "Comma-separated approved email domains",
    },
    ...mutationArgs,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const enabled = parseEnabled(args["domain-join"], "--domain-join");
    const requestedDomains = parseDomains(args.domains);
    if (enabled === undefined && requestedDomains === undefined) {
      throw new Error("Pass --domain-join or --domains.");
    }
    const form = findAdminForm(
      await fetchWorkspaceAdminPage(workspace, "/admin/settings"),
      "change_signup_mode",
    );
    const beforeDomains = (form.values.signupdomains ?? "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    const before = {
      enabled: form.values.signupmode === "email",
      domains: beforeDomains,
    };
    const after = {
      enabled: enabled ?? before.enabled,
      domains: requestedDomains ?? before.domains,
    };
    if (after.enabled && after.domains.length === 0) {
      throw new Error(
        "At least one --domains value is required when domain join is enabled.",
      );
    }
    const result = {
      workspace,
      resource: "invitation",
      dry_run: Boolean(args["dry-run"]),
      before,
      after,
    };
    if (args.json) printJson(result);
    else {
      console.log("invitation.approved_domain_join");
      console.log(`  before: ${JSON.stringify(before)}`);
      console.log(`  after:  ${JSON.stringify(after)}`);
    }
    if (JSON.stringify(before) === JSON.stringify(after)) {
      throw new Error("The requested invitation policy is already set.");
    }
    if (args["dry-run"]) {
      if (!args.json) console.log("Dry run: no workspace changes were made.");
      return;
    }
    if (
      !(await confirmMutation(
        `Update approved-domain joining in ${workspace}?`,
        { yes: Boolean(args.yes) },
      ))
    ) {
      console.error("Cancelled.");
      return;
    }
    await postWorkspaceAdminForm(
      workspace,
      "/admin/settings",
      "change_signup_mode",
      {
        signupmode: after.enabled ? "email" : false,
        signupdomains: after.domains.join(","),
      },
    );
    const verifiedForm = findAdminForm(
      await fetchWorkspaceAdminPage(workspace, "/admin/settings"),
      "change_signup_mode",
    );
    const actual = {
      enabled: verifiedForm.values.signupmode === "email",
      domains: (verifiedForm.values.signupdomains ?? "")
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    };
    if (JSON.stringify(actual) !== JSON.stringify(after)) {
      throw new Error(
        "Slack did not retain the requested approved-domain join policy.",
      );
    }
    if (!args.json) {
      console.log("Updated invitation.approved_domain_join");
    }
  },
});

export const adminInvitationCommand = defineCommand({
  meta: {
    name: "invitation",
    description: "Inspect invitations and manage join policy",
  },
  subCommands: {
    list: adminInvitationListCommand,
    show: adminInvitationShowCommand,
    update: adminInvitationUpdateCommand,
  },
});

const MESSAGE_RETENTION_MODES: Record<string, number> = {
  "keep-no-edits": 0,
  "keep-with-edits": 1,
  "delete-after": 2,
};

const FILE_RETENTION_MODES: Record<string, number> = {
  keep: 0,
  "delete-after": 1,
  "keep-deleted": 2,
  "keep-deleted-delete-after": 3,
};

function retentionModeName(
  value: unknown,
  modes: Record<string, number>,
): string {
  const number = Number(value);
  return Object.entries(modes).find(([, code]) => code === number)?.[0] ??
    `unknown:${value}`;
}

export const adminRetentionShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show message, file, canvas, and list retention",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const prefs = await getPreferences(
      required(args.workspace, "--workspace"),
    );
    const result = {
      public_channels: {
        mode: retentionModeName(
          prefs.retention_type,
          MESSAGE_RETENTION_MODES,
        ),
        days: Number(prefs.retention_type) === 2
          ? Number(prefs.retention_duration ?? 0)
          : 0,
      },
      private_channels: {
        mode: retentionModeName(
          prefs.group_retention_type,
          MESSAGE_RETENTION_MODES,
        ),
        days: Number(prefs.group_retention_type) === 2
          ? Number(prefs.group_retention_duration ?? 0)
          : 0,
      },
      direct_messages: {
        mode: retentionModeName(
          prefs.dm_retention_type,
          MESSAGE_RETENTION_MODES,
        ),
        days: Number(prefs.dm_retention_type) === 2
          ? Number(prefs.dm_retention_duration ?? 0)
          : 0,
      },
      files: {
        mode: retentionModeName(
          prefs.file_retention_type,
          FILE_RETENTION_MODES,
        ),
        days: [1, 3].includes(Number(prefs.file_retention_type))
          ? Number(prefs.file_retention_duration ?? 0)
          : 0,
      },
      canvases_and_lists: {
        mode: retentionModeName(
          prefs.canvas_retention_type,
          FILE_RETENTION_MODES,
        ),
        days: [1, 3].includes(Number(prefs.canvas_retention_type))
          ? Number(prefs.canvas_retention_duration ?? 0)
          : 0,
      },
      channel_overrides: Number(prefs.allow_admin_retention_override) > 0
        ? "admin"
        : prefs.allow_retention_override
          ? "member"
          : "none",
    };
    if (args.json) printJson(result);
    else printRecord(result);
  },
});

function requireRetentionDays(
  mode: string,
  days: string | undefined,
  customModes: string[],
): number {
  if (!customModes.includes(mode)) {
    if (days !== undefined) {
      throw new Error("--days is only valid for a delete-after mode.");
    }
    return 0;
  }
  if (days === undefined) {
    throw new Error("--days is required for a delete-after mode.");
  }
  return parsePositiveInteger(days, "--days");
}

async function updateMessageRetention(options: {
  workspace: string;
  scope: "public" | "private" | "dm";
  mode: string;
  days: number;
  prefs: Record<string, unknown>;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}): Promise<void> {
  const typeKeys = {
    public: ["retention_type", "retention_duration"],
    private: ["group_retention_type", "group_retention_duration"],
    dm: ["dm_retention_type", "dm_retention_duration"],
  } as const;
  const [typeKey, durationKey] = typeKeys[options.scope];
  const modeCode = MESSAGE_RETENTION_MODES[options.mode];
  if (modeCode === undefined) {
    throw new Error(
      "--mode must be keep-no-edits, keep-with-edits, or delete-after for message retention.",
    );
  }
  const before = {
    mode: retentionModeName(
      options.prefs[typeKey],
      MESSAGE_RETENTION_MODES,
    ),
    days: Number(options.prefs[typeKey]) === 2
      ? Number(options.prefs[durationKey] ?? 0)
      : 0,
  };
  const after = { mode: options.mode, days: options.days };
  findAdminForm(
    await fetchWorkspaceAdminPage(options.workspace, "/admin/settings"),
    "change_data_retention",
  );
  const result = {
    workspace: options.workspace,
    resource: `retention.${options.scope}`,
    dry_run: options.dryRun,
    before,
    after,
  };
  if (options.json) printJson(result);
  else {
    console.log(`retention.${options.scope}`);
    console.log(`  before: ${JSON.stringify(before)}`);
    console.log(`  after:  ${JSON.stringify(after)}`);
  }
  if (JSON.stringify(before) === JSON.stringify(after)) {
    throw new Error("The requested retention policy is already set.");
  }
  if (options.dryRun) {
    if (!options.json) console.log("Dry run: no workspace changes were made.");
    return;
  }
  if (
    !(await confirmMutation(
      `Update ${options.scope} message retention in ${options.workspace}? ` +
        "A delete-after policy permanently removes messages.",
      { yes: options.yes },
    ))
  ) {
    console.error("Cancelled.");
    return;
  }

  const override = Number(options.prefs.allow_admin_retention_override) > 0
    ? "admin"
    : options.prefs.allow_retention_override
      ? "member"
      : "none";
  const publicType = options.scope === "public"
    ? modeCode
    : Number(options.prefs.retention_type ?? 0);
  const privateType = options.scope === "private"
    ? modeCode
    : Number(options.prefs.group_retention_type ?? 0);
  const dmType = options.scope === "dm"
    ? modeCode
    : Number(options.prefs.dm_retention_type ?? 0);
  await postWorkspaceAdminForm(
    options.workspace,
    "/admin/settings",
    "change_data_retention",
    {
      retention_type: publicType,
      retention_duration_public: publicType === 2
        ? options.scope === "public"
          ? options.days
          : Number(options.prefs.retention_duration ?? 0)
        : "",
      group_retention_type: privateType,
      retention_duration_private: privateType === 2
        ? options.scope === "private"
          ? options.days
          : Number(options.prefs.group_retention_duration ?? 0)
        : "",
      dm_retention_type: dmType,
      retention_duration_dm: dmType === 2
        ? options.scope === "dm"
          ? options.days
          : Number(options.prefs.dm_retention_duration ?? 0)
        : "",
      retention_duration_unit: 0,
      toggle_no_retention_override: override === "none" ? "none" : false,
      toggle_retention_override: override === "member" ? "member" : false,
      toggle_admin_retention_override: override === "admin" ? "admin" : false,
      data_retention_settings_submit: "1",
    },
  );
  const verified = await getPreferences(options.workspace);
  if (
    Number(verified[typeKey]) !== modeCode ||
    (modeCode === 2 &&
      Number(verified[durationKey] ?? 0) !== options.days)
  ) {
    throw new Error("Slack did not retain the requested retention policy.");
  }
  if (!options.json) console.log(`Updated retention.${options.scope}`);
}

async function updateAssetRetention(options: {
  workspace: string;
  scope: "file" | "canvas";
  mode: string;
  days: number;
  prefs: Record<string, unknown>;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}): Promise<void> {
  const prefix = options.scope === "file" ? "file" : "canvas";
  const typeKey = `${prefix}_retention_type`;
  const durationKey = `${prefix}_retention_duration`;
  const marker = `change_${prefix}_retention`;
  const modeCode = FILE_RETENTION_MODES[options.mode];
  if (modeCode === undefined) {
    throw new Error(
      "--mode must be keep, delete-after, keep-deleted, or keep-deleted-delete-after for file/canvas retention.",
    );
  }
  const before = {
    mode: retentionModeName(options.prefs[typeKey], FILE_RETENTION_MODES),
    days: [1, 3].includes(Number(options.prefs[typeKey]))
      ? Number(options.prefs[durationKey] ?? 0)
      : 0,
  };
  const after = { mode: options.mode, days: options.days };
  findAdminForm(
    await fetchWorkspaceAdminPage(options.workspace, "/admin/settings"),
    marker,
  );
  const result = {
    workspace: options.workspace,
    resource: `retention.${options.scope}`,
    dry_run: options.dryRun,
    before,
    after,
  };
  if (options.json) printJson(result);
  else {
    console.log(`retention.${options.scope}`);
    console.log(`  before: ${JSON.stringify(before)}`);
    console.log(`  after:  ${JSON.stringify(after)}`);
  }
  if (JSON.stringify(before) === JSON.stringify(after)) {
    throw new Error("The requested retention policy is already set.");
  }
  if (options.dryRun) {
    if (!options.json) console.log("Dry run: no workspace changes were made.");
    return;
  }
  if (
    !(await confirmMutation(
      `Update ${options.scope} retention in ${options.workspace}? ` +
        "A delete-after policy permanently removes retained content.",
      { yes: options.yes },
    ))
  ) {
    console.error("Cancelled.");
    return;
  }
  await postWorkspaceAdminForm(
    options.workspace,
    "/admin/settings",
    marker,
    {
      [typeKey]: modeCode,
      [durationKey]: options.days,
    },
  );
  const verified = await getPreferences(options.workspace);
  if (
    Number(verified[typeKey]) !== modeCode ||
    ([1, 3].includes(modeCode) &&
      Number(verified[durationKey] ?? 0) !== options.days)
  ) {
    throw new Error("Slack did not retain the requested retention policy.");
  }
  if (!options.json) console.log(`Updated retention.${options.scope}`);
}

export const adminRetentionUpdateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update one message, file, canvas, or list retention policy",
  },
  args: {
    ...workspaceArg,
    scope: {
      type: "string",
      description: "Retention scope: public, private, dm, file, or canvas",
      required: true,
    },
    mode: {
      type: "string",
      description: "Retention mode; valid values depend on scope",
      required: true,
    },
    days: {
      type: "string",
      description: "Days to retain content for a delete-after mode",
    },
    ...mutationArgs,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const scope = required(args.scope, "--scope");
    const mode = required(args.mode, "--mode");
    const prefs = await getPreferences(workspace);
    if (["public", "private", "dm"].includes(scope)) {
      await updateMessageRetention({
        workspace,
        scope: scope as "public" | "private" | "dm",
        mode,
        days: requireRetentionDays(mode, args.days, ["delete-after"]),
        prefs,
        dryRun: Boolean(args["dry-run"]),
        yes: Boolean(args.yes),
        json: Boolean(args.json),
      });
      return;
    }
    if (scope === "file" || scope === "canvas") {
      await updateAssetRetention({
        workspace,
        scope,
        mode,
        days: requireRetentionDays(mode, args.days, [
          "delete-after",
          "keep-deleted-delete-after",
        ]),
        prefs,
        dryRun: Boolean(args["dry-run"]),
        yes: Boolean(args.yes),
        json: Boolean(args.json),
      });
      return;
    }
    throw new Error("--scope must be public, private, dm, file, or canvas.");
  },
});

export const adminRetentionCommand = defineCommand({
  meta: {
    name: "retention",
    description: "Inspect and manage workspace retention",
  },
  subCommands: {
    show: adminRetentionShowCommand,
    update: adminRetentionUpdateCommand,
  },
});

export const adminProfilePolicyShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show profile display and editor policies",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const prefs = await getPreferences(required(args.workspace, "--workspace"));
    const result = preferenceSubset(prefs, [
      "display_real_names",
      "display_email_addresses",
      "display_external_email_addresses",
      "display_guest_email_addresses",
      "display_default_phone",
      "display_pronouns",
      "who_can_change_team_profile",
      "atlas_profiles_access",
      "atlas_org_charts_access",
    ]);
    if (args.json) printJson(result);
    else printRecord(result);
  },
});

export const adminProfilePolicyUpdateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update one profile display or editor policy",
  },
  args: {
    ...workspaceArg,
    "display-phone": {
      type: "string",
      description: "Alternate phone field: enabled or disabled",
    },
    "display-real-names": {
      type: "string",
      description: "Full-name display: enabled or disabled",
    },
    "email-visibility": {
      type: "string",
      description: "Email visibility: none, internal, or external",
    },
    "field-editors": {
      type: "string",
      description: "Who can edit the workspace profile schema: admin or owner",
    },
    ...mutationArgs,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const displayPhone = parseEnabled(
      args["display-phone"],
      "--display-phone",
    );
    const displayNames = parseEnabled(
      args["display-real-names"],
      "--display-real-names",
    );
    const change = requireOneChange([
      { name: "display_default_phone", value: displayPhone },
      { name: "display_real_names", value: displayNames },
      { name: "email_visibility", value: args["email-visibility"] },
      { name: "who_can_change_team_profile", value: args["field-editors"] },
    ]);
    const prefs = await getPreferences(workspace);
    if (change.name === "display_default_phone") {
      await applyVerifiedPreferenceChange({
        workspace,
        resource: "profile-policy",
        key: change.name,
        before: Boolean(prefs[change.name]),
        after: change.value,
        marker: "change_display_default_phone",
        values: { display_default_phone: change.value as boolean },
        dryRun: Boolean(args["dry-run"]),
        yes: Boolean(args.yes),
        json: Boolean(args.json),
      });
      return;
    }
    if (change.name === "display_real_names") {
      await applyVerifiedPreferenceChange({
        workspace,
        resource: "profile-policy",
        key: change.name,
        before: Boolean(prefs[change.name]),
        after: change.value,
        marker: "change_display_real_names",
        values: { display_real_names: change.value as boolean },
        dryRun: Boolean(args["dry-run"]),
        yes: Boolean(args.yes),
        json: Boolean(args.json),
      });
      return;
    }
    if (change.name === "email_visibility") {
      if (!["none", "internal", "external"].includes(String(change.value))) {
        throw new Error(
          "--email-visibility must be none, internal, or external.",
        );
      }
      const current = prefs.display_email_addresses
        ? prefs.display_external_email_addresses
          ? "external"
          : "internal"
        : "none";
      const expected = change.value === "none"
        ? false
        : true;
      const result = {
        workspace,
        resource: "profile-policy",
        dry_run: Boolean(args["dry-run"]),
        change: {
          key: "email_visibility",
          before: current,
          after: change.value,
        },
      };
      if (args.json) printJson(result);
      else {
        console.log("profile-policy.email_visibility");
        console.log(`  before: ${current}`);
        console.log(`  after:  ${change.value}`);
      }
      if (current === change.value) {
        throw new Error("The requested email visibility is already set.");
      }
      findAdminForm(
        await fetchWorkspaceAdminPage(workspace, "/admin/settings"),
        "change_display_email_addresses",
      );
      if (args["dry-run"]) {
        if (!args.json) console.log("Dry run: no workspace changes were made.");
        return;
      }
      if (
        !(await confirmMutation(
          `Update profile-policy.email_visibility in ${workspace}?`,
          { yes: Boolean(args.yes) },
        ))
      ) {
        console.error("Cancelled.");
        return;
      }
      await postWorkspaceAdminForm(
        workspace,
        "/admin/settings",
        "change_display_email_addresses",
        { display_email_addresses: change.value as string },
      );
      const verified = await getPreferences(workspace);
      const actual = verified.display_email_addresses
        ? verified.display_external_email_addresses
          ? "external"
          : "internal"
        : "none";
      if (
        Boolean(verified.display_email_addresses) !== expected ||
        actual !== change.value
      ) {
        throw new Error("Slack did not retain the requested email visibility.");
      }
      if (!args.json) console.log("Updated profile-policy.email_visibility");
      return;
    }
    if (!["admin", "owner"].includes(String(change.value))) {
      throw new Error("--field-editors must be admin or owner.");
    }
    await applyVerifiedPreferenceChange({
      workspace,
      resource: "profile-policy",
      key: "who_can_change_team_profile",
      before: prefs.who_can_change_team_profile,
      after: change.value,
      marker: "change_team_profile",
      values: { change_team_profile: change.value as string },
      dryRun: Boolean(args["dry-run"]),
      yes: Boolean(args.yes),
      json: Boolean(args.json),
    });
  },
});

export const adminProfilePolicyCommand = defineCommand({
  meta: {
    name: "profile-policy",
    description: "Manage profile display and editor policies",
  },
  subCommands: {
    show: adminProfilePolicyShowCommand,
    update: adminProfilePolicyUpdateCommand,
  },
});

export const adminChannelPolicyShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show channel and message policies",
  },
  args: { ...workspaceArg, ...jsonArg },
  async run({ args }) {
    const prefs = await getPreferences(required(args.workspace, "--workspace"));
    const result = preferenceSubset(prefs, [
      "default_channel_creation_enabled",
      "default_create_private_channel",
      "show_join_leave",
      "warn_before_at_channel",
      "msg_edit_window_mins",
      "allow_message_deletion",
      "private_message_forwarding",
      "who_can_post_general",
      "allow_lock_thread",
      "channel_email_addresses_enabled",
    ]);
    if (args.json) printJson(result);
    else printRecord(result);
  },
});

export const adminChannelPolicyUpdateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update one channel or message policy",
  },
  args: {
    ...workspaceArg,
    "message-edit-window": {
      type: "string",
      description: "Minutes allowed, any, or never",
    },
    "join-leave-messages": {
      type: "string",
      description: "Join/leave messages: enabled or disabled",
    },
    "mention-warning": {
      type: "string",
      description: "@channel warning: always, daily, once, or never",
    },
    ...mutationArgs,
    ...jsonArg,
  },
  async run({ args }) {
    const workspace = required(args.workspace, "--workspace");
    const joinLeave = parseEnabled(
      args["join-leave-messages"],
      "--join-leave-messages",
    );
    const change = requireOneChange([
      {
        name: "msg_edit_window_mins",
        value: args["message-edit-window"],
      },
      { name: "show_join_leave", value: joinLeave },
      { name: "warn_before_at_channel", value: args["mention-warning"] },
    ]);
    const prefs = await getPreferences(workspace);
    if (change.name === "msg_edit_window_mins") {
      const input = String(change.value);
      const after = input === "any"
        ? -1
        : input === "never"
          ? 0
          : Number(input);
      if (
        !Number.isInteger(after) ||
        ![-1, 0, 1, 5, 30, 60, 1440, 10080].includes(after)
      ) {
        throw new Error(
          "--message-edit-window must be any, never, 1, 5, 30, 60, 1440, or 10080.",
        );
      }
      await applyVerifiedPreferenceChange({
        workspace,
        resource: "channel-policy",
        key: change.name,
        before: Number(prefs[change.name]),
        after,
        marker: "change_message_editing",
        values: { msg_edit_window_mins: after },
        dryRun: Boolean(args["dry-run"]),
        yes: Boolean(args.yes),
        json: Boolean(args.json),
      });
      return;
    }
    if (change.name === "show_join_leave") {
      await applyVerifiedPreferenceChange({
        workspace,
        resource: "channel-policy",
        key: change.name,
        before: Boolean(prefs[change.name]),
        after: change.value,
        marker: "change_show_join_leave",
        values: { show_join_leave: change.value as boolean },
        dryRun: Boolean(args["dry-run"]),
        yes: Boolean(args.yes),
        json: Boolean(args.json),
      });
      return;
    }
    if (!["always", "daily", "once", "never"].includes(String(change.value))) {
      throw new Error(
        "--mention-warning must be always, daily, once, or never.",
      );
    }
    await applyVerifiedPreferenceChange({
      workspace,
      resource: "channel-policy",
      key: change.name,
      before: prefs[change.name],
      after: change.value,
      marker: "warn_before_at_channel",
      values: { warn_before_at_channel: change.value as string },
      dryRun: Boolean(args["dry-run"]),
      yes: Boolean(args.yes),
      json: Boolean(args.json),
    });
  },
});

export const adminChannelPolicyCommand = defineCommand({
  meta: {
    name: "channel-policy",
    description: "Manage channel and message policies",
  },
  subCommands: {
    show: adminChannelPolicyShowCommand,
    update: adminChannelPolicyUpdateCommand,
  },
});
