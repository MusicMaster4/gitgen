import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPrToken, isPushToken, parseCommitPrArgs } from "../lib/cli-args";

describe("isPrToken", () => {
  it("accepts pr and pull-request in any case", () => {
    assert.equal(isPrToken("pr"), true);
    assert.equal(isPrToken("PR"), true);
    assert.equal(isPrToken("pull-request"), true);
  });

  it("rejects other tokens and undefined", () => {
    assert.equal(isPrToken("push"), false);
    assert.equal(isPrToken("main"), false);
    // "pull" is the pull command, not a PR token
    assert.equal(isPrToken("pull"), false);
    assert.equal(isPrToken(undefined), false);
    assert.equal(isPrToken(""), false);
  });
});

describe("isPushToken", () => {
  it("accepts push and p in any case", () => {
    assert.equal(isPushToken("push"), true);
    assert.equal(isPushToken("P"), true);
  });

  it("rejects other tokens and undefined", () => {
    assert.equal(isPushToken("pr"), false);
    assert.equal(isPushToken(undefined), false);
  });
});

describe("parseCommitPrArgs", () => {
  it("commit → no push, no PR", () => {
    assert.deepEqual(parseCommitPrArgs("commit", undefined, undefined, undefined), {
      push: false,
      wantPr: false,
    });
  });

  it("commit push / commit p → push only", () => {
    assert.deepEqual(parseCommitPrArgs("commit", "push", undefined, undefined), {
      push: true,
      wantPr: false,
    });
    assert.deepEqual(parseCommitPrArgs("c", "p", undefined, undefined), {
      push: true,
      wantPr: false,
    });
  });

  it("commit pr [base] → push implied, PR with optional base", () => {
    assert.deepEqual(parseCommitPrArgs("commit", "pr", undefined, undefined), {
      push: true,
      wantPr: true,
      prBase: undefined,
    });
    assert.deepEqual(parseCommitPrArgs("commit", "pr", "main", undefined), {
      push: true,
      wantPr: true,
      prBase: "main",
    });
  });

  it("commit push pr [base] → push and PR", () => {
    assert.deepEqual(parseCommitPrArgs("commit", "push", "pr", "develop"), {
      push: true,
      wantPr: true,
      prBase: "develop",
    });
    assert.deepEqual(parseCommitPrArgs("commit", "p", "pr", undefined), {
      push: true,
      wantPr: true,
      prBase: undefined,
    });
  });

  it("cnp alias → push without extra token", () => {
    assert.deepEqual(parseCommitPrArgs("cnp", undefined, undefined, undefined), {
      push: true,
      wantPr: false,
    });
  });

  it("cnp pr [base] → push and PR", () => {
    assert.deepEqual(parseCommitPrArgs("cnp", "pr", undefined, undefined), {
      push: true,
      wantPr: true,
      prBase: undefined,
    });
    assert.deepEqual(parseCommitPrArgs("cnp", "pr", "develop", undefined), {
      push: true,
      wantPr: true,
      prBase: "develop",
    });
  });

  it("ignores non-pr tokens after cnp", () => {
    assert.deepEqual(parseCommitPrArgs("cnp", "extra", undefined, undefined), {
      push: true,
      wantPr: false,
    });
  });
});
