import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// A type-only import survives into the emitted .d.ts, so the root graph must
// stay clear of both spellings, not just the value one.
const OPTIONAL_PEERS = ["zod", "ai"] as const;

const STATEMENT =
	/^[ \t]*(?:import|export)[ \t]+(?:type[ \t]+)?(?:[^;]*?from[ \t]*)?["']([^"']+)["']/gm;

function specifiers(source: string): string[] {
	const out: string[] = [];
	for (const match of source.matchAll(STATEMENT)) {
		if (match[1]) {
			out.push(match[1]);
		}
	}
	return out;
}

function reachableFrom(entry: string): Map<string, string[]> {
	const graph = new Map<string, string[]>();

	const walk = (file: string): void => {
		if (graph.has(file)) {
			return;
		}
		let source: string;
		try {
			source = readFileSync(file, "utf-8");
		} catch {
			return;
		}
		const specs = specifiers(source);
		graph.set(file, specs);
		for (const spec of specs) {
			if (!spec.startsWith(".")) {
				continue;
			}
			const base = resolve(dirname(file), spec.replace(/\.js$/, ""));
			for (const candidate of [
				`${base}.ts`,
				`${base}.tsx`,
				`${base}/index.ts`,
			]) {
				try {
					readFileSync(candidate, "utf-8");
					walk(candidate);
					break;
				} catch {}
			}
		}
	};

	walk(entry);
	return graph;
}

describe("package root keeps the optional peers out of its whole graph", () => {
	test("no module reachable from src/index.ts names zod or ai, type imports included", () => {
		const graph = reachableFrom(resolve(import.meta.dir, "..", "index.ts"));
		const offenders: string[] = [];

		for (const [file, specs] of graph) {
			for (const peer of OPTIONAL_PEERS) {
				if (specs.includes(peer)) {
					offenders.push(`${file.slice(file.indexOf("/src/") + 1)} → ${peer}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	test("the documents surface really is part of that graph", () => {
		const graph = reachableFrom(resolve(import.meta.dir, "..", "index.ts"));
		const files = [...graph.keys()].map((f) => f.slice(f.indexOf("/src/") + 1));

		expect(files).toContain("src/documents/messages.ts");
		expect(files).toContain("src/documents/types.ts");
	});
});

describe("entry points expose the document-message reader", () => {
	for (const entry of ["../index.js", "../documents/index.js"] as const) {
		test(`readAttachedDocuments is callable off ${entry}`, async () => {
			const module = await import(entry);

			expect(typeof module.readAttachedDocuments).toBe("function");
			expect(
				module.readAttachedDocuments({ documents: [{ documentId: "doc_1" }] }),
			).toHaveLength(1);
		});
	}
});
