import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeBranchName } from "../lib/branch-name";

describe("sanitizeBranchName", () => {
  it("converts spaces and underscores to hyphens", () => {
    assert.equal(sanitizeBranchName("feature login"), "feature-login");
    assert.equal(sanitizeBranchName("feature_login"), "feature-login");
    assert.equal(sanitizeBranchName("a  b   c"), "a-b-c");
  });

  it("normalizes accented characters", () => {
    assert.equal(sanitizeBranchName("ação rápida"), "acao-rapida");
    assert.equal(sanitizeBranchName("configuração"), "configuracao");
    assert.equal(sanitizeBranchName("résumé"), "resume");
    assert.equal(sanitizeBranchName("niño"), "nino");
  });

  it("removes special characters", () => {
    assert.equal(sanitizeBranchName("feature@login!"), "featurelogin");
    assert.equal(sanitizeBranchName("fix#123"), "fix123");
    assert.equal(sanitizeBranchName("test (wip)"), "test-wip");
  });

  it("keeps slashes and dots for hierarchical or versioned branches", () => {
    assert.equal(sanitizeBranchName("feature/login"), "feature/login");
    assert.equal(sanitizeBranchName("release/1.0.0"), "release/1.0.0");
  });

  it("collapses repeated hyphens, slashes, and dots", () => {
    assert.equal(sanitizeBranchName("feature--login"), "feature-login");
    assert.equal(sanitizeBranchName("feature//login"), "feature/login");
    assert.equal(sanitizeBranchName("feature..main"), "feature.main");
    assert.equal(sanitizeBranchName("a...b"), "a.b");
  });

  it("trims leading and trailing separators", () => {
    assert.equal(sanitizeBranchName("-feature-"), "feature");
    assert.equal(sanitizeBranchName("/feature/"), "feature");
    assert.equal(sanitizeBranchName("  feature  "), "feature");
  });

  it("returns empty for invalid-only input", () => {
    assert.equal(sanitizeBranchName(""), "");
    assert.equal(sanitizeBranchName("   "), "");
    assert.equal(sanitizeBranchName("@#$"), "");
  });
});