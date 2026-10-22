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
	define(win.navigator, "webdriver", false);
	define(win.navigator, "userAgent", CHROME_UA);
	define(win.document, "referrer", input.referrer ?? "");
	define(win.document, "visibilityState", "visible");
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

	test("after stop, nothing more is recorded", () => {
		const watcher = createInputWatcher(window);
		watcher.stop();

		win.dispatchEvent(new win.Event("keydown"));
		fire(press(10, 10));

		expect(watcher.signals()).toEqual([]);
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

	test("an automated page reports once a few seconds after load, not at once", async () => {
		jest.useFakeTimers();
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		expect(sent).toEqual([]);
		jest.advanceTimersByTime(10_000);

		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(
			"https://app.waniwani.ai/api/v2/agent-traffic/beacon",
		);
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

		win.document.dispatchEvent(new win.Event("visibilitychange"));

		expect(sent).toEqual([]);
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
		define(navigator, "webdriver", true);
		const beacon = startAgentBeacon({ api: API, token: TOKEN });

		beacon.stop();
		jest.advanceTimersByTime(10_000);
		hidePage();

		expect(sent).toEqual([]);
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
