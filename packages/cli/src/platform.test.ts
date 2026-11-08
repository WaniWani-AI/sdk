import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Platform } from "./client.js";
import { findOrg } from "./orgs.js";
import { readProject, writeLink } from "./project.js";
import { devScript } from "./script.js";
import { readSettings, settingsFile } from "./settings.js";

let dir: string;
let configHome: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "waniwani-platform-"));
	configHome = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = join(dir, "config");
});

afterEach(() => {
	if (configHome === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = configHome;
	rmSync(dir, { recursive: true, force: true });
});

describe("writeLink", () => {
	test("creates waniwani.json with the schema and the link", () => {
		expect(writeLink(dir, { orgId: "o1", projectId: "p1" })).toBe("created");
		expect(readProject(dir)).toEqual({
			$schema: "https://docs.waniwani.ai/waniwani.json",
			orgId: "o1",
			projectId: "p1",
		});
	});

	test("keeps the other keys and reports an unchanged file", () => {
		writeFileSync(join(dir, "waniwani.json"), JSON.stringify({ devPort: 4100, projectId: "old" }));
		expect(writeLink(dir, { orgId: "o1", projectId: "p1" })).toBe("updated");
		expect(readProject(dir)).toMatchObject({ devPort: 4100, orgId: "o1", projectId: "p1" });
		expect(writeLink(dir, { orgId: "o1", projectId: "p1" })).toBe("unchanged");
	});

	test("leaves the app's waniwani.config.ts alone", () => {
		const config = join(dir, "waniwani.config.ts");
		writeFileSync(config, "export default {};\n");
		writeLink(dir, { orgId: "o1", projectId: "p1" });
		expect(readFileSync(config, "utf8")).toBe("export default {};\n");
	});

	test("refuses an ID that is not letters, digits, - and _", () => {
		writeFileSync(join(dir, "waniwani.json"), JSON.stringify({ projectId: "p1&calc" }));
		expect(() => readProject(dir)).toThrow("projectId must be an ID");
	});

	test("refuses to overwrite a waniwani.json that does not parse", () => {
		writeFileSync(join(dir, "waniwani.json"), "{ not json");
		expect(() => writeLink(dir, { orgId: "o1", projectId: "p1" })).toThrow("not valid JSON");
	});
});

describe("readSettings", () => {
	test("moves a repo-local settings file into the config directory", () => {
		mkdirSync(join(dir, ".waniwani"));
		const legacy = join(dir, ".waniwani", "settings.json");
		writeFileSync(
			legacy,
			JSON.stringify({ apiUrl: "https://eu.app.waniwani.ai", accessToken: "t" }),
		);

		const settings = readSettings(dir);

		expect(settings.accessToken).toBe("t");
		expect(settings.apiUrl).toBe("https://eu.app.waniwani.ai");
		expect(existsSync(legacy)).toBe(false);
		expect(settingsFile().startsWith(join(dir, "config"))).toBe(true);
		expect(existsSync(settingsFile())).toBe(true);
	});

	test("reads a damaged file as logged out", () => {
		mkdirSync(join(dir, "config", "waniwani"), { recursive: true });
		writeFileSync(settingsFile(), "[1, 2");
		expect(readSettings(dir)).toMatchObject({ accessToken: null, region: null });
	});
});

describe("Platform.apiUrl", () => {
	let envUrl: string | undefined;
	beforeEach(() => {
		envUrl = process.env.WANIWANI_API_URL;
		delete process.env.WANIWANI_API_URL;
	});
	afterEach(() => {
		if (envUrl === undefined) delete process.env.WANIWANI_API_URL;
		else process.env.WANIWANI_API_URL = envUrl;
	});

	test("takes a Waniwani instance from waniwani.json", () => {
		writeFileSync(
			join(dir, "waniwani.json"),
			JSON.stringify({ apiUrl: "https://eu.app.waniwani.ai/" }),
		);
		expect(new Platform(dir, undefined).apiUrl()).toBe("https://eu.app.waniwani.ai");
	});

	test("ignores any other host in waniwani.json", () => {
		writeFileSync(join(dir, "waniwani.json"), JSON.stringify({ apiUrl: "https://evil.example" }));
		expect(new Platform(dir, undefined).apiUrl()).toBe("https://app.waniwani.ai");
	});

	test("takes a Waniwani instance from a .env file, and nothing else", () => {
		process.env.WANIWANI_API_URL = "https://eu.app.waniwani.ai";
		expect(new Platform(dir, undefined).apiUrl()).toBe("https://eu.app.waniwani.ai");
		process.env.WANIWANI_API_URL = "https://evil.example";
		expect(new Platform(dir, undefined).apiUrl()).toBe("https://app.waniwani.ai");
	});

	test("takes any host the shell set", () => {
		process.env.WANIWANI_API_URL = "https://evil.example";
		expect(new Platform(dir, "http://localhost:4555").apiUrl()).toBe("http://localhost:4555");
	});
});

describe("findOrg", () => {
	const orgs = [
		{ id: "o1", name: "Acme", slug: "acme" },
		{ id: "o2", name: "Acme", slug: "acme-eu" },
		{ id: "o3", name: "Beta Co", slug: "beta" },
	];

	test("matches an ID, a slug or a name, ignoring case", () => {
		expect(findOrg(orgs, "o3").slug).toBe("beta");
		expect(findOrg(orgs, "ACME-EU").id).toBe("o2");
		expect(findOrg(orgs, "beta co").id).toBe("o3");
	});

	test("refuses a name two orgs share, and a name no org has", () => {
		expect(() => findOrg(orgs, "acme corp")).toThrow("no organization matches");
		expect(() => findOrg(orgs, "Acme")).toThrow("more than one");
	});
});

describe("devScript", () => {
	test("is null without a dev script", () => {
		expect(devScript(dir)).toBeNull();
		writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
		expect(devScript(dir)).toBeNull();
	});

	test("ignores a dev script that runs waniwani, which would start this command again", () => {
		writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { dev: "waniwani dev" } }));
		expect(devScript(dir)).toBeNull();
		writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { dev: "npx waniwani" } }));
		expect(devScript(dir)).toBeNull();
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ scripts: { dev: "tsx waniwani-server.ts" } }),
		);
		expect(devScript(dir)).toEqual(["npm", ["run", "dev"]]);
	});

	test("runs the dev script with the package manager the lockfile names", () => {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ scripts: { dev: "node server.js" } }),
		);
		expect(devScript(dir)).toEqual(["npm", ["run", "dev"]]);
		writeFileSync(join(dir, "pnpm-lock.yaml"), "");
		expect(devScript(dir)).toEqual(["pnpm", ["run", "dev"]]);
	});
});
