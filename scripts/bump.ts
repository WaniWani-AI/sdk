/**
 * Bumps the package in the current folder, commits, tags and pushes. The tag
 * push starts .github/workflows/release.yml, which publishes that package.
 *
 * Run it through a package script, from the package folder:
 *   cd packages/sdk && bun run release:minor
 *
 * `npm version` alone cannot do this here: it only commits and tags when the
 * package sits at the git root, and the bump must also refresh bun.lock, which
 * records each workspace version (CI installs with --frozen-lockfile).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";

// The SDK keeps the `v*` tags it has always had, so the flow eval still finds
// its last release with `git describe --match 'v*'`.
const TAG_PREFIX: Record<string, string> = {
	"@waniwani/sdk": "v",
	"@waniwani/chat": "chat-v",
};

const BUMPS: Record<string, string[]> = {
	patch: ["patch"],
	minor: ["minor"],
	major: ["major"],
	beta: ["prerelease", "--preid", "beta"],
	alpha: ["prerelease", "--preid", "alpha"],
};

const bump = BUMPS[process.argv[2] ?? ""];
if (!bump) {
	console.error(`Usage: bun scripts/bump.ts <${Object.keys(BUMPS).join("|")}>`);
	process.exit(1);
}

const dir = process.cwd();
const readPackage = () =>
	JSON.parse(readFileSync(resolve(dir, "package.json"), "utf-8")) as {
		name: string;
		version: string;
	};

const prefix = TAG_PREFIX[readPackage().name];
if (prefix === undefined) {
	console.error(`${dir} is not a published package.`);
	process.exit(1);
}

if ((await $`git status --porcelain`.text()).trim() !== "") {
	console.error("The working tree is not clean. Commit or stash first.");
	process.exit(1);
}

await $`npm version ${bump} --no-git-tag-version --no-workspaces-update`.cwd(
	dir,
);
const { name, version } = readPackage();
const root = (await $`git rev-parse --show-toplevel`.text()).trim();
await $`bun install`.cwd(root);

const tag = `${prefix}${version}`;
const message = prefix === "v" ? version : `${name}@${version}`;
await $`git add package.json`.cwd(dir);
await $`git add bun.lock`.cwd(root);
await $`git commit -m ${message}`;
await $`git tag -a ${tag} -m ${message}`;
await $`git push --follow-tags`;

console.log(
	`Pushed ${tag}. The release workflow publishes ${name}@${version}.`,
);
