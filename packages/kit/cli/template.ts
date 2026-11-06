/**
 * Resolve the distribution template.
 *
 * The template is a separate public repo, consumed as-is. Nothing is forked
 * into this package: the generator downloads the repo at a pinned commit,
 * caches it, and copies the plumbing out of it. What ships to customers is the
 * same tree anyone can read on GitHub, clone, and deploy by hand.
 *
 * Sources:
 *   github:OWNER/REPO#REF   a GitHub repo at a branch, tag, or SHA (default)
 *   /path/to/checkout       a local clone, for working on the template itself
 *
 * Override per command with `--template <source>` or `WANIWANI_TEMPLATE`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TEMPLATE_PIN } from "./template-pin.js";
import type { Template } from "./types.js";

/** The parts of a `github:owner/repo#ref` specifier. */
interface GithubSource {
	owner: string;
	repo: string;
	ref: string;
}

/** A network failure, which a cached template is a reasonable answer to. */
interface OfflineError extends Error {
	offline?: boolean;
}

/**
 * A commit, not a branch.
 *
 * A published version of this package is frozen, and what it generates has to
 * be frozen with it. A branch ref is re-resolved on the customer's machine at
 * every command, so a push to the template would change the output of every
 * installed copy, and the assertions that catch a layout move (`REQUIRED` and
 * `assertSeam` in `./codegen.js`) would fire in a customer's terminal. Pinning
 * a commit moves that failure into this repo's CI, where
 * `scripts/template-contract.ts` builds a real app against the pin before a
 * release goes out.
 *
 * The commit and the branch it comes from are `./template-pin.js`, which
 * `scripts/bump-deps.ts` owns: it proposes the head of `TEMPLATE_PIN.branch`
 * and refuses a pin that is not an ancestor of it. A bump reaches customers
 * only through a release of this package, and the pin and the generator that
 * reads the template move in one diff with a contract run behind it. An
 * annotated tag can replace the SHA whenever the template grows one, with no
 * change to the resolver.
 *
 * Working on the template itself does not need a release: pass `--template` or
 * set `WANIWANI_TEMPLATE` to a branch ref or a local checkout.
 */
export const DEFAULT_TEMPLATE = `github:${TEMPLATE_PIN.owner}/${TEMPLATE_PIN.repo}#${TEMPLATE_PIN.commit}`;

const CACHE_ROOT = join(homedir(), ".cache", "waniwani", "templates");

/** `github:owner/repo#ref` -> its parts. */
function parseGithub(source: string): GithubSource | null {
	const match = /^github:([^/]+)\/([^#]+)(?:#(.+))?$/.exec(source);
	if (!match) return null;
	return { owner: match[1] as string, repo: match[2] as string, ref: match[3] ?? "main" };
}

/** A full commit SHA, which is already the thing a ref has to be resolved to. */
function isSha(ref: string): boolean {
	return /^[0-9a-f]{40}$/i.test(ref);
}

/**
 * Resolve a ref to a commit SHA, so a cache entry is content-addressed and two
 * builds of the same ref cannot silently differ.
 */
async function resolveSha({ owner, repo, ref }: GithubSource): Promise<string> {
	// The pinned default is a commit, and asking the API to resolve a commit to
	// itself is a round trip that can rate-limit, fail, or go down. A cached
	// pin then needs no network at all, which is the point of pinning.
	if (isSha(ref)) return ref.toLowerCase();

	let response: Response;
	try {
		response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`, {
			headers: { Accept: "application/vnd.github.sha" },
		});
	} catch (cause) {
		// Unreachable network. A cached template is a reasonable answer.
		const reason = cause instanceof Error ? cause.message : String(cause);
		throw Object.assign(new Error(`cannot reach GitHub: ${reason}`), { offline: true });
	}

	// A bad ref is the caller's mistake, not a network problem — falling back
	// to a cached template here would hide the typo.
	if (!response.ok) {
		throw new Error(
			`GitHub returned ${response.status} for ${owner}/${repo}@${ref}` +
				(response.status === 404 ? " — check the repo name and ref, or that it is public" : ""),
		);
	}
	return (await response.text()).trim();
}

async function download(
	{ owner, repo, sha }: { owner: string; repo: string; sha: string },
	destination: string,
): Promise<void> {
	const response = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${sha}`);
	if (!response.ok) {
		throw new Error(`could not download ${owner}/${repo}@${sha}: ${response.status}`);
	}

	const archive = join(tmpdir(), `waniwani-template-${sha}.tar.gz`);
	writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

	// Extract into a staging directory first, so an interrupted run cannot
	// leave a half-populated cache entry that later builds would trust.
	const staging = `${destination}.partial`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });

	const result = spawnSync("tar", ["-xzf", archive, "-C", staging, "--strip-components=1"]);
	rmSync(archive, { force: true });
	if (result.status !== 0) {
		rmSync(staging, { recursive: true, force: true });
		throw new Error(`could not extract the template archive: ${result.stderr?.toString().trim()}`);
	}

	rmSync(destination, { recursive: true, force: true });
	spawnSync("mv", [staging, destination]);
}

/** The newest cache entry for a repo, used when the network is unavailable. */
function newestCached(owner: string, repo: string): string | null {
	if (!existsSync(CACHE_ROOT)) return null;
	const prefix = `${owner}-${repo}-`;
	const entries = readdirSync(CACHE_ROOT)
		.filter((name) => name.startsWith(prefix))
		.map((name) => ({ name, mtime: statSync(join(CACHE_ROOT, name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	const newest = entries[0];
	return newest ? join(CACHE_ROOT, newest.name) : null;
}

/**
 * @param source `github:owner/repo#ref` or a local path
 */
export async function resolveTemplate(source: string = DEFAULT_TEMPLATE): Promise<Template> {
	const github = parseGithub(source);

	if (!github) {
		const dir = resolve(source);
		if (!existsSync(dir)) {
			throw new Error(`template not found: ${dir}`);
		}
		return { dir, source, local: true };
	}

	const { owner, repo, ref } = github;
	mkdirSync(CACHE_ROOT, { recursive: true });

	let sha: string;
	try {
		sha = await resolveSha(github);
	} catch (error) {
		const fallback = (error as OfflineError).offline ? newestCached(owner, repo) : null;
		if (!fallback) throw error;
		return {
			dir: fallback,
			source,
			ref,
			sha: fallback.split("-").pop(),
			cached: true,
			offline: true,
		};
	}

	const dir = join(CACHE_ROOT, `${owner}-${repo}-${sha}`);
	const cached = existsSync(dir);
	if (!cached) {
		await download({ owner, repo, sha }, dir);
	}

	return { dir, source, ref, sha, cached };
}

/** One-line description of what a build used, for logs and provenance files. */
export function describeTemplate(template: Template): string {
	if (template.local) return `${template.dir} (local)`;
	const state = template.offline ? "offline, cached" : template.cached ? "cached" : "downloaded";
	// A pinned source already carries the commit, so printing the source verbatim
	// would repeat all 40 characters of it next to the short form. Collapse to
	// the repo, and say that the commit came from a pin rather than a branch.
	const github = parseGithub(template.source);
	const pinned = github && isSha(github.ref);
	const origin = pinned ? `github:${github.owner}/${github.repo}` : template.source;
	return `${origin} @ ${template.sha?.slice(0, 7)} (${pinned ? `pinned, ${state}` : state})`;
}
