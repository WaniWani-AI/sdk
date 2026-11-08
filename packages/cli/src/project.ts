/**
 * `waniwani.json`: which org and which agent an app is linked to on the
 * Waniwani platform.
 *
 * `waniwani connect` writes it and `waniwani dev` reads it. It holds IDs only,
 * so it is safe to commit, and a teammate who clones the repo gets the same
 * link. Its schema is published at https://docs.waniwani.ai/waniwani.json.
 *
 * It is a separate file from `waniwani.config.ts`, which describes the app
 * itself and which nothing in this folder reads or writes.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PROJECT_FILE = "waniwani.json";

const SCHEMA_URL = "https://docs.waniwani.ai/waniwani.json";

export interface ProjectConfig {
	$schema?: string;
	/** Overrides the instance from `waniwani login`. `WANIWANI_API_URL` overrides both. */
	apiUrl?: string;
	orgId?: string;
	/** The agent `dev` tunnels to and opens the playground for. */
	projectId?: string;
	/** The first port `dev` tries when it links to the platform. */
	devPort?: number;
}

/**
 * The app's `waniwani.json`, or null when it has none.
 *
 * A file that does not parse is an error with the path in it rather than a
 * silent null: `dev` would otherwise run unlinked, and `connect` would replace
 * whatever the file held.
 */
export function readProject(root: string): ProjectConfig | null {
	const path = join(root, PROJECT_FILE);
	if (!existsSync(path)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`${PROJECT_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${PROJECT_FILE} must hold one JSON object`);
	}
	const config = parsed as ProjectConfig;
	// The IDs go into API paths and a URL handed to the browser, and the file can
	// come from a repo someone else wrote.
	for (const key of ["orgId", "projectId"] as const) {
		const value = config[key];
		if (value !== undefined && (typeof value !== "string" || !ID.test(value))) {
			throw new Error(`${PROJECT_FILE}: ${key} must be an ID (letters, digits, - and _)`);
		}
	}
	return config;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Write the link into `waniwani.json`, keeping every other key the file has.
 * Returns whether the file was created, changed, or already said this.
 */
export function writeLink(
	root: string,
	link: { orgId: string; projectId: string },
): "created" | "updated" | "unchanged" {
	const path = join(root, PROJECT_FILE);
	const existing = readProject(root);
	const { $schema, orgId: _orgId, projectId: _projectId, ...rest } = existing ?? {};
	const next = { $schema: $schema ?? SCHEMA_URL, ...rest, ...link };
	const source = `${JSON.stringify(next, null, 2)}\n`;
	if (existing && readFileSync(path, "utf8") === source) return "unchanged";
	writeFileSync(path, source);
	return existing ? "updated" : "created";
}
