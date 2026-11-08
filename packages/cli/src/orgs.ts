/**
 * Organizations, and which one the CLI session acts in.
 *
 * The binding is stored on the server, on the session's refresh token, so it
 * survives a refresh and an org switch in the web app leaves it alone. Only
 * `waniwani switch` (or picking another org in `connect`) moves it.
 */

import { type Platform, PlatformError } from "./client.js";
import { askOne, dim } from "./ui.js";

export interface Org {
	id: string;
	name: string;
	slug: string;
}

export interface OrgList {
	orgs: Org[];
	activeOrgId: string | null;
}

export function listOrgs(platform: Platform): Promise<OrgList> {
	return platform.get<OrgList>("/api/oauth/orgs");
}

/**
 * Record the org on the session without touching the tokens. The token in hand
 * keeps the org it was minted for, so this is for right after login, when that
 * org is already the one being bound.
 */
export async function bindOrg(platform: Platform, orgId: string): Promise<void> {
	await platform.post("/api/oauth/orgs/switch", { orgId });
}

/**
 * Bind another org and refresh, so the access token carries the new org from
 * the next request on.
 */
export async function switchOrg(platform: Platform, orgId: string): Promise<void> {
	await bindOrg(platform, orgId);
	if (!(await platform.refresh())) {
		throw new PlatformError(
			"switched organization, but the session could not be refreshed — run `waniwani login`",
		);
	}
}

/** An org named on the command line, by ID, slug or name, ignoring case. Never a guess. */
export function findOrg(orgs: Org[], needle: string): Org {
	const wanted = needle.trim().toLowerCase();
	const matches = orgs.filter((org) =>
		[org.id, org.slug, org.name].some((key) => key.toLowerCase() === wanted),
	);
	if (matches.length === 1) return matches[0] as Org;
	throw new PlatformError(
		matches.length === 0
			? `no organization matches "${needle}"`
			: `"${needle}" matches more than one organization — use the slug or the ID`,
	);
}

export async function pickOrg({ orgs, activeOrgId }: OrgList): Promise<Org> {
	if (orgs.length === 0) {
		throw new PlatformError("this account is not a member of any organization");
	}
	if (orgs.length === 1) return orgs[0] as Org;
	const id = await askOne(
		"Organization",
		orgs.map((org) => ({
			value: org.id,
			label: org.id === activeOrgId ? `${org.name} ${dim("(current)")}` : org.name,
			hint: org.slug,
		})),
		orgs.some((org) => org.id === activeOrgId) ? (activeOrgId as string) : undefined,
	);
	return orgs.find((org) => org.id === id) as Org;
}
