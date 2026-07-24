// Minimal ambient declaration for the slice of `skybridge/web` the skybridge
// adapter (`skybridge.ts`) consumes. skybridge is an optional peer dependency
// resolved in the consumer app; declaring only what we use lets the SDK
// typecheck and build without installing skybridge and its dependency tree.
//
// This file is not emitted to `dist` — the generated `skybridge.d.ts` keeps the
// `skybridge/web` import external, so consumers resolve the real skybridge types.
declare module "skybridge/web" {
	export function useToolInfo(): {
		responseMetadata?: Record<string, unknown> | null;
	};
}
