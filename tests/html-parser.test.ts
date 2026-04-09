import { describe, it, expect } from "vitest";

/**
 * Test the HTML parsing logic that will be used in `list --remote`.
 * This validates we can extract apps from the api.slack.com/apps page.
 */

function parseAppsHtml(html: string) {
  const apps: {
    name: string;
    workspace: string;
    appId: string;
    distribution: string;
  }[] = [];

  const rowRegex =
    /data-app-name="([^"]*)"[^>]*data-team-name="([^"]*)"[\s\S]*?href="\/apps\/(A[A-Z0-9]+)"[\s\S]*?<span class="bold">([^<]*)<\/span>[\s\S]*?<\/tr>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const [, , teamName, appId, appName] = match;
    apps.push({
      name: appName ?? "",
      workspace: teamName ?? "",
      appId: appId ?? "",
      distribution: match[0].includes("Publicly Distributed")
        ? "Publicly Distributed"
        : "Not distributed",
    });
  }

  return apps;
}

describe("parseAppsHtml", () => {
  const sampleRow = `
    <tr class="small align_middle" data-qa="app_row_123.456" data-app-name="my bot" data-team-name="circles inc">
      <td class="overflow_ellipsis"><a href="/apps/A0AKZPRFBJL" class="indifferent_grey">
        <img src="icon.png" class="constrain_32 rounded small_right_margin">
        <span class="bold">My Bot</span>
      </a></td>
      <td>Circles Inc</td>
      <td>A0AKZPRFBJL</td>
      <td>Modern</td>
      <td>Not distributed</td>
    </tr>`;

  const publicRow = `
    <tr class="small align_middle" data-qa="app_row_123.789" data-app-name="holla" data-team-name="circles inc">
      <td class="overflow_ellipsis"><a href="/apps/A0ADL0F4D3P" class="indifferent_grey">
        <span class="bold">holla</span>
      </a></td>
      <td>Circles Inc</td>
      <td>A0ADL0F4D3P</td>
      <td>Modern</td>
      <td> Publicly Distributed </td>
    </tr>`;

  it("should parse a single app row", () => {
    const apps = parseAppsHtml(sampleRow);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toEqual({
      name: "My Bot",
      workspace: "circles inc",
      appId: "A0AKZPRFBJL",
      distribution: "Not distributed",
    });
  });

  it("should detect publicly distributed apps", () => {
    const apps = parseAppsHtml(publicRow);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.distribution).toBe("Publicly Distributed");
  });

  it("should parse multiple rows", () => {
    const html = `<table>${sampleRow}${publicRow}</table>`;
    const apps = parseAppsHtml(html);
    expect(apps).toHaveLength(2);
    expect(apps[0]!.appId).toBe("A0AKZPRFBJL");
    expect(apps[1]!.appId).toBe("A0ADL0F4D3P");
  });

  it("should return empty for non-matching HTML", () => {
    const apps = parseAppsHtml("<div>No apps here</div>");
    expect(apps).toEqual([]);
  });

  it("should return empty for empty string", () => {
    const apps = parseAppsHtml("");
    expect(apps).toEqual([]);
  });

  it("should handle the sign-in-required page", () => {
    const html = `<div class="card">You'll need to sign in to your Slack account to create an application.</div>`;
    const apps = parseAppsHtml(html);
    expect(apps).toEqual([]);
  });
});
