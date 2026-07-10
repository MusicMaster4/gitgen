/**
 * Sanitize a git branch name: normalize accents (ç→c, á→a), spaces/underscores →
 * hyphens, remove invalid characters. Safe on Windows and macOS (Unicode NFD).
 */
export function sanitizeBranchName(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9\-/.]+/g, "")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .replace(/^\/+|\/+$/g, "");
}