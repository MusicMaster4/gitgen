/**
 * CLI argument helpers for the commit/push/PR token grammar.
 * Extracted from scripts/cli.ts so they can be unit-tested (importing the CLI
 * entrypoint would run main()).
 */

/** Commands whose very name means "…and push" (no separate push token needed). */
export const PUSH_ALIASES = new Set(["cnp"]);

export function isPrToken(t: string | undefined): boolean {
  const v = (t || "").toLowerCase();
  return v === "pr" || v === "pull" || v === "pull-request";
}

export function isPushToken(t: string | undefined): boolean {
  const v = (t || "").toLowerCase();
  return v === "push" || v === "p";
}

export interface CommitPrArgs {
  push: boolean;
  wantPr: boolean;
  prBase?: string;
}

/**
 * After a commit/push command, detect trailing `pr [base]`.
 * Examples: cnp pr · cnp pr develop · commit push pr · commit pr main
 */
export function parseCommitPrArgs(
  raw: string,
  a1: string | undefined,
  a2: string | undefined,
  a3: string | undefined
): CommitPrArgs {
  const pushByAlias = PUSH_ALIASES.has(raw);
  // cnp [pr [base]]
  if (pushByAlias) {
    if (isPrToken(a1)) return { push: true, wantPr: true, prBase: a2 };
    return { push: true, wantPr: false };
  }
  // commit push pr [base]  |  commit p pr [base]
  if (isPushToken(a1)) {
    if (isPrToken(a2)) return { push: true, wantPr: true, prBase: a3 };
    return { push: true, wantPr: false };
  }
  // commit pr [base]  (implies push — you can't open a remote PR without push)
  if (isPrToken(a1)) return { push: true, wantPr: true, prBase: a2 };
  return { push: false, wantPr: false };
}
