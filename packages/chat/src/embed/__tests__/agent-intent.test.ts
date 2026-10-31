import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	jest,
	spyOn,
	test,
} from "bun:test";
import { Window } from "happy-dom";
import {
	type AgentIntent,
	createIntentField,
	skipsIntentField,
} from "../agent-intent";

const GLOBAL_KEYS = [
	"window",
	"document",
	"HTMLElement",
	"HTMLFormElement",
	"Element",
	"MutationObserver",
	"FormData",
	"WeakRef",
] as const;
const originals = new Map(
	GLOBAL_KEYS.map((key) => [key, Reflect.get(globalThis, key)]),
);

const SELECTOR = "[data-waniwani-intent] textarea";

type Form = InstanceType<Window["HTMLFormElement"]>;

class StrongRef<T> {
	readonly #value: T;
	constructor(value: T) {
		this.#value = value;
	}
	deref(): T {
		return this.#value;
	}
}

let win: Window;
let intents: AgentIntent[];
let offers: AgentIntent[];
let accept: (intent: AgentIntent) => boolean;
let handles: ReturnType<typeof createIntentField>[];

const define = (target: object, key: string, value: unknown) => {
	Object.defineProperty(target, key, {
		configurable: true,
		writable: true,
		value,
	});
};

const installPage = () => {
	win = new Window({
		url: "https://shop.example/pricing?plan=pro",
		settings: {
			disableIframePageLoading: true,
			disableJavaScriptFileLoading: true,
			disableCSSFileLoading: true,
		},
	});
	Object.assign(win, { SyntaxError });
	for (const key of GLOBAL_KEYS) {
		if (key === "WeakRef") {
			continue;
		}
		Object.assign(globalThis, {
			[key]: key === "window" ? win : Reflect.get(win, key),
		});
	}
	// happy-dom keeps each MutationObserver callback only behind a WeakRef, so a garbage collection drops mutations at random.
	Object.assign(globalThis, { WeakRef: StrongRef });
	define(win.document, "readyState", "complete");
	define(win.document, "visibilityState", "visible");
	intents = [];
	offers = [];
	accept = () => true;
	handles = [];
};

const start = () => {
	const handle = createIntentField({
		win: window,
		doc: document,
		onIntent: (intent) => {
			offers.push(intent);
			const accepted = accept(intent);
			if (accepted) {
				intents.push(intent);
			}
			return accepted;
		},
	});
	handles.push(handle);
	return handle;
};

const startActive = () => {
	const handle = start();
	handle.reveal();
	jest.advanceTimersByTime(1_000);
	return handle;
};

const addForm = (input: { action?: string; optOut?: boolean } = {}) => {
	const form = win.document.createElement("form");
	if (input.action !== undefined) {
		form.setAttribute("action", input.action);
	}
	if (input.optOut) {
		form.setAttribute("data-waniwani-no-intent", "");
	}
	form.innerHTML =
		'<input type="hidden" name="csrf" value="t"><input name="email" value="a@b.example"><button type="submit" name="go" value="1">Go</button>';
	win.document.body.append(form);
	return form;
};

const fieldsIn = (root: {
	querySelectorAll: (selector: string) => ArrayLike<unknown>;
}) =>
	Array.from(root.querySelectorAll(SELECTOR)).filter(
		(node): node is InstanceType<typeof win.HTMLTextAreaElement> =>
			node instanceof win.HTMLTextAreaElement,
	);

const fieldOf = (form: Form) => {
	const found = fieldsIn(form);
	const [field] = found;
	if (!field || found.length > 1) {
		throw new Error(`expected one intent field, found ${found.length}`);
	}
	return field;
};

const wrapperOf = (form: Form) => {
	const wrapper = fieldOf(form).closest("[data-waniwani-intent]");
	if (!(wrapper instanceof win.HTMLElement)) {
		throw new Error("intent field has no wrapper");
	}
	return wrapper;
};

const ownNames = (form: Form) =>
	Array.from(form.children)
		.filter((child) => !child.hasAttribute("data-waniwani-intent"))
		.map((child) => child.getAttribute("name"));

const focusIn = (form: Form) => {
	form
		.querySelector('input[name="email"]')
		?.dispatchEvent(new win.FocusEvent("focusin", { bubbles: true }));
};

const submit = (form: Form, submitter?: unknown) => {
	const event = new win.Event("submit", { bubbles: true, cancelable: true });
	if (submitter !== undefined) {
		define(event, "submitter", submitter);
	}
	form.dispatchEvent(event);
	return event;
};

// happy-dom never fires formdata itself, so the test builds the data and dispatches the event the way a browser would.
const buildFormData = (form: Form) => {
	const data = new win.FormData(form);
	const event = new win.Event("formdata", { bubbles: true });
	define(event, "formData", data);
	form.dispatchEvent(event);
	return data;
};

const setVisibility = (state: "hidden" | "visible") => {
	define(win.document, "visibilityState", state);
	win.document.dispatchEvent(new win.Event("visibilitychange"));
};

const pageHide = () => {
	win.dispatchEvent(new win.Event("pagehide"));
};

const installLoadingPage = async () => {
	jest.useRealTimers();
	installPage();
	// happy-dom fires its own load event on a timer, so let it pass before pretending the page is still loading.
	await new Promise((resolve) => setTimeout(resolve, 20));
	define(win.document, "readyState", "loading");
	jest.useFakeTimers();
};

const flushMutations = async () => {
	jest.useRealTimers();
	for (let round = 0; round < 3; round += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};

beforeEach(() => {
	installPage();
	jest.useFakeTimers();
});

afterEach(() => {
	for (const handle of handles) {
		handle.stop();
	}
	jest.useRealTimers();
});

afterAll(() => {
	for (const [key, value] of originals) {
		Object.assign(globalThis, { [key]: value });
	}
});

describe("a page where no agent is seen", () => {
	test("its forms stay byte-identical through settle, focus, submit, form data and hide", () => {
		const first = addForm({ action: "/quote" });
		const second = addForm();
		const before = [first.outerHTML, second.outerHTML];
		const counts = [first.children.length, second.children.length];
		start();

		jest.advanceTimersByTime(30_000);
		focusIn(first);
		submit(first);
		buildFormData(second);
		setVisibility("hidden");
		pageHide();

		expect([first.children.length, second.children.length]).toEqual(counts);
		expect([first.outerHTML, second.outerHTML]).toEqual(before);
		expect(offers).toEqual([]);
	});

	test("a form added later is left alone too", async () => {
		start();
		jest.advanceTimersByTime(30_000);

		const form = addForm();
		const before = form.outerHTML;
		await flushMutations();

		expect(form.outerHTML).toBe(before);
	});

	test("no mutation observer is ever created", () => {
		let created = 0;
		const Base = win.MutationObserver;
		Object.assign(globalThis, {
			MutationObserver: class extends Base {
				constructor(callback: ConstructorParameters<typeof Base>[0]) {
					super(callback);
					created += 1;
				}
			},
		});
		addForm();
		start();

		jest.advanceTimersByTime(30_000);

		expect(created).toBe(0);
	});
});

describe("when the field is added", () => {
	test("reveal before the page settles adds fields exactly when it settles", () => {
		const form = addForm();
		start().reveal();

		jest.advanceTimersByTime(999);
		expect(fieldsIn(form)).toHaveLength(0);
		jest.advanceTimersByTime(1);

		expect(fieldsIn(form)).toHaveLength(1);
	});

	test("reveal after the page settled adds fields at once", () => {
		const form = addForm();
		const handle = start();
		jest.advanceTimersByTime(5_000);
		expect(fieldsIn(form)).toHaveLength(0);

		handle.reveal();

		expect(fieldsIn(form)).toHaveLength(1);
	});

	test("revealing again adds no second field", () => {
		const form = addForm();
		const handle = startActive();

		handle.reveal();
		handle.reveal();

		expect(fieldsIn(form)).toHaveLength(1);
	});

	test("a page that never goes idle still gets its fields one second after the settle delay", () => {
		define(
			win,
			"requestIdleCallback",
			(callback: () => void, options?: { timeout?: number }) =>
				setTimeout(callback, options?.timeout ?? 60_000),
		);
		const form = addForm();
		start().reveal();

		jest.advanceTimersByTime(1_999);
		expect(fieldsIn(form)).toHaveLength(0);
		jest.advanceTimersByTime(1);

		expect(fieldsIn(form)).toHaveLength(1);
	});

	test("an idle page gets its fields as soon as it goes idle after the settle delay", () => {
		define(win, "requestIdleCallback", (callback: () => void) =>
			setTimeout(callback, 10),
		);
		const form = addForm();
		start().reveal();

		jest.advanceTimersByTime(1_009);
		expect(fieldsIn(form)).toHaveLength(0);
		jest.advanceTimersByTime(1);

		expect(fieldsIn(form)).toHaveLength(1);
	});

	test("a page still loading gets nothing until it loads, then a second later", async () => {
		await installLoadingPage();
		const form = addForm();
		start().reveal();

		jest.advanceTimersByTime(30_000);
		expect(fieldsIn(form)).toHaveLength(0);
		win.dispatchEvent(new win.Event("load"));
		jest.advanceTimersByTime(999);
		expect(fieldsIn(form)).toHaveLength(0);
		jest.advanceTimersByTime(1);

		expect(fieldsIn(form)).toHaveLength(1);
	});

	test("focusing inside a form after settle but with no reveal adds nothing", () => {
		const form = addForm();
		start();
		jest.advanceTimersByTime(5_000);

		focusIn(form);

		expect(fieldsIn(form)).toHaveLength(0);
	});

	test("focusing inside a form after reveal but before settle adds nothing", () => {
		const form = addForm();
		start().reveal();

		focusIn(form);

		expect(fieldsIn(form)).toHaveLength(0);
	});

	test("a form marked data-waniwani-no-intent gets no field, while the others still do", () => {
		const optedOut = addForm({ optOut: true });
		const other = addForm();
		const before = optedOut.outerHTML;
		startActive();
		focusIn(optedOut);

		expect(optedOut.outerHTML).toBe(before);
		expect(fieldsIn(other)).toHaveLength(1);
	});

	test("forms added after activation get their field first, including one nested in added markup", async () => {
		startActive();

		const direct = addForm();
		const section = win.document.createElement("section");
		section.innerHTML =
			'<div><form action="/later"><input type="hidden" name="csrf"><input name="x"></form></div>';
		win.document.body.append(section);
		await flushMutations();

		expect(fieldsIn(direct)).toHaveLength(1);
		expect(direct.firstElementChild).toBe(wrapperOf(direct));
		const nested = section.querySelector("form");
		expect(nested ? fieldsIn(nested) : []).toHaveLength(1);
		expect(
			nested?.firstElementChild?.hasAttribute("data-waniwani-intent"),
		).toBe(true);
	});

	test("a marked form added after activation gets no field", async () => {
		startActive();

		const optedOut = addForm({ optOut: true });
		const before = optedOut.outerHTML;
		await flushMutations();

		expect(optedOut.outerHTML).toBe(before);
	});

	test("a failure during activation is logged, never thrown into the page", () => {
		const errors = spyOn(console, "error").mockImplementation(() => {});
		Object.assign(globalThis, {
			MutationObserver: class {
				constructor() {
					throw new Error("observer blocked");
				}
			},
		});
		addForm();
		const handle = start();

		expect(() => {
			handle.reveal();
			jest.advanceTimersByTime(1_000);
		}).not.toThrow();
		expect(errors).toHaveBeenCalled();
		errors.mockRestore();
	});
});

describe("how the field looks and where it sits", () => {
	test("the field is visible, focusable, unnamed and never required", () => {
		const form = addForm();
		startActive();

		const field = fieldOf(form);
		const style = wrapperOf(form).style;
		expect(style.getPropertyValue("display")).toBe("flex");
		expect(style.getPropertyValue("width")).toBe("");
		expect(style.getPropertyValue("clip-path")).toBe("");
		expect(style.getPropertyValue("position")).toBe("");
		expect(field.hasAttribute("tabindex")).toBe(false);
		expect(field.hasAttribute("name")).toBe(false);
		expect(field.hasAttribute("toolparamtitle")).toBe(false);
		expect(field.hasAttribute("toolparamdescription")).toBe(false);
		expect(field.required).toBe(false);
		expect(field.maxLength).toBe(300);
		expect(field.getAttribute("autocomplete")).toBe("off");
		expect(form.checkValidity()).toBe(true);
	});

	test("each field has its own random id, named by its own label", () => {
		const first = addForm();
		const second = addForm();
		startActive();

		const ids = [fieldOf(first).id, fieldOf(second).id];
		expect(new Set(ids).size).toBe(2);
		for (const form of [first, second]) {
			const field = fieldOf(form);
			expect(field.id).toMatch(/^waniwani-agent-intent-[a-z0-9]+$/);
			const label = wrapperOf(form).querySelector("label");
			expect(label?.getAttribute("for")).toBe(field.id);
			expect(label?.textContent?.trim().length).toBeGreaterThan(0);
		}
	});

	test("the wrapper is the form's first child, before a leading hidden input, and the form's own order is kept", () => {
		const form = addForm();
		startActive();

		expect(form.firstElementChild).toBe(wrapperOf(form));
		expect(form.children[1]?.getAttribute("type")).toBe("hidden");
		expect(ownNames(form)).toEqual(["csrf", "email", "go"]);
	});

	test("an empty form gets the field as its only child", () => {
		const form = win.document.createElement("form");
		win.document.body.append(form);
		startActive();

		expect(form.children).toHaveLength(1);
		expect(form.firstElementChild).toBe(wrapperOf(form));
	});
});

describe("the answer never reaches the form's own data", () => {
	test("new FormData(form) never holds the answer", () => {
		const form = addForm();
		startActive();
		fieldOf(form).value = "Secret agent purpose";

		const data = new win.FormData(form);

		expect([...data.keys()].sort()).toEqual(["csrf", "email"]);
		expect([...data.values()]).not.toContain("Secret agent purpose");
	});

	test("a form serialized by walking its named elements never holds the answer", () => {
		const form = addForm();
		startActive();
		fieldOf(form).value = "Secret agent purpose";

		const named = Array.from(form.elements).filter(
			(element) => (element.getAttribute("name") ?? "") !== "",
		);

		expect(named.map((element) => element.getAttribute("name"))).toEqual([
			"csrf",
			"email",
			"go",
		]);
		const field = fieldOf(form);
		expect(named.some((element) => element === field)).toBe(false);
	});

	test("the formdata event leaves the data the page built untouched", () => {
		const form = addForm();
		startActive();
		fieldOf(form).value = "Secret agent purpose";

		const data = buildFormData(form);

		expect([...data.entries()]).toEqual([
			["csrf", "t"],
			["email", "a@b.example"],
		]);
	});

	test("the field stays enabled through a submit, and the submit goes ahead", () => {
		const form = addForm();
		startActive();
		const field = fieldOf(form);
		field.value = "Filing a claim";
		let disabledDuringSubmit: boolean | null = null;
		form.addEventListener("submit", () => {
			disabledDuringSubmit = field.disabled;
		});

		const event = submit(form);

		expect(disabledDuringSubmit).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});
});

describe("re-render recovery", () => {
	test("a wrapper removed by replaceChildren comes back first, holding the typed text", async () => {
		const form = addForm();
		startActive();
		const wrapper = wrapperOf(form);
		fieldOf(form).value = "Half typed answer";
		const email = win.document.createElement("input");
		email.setAttribute("name", "email");

		form.replaceChildren(email);
		await flushMutations();

		expect(form.firstElementChild).toBe(wrapper);
		expect(fieldsIn(form)).toHaveLength(1);
		expect(fieldOf(form).value).toBe("Half typed answer");
		expect(ownNames(form)).toEqual(["email"]);
	});

	test("a restored answer is still reported once", async () => {
		const form = addForm({ action: "/quote" });
		startActive();
		fieldOf(form).value = "Restored answer";

		wrapperOf(form).remove();
		await flushMutations();
		submit(form);
		submit(form);

		expect(intents).toEqual([{ text: "Restored answer", form: "/quote" }]);
	});

	test("a removed form with an unsent answer is reported once, then forgotten", async () => {
		const form = addForm({ action: "/quote" });
		startActive();
		fieldOf(form).value = "Leaving mid-flow";

		form.remove();
		await flushMutations();
		expect(intents).toEqual([{ text: "Leaving mid-flow", form: "/quote" }]);

		setVisibility("hidden");
		pageHide();
		expect(offers).toHaveLength(1);
	});

	test("a removed form whose answer was already sent is not reported again", async () => {
		const form = addForm();
		startActive();
		fieldOf(form).value = "Sent already";
		submit(form);

		form.remove();
		await flushMutations();

		expect(offers).toHaveLength(1);
	});

	test("a removed form with an empty field reports nothing", async () => {
		const form = addForm();
		startActive();

		form.remove();
		await flushMutations();

		expect(offers).toEqual([]);
	});

	test("a form moved into a new container holds exactly one field, with its answer", async () => {
		const form = addForm();
		startActive();
		fieldOf(form).value = "Moving along";

		const container = win.document.createElement("div");
		win.document.body.append(container);
		container.append(form);
		await flushMutations();

		expect(fieldsIn(form)).toHaveLength(1);
		expect(form.firstElementChild).toBe(wrapperOf(form));
		expect(fieldOf(form).value).toBe("Moving along");
	});

	test("a form taken out and put back holds exactly one field", async () => {
		const form = addForm();
		startActive();

		form.remove();
		await flushMutations();
		win.document.body.append(form);
		await flushMutations();

		expect(fieldsIn(form)).toHaveLength(1);
	});
});

describe("reporting an answer", () => {
	const filledForm = (value: string, action?: string) => {
		const form = addForm({ action });
		startActive();
		fieldOf(form).value = value;
		return form;
	};

	test("a submitted answer is reported trimmed, with the path of the form's action", () => {
		const form = filledForm(
			"  \n Comparing pet insurance for a client \t ",
			"https://shop.example/quote/pets?x=1#y",
		);

		submit(form);

		expect(intents).toEqual([
			{ text: "Comparing pet insurance for a client", form: "/quote/pets" },
		]);
	});

	test("a relative action resolves against the page", () => {
		const form = filledForm("Checking prices", "checkout?step=2");

		submit(form);

		expect(intents).toEqual([{ text: "Checking prices", form: "/checkout" }]);
	});

	test("a form with no action reports the page's own path", () => {
		const form = filledForm("Checking prices");

		submit(form);

		expect(intents).toEqual([{ text: "Checking prices", form: "/pricing" }]);
	});

	test("a submit button's formaction wins over the form's action", () => {
		const form = filledForm("Checking prices", "/quote");
		const button = win.document.createElement("button");
		button.setAttribute("formaction", "/checkout/pay?x=1");
		form.append(button);

		submit(form, button);

		expect(intents).toEqual([
			{ text: "Checking prices", form: "/checkout/pay" },
		]);
	});

	test("a submit button without formaction keeps the form's action", () => {
		const form = filledForm("Checking prices", "/quote");
		const button = win.document.createElement("button");
		form.append(button);

		submit(form, button);

		expect(intents).toEqual([{ text: "Checking prices", form: "/quote" }]);
	});

	test("building the form's data reports the form's action, with no submit event", () => {
		const form = filledForm("Comparing quotes", "/quote?step=1");

		buildFormData(form);

		expect(intents).toEqual([{ text: "Comparing quotes", form: "/quote" }]);
	});

	test("an empty field reports nothing on any trigger", () => {
		const form = filledForm("");

		submit(form);
		buildFormData(form);
		setVisibility("hidden");
		pageHide();

		expect(offers).toEqual([]);
	});

	test("a field holding only whitespace reports nothing", () => {
		const form = filledForm(" \n\t  ");

		submit(form);
		pageHide();

		expect(offers).toEqual([]);
	});

	for (const [length, expected] of [
		[299, 299],
		[300, 300],
		[301, 300],
		[5_000, 300],
	]) {
		test(`an answer of ${length} characters is reported with ${expected}`, () => {
			const text = `${"a".repeat(length - 1)}z`;
			const form = filledForm(text);

			submit(form);

			expect(intents).toHaveLength(1);
			expect(intents[0]?.text).toBe(text.slice(0, expected));
			expect(intents[0]?.text.length).toBe(expected);
		});
	}

	test("the cut to 300 characters applies after trimming", () => {
		const body = "b".repeat(300);
		const form = filledForm(`      ${body}      `);

		buildFormData(form);

		expect(intents[0]?.text).toBe(body);
	});

	test("the same answer through every trigger is reported once", () => {
		const form = filledForm("Planning a trip");

		buildFormData(form);
		submit(form);
		fieldOf(form).value = "  Planning a trip  ";
		submit(form);
		setVisibility("hidden");
		pageHide();

		expect(offers.map((intent) => intent.text)).toEqual(["Planning a trip"]);
	});

	test("a changed answer is reported again", () => {
		const form = filledForm("first answer");

		submit(form);
		fieldOf(form).value = "second answer";
		buildFormData(form);

		expect(intents.map((intent) => intent.text)).toEqual([
			"first answer",
			"second answer",
		]);
	});

	test("submitting one form reports only that form's answer", () => {
		const first = addForm({ action: "/one" });
		const second = addForm({ action: "/two" });
		startActive();
		fieldOf(first).value = "answer one";
		fieldOf(second).value = "answer two";

		submit(second);

		expect(intents).toEqual([{ text: "answer two", form: "/two" }]);
	});

	test("a filled answer is reported when the page turns hidden, and not when it turns visible", () => {
		filledForm("Reading the pricing page", "/quote");

		setVisibility("visible");
		expect(offers).toEqual([]);
		setVisibility("hidden");

		expect(intents).toEqual([
			{ text: "Reading the pricing page", form: "/quote" },
		]);
	});

	test("a filled answer never submitted is reported on pagehide", () => {
		filledForm("Reading the pricing page", "/quote");

		pageHide();

		expect(intents).toEqual([
			{ text: "Reading the pricing page", form: "/quote" },
		]);
	});

	test("a submit or form data from a form that opted out reports nothing", () => {
		const optedOut = addForm({ optOut: true });
		startActive();

		submit(optedOut);
		buildFormData(optedOut);

		expect(offers).toEqual([]);
	});
});

describe("an answer the receiver refuses", () => {
	test("is offered again on the next trigger and sent once it is accepted", () => {
		const form = addForm({ action: "/quote" });
		startActive();
		fieldOf(form).value = "Waiting for a signal";
		accept = () => false;

		submit(form);
		expect(intents).toEqual([]);
		accept = () => true;
		setVisibility("hidden");
		pageHide();
		submit(form);

		expect(offers.map((intent) => intent.text)).toEqual([
			"Waiting for a signal",
			"Waiting for a signal",
		]);
		expect(intents).toEqual([{ text: "Waiting for a signal", form: "/quote" }]);
	});

	test("is never marked sent while it keeps being refused", () => {
		const form = addForm();
		startActive();
		fieldOf(form).value = "Past the cap";
		accept = () => false;

		submit(form);
		buildFormData(form);
		setVisibility("hidden");
		pageHide();

		expect(offers).toHaveLength(4);
		expect(intents).toEqual([]);
	});

	test("a removed form whose answer was refused is still forgotten", async () => {
		const form = addForm();
		startActive();
		fieldOf(form).value = "Gone";
		accept = () => false;

		form.remove();
		await flushMutations();
		accept = () => true;
		pageHide();

		expect(offers).toHaveLength(1);
		expect(intents).toEqual([]);
	});
});

describe("stopping the intent field", () => {
	test("stop removes every field it added and leaves the form as it was", () => {
		const form = addForm();
		const before = form.outerHTML;
		const handle = startActive();

		handle.stop();

		expect(form.querySelectorAll("[data-waniwani-intent]")).toHaveLength(0);
		expect(form.outerHTML).toBe(before);
	});

	test("after stop, no trigger reports, even with a filled field put back", () => {
		const form = addForm();
		const handle = startActive();
		const textarea = fieldOf(form);
		textarea.value = "Too late";

		handle.stop();
		form.append(textarea);
		submit(form);
		buildFormData(form);
		setVisibility("hidden");
		pageHide();

		expect(offers).toEqual([]);
	});

	test("stopping before the page settles means no field ever appears, even after reveal", () => {
		const form = addForm();
		const handle = start();

		handle.stop();
		handle.reveal();
		jest.advanceTimersByTime(10_000);

		expect(fieldsIn(form)).toHaveLength(0);
	});

	test("stopping before a loading page loads means no field ever appears", async () => {
		await installLoadingPage();
		const form = addForm();
		const handle = start();
		handle.reveal();

		handle.stop();
		win.dispatchEvent(new win.Event("load"));
		jest.advanceTimersByTime(10_000);

		expect(fieldsIn(form)).toHaveLength(0);
	});

	test("stopping while waiting for the idle callback means no field appears when it runs", () => {
		define(
			win,
			"requestIdleCallback",
			(callback: () => void, options?: { timeout?: number }) =>
				setTimeout(callback, options?.timeout ?? 60_000),
		);
		const form = addForm();
		const handle = start();
		handle.reveal();
		jest.advanceTimersByTime(1_000);

		handle.stop();
		jest.advanceTimersByTime(10_000);

		expect(fieldsIn(form)).toHaveLength(0);
	});

	test("after stop, focus adds nothing and a form added later gets nothing", async () => {
		const existing = addForm();
		const handle = startActive();

		handle.stop();
		focusIn(existing);
		const later = addForm();
		await flushMutations();

		expect(fieldsIn(existing)).toHaveLength(0);
		expect(fieldsIn(later)).toHaveLength(0);
	});

	test("after stop, a removed form with an answer reports nothing", async () => {
		const form = addForm();
		const handle = startActive();
		fieldOf(form).value = "Unsent";

		handle.stop();
		form.remove();
		await flushMutations();

		expect(offers).toEqual([]);
	});
});

describe("skipsIntentField", () => {
	const crawlers: [string, string][] = [
		[
			"Googlebot desktop",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.6778.204 Safari/537.36",
		],
		[
			"Googlebot classic",
			"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		],
		[
			"Googlebot smartphone",
			"Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.204 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		],
		[
			"Google-InspectionTool",
			"Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
		],
		[
			"bingbot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
		],
		[
			"BingPreview",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0 BingPreview/1.0b",
		],
		[
			"Applebot",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
		],
		[
			"YandexBot",
			"Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
		],
		[
			"DuckDuckBot",
			"DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
		],
		[
			"PetalBot",
			"Mozilla/5.0 (compatible;PetalBot;+https://webmaster.petalsearch.com/site/petalbot)",
		],
		[
			"Amazonbot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36",
		],
		[
			"GPTBot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
		],
		[
			"OAI-SearchBot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
		],
		[
			"ClaudeBot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
		],
		[
			"Claude-SearchBot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)",
		],
		[
			"PerplexityBot",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
		],
		[
			"Bytespider",
			"Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
		],
		["CCBot", "CCBot/2.0 (https://commoncrawl.org/faq/)"],
		[
			"FirecrawlAgent",
			"Mozilla/5.0 (compatible; FirecrawlAgent/1.0; +https://firecrawl.dev)",
		],
		[
			"YouBot",
			"Mozilla/5.0 (compatible; YouBot/1.0; +https://about.you.com/youbot/)",
		],
		[
			"DuckAssistBot",
			"DuckAssistBot/1.1; (+http://duckduckgo.com/duckassistbot.html)",
		],
		["GoogleOther", "Mozilla/5.0 (compatible; GoogleOther)"],
		[
			"meta-externalagent",
			"meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
		],
		[
			"facebookexternalhit",
			"facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
		],
		["Twitterbot", "Twitterbot/1.0"],
		[
			"LinkedInBot",
			"LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
		],
		[
			"Slackbot-LinkExpanding",
			"Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
		],
		[
			"Discordbot",
			"Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
		],
		[
			"Chrome-Lighthouse",
			"Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
		],
	];

	const browsers: [string, string][] = [
		[
			"desktop Chrome",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
		],
		[
			"Safari on iPhone",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
		],
		[
			"Firefox",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
		],
		[
			"Edge",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
		],
		[
			"HeadlessChrome with no bot token",
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36",
		],
		[
			"Manus",
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36; Manus-User/1.0",
		],
		[
			"the Claude desktop app",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/3.1623.4 Chrome/152.0.7977.167 Safari/537.36",
		],
		[
			"Samsung Internet",
			"Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
		],
		[
			"Chrome on a Cubot phone",
			"Mozilla/5.0 (Linux; Android 11; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
		],
		[
			"ChatGPT-User",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
		],
		[
			"Claude-User",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
		],
		[
			"Perplexity-User",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
		],
		[
			"MistralAI-User",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)",
		],
		[
			"MistralAI-User rendered in HeadlessChrome",
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36 MistralAI-User/1.0 (+https://docs.mistral.ai/robots)",
		],
		[
			"meta-externalfetcher",
			"meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
		],
		[
			"Chrome on a Cubot phone with an underscore model name",
			"Mozilla/5.0 (Linux; Android 10; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
		],
		["an empty user agent", ""],
	];

	for (const [name, userAgent] of crawlers) {
		test(`${name} gets no intent field`, () => {
			expect(skipsIntentField(userAgent)).toBe(true);
		});
	}

	for (const [name, userAgent] of browsers) {
		test(`${name} keeps the intent field`, () => {
			expect(skipsIntentField(userAgent)).toBe(false);
		});
	}

	test("GoogleOther is matched whatever its case", () => {
		expect(skipsIntentField("Mozilla/5.0 (compatible; GOOGLEOTHER)")).toBe(
			true,
		);
		expect(skipsIntentField("googleother")).toBe(true);
	});
});
