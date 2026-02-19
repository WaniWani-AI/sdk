"use client";

import { useRef, useState } from "react";
import { ChatBar, ChatCard, DARK_THEME, DEFAULT_THEME, type ChatHandle } from "@waniwani/sdk/chat";
import { DevToolbar } from "./dev-toolbar";
import { LAYOUTS, MODES, type Layout, type Mode } from "./types";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value};path=/;max-age=31536000`;
}

export function Playground({
  initialLayout,
  initialMode,
}: {
  initialLayout: string;
  initialMode: string;
}) {
  const chatRef = useRef<ChatHandle>(null);

  const [layout, setLayout] = useState<Layout>(
    LAYOUTS.includes(initialLayout as Layout) ? (initialLayout as Layout) : "card"
  );
  const [mode, setMode] = useState<Mode>(
    MODES.includes(initialMode as Mode) ? (initialMode as Mode) : "dark"
  );

  function updateLayout(l: Layout) {
    setLayout(l);
    setCookie("playground-layout", l);
  }

  function updateMode(m: Mode) {
    setMode(m);
    setCookie("playground-mode", m);
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
            suggestions
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
              initial: ["Tell me about waniwani", "I want to request a demo"],
            }}
          />
        )}
      </div>
    </div>
  );
}
