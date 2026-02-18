"use client";

import { type SetStateAction, useCallback, useEffect, useState } from "react";
import { detectPlatform } from "../widgets/platform";
import type { UnknownObject } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Widget state that persists across widget lifecycles (OpenAI-only).
 * State is synchronized with the ChatGPT parent window and survives widget minimize/restore.
 * On MCP Apps, returns [null, no-op].
 *
 * @param defaultState - Initial state value or function to compute it
 * @returns A tuple of [state, setState] similar to useState
 */
export function useWidgetState<T extends UnknownObject>(
	defaultState?: T | (() => T | null) | null,
): readonly [T | null, (state: SetStateAction<T | null>) => void] {
	const widgetStateFromWindow = useWidgetClient("widgetState") as T | null;

	const [widgetState, _setWidgetState] = useState<T | null>(() => {
		if (widgetStateFromWindow != null) {
			return widgetStateFromWindow;
		}
		return typeof defaultState === "function"
			? defaultState()
			: (defaultState ?? null);
	});

	useEffect(() => {
		_setWidgetState(widgetStateFromWindow);
	}, [widgetStateFromWindow]);

	const setWidgetState = useCallback((state: SetStateAction<T | null>) => {
		_setWidgetState((prevState) => {
			const newState = typeof state === "function" ? state(prevState) : state;

			if (detectPlatform() === "openai" && newState != null) {
				window.openai?.setWidgetState(newState);
			}

			return newState;
		});
	}, []);

	return [widgetState, setWidgetState] as const;
}
