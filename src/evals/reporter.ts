import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseTaskOutput } from "./scorers";

type ReporterFn = (
	name: string,
	handlers: {
		reportEval(
			evaluator: unknown,
			result: {
				results: Array<{
					input: unknown;
					output: unknown;
					scores?: Record<string, number>;
				}>;
			},
		): boolean;
		reportRun(results: boolean[]): boolean;
	},
) => unknown;

/**
 * Create a local Braintrust reporter that writes JSON results to a directory and
 * prints a summary to console.
 *
 * Requires the `braintrust` package: bun add -d braintrust
 *
 * @param outputDir - Directory to write JSON result files (default: "evals/runs")
 */
export function createLocalReporter(outputDir = "evals/runs") {
	let Reporter: ReporterFn;
	try {
		Reporter = (require("braintrust") as { Reporter: ReporterFn }).Reporter;
	} catch {
		throw new Error(
			'Local reporter requires the "braintrust" package: bun add -d braintrust',
		);
	}

	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}

	return Reporter("local", {
		reportEval(
			evaluator: unknown,
			result: {
				results: Array<{
					input: unknown;
					output: unknown;
					scores?: Record<string, number>;
				}>;
			},
		) {
			const name =
				(evaluator as { experimentName?: string }).experimentName ?? "unknown";
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const rows = result.results.map((r) => {
				const scores = r.scores ?? {};
				const parsed = parseTaskOutput(r.output);
				return {
					input: r.input,
					output: parsed.output,
					toolsCalled: parsed.toolsCalled,
					toolCallTraces: parsed.toolCallTraces,
					scores,
				};
			});

			const outPath = `${outputDir}/${name}-${timestamp}.json`;
			writeFileSync(outPath, JSON.stringify(rows, null, 2));

			console.log(`\n📊 ${name} (${result.results.length} cases):\n`);

			let failures = 0;
			for (const r of result.results) {
				const scores = r.scores ?? {};
				const pass = scores.called_expected_tool === 1;
				if (!pass) {
					failures++;
				}

				console.log(
					`  ${pass ? "✅" : "❌"} ${(r.input as string).slice(0, 70)}`,
				);
				for (const [scoreName, value] of Object.entries(scores)) {
					console.log(`     ${scoreName}: ${value}`);
				}
			}

			console.log(
				`\n  ${result.results.length - failures}/${result.results.length} passed`,
			);
			console.log(`  → ${outPath}\n`);
			return failures === 0;
		},

		reportRun(results: boolean[]) {
			const allPassed = results.every((r) => r === true);
			console.log(
				allPassed
					? "\n✅ All experiments passed"
					: "\n❌ Some experiments failed",
			);
			return allPassed;
		},
	});
}
