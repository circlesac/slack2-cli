import { describe, it, expect } from "vitest";
import { isDistributed, extractActivateForm } from "../src/lib/distribute-page.ts";

const APP_ID = "A0123456789";

const ACTIVATE_PAGE = `
  <html><body>
    <h1>Manage Distribution</h1>
    <div class="badge">Not distributed</div>
    <form action="/apps/${APP_ID}/distribute" method="post">
      <input type="hidden" name="crumb" value="s-abc-123==" />
      <input type="hidden" name="app" value="${APP_ID}" />
      <button type="submit">Activate Public Distribution</button>
    </form>
  </body></html>
`;

const ALREADY_PAGE = `
  <html><body>
    <div class="badge">Publicly Distributed</div>
    <form action="/apps/${APP_ID}/distribute" method="post">
      <input type="hidden" name="crumb" value="s-xyz-9==" />
      <button type="submit">Deactivate Public Distribution</button>
    </form>
  </body></html>
`;

const CHECKLIST_INCOMPLETE_PAGE = `
  <html><body>
    <div class="badge">Not distributed</div>
    <p>Remove hard coded information before you can distribute.</p>
  </body></html>
`;

describe("isDistributed", () => {
  it("detects a publicly distributed app (badge)", () => {
    expect(isDistributed(ALREADY_PAGE)).toBe(true);
  });

  it("detects a distributed app via the deactivate control", () => {
    expect(isDistributed('<button>Deactivate Public Distribution</button>')).toBe(true);
  });

  it("is false when the app is not distributed yet", () => {
    expect(isDistributed(ACTIVATE_PAGE)).toBe(false);
    expect(isDistributed(CHECKLIST_INCOMPLETE_PAGE)).toBe(false);
  });
});

describe("extractActivateForm", () => {
  it("finds the activation form and harvests its action + inputs", () => {
    const form = extractActivateForm(ACTIVATE_PAGE, APP_ID);
    expect(form).not.toBeNull();
    expect(form!.action).toBe(`https://api.slack.com/apps/${APP_ID}/distribute`);
    expect(form!.fields).toEqual({ crumb: "s-abc-123==", app: APP_ID });
  });

  it("resolves a relative action against the distribute URL", () => {
    const html = `<form action="../${APP_ID}/distribute/activate">
      <input name="crumb" value="c1" />Activate Public Distribution</form>`;
    const form = extractActivateForm(html, APP_ID);
    expect(form!.action).toBe(`https://api.slack.com/apps/${APP_ID}/distribute/activate`);
  });

  it("returns null when no activation form is present (checklist unmet)", () => {
    expect(extractActivateForm(CHECKLIST_INCOMPLETE_PAGE, APP_ID)).toBeNull();
  });
});
