"use client";

import { useRef, useState } from "react";
import { ChatBar, ChatCard, DARK_THEME, DEFAULT_THEME, type ChatHandle } from "@waniwani/sdk/chat";
import { DevToolbar } from "./dev-toolbar";
import { LAYOUTS, MODES, type Layout, type Mode } from "./types";

type SupportedLocale = "en" | "fr";

const INITIAL_SUGGESTIONS: Record<SupportedLocale, string[]> = {
  en: [
    "I want to open a Qonto account in France",
    "I want to see if switching to Qonto is worth it",
  ],
  fr: [
    "Je veux ouvrir un compte Qonto en France",
    "Je veux voir si ca vaut le coup de switch sur Qonto",
  ],
};

function resolveLocale(locale: string): SupportedLocale {
  const normalized = locale.trim().toLowerCase();

  if (normalized.startsWith("en") || normalized === "english") {
    return "en";
  }

  if (normalized.startsWith("fr") || normalized === "french") {
    return "fr";
  }

  return "fr";
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value};path=/;max-age=31536000`;
}

export function Playground({
  initialLayout,
  initialMode,
  initialLocale,
}: {
  initialLayout: string;
  initialMode: string;
  initialLocale: string;
}) {
  const chatRef = useRef<ChatHandle>(null);
  const locale = resolveLocale(initialLocale);
  const localizedSuggestions = INITIAL_SUGGESTIONS[locale];

  const [layout, setLayout] = useState<Layout>(
    LAYOUTS.includes(initialLayout as Layout) ? (initialLayout as Layout) : "card"
  );
  const [mode, setMode] = useState<Mode>(
    MODES.includes(initialMode as Mode) ? (initialMode as Mode) : "dark"
  );
  const [isEmitting, setIsEmitting] = useState(false);
  const [emitStatus, setEmitStatus] = useState<string | null>(null);

  function updateLayout(l: Layout) {
    setLayout(l);
    setCookie("playground-layout", l);
  }

  function updateMode(m: Mode) {
    setMode(m);
    setCookie("playground-mode", m);
  }

  async function emitV2TrackingSample() {
    setIsEmitting(true);
    setEmitStatus(null);

    try {
      const response = await fetch("/api/track-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "playground-button" }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        eventIds?: string[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }

      const eventCount = Array.isArray(data.eventIds) ? data.eventIds.length : 0;
      setEmitStatus(`Emitted ${eventCount} event(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setEmitStatus(`Emit failed: ${message}`);
    } finally {
      setIsEmitting(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
        background: mode === "dark" ? "#1a1a1a" : "#f5f5f5",
        transition: "background 200ms",
      }}
    >
      <DevToolbar
        layout={layout}
        mode={mode}
        onLayoutChange={updateLayout}
        onModeChange={updateMode}
      />

      <button
        type="button"
        onClick={() => chatRef.current?.sendMessage("I want to request a demo")}
        style={{
          position: "fixed",
          top: 12,
          right: 16,
          zIndex: 50,
          padding: "5px 14px",
          borderRadius: 7,
          border: "none",
          cursor: "pointer",
          fontWeight: 500,
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
          background: "#fff",
          color: "#000",
        }}
      >
        Request Demo
      </button>

      <button
        type="button"
        onClick={emitV2TrackingSample}
        disabled={isEmitting}
        style={{
          position: "fixed",
          top: 44,
          right: 16,
          zIndex: 50,
          padding: "5px 14px",
          borderRadius: 7,
          border: "none",
          cursor: isEmitting ? "not-allowed" : "pointer",
          fontWeight: 500,
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
          background: isEmitting ? "#b3b3b3" : "#fff",
          color: "#000",
          opacity: isEmitting ? 0.8 : 1,
        }}
      >
        {isEmitting ? "Emitting..." : "Emit V2 Event"}
      </button>

      {emitStatus && (
        <div
          style={{
            position: "fixed",
            top: 76,
            right: 16,
            zIndex: 50,
            padding: "5px 10px",
            borderRadius: 7,
            fontSize: 12,
            fontFamily: "system-ui, sans-serif",
            background: "rgba(0,0,0,0.8)",
            color: "#fff",
          }}
        >
          {emitStatus}
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: layout === "bar" ? "flex-end" : "center",
          justifyContent: "center",
          padding: 24,
          paddingTop: 60,
        }}
      >
        {layout === "bar" && (
          <ChatBar
            ref={chatRef}
            api="/api/waniwani"
            welcomeMessage="Hey! How can I help you today?"
            theme={mode === "dark" ? DARK_THEME : DEFAULT_THEME}
            allowAttachments
            suggestions={{
              dynamic: true,
              initial: localizedSuggestions,
            }}
          />
        )}
        {layout === "card" && (
          <ChatCard
            ref={chatRef}
            api="/api/waniwani"
            title="ChatGPT"
            welcomeMessage="Hey! How can I help you today?"
            theme={mode === "dark" ? DARK_THEME : DEFAULT_THEME}
            allowAttachments
            width={1000}
            height={700}
            suggestions={{
              dynamic: false,
              initial: localizedSuggestions,
            }}
          />
        )}
      </div>
    </div>
  );
}
