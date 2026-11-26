import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Suggestions } from "./suggestions";

// The suggestion row: one line of pills that scrolls sideways. Each pill is as
// wide as its label, up to the width of the row. Change the sample set and the
// width to see long labels, many pills and the edge fades.

const SETS = {
	short: ["Create my company", "Which legal form?", "What does it cost?"],
	"long-follow-ups": [
		"Quelles sont les différences de cotisations entre les deux statuts ?",
		"Comment bénéficier de l'accompagnement d'un avocat partenaire ?",
		"Je confirme le statut choisi pour poursuivre la création.",
	],
	many: [
		"Je veux créer ma société",
		"Quel statut choisir pour mon projet ?",
		"Combien coûte la création d'une société ?",
		"Entreprise individuelle ou société, quelle différence ?",
		"Quelles sont les étapes pour créer ma société ?",
		"Micro-entreprise ou société ?",
	],
	"wider-than-the-row": [
		"This label runs far past any sensible length limit, so even a desktop row cannot hold it on one line and it ends in an ellipsis",
		"A short one",
	],
} satisfies Record<string, string[]>;

interface Args {
	set: keyof typeof SETS;
	width: number;
	align: "start" | "center";
	isLoading: boolean;
}

function Row({ set, width, align, isLoading }: Args) {
	const [sent, setSent] = useState<string | null>(null);
	return (
		<div style={{ width, padding: 24 }}>
			<Suggestions
				suggestions={SETS[set]}
				isLoading={isLoading}
				align={align}
				onSelect={setSent}
				className="ww:px-0"
			/>
			<p style={{ fontSize: 12, opacity: 0.6, marginTop: 12 }}>
				{sent ? `Sent: ${sent}` : "Click a pill to send it."}
			</p>
		</div>
	);
}

const meta: Meta<Args> = {
	title: "Chat/Suggestions",
	parameters: { bare: true },
	args: { set: "many", width: 640, align: "start", isLoading: false },
	argTypes: {
		set: { control: "select", options: Object.keys(SETS) },
		width: { control: { type: "range", min: 320, max: 960, step: 10 } },
		align: { control: "inline-radio", options: ["start", "center"] },
	},
	render: (args) => <Row {...args} />,
};

export default meta;

type Story = StoryObj<Args>;

export const Desktop: Story = {};

export const Phone: Story = { args: { width: 375 } };

export const LongFollowUps: Story = { args: { set: "long-follow-ups" } };

export const CenteredShortSet: Story = {
	args: { set: "short", align: "center" },
};

export const Loading: Story = { args: { isLoading: true } };
