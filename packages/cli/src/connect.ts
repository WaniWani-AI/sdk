/**
 * `waniwani connect`: link an app folder to an agent on the platform, creating
 * the agent if it does not exist yet, and write the link into `waniwani.json`.
 */

import { type Platform, PlatformError } from "./client.js";
import { listOrgs, pickOrg, switchOrg } from "./orgs.js";
import { PROJECT_FILE, writeLink } from "./project.js";
import { askOne, askText, bold, dim, green, task, yellow } from "./ui.js";

/** An agent, as the platform calls it in its API: an MCP project. */
export interface Agent {
	id: string;
	name: string;
	/** `managed`: Waniwani hosts the repo and deploys it. `external`: the developer hosts the server. */
	hosting: "managed" | "external";
}

interface CreatedAgent extends Agent {
	repository?: { githubRepo?: string };
	vercelKeySyncFailed?: boolean;
	/** Returned once, for an external agent. */
	productionApiKey?: string | null;
}

const NEW_MANAGED = "__new_managed__";
const NEW_EXTERNAL = "__new_external__";

export function listAgents(platform: Platform): Promise<Agent[]> {
	return platform.get<Agent[]>("/api/mcp/projects");
}

async function createAgent(platform: Platform, hosting: Agent["hosting"]): Promise<Agent> {
	const name = await askText(`Name of the new ${hosting} agent`, "", (value) =>
		value?.trim() ? undefined : "a name is required",
	);
	const url =
		hosting === "external" ? await askText("Production URL of your MCP server (optional)", "") : "";

	const progress = task(
		hosting === "managed"
			? "Creating the GitHub repo and the Vercel project"
			: "Creating the agent",
	);
	let agent: CreatedAgent;
	try {
		agent = await platform.post<CreatedAgent>("/api/mcp/projects", {
			name: name.trim(),
			hosting,
			...(url.trim() ? { url: url.trim() } : {}),
		});
	} catch (error) {
		progress.failed("Could not create the agent");
		throw error;
	}
	progress.done(`Created ${bold(agent.name)}`);

	if (agent.repository?.githubRepo) {
		console.log(
			`  ${dim("repo")}     ${green(`https://github.com/${agent.repository.githubRepo}`)}`,
		);
	}
	if (agent.vercelKeySyncFailed) {
		console.log(
			`  ${yellow("!")} the API key did not reach Vercel — check the agent's settings before deploying`,
		);
	}
	if (agent.productionApiKey) {
		console.log(`\n  ${bold("Production API key")} ${dim("(shown once, save it now)")}`);
		console.log(`  ${green(agent.productionApiKey)}`);
		console.log(`  ${dim("set it as WANIWANI_API_KEY where your server runs")}\n`);
	}
	return agent;
}

async function pickAgent(platform: Platform): Promise<Agent> {
	const agents = await listAgents(platform);
	const choice = await askOne("Agent", [
		...agents.map((agent) => ({ value: agent.id, label: agent.name, hint: agent.hosting })),
		{ value: NEW_MANAGED, label: "New managed agent", hint: "Waniwani hosts the repo" },
		{ value: NEW_EXTERNAL, label: "New external agent", hint: "you host the server" },
	]);
	if (choice === NEW_MANAGED) return createAgent(platform, "managed");
	if (choice === NEW_EXTERNAL) return createAgent(platform, "external");
	return agents.find((agent) => agent.id === choice) as Agent;
}

/**
 * Ask for the org and the agent, then write the link. Assumes a live session.
 * Prints what it wrote and nothing about what to do next: `connect` and `dev`
 * each say that their own way.
 */
export async function connect(platform: Platform): Promise<Agent> {
	const orgs = await listOrgs(platform);
	const org = await pickOrg(orgs);
	if (org.id !== orgs.activeOrgId) {
		await switchOrg(platform, org.id);
	}
	console.log(`${dim("organization")} ${org.name}`);

	const agent = await pickAgent(platform);
	const result = writeLink(platform.root, { orgId: org.id, projectId: agent.id });
	console.log(
		`${green("✓")} ${result === "unchanged" ? `${PROJECT_FILE} already links` : `${PROJECT_FILE} ${result}, linking`} ${bold(agent.name)} ${dim(`(${agent.hosting})`)}`,
	);
	return agent;
}

/** The agent `waniwani.json` names, or null when the platform has no agent with that ID. */
export async function findAgent(platform: Platform, projectId: string): Promise<Agent | null> {
	try {
		return (await listAgents(platform)).find((agent) => agent.id === projectId) ?? null;
	} catch (error) {
		if (error instanceof PlatformError && error.status === 404) return null;
		throw error;
	}
}
