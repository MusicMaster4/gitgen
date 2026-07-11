import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseNodeMajor,
  runDoctorChecks,
  summarizeDoctorChecks,
  type DoctorCheck,
} from "../lib/doctor";

describe("parseNodeMajor", () => {
  it("parses v22.3.0", () => {
    assert.equal(parseNodeMajor("v22.3.0"), 22);
  });

  it("parses bare major", () => {
    assert.equal(parseNodeMajor("18.0.0"), 18);
  });

  it("returns 0 for garbage", () => {
    assert.equal(parseNodeMajor(""), 0);
  });
});

describe("summarizeDoctorChecks", () => {
  it("exit 0 when only ok and warn", () => {
    const checks: DoctorCheck[] = [
      { id: "a", label: "A", status: "ok", detail: "fine" },
      { id: "b", label: "B", status: "warn", detail: "meh" },
    ];
    const s = summarizeDoctorChecks(checks);
    assert.equal(s.ok, 1);
    assert.equal(s.warn, 1);
    assert.equal(s.fail, 0);
    assert.equal(s.exitCode, 0);
  });

  it("exit 1 when any fail", () => {
    const checks: DoctorCheck[] = [
      { id: "a", label: "A", status: "fail", detail: "bad" },
    ];
    assert.equal(summarizeDoctorChecks(checks).exitCode, 1);
  });
});

describe("runDoctorChecks", () => {
  it("reports missing git and repo with injected runner", async () => {
    const summary = await runDoctorChecks({
      cwd: "/tmp/proj",
      nodeVersion: "v20.0.0",
      configPath: "/tmp/cfg.json",
      loadConfigFn: () => ({}),
      runCmd: async (cmd, args) => {
        if (cmd === "git" && args[0] === "--version") {
          return { stdout: "git version 2.43.0", stderr: "", code: 0 };
        }
        if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
          return { stdout: "false\n", stderr: "", code: 0 };
        }
        if (cmd === "gh") {
          return { stdout: "", stderr: "not found", code: 1 };
        }
        return { stdout: "", stderr: "", code: 1 };
      },
      fetchFn: async () => new Response("{}", { status: 200 }),
    });

    const repo = summary.checks.find((c) => c.id === "repo");
    assert.equal(repo?.status, "fail");
    const gh = summary.checks.find((c) => c.id === "gh");
    assert.equal(gh?.status, "warn");
    const node = summary.checks.find((c) => c.id === "node");
    assert.equal(node?.status, "ok");
  });

  it("skips upstream check in detached HEAD", async () => {
    const summary = await runDoctorChecks({
      cwd: "/tmp/proj",
      nodeVersion: "v20.0.0",
      configPath: "/tmp/cfg.json",
      loadConfigFn: () => ({}),
      runCmd: async (cmd, args) => {
        if (cmd === "git" && args[0] === "--version") {
          return { stdout: "git version 2.43.0", stderr: "", code: 0 };
        }
        if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
          return { stdout: "true\n", stderr: "", code: 0 };
        }
        if (cmd === "git" && args[0] === "branch") {
          return { stdout: "", stderr: "", code: 0 };
        }
        return { stdout: "", stderr: "", code: 1 };
      },
      fetchFn: async () => new Response("{}", { status: 200 }),
    });

    const branch = summary.checks.find((c) => c.id === "branch");
    assert.equal(branch?.status, "warn");
    assert.equal(summary.checks.find((c) => c.id === "upstream"), undefined);
  });

  it("validates OpenRouter key via fetch", async () => {
    const summary = await runDoctorChecks({
      cwd: "/tmp/proj",
      nodeVersion: "v20.0.0",
      env: { OPENROUTER_API_KEY: "sk-or-v1-test-key-abcdefghij" },
      configPath: "/tmp/cfg.json",
      loadConfigFn: () => ({}),
      runCmd: async (cmd, args) => {
        if (cmd === "git" && args[0] === "--version") {
          return { stdout: "git version 2.43.0", stderr: "", code: 0 };
        }
        if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
          return { stdout: "true\n", stderr: "", code: 0 };
        }
        if (cmd === "git" && args[0] === "branch") {
          return { stdout: "feature/x\n", stderr: "", code: 0 };
        }
        if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
          return { stdout: "origin/feature/x\n", stderr: "", code: 0 };
        }
        if (cmd === "gh" && args[0] === "--version") {
          return { stdout: "gh version 2.40.0", stderr: "", code: 0 };
        }
        if (cmd === "gh" && args[0] === "auth") {
          return { stdout: "", stderr: "Logged in to github.com", code: 0 };
        }
        return { stdout: "", stderr: "", code: 1 };
      },
      fetchFn: async () => new Response("{}", { status: 401 }),
    });

    const or = summary.checks.find((c) => c.id === "openrouter");
    assert.equal(or?.status, "fail");
    assert.match(or?.detail || "", /401/);
  });
});