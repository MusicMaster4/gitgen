import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareSemver,
  evaluateUpdate,
  isNewerVersion,
  npmGlobalInstallCommand,
  parseNpmLatestVersion,
  parseSemverCore,
} from "../lib/update-check";
import { shouldSkipRelease } from "../lib/release-skip";

describe("parseSemverCore / compareSemver", () => {
  it("parses core versions", () => {
    assert.deepEqual(parseSemverCore("1.2.3"), [1, 2, 3]);
    assert.deepEqual(parseSemverCore("v2.0.0"), [2, 0, 0]);
    assert.deepEqual(parseSemverCore("1.0.0-beta"), [1, 0, 0]);
    assert.equal(parseSemverCore("nope"), null);
  });

  it("compares versions correctly", () => {
    assert.ok(compareSemver("1.0.1", "1.0.0") > 0);
    assert.ok(compareSemver("1.0.0", "1.0.1") < 0);
    assert.equal(compareSemver("2.0.0", "2.0.0"), 0);
    assert.ok(compareSemver("2.0.0", "1.9.9") > 0);
    assert.ok(isNewerVersion("1.2.0", "1.1.9"));
    assert.equal(isNewerVersion("1.0.0", "1.0.0"), false);
    assert.equal(isNewerVersion("1.0.0", "1.0.1"), false);
  });
});

describe("parseNpmLatestVersion", () => {
  it("reads version from /latest document", () => {
    assert.equal(parseNpmLatestVersion({ version: "3.4.5", name: "pkg" }), "3.4.5");
  });

  it("reads dist-tags.latest from full package doc", () => {
    assert.equal(
      parseNpmLatestVersion({ "dist-tags": { latest: "9.8.7", next: "10.0.0-rc" } }),
      "9.8.7"
    );
  });

  it("throws on invalid payloads", () => {
    assert.throws(() => parseNpmLatestVersion(null), /Invalid/);
    assert.throws(() => parseNpmLatestVersion({}), /Could not find/);
  });
});

describe("evaluateUpdate / npmGlobalInstallCommand", () => {
  it("reports up-to-date", () => {
    const r = evaluateUpdate("1.0.0", "1.0.0");
    assert.equal(r.status, "up-to-date");
    if (r.status === "up-to-date") {
      assert.equal(r.latest, "1.0.0");
    }
  });

  it("reports update-available when latest is newer", () => {
    const r = evaluateUpdate("1.0.0", "1.0.2");
    assert.equal(r.status, "update-available");
    if (r.status === "update-available") {
      assert.equal(r.current, "1.0.0");
      assert.equal(r.latest, "1.0.2");
    }
  });

  it("does not flag update when current is ahead", () => {
    const r = evaluateUpdate("2.0.0", "1.9.0");
    assert.equal(r.status, "up-to-date");
  });

  it("builds install command", () => {
    assert.equal(
      npmGlobalInstallCommand("git-command-generator"),
      "npm install -g git-command-generator@latest"
    );
    assert.equal(
      npmGlobalInstallCommand("git-command-generator", "1.2.3"),
      "npm install -g git-command-generator@1.2.3"
    );
  });
});

describe("shouldSkipRelease", () => {
  it("skips explicit markers", () => {
    assert.equal(shouldSkipRelease("docs: fix typo [skip release]"), true);
    assert.equal(shouldSkipRelease("chore: ci [skip-release]"), true);
    assert.equal(shouldSkipRelease("docs: x [no release]"), true);
  });

  it("skips chore(release) commits (anti-loop)", () => {
    assert.equal(shouldSkipRelease("chore(release): v1.0.1"), true);
    assert.equal(shouldSkipRelease("chore(release): 1.2.3 [skip ci]"), true);
  });

  it("does not skip normal feature commits", () => {
    assert.equal(shouldSkipRelease("feat: add update command"), false);
    assert.equal(shouldSkipRelease("fix: spinner on windows"), false);
    assert.equal(shouldSkipRelease(""), false);
  });
});
