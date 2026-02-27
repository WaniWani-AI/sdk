"use client";

import type { GreetingWidgetProps } from "@/lib/demo/widgets/greeting";
import {
  useToolOutput,
  useToolResponseMetadata,
  useDisplayMode,
  useRequestDisplayMode,
  useSafeArea,
  useWaniwani,
} from "@waniwani/sdk/mcp/react";

function LoadingSkeleton() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-8 w-32 bg-white/10 rounded mb-4" />
      <div className="h-6 w-48 bg-white/10 rounded" />
    </div>
  );
}

export default function GreetingPage() {
  const props = useToolOutput<GreetingWidgetProps>();
  const toolResponseMetadata = useToolResponseMetadata();
  const displayMode = useDisplayMode();
  const requestDisplayMode = useRequestDisplayMode();
  const safeArea = useSafeArea();
  const bottomInset = safeArea?.insets?.bottom ?? 0;
  const rawMeta =
    toolResponseMetadata && typeof toolResponseMetadata === "object"
      ? (toolResponseMetadata as Record<string, unknown>)
      : null;
  const nestedMeta =
    rawMeta?._meta && typeof rawMeta._meta === "object"
      ? (rawMeta._meta as Record<string, unknown>)
      : null;
  const rawWaniwani = (rawMeta?.waniwani ??
    nestedMeta?.waniwani) as Record<string, unknown> | null;
  const waniwaniEndpoint =
    rawWaniwani && typeof rawWaniwani.endpoint === "string"
      ? rawWaniwani.endpoint
      : undefined;
  const waniwaniToken =
    rawWaniwani && typeof rawWaniwani.token === "string"
      ? rawWaniwani.token
      : undefined;
  // Auto-captures clicks, link clicks, errors, scrolls, form interactions
  const wani = useWaniwani(
    waniwaniEndpoint
      ? {
          endpoint: waniwaniEndpoint,
          token: waniwaniToken,
        }
      : {},
  );

  if (!props) {
    return <LoadingSkeleton />;
  }

  const { name, message } = props;
  const greeting = message || `Welcome, ${name}!`;

  const handleToggleMode = async () => {
    const target = displayMode === "fullscreen" ? "inline" : "fullscreen";
    await requestDisplayMode(target);
  };

  const handleDemoButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    wani.track("demo_button_click", { display_mode: displayMode });
    event.stopPropagation();
  };

  // Fullscreen mode
  if (displayMode === "fullscreen") {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center p-8"
        style={{
          paddingBottom: `${bottomInset}px`,
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        }}
      >
        <button
          onClick={handleToggleMode}
          className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center">
          <p className="text-white/60 text-sm uppercase tracking-wider mb-2">Hello</p>
          <h1 className="text-5xl font-bold text-white mb-4">{name}</h1>
          <p className="text-xl text-white/80">{greeting}</p>
          <button
            type="button"
            onClick={handleDemoButtonClick}
            className="mt-6 rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            Click me
          </button>
        </div>
      </div>
    );
  }

  // Inline mode (compact card)
  return (
    <div
      className="p-5 cursor-pointer group"
      style={{
        paddingBottom: `${bottomInset}px`,
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      }}
      onClick={handleToggleMode}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Greeting</p>
          <h2 className="text-2xl font-semibold text-white mb-1">{name}</h2>
          <p className="text-white/70 text-sm">{greeting}</p>
          <button
            type="button"
            onClick={handleDemoButtonClick}
            className="mt-3 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
          >
            Click me
          </button>
        </div>
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </div>
      </div>
    </div>
  );
}
