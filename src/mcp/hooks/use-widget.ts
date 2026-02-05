"use client";

import React, {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import {
	createWidgetClient,
	type UnifiedWidgetClient,
} from "../widgets/@utils/widget-client";
import type { DisplayMode, SafeArea, Theme, UnknownObject } from "./@types";

/**
 * Context for the unified widget client.
 */
const WidgetClientContext = createContext<UnifiedWidgetClient | null>(null);

/**
 * Provider props
 */
interface WidgetProviderProps {
	children: ReactNode;
	/** Optional loading component while connecting */
	loading?: ReactNode;
	/** Optional error component */
	onError?: (error: Error) => ReactNode;
}

/**
 * Provider component that initializes the correct widget client based on platform.
 * Wrap your widget component with this provider.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <WidgetProvider loading={<Spinner />}>
 *       <MyWidget />
 *     </WidgetProvider>
 *   );
 * }
 * ```
 */
export function WidgetProvider({
	children,
	loading = null,
	onError,
}: WidgetProviderProps) {
	const [client, setClient] = useState<UnifiedWidgetClient | null>(null);
	const [error, setError] = useState<Error | null>(null);
	const [isConnecting, setIsConnecting] = useState(true);

	useEffect(() => {
		let mounted = true;

		async function initClient() {
			try {
				const widgetClient = await createWidgetClient();

				await widgetClient.connect();

				if (mounted) {
					setClient(widgetClient);
					setIsConnecting(false);
				}
			} catch (err) {
				if (mounted) {
					console.log("error", err);
					setError(err instanceof Error ? err : new Error(String(err)));
					setIsConnecting(false);
				}
			}
		}

		initClient();

		return () => {
			mounted = false;
		};
	}, []);

	if (error && onError) {
		return React.createElement(React.Fragment, null, onError(error));
	}

	if (isConnecting || !client) {
		return React.createElement(React.Fragment, null, loading);
	}

	return React.createElement(
		WidgetClientContext.Provider,
		{ value: client },
		children,
	);
}

/**
 * Keys that can be selected from the widget client.
 */
type WidgetKey =
	| "toolOutput"
	| "theme"
	| "displayMode"
	| "locale"
	| "safeArea"
	| "maxHeight"
	| "toolResponseMetadata"
	| "widgetState";

/**
 * Value types for each widget key.
 */
type WidgetKeyValues = {
	toolOutput: Record<string, unknown> | null;
	theme: Theme;
	displayMode: DisplayMode;
	locale: string;
	safeArea: SafeArea | null;
	maxHeight: number | null;
	toolResponseMetadata: UnknownObject | null;
	widgetState: UnknownObject | null;
};

/**
 * Get the unified widget client instance.
 * Must be used within a WidgetProvider.
 *
 * @example
 * ```tsx
 * // Full client for actions
 * const client = useWidgetClient();
 * client.callTool("foo", {});
 *
 * // Key selector for reactive values
 * const toolOutput = useWidgetClient("toolOutput");
 * const theme = useWidgetClient("theme");
 * ```
 */
export function useWidgetClient(): UnifiedWidgetClient;
export function useWidgetClient<K extends WidgetKey>(
	key: K,
): WidgetKeyValues[K];
export function useWidgetClient<K extends WidgetKey>(key?: K) {
	const client = useContext(WidgetClientContext);

	if (!client) {
		throw new Error("useWidgetClient must be used within a WidgetProvider");
	}

	// Key selector - use useSyncExternalStore
	const subscribe = useCallback(
		(onChange: () => void) => {
			if (key === "toolOutput") return client.onToolResult(() => onChange());
			if (key === "theme") return client.onThemeChange(() => onChange());
			if (key === "displayMode")
				return client.onDisplayModeChange(() => onChange());
			if (key === "safeArea") return client.onSafeAreaChange(() => onChange());
			if (key === "maxHeight")
				return client.onMaxHeightChange(() => onChange());
			if (key === "toolResponseMetadata")
				return client.onToolResponseMetadataChange(() => onChange());
			if (key === "widgetState")
				return client.onWidgetStateChange(() => onChange());
			return () => {};
		},
		[client, key],
	);

	const getSnapshot = useCallback(() => {
		if (key === "toolOutput") return client.getToolOutput();
		if (key === "theme") return client.getTheme();
		if (key === "displayMode") return client.getDisplayMode();
		if (key === "locale") return client.getLocale();
		if (key === "safeArea") return client.getSafeArea();
		if (key === "maxHeight") return client.getMaxHeight();
		if (key === "toolResponseMetadata") return client.getToolResponseMetadata();
		if (key === "widgetState") return client.getWidgetState();
		return null;
	}, [client, key]);

	const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	// No key - return full client
	if (!key) return client;

	return store;
}
