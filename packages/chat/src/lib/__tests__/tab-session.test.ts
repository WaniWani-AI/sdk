import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { savedSession, saveSession } from "../eve/session";
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

const SAVED = { conversationId: "conv_1", ownerSecret: "secret_1" };

describe("waniwani-session", () => {
	test("the chat session and the agent session share one key", () => {
		writeTabSession({ ...readTabSession(), agent: "agent_1" });
		saveSession("chan_1", SAVED);

		expect(sessionStorage.length).toBe(1);
		expect(JSON.parse(sessionStorage.getItem(TAB_SESSION_KEY) ?? "")).toEqual({
			chat: { chan_1: SAVED },
			agent: "agent_1",
		});
	});

	test("clearing the chat session keeps the agent session", () => {
		writeTabSession({ agent: "agent_1", chat: { chan_1: SAVED } });

		saveSession("chan_1", null);

		expect(savedSession("chan_1")).toBeNull();
		expect(readTabSession()).toEqual({ agent: "agent_1" });
	});

	test("the key is removed when nothing is left in it", () => {
		saveSession("chan_1", SAVED);

		saveSession("chan_1", null);

		expect(sessionStorage.getItem(TAB_SESSION_KEY)).toBeNull();
	});

	test("a malformed value reads as empty", () => {
		sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(["x"]));

		expect(readTabSession()).toEqual({});
	});
});
