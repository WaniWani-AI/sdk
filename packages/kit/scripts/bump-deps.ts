#!/usr/bin/env bun
/**
 * Propose the three bumps nothing else proposes.
 *
 *   bun scripts/bump-deps.ts            # report what has moved
 *   bun scripts/bump-deps.ts --write     # rewrite the pins
 *
 * Dependabot covers the npm half of `packages/kit/package.json` and cannot
 * cover any of this. The template is a commit in `cli/template-pin.ts`, which
 * it does not read; the framework and the SDK are
 * exact versions this package declares *on behalf of every generated app*,
 * which makes a bump a generator decision rather than a dependency update; and
 * a bump to any of the three is only trustworthy once an app has been generated,
 * built, served and ejected against it, which is `template-contract.ts`.
 *
 * So: this reports what has moved, `--write` puts it in the working tree, and
 * `.github/workflows/bump-deps.yml` runs the contract over the result and opens
 * one pull request carrying both. What lands is a reviewed diff with a green
 * build behind it.
 *
 * Nothing here bumps `@waniwani/kit` itself. That is `release.ts`, and it is
 * the release of this package that carries a bump to customers.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bold, dim, green, yellow } from "../packages/kit/cli/log.js";
import { compareVersions, floorVersion } from "../packages/kit/cli/peers.js";
import { TEMPLATE_PIN } from "../packages/kit/cli/template-pin.js";
import type { DependencyField, PackageManifest } from "../packages/kit/cli/types.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO_ROOT, "packages/kit/package.json");
const PIN_MODULE = join(REPO_ROOT, "packages/kit/cli/template-pin.ts");

/**
 * Every manifest field this script writes into.
 *
 * Wider than `DependencyField`, because the SDK floor lives in
 * `peerDependencies` and is the one bump here that is not a dependency range.
 */
type ManifestField = DependencyField | "peerDependencies";

/** A pin this script maintains, and where in the manifest it is declared. */
interface PinnedPackage {
	name: string;
	field: DependencyField;
	exact: boolean;
}

/** One bump to propose: an npm range in the manifest, or the template commit. */
type Change =
	| { kind: "npm"; name: string; field: ManifestField; from: string; to: string }
	| { kind: "template"; name: string; from: string; to: string };

const write = process.argv.includes("--write");

/**
 * The packages this kit pins on every app's behalf, and the field each one is
 * declared in. Deliberately not "everything in the manifest": a range this
 * package keeps to itself (`vite`, the `@types` set) is Dependabot's business,
 * and bumping it does not change what an app installs.
 */
const PINNED_PACKAGES: PinnedPackage[] = [
	{ name: "skybridge", field: "dependencies", exact: true },
	{ name: "@skybridge/devtools", field: "devDependencies", exact: true },
];

/**
 * `@waniwani/sdk` is deliberately not in the list above.
 *
 * It is a peer range rather than a pin, and a peer range is a floor: raising it
 * to whatever npm calls latest would push every app that installs the kit onto
 * the newest SDK, which is the opposite of what a floor is for. A stale floor
 * is not a defect either — an app free to install 0.19.8 while the floor says
 * 0.19.5 is an app that already has what it needs.
 *
 * The floor moves for one reason this script can check: the template started
 * needing more than it says. So that is what gets checked, against the template
 * this kit pins rather than against the registry. See `sdkFloor` below.
 *
 * It also moves by hand, for the reason no script can see: a version below the
 * floor is broken in a way an app cannot fix from its own code. 0.25.0 is the
 * standing example. Before it a flow keeps only the answers to questions it has
 * already asked, so everything the user says up front is dropped and asked
 * again; 0.25.0 lists every state field on the first question and writes any
 * value that fits its schema, and it adds `neverPrefilled()` so a consent or a
 * widget pick still has to come from its own question. Before 0.24.0 a flow
 * tool lists its whole state schema under
 * `stateUpdates`, so a reviewer reads every field (ID numbers, claims, internal
 * ids) and the model can write any of them, including fields a node computes;
 * 0.24.0 lists an untyped `stateUpdates` and merges only the fields the run has
 * asked for. On 0.22.x every wrapped tool also asks the model for a nested
 * `telemetry` object after each user message, which OpenAI's plugin guidelines
 * rule out (no broad contextual fields, no accumulated conversation context);
 * 0.23.0 asks for one brief `intent` string on the first call instead. Below
 * 0.22.1 a flow the kit registers from its compiled `config` also carries no
 * flow graph, so `withWaniwani` syncs no funnel for it, and below 0.21.1 every
 * flow ships an execution protocol inside its MCP tool description, which
 * ChatGPT's approval card flags as a suspicious instruction. A hand-raised
 * floor stays raised; this script never lowers one.
 */
const SDK = "@waniwani/sdk";

const npmLatest = (name: string): string =>
	execFileSync("npm", ["view", `${name}@latest`, "version"], { encoding: "utf-8" }).trim();

const { owner, repo, branch } = TEMPLATE_PIN;

async function branchHead(): Promise<string> {
	const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, {
		headers: { Accept: "application/vnd.github.sha" },
	});
	if (!response.ok) {
		throw new Error(`GitHub returned ${response.status} for ${owner}/${repo}@${branch}`);
	}
	return (await response.text()).trim();
}

/**
 * Whether the pinned commit is on the branch it claims to come from.
 *
 * `DEFAULT_TEMPLATE` accepts any 40-character SHA, and the comparison below
 * only asks whether the pin differs from the branch head. Without this, a
 * commit taken off a feature branch, or off a branch this stopped tracking,
 * resolves and builds and is never questioned, and the first bump swaps the
 * template for an unrelated tree.
 *
 * `compare/base...head` answers `identical` when the two are the same commit
 * and `ahead` when `head` descends from `base`. `behind` and `diverged` both
 * mean the pin is not on the branch.
 */
async function pinIsOnBranch(pin: string, head: string): Promise<boolean> {
	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/compare/${pin}...${head}`,
		{ headers: { Accept: "application/vnd.github+json" } },
	);
	if (!response.ok) {
		throw new Error(
			`GitHub returned ${response.status} comparing ${pin.slice(0, 7)}...${head.slice(0, 7)} in ${owner}/${repo}`,
		);
	}
	const { status } = (await response.json()) as { status?: string };
	return status === "identical" || status === "ahead";
}

// ------------------------------------------------------------------- versions

const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as PackageManifest;
const changes: Change[] = [];
/** Prerelease pins, reported rather than bumped. */
const held: { name: string; version: string }[] = [];

for (const { name, field, exact } of PINNED_PACKAGES) {
	const current = manifest[field]?.[name];
	if (!current) continue;

	// A prerelease pinned by hand is someone testing an unreleased version on
	// purpose. `npm view @latest` reports the newest *stable*, so proposing it
	// here would be proposing a downgrade off the thing under test — and a
	// prerelease does not satisfy a caret range anyway, so nothing else would
	// notice. Left alone, and said out loud so it is not mistaken for current.
	if (current.includes("-")) {
		held.push({ name, version: current });
		continue;
	}

	const latest = npmLatest(name);
	// An exact pin is compared literally. A caret range is left alone whenever
	// the newest version already satisfies it: `^0.19.5` covering `0.19.8` means
	// an app installing today already gets `0.19.8`, so rewriting the floor
	// would be a diff with no effect on anything anyone installs.
	const wanted = exact ? latest : `^${latest}`;
	const satisfied = exact ? current === latest : current === wanted || satisfies(latest, current);
	if (satisfied) continue;
	changes.push({ kind: "npm", name, field, from: current, to: wanted });
}

/**
 * Whether `version` falls inside a caret range, for the 0.x rule that matters
 * here: under semver a `^0.19.5` range stops at `0.20.0`, so an SDK minor is a
 * breaking change and has to come through a deliberate bump.
 */
function satisfies(version: string, range: string): boolean {
	if (!range.startsWith("^")) return version === range;
	const [major, minor] = range.slice(1).split(".").map(Number) as [number, number];
	const [vMajor, vMinor, vPatch] = version.split(".").map(Number) as [number, number, number];
	if (major !== vMajor) return false;
	// `^0.x` is locked to that minor; `^1.x` and up allow any higher minor.
	if (major === 0) return minor === vMinor && vPatch >= Number(range.slice(1).split(".")[2]);
	return vMinor >= minor;
}

// ------------------------------------------------------------------- template

const pinnedSha = TEMPLATE_PIN.commit;
if (!/^[0-9a-f]{40}$/.test(pinnedSha)) {
	throw new Error(
		`TEMPLATE_PIN.commit in ${PIN_MODULE} is not a 40-character SHA, so there is nothing here to bump`,
	);
}

const head = await branchHead();
if (head !== pinnedSha && !(await pinIsOnBranch(pinnedSha, head))) {
	throw new Error(
		`the pinned template commit ${pinnedSha.slice(0, 7)} is not on ${branch} in ${owner}/${repo}. ` +
			`Either TEMPLATE_PIN.branch names the wrong branch, or the pin was taken off another one — ` +
			"bumping from here would replace the template with a tree it shares no history with.",
	);
}
if (head !== pinnedSha) {
	changes.push({ kind: "template", name: "template", from: pinnedSha, to: head });
}

// --------------------------------------------------------------------- sdk floor

/**
 * The SDK range the template declares at a given commit.
 *
 * Read over raw.githubusercontent rather than by downloading the template,
 * because one file answers the question and this script has no other reason to
 * put a tree on disk.
 */
async function templateSdkRange(sha: string): Promise<string | undefined> {
	const response = await fetch(
		`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/package.json`,
	);
	if (!response.ok) {
		throw new Error(`GitHub returned ${response.status} for the template's package.json at ${sha}`);
	}
	const manifest = (await response.json()) as PackageManifest;
	return manifest.dependencies?.[SDK] ?? manifest.peerDependencies?.[SDK];
}

/**
 * Whether the kit's SDK floor still covers what the template asks for.
 *
 * Checked against the commit that is about to be pinned, not the one currently
 * pinned: a template bump and the floor it needs belong in the same diff, and
 * the contract run behind that diff is what proves the pair.
 */
const targetSha = changes.find((change) => change.kind === "template")?.to ?? pinnedSha;
const templateRange = await templateSdkRange(targetSha);
const declaredFloor = floorVersion(manifest.peerDependencies?.[SDK]);
const templateFloor = floorVersion(templateRange);

if (!declaredFloor) {
	throw new Error(
		`@waniwani/kit declares no parseable peerDependencies.${SDK} — the floor this script maintains is gone`,
	);
}
// A prerelease floor is a temporary state waiting on someone else's release,
// and the report is the only place a maintainer would notice it is still there.
// Same treatment as a prerelease pin, for the same reason.
const declaredRange = manifest.peerDependencies?.[SDK] as string;
if (declaredRange.includes("-")) {
	held.push({ name: `${SDK} (floor)`, version: declaredRange });
}

if (templateFloor && compareVersions(templateFloor, declaredFloor) === 1) {
	changes.push({
		kind: "npm",
		name: SDK,
		field: "peerDependencies",
		from: declaredRange,
		to: `>=${templateFloor}`,
	});
}

// --------------------------------------------------------------------- report

for (const { name, version } of held) {
	console.log(yellow(`held  ${name} ${version} — a prerelease, pinned by hand`));
}

if (changes.length === 0) {
	console.log(green("✓ every other pin is current"));
	process.exit(0);
}

console.log(bold(`${changes.length} pin${changes.length === 1 ? "" : "s"} behind:\n`));
for (const change of changes) {
	const from = change.kind === "template" ? change.from.slice(0, 7) : change.from;
	const to = change.kind === "template" ? change.to.slice(0, 7) : change.to;
	console.log(`  ${change.name}  ${dim(`${from} → ${to}`)}`);
}

if (!write) {
	// A hint for someone at a terminal. The bump workflow quotes this report
	// verbatim into a pull request body, where advice on which flag to pass next
	// is noise addressed to nobody.
	if (process.stdout.isTTY) {
		console.log(
			`\n${dim("run with --write to apply, then scripts/template-contract.ts to prove it")}`,
		);
	}
	process.exit(0);
}

for (const change of changes) {
	if (change.kind === "template") {
		const source = readFileSync(PIN_MODULE, "utf-8");
		const rewritten = source.replace(`commit: "${change.from}"`, `commit: "${change.to}"`);
		// The record is the one thing here written by pattern rather than by
		// parsing, so an edit that matched nothing has to be an error: silently
		// leaving the old pin would produce a green bump PR that bumps nothing.
		if (rewritten === source) {
			throw new Error(`no \`commit: "${change.from}"\` line in ${PIN_MODULE} to rewrite`);
		}
		writeFileSync(PIN_MODULE, rewritten);
		continue;
	}
	(manifest[change.field] as Record<string, string>)[change.name] = change.to;
}

if (changes.some((change) => change.kind === "npm")) {
	writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`\n${green("✓ written")}`);
console.log(
	yellow(
		"the lockfile still describes the old tree — run `bun install`, then " +
			"`bun scripts/template-contract.ts` before committing",
	),
);
