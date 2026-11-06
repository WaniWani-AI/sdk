# Working in this repo

## Never write source code as a string literal

Any TypeScript, TSX, CSS or JSON that ends up in a customer's file goes on disk
as a real file that the repo's own checks run over. Not a template literal in a
`.ts` module.

A string of code compiles no matter what it says. `tsc` cannot see it, biome
cannot format it, and every backtick, `${` and backslash inside it has to be
escaped into something that differs from what the customer receives. A change to
a signature it uses breaks it with nothing going red until somebody runs the
command by hand.

`packages/kit/templates/starter/` is where the scaffold lives, checked by
`tsconfig.templates.json`, `waniwani check` and biome. Two rules for anything
added to it. Nothing is interpolated, so a file that needs the app's own name is
written by `cli/init.ts` instead. And dotfiles lose the dot: npm strips a
`.gitignore` out of a published tarball, so it is `gitignore` on disk and `init`
renames it on the way out.

The one exception is code whose shape depends on what the generator found —
`generateServerApp` in `cli/codegen.ts` emits an import line per discovered tool,
so it has to build text. That output is compiled by `scripts/template-contract.ts`
on every PR, which is what makes it acceptable. A string of code with no check
behind it is not.

## Comments

Comments describe how the code behaves now. No "used to", "now", "previously",
"recently", "as of today" — git carries the history. State the current rule and
the reason it holds.

## Checks before calling something done

```bash
bun run build       # tsc over src/ and cli/
bun run typecheck   # adds templates/, against the dist/ build just produced
bun run lint        # biome, formatting included
bun run contract    # generates, builds, serves and ejects examples/oney — slow
```

`lint` failing on formatting is normal after an edit. `bun run lint:fix` writes
it, and the result is the convention, not a suggestion.
