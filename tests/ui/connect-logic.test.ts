import { describe, expect, it } from "vitest";
import { GITHUB_URL } from "../../ui/src/links";
import { connectorFields, mcpUrl } from "../../ui/src/pages/connectLogic";

describe("mcpUrl", () => {
  it("origin に /mcp を付ける(末尾の / や /mcp が付いていても重ならない)", () => {
    expect(mcpUrl("https://example.test")).toBe("https://example.test/mcp");
    expect(mcpUrl("https://example.test/")).toBe("https://example.test/mcp");
  });
  it("コネクタの項目にURLが入る", () => {
    expect(connectorFields("https://example.test").find((f) => f.label === "URL")?.value).toBe("https://example.test/mcp");
  });
});

describe("GitHub のリンク", () => {
  it("https の github.com", () => {
    expect(GITHUB_URL.startsWith("https://github.com/")).toBe(true);
  });
});
