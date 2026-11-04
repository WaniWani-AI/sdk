// Imports nothing, and is imported first, so its body is the first line the
// bundle runs: `bundleExecuted` measures the bundle's own start, and
// `secondSdkOnPage` sees the page before `embed.ts` installs our global.

export const bundleExecuted =
	typeof performance === "undefined" ? 0 : performance.now();

export const secondSdkOnPage =
	typeof window !== "undefined" &&
	Boolean((window as { WaniWani?: { chat?: unknown } }).WaniWani?.chat);
