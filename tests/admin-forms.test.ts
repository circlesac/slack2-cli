import { describe, expect, it } from "vitest";
import {
  adminFormBody,
  findAdminForm,
} from "../src/lib/admin-forms.ts";

describe("Slack admin forms", () => {
  const html = `
    <form action="/admin/settings" method="post">
      <input type="hidden" name="change_locale" value="1">
      <input type="hidden" name="crumb" value="s-123&amp;safe">
      <select name="locale"><option value="en-US">English</option></select>
    </form>
    <form action="/admin/settings" method="post">
      <input type="hidden" name="change_display_default_phone" value="1">
      <input type="hidden" name="crumb" value="s-456">
      <input type="checkbox" name="display_default_phone" value="1">
    </form>
  `;

  it("selects the form by its workspace setting marker", () => {
    expect(findAdminForm(html, "change_display_default_phone")).toEqual({
      action: "/admin/settings",
      hidden: {
        change_display_default_phone: "1",
        crumb: "s-456",
      },
      values: {
        change_display_default_phone: "1",
        crumb: "s-456",
      },
    });
  });

  it("decodes hidden form values", () => {
    expect(findAdminForm(html, "change_locale").hidden.crumb).toBe(
      "s-123&safe",
    );
  });

  it("reports plan or permission gaps when the form is absent", () => {
    expect(() => findAdminForm(html, "enterprise_only_setting")).toThrow(
      /current plan or controlled at the organization level/,
    );
  });

  it("reads checked, selected, and textarea values", () => {
    const controls = `
      <form action="/admin/settings" method="post">
        <input type="hidden" name="change_signup_mode" value="1">
        <input type="checkbox" name="signupmode" value="email" checked>
        <textarea name="signupdomains">example.com, example.org</textarea>
        <select name="locale">
          <option value="en-US">English</option>
          <option selected value="ko-KR">한국어</option>
        </select>
      </form>
    `;
    expect(findAdminForm(controls, "change_signup_mode").values).toEqual({
      change_signup_mode: "1",
      signupmode: "email",
      signupdomains: "example.com, example.org",
      locale: "ko-KR",
    });
  });

  it("preserves CSRF fields and omits unchecked controls", () => {
    const form = findAdminForm(html, "change_display_default_phone");
    const body = adminFormBody(form, {
      display_default_phone: false,
      label: "Phone",
      enabled: true,
    });
    expect(Object.fromEntries(body)).toEqual({
      change_display_default_phone: "1",
      crumb: "s-456",
      label: "Phone",
      enabled: "1",
    });
  });
});
