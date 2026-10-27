import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	jest,
	test,
} from "bun:test";
import { Window } from "happy-dom";
import {
	createInputWatcher,
	readEnvironmentSignals,
	resolveBeaconEndpoint,
	startAgentBeacon,
} from "../agent-beacon";

const GLOBAL_KEYS = [
	"window",
	"document",
	"navigator",
	"location",
	"Event",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"WheelEvent",
	"InputEvent",
	"HTMLElement",
	"HTMLFormElement",
	"Element",
	"MutationObserver",
	"FormData",
	"matchMedia",
	"fetch",
] as const;
const originals = new Map(
	GLOBAL_KEYS.map((key) => [key, Reflect.get(globalThis, key)]),
);

const PAGE = "https://shop.example/pricing?plan=pro&email=a%40b.example#faq";
const API = "https://app.waniwani.ai/api/mcp/chat";
const TOKEN = "wwp_public";
const CHROME_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const HEADLESS_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36";
const KNOWN_SIGNALS = [
	"webdriver",
	"headless",
	"automation_global",
	"untrusted_input",
	"click_without_motion",
	"pointer_teleport",
];

type Sent = { url: string; init: RequestInit | undefined };

let win: Window;
let sent: Sent[];
let beaconCalls: number;

const define = (target: object, key: string, value: unknown) => {
	Object.defineProperty(target, key, {
		configurable: true,
		writable: true,
		value,
	});
};

const installPage = (input: { url?: string; referrer?: string } = {}) => {
	win = new Window({
		url: input.url ?? PAGE,
		settings: {
			disableIframePageLoading: true,
			disableJavaScriptFileLoading: true,
			disableCSSFileLoading: true,
		},
	});
	for (const key of GLOBAL_KEYS) {
		if (key === "window" || key === "fetch") {
			continue;
		}
		Object.assign(globalThis, { [key]: Reflect.get(win, key) });
	}
	Object.assign(globalThis, { window: win });
	Object.assign(win, { SyntaxError });
	define(win.navigator, "webdriver", false);
	define(win.navigator, "userAgent", CHROME_UA);
	define(win.document, "referrer", input.referrer ?? "");
	define(win.document, "visibilityState", "visible");
	define(win.document, "readyState", "complete");
	sent = [];
	beaconCalls = 0;
	define(win.navigator, "sendBeacon", () => {
		beaconCalls += 1;
		return true;
	});
	Object.assign(globalThis, {
		fetch: async (input: string | URL | Request, init?: RequestInit) => {
			sent.push({ url: String(input), init });
			return new Response(null, { status: 204 });
		},
	});
};

const payloads = async (): Promise<Record<string, unknown>[]> =>
	sent.map((entry) => JSON.parse(String(entry.init?.body)));

const headerOf = (init: RequestInit | undefined, name: string): string | null =>
	new Headers(init?.headers).get(name);

const trusted = <T extends object>(event: T): T => {
	define(event, "isTrusted", true);
	return event;
};

const move = (x: number, y: number) =>
	trusted(new win.MouseEvent("mousemove", { clientX: x, clientY: y }));

const press = (x: number, y: number, pointerType = "mouse") =>
	trusted(
		new win.PointerEvent("pointerdown", {
			clientX: x,
			clientY: y,
			pointerType,
		}),
	);

const fire = (event: unknown) => {
	if (event instanceof win.Event) {
		win.dispatchEvent(event);
	}
};

const typeInto = (
	target: InstanceType<typeof win.HTMLElement>,
	inputType = "insertText",
) => {
	target.dispatchEvent(
		trusted(new win.InputEvent("input", { inputType, bubbles: true })),
	);
};

const keyOn = (target: InstanceType<typeof win.HTMLElement>) => {
	target.dispatchEvent(
		trusted(new win.KeyboardEvent("keydown", { key: "a", bubbles: true })),
	);
};

const addField = () => {
	const field = win.document.createElement("textarea");
	win.document.body.append(field);
	return field;
};

const addForm = (action = "/quote?plan=pro") => {
	const form = win.document.createElement("form");
	form.setAttribute("action", action);
	form.append(win.document.createElement("input"));
	win.document.body.append(form);
	return form;
};

const intentFieldOf = (form: InstanceType<typeof win.HTMLFormElement>) => {
	const field = form.querySelector("[data-waniwani-intent] textarea");
	if (!(field instanceof win.HTMLTextAreaElement)) {
		throw new Error("form has no intent field");
	}
	return field;
};

const submit = (form: InstanceType<typeof win.HTMLFormElement>) => {
	form.dispatchEvent(
		new win.Event("submit", { bubbles: true, cancelable: true }),
	);
};

const hidePage = () => {
	define(win.document, "visibilityState", "hidden");
	win.document.dispatchEvent(new win.Event("visibilitychange"));
	win.dispatchEvent(new win.Event("pagehide"));
};

beforeEach(() => {
	installPage();
});

afterEach(() => {
	jest.useRealTimers();
});

afterAll(() => {
	for (const [key, value] of originals) {
		Object.assign(globalThis, { [key]: value });
	}
});

describe("readEnvironmentSignals", () => {
	test("an ordinary browser shows no signal", () => {
		expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([]);
	});

	test("a browser driven over WebDriver says so", () => {
		define(navigator, "webdriver", true);

		expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([
			"webdriver",
		]);
	});

	test("a headless user agent is headless", () => {
		define(navigator, "userAgent", HEADLESS_UA);

		expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([
			"headless",
		]);
	});

	test("a headless brand in the client hints is headless even behind an ordinary user agent", () => {
		define(navigator, "userAgentData", {
			brands: [{ brand: "Chromium" }, { brand: "HeadlessChrome" }],
		});

		expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([
			"headless",
		]);
	});

	for (const name of [
		"__playwright__binding__",
		"__pwInitScripts",
		"callPhantom",
		"_phantom",
		"__nightmare",
		"domAutomation",
		"__selenium_unwrapped",
		"__webdriver_evaluate",
	]) {
		test(`the ${name} global on the page is an automation global`, () => {
			define(window, name, () => {});

			expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([
				"automation_global",
			]);
		});
	}

	for (const key of [
		"$cdc_asdjflasutopfhvcZLmcfl_",
		"cdc_adoQpoasnfa76pfcZLmcfl_",
	]) {
		test(`the ChromeDriver key ${key} on the document is an automation global`, () => {
			Reflect.set(document, key, {});

			expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([
				"automation_global",
			]);
		});
	}

	for (const key of [
		"cdc_adoQpoasnfa76pfcZLmcfl_Array",
		"cdc_adoQpoasnfa76pfcZLmcfl_Promise",
	]) {
		test(`the ChromeDriver key ${key} on the window is an automation global`, () => {
			Reflect.set(window, key, () => {});

			expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([
				"automation_global",
			]);
		});
	}

	test("a ChromeDriver key on both the window and the document is one signal", () => {
		Reflect.set(window, "cdc_adoQpoasnfa76pfcZLmcfl_Symbol", {});
		Reflect.set(document, "$cdc_asdjflasutopfhvcZLmcfl_", {});

		expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([
			"automation_global",
		]);
	});

	for (const key of ["xcdc_abc", "cdcx", "cdc", "my_cdc_value", "$cdcx_"]) {
		test(`the look-alike ${key} on the window is not an automation global`, () => {
			Reflect.set(window, key, {});

			expect(readEnvironmentSignals({ win: window, doc: document })).toEqual(
				[],
			);
		});
	}

	test("a page global that only mentions playwright is not an automation global", () => {
		define(window, "playwrightDemo", true);
		Reflect.set(document, "abc_cdc_", {});

		expect(readEnvironmentSignals({ win: window, doc: document })).toEqual([]);
	});

	test("every signal at once is each reported once, by name only", () => {
		define(navigator, "webdriver", true);
		define(navigator, "userAgent", HEADLESS_UA);
		define(window, "__playwright__binding__", () => {});
		define(window, "callPhantom", () => {});

		const signals = readEnvironmentSignals({ win: window, doc: document });

		expect([...signals].sort()).toEqual([
			"automation_global",
			"headless",
			"webdriver",
		]);
	});
});

describe("createInputWatcher", () => {
	test("input dispatched by a script is untrusted, whatever kind it is", () => {
		for (const name of ["keydown", "wheel", "mousemove"]) {
			installPage();
			const watcher = createInputWatcher(window);

			win.dispatchEvent(new win.Event(name));

			expect(watcher.signals()).toEqual(["untrusted_input"]);
			watcher.stop();
		}
	});

	test("a script-dispatched pointer press is untrusted", () => {
		const watcher = createInputWatcher(window);

		win.dispatchEvent(
			new win.PointerEvent("pointerdown", { pointerType: "mouse" }),
		);

		expect(watcher.signals()).toEqual(["untrusted_input"]);
	});

	test("many untrusted events are one signal", () => {
		const watcher = createInputWatcher(window);

		for (let index = 0; index < 5; index += 1) {
			win.dispatchEvent(new win.Event("keydown"));
		}

		expect(watcher.signals()).toEqual(["untrusted_input"]);
	});

	test("a person typing raises nothing", () => {
		const watcher = createInputWatcher(window);

		fire(trusted(new win.KeyboardEvent("keydown", { key: "a" })));

		expect(watcher.signals()).toEqual([]);
	});

	test("a mouse click with no movement before it is a click without motion", () => {
		const watcher = createInputWatcher(window);

		fire(press(200, 300));

		expect(watcher.signals()).toEqual(["click_without_motion"]);
	});

	for (const pointerType of ["touch", "pen"]) {
		test(`a ${pointerType} press with no movement before it raises nothing`, () => {
			const watcher = createInputWatcher(window);

			fire(press(200, 300, pointerType));

			expect(watcher.signals()).toEqual([]);
		});
	}

	test("a mouse that travels in small steps and clicks raises nothing", () => {
		const watcher = createInputWatcher(window);

		for (let x = 0; x <= 400; x += 8) {
			fire(move(x, 300));
		}
		fire(press(400, 300));
		for (let x = 400; x >= 0; x -= 8) {
			fire(move(x, 300));
		}
		fire(press(0, 300));

		expect(watcher.signals()).toEqual([]);
	});

	test("a pointer that jumps hundreds of pixels to its next target in one step is a teleport", () => {
		const watcher = createInputWatcher(window);

		for (let x = 0; x <= 40; x += 4) {
			fire(move(x, 300));
		}
		fire(press(40, 300));
		fire(move(640, 700));
		fire(press(640, 700));

		expect(watcher.signals()).toEqual(["pointer_teleport"]);
	});

	test("a first click whose single move jumped far from the first position is a teleport", () => {
		const watcher = createInputWatcher(window);

		fire(move(10, 10));
		fire(move(640, 400));
		fire(press(640, 400));

		expect(watcher.signals()).toEqual(["pointer_teleport"]);
	});

	test("a first click reached in one move onto the target raises nothing, since nothing says where it came from", () => {
		const watcher = createInputWatcher(window);

		fire(move(640, 400));
		fire(press(640, 400));

		expect(watcher.signals()).toEqual([]);
	});

	test("a first click two short moves from the first position raises nothing", () => {
		const watcher = createInputWatcher(window);

		fire(move(600, 380));
		fire(move(640, 400));
		fire(press(640, 400));

		expect(watcher.signals()).toEqual([]);
	});

	test("a first click after a short run of moves raises nothing", () => {
		const watcher = createInputWatcher(window);

		fire(move(600, 380));
		fire(move(620, 390));
		fire(move(640, 400));
		fire(press(640, 400));

		expect(watcher.signals()).toEqual([]);
	});

	test("a person nudging a resting mouse a couple of pixels and clicking raises nothing", () => {
		const watcher = createInputWatcher(window);

		fire(move(640, 400));
		fire(move(641, 401));
		fire(press(641, 401));

		expect(watcher.signals()).toEqual([]);
	});

	test("after a first click, a short single move and a second click raises nothing", () => {
		const watcher = createInputWatcher(window);
		for (let x = 0; x <= 40; x += 4) {
			fire(move(x, 300));
		}
		fire(press(40, 300));

		fire(move(50, 305));
		fire(press(50, 305));

		expect(watcher.signals()).toEqual([]);
	});

	test("text typed into a field that never got a key press is text without keys", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		typeInto(field);

		expect(watcher.signals()).toEqual(["text_without_keys"]);
	});

	test("text typed into a field after a key press on it raises nothing", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		keyOn(field);
		typeInto(field);
		typeInto(field);

		expect(watcher.signals()).toEqual([]);
	});

	test("a key press on one field does not cover text that appears in another", () => {
		const watcher = createInputWatcher(window);
		const typed = addField();
		const filled = addField();

		keyOn(typed);
		typeInto(typed);
		typeInto(filled);

		expect(watcher.signals()).toEqual(["text_without_keys"]);
	});

	const usePointer = (pointer: "coarse" | "fine" | null) => {
		Object.assign(globalThis, {
			matchMedia:
				pointer === null
					? undefined
					: (query: string) => ({
							matches: query === `(pointer: ${pointer})`,
							media: query,
						}),
		});
	};

	test("on a touch-first device, text with no key press raises nothing", () => {
		usePointer("coarse");
		const watcher = createInputWatcher(window);
		const field = addField();

		typeInto(field);
		typeInto(addField());

		expect(watcher.signals()).toEqual([]);
	});

	test("on a fine-pointer device, text with no key press is still text without keys", () => {
		usePointer("fine");
		const watcher = createInputWatcher(window);

		typeInto(addField());

		expect(watcher.signals()).toEqual(["text_without_keys"]);
	});

	test("with no matchMedia at all, text with no key press is text without keys", () => {
		usePointer(null);
		const watcher = createInputWatcher(window);

		typeInto(addField());

		expect(watcher.signals()).toEqual(["text_without_keys"]);
	});

	test("on a touch-first device, untrusted input is still untrusted", () => {
		usePointer("coarse");
		const announced: string[] = [];
		const watcher = createInputWatcher(window, (signal) => {
			announced.push(signal);
		});
		const field = addField();

		field.dispatchEvent(
			new win.InputEvent("input", { inputType: "insertText", bubbles: true }),
		);
		win.dispatchEvent(new win.Event("keydown"));

		expect(watcher.signals()).toEqual(["untrusted_input"]);
		expect(announced).toEqual(["untrusted_input"]);
	});

	test("on a touch-first device, a scripted click with no motion is still flagged", () => {
		usePointer("coarse");
		const watcher = createInputWatcher(window);

		fire(press(200, 300));

		expect(watcher.signals()).toEqual(["click_without_motion"]);
	});

	test("on a touch-first page, keyless text does not add the intent field or a report", () => {
		jest.useFakeTimers();
		usePointer("coarse");
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);

		typeInto(addField());
		jest.advanceTimersByTime(10_000);
		hidePage();

		expect(form.querySelector("[data-waniwani-intent]")).toBeNull();
		expect(sent).toEqual([]);
		beacon.stop();
	});

	test("a key press after the text arrived does not undo the signal", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		typeInto(field);
		keyOn(field);

		expect(watcher.signals()).toEqual(["text_without_keys"]);
	});

	for (const inputType of [
		"insertReplacementText",
		"insertFromPaste",
		"insertCompositionText",
		"deleteContentBackward",
		"deleteContentForward",
		"insertFromDrop",
	]) {
		test(`a trusted ${inputType} input with no key press raises nothing`, () => {
			const watcher = createInputWatcher(window);
			const field = addField();

			typeInto(field, inputType);

			expect(watcher.signals()).toEqual([]);
		});
	}

	test("a script-dispatched input is untrusted and never text without keys", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		field.dispatchEvent(
			new win.InputEvent("input", { inputType: "insertText", bubbles: true }),
		);

		expect(watcher.signals()).toEqual(["untrusted_input"]);
	});

	test("an untrusted input right after a person typed in the same field raises nothing", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		keyOn(field);
		field.dispatchEvent(
			new win.InputEvent("input", { inputType: "insertText", bubbles: true }),
		);

		expect(watcher.signals()).toEqual([]);
	});

	test("an untrusted input after a trusted input on the same field raises nothing", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		keyOn(field);
		typeInto(field);
		field.dispatchEvent(new win.Event("input", { bubbles: true }));

		expect(watcher.signals()).toEqual([]);
	});

	test("an untrusted input on a field nobody typed in is untrusted, even after typing elsewhere", () => {
		const watcher = createInputWatcher(window);
		const typed = addField();
		const other = addField();

		keyOn(typed);
		typeInto(typed);
		other.dispatchEvent(new win.Event("input", { bubbles: true }));

		expect(watcher.signals()).toEqual(["untrusted_input"]);
	});

	test("a field that got only untrusted input earlier is still untrusted on the next one", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		field.dispatchEvent(new win.Event("input", { bubbles: true }));
		field.dispatchEvent(new win.Event("input", { bubbles: true }));

		expect(watcher.signals()).toEqual(["untrusted_input"]);
	});

	test("a trusted key press on a field does not excuse an untrusted key press on it", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		keyOn(field);
		field.dispatchEvent(new win.KeyboardEvent("keydown", { bubbles: true }));

		expect(watcher.signals()).toEqual(["untrusted_input"]);
	});

	test("a script-dispatched key press does not excuse trusted text that follows", () => {
		const watcher = createInputWatcher(window);
		const field = addField();

		field.dispatchEvent(new win.KeyboardEvent("keydown", { bubbles: true }));
		typeInto(field);

		expect([...watcher.signals()].sort()).toEqual([
			"text_without_keys",
			"untrusted_input",
		]);
	});

	test("each new signal is announced once, and repeats are not announced again", () => {
		const announced: string[] = [];
		const watcher = createInputWatcher(window, (signal) => {
			announced.push(signal);
		});
		const first = addField();
		const second = addField();

		typeInto(first);
		typeInto(second);
		win.dispatchEvent(new win.Event("keydown"));
		win.dispatchEvent(new win.Event("wheel"));
		fire(press(10, 10));
		fire(press(20, 20));

		expect(announced).toEqual([
			"text_without_keys",
			"untrusted_input",
			"click_without_motion",
		]);
		watcher.stop();
	});

	test("after stop, text without keys is not recorded or announced", () => {
		const announced: string[] = [];
		const watcher = createInputWatcher(window, (signal) => {
			announced.push(signal);
		});
		watcher.stop();

		typeInto(addField());

		expect(watcher.signals()).toEqual([]);
		expect(announced).toEqual([]);
	});

	test("after stop, nothing more is recorded", () => {
		const watcher = createInputWatcher(window);
		watcher.stop();

		win.dispatchEvent(new win.Event("keydown"));
		fire(press(10, 10));

		expect(watcher.signals()).toEqual([]);
	});
});

describe("startAgentBeacon and the intent field", () => {
	const intentBodies = async () =>
		(await payloads()).filter((body) => "intent" in body);

	test("an ordinary visit never adds anything to its forms", () => {
		jest.useFakeTimers();
		const form = addForm();
		const before = form.outerHTML;
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(10_000);
		submit(form);
		hidePage();

		expect(form.outerHTML).toBe(before);
		expect(win.document.querySelector("[data-waniwani-intent]")).toBeNull();
		beacon.stop();
	});

	test("a page with automation at start gets a visible field once it settles", () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(999);
		expect(form.querySelector("[data-waniwani-intent]")).toBeNull();
		jest.advanceTimersByTime(1);

		const field = intentFieldOf(form);
		expect(field.hasAttribute("tabindex")).toBe(false);
		expect(field.hasAttribute("name")).toBe(false);
		beacon.stop();
	});

	test("the first signal of any kind after the page settled adds the field", () => {
		jest.useFakeTimers();
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(5_000);
		expect(form.querySelector("[data-waniwani-intent]")).toBeNull();

		typeInto(addField());

		expect(form.firstElementChild).toBe(
			intentFieldOf(form).closest("[data-waniwani-intent]"),
		);
		beacon.stop();
	});

	test("an agent's answer is sent with the page's signals and the form's path when the form is submitted", async () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const form = addForm("https://shop.example/quote/start?ref=abc#top");
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);

		intentFieldOf(form).value = "  Comparing car insurance prices for a user  ";
		submit(form);

		const bodies = await payloads();
		expect(bodies).toHaveLength(2);
		const body = bodies[1];
		expect(Object.keys(body ?? {}).sort()).toEqual([
			"elapsedMs",
			"intent",
			"intentForm",
			"pageViewId",
			"referrer",
			"signals",
			"token",
			"url",
			"v",
		]);
		expect(body).toMatchObject({
			intent: "Comparing car insurance prices for a user",
			intentForm: "/quote/start",
			signals: ["webdriver"],
			url: "https://shop.example/pricing",
			pageViewId: bodies[0]?.pageViewId,
		});
		for (const entry of sent) {
			expect(entry.init?.keepalive).toBe(true);
			expect(entry.init?.credentials).toBe("omit");
			expect(
				headerOf(entry.init, "content-type")?.startsWith("text/plain"),
			).toBe(true);
		}
		beacon.stop();
	});

	test("building a form's data on a page with a signal sends the answer, with no submit event, and the data never holds it", async () => {
		jest.useFakeTimers();
		const form = addForm("/quote/start");
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);
		win.dispatchEvent(new win.Event("keydown"));
		intentFieldOf(form).value = "Getting a quote for a user";

		const data = new win.FormData(form);
		const event = new win.Event("formdata", { bubbles: true });
		define(event, "formData", data);
		form.dispatchEvent(event);

		const bodies = await intentBodies();
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toMatchObject({
			intent: "Getting a quote for a user",
			intentForm: "/quote/start",
			signals: ["untrusted_input"],
		});
		expect(
			[...data.values()].some(
				(value) => value === "Getting a quote for a user",
			),
		).toBe(false);
		beacon.stop();
	});

	test("an answer left unsubmitted on a page with a signal goes out when the page hides", async () => {
		jest.useFakeTimers();
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);
		win.dispatchEvent(new win.Event("keydown"));

		intentFieldOf(form).value = "Booking a demo";
		hidePage();

		expect((await intentBodies()).map((body) => body.intent)).toEqual([
			"Booking a demo",
		]);
		beacon.stop();
	});

	test("a page sends at most two intent reports, however many answers it submits", async () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);
		const field = intentFieldOf(form);

		for (const text of ["first", "second", "third"]) {
			field.value = text;
			submit(form);
		}
		field.value = "fourth";
		hidePage();
		submit(form);

		expect((await intentBodies()).map((body) => body.intent)).toEqual([
			"first",
			"second",
		]);
		beacon.stop();
	});

	test("after stop the intent field is gone and a submit sends nothing", () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);
		const field = intentFieldOf(form);
		field.value = "Too late";

		beacon.stop();
		form.append(field);
		submit(form);
		hidePage();

		expect(form.querySelector("[data-waniwani-intent]")).toBeNull();
		expect(sent).toHaveLength(1);
	});

	test("after stop a new signal adds no field", () => {
		jest.useFakeTimers();
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);

		beacon.stop();
		win.dispatchEvent(new win.Event("keydown"));
		jest.advanceTimersByTime(10_000);

		expect(form.querySelector("[data-waniwani-intent]")).toBeNull();
	});
});

describe("startAgentBeacon on a crawler", () => {
	const GOOGLEBOT_UA =
		"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.6778.204 Safari/537.36";
	const MANUS_UA =
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36; Manus-User/1.0";

	const countObservers = () => {
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
		return () => created;
	};

	test("a crawler still reports its signals at once and never gets an intent field", async () => {
		jest.useFakeTimers();
		define(navigator, "userAgent", GOOGLEBOT_UA);
		define(navigator, "webdriver", true);
		const observers = countObservers();
		const form = addForm();
		const before = form.outerHTML;
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		expect((await payloads()).map((body) => body.signals)).toEqual([
			["webdriver"],
		]);
		jest.advanceTimersByTime(10_000);
		win.dispatchEvent(new win.Event("keydown"));
		typeInto(addField());
		submit(form);
		hidePage();
		jest.advanceTimersByTime(10_000);

		expect(win.document.querySelector("[data-waniwani-intent]")).toBeNull();
		expect(form.outerHTML).toBe(before);
		expect(observers()).toBe(0);
		const bodies = await payloads();
		expect(bodies).toHaveLength(2);
		expect(bodies.some((body) => "intent" in body)).toBe(false);
		const later = bodies[1]?.signals;
		expect(Array.isArray(later) ? [...later].sort() : later).toEqual([
			"text_without_keys",
			"untrusted_input",
			"webdriver",
		]);
		beacon.stop();
	});

	test("a crawler's beacon still stops cleanly", () => {
		jest.useFakeTimers();
		define(navigator, "userAgent", GOOGLEBOT_UA);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("keydown"));

		expect(() => beacon.stop()).not.toThrow();
		jest.advanceTimersByTime(10_000);
		hidePage();

		expect(sent).toEqual([]);
	});

	test("a fetcher acting for a person, like ChatGPT-User, gets the field on its first signal", () => {
		jest.useFakeTimers();
		define(
			navigator,
			"userAgent",
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
		);
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);
		expect(form.querySelector("[data-waniwani-intent]")).toBeNull();

		win.dispatchEvent(new win.Event("keydown"));

		expect(form.firstElementChild?.hasAttribute("data-waniwani-intent")).toBe(
			true,
		);
		beacon.stop();
	});

	test("a browser agent that names itself outside the list still gets the field on its first signal", () => {
		jest.useFakeTimers();
		define(navigator, "userAgent", MANUS_UA);
		const form = addForm();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(1_000);
		expect(form.querySelector("[data-waniwani-intent]")).toBeNull();

		win.dispatchEvent(new win.Event("keydown"));

		expect(form.firstElementChild?.hasAttribute("data-waniwani-intent")).toBe(
			true,
		);
		beacon.stop();
	});
});

describe("resolveBeaconEndpoint", () => {
	for (const [label, api, expected] of [
		[
			"the default chat api",
			API,
			"https://app.waniwani.ai/api/v2/agent-traffic/beacon",
		],
		[
			"an api on another stack",
			"https://eu.app.waniwani.ai/api/mcp/chat",
			"https://eu.app.waniwani.ai/api/v2/agent-traffic/beacon",
		],
		[
			"an api with a port, a query and a fragment",
			"http://localhost:3000/api/mcp/chat?x=1#y",
			"http://localhost:3000/api/v2/agent-traffic/beacon",
		],
	]) {
		test(`${label} posts to the beacon route on the api's own origin`, () => {
			expect(resolveBeaconEndpoint(api, PAGE)).toBe(expected);
		});
	}
});

describe("startAgentBeacon", () => {
	test("an ordinary visit sends nothing, neither after load nor when the page hides", () => {
		jest.useFakeTimers();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		jest.advanceTimersByTime(60_000);
		hidePage();

		expect(sent).toEqual([]);
		beacon.stop();
	});

	test("a page that shows automation at start reports at once, and only once while nothing new is seen", () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(
			"https://app.waniwani.ai/api/v2/agent-traffic/beacon",
		);
		jest.advanceTimersByTime(10_000);

		expect(sent).toHaveLength(1);
		beacon.stop();
	});

	test("a page with no automation at start waits three seconds before reporting a signal it saw", () => {
		jest.useFakeTimers();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("keydown"));

		jest.advanceTimersByTime(2_999);
		expect(sent).toEqual([]);
		jest.advanceTimersByTime(1);

		expect(sent).toHaveLength(1);
		beacon.stop();
	});

	test("a signal that first fires after the three seconds waits for the page to hide", async () => {
		jest.useFakeTimers();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(5_000);

		win.dispatchEvent(new win.Event("keydown"));
		jest.advanceTimersByTime(60_000);
		expect(sent).toEqual([]);
		hidePage();

		expect((await payloads()).map((body) => body.signals)).toEqual([
			["untrusted_input"],
		]);
		beacon.stop();
	});

	test("a page sends at most three signal reports, however many new signals it shows", () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("keydown"));
		hidePage();
		fire(press(10, 10));
		hidePage();
		const field = win.document.createElement("textarea");
		win.document.body.append(field);
		field.dispatchEvent(
			trusted(
				new win.InputEvent("input", { inputType: "insertText", bubbles: true }),
			),
		);
		hidePage();

		expect(sent).toHaveLength(3);
		beacon.stop();
	});

	test("the report carries signal names and the page, and nothing about the device or the visitor", async () => {
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("pagehide"));

		const [body] = await payloads();
		expect(Object.keys(body ?? {}).sort()).toEqual([
			"elapsedMs",
			"pageViewId",
			"referrer",
			"signals",
			"token",
			"url",
			"v",
		]);
		expect(body).toMatchObject({
			v: 1,
			token: TOKEN,
			url: "https://shop.example/pricing",
			referrer: null,
			signals: ["webdriver"],
		});
		expect(typeof body?.pageViewId).toBe("string");
		expect(Number.isInteger(body?.elapsedMs)).toBe(true);
		expect(Number(body?.elapsedMs)).toBeGreaterThanOrEqual(0);
		beacon.stop();
	});

	test("the body is sent as plain text, so no preflight runs", () => {
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("pagehide"));

		expect(
			headerOf(sent[0]?.init, "content-type")?.startsWith("text/plain"),
		).toBe(true);
		expect(sent[0]?.init?.method).toBe("POST");
		beacon.stop();
	});

	test("the referrer is sent without its query or fragment", async () => {
		installPage({
			referrer: "https://chatgpt.com/c/abc?utm_source=chatgpt.com#x",
		});
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("pagehide"));

		expect((await payloads())[0]?.referrer).toBe("https://chatgpt.com/c/abc");
		beacon.stop();
	});

	test("a page url carrying credentials is sent without them", async () => {
		installPage({ url: "https://user:secret@shop.example/account?token=abc" });
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("pagehide"));

		const [body] = await payloads();
		expect(body?.url).toBe("https://shop.example/account");
		beacon.stop();
	});

	test("hiding the page fires both visibilitychange and pagehide and still sends once", () => {
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		hidePage();
		win.dispatchEvent(new win.Event("pagehide"));

		expect(sent).toHaveLength(1);
		beacon.stop();
	});

	test("a visibilitychange to visible sends nothing", () => {
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("keydown"));
		const before = sent.length;

		win.document.dispatchEvent(new win.Event("visibilitychange"));

		expect(sent).toHaveLength(before);
		beacon.stop();
	});

	test("a signal seen after the first report goes out on hide, under the same page view", async () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(5_000);

		win.dispatchEvent(new win.Event("keydown"));
		hidePage();

		const bodies = await payloads();
		expect(bodies).toHaveLength(2);
		expect(bodies[0]?.pageViewId).toBe(bodies[1]?.pageViewId);
		expect(bodies[0]?.signals).toEqual(["webdriver"]);
		const later = bodies[1]?.signals;
		expect(Array.isArray(later) ? [...later].sort() : later).toEqual([
			"untrusted_input",
			"webdriver",
		]);
		beacon.stop();
	});

	test("a weak signal alone is still reported", async () => {
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		win.dispatchEvent(new win.Event("keydown"));
		win.dispatchEvent(new win.Event("pagehide"));

		expect((await payloads())[0]?.signals).toEqual(["untrusted_input"]);
		beacon.stop();
	});

	test("every signal sent is one the app knows", async () => {
		define(navigator, "webdriver", true);
		define(navigator, "userAgent", HEADLESS_UA);
		define(window, "__playwright__binding__", () => {});
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("keydown"));
		fire(press(5, 5));
		win.dispatchEvent(new win.Event("pagehide"));

		const signals = (await payloads())[0]?.signals;
		expect(Array.isArray(signals)).toBe(true);
		for (const signal of Array.isArray(signals) ? signals : []) {
			expect(KNOWN_SIGNALS).toContain(signal);
		}
		beacon.stop();
	});

	test("two page loads report under two different page view ids", async () => {
		define(navigator, "webdriver", true);
		const first = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("pagehide"));
		first.stop();
		const second = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("pagehide"));
		second.stop();

		const bodies = await payloads();
		expect(bodies).toHaveLength(2);
		expect(bodies[0]?.pageViewId).not.toBe(bodies[1]?.pageViewId);
	});

	test("stopping before the first report means nothing is ever sent", () => {
		jest.useFakeTimers();
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		win.dispatchEvent(new win.Event("keydown"));

		beacon.stop();
		jest.advanceTimersByTime(10_000);
		hidePage();

		expect(sent).toEqual([]);
	});

	test("stopping after the report at start sends nothing more, even when new signals fire and the page hides", () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		beacon.stop();
		win.dispatchEvent(new win.Event("keydown"));
		jest.advanceTimersByTime(10_000);
		hidePage();

		expect(sent).toHaveLength(1);
	});

	test("every report is a keepalive post that carries no cookie and never goes through sendBeacon", async () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });
		jest.advanceTimersByTime(5_000);
		win.dispatchEvent(new win.Event("keydown"));
		hidePage();

		expect(sent).toHaveLength(2);
		for (const entry of sent) {
			expect(entry.url).toBe(
				"https://app.waniwani.ai/api/v2/agent-traffic/beacon",
			);
			expect(entry.init?.method).toBe("POST");
			expect(entry.init?.keepalive).toBe(true);
			expect(entry.init?.credentials).toBe("omit");
		}
		expect(beaconCalls).toBe(0);
		beacon.stop();
	});

	test("a failing post never throws into the page", async () => {
		define(navigator, "webdriver", true);
		Object.assign(globalThis, {
			fetch: async () => {
				throw new TypeError("network down");
			},
		});
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		expect(() => win.dispatchEvent(new win.Event("pagehide"))).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
		beacon.stop();
	});
});
