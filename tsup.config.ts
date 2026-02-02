import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node20",
	dts: true,
	clean: true,
	shims: true,
	splitting: true,
	sourcemap: true,
	minify: true,
});
