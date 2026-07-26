import { describe, expect, it } from "vitest";
import {
  applyProfileFieldChanges,
  buildAdminSectionsInput,
  parseFieldAssignments,
  profileDataSource,
  resolveMember,
  resolveProfileField,
  summarizeProfileField,
  type AdminProfileSection,
} from "../src/lib/admin-profile.ts";

function field(
  overrides: Partial<AdminProfileSection["profileAdminElements"][number]> = {},
): AdminProfileSection["profileAdminElements"][number] {
  return {
    id: "PeTITLE",
    hint: "",
    isIndexed: true,
    isFilterable: true,
    isScimManaged: true,
    elementKey: "title",
    legacyFieldId: "XfTITLE",
    label: "Title",
    order: 1,
    type: "TEXT",
    isHidden: false,
    canChangeHidden: true,
    canEdit: false,
    canChangeLabel: false,
    canChangeSearch: false,
    canSetOptions: true,
    permissions: {
      ui: false,
      scim: false,
      api: ["WORKSPACE_ADMIN", "WORKSPACE_OWNER"],
    },
    defaultVisibility: "INTERNAL_ONLY",
    validDataSources: ["UI", "API", "SCIM"],
    options: [],
    ...overrides,
  };
}

function sections(): AdminProfileSection[] {
  return [
    {
      id: "PsHEADER",
      label: "Header",
      order: 1,
      type: "HEADER",
      isHidden: false,
      canChangeHidden: false,
      canEdit: false,
      profileAdminElements: [
        field(),
        field({
          id: "PeCODE",
          legacyFieldId: "XfCODE",
          elementKey: "teamCode",
          label: "Team Code",
          order: 2,
          canEdit: true,
          permissions: { ui: true, scim: false, api: [] },
          validDataSources: ["UI", "API"],
        }),
      ],
    },
  ];
}

describe("admin profile fields", () => {
  it("derives the effective source from write permissions", () => {
    expect(profileDataSource({ ui: true, scim: false, api: [] })).toBe(
      "member",
    );
    expect(profileDataSource({ ui: false, scim: true, api: [] })).toBe("scim");
    expect(
      profileDataSource({
        ui: false,
        scim: false,
        api: ["WORKSPACE_OWNER"],
      }),
    ).toBe("api");
  });

  it("resolves fields by API id, admin id, key, or exact label", () => {
    expect(resolveProfileField(sections(), "XfTITLE").element.label).toBe(
      "Title",
    );
    expect(resolveProfileField(sections(), "PeTITLE").element.label).toBe(
      "Title",
    );
    expect(resolveProfileField(sections(), "title").element.label).toBe(
      "Title",
    );
    expect(resolveProfileField(sections(), "team code").element.legacyFieldId)
      .toBe("XfCODE");
  });

  it("rejects ambiguous labels rather than picking the first field", () => {
    const input = sections();
    input[0]!.profileAdminElements.push(
      field({
        id: "PeOTHER",
        legacyFieldId: "XfOTHER",
        elementKey: "otherTitle",
      }),
    );
    expect(() => resolveProfileField(input, "Title")).toThrow("ambiguous");
  });

  it("applies source and visibility changes without mutating the input", () => {
    const input = sections();
    const mutation = applyProfileFieldChanges(input, "Team Code", {
      source: "api",
      visible: false,
    });
    expect(summarizeProfileField(resolveProfileField(input, "Team Code")))
      .toMatchObject({ source: "member", visible: true });
    expect(mutation.before).toMatchObject({ source: "member", visible: true });
    expect(mutation.after).toMatchObject({ source: "api", visible: false });
  });

  it("rejects a source not supported by the Slack schema", () => {
    expect(() =>
      applyProfileFieldChanges(sections(), "Team Code", { source: "scim" })
    ).toThrow(
      "Valid sources: member, api. Slack does not expose SCIM for this field",
    );
  });

  it("accepts SCIM only when the live field schema advertises it", () => {
    const mutation = applyProfileFieldChanges(sections(), "Title", {
      source: "scim",
    });
    expect(mutation.after.source).toBe("scim");
  });

  it("rejects visibility changes for protected fields", () => {
    const input = sections();
    input[0]!.profileAdminElements[0]!.canChangeHidden = false;
    expect(() =>
      applyProfileFieldChanges(input, "Title", { visible: false })
    ).toThrow("Visibility for");
  });

  it("serializes the complete admin input without response-only fields", () => {
    const input = sections();
    input[0]!.profileAdminElements[0]!.__typename = "ProfileAdminTextElement";
    const payload = buildAdminSectionsInput(input);
    const title = (
      payload[0]!.profileAdminElements as Array<Record<string, unknown>>
    )[0]!;
    expect(title).not.toHaveProperty("__typename");
    expect(title).toMatchObject({
      id: "PeTITLE",
      legacyFieldId: "XfTITLE",
      text: { options: [] },
      person: null,
    });
  });
});

describe("member and assignment resolution", () => {
  const members = [
    {
      id: "U111",
      name: "river",
      profile: {
        display_name: "River Song",
        real_name: "River Song",
        email: "river@example.test",
      },
    },
    {
      id: "U222",
      name: "doctor",
      profile: { display_name: "The Doctor", real_name: "Doctor" },
    },
  ];

  it("resolves exact member identifiers without fuzzy matching", () => {
    expect(resolveMember(members, "U111").id).toBe("U111");
    expect(resolveMember(members, "river@example.test").id).toBe("U111");
    expect(resolveMember(members, "The Doctor").id).toBe("U222");
    expect(() => resolveMember(members, "Doc")).toThrow("not found");
  });

  it("parses repeatable field assignments and preserves equals signs", () => {
    expect(parseFieldAssignments(["Team Code=alpha", "Link=a=b"])).toEqual([
      { field: "Team Code", value: "alpha" },
      { field: "Link", value: "a=b" },
    ]);
    expect(() => parseFieldAssignments("missing-separator")).toThrow(
      "Invalid field assignment",
    );
  });
});
