import { workspaceApi } from "./workspace-client.ts";

export type ProfileDataSource = "member" | "api" | "scim";

export interface ProfilePermissions {
  ui: boolean;
  scim: boolean;
  api: string[];
}

export interface AdminProfileElement {
  id: string | null;
  hint: string;
  isIndexed: boolean;
  isFilterable: boolean;
  isScimManaged: boolean;
  elementKey: string;
  legacyFieldId: string | null;
  label: string;
  order: number;
  type: string;
  isHidden: boolean;
  canChangeHidden: boolean;
  canEdit: boolean;
  canChangeLabel: boolean;
  canChangeSearch: boolean;
  canSetOptions: boolean;
  permissions: ProfilePermissions;
  defaultVisibility: string | null;
  validDataSources: string[] | null;
  areCelebrationsEnabled?: boolean;
  options?: string[] | null;
  inverseLabel?: string;
  [key: string]: unknown;
}

export interface AdminProfileSection {
  id: string | null;
  label: string;
  order: number;
  type: string;
  isHidden: boolean;
  canChangeHidden: boolean;
  canEdit: boolean;
  profileAdminElements: AdminProfileElement[];
  [key: string]: unknown;
}

export interface ProfileFieldSummary {
  id: string;
  admin_id: string | null;
  label: string;
  key: string;
  type: string;
  section: string;
  source: ProfileDataSource;
  visible: boolean;
  protected: boolean;
  allowed_writers: string[];
  valid_sources: ProfileDataSource[];
}

export interface ResolvedProfileField {
  section: AdminProfileSection;
  element: AdminProfileElement;
}

export interface SlackMember {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
  profile?: {
    email?: string;
    display_name?: string;
    real_name?: string;
  };
}

const API_WRITER_ROLES = [
  "ORG_ADMIN",
  "ORG_PRIMARY_OWNER",
  "ORG_OWNER",
  "WORKSPACE_ADMIN",
  "WORKSPACE_OWNER",
  "WORKSPACE_PRIMARY_OWNER",
];

export function profileDataSource(
  permissions: Partial<ProfilePermissions> | undefined,
): ProfileDataSource {
  if (permissions?.scim) return "scim";
  if ((permissions?.api?.length ?? 0) > 0) return "api";
  return "member";
}

function normalizeSource(source: string): ProfileDataSource | null {
  const value = source.trim().toLowerCase();
  if (value === "member" || value === "ui" || value === "user-edited") {
    return "member";
  }
  if (value === "api" || value === "scim") return value;
  return null;
}

export function validProfileDataSources(
  element: AdminProfileElement,
): ProfileDataSource[] {
  return (element.validDataSources ?? [])
    .map((source) => normalizeSource(source))
    .filter((source): source is ProfileDataSource => source !== null);
}

export function flattenProfileFields(
  sections: AdminProfileSection[],
): ResolvedProfileField[] {
  return sections.flatMap((section) =>
    (section.profileAdminElements ?? []).map((element) => ({ section, element })),
  );
}

export function summarizeProfileField(
  resolved: ResolvedProfileField,
): ProfileFieldSummary {
  const { section, element } = resolved;
  const source = profileDataSource(element.permissions);
  const writers =
    source === "member"
      ? ["member"]
      : source === "scim"
        ? ["scim"]
        : element.permissions.api;
  return {
    id: element.legacyFieldId ?? element.id ?? element.elementKey,
    admin_id: element.id,
    label: element.label,
    key: element.elementKey,
    type: element.type.toLowerCase(),
    section: section.label,
    source,
    visible: !element.isHidden,
    protected: !element.canEdit,
    allowed_writers: writers,
    valid_sources: validProfileDataSources(element),
  };
}

export function resolveProfileField(
  sections: AdminProfileSection[],
  query: string,
): ResolvedProfileField {
  const wanted = query.trim().toLowerCase();
  const matches = flattenProfileFields(sections).filter(({ element }) =>
    [element.id, element.legacyFieldId, element.elementKey, element.label]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase() === wanted),
  );
  if (matches.length === 0) {
    throw new Error(`Profile field "${query}" was not found.`);
  }
  if (matches.length > 1) {
    const ids = matches
      .map(({ element }) => element.legacyFieldId ?? element.id)
      .join(", ");
    throw new Error(`Profile field "${query}" is ambiguous. Matching IDs: ${ids}`);
  }
  return matches[0]!;
}

function permissionsForSource(source: ProfileDataSource): ProfilePermissions {
  if (source === "member") return { ui: true, scim: false, api: [] };
  if (source === "scim") return { ui: false, scim: true, api: [] };
  return { ui: false, scim: false, api: [...API_WRITER_ROLES] };
}

export interface ProfileFieldChanges {
  source?: ProfileDataSource;
  visible?: boolean;
}

export interface ProfileFieldMutation {
  sections: AdminProfileSection[];
  before: ProfileFieldSummary;
  after: ProfileFieldSummary;
}

export function applyProfileFieldChanges(
  sections: AdminProfileSection[],
  fieldQuery: string,
  changes: ProfileFieldChanges,
): ProfileFieldMutation {
  const copy = structuredClone(sections);
  const resolved = resolveProfileField(copy, fieldQuery);
  const before = summarizeProfileField(resolveProfileField(sections, fieldQuery));
  const { element } = resolved;

  if (changes.source) {
    const valid = validProfileDataSources(element);
    if (!valid.includes(changes.source)) {
      const planHint =
        changes.source === "scim"
          ? " Slack does not expose SCIM for this field in the current workspace configuration or plan."
          : "";
      throw new Error(
        `Field "${element.label}" cannot use source "${changes.source}". ` +
          `Valid sources: ${valid.join(", ") || "none"}.${planHint}`,
      );
    }
    element.permissions = permissionsForSource(changes.source);
  }
  if (changes.visible !== undefined) {
    const currentVisible = !element.isHidden;
    if (!element.canChangeHidden && changes.visible !== currentVisible) {
      throw new Error(`Visibility for "${element.label}" cannot be changed.`);
    }
    element.isHidden = !changes.visible;
  }

  const after = summarizeProfileField(resolved);
  if (
    before.source === after.source &&
    before.visible === after.visible
  ) {
    throw new Error(`No changes requested for "${element.label}".`);
  }
  return { sections: copy, before, after };
}

function cleanElement(element: AdminProfileElement): Record<string, unknown> {
  return {
    id: element.id ?? null,
    canEdit: Boolean(element.canEdit),
    canChangeHidden: Boolean(element.canChangeHidden),
    canChangeLabel: Boolean(element.canChangeLabel),
    canChangeSearch: Boolean(element.canChangeSearch),
    canSetOptions: Boolean(element.canSetOptions),
    legacyFieldId: element.legacyFieldId ?? null,
    validDataSources: element.validDataSources ?? null,
    hint: element.hint ?? "",
    isFilterable: Boolean(element.isFilterable),
    isHidden: Boolean(element.isHidden),
    isIndexed: Boolean(element.isIndexed),
    isInPreview: false,
    label: element.label ?? "",
    order: element.order,
    isScimManaged: Boolean(element.isScimManaged),
    elementKey: element.elementKey ?? "",
    type: element.type,
    defaultVisibility: element.defaultVisibility ?? null,
    permissions: {
      ui: Boolean(element.permissions?.ui),
      scim: Boolean(element.permissions?.scim),
      api: element.permissions?.api ?? [],
    },
    areCelebrationsEnabled: Boolean(element.areCelebrationsEnabled),
    text:
      element.type === "TEXT"
        ? { options: element.options ?? [] }
        : null,
    person:
      element.type === "PERSON"
        ? { inverseLabel: element.inverseLabel ?? "" }
        : null,
  };
}

export function buildAdminSectionsInput(
  sections: AdminProfileSection[],
): Array<Record<string, unknown>> {
  return sections.map((section, sectionIndex) => ({
    profileAdminElements: section.profileAdminElements.map(
      (element, elementIndex) =>
        cleanElement({ ...element, order: elementIndex + 1 }),
    ),
    id: section.id ?? null,
    label: section.label ?? "",
    order: sectionIndex + 1,
    type: section.type,
    isHidden: Boolean(section.isHidden),
    canChangeHidden: Boolean(section.canChangeHidden),
    canEdit: Boolean(section.canEdit),
  }));
}

export async function getAdminProfileSections(
  workspace: string,
): Promise<AdminProfileSection[]> {
  const response = await workspaceApi(
    workspace,
    "users.profile.getAdminSections",
    {},
    "slack2-admin-profile-field-read",
  );
  const result = response.result as
    | {
        data?: { admin?: { profileAdminSections?: AdminProfileSection[] } };
        errors?: Array<{ message?: string }>;
      }
    | undefined;
  if (result?.errors?.length) {
    throw new Error(
      `Slack profile admin query failed: ${
        result.errors.map((error) => error.message ?? "unknown error").join("; ")
      }`,
    );
  }
  const sections = result?.data?.admin?.profileAdminSections;
  if (!sections) {
    throw new Error(
      "Slack did not return the profile admin schema. " +
        "The signed-in member may not have profile administration permission.",
    );
  }
  return sections;
}

export async function setAdminProfileSections(
  workspace: string,
  sections: AdminProfileSection[],
): Promise<void> {
  const response = await workspaceApi(
    workspace,
    "users.profile.setAdminSections",
    { sections: buildAdminSectionsInput(sections) },
    "slack2-admin-profile-field-update",
  );
  const result = response.result as
    | { errors?: Array<{ message?: string }> }
    | undefined;
  if (result?.errors?.length) {
    throw new Error(
      `Slack profile admin update failed: ${
        result.errors.map((error) => error.message ?? "unknown error").join("; ")
      }`,
    );
  }
}

export function resolveMember(
  members: SlackMember[],
  query: string,
): SlackMember {
  const wanted = query.trim().toLowerCase();
  const matches = members.filter((member) =>
    [
      member.id,
      member.name,
      member.profile?.email,
      member.profile?.display_name,
      member.profile?.real_name,
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase() === wanted),
  );
  if (matches.length === 0) throw new Error(`Member "${query}" was not found.`);
  if (matches.length > 1) {
    throw new Error(
      `Member "${query}" is ambiguous. Matching IDs: ${
        matches.map((member) => member.id).join(", ")
      }`,
    );
  }
  return matches[0]!;
}

export function parseFieldAssignments(
  input: string | string[] | undefined,
): Array<{ field: string; value: string }> {
  if (!input) return [];
  const values = Array.isArray(input) ? input : [input];
  return values.map((assignment) => {
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      throw new Error(
        `Invalid field assignment "${assignment}". Use --field <name-or-id>=<value>.`,
      );
    }
    return {
      field: assignment.slice(0, separator).trim(),
      value: assignment.slice(separator + 1),
    };
  });
}
