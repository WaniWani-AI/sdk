/**
 * Plain app code. Anything outside the convention folders is just a module —
 * the CLI does not look at it, and the runtime never sees it.
 */

export type Plan = {
	id: string;
	label: string;
	instalments: number;
	/** Per-month amount, rounded to the cent. */
	monthly: number;
	/** Total fee in euros. */
	fee: number;
	total: number;
	tagline: string;
};

const FEE_RATE: Record<number, number> = {
	3: 0,
	4: 0.019,
	10: 0.049,
};

const TAGLINE: Record<number, string> = {
	3: "Interest free",
	4: "Small one-off fee",
	10: "Lowest monthly payment",
};

const round = (value: number) => Math.round(value * 100) / 100;

export function buildPlans(amount: number, country: string): Plan[] {
	// 10x is a French-market product.
	const offered = country === "FR" ? [3, 4, 10] : [3, 4];

	return offered.map((instalments) => {
		const fee = round(amount * (FEE_RATE[instalments] ?? 0));
		const total = round(amount + fee);
		return {
			id: `x${instalments}`,
			label: `${instalments}×`,
			instalments,
			monthly: round(total / instalments),
			fee,
			total,
			tagline: TAGLINE[instalments] ?? "",
		};
	});
}
