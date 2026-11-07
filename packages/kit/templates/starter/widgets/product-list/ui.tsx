import { useLayout, useSendFollowUpMessage, useWidget } from "@waniwani/kit/web";
import widget from "./widget.js";

const euros = (value: number) =>
	new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(value);

export default function ProductList() {
	// Typed off the widget's own `data` schema. No generated helpers, no server
	// type import.
	const { data } = useWidget(widget);
	const sendFollowUp = useSendFollowUpMessage();

	// The host hands the colour scheme to the view instead of to the browser, so
	// `prefers-color-scheme` is the wrong signal and Tailwind's `dark:` variant is
	// wired to a `dark` class (see the template's src/index.css). Every widget puts
	// that class on its own root: a view is its own bundle in its own iframe, so
	// there is no shared ancestor to hang it off.
	const { theme } = useLayout();
	const root = theme === "dark" ? "dark" : "";

	// `data` arrives as soon as the host has the tool input, which on most hosts is
	// before the server has responded. Render optimistically.
	if (!data) {
		return <div className={`${root} font-sans text-sm text-slate-500`}>Loading…</div>;
	}

	return (
		<div className={`${root} font-sans text-slate-900 dark:text-slate-100`}>
			<h1 className="mb-3 text-lg font-semibold tracking-tight">{data.query}</h1>

			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
				{data.products.map((product) => (
					<button
						type="button"
						key={product.id}
						// A click becomes a message from the shopper, which is what moves
						// the conversation on.
						onClick={() => sendFollowUp(`Tell me more about the ${product.name}.`)}
						className="flex cursor-pointer flex-col items-start gap-1 rounded-2xl border-[1.5px] border-slate-200 bg-white p-3.5 text-left transition duration-150 hover:-translate-y-px hover:border-slate-400 hover:shadow-lg hover:shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
						// What the model reads in place of the pixels.
						data-llm={`${product.name}, ${euros(product.price)}: ${product.blurb}`}
					>
						<span className="text-[22px] font-bold tracking-tight">{euros(product.price)}</span>
						<span className="font-semibold">{product.name}</span>
						<span className="text-[13px] text-slate-500 dark:text-slate-400">{product.blurb}</span>
					</button>
				))}
			</div>
		</div>
	);
}
