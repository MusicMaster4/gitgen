import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["scripts/cli.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Shebang is applied by scripts/postbuild-cli.mjs (single #! line for npm bin).
  noExternal: [/.*/],
});
