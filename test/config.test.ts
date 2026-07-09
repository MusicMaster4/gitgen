import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_OPENROUTER_MODEL,
  getConfigDir,
  getConfigPath,
  loadConfig,
  maskApiKey,
  parseConfigJson,
  resolveRuntimeSettings,
  saveConfig,
} from "../lib/config";

describe("getConfigDir / getConfigPath", () => {
  it("uses GITGEN_CONFIG_DIR when set", () => {
    const dir = getConfigDir({ GITGEN_CONFIG_DIR: "C:\\tmp\\my-gitgen" }, "win32");
    assert.equal(dir, "C:\\tmp\\my-gitgen");
    assert.equal(
      getConfigPath({ GITGEN_CONFIG_DIR: "C:\\tmp\\my-gitgen" }, "win32"),
      join("C:\\tmp\\my-gitgen", "config.json")
    );
  });

  it("uses APPDATA on win32", () => {
    const dir = getConfigDir({ APPDATA: "D:\\AppData\\Roaming" }, "win32");
    assert.equal(dir, join("D:\\AppData\\Roaming", "gitgen"));
  });

  it("uses XDG_CONFIG_HOME on linux", () => {
    const dir = getConfigDir({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }, "linux");
    assert.equal(dir, join("/xdg", "gitgen"));
  });

  it("falls back to ~/.config on linux", () => {
    const dir = getConfigDir({ HOME: "/home/u" }, "linux");
    assert.equal(dir, join("/home/u", ".config", "gitgen"));
  });

  it("uses Application Support on darwin", () => {
    const dir = getConfigDir({ HOME: "/Users/me" }, "darwin");
    assert.equal(dir, join("/Users/me", "Library", "Application Support", "gitgen"));
  });
});

describe("parseConfigJson / loadConfig / saveConfig", () => {
  it("parses valid JSON fields", () => {
    const c = parseConfigJson(
      JSON.stringify({
        openRouterApiKey: " sk-test ",
        model: " google/gemini-2.0-flash-001 ",
        language: "pt",
        extra: 1,
      })
    );
    assert.equal(c.openRouterApiKey, "sk-test");
    assert.equal(c.model, "google/gemini-2.0-flash-001");
    assert.equal(c.language, "pt");
  });

  it("returns empty object for invalid shapes", () => {
    assert.deepEqual(parseConfigJson("[]"), {});
    assert.deepEqual(parseConfigJson("null"), {});
  });

  it("round-trips save and load on a real temp path", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitgen-cfg-"));
    const path = join(dir, "config.json");
    try {
      saveConfig(
        {
          openRouterApiKey: "sk-or-v1-abc",
          model: "anthropic/claude-3.5-sonnet",
          language: "en",
        },
        path
      );
      const raw = readFileSync(path, "utf8");
      assert.match(raw, /sk-or-v1-abc/);
      const loaded = loadConfig(path);
      assert.equal(loaded.openRouterApiKey, "sk-or-v1-abc");
      assert.equal(loaded.model, "anthropic/claude-3.5-sonnet");
      assert.equal(loaded.language, "en");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loadConfig returns {} when file is missing", () => {
    assert.deepEqual(loadConfig(join(tmpdir(), "no-such-gitgen-config-xyz.json")), {});
  });

  it("defaults model when saving without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitgen-cfg-"));
    const path = join(dir, "config.json");
    try {
      saveConfig({ openRouterApiKey: "k" }, path);
      const loaded = loadConfig(path);
      assert.equal(loaded.model, DEFAULT_OPENROUTER_MODEL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("maskApiKey / resolveRuntimeSettings", () => {
  it("masks keys for display", () => {
    assert.equal(maskApiKey("sk-abcdefghij"), "sk-a…ghij");
    assert.equal(maskApiKey("short"), "****");
    assert.equal(maskApiKey(""), "(empty)");
  });

  it("prefers env over config file", () => {
    const r = resolveRuntimeSettings(
      {
        openRouterApiKey: "from-file",
        model: "file/model",
        language: "pt",
      },
      {
        OPENROUTER_API_KEY: "from-env",
        OPENROUTER_MODEL: "env/model",
        COMMIT_LANGUAGE: "en",
      }
    );
    assert.equal(r.apiKey, "from-env");
    assert.equal(r.model, "env/model");
    assert.equal(r.language, "en");
  });

  it("uses config when env is absent", () => {
    const r = resolveRuntimeSettings(
      { openRouterApiKey: "file-key", model: "file/m", language: "pt" },
      {}
    );
    assert.equal(r.apiKey, "file-key");
    assert.equal(r.model, "file/m");
    assert.equal(r.language, "pt");
  });

  it("defaults model and language", () => {
    const r = resolveRuntimeSettings({}, {});
    assert.equal(r.apiKey, "");
    assert.equal(r.model, DEFAULT_OPENROUTER_MODEL);
    assert.equal(r.language, "en");
  });
});
