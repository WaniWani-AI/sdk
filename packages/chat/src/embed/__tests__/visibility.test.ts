import { describe, expect, it } from "bun:test";
import {
	appearTriggerForPath,
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

	it("resolves overlapping patterns with hide-always-wins (order-independent)", () => {
		const rules: VisibilityRules = {
			default: "show",
			patterns: [
				{ glob: "/admin/**", action: "hide" },
				{ glob: "/admin/help", action: "show" },
			],
		};
		// The show rule cannot un-hide a path a hide rule also matches.
		expect(isVisibleForPath(rules, "/admin/help")).toBe(false);
		expect(isVisibleForPath(rules, "/admin/users")).toBe(false);

		// Order doesn't matter — hide still wins.
		const flipped: VisibilityRules = {
			default: "show",
			patterns: [
				{ glob: "/admin/help", action: "show" },
				{ glob: "/admin/**", action: "hide" },
			],
		};
		expect(isVisibleForPath(flipped, "/admin/help")).toBe(false);
	});

	it("allowlists with a carve-out (show /docs/**, hide /docs/internal)", () => {
		// Presence of a show rule flips the baseline to hidden (default: "hide").
		const rules: VisibilityRules = {
			default: "hide",
			patterns: [
				{ glob: "/docs/**", action: "show" },
				{ glob: "/docs/internal", action: "hide" },
			],
		};
		expect(isVisibleForPath(rules, "/docs/intro")).toBe(true);
		expect(isVisibleForPath(rules, "/docs/internal")).toBe(false);
		expect(isVisibleForPath(rules, "/pricing")).toBe(false);
	});

	it("reads patterns from the app's `rules` key (not just `patterns`)", () => {
		// The dashboard persists the glob list under `rules`; the embed must
		// honor it without a data migration.
		const rules = {
			default: "show",
			rules: [{ glob: "/", action: "hide" }],
		} as unknown as VisibilityRules;
		// Hidden on the root page…
		expect(isVisibleForPath(rules, "/")).toBe(false);
		// …shown everywhere else.
		expect(isVisibleForPath(rules, "/pricing")).toBe(true);
	});

	it("prefers `patterns` when both keys are present", () => {
		const rules = {
			default: "show",
			patterns: [{ glob: "/a", action: "hide" }],
			rules: [{ glob: "/b", action: "hide" }],
		} as unknown as VisibilityRules;
		expect(isVisibleForPath(rules, "/a")).toBe(false);
		expect(isVisibleForPath(rules, "/b")).toBe(true);
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

describe("appearTriggerForPath", () => {
	it("returns null when there are no appear rules", () => {
		expect(appearTriggerForPath(null, "/")).toBeNull();
		expect(appearTriggerForPath(undefined, "/")).toBeNull();
		const rules: VisibilityRules = { default: "show", rules: [] };
		expect(appearTriggerForPath(rules, "/")).toBeNull();
	});

	it("returns the selector of the first matching rule", () => {
		const rules: VisibilityRules = {
			default: "show",
			appearRules: [
				{ glob: "/", appearAfter: "#hero" },
				{ glob: "/pricing", appearAfter: "#pricing-table" },
			],
		};
		expect(appearTriggerForPath(rules, "/")).toBe("#hero");
		expect(appearTriggerForPath(rules, "/pricing")).toBe("#pricing-table");
	});

	it("returns null on a path no appear rule matches (falls back to the timer)", () => {
		const rules: VisibilityRules = {
			default: "show",
			appearRules: [{ glob: "/", appearAfter: "#hero" }],
		};
		expect(appearTriggerForPath(rules, "/about")).toBeNull();
	});

	it("resolves overlapping rules by order (first match wins)", () => {
		const rules: VisibilityRules = {
			default: "show",
			appearRules: [
				{ glob: "/docs/**", appearAfter: "#docs-hero" },
				{ glob: "/docs/api", appearAfter: "#api-hero" },
			],
		};
		// `/docs/api` matches both; the earlier rule wins.
		expect(appearTriggerForPath(rules, "/docs/api")).toBe("#docs-hero");
	});

	it("supports glob wildcards the same way visibility does", () => {
		const rules: VisibilityRules = {
			default: "show",
			appearRules: [{ glob: "/blog/*", appearAfter: ".post-header" }],
		};
		expect(appearTriggerForPath(rules, "/blog/hello")).toBe(".post-header");
		expect(appearTriggerForPath(rules, "/blog/a/b")).toBeNull();
	});
});
