import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanBody, cleanTitle } from "../lib/pr-message";

describe("cleanTitle", () => {
  it("strips quotes and trailing periods", () => {
    assert.equal(cleanTitle('"feat: add PR flow".'), "feat: add PR flow");
  });

  it("takes the first line only", () => {
    assert.equal(cleanTitle("feat: one\nfeat: two"), "feat: one");
  });

  it("strips Title: prefixes", () => {
    assert.equal(cleanTitle("Title: chore: docs"), "chore: docs");
  });

  it("collapses whitespace and caps length", () => {
    const long = "x".repeat(200);
    assert.equal(cleanTitle(`  ${long}  `).length, 120);
  });
});

describe("cleanBody", () => {
  it("keeps markdown summary intact", () => {
    const md = "## Summary\n\n- one\n- two\n";
    assert.equal(cleanBody(md), md.trim());
  });

  it("unwraps a full-reply markdown fence", () => {
    const raw = "```markdown\n## Summary\n\n- a\n```";
    assert.equal(cleanBody(raw), "## Summary\n\n- a");
  });

  it("strips Body: prefix", () => {
    assert.match(cleanBody("Body:\n## Summary\n- x"), /## Summary/);
  });

  it("strips think tags", () => {
    assert.equal(cleanBody("<think>secret</think>\n## Summary\n- y"), "## Summary\n- y");
  });
});
