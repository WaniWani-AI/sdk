/**
 * Dev-mode tooling for the legacy MCP-widget-in-host stack.
 *
 * @deprecated Legacy MCP-widget-in-host stack. Preserved for back-compat; will move to
 *   `@waniwani/sdk/legacy/react` in a future minor release.
 *
 * @module
 */

export { DevModeProvider } from "./dev-controls";
export {
	getMockState,
	initializeMockOpenAI,
	updateMockDisplayMode,
	updateMockGlobal,
	updateMockTheme,
	updateMockToolOutput,
} from "./mock-openai";
