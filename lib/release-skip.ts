/**
 * Rules for skipping automated npm release on push to main.
 */

/**
 * Returns true when CI should NOT bump/publish for this commit message.
 * - Explicit marker: [skip release]
 * - Release bot commits: chore(release): … (anti-loop)
 * - Common CI skip tokens that also mean "no release"
 */
export function shouldSkipRelease(commitMessage: string): boolean {
  const msg = (commitMessage || "").trim();
  if (!msg) return false;
  const lower = msg.toLowerCase();
  if (lower.includes("[skip release]")) return true;
  if (lower.includes("[skip-release]")) return true;
  if (lower.includes("[no release]")) return true;
  // Anti-loop: commits created by the release workflow itself
  if (/^chore\(release\)/i.test(msg)) return true;
  if (lower.includes("[skip ci]") && lower.includes("release")) return true;
  return false;
}
