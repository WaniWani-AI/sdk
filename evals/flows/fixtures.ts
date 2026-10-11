/**
 * The flows the eval drives, the person answering them, and the scenarios
 * that decide how much that person says up front.
 *
 * Every value a user gives comes from the flow's persona, phrased the way a
 * person would say it, so the final state can be checked field by field.
 */

import type { McpServer } from "../../src/mcp";
import type { FlowTokenContent } from "../../src/mcp/server/flows/@types";
import type { Engine } from "./engine";

/** A compiled flow, reduced to what the eval touches. */
export type BuiltFlow = {
	name: string;
	register: (server: McpServer) => Promise<void>;
};

/** Session records the flow store keeps, reduced to what the eval reads. */
export type FlowRecord = { state?: Record<string, unknown> };

export type FlowStoreLike = {
	get: (key: string) => Promise<FlowRecord | null>;
};

export type FlowFixture = {
	id: string;
	/** Question groups in the order the flow asks them, one per interrupt node. */
	groups: string[][];
	/** What the user answers for each asked field, and how they say it. */
	persona: Record<string, { value: string; phrase: string }>;
	build: (engine: Engine) => { flow: BuiltFlow; store: FlowStoreLike };
	/** Problems with the fields the flow computes for itself, given the final state. */
	checkComputed: (state: Record<string, unknown>) => string[];
};

export type Scenario = {
	id: string;
	flow: FlowFixture;
	opener: { text: string; reveals: string[] };
	/**
	 * Fields the user adds, unprompted, when answering the question on a given
	 * field. `{ firstName: ["lastName"] }`: asked for a first name, they also
	 * give their last name.
	 */
	volunteer?: Record<string, string[]>;
};

// ============================================================================
// Member signup: six questions, one per node, then a computed member id
// ============================================================================

function memberIdFor(state: Record<string, unknown>): string {
	const last = String(state.lastName ?? "").toUpperCase();
	return `M-${state.postcode}-${last}`;
}

const signup: FlowFixture = {
	id: "signup",
	groups: [
		["firstName"],
		["lastName"],
		["email"],
		["phone"],
		["birthDate"],
		["postcode"],
	],
	persona: {
		firstName: { value: "Max", phrase: "my first name is Max" },
		lastName: { value: "Antoine", phrase: "my last name is Antoine" },
		email: {
			value: "max.antoine@example.com",
			phrase: "my email is max.antoine@example.com",
		},
		phone: {
			value: "+33 6 12 34 56 78",
			phrase: "my phone number is +33 6 12 34 56 78",
		},
		birthDate: { value: "1990-04-12", phrase: "I was born on 1990-04-12" },
		postcode: { value: "75011", phrase: "my postcode is 75011" },
	},
	build: ({ createFlow, START, END, MemoryKvStore, z }) => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "member_signup",
			title: "Member signup",
			description: "Open a Northwind Mutual member account.",
			state: {
				firstName: z.string().describe("First name"),
				lastName: z.string().describe("Last name"),
				email: z.string().describe("Email address"),
				phone: z.string().describe("Phone number"),
				birthDate: z.string().describe("Date of birth, YYYY-MM-DD"),
				postcode: z.string().describe("Postcode"),
				memberId: z.string().describe("Member id the account is opened under"),
			},
		})
			.addNode({
				id: "ask_first_name",
				run: ({ interrupt }) =>
					interrupt({ firstName: { question: "What's your first name?" } }),
			})
			.addNode({
				id: "ask_last_name",
				run: ({ interrupt }) =>
					interrupt({ lastName: { question: "What's your last name?" } }),
			})
			.addNode({
				id: "ask_email",
				run: ({ interrupt }) =>
					interrupt({ email: { question: "What's your email address?" } }),
			})
			.addNode({
				id: "ask_phone",
				run: ({ interrupt }) =>
					interrupt({ phone: { question: "What's your phone number?" } }),
			})
			.addNode({
				id: "ask_birth_date",
				run: ({ interrupt }) =>
					interrupt({ birthDate: { question: "What's your date of birth?" } }),
			})
			.addNode({
				id: "ask_postcode",
				run: ({ interrupt }) =>
					interrupt({ postcode: { question: "What's your postcode?" } }),
			})
			.addNode({
				id: "open_account",
				run: ({ state }) =>
					state.memberId ? {} : { memberId: memberIdFor(state) },
			})
			.addEdge(START, "ask_first_name")
			.addEdge("ask_first_name", "ask_last_name")
			.addEdge("ask_last_name", "ask_email")
			.addEdge("ask_email", "ask_phone")
			.addEdge("ask_phone", "ask_birth_date")
			.addEdge("ask_birth_date", "ask_postcode")
			.addEdge("ask_postcode", "open_account")
			.addEdge("open_account", END)
			.compile({ store });
		return { flow, store: store as FlowStoreLike };
	},
	checkComputed: (state) =>
		state.memberId === memberIdFor(state)
			? []
			: [`memberId is ${state.memberId}, expected ${memberIdFor(state)}`],
};

// ============================================================================
// Car quote: a wide-open first question, then grouped questions, with a
// vehicle lookup and a price the flow computes (shaped like Everquote/Luva)
// ============================================================================

function vehicleIdFor(vehicle: unknown): string {
	return `veh-${String(vehicle ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")}`;
}

function priceFor(state: Record<string, unknown>): number {
	return 80 + String(state.vehicleId ?? "").length;
}

const carQuote: FlowFixture = {
	id: "car",
	groups: [
		["vehicle"],
		["dailyMileage", "primaryUse", "ownership"],
		["overnightParking", "garagingAddress"],
		["fullName", "birthDate"],
	],
	persona: {
		vehicle: {
			value: "2019 Honda Civic",
			phrase: "I drive a 2019 Honda Civic",
		},
		dailyMileage: { value: "10 to 30", phrase: "I drive 10 to 30 miles a day" },
		primaryUse: { value: "Commuting", phrase: "I mostly use it for commuting" },
		ownership: { value: "Own", phrase: "I own it" },
		overnightParking: {
			value: "Garage",
			phrase: "I park it in my garage overnight",
		},
		garagingAddress: {
			value: "12 Main St, Springfield, IL 62701",
			phrase: "the garage is at 12 Main St, Springfield, IL 62701",
		},
		fullName: { value: "Max Antoine", phrase: "my name is Max Antoine" },
		birthDate: { value: "1990-04-12", phrase: "I was born on 1990-04-12" },
	},
	build: ({ createFlow, START, END, MemoryKvStore, z }) => {
		const store = new MemoryKvStore<FlowTokenContent>();
		const flow = createFlow({
			id: "car_quote",
			title: "Car insurance quote",
			description: "Quote car insurance from a few questions about the car.",
			state: {
				vehicle: z.string().describe("Year, make and model of the car"),
				vehicleId: z.string().describe("Catalog id the vehicle resolves to"),
				dailyMileage: z.string().describe("Miles driven per day"),
				primaryUse: z.string().describe("What the car is mainly used for"),
				ownership: z.string().describe("Owned, financed or leased"),
				overnightParking: z
					.string()
					.describe("Where the car is parked overnight"),
				garagingAddress: z
					.string()
					.describe("Address where the car is parked overnight"),
				fullName: z.string().describe("Driver's full name"),
				birthDate: z.string().describe("Driver's date of birth, YYYY-MM-DD"),
				monthlyPrice: z.number().describe("Quoted monthly price in dollars"),
			},
		})
			.addNode({
				id: "ask_vehicle",
				run: ({ interrupt }) =>
					interrupt({
						vehicle: {
							question: "Tell me about your car: the year, make and model.",
							context:
								"Keep it open and let them talk. From their answer, put everything clearly stated into stateUpdates: vehicle, and any of dailyMileage, primaryUse, ownership, overnightParking, garagingAddress, fullName. Only what was actually said.",
						},
					}),
			})
			.addNode({
				id: "lookup_vehicle",
				run: ({ state }) =>
					state.vehicleId ? {} : { vehicleId: vehicleIdFor(state.vehicle) },
			})
			.addNode({
				id: "ask_usage",
				run: ({ interrupt }) =>
					interrupt({
						dailyMileage: {
							question: "Roughly how many miles do you drive a day?",
							suggestions: ["Under 10", "10 to 30", "30 to 50", "Over 50"],
						},
						primaryUse: {
							question: "What do you mainly use it for?",
							suggestions: ["Commuting", "Errands and leisure", "Business"],
						},
						ownership: {
							question: "Do you own, finance, or lease it?",
							suggestions: ["Own", "Finance", "Lease"],
						},
					}),
			})
			.addNode({
				id: "ask_parking",
				run: ({ interrupt }) =>
					interrupt({
						overnightParking: {
							question: "Where do you park it overnight?",
							suggestions: ["Garage", "Driveway", "Street", "Other"],
						},
						garagingAddress: {
							question: "What's the address where you park it overnight?",
						},
					}),
			})
			.addNode({
				id: "ask_driver",
				run: ({ interrupt }) =>
					interrupt({
						fullName: { question: "What's your name?" },
						birthDate: { question: "And your date of birth?" },
					}),
			})
			.addNode({
				id: "price",
				run: ({ state }) => ({ monthlyPrice: priceFor(state) }),
			})
			.addEdge(START, "ask_vehicle")
			.addEdge("ask_vehicle", "lookup_vehicle")
			.addEdge("lookup_vehicle", "ask_usage")
			.addEdge("ask_usage", "ask_parking")
			.addEdge("ask_parking", "ask_driver")
			.addEdge("ask_driver", "price")
			.addEdge("price", END)
			.compile({ store });
		return { flow, store: store as FlowStoreLike };
	},
	checkComputed: (state) => {
		const problems: string[] = [];
		if (state.vehicleId !== vehicleIdFor(state.vehicle)) {
			problems.push(
				`vehicleId is ${state.vehicleId}, expected ${vehicleIdFor(state.vehicle)}`,
			);
		}
		if (state.monthlyPrice !== priceFor(state)) {
			problems.push(
				`monthlyPrice is ${state.monthlyPrice}, expected ${priceFor(state)}`,
			);
		}
		return problems;
	},
};

// ============================================================================
// Scenarios
// ============================================================================

export const SCENARIOS: Scenario[] = [
	{
		id: "signup/opener-none",
		flow: signup,
		opener: { text: "Hi, I'd like to open an account.", reveals: [] },
	},
	{
		id: "signup/opener-name",
		flow: signup,
		opener: {
			text: "Hi, I'm Max Antoine and I'd like to open an account.",
			reveals: ["firstName", "lastName"],
		},
	},
	{
		id: "signup/opener-all",
		flow: signup,
		opener: {
			text: "Hi, I'd like to open an account. I'm Max Antoine, email max.antoine@example.com, phone +33 6 12 34 56 78, born 1990-04-12, postcode 75011.",
			reveals: [
				"firstName",
				"lastName",
				"email",
				"phone",
				"birthDate",
				"postcode",
			],
		},
	},
	{
		id: "signup/volunteer-midflow",
		flow: signup,
		opener: { text: "Hi, I'd like to open an account.", reveals: [] },
		volunteer: { firstName: ["lastName", "email"] },
	},
	{
		id: "car/opener-wide",
		flow: carQuote,
		opener: {
			text: "Hey, I want to compare car insurance. I've got a 2019 Honda Civic that I own, I drive 10 to 30 miles a day, mostly commuting. It sleeps in my garage at 12 Main St, Springfield, IL 62701. I'm Max Antoine.",
			reveals: [
				"vehicle",
				"ownership",
				"dailyMileage",
				"primaryUse",
				"overnightParking",
				"garagingAddress",
				"fullName",
			],
		},
	},
];

/**
 * The fewest user messages that can finish the scenario: the opener, plus one
 * reply for every question group that still has a field the user has not
 * given by the time the flow reaches it.
 */
export function idealUserTurns(scenario: Scenario): number {
	const revealed = new Set(scenario.opener.reveals);
	let turns = 1;
	for (const group of scenario.flow.groups) {
		const missing = group.filter((field) => !revealed.has(field));
		const first = missing[0];
		if (!first) {
			continue;
		}
		turns++;
		for (const field of [...missing, ...(scenario.volunteer?.[first] ?? [])]) {
			revealed.add(field);
		}
	}
	return turns;
}
