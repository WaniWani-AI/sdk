import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlatformError } from "./client.js";
import { runKit } from "./kit.js";

let dir: string;
let viaNpx: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "waniwani-kit-"));
	viaNpx = process.env.WANIWANI_INIT_VIA_NPX;
	delete process.env.WANIWANI_INIT_VIA_NPX;
});

afterEach(() => {
	if (viaNpx === undefined) delete process.env.WANIWANI_INIT_VIA_NPX;
	else process.env.WANIWANI_INIT_VIA_NPX = viaNpx;
	rmSync(dir, { recursive: true, force: true });
});

/** The tree `npx @waniwani/kit` installs: the kit and this package side by side. */
function npxInstall(): { self: string; ran: string } {
	const scope = join(dir, "cache", "node_modules", "@waniwani");
	const ran = join(dir, "ran");
	mkdirSync(join(scope, "kit", "dist"), { recursive: true });
	mkdirSync(join(scope, "cli", "dist"), { recursive: true });
	writeFileSync(
		join(scope, "kit", "package.json"),
		JSON.stringify({ bin: { waniwani: "dist/cli.js" } }),
	);
	writeFileSync(
		join(scope, "kit", "dist", "cli.js"),
		`require("node:fs").writeFileSync(${JSON.stringify(ran)}, process.argv.slice(2).join(" "));`,
	);
	writeFileSync(join(scope, "kit", "dist", "package.json"), JSON.stringify({ type: "commonjs" }));
	return { self: join(scope, "cli", "dist"), ran };
}

describe("runKit init", () => {
	test("in an empty folder, runs the kit installed beside this package", async () => {
		const { self, ran } = npxInstall();
		const root = join(dir, "app");
		mkdirSync(root);

		expect(await runKit(root, ["init", ".", "--yes"], self)).toBe(0);
		expect(existsSync(ran)).toBe(true);
	});

	test("refuses to fetch the kit again when npx already led here", () => {
		process.env.WANIWANI_INIT_VIA_NPX = "1";
		const root = join(dir, "app");
		const self = join(dir, "alone");
		mkdirSync(root);
		mkdirSync(self);

		expect(() => runKit(root, ["init"], self)).toThrow(PlatformError);
	});
});
