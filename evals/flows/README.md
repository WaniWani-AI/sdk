# Flow eval

Runs real models against real flows over MCP and counts what a user would notice: questions about things they already said, turns that end in silence, and values that land in the wrong field.

It calls models through the AI Gateway, so every run costs tokens. It stays out of `bun test` for that reason. Run it before any release that touches `src/mcp/server/flows/`.

## Setup

Put a gateway key in `.env` at the repo root (gitignored):

```sh
AI_GATEWAY_API_KEY=...
```

## Running

```sh
bun run eval:flows                                   # this checkout, sandbox default model, 3 runs per scenario
bun run eval:flows --sdk local,0.23.0                # compare against a published version
bun run eval:flows --models openai/gpt-6-luna,anthropic/claude-sonnet-5
bun run eval:flows --scenario opener-all --runs 1 --verbose
bun run eval:flows --steps 10                        # a looser step limit than the sandbox's 5
```

| Flag | Default | |
|---|---|---|
| `--sdk` | `local` | `local` is this checkout's `src`. A version number installs that `@waniwani/sdk` once into `evals/.cache/` and runs the flows on it. |
| `--models` | `openai/gpt-6-luna` | AI Gateway model ids, comma-separated. The default is the sandbox's default model. |
| `--runs` | `3` | Conversations per scenario and model. A single run says little about a model that answers differently each time. |
| `--steps` | `5` | Model steps per user turn. 5 is the sandbox's limit. |
| `--scenario` | all | Substring filter on scenario ids. |
| `--concurrency` | `4` | Conversations in flight at once. |
| `--verbose` | off | Prints the transcript of every run that fails. |

Each run writes every transcript to `evals/flows/results/<timestamp>.json` (gitignored).

## What a conversation looks like

The flow is served by an in-memory MCP server. The host side copies the app's chat sandbox (`app/src/app/api/mcp/chat/route.ts`): `@ai-sdk/mcp` lists the tools, every `tools/call` carries `waniwani/sessionId` in `_meta`, and an AI SDK `ToolLoopAgent` answers each user message with the sandbox's default instructions, `reasoningEffort: "low"`, and the step limit. The model sees the same tool listing and tool responses it would see in the sandbox.

The user is scripted. Their first message comes from the scenario. After that they give the fields the flow is waiting on that they haven't said yet, from the flow's persona, plus whatever the scenario has them volunteer. When the flow is waiting only on things they already said, they reply "I already told you that above." Nothing about the user depends on another model, so a difference between two runs comes from the assistant.

## Reading the table

| Column | Meaning |
|---|---|
| `pass` | Finished in the ideal number of user turns, no turn ended waiting on something the user had already said or cut off by the step limit, every answer is in the right field, and the computed fields are untouched. |
| `done` | The flow reached `complete`. |
| `user turns (ideal)` | Average user messages it took. The ideal is the opener plus one reply per question group the user hadn't already answered. |
| `waiting on known` | Fields the flow was still waiting on at the end of a turn although the user had already given them. The assistant either asked again or has to send them on a later call. |
| `unasked keys` | `stateUpdates` keys the model sent for fields the flow wasn't waiting on. On a version that only accepts asked fields, these are dropped. |
| `step limit` | Turns cut off by the step limit while the model was still calling tools. The user sees no reply. |
| `wrong` | Final-state fields that don't match what the user said. |
| `computed` | Fields the flow computes itself (member id, vehicle id, price) that ended up with another value. |

## Scenarios

`fixtures.ts` holds two flows and the scenarios that drive them:

- `signup`: six questions, one per node, then an action node that computes a member id.
- `car`: an open first question whose `context` tells the model to extract other fields (the Everquote/Luva pattern), grouped questions after it, a vehicle lookup, and a computed price.

To add a scenario, give it an opener, the fields that opener reveals, and optionally `volunteer` (fields the user adds when asked a given question). The ideal turn count follows from those.

## What it doesn't cover

ChatGPT runs its own model and orchestration, and nothing here reproduces them. Before a flows release, also test by hand in ChatGPT developer mode against a tunnel to the branch: at least the `opener-all` and `opener-wide` openers, a few times each.
