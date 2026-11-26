import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	readTabSession,
	TAB_SESSION_KEY,
	writeTabSession,
} from "../tab-session";

const win = new Window({ url: "https://localhost" });
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).sessionStorage = (win as any).sessionStorage;

beforeEach(() => {
	sessionStorage.clear();
});

describe("waniwani-session", () => {
	test("the agent session round-trips through one key", () => {
		writeTabSession({ agent: "agent_1" });

		expect(sessionStorage.length).toBe(1);
		expect(readTabSession()).toEqual({ agent: "agent_1" });
	});

	test("a conversation saved by an older chat is not read back", () => {
		sessionStorage.setItem(
			TAB_SESSION_KEY,
			JSON.stringify({
				chat: { chan_1: { conversationId: "c", ownerSecret: "s" } },
				agent: "agent_1",
			}),
		);

		expect(readTabSession()).toEqual({ agent: "agent_1" });
	});

	test("the key is removed when nothing is left in it", () => {
		writeTabSession({ agent: "agent_1" });

		writeTabSession({});

		expect(sessionStorage.getItem(TAB_SESSION_KEY)).toBeNull();
	});

	test("a malformed value reads as empty", () => {
		sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(["x"]));

		expect(readTabSession()).toEqual({});
	});
});
