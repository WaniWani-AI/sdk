"use client";

import { useState } from "react";
import { ChatBar, ChatCard, DARK_THEME, DEFAULT_THEME } from "@waniwani/sdk/chat";
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
            api="/api/chat"
            welcomeMessage="Hey! How can I help you today?"
            theme={mode === "dark" ? DARK_THEME : DEFAULT_THEME}
            allowAttachments
          />
        )}
        {layout === "card" && (
          <ChatCard
            api="/api/chat"
            title="ChatGPT"
            welcomeMessage="Hey! How can I help you today?"
            theme={mode === "dark" ? DARK_THEME : DEFAULT_THEME}
            allowAttachments
            width={1000}
            height={700}
          />
        )}
      </div>
    </div>
  );
}
