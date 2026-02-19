"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DisplayMode, Theme } from "../hooks/@types";
import { SetGlobalsEvent } from "../hooks/@types";
import {
	getMockState,
	initializeMockOpenAI,
	updateMockDisplayMode,
	updateMockTheme,
	updateMockToolOutput,
} from "./mock-openai";

const MOCK_SAFE_AREA_HEIGHT = 150;

// ============================================================================
// SVG Icons
// ============================================================================

function DevIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			role="img"
			aria-label="Dev Controls"
		>
			{/* Minimal: two stacked squares offset */}
			<rect
				x="4"
				y="4"
				width="10"
				height="10"
				rx="2"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<rect
				x="10"
				y="10"
				width="10"
				height="10"
				rx="2"
				stroke="currentColor"
				strokeWidth="1.5"
				fill="currentColor"
				fillOpacity="0.15"
			/>
		</svg>
	);
}

function CloseIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M18 6L6 18M6 6l12 12" />
		</svg>
	);
}

function InlineIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 16 16"
			fill="none"
		>
			<rect
				x="2"
				y="4"
				width="12"
				height="8"
				rx="1.5"
				stroke="currentColor"
				strokeWidth="1.25"
			/>
		</svg>
	);
}

function PipIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 16 16"
			fill="none"
		>
			<rect
				x="1.5"
				y="3"
				width="13"
				height="10"
				rx="1.5"
				stroke="currentColor"
				strokeWidth="1.25"
			/>
			<rect x="8.5" y="7" width="5" height="4" rx="0.75" fill="currentColor" />
		</svg>
	);
}

function FullscreenIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 16 16"
			fill="none"
		>
			<path
				d="M2 5.5V3.5C2 2.95 2.45 2.5 3 2.5H5.5M10.5 2.5H13C13.55 2.5 14 2.95 14 3.5V5.5M14 10.5V12.5C14 13.05 13.55 13.5 13 13.5H10.5M5.5 13.5H3C2.45 13.5 2 13.05 2 12.5V10.5"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function SunIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 16 16"
			fill="none"
		>
			<circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.25" />
			<path
				d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M4.11 4.11l1.06 1.06M10.83 10.83l1.06 1.06M4.11 11.89l1.06-1.06M10.83 5.17l1.06-1.06"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function MoonIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 16 16"
			fill="none"
		>
			<path
				d="M13.5 9.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ResetIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 16 16"
			fill="none"
		>
			<path
				d="M2.5 8a5.5 5.5 0 019.37-3.9M13.5 8a5.5 5.5 0 01-9.37 3.9"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
			/>
			<path
				d="M12.5 2v3h-3M3.5 14v-3h3"
				stroke="currentColor"
				strokeWidth="1.25"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// ============================================================================
// Styles
// ============================================================================

const panelAnimationStyles = `
  @keyframes devPanelSlideIn {
    0% {
      opacity: 0;
      transform: translateY(12px) scale(0.98);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes devPanelSlideOut {
    0% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }

  .dev-panel-enter {
    animation: devPanelSlideIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .dev-panel-exit {
    animation: devPanelSlideOut 150ms cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  .dev-json-editor::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .dev-json-editor::-webkit-scrollbar-track {
    background: transparent;
  }

  .dev-json-editor::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }

  .dev-json-editor::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.15);
  }
`;

// ============================================================================
// Components
// ============================================================================

interface DevControlsProps {
	defaultProps?: Record<string, unknown>;
	widgetPaths?: string[];
}

export function DevModeProvider({
	defaultProps,
	widgetPaths,
	children,
}: DevControlsProps & { children: React.ReactNode }) {
	const [isInitialized, setIsInitialized] = useState(false);
	const [isWidgetPage, setIsWidgetPage] = useState(false);

	useEffect(() => {
		// When loaded inside the MCP harness iframe, skip the OpenAI mock
		// so the real MCPAppsWidgetClient + App class is used instead.
		const params = new URLSearchParams(window.location.search);
		if (params.get("platform") === "mcp-apps") {
			setIsInitialized(true);
			return;
		}

		// Check if current path is a widget page
		if (widgetPaths && widgetPaths.length > 0) {
			const currentPath = window.location.pathname;
			const isWidget = widgetPaths.some(
				(path) => currentPath === path || currentPath.startsWith(`${path}/`),
			);
			setIsWidgetPage(isWidget);

			if (isWidget) {
				initializeMockOpenAI(defaultProps);
			}
		} else {
			// If no widgetPaths specified, treat all pages as widget pages (backwards compat)
			initializeMockOpenAI(defaultProps);
			setIsWidgetPage(true);
		}
		setIsInitialized(true);
	}, [defaultProps, widgetPaths]);

	if (!isInitialized) {
		return null;
	}

	// If not a widget page, just render children without the dev frame
	if (!isWidgetPage) {
		return <>{children}</>;
	}

	return (
		<>
			<WidgetPreviewFrame>{children}</WidgetPreviewFrame>
			<DevControls defaultProps={defaultProps} />
		</>
	);
}

function WidgetPreviewFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-screen bg-[#212121] flex items-center justify-center p-8">
			<div
				className="relative w-full max-w-md overflow-hidden rounded-2xl sm:rounded-3xl border border-[#414141]"
				style={{
					boxShadow: "0px 0px 0px 1px #414141, 0px 4px 14px rgba(0,0,0,0.24)",
				}}
			>
				{children}
			</div>
		</div>
	);
}

// ============================================================================
// Segmented Control
// ============================================================================

interface SegmentOption<T extends string> {
	value: T;
	label: string;
	icon: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
	options: SegmentOption<T>[];
	value: T;
	onChange: (value: T) => void;
}

function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
}: SegmentedControlProps<T>) {
	const activeIndex = options.findIndex((opt) => opt.value === value);

	return (
		<div
			className="relative flex p-0.5 rounded-lg"
			style={{
				background: "rgba(255, 255, 255, 0.04)",
				border: "1px solid rgba(255, 255, 255, 0.06)",
			}}
		>
			{/* Sliding indicator */}
			<div
				className="absolute top-0.5 bottom-0.5 rounded-md transition-transform duration-150 ease-out"
				style={{
					width: `calc(${100 / options.length}% - 2px)`,
					left: "2px",
					transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 2}px))`,
					background: "rgba(255, 255, 255, 0.1)",
				}}
			/>

			{options.map((option) => (
				<button
					type="button"
					key={option.value}
					onClick={() => onChange(option.value)}
					className={`
            relative z-10 flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5
            text-xs font-medium rounded-md transition-colors duration-150
            ${value === option.value ? "text-white" : "text-gray-400 hover:text-gray-300"}
          `}
				>
					{option.icon}
					<span className="capitalize">{option.label}</span>
				</button>
			))}
		</div>
	);
}

// ============================================================================
// Main DevControls Component
// ============================================================================

function DevControls({ defaultProps }: DevControlsProps) {
	const [isOpen, setIsOpen] = useState(() => {
		if (typeof window === "undefined") return false;
		return localStorage.getItem("dev-controls-open") === "true";
	});
	const [isAnimating, setIsAnimating] = useState(false);
	const [shouldRender, setShouldRender] = useState(isOpen);
	const [displayMode, setDisplayMode] = useState<DisplayMode>("inline");
	const [theme, setTheme] = useState<Theme>("dark");
	const [showSafeArea, setShowSafeArea] = useState(false);
	const [propsJson, setPropsJson] = useState(() =>
		JSON.stringify(defaultProps ?? {}, null, 2),
	);
	const [jsonError, setJsonError] = useState<string | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Initialize from mock state
	useEffect(() => {
		const state = getMockState();
		setDisplayMode(state.displayMode);
		setTheme(state.theme);
	}, []);

	// Update safeArea when toggled
	useEffect(() => {
		if (typeof window === "undefined") return;
		if (!window.openai) {
			// biome-ignore lint/suspicious/noExplicitAny: window.openai may not exist yet
			(window as any).openai = {};
		}
		window.openai.safeArea = {
			insets: {
				top: 0,
				bottom: showSafeArea ? MOCK_SAFE_AREA_HEIGHT : 0,
				left: 0,
				right: 0,
			},
		};
		window.dispatchEvent(
			new SetGlobalsEvent({ globals: { safeArea: window.openai.safeArea } }),
		);
	}, [showSafeArea]);

	// Persist open state
	useEffect(() => {
		localStorage.setItem("dev-controls-open", String(isOpen));
	}, [isOpen]);

	const openPanel = useCallback(() => {
		setShouldRender(true);
		// Small delay to ensure DOM is ready for animation
		requestAnimationFrame(() => {
			setIsOpen(true);
		});
	}, []);

	const closePanel = useCallback(() => {
		setIsAnimating(true);
		setIsOpen(false);
		// Wait for exit animation
		setTimeout(() => {
			setShouldRender(false);
			setIsAnimating(false);
		}, 150);
	}, []);

	const togglePanel = useCallback(() => {
		if (isOpen) {
			closePanel();
		} else {
			openPanel();
		}
	}, [isOpen, openPanel, closePanel]);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Cmd/Ctrl + Shift + D to toggle
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
				e.preventDefault();
				togglePanel();
			}
			// Escape to close
			if (e.key === "Escape" && isOpen) {
				closePanel();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, togglePanel, closePanel]);

	// Click outside to close
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				closePanel();
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isOpen, closePanel]);

	const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
		setDisplayMode(mode);
		updateMockDisplayMode(mode);
	}, []);

	const handleThemeChange = useCallback((newTheme: Theme) => {
		setTheme(newTheme);
		updateMockTheme(newTheme);
	}, []);

	const applyProps = useCallback((json: string) => {
		try {
			const parsed = JSON.parse(json);
			setJsonError(null);
			updateMockToolOutput(parsed);
		} catch {
			setJsonError("Invalid JSON");
		}
	}, []);

	const handlePropsChange = useCallback(
		(json: string) => {
			setPropsJson(json);
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
			debounceRef.current = setTimeout(() => {
				applyProps(json);
			}, 500);
		},
		[applyProps],
	);

	const handlePropsBlur = useCallback(() => {
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}
		applyProps(propsJson);
	}, [applyProps, propsJson]);

	const handleReset = useCallback(() => {
		const defaultJson = JSON.stringify(defaultProps ?? {}, null, 2);
		setPropsJson(defaultJson);
		setJsonError(null);
		updateMockToolOutput(defaultProps ?? {});
		setDisplayMode("inline");
		updateMockDisplayMode("inline");
		setTheme("dark");
		updateMockTheme("dark");
	}, [defaultProps]);

	const displayModeOptions: SegmentOption<DisplayMode>[] = [
		{
			value: "inline",
			label: "inline",
			icon: <InlineIcon className="w-3.5 h-3.5" />,
		},
		{ value: "pip", label: "pip", icon: <PipIcon className="w-3.5 h-3.5" /> },
		{
			value: "fullscreen",
			label: "full",
			icon: <FullscreenIcon className="w-3.5 h-3.5" />,
		},
	];

	const themeOptions: SegmentOption<Theme>[] = [
		{
			value: "light",
			label: "light",
			icon: <SunIcon className="w-3.5 h-3.5" />,
		},
		{
			value: "dark",
			label: "dark",
			icon: <MoonIcon className="w-3.5 h-3.5" />,
		},
	];

	return (
		<>
			{/* Inject animation styles */}
			{/** biome-ignore lint/security/noDangerouslySetInnerHtml: we need to inject styles into the DOM */}
			<style dangerouslySetInnerHTML={{ __html: panelAnimationStyles }} />

			<div
				ref={containerRef}
				className="fixed bottom-4 right-4 z-[9999] font-['Inter',_system-ui,_sans-serif]"
			>
				{/* Toggle Button */}
				<button
					type="button"
					onClick={togglePanel}
					className="group relative flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200 ease-out hover:scale-105 active:scale-95"
					style={{
						background: "rgba(14, 14, 16, 0.95)",
						backdropFilter: "blur(16px)",
						WebkitBackdropFilter: "blur(16px)",
						border: "1px solid rgba(255, 255, 255, 0.08)",
						boxShadow: `
              0 4px 12px rgba(0, 0, 0, 0.4),
              0 0 0 1px rgba(255, 255, 255, 0.05),
              inset 0 1px 0 rgba(255, 255, 255, 0.04)
            `,
					}}
					aria-label="Toggle Dev Controls"
					aria-expanded={isOpen}
				>
					<DevIcon
						className={`w-5 h-5 transition-all duration-200 ${
							isOpen
								? "text-indigo-400 scale-110"
								: "text-gray-300 group-hover:text-white"
						}`}
					/>

					{/* Subtle glow on hover */}
					<div
						className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
						style={{
							background:
								"radial-gradient(circle at center, rgba(99, 102, 241, 0.15) 0%, transparent 70%)",
						}}
					/>
				</button>

				{/* Panel */}
				{shouldRender && (
					<div
						ref={panelRef}
						className={`absolute bottom-14 right-0 w-80 ${
							isOpen && !isAnimating ? "dev-panel-enter" : "dev-panel-exit"
						}`}
						style={{
							maxHeight: "calc(100vh - 120px)",
							background: "rgba(14, 14, 16, 0.92)",
							backdropFilter: "blur(24px)",
							WebkitBackdropFilter: "blur(24px)",
							border: "1px solid rgba(255, 255, 255, 0.06)",
							borderRadius: "16px",
							boxShadow: `
                0 25px 50px -12px rgba(0, 0, 0, 0.6),
                0 0 0 1px rgba(255, 255, 255, 0.05),
                inset 0 1px 0 rgba(255, 255, 255, 0.04)
              `,
						}}
					>
						{/* Header */}
						<div
							className="flex items-center justify-between px-4 py-3"
							style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}
						>
							<div className="flex items-center gap-2">
								<DevIcon className="w-4 h-4 text-gray-400" />
								<span className="text-sm font-medium text-white">
									Dev Controls
								</span>
							</div>

							<div className="flex items-center gap-2">
								{/* Keyboard shortcut badge */}
								<span
									className="text-[10px] font-medium text-gray-500 px-1.5 py-0.5 rounded"
									style={{
										background: "rgba(255, 255, 255, 0.04)",
										border: "1px solid rgba(255, 255, 255, 0.06)",
									}}
								>
									{typeof navigator !== "undefined" &&
									navigator.platform?.includes("Mac")
										? "⌘⇧D"
										: "Ctrl+Shift+D"}
								</span>

								{/* Close button */}
								<button
									type="button"
									onClick={closePanel}
									className="p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
								>
									<CloseIcon className="w-4 h-4" />
								</button>
							</div>
						</div>

						{/* Content */}
						<div
							className="p-4 space-y-5 overflow-y-auto"
							style={{ maxHeight: "calc(100vh - 200px)" }}
						>
							{/* Display Mode */}
							<div>
								<label
									htmlFor="display-mode"
									className="text-[11px] font-medium uppercase tracking-wider text-gray-500 block mb-2"
								>
									Display Mode
								</label>
								<SegmentedControl
									options={displayModeOptions}
									value={displayMode}
									onChange={handleDisplayModeChange}
								/>
							</div>

							{/* Theme */}
							<div>
								<label
									htmlFor="theme"
									className="text-[11px] font-medium uppercase tracking-wider text-gray-500 block mb-2"
								>
									Theme
								</label>
								<SegmentedControl
									options={themeOptions}
									value={theme}
									onChange={handleThemeChange}
								/>
							</div>

							{/* Safe Area Mock */}
							<div>
								<label
									htmlFor="safe-area"
									className="text-[11px] font-medium uppercase tracking-wider text-gray-500 block mb-2"
								>
									Safe Area (Chat Input)
								</label>
								<button
									type="button"
									onClick={() => setShowSafeArea(!showSafeArea)}
									className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-150 ${
										showSafeArea ? "text-emerald-400" : "text-gray-400"
									}`}
									style={{
										background: showSafeArea
											? "rgba(34, 197, 94, 0.1)"
											: "rgba(255, 255, 255, 0.04)",
										border: showSafeArea
											? "1px solid rgba(34, 197, 94, 0.3)"
											: "1px solid rgba(255, 255, 255, 0.06)",
									}}
								>
									<span>Mock ChatGPT Input Bar</span>
									<span
										className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
											showSafeArea
												? "bg-emerald-500/20 text-emerald-400"
												: "bg-gray-500/20 text-gray-500"
										}`}
									>
										{showSafeArea ? "ON" : "OFF"}
									</span>
								</button>
								{showSafeArea && (
									<p className="text-[10px] text-gray-500 mt-1.5">
										bottom: {MOCK_SAFE_AREA_HEIGHT}px
									</p>
								)}
							</div>

							{/* Widget Props */}
							<div>
								<label
									htmlFor="widget-props"
									className="text-[11px] font-medium uppercase tracking-wider text-gray-500 block mb-2"
								>
									Widget Props
								</label>
								<textarea
									value={propsJson}
									onChange={(e) => handlePropsChange(e.target.value)}
									onBlur={handlePropsBlur}
									className="dev-json-editor w-full min-h-[160px] text-xs text-gray-200 p-3 rounded-lg resize-none focus:outline-none transition-colors"
									style={{
										background: "rgba(0, 0, 0, 0.3)",
										border: jsonError
											? "1px solid rgba(239, 68, 68, 0.5)"
											: "1px solid rgba(255, 255, 255, 0.06)",
										fontFamily:
											"'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
										lineHeight: 1.6,
									}}
									onFocus={(e) => {
										if (!jsonError) {
											e.target.style.borderColor = "rgba(99, 102, 241, 0.5)";
										}
									}}
									onBlurCapture={(e) => {
										if (!jsonError) {
											e.target.style.borderColor = "rgba(255, 255, 255, 0.06)";
										}
									}}
									spellCheck={false}
								/>
								{jsonError && (
									<p className="text-red-400 text-[11px] mt-1.5 flex items-center gap-1">
										<svg
											aria-hidden="true"
											aria-label="Error"
											className="w-3 h-3"
											viewBox="0 0 16 16"
											fill="currentColor"
										>
											<path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7 4.5h2v4H7v-4zm0 5h2v2H7v-2z" />
										</svg>
										{jsonError}
									</p>
								)}
							</div>

							{/* Reset Button */}
							<button
								type="button"
								onClick={handleReset}
								className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-400 transition-all duration-150 hover:text-gray-200"
								style={{
									background: "rgba(255, 255, 255, 0.04)",
									border: "1px solid rgba(255, 255, 255, 0.06)",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.background =
										"rgba(255, 255, 255, 0.08)";
									e.currentTarget.style.borderColor =
										"rgba(255, 255, 255, 0.1)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.background =
										"rgba(255, 255, 255, 0.04)";
									e.currentTarget.style.borderColor =
										"rgba(255, 255, 255, 0.06)";
								}}
							>
								<ResetIcon className="w-3.5 h-3.5" />
								Reset to Defaults
							</button>
						</div>
					</div>
				)}
			</div>

			{/* Mock ChatGPT Input Bar */}
			{showSafeArea && (
				<div
					className="fixed bottom-0 left-0 right-0 z-[9998] flex items-center justify-center pointer-events-none"
					style={{
						height: `${MOCK_SAFE_AREA_HEIGHT}px`,
						background:
							"linear-gradient(to top, #1a1a1a 0%, #1a1a1a 80%, transparent 100%)",
					}}
				>
					<div className="w-full max-w-2xl mx-4 px-4 py-3 rounded-2xl bg-[#2f2f2f] border border-[#424242] flex items-center gap-3">
						<div className="w-8 h-8 rounded-full bg-[#424242] flex items-center justify-center">
							<svg
								aria-hidden="true"
								className="w-4 h-4 text-gray-400"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 4v16m8-8H4"
								/>
							</svg>
						</div>
						<div className="flex-1 text-gray-400 text-sm">
							Ask me anything...
						</div>
						<div className="w-8 h-8 rounded-full bg-[#424242] flex items-center justify-center">
							<svg
								aria-hidden="true"
								className="w-4 h-4 text-gray-400"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
								/>
							</svg>
						</div>
					</div>
					<div className="absolute bottom-1 text-[10px] text-gray-600 font-mono">
						Mock SafeArea: bottom={MOCK_SAFE_AREA_HEIGHT}px
					</div>
				</div>
			)}
		</>
	);
}
