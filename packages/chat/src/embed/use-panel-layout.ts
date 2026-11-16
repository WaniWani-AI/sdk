import { useCallback, useEffect, useRef, useState } from "react";
import type { EmbedConfig, PanelLayout } from "./config";
import { panelLayoutOf } from "./panel-layout";

export interface PanelLayoutControl {
	layout: PanelLayout;
	dockable: boolean;
	toggle: () => void;
}

/**
 * `toggle` is a no-op without `panelDockable`. The layout lives in component
 * state: it survives close and reopen, and resets on remount.
 * `onLayoutChange` fires after each committed change, never on mount.
 */
export function usePanelLayout(
	config: Pick<EmbedConfig, "panelLayout" | "panelDockable">,
	onLayoutChange?: (layout: PanelLayout) => void,
): PanelLayoutControl {
	const [layout, setLayout] = useState<PanelLayout>(() =>
		panelLayoutOf(config.panelLayout),
	);
	const dockable = config.panelDockable === true;
	const toggle = useCallback(() => {
		if (!dockable) {
			return;
		}
		setLayout((current) => (current === "modal" ? "sidebar" : "modal"));
	}, [dockable]);

	const onChangeRef = useRef(onLayoutChange);
	onChangeRef.current = onLayoutChange;
	const mounted = useRef(false);
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		}
		onChangeRef.current?.(layout);
	}, [layout]);

	return { layout, dockable, toggle };
}
