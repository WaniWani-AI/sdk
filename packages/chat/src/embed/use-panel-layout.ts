import { useCallback, useEffect, useRef, useState } from "react";
import type { EmbedConfig, PanelLayout } from "./config";
import { panelLayoutOf } from "./panel-layout";

export interface PanelLayoutControl {
	layout: PanelLayout;
	dockable: boolean;
	toggle: () => void;
}

/**
 * The live placement of the chat panel. Without `panelDockable` the layout
 * is whatever the snippet set and `toggle` is a no-op, so the two panel
 * hosts render exactly as before. With it, `toggle` flips `modal` and
 * `sidebar`; the choice lives in component state, so it survives close and
 * reopen within the page load and resets on remount. `onLayoutChange` runs
 * once per committed change, after the render that applied it, never on
 * mount, so it reports the layout the panel actually has.
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
