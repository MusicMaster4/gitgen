import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeStatusCode,
  parseAheadBehind,
  parsePorcelainStatus,
} from "../lib/status";

describe("parsePorcelainStatus", () => {
  it("returns zero counts for empty output", () => {
    const s = parsePorcelainStatus("");
    assert.equal(s.staged, 0);
    assert.equal(s.unstaged, 0);
    assert.equal(s.untracked, 0);
    assert.equal(s.conflicted, 0);
    assert.deepEqual(s.entries, []);
  });

  it("counts staged, unstaged and untracked entries", () => {
    const raw = ["M  lib/a.ts", " M lib/b.ts", "?? new-file.txt", "A  added.ts"].join("\n");
    const s = parsePorcelainStatus(raw);
    assert.equal(s.staged, 2); // M  + A
    assert.equal(s.unstaged, 1); // " M"
    assert.equal(s.untracked, 1);
    assert.equal(s.conflicted, 0);
    assert.equal(s.entries.length, 4);
    assert.equal(s.entries[2].path, "new-file.txt");
  });

  it("counts a file staged AND unstaged (MM) in both buckets", () => {
    const s = parsePorcelainStatus("MM lib/a.ts");
    assert.equal(s.staged, 1);
    assert.equal(s.unstaged, 1);
  });

  it("detects merge conflicts (UU, AA, DD)", () => {
    const s = parsePorcelainStatus(["UU conflict.ts", "AA both-added.ts", "DD both-deleted.ts"].join("\n"));
    assert.equal(s.conflicted, 3);
    assert.equal(s.staged, 0);
    assert.equal(s.unstaged, 0);
  });

  it("ignores blank/short lines", () => {
    const s = parsePorcelainStatus("\n \nM  lib/a.ts\n");
    assert.equal(s.entries.length, 1);
  });
});

describe("parseAheadBehind", () => {
  it("parses tab-separated behind/ahead counts", () => {
    assert.deepEqual(parseAheadBehind("2\t3"), { behind: 2, ahead: 3 });
    assert.deepEqual(parseAheadBehind("0 0\n"), { behind: 0, ahead: 0 });
  });

  it("returns null when unparseable (e.g. no upstream)", () => {
    assert.equal(parseAheadBehind(""), null);
    assert.equal(parseAheadBehind("fatal: no upstream"), null);
  });
});

describe("describeStatusCode", () => {
  it("labels common codes", () => {
    assert.equal(describeStatusCode("??"), "untracked");
    assert.equal(describeStatusCode("M "), "modified");
    assert.equal(describeStatusCode(" M"), "modified");
    assert.equal(describeStatusCode("A "), "added");
    assert.equal(describeStatusCode("D "), "deleted");
    assert.equal(describeStatusCode("R "), "renamed");
    assert.equal(describeStatusCode("UU"), "conflict");
  });

  it("falls back to a generic label", () => {
    assert.equal(describeStatusCode("X "), "changed");
  });
});
