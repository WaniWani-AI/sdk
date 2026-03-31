"use client";

import { useCallback, useRef } from "react";
import type { CallToolHandler } from "../@types";

type CallToolParams = Parameters<CallToolHandler>[0];
type CallToolResult = Awaited<ReturnType<CallToolHandler>>;

/**
 * Returns a stable `onCallTool` callback.
 * Uses the user-provided handler if available, otherwise POSTs to `${api}/tool`.
 */
export function useCallTool(props: {
	api?: string;
	headers?: Record<string, string>;
	onCallTool?: CallToolHandler;
	sessionId?: string;
}): CallToolHandler {
	const propsRef = useRef(props);
	propsRef.current = props;

	return useCallback(
		async (params: CallToolParams): Promise<CallToolResult> => {
			const { api, headers, onCallTool, sessionId } = propsRef.current;

			if (onCallTool) {
				return onCallTool(params);
			}

			const endpoint = `${api ?? "/api/waniwani"}/tool`;
			const normalizedSessionId =
				typeof sessionId === "string" && sessionId.trim().length > 0
					? sessionId.trim()
					: undefined;
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(normalizedSessionId
						? { "X-Session-Id": normalizedSessionId }
						: {}),
					...headers,
				},
				body: JSON.stringify(params),
			});

			if (!res.ok) {
				throw new Error(`Tool call failed: ${res.status} ${res.statusText}`);
			}

			return res.json();
		},
		[],
	);
}
