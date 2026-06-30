import { describe, expect, it } from "bun:test";
import {
	globToRegExp,
	isVisibleForPath,
	matchGlob,
	type VisibilityRules,
} from "../visibility";

describe("globToRegExp / matchGlob", () => {
	it("matches an exact literal path", () => {
		expect(matchGlob("/blog", "/blog")).toBe(true);
		expect(matchGlob("/blog", "/blogs")).toBe(false);
		expect(matchGlob("/blog", "/blog/post")).toBe(false);
	});

	it("`*` matches within a single segment only", () => {
		expect(matchGlob("/docs/*", "/docs/intro")).toBe(true);
		expect(matchGlob("/docs/*", "/docs/")).toBe(true);
		expect(matchGlob("/docs/*", "/docs/a/b")).toBe(false);
		expect(matchGlob("/docs/*", "/docs")).toBe(false);
	});

	it("`**` matches across segments", () => {
		expect(matchGlob("/docs/**", "/docs/intro")).toBe(true);
		expect(matchGlob("/docs/**", "/docs/a/b/c")).toBe(true);
		expect(matchGlob("/docs/**", "/docs/")).toBe(true);
		expect(matchGlob("/blog/**", "/docs/x")).toBe(false);
	});

	it("matches the root and trailing slashes literally", () => {
		expect(matchGlob("/", "/")).toBe(true);
		expect(matchGlob("/", "/x")).toBe(false);
		expect(matchGlob("**", "/any/deep/path")).toBe(true);
	});

	it("escapes regex metacharacters in the literal portions", () => {
		expect(matchGlob("/a.b", "/a.b")).toBe(true);
		// `.` must be literal, not a wildcard.
		expect(matchGlob("/a.b", "/axb")).toBe(false);
		expect(matchGlob("/price(usd)", "/price(usd)")).toBe(true);
	});

	it("anchors the pattern to the whole path", () => {
		const re = globToRegExp("/docs/*");
		expect(re.test("/x/docs/intro")).toBe(false);
	});
});

describe("isVisibleForPath", () => {
	it("shows everywhere when rules are null/undefined (back-compat)", () => {
		expect(isVisibleForPath(null, "/anything")).toBe(true);
		expect(isVisibleForPath(undefined, "/anything")).toBe(true);
	});

	it("falls back to `default` when no pattern matches", () => {
		const showDefault: VisibilityRules = { default: "show", patterns: [] };
		const hideDefault: VisibilityRules = { default: "hide", patterns: [] };
		expect(isVisibleForPath(showDefault, "/pricing")).toBe(true);
		expect(isVisibleForPath(hideDefault, "/pricing")).toBe(false);
	});

	it("hides matching paths against a show-default", () => {
		const rules: VisibilityRules = {
			default: "show",
			patterns: [{ glob: "/admin/**", action: "hide" }],
		};
		expect(isVisibleForPath(rules, "/admin/users")).toBe(false);
		expect(isVisibleForPath(rules, "/pricing")).toBe(true);
	});

	it("acts as an allowlist against a hide-default", () => {
		const rules: VisibilityRules = {
			default: "hide",
			patterns: [{ glob: "/docs/**", action: "show" }],
		};
		expect(isVisibleForPath(rules, "/docs/intro")).toBe(true);
		expect(isVisibleForPath(rules, "/pricing")).toBe(false);
	});

	it("resolves overlapping patterns with last-match-wins", () => {
		const rules: VisibilityRules = {
			default: "show",
			patterns: [
				{ glob: "/admin/**", action: "hide" },
				{ glob: "/admin/help", action: "show" },
			],
		};
		expect(isVisibleForPath(rules, "/admin/help")).toBe(true);
		expect(isVisibleForPath(rules, "/admin/users")).toBe(false);

		// Flipping order flips the result for the overlapping path.
		const flipped: VisibilityRules = {
			default: "show",
			patterns: [
				{ glob: "/admin/help", action: "show" },
				{ glob: "/admin/**", action: "hide" },
			],
		};
		expect(isVisibleForPath(flipped, "/admin/help")).toBe(false);
	});

	it("treats regex-special characters in a glob literally and never throws", () => {
		const rules: VisibilityRules = {
			default: "show",
			patterns: [{ glob: "/[weird](path)", action: "hide" }],
		};
		expect(() => isVisibleForPath(rules, "/[weird](path)")).not.toThrow();
		// Matched literally → hidden.
		expect(isVisibleForPath(rules, "/[weird](path)")).toBe(false);
		// A different path is unaffected.
		expect(isVisibleForPath(rules, "/weird")).toBe(true);
	});
});
