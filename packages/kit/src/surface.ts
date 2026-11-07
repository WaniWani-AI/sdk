/**
 * Surface selection: which subset of the manifest a deployment serves, picked
 * by `WANIWANI_SURFACE` from `config.surfaces`.
 */

import type { AppConfig, SurfaceConfig } from "./index.js";
import type { Manifest } from "./server.js";

export const SURFACE_ENV = "WANIWANI_SURFACE";

/**
 * The surface `WANIWANI_SURFACE` selects. Empty counts as unset (a copied
 * `.env.example` carries it blank); an undeclared name throws before any
 * server exists.
 */
export function resolveSurface(config: AppConfig): SurfaceConfig | undefined {
	const name = process.env[SURFACE_ENV];
	if (!name) return undefined;
	const surfaces = config.surfaces ?? {};
	const surface = Object.hasOwn(surfaces, name) ? surfaces[name] : undefined;
	if (!surface) {
		const declared = Object.keys(surfaces);
		throw new Error(
			`[waniwani] ${SURFACE_ENV}="${name}" names no surface in waniwani.config.ts` +
				(declared.length > 0
					? ` (declared: ${declared.join(", ")})`
					: " (the config declares no surfaces; unset the variable to serve the whole app)"),
		);
	}
	return surface;
}

/** Flows match on `flow.name` (the `createFlow` id), tools and widgets on their file name. */
export function narrow(manifest: Manifest, surface: SurfaceConfig): Manifest {
	const tools = new Set(surface.tools ?? []);
	const widgets = new Set(surface.widgets ?? []);
	const flows = new Set(surface.flows ?? []);
	return {
		...manifest,
		tools: manifest.tools.filter((t) => tools.has(t.name)),
		widgets: manifest.widgets.filter((w) => widgets.has(w.name)),
		flows: manifest.flows.filter((f) => flows.has(f.name)),
	};
}
