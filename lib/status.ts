/**
 * Pure parsers for `gg status` — porcelain status and ahead/behind counts.
 * No IO here so everything is unit-testable on any OS.
 */

export type StatusEntry = {
  /** Two-char porcelain XY code (e.g. "M ", " M", "??", "UU"). */
  code: string;
  path: string;
};

export type StatusSummary = {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  entries: StatusEntry[];
};

/** Parse `git status --porcelain -u` output into counts + entries. */
export function parsePorcelainStatus(raw: string): StatusSummary {
  const summary: StatusSummary = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    entries: [],
  };
  for (const line of raw.split("\n")) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (!path) continue;
    summary.entries.push({ code, path });
    if (code === "??") {
      summary.untracked++;
      continue;
    }
    const [x, y] = [code[0], code[1]];
    // Merge conflicts: any U, or both-added / both-deleted.
    if (x === "U" || y === "U" || code === "AA" || code === "DD") {
      summary.conflicted++;
      continue;
    }
    if (x !== " ") summary.staged++;
    if (y !== " ") summary.unstaged++;
  }
  return summary;
}

/**
 * Parse `git rev-list --left-right --count <upstream>...HEAD` output
 * ("<behind>\t<ahead>"). Returns null when unparseable (e.g. no upstream).
 */
export function parseAheadBehind(raw: string): { ahead: number; behind: number } | null {
  const m = raw.trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return null;
  return { behind: parseInt(m[1], 10), ahead: parseInt(m[2], 10) };
}

/** Human label for a porcelain XY code, for the file list. */
export function describeStatusCode(code: string): string {
  if (code === "??") return "untracked";
  if (code[0] === "U" || code[1] === "U" || code === "AA" || code === "DD") return "conflict";
  const map: Record<string, string> = {
    M: "modified",
    A: "added",
    D: "deleted",
    R: "renamed",
    C: "copied",
    T: "type",
  };
  const key = code[0] !== " " ? code[0] : code[1];
  return map[key] || "changed";
}
