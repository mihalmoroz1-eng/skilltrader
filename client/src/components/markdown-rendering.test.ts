import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import katex from "katex";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";

describe("Markdown math rendering", () => {
  it("renders inline and display math through Streamdown", () => {
    const html = renderToStaticMarkup(
      createElement(Streamdown, {
        children: "Inline $E=mc^2$ and display math:\n\n$$x^2$$",
      })
    );

    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-html");
  });

  it("does not honor a trust flag inherited through the options prototype", () => {
    const inheritedTrustSettings = Object.create({
      trust: true,
      throwOnError: false,
    }) as Parameters<typeof katex.renderToString>[1];
    const html = katex.renderToString(
      String.raw`\href{javascript:alert(1)}{click}`,
      inheritedTrustSettings
    );

    expect(html).not.toMatch(/href=["']javascript:/i);
  });
});
