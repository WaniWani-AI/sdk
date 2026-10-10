/**
 * Live-model eval for flows: does a real assistant finish a flow without
 * asking the user for something they already said?
 *
 *   bun run eval:flows
 *   bun run eval:flows --sdk local,0.23.0 --models openai/gpt-6-luna,anthropic/claude-sonnet-5 --runs 5
 *
 * Calls real models through the AI Gateway (`AI_GATEWAY_API_KEY`), so every
 * run costs tokens. See `README.md` for the flags and how to read the table.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type RunResult, runConversation } from "./conversation";
import { loadEngine } from "./engine";
import { SCENARIOS } from "./fixtures";

const { values: flags } = parseArgs({
	options: {
		sdk: { type: "string", default: "local" },
		models: { type: "string", default: "openai/gpt-6-luna" },
		runs: { type: "string", default: "3" },
		steps: { type: "string", default: "5" },
		scenario: { type: "string" },
		concurrency: { type: "string", default: "4" },
		verbose: { type: "boolean", default: false },
	},
});

function list(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

async function pool<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

function transcript(result: RunResult): string {
	const lines: string[] = [];
	for (const turn of result.turns) {
		lines.push(`    user: ${turn.user}`);
		for (const call of turn.calls) {
			const updates = call.stateUpdates
				? ` ${JSON.stringify(call.stateUpdates)}`
				: "";
			const asks = call.asks.length ? ` [${call.asks.join(", ")}]` : "";
			const dropped = call.unasked.length
				? `  (not asked: ${call.unasked.join(", ")})`
				: "";
			const error = call.error ? ` ${call.error.slice(0, 160)}` : "";
			lines.push(
				`      -> ${call.action}${updates} <- ${call.status}${asks}${error}${dropped}`,
			);
		}
		const limit = turn.hitStepLimit ? " (step limit)" : "";
		lines.push(
			`    assistant${limit}: ${turn.assistant.replace(/\s+/g, " ").trim() || "(no text)"}`,
		);
		if (turn.knownPending.length) {
			lines.push(
				`      ! still waiting on what the user already said: ${turn.knownPending.join(", ")}`,
			);
		}
	}
	return lines.join("\n");
}

function table(rows: string[][]): string {
	const widths = rows[0]?.map((_, col) =>
		Math.max(...rows.map((row) => (row[col] ?? "").length)),
	);
	return rows
		.map((row) =>
			row.map((cell, col) => cell.padEnd(widths?.[col] ?? 0)).join("  "),
		)
		.join("\n");
}

function summarize(results: RunResult[]): string {
	const groups = new Map<string, RunResult[]>();
	for (const result of results) {
		const key = [result.sdk, result.model, result.scenario].join("\u0000");
		groups.set(key, [...(groups.get(key) ?? []), result]);
	}
	const rows = [
		[
			"sdk",
			"model",
			"scenario",
			"pass",
			"done",
			"user turns (ideal)",
			"waiting on known",
			"unasked keys",
			"step limit",
			"wrong",
			"computed",
			"tokens",
		],
	];
	for (const runs of groups.values()) {
		const first = runs[0];
		if (!first) {
			continue;
		}
		const sum = (pick: (r: RunResult) => number) =>
			runs.reduce((total, r) => total + pick(r), 0);
		const avgTurns = sum((r) => r.userTurns) / runs.length;
		rows.push([
			first.sdk,
			first.model,
			first.scenario,
			`${runs.filter((r) => r.pass).length}/${runs.length}`,
			`${runs.filter((r) => r.completed).length}/${runs.length}`,
			`${avgTurns.toFixed(1)} (${first.idealTurns})`,
			String(sum((r) => r.knownPending)),
			String(sum((r) => r.unaskedSent)),
			String(sum((r) => r.stepLimitTurns)),
			String(sum((r) => r.wrongValues.length)),
			String(sum((r) => r.computedProblems.length)),
			`${Math.round(sum((r) => r.tokens) / 1000)}k`,
		]);
	}
	return table(rows);
}

async function main() {
	if (!process.env.AI_GATEWAY_API_KEY) {
		console.error(
			"AI_GATEWAY_API_KEY is not set. Put it in .env at the repo root (gitignored) or export it.",
		);
		process.exit(1);
	}

	const sdks = list(flags.sdk);
	const models = list(flags.models);
	const runs = Number(flags.runs);
	const maxSteps = Number(flags.steps);
	const filters = list(flags.scenario);
	const scenarios = SCENARIOS.filter(
		(s) => filters.length === 0 || filters.some((f) => s.id.includes(f)),
	);

	const engines = await Promise.all(sdks.map(loadEngine));
	const jobs = engines.flatMap((engine) =>
		models.flatMap((model) =>
			scenarios.flatMap((scenario) =>
				Array.from({ length: runs }, (_, run) => ({
					engine,
					model,
					scenario,
					run,
				})),
			),
		),
	);

	console.log(
		`${jobs.length} conversations: sdk ${sdks.join(", ")} x ${models.join(", ")} x ${scenarios.length} scenarios x ${runs} runs, ${maxSteps} steps per turn\n`,
	);

	const results = await pool(jobs, Number(flags.concurrency), async (job) => {
		const result = await runConversation({ ...job, maxSteps });
		const verdict = result.error ? "ERROR" : result.pass ? "pass" : "FAIL";
		console.log(
			`${verdict.padEnd(5)} ${result.sdk} ${result.model} ${result.scenario} #${result.run + 1}: ${result.userTurns} user turns (ideal ${result.idealTurns}), ${result.knownPending} waits on known fields, ${result.stepLimitTurns} step-limit turns${result.error ? `, ${result.error}` : ""}`,
		);
		if (flags.verbose && !result.pass) {
			console.log(transcript(result));
		}
		return result;
	});

	console.log(`\n${summarize(results)}\n`);

	const dir = join(import.meta.dir, "results");
	mkdirSync(dir, { recursive: true });
	const file = join(
		dir,
		`${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
	);
	writeFileSync(
		file,
		JSON.stringify({ sdks, models, runs, maxSteps, results }, null, 2),
	);
	console.log(`Transcripts: ${file}`);
}

await main();
