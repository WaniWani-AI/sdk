import { useCallback, useState } from "react";
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
 * reopen within the page load and resets on remount.
 */
export function usePanelLayout(
	config: Pick<EmbedConfig, "panelLayout" | "panelDockable">,
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
	return { layout, dockable, toggle };
}
