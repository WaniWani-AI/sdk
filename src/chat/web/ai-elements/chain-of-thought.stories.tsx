import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ToolUIPart } from "ai";
import {
	ClockIcon,
	GlobeIcon,
	type LucideIcon,
	WrenchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	ChainOfThought,
	ChainOfThoughtContent,
	ChainOfThoughtHeader,
	ChainOfThoughtReasoning,
	ChainOfThoughtStep,
} from "./chain-of-thought";
import { ToolInput, ToolOutput } from "./tool";

// ============================================================================
// ChainOfThought stories — the redesigned tool-chain display.
//
// While the turn is working the chain stays collapsed and the header is a
// single live line: the active step's icon + a shimmering label that swaps
// cleanly as the model moves from one tool call to the next. The timeline
// never expands on its own. Once work ends the header settles into a
// clickable "Thought process" accordion that reveals the full step timeline.
//
// These stories drive that lifecycle on a timer so the transitions are
// visible without a live backend.
// ============================================================================

/** `get_price_estimate` → `Get price estimate` */
function formatToolName(name: string): string {
	return name.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Globe for search-like tools, wrench otherwise — mirrors message-list. */
function pickStepIcon(name: string): LucideIcon {
	return /search|find|lookup|query|web|browse|google/i.test(name)
		? GlobeIcon
		: WrenchIcon;
}

type ScenarioStep =
	| { kind: "reasoning"; text: string }
	| {
			kind: "tool";
			toolName: string;
			title?: string;
			input: Record<string, unknown>;
			output: Record<string, unknown>;
	  };

// A believable multi-tool turn: think, quote, search providers, compare.
const SCENARIO: ScenarioStep[] = [
	{
		kind: "reasoning",
		text: "The user wants renters insurance in Austin. I'll pull a quote for their coverage level, then look up nearby providers and compare the options before answering.",
	},
	{
		kind: "tool",
		toolName: "get_price_estimate",
		title: "Getting you a quote",
		input: { city: "Austin, TX", coverage: "renters", deductible: 500 },
		output: {
			monthlyPremium: 14.5,
			currency: "USD",
			coverageLimit: 30000,
			carrier: "Canopy",
		},
	},
	{
		kind: "tool",
		toolName: "search_providers",
		title: "Searching providers nearby",
		input: { region: "TX", radiusMiles: 25 },
		output: {
			results: [
				{ name: "Canopy", rating: 4.7 },
				{ name: "Lemonade", rating: 4.5 },
				{ name: "Assurant", rating: 4.1 },
			],
		},
	},
	{
		kind: "tool",
		toolName: "compare_prices",
		title: "Comparing the best offers",
		input: { candidates: ["Canopy", "Lemonade", "Assurant"] },
		output: {
			cheapest: "Canopy",
			monthly: 14.5,
			runnerUp: { name: "Lemonade", monthly: 15.9 },
		},
	},
];

const STEP_INTERVAL_MS = 1700;
const RESTART_PAUSE_MS = 2600;

/** Maps a scenario step to the ticker's `activeStep` (icon + label). */
function toActiveStep(step: ScenarioStep): { icon: LucideIcon; label: string } {
	if (step.kind === "reasoning") {
		return { icon: ClockIcon, label: "Thinking…" };
	}
	return {
		icon: pickStepIcon(step.toolName),
		label: step.title ?? formatToolName(step.toolName),
	};
}

interface PlayerProps {
	/** Loop the lifecycle so the transitions replay without interaction. */
	loop?: boolean;
	/** Start already finished (settled accordion, click to expand). */
	startSettled?: boolean;
}

/**
 * Drives the ChainOfThought through the scenario on a timer. `index` is how
 * many steps have started; the step at `index - 1` is running while the turn
 * is working, everything before it is done. `index > length` marks the turn
 * finished, which flips `isWorking` false and lets the chain settle.
 */
function ChainPlayer({ loop = true, startSettled = false }: PlayerProps) {
	const total = SCENARIO.length;
	const [index, setIndex] = useState(startSettled ? total + 1 : 0);

	useEffect(() => {
		if (index > total) {
			if (!loop) {
				return;
			}
			const t = setTimeout(() => setIndex(0), RESTART_PAUSE_MS);
			return () => clearTimeout(t);
		}
		const t = setTimeout(() => setIndex((i) => i + 1), STEP_INTERVAL_MS);
		return () => clearTimeout(t);
	}, [index, loop]);

	const isWorking = index >= 1 && index <= total;
	// Steps that have started, in document order.
	const started = SCENARIO.slice(0, Math.min(index, total));
	const runningIndex = isWorking ? index - 1 : -1;
	const activeStep = isWorking
		? toActiveStep(SCENARIO[Math.min(index - 1, total - 1)])
		: undefined;

	// Before the first step lands there's nothing to show — mimic the
	// pre-stream gap where the working indicator would cover things.
	if (started.length === 0) {
		return (
			<p className="ww:text-sm ww:text-muted-foreground ww:italic">
				waiting for the first step…
			</p>
		);
	}

	return (
		<ChainOfThought isWorking={isWorking} activeStep={activeStep}>
			<ChainOfThoughtHeader
				workingLabel="Working on it…"
				label="Thought process"
			/>
			<ChainOfThoughtContent>
				{started.map((step, i) => {
					const isLast = i === started.length - 1;
					const state: ToolUIPart["state"] =
						i === runningIndex ? "input-available" : "output-available";
					if (step.kind === "reasoning") {
						return (
							<ChainOfThoughtReasoning
								key={`r-${i}`}
								isStreaming={i === runningIndex}
								isLast={isLast}
							>
								{step.text}
							</ChainOfThoughtReasoning>
						);
					}
					return (
						<ChainOfThoughtStep
							key={step.toolName}
							icon={pickStepIcon(step.toolName)}
							title={step.title ?? formatToolName(step.toolName)}
							state={state}
							isLast={isLast}
						>
							<ToolInput input={step.input} />
							{i !== runningIndex && (
								<ToolOutput output={step.output} errorText={undefined} />
							)}
						</ChainOfThoughtStep>
					);
				})}
			</ChainOfThoughtContent>
		</ChainOfThought>
	);
}

/**
 * Frames the player like a chat message column: the `[data-waniwani-chat]`
 * wrapper supplies the CSS variables (and `dark` swaps the palette), matching
 * how the component renders inside the real widget.
 */
function Stage({
	dark,
	children,
}: {
	dark?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div
			data-waniwani-chat=""
			className={dark ? "dark" : undefined}
			style={{
				minHeight: "100vh",
				background: "var(--ww-color-background)",
				color: "var(--ww-color-foreground)",
				fontFamily: "var(--ww-font-sans)",
				padding: "48px",
			}}
		>
			<div style={{ maxWidth: 560, margin: "0 auto" }}>
				<p
					className="ww:mb-6 ww:text-sm ww:text-muted-foreground"
					style={{ lineHeight: 1.6 }}
				>
					While working, the tool chain stays on one shimmering line and
					transitions between actions. When it finishes it collapses into a
					clickable “Thought process” accordion — open it to see the full chain.
				</p>
				{children}
			</div>
		</div>
	);
}

interface Args {
	loop: boolean;
	dark: boolean;
}

const meta: Meta<Args> = {
	title: "Chat/ChainOfThought",
	render: (args) => (
		<Stage dark={args.dark}>
			<ChainPlayer loop={args.loop} />
		</Stage>
	),
	args: { loop: true, dark: false },
	argTypes: {
		loop: { control: "boolean" },
		dark: { control: "boolean" },
	},
};

export default meta;

type Story = StoryObj<Args>;

/** Light theme, looping lifecycle: watch the single-line ticker swap between
 *  tool calls, then settle into the accordion (which reopens the loop). */
export const Live: Story = {};

/** Dark theme, looping lifecycle. */
export const Dark: Story = {
	args: { dark: true },
};

/** Plays once and stops on the settled accordion — good for inspecting the
 *  final collapsed state and clicking to expand the full timeline. */
export const PlayOnce: Story = {
	args: { loop: false },
};

/** Starts already settled: the accordion is closed from first paint. Click the
 *  header to expand the full step timeline with request/response detail. */
export const Settled: Story = {
	render: (args) => (
		<Stage dark={args.dark}>
			<ChainPlayer startSettled loop={false} />
		</Stage>
	),
};
