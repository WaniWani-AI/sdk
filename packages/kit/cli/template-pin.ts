/**
 * The distribution template this kit builds from, as data.
 *
 * Its own module, with no prose wrapped around the value, because
 * `scripts/bump-deps.ts` rewrites `commit` in place every time the tracked
 * branch moves. A file a bot edits is a file where the only line it can damage
 * is the one it means to write.
 *
 * Everything that names the template derives from this record: the `github:`
 * specifier in `./template.js`, the branch `bump-deps.ts` polls for a newer
 * commit, and the raw.githubusercontent URL it reads the template's manifest
 * from. Renaming the repo or moving the tracked branch is one line here.
 */
export const TEMPLATE_PIN = {
	owner: "WaniWani-AI",
	repo: "mcp-distribution-template",
	/**
	 * The branch `commit` is taken from, and the only branch a bump is proposed
	 * off. `bump-deps.ts` asserts the pin is an ancestor of this branch's head,
	 * so a commit from anywhere else fails rather than sitting here unnoticed.
	 */
	branch: "main",
	commit: "c6ac5f254894de75dc9781d9c0c09e308daee8b9",
};
