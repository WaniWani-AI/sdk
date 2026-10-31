import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read as text: importing the chat would load React and the whole widget.
const chatIndex = readFileSync(
	resolve(import.meta.dir, "../../../chat/src/index.ts"),
	"utf-8",
);
const shim = readFileSync(resolve(import.meta.dir, "index.ts"), "utf-8");

function chatExports(): string[] {
	const names = new Set<string>();
	for (const [, block] of chatIndex.matchAll(
		/export\s+(?:type\s+)?\{([^}]*)\}/g,
	)) {
		for (const part of (block ?? "").split(",")) {
			const name = part
				.trim()
				.replace(/^type\s+/, "")
				.split(/\s+as\s+/)
				.pop();
			if (name) {
				names.add(name);
			}
		}
	}
	return [...names].sort();
}

describe("@waniwani/sdk/chat re-exports all of @waniwani/chat", () => {
	test("the chat entry exports the 26 names it had inside the SDK", () => {
		expect(chatExports()).toHaveLength(26);
	});

	for (const name of chatExports()) {
		test(`${name} is re-declared with a @deprecated notice`, () => {
			const declaration = new RegExp(
				`/\\*\\* @deprecated Import \`${name}\` from \`@waniwani/chat\`\\. \`@waniwani/sdk/chat\` is removed in 0\\.28\\.0\\. \\*/\\nexport (?:const|type) ${name}\\b`,
			);
			expect(declaration.test(shim)).toBe(true);
		});
	}
});
