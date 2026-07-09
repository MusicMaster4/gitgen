/**
 * Tiny, dependency-free ANSI styling for the CLI.
 * Respects NO_COLOR / FORCE_COLOR and falls back to plain text when the
 * output isn't a TTY (pipes, CI logs) so we never dump escape codes into files.
 * Safe to bundle into dist/cli.js (node builtins only).
 */
import process from "node:process";

type EnvLike = Record<string, string | undefined>;

/** Decide once whether ANSI color is safe to emit. */
export function colorEnabled(
  env: EnvLike = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY)
): boolean {
  // https://no-color.org — any non-empty value disables color.
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false") return true;
  if (env.TERM === "dumb") return false;
  // The .cmd/.ps1 launchers set GCG_TTY=1 when node can't self-report the TTY.
  return isTTY || env.GCG_TTY === "1";
}

const ON = colorEnabled();

const style = (open: number, close: number) => (s: string) =>
  ON ? `\x1b[${open}m${s}\x1b[${close}m` : s;

/** Named styles. Each is a no-op string passthrough when color is disabled. */
export const c = {
  bold: style(1, 22),
  dim: style(2, 22),
  italic: style(3, 23),
  underline: style(4, 24),
  red: style(31, 39),
  green: style(32, 39),
  yellow: style(33, 39),
  blue: style(34, 39),
  magenta: style(35, 39),
  cyan: style(36, 39),
  gray: style(90, 39),
};

/** Status glyphs — colored when possible, still readable when not. */
export const sym = {
  ok: c.green("✓"),
  fail: c.red("✗"),
  warn: c.yellow("!"),
  info: c.cyan("·"),
  bullet: c.dim("•"),
  arrow: c.dim("›"),
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI escapes — used for width math so colored lines truncate correctly. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Visible length ignoring ANSI escape codes. */
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

/**
 * A titled header rule, e.g.
 *   gitgen setup · OpenRouter
 *   ─────────────────────────
 */
export function header(title: string, width = 44): string {
  const rule = "─".repeat(Math.max(title.length, Math.min(width, 60)));
  return `\n  ${c.bold(c.cyan(title))}\n  ${c.dim(rule)}`;
}

/** Aligned `label : value` row for config/summary blocks. */
export function row(label: string, value: string, pad = 8): string {
  return `  ${c.dim(label.padEnd(pad))}${c.dim(":")} ${value}`;
}
