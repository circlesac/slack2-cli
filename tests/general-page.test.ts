import { describe, it, expect } from "vitest";
import {
  decodeHtml,
  extractInputValue,
  extractTextareaValue,
  extractIconUrl,
  mimeType,
} from "../src/lib/general-page.ts";

const SAMPLE = `
  <form action="/apps/A123/general?" method="post">
    <input type="hidden" name="crumb" value="s-abc-123==" />
    <input type="text" name="name" value="circlesac-doona" />
    <input type="text" name="desc" value="Companion &amp; sidekick" />
    <input type="text" name="app_card_color" value="#2C2D30" />
    <textarea name="long_desc">Line one.
Line &lt;two&gt;.</textarea>
    <img class="app_icon icon_for_A123" src="https://a.slack-edge.com/x/img.png?d=1&amp;t=2" />
  </form>
`;

describe("general-page parsing", () => {
  it("decodes HTML entities", () => {
    expect(decodeHtml("a &amp; b &lt;c&gt; &quot;d&quot;")).toBe('a & b <c> "d"');
  });

  it("extracts input values and decodes entities", () => {
    expect(extractInputValue(SAMPLE, "name")).toBe("circlesac-doona");
    expect(extractInputValue(SAMPLE, "desc")).toBe("Companion & sidekick");
    expect(extractInputValue(SAMPLE, "app_card_color")).toBe("#2C2D30");
    expect(extractInputValue(SAMPLE, "crumb")).toBe("s-abc-123==");
  });

  it("returns null for a missing input", () => {
    expect(extractInputValue(SAMPLE, "nope")).toBeNull();
  });

  it("extracts textarea values including newlines", () => {
    expect(extractTextareaValue(SAMPLE, "long_desc")).toBe("Line one.\nLine <two>.");
  });

  it("extracts the app icon url for the given app id", () => {
    expect(extractIconUrl(SAMPLE, "A123")).toBe(
      "https://a.slack-edge.com/x/img.png?d=1&t=2",
    );
    expect(extractIconUrl(SAMPLE, "A999")).toBeNull();
  });

  it("maps image extensions to mime types", () => {
    expect(mimeType("x.png")).toBe("image/png");
    expect(mimeType("X.JPG")).toBe("image/jpeg");
    expect(mimeType("x.jpeg")).toBe("image/jpeg");
    expect(mimeType("x.webp")).toBe("image/webp");
    expect(mimeType("x.gif")).toBe("image/gif");
    expect(mimeType("x.bmp")).toBe("application/octet-stream");
  });
});
