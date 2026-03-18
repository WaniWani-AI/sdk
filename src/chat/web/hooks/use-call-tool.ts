"use client";

import { useCallback, useRef } from "react";
import type { ChatBaseProps } from "../@types";

type CallToolFn = NonNullable<ChatBaseProps["onCallTool"]>;
type CallToolParams = Parameters<CallToolFn>[0];
type CallToolResult = Awaited<ReturnType<CallToolFn>>;

/**
 * Returns a stable `onCallTool` callback.
 * Uses the user-provided handler if available, otherwise POSTs to `${api}/tool`.
 */
export function useCallTool(props: {
	api?: string;
	headers?: Record<string, string>;
	onCallTool?: CallToolFn;
}): CallToolFn {
	const propsRef = useRef(props);
	propsRef.current = props;

	return useCallback(
		async (params: CallToolParams): Promise<CallToolResult> => {
			const { api, headers, onCallTool } = propsRef.current;

			if (onCallTool) {
				return onCallTool(params);
			}

			const endpoint = `${api ?? "/api/waniwani"}/tool`;
			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
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
