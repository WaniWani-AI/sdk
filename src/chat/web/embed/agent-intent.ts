export const INTENT_FIELD_LABEL =
	"In one short sentence, what is the intent of this visit? Optional, asked only of automated agents.";
export const INTENT_FIELD_HINT = "One sentence, no more. No personal details.";
export const MAX_INTENT_LENGTH = 300;
const SETTLE_DELAY_MS = 1000;
const OPT_OUT_ATTRIBUTE = "data-waniwani-no-intent";

const FIELD_STYLE: Record<string, string> = {
	display: "flex",
	"flex-direction": "column",
	gap: "6px",
	margin: "8px 0",
	"font-size": "14px",
};

export type AgentIntent = { text: string; form: string | null };

const CRAWLER_USER_AGENT =
	/bot(?:[/;)-]|$)|crawl|spider|slurp|scraper|indexer|archiver|externalhit|preview|inspectiontool|lighthouse|pagespeed/i;
const CRAWLER_TOKENS = ["googleother", "meta-externalagent"];
const CONTACT_URL = /\+?https?:\/\/\S+/gi;

/**
 * Crawlers, indexers, training bots, link previews and audit tools never fill
 * forms, so they get no intent field. Fetchers a person triggers, such as
 * ChatGPT-User or MistralAI-User, keep it, because they act for that person.
 */
export const skipsIntentField = (userAgent: string): boolean => {
	const product = userAgent.replace(CONTACT_URL, " ");
	const lowered = product.toLowerCase();
	return (
		CRAWLER_USER_AGENT.test(product) ||
		CRAWLER_TOKENS.some((token) => lowered.includes(token))
	);
};

type Entry = { wrapper: HTMLElement; field: HTMLTextAreaElement; sent: string };

const pathOf = (target: string | null, base: string): string | null => {
	try {
		return new URL(target ?? "", base).pathname;
	} catch {
		return null;
	}
};

export const readIntent = (value: string): string | null => {
	const text = value.trim().slice(0, MAX_INTENT_LENGTH);
	return text === "" ? null : text;
};

/**
 * A page with no agent is never touched. The field has no name, so no form
 * serialization includes it. `onIntent` returns whether it sent the answer.
 */
export const createIntentField = (input: {
	win: Window;
	doc: Document;
	onIntent: (intent: AgentIntent) => boolean;
}) => {
	const { win, doc, onIntent } = input;
	const entries = new Map<HTMLFormElement, Entry>();
	let hydrated = false;
	let shown = false;
	let stopped = false;
	let observer: MutationObserver | null = null;
	let settleTimer: ReturnType<typeof setTimeout> | null = null;

	const report = (
		form: HTMLFormElement,
		entry: Entry,
		target?: string | null,
	) => {
		const text = readIntent(entry.field.value);
		if (!text || text === entry.sent) {
			return;
		}
		const path = pathOf(
			target ?? form.getAttribute("action"),
			win.location.href,
		);
		if (onIntent({ text, form: path })) {
			entry.sent = text;
		}
	};

	const inject = (form: HTMLFormElement) => {
		if (
			!hydrated ||
			!shown ||
			stopped ||
			form.hasAttribute(OPT_OUT_ATTRIBUTE)
		) {
			return;
		}
		const existing = entries.get(form);
		if (existing) {
			if (existing.wrapper.parentElement !== form) {
				form.prepend(existing.wrapper);
			}
			return;
		}
		const id = `waniwani-agent-intent-${Math.random().toString(36).slice(2, 10)}`;
		const wrapper = doc.createElement("div");
		wrapper.setAttribute("data-waniwani-intent", "");
		const label = doc.createElement("label");
		label.htmlFor = id;
		label.textContent = INTENT_FIELD_LABEL;
		const field = doc.createElement("textarea");
		field.id = id;
		field.rows = 2;
		field.maxLength = MAX_INTENT_LENGTH;
		field.autocomplete = "off";
		field.placeholder = INTENT_FIELD_HINT;
		for (const [property, value] of Object.entries(FIELD_STYLE)) {
			wrapper.style.setProperty(property, value);
		}
		wrapper.append(label, field);
		form.prepend(wrapper);
		entries.set(form, { wrapper, field, sent: "" });
	};

	const injectAll = (root: ParentNode) => {
		for (const form of root.querySelectorAll("form")) {
			inject(form);
		}
	};

	const sweep = () => {
		for (const [form, entry] of entries) {
			if (!form.isConnected) {
				report(form, entry);
				entry.wrapper.remove();
				entries.delete(form);
			} else if (entry.wrapper.parentElement !== form) {
				form.prepend(entry.wrapper);
			}
		}
	};

	const activate = () => {
		if (!hydrated || !shown || stopped || observer) {
			return;
		}
		try {
			injectAll(doc);
			observer = new MutationObserver((records) => {
				for (const record of records) {
					for (const node of record.addedNodes) {
						if (node instanceof HTMLFormElement) {
							inject(node);
						} else if (node instanceof Element && node.firstElementChild) {
							injectAll(node);
						}
					}
				}
				sweep();
			});
			observer.observe(doc.body, { childList: true, subtree: true });
		} catch (error) {
			console.error("[Waniwani] Agent intent field setup failed", error);
		}
	};

	const entryFor = (target: EventTarget | null) => {
		if (!(target instanceof HTMLFormElement)) {
			return null;
		}
		const entry = entries.get(target);
		return entry ? { form: target, entry } : null;
	};

	const onSubmit = (event: Event) => {
		const found = entryFor(event.target);
		if (!found) {
			return;
		}
		const submitter = Reflect.get(event, "submitter");
		const formAction =
			submitter instanceof HTMLElement
				? submitter.getAttribute("formaction")
				: null;
		report(found.form, found.entry, formAction);
	};

	const onFormData = (event: Event) => {
		const found = entryFor(event.target);
		if (found) {
			report(found.form, found.entry);
		}
	};

	const onFocusIn = (event: Event) => {
		const form =
			event.target instanceof Element ? event.target.closest("form") : null;
		if (form) {
			inject(form);
		}
	};

	const reportAll = () => {
		for (const [form, entry] of entries) {
			report(form, entry);
		}
	};

	const onVisibilityChange = () => {
		if (doc.visibilityState === "hidden") {
			reportAll();
		}
	};

	const markHydrated = () => {
		hydrated = true;
		activate();
	};

	const settle = () => {
		settleTimer = setTimeout(() => {
			if (typeof win.requestIdleCallback === "function") {
				win.requestIdleCallback(markHydrated, { timeout: SETTLE_DELAY_MS });
			} else {
				markHydrated();
			}
		}, SETTLE_DELAY_MS);
	};

	if (doc.readyState === "complete") {
		settle();
	} else {
		win.addEventListener("load", settle, { once: true });
	}
	win.addEventListener("submit", onSubmit, { capture: true });
	doc.addEventListener("formdata", onFormData, { capture: true });
	doc.addEventListener("focusin", onFocusIn);
	doc.addEventListener("visibilitychange", onVisibilityChange);
	win.addEventListener("pagehide", reportAll);

	return {
		reveal: () => {
			shown = true;
			activate();
		},
		stop: () => {
			stopped = true;
			if (settleTimer) {
				clearTimeout(settleTimer);
			}
			observer?.disconnect();
			win.removeEventListener("load", settle);
			win.removeEventListener("submit", onSubmit, { capture: true });
			doc.removeEventListener("formdata", onFormData, { capture: true });
			doc.removeEventListener("focusin", onFocusIn);
			doc.removeEventListener("visibilitychange", onVisibilityChange);
			win.removeEventListener("pagehide", reportAll);
			for (const entry of entries.values()) {
				entry.wrapper.remove();
			}
			entries.clear();
		},
	};
};
