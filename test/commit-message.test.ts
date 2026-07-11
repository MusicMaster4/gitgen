import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildContext, cleanMessage, extractResponseText } from "../lib/commit-message";

describe("cleanMessage", () => {
  it("returns a plain conventional commit unchanged", () => {
    assert.equal(cleanMessage("feat: add login page"), "feat: add login page");
    assert.equal(cleanMessage("fix(auth): handle expired tokens"), "fix(auth): handle expired tokens");
  });

  it("strips quotes, backticks, and trailing periods", () => {
    assert.equal(cleanMessage('"feat: add login page"'), "feat: add login page");
    assert.equal(cleanMessage("`fix: correct typo`"), "fix: correct typo");
    assert.equal(cleanMessage("chore: bump deps."), "chore: bump deps");
  });

  it("strips a leading label like 'commit message:'", () => {
    assert.equal(cleanMessage("Commit message: feat: add search"), "feat: add search");
    assert.equal(cleanMessage("mensagem de commit: fix: corrige rota"), "fix: corrige rota");
  });

  it("removes <think> blocks from reasoning models", () => {
    assert.equal(
      cleanMessage("<think>The diff adds a route…</think>\nfeat: add api route"),
      "feat: add api route"
    );
    assert.equal(cleanMessage("</think>fix: close tag leak"), "fix: close tag leak");
  });

  it("picks the last conventional-commit line from multi-line output", () => {
    const raw = "Here is a good message:\n\nfeat: add commit generation";
    assert.equal(cleanMessage(raw), "feat: add commit generation");
  });

  it("falls back to the last line when nothing matches conventional commits", () => {
    assert.equal(cleanMessage("some free-form text"), "some free-form text");
  });

  it("returns empty for empty or whitespace input", () => {
    assert.equal(cleanMessage(""), "");
    assert.equal(cleanMessage("   \n  "), "");
  });
});

describe("extractResponseText", () => {
  it("prefers output_text (OpenAI responses API)", () => {
    assert.equal(extractResponseText({ output_text: "feat: a" }), "feat: a");
  });

  it("joins output[].content[].text parts", () => {
    const data = {
      output: [
        { content: [{ text: "feat: a" }, { text: "line 2" }] },
        { content: [{ text: "line 3" }] },
      ],
    };
    assert.equal(extractResponseText(data), "feat: a\nline 2\nline 3");
  });

  it("falls back to chat choices[0].message.content (OpenRouter)", () => {
    const data = { choices: [{ message: { content: "fix: b" } }] };
    assert.equal(extractResponseText(data), "fix: b");
  });

  it("returns empty string for unrecognized shapes", () => {
    assert.equal(extractResponseText({}), "");
    assert.equal(extractResponseText(null), "");
    assert.equal(extractResponseText({ choices: [{ message: { content: 42 } }] }), "");
  });
});

describe("buildContext", () => {
  it("includes only non-empty sections, labeled", () => {
    const out = buildContext("M file.ts", "M\tfile.ts", "diff body", "");
    assert.match(out, /^STATUS:\nM file\.ts/);
    assert.match(out, /FILES:\nM\tfile\.ts/);
    assert.match(out, /DIFF:\ndiff body/);
    assert.doesNotMatch(out, /UNTRACKED:/);
  });

  it("includes untracked files when present", () => {
    const out = buildContext("", "", "", "new-file.ts");
    assert.equal(out, "UNTRACKED:\nnew-file.ts");
  });

  it("returns empty string when everything is empty", () => {
    assert.equal(buildContext("", "  ", "\n", ""), "");
  });

  it("truncates very large diffs and marks the cut", () => {
    const bigDiff = "x".repeat(10_000);
    const out = buildContext("", "", bigDiff, "");
    assert.ok(out.length < bigDiff.length);
    assert.match(out, /…\(truncated\)$/);
  });
});
