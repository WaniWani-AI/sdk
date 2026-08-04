#!/usr/bin/env bun
// ============================================================================
// Vocabulary check — one word per concept in identifiers.
//
// Enforces the Vocabulary table in CLAUDE.md. Comments and string literals are
// stripped first, so prose is free to use the product's wording ("starter
// prompt", "the agent") while code stays on one term. JSX text is not stripped
// — it reads as code here, which is how user-visible copy gets checked too.
//
// Usage: check-vocabulary.ts [files...]   (no args = every source file)
// Escape hatch: `// vocab-ignore` on the line, for a deliberate exception.
// ============================================================================

interface Rule {
	/** The term that wins. */
	canonical: string;
	/** Identifiers that should have used `canonical`. */
	banned: RegExp[];
	/** Identifiers exempt because a shipped contract or vendor names them. */
	allow?: RegExp[];
	/** Paths exempt wholesale. */
	allowPaths?: RegExp[];
	why: string;
}

const RULES: Rule[] = [
	{
		canonical: "Suggestion",
		banned: [/starter/i, /^chips?$/i, /CTA/],
		why: "a clickable answer above the composer is a Suggestion",
	},
	{
		// Narrow on purpose. A model prompt (`systemPrompt`,
		// `formatModelContextForPrompt`) and the composer (`PromptInput`) are
		// different concepts that keep the word; this only catches `prompt` used
		// for suggestion data.
		canonical: "Suggestion / suggestionId",
		banned: [
			/(suggestion|starter|shown|picked|pill|flow|followup)[A-Za-z]*prompt/i,
			/prompt[A-Za-z]*(suggestion|pill)/i,
		],
		allow: [
			// Frozen wire formats: analytics queries these keys, the platform sends them.
			/^promptId$/,
			/^prompts$/,
			/^PagePrompt$/,
			/^PagePromptTier$/,
			/^pickPagePrompts$/,
		],
		why: "suggestion data is a Suggestion; only the shipped payload keys stay `prompt*`",
	},
	{
		canonical: "track",
		banned: [/^fire[A-Z]/, /^capture[A-Z]/, /^report[A-Z]/, /^logEvent/],
		allow: [/^captureBatch$/],
		allowPaths: [/__tests__/],
		why: "emitting an event is track*; post*/send* is the HTTP layer under it",
	},
	{
		canonical: "sessionId",
		banned: [/^conversationId$/],
		// The inbound alias list has to spell foreign hosts' key names.
		allowPaths: [/mcp\/server\/utils\.ts/, /__tests__/],
		why: "conversation identity is sessionId (threadId is a separate concept)",
	},
];

/** Blank out comments and string literals so only identifiers remain. */
function stripNonCode(src: string): string {
	let out = "";
	let i = 0;
	while (i < src.length) {
		const two = src.slice(i, i + 2);
		if (two === "//") {
			while (i < src.length && src[i] !== "\n") {
				out += " ";
				i++;
			}
		} else if (two === "/*") {
			while (i < src.length && src.slice(i, i + 2) !== "*/") {
				out += src[i] === "\n" ? "\n" : " ";
				i++;
			}
			out += "  ";
			i += 2;
		} else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
			const quote = src[i];
			out += " ";
			i++;
			while (i < src.length && src[i] !== quote) {
				if (src[i] === "\\") {
					out += "  ";
					i += 2;
					continue;
				}
				out += src[i] === "\n" ? "\n" : " ";
				i++;
			}
			out += " ";
			i++;
		} else {
			out += src[i];
			i++;
		}
	}
	return out;
}

interface Finding {
	file: string;
	line: number;
	identifier: string;
	rule: Rule;
}

function check(file: string, src: string): Finding[] {
	const findings: Finding[] = [];
	const rawLines = src.split("\n");
	const lines = stripNonCode(src).split("\n");

	lines.forEach((line, index) => {
		if (rawLines[index]?.includes("vocab-ignore")) {
			return;
		}
		const identifiers = line.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
		for (const id of identifiers) {
			for (const rule of RULES) {
				if (rule.allowPaths?.some((p) => p.test(file))) {
					continue;
				}
				if (rule.allow?.some((a) => a.test(id))) {
					continue;
				}
				if (rule.banned.some((b) => b.test(id))) {
					findings.push({ file, line: index + 1, identifier: id, rule });
				}
			}
		}
	});
	return findings;
}

const args = process.argv.slice(2);
const files = (
	args.length > 0
		? args
		: new Bun.Glob("src/**/*.{ts,tsx}").scanSync(".").toArray()
).filter((f) => /\.tsx?$/.test(f) && f.startsWith("src/"));

const findings: Finding[] = [];
for (const file of files) {
	const src = await Bun.file(file).text().catch(() => "");
	if (src) {
		findings.push(...check(file, src));
	}
}

if (findings.length === 0) {
	console.log(`vocabulary: clean (${files.length} files)`);
	process.exit(0);
}

const seen = new Set<string>();
console.error(`\nvocabulary: ${findings.length} identifier(s) off-glossary\n`);
for (const f of findings) {
	console.error(`  ${f.file}:${f.line}  ${f.identifier}  →  ${f.rule.canonical}`);
	if (!seen.has(f.rule.canonical)) {
		seen.add(f.rule.canonical);
		console.error(`      ${f.rule.why}`);
	}
}
console.error(
	"\nSee the Vocabulary table in CLAUDE.md. Deliberate exception? Add `// vocab-ignore`.\n",
);
process.exit(1);
