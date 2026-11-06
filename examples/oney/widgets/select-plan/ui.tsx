import { useLayout, useSendFollowUpMessage, useWidget, useWidgetState } from "@waniwani/kit/web";
import widget from "./widget.js";

const euros = (value: number) =>
	new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(value);

export default function SelectPlan() {
	// Typed off the widget's own `data` schema — no generated helpers, no
	// server type import.
	const { data } = useWidget(widget);
	const [state, setState] = useWidgetState<{ selectedPlanId: string | null }>({
		selectedPlanId: null,
	});
	const sendFollowUp = useSendFollowUpMessage();

	// The host hands the colour scheme to the view rather than to the browser, so
	// `prefers-color-scheme` is the wrong signal and Tailwind's `dark:` variant is
	// wired to a `dark` class instead (see the template's `src/index.css`). Every
	// widget puts that class on its own root: a view is its own bundle mounted in
	// its own iframe, so there is no shared ancestor to hang it off.
	const { theme } = useLayout();
	const root = theme === "dark" ? "dark" : "";

	if (!data) {
		return <div className={`${root} font-sans text-sm text-ink-muted`}>Loading your plans…</div>;
	}

	const selected = state.selectedPlanId ?? data.selectedPlanId ?? null;

	const choose = async (planId: string, label: string) => {
		setState({ selectedPlanId: planId });
		await sendFollowUp(`I'll take the ${label} plan.`);
	};

	return (
		<div className={`${root} font-sans text-ink dark:text-slate-100`}>
			<header className="mb-4">
				<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted dark:text-slate-400">
					Split your payment
				</span>
				<h1 className="mt-1 text-3xl font-bold tracking-tight">{euros(data.amount)}</h1>
				{data.merchant ? (
					<p className="mt-0.5 text-[13px] text-ink-muted dark:text-slate-400">
						at {data.merchant}
					</p>
				) : null}
			</header>

			<div
				className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5"
				data-llm={`${data.plans.length} instalment plans for ${euros(data.amount)}`}
			>
				{data.plans.map((plan) => (
					<button
						type="button"
						key={plan.id}
						onClick={() => choose(plan.id, plan.label)}
						className={`flex cursor-pointer flex-col items-start gap-1 rounded-2xl border-[1.5px] bg-surface p-3.5 text-left transition duration-150 hover:-translate-y-px hover:border-slate-400 hover:shadow-lg hover:shadow-slate-900/10 dark:bg-slate-900 dark:hover:border-slate-500 ${
							selected === plan.id
								? "border-ink inset-ring inset-ring-ink dark:border-slate-100 dark:inset-ring-slate-100"
								: "border-slate-200 dark:border-slate-700"
						}`}
						data-llm={`${plan.label}: ${euros(plan.monthly)} per month, ${plan.fee === 0 ? "no fee" : `${euros(plan.fee)} fee`}`}
					>
						<span className="text-xs font-bold tracking-wide text-ink-muted dark:text-slate-400">
							{plan.label}
						</span>
						<span className="text-[22px] font-bold tracking-tight">
							{euros(plan.monthly)}
							<small className="ml-0.5 text-xs font-medium text-ink-muted dark:text-slate-400">
								/month
							</small>
						</span>
						<span className="text-[13px] text-slate-700 dark:text-slate-300">{plan.tagline}</span>
						<span className="text-[11px] text-slate-400 dark:text-slate-500">
							{plan.fee === 0 ? "No fee" : `${euros(plan.fee)} fee`} · {euros(plan.total)} total
						</span>
					</button>
				))}
			</div>

			<p className="mt-3.5 text-[11px] leading-normal text-slate-400 dark:text-slate-500">
				Borrowing money costs money too. Check your repayment capacity before you commit.
			</p>
		</div>
	);
}
