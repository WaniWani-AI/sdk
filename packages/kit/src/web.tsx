/**
 * The widget-side API.
 *
 * A component gets its data from `useWidget(widget)`, typed straight off the
 * widget's own `data` schema. There is no generated helpers file and no server
 * type import, so a widget cannot drift from its contract.
 */

import { useToolInfo } from "skybridge/web";
import type { Infer, Shape, WidgetDefinition } from "./index.js";

export {
	mountView,
	useCallTool,
	useDisplayMode,
	useDownload,
	useFiles,
	useLayout,
	useOpenExternal,
	useRequestClose,
	useRequestModal,
	useRequestSize,
	useSendFollowUpMessage,
	useSetOpenInAppUrl,
	useUser,
	/**
	 * Per-widget state that survives re-renders and is handed back to the host.
	 *
	 * Upstream this is `useViewState`. The name here follows the wire format
	 * instead: what reaches ChatGPT is `openai/widgetCSP`,
	 * `openai/widgetDescription`, and `window.openai.widgetState`. Holding the
	 * public vocabulary steady is also the point of the package — the upstream
	 * rename of widgets to views cost app repos nothing, and it should keep
	 * costing them nothing.
	 */
	useViewState as useWidgetState,
} from "skybridge/web";
export type { Infer, Shape, WidgetDefinition } from "./index.js";
export { defineWidget } from "./index.js";

export type UseWidgetResult<S extends Shape> = {
	/**
	 * The widget's data. Present as soon as the host has the tool input, which
	 * on most hosts is before the server responds — so render optimistically.
	 */
	data: Infer<S> | undefined;
	/** The host is still streaming the tool call. */
	isLoading: boolean;
	/** The server has responded and `data` is final. */
	isReady: boolean;
};

/**
 * Read this widget's data.
 *
 * @param _widget the widget contract, passed for type inference only
 */
export function useWidget<S extends Shape>(_widget: WidgetDefinition<S>): UseWidgetResult<S> {
	const info = useToolInfo();
	const data = (info.output ?? info.input) as Infer<S> | undefined;

	return {
		data,
		isLoading: !info.isSuccess,
		isReady: info.isSuccess,
	};
}
