"use client";

import { createContext, useContext } from "react";
import type { WidgetEventEmitter } from "./widget-events";
import { createNoopWidgetEventEmitter } from "./widget-events";

// Default is an inert emitter, so components emit unconditionally and a bare
// `ChatEmbed` mounted without a provider (the BYO-backend path) stays silent.
const WidgetEventsContext = createContext<WidgetEventEmitter>(
	createNoopWidgetEventEmitter(),
);

/** Event emitter for the enclosing widget mount; inert without a provider. */
export function useWidgetEvents(): WidgetEventEmitter {
	return useContext(WidgetEventsContext);
}

export const WidgetEventsProvider = WidgetEventsContext.Provider;
