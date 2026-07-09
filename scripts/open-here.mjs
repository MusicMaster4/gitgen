#!/usr/bin/env node
/**
 * Abre o Git Command Generator com a pasta atual (?path=).
 * Se o server estiver offline, sobe em outra janela e espera ficar pronto.
 *
 * Uso (de qualquer projeto):
 *   bun /caminho/para/git-command-generator/scripts/open-here.mjs
 *   node /caminho/para/git-command-generator/scripts/open-here.mjs
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const port = process.env.GCG_PORT || "2001";
const portNum = Number(port);
const timeoutSec = Number(process.env.GCG_TIMEOUT || 90);
const cwd = process.cwd();
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = `http://localhost:${port}/?path=${encodeURIComponent(cwd)}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function testPort(p) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: p });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function testServerReady(p) {
  if (!(await testPort(p))) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(2000) });
    void res;
    return true;
  } catch {
    return testPort(p);
  }
}

function openBrowser(target) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

function startServerWindow() {
  if (process.platform === "win32") {
    const title = `Git Command Generator - Server :${port}`;
    spawn(
      "cmd.exe",
      ["/k", `title ${title} && cd /d "${repoRoot}" && bun run dev`],
      { cwd: repoRoot, detached: true, stdio: "ignore" },
    ).unref();
    return;
  }
  // fallback: background process (sem janela dedicada em Unix)
  const child = spawn("bun", ["run", "dev"], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

console.log("Git Command Generator");
console.log(`  projeto : ${cwd}`);
console.log(`  app    : ${repoRoot}`);
console.log(`  url    : ${url}`);

if (await testServerReady(portNum)) {
  console.log(`  server : ja rodando na porta ${port}`);
} else {
  console.log("  server : offline — subindo (bun run dev)...");
  if (!existsSync(join(repoRoot, "package.json"))) {
    console.error(`Nao achei o app em: ${repoRoot}`);
    process.exit(1);
  }
  startServerWindow();
  console.log(`  server : aguardando porta ${port} (ate ${timeoutSec}s)...`);
  const deadline = Date.now() + timeoutSec * 1000;
  let ready = false;
  while (Date.now() < deadline) {
    if (await testServerReady(portNum)) {
      ready = true;
      break;
    }
    await sleep(500);
  }
  if (!ready) {
    console.error("  timeout: o server nao respondeu a tempo. Confira a janela do server.");
    process.exit(1);
  }
  console.log("  server : pronto");
}

console.log("  abrindo browser...");
openBrowser(url);
