import { defineCommand } from "citty";
import {
  collectAdminSnapshot,
  diffAdminSnapshots,
  type AdminDiffEntry,
  type AdminSnapshot,
} from "../lib/admin-snapshot.ts";
import { printJson } from "../lib/cli-safety.ts";

const jsonArg = {
  json: {
    type: "boolean" as const,
    description: "Output the complete result as JSON",
    default: false,
  },
};

function sourceSummary(snapshot: AdminSnapshot): string {
  return Object.entries(snapshot.sources)
    .map(([name, source]) => `${name}=${source.status}`)
    .join(", ");
}

function formatValue(value: unknown): string {
  if (value === undefined) return "-";
  const rendered =
    typeof value === "string" ? value : JSON.stringify(value);
  return rendered.length > 100 ? `${rendered.slice(0, 97)}...` : rendered;
}

function printDiffEntry(entry: AdminDiffEntry): void {
  console.log(
    `${entry.classification.padEnd(24)} ${entry.path}\n` +
      `  from: ${formatValue(entry.from)}\n` +
      `  to:   ${formatValue(entry.to)}`,
  );
}

function snapshotSections(snapshot: AdminSnapshot): Record<string, unknown> {
  return {
    sources: snapshot.sources,
    plan: snapshot.plan,
    capabilities: snapshot.capabilities,
    authentication: snapshot.authentication,
    profile_fields: snapshot.profile_fields,
    members: snapshot.members,
    preferences: snapshot.preferences,
    customization: snapshot.customization,
  };
}

export const adminSnapshotCommand = defineCommand({
  meta: {
    name: "snapshot",
    description: "Collect a redacted, plan-aware workspace admin snapshot",
  },
  args: {
    workspace: {
      type: "string",
      alias: "w",
      description: "Slack workspace domain",
      required: true,
    },
    section: {
      type: "string",
      description:
        "Return one section (for example capabilities, preferences, or profile_fields)",
    },
    ...jsonArg,
  },
  async run({ args }) {
    const snapshot = await collectAdminSnapshot(args.workspace);
    if (args.section) {
      const sections = snapshotSections(snapshot);
      if (!(args.section in sections)) {
        throw new Error(
          `Unknown snapshot section "${args.section}". Valid sections: ${
            Object.keys(sections).join(", ")
          }.`,
        );
      }
      printJson(sections[args.section]);
      return;
    }
    if (args.json) {
      printJson(snapshot);
      return;
    }
    const fieldCount = Object.keys(snapshot.profile_fields).length;
    const visibleFields = Object.values(snapshot.profile_fields).filter(
      (field) => field.visible,
    ).length;
    console.log(`workspace: ${snapshot.workspace}`);
    console.log(`plan: ${snapshot.plan?.plan ?? "unknown"}`);
    console.log(`sources: ${sourceSummary(snapshot)}`);
    console.log(
      `profile_fields: ${fieldCount} (${visibleFields} visible, ${
        fieldCount - visibleFields
      } hidden)`,
    );
    console.log(
      `members: ${snapshot.members?.active_humans ?? "unknown"} active humans`,
    );
    console.log(
      `preference_sections: ${Object.keys(snapshot.preferences).length}`,
    );
    console.log(
      "Use --json for the complete redacted snapshot.",
    );
  },
});

export const adminDiffCommand = defineCommand({
  meta: {
    name: "diff",
    description: "Compare two live workspace admin snapshots",
  },
  args: {
    from: {
      type: "string",
      description: "Source Slack workspace domain",
      required: true,
    },
    to: {
      type: "string",
      description: "Target Slack workspace domain",
      required: true,
    },
    section: {
      type: "string",
      description:
        "Compare one top-level section (for example authentication or profile_fields)",
    },
    ...jsonArg,
  },
  async run({ args }) {
    if (args.from === args.to) {
      throw new Error("--from and --to must name different workspaces.");
    }
    const [from, to] = await Promise.all([
      collectAdminSnapshot(args.from),
      collectAdminSnapshot(args.to),
    ]);
    const diff = diffAdminSnapshots(from, to, args.section);
    if (args.json) {
      printJson(diff);
      return;
    }
    console.log(`${diff.from_workspace} -> ${diff.to_workspace}`);
    console.log(`differences: ${diff.differences.length}`);
    for (const [classification, count] of Object.entries(diff.counts)) {
      if (count > 0) console.log(`  ${classification}: ${count}`);
    }
    if (diff.differences.length === 0) {
      console.log("(no differences)");
      return;
    }
    console.log("");
    for (const entry of diff.differences) printDiffEntry(entry);
  },
});
