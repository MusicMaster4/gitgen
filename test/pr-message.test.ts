import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanTitle,
  extractJsonObject,
  parsePrContent,
} from "../lib/pr-message";

describe("cleanTitle", () => {
  it("strips quotes and trailing periods", () => {
    assert.equal(cleanTitle('"feat: add PR flow".'), "feat: add PR flow");
  });

  it("collapses whitespace and caps length", () => {
    const long = "x".repeat(200);
    assert.equal(cleanTitle(`  ${long}  `).length, 120);
  });
});

describe("extractJsonObject", () => {
  it("unwraps markdown fences", () => {
    const raw = '```json\n{"title":"a","body":"b"}\n```';
    assert.equal(extractJsonObject(raw), '{"title":"a","body":"b"}');
  });

  it("finds object inside prose", () => {
    const raw = 'Here you go:\n{"title":"feat: x","body":"## Summary\\n- y"}\nThanks';
    assert.ok(extractJsonObject(raw).startsWith("{"));
    assert.ok(extractJsonObject(raw).endsWith("}"));
  });
});

describe("parsePrContent", () => {
  it("parses clean JSON", () => {
    const r = parsePrContent('{"title":"feat: ship pr","body":"## Summary\\n- one"}');
    assert.equal(r.title, "feat: ship pr");
    assert.match(r.body, /Summary/);
  });

  it("parses fenced JSON", () => {
    const r = parsePrContent('```json\n{"title":"fix: bug","body":"details"}\n```');
    assert.equal(r.title, "fix: bug");
    assert.equal(r.body, "details");
  });

  it("falls back to TITLE:/BODY: layout", () => {
    const r = parsePrContent("TITLE: chore: tidy\nBODY:\n## Summary\n- a\n");
    assert.equal(r.title, "chore: tidy");
    assert.match(r.body, /Summary/);
  });

  it("throws on garbage", () => {
    assert.throws(() => parsePrContent("not json at all"), /valid JSON|PR/);
  });

  it("throws when title missing", () => {
    assert.throws(() => parsePrContent('{"body":"only body"}'), /title/i);
  });
});
