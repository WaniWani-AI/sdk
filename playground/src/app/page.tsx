"use client";

import { useState } from "react";
import { ChatBar, ChatCard, DARK_THEME } from "@waniwani/sdk/chat";

const LAYOUTS = ["bar", "card"] as const;
type Layout = (typeof LAYOUTS)[number];

export default function Page() {
  const [layout, setLayout] = useState<Layout>("card");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
      }}
    >
      {/* Dev toolbar */}
      <div
        style={{
          position: "fixed",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50,
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 10,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(8px)",
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayout(l)}
            style={{
              padding: "5px 14px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontWeight: 500,
              transition: "all 150ms",
              background: layout === l ? "#fff" : "transparent",
              color: layout === l ? "#000" : "rgba(255,255,255,0.6)",
            }}
          >
            {l.charAt(0).toUpperCase() + l.slice(1)}
          </button>
        ))}
      </div>

      {/* Chat widget */}
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
            allowAttachments
          />
        )}
        {layout === "card" && (
          <ChatCard
            api="/api/chat"
            title="ChatGPT"
            subtitle="Online"
            welcomeMessage="Hey! How can I help you today?"
            theme={DARK_THEME}
            allowAttachments
            width={1000}
            height={700}
          />
        )}
      </div>
    </div>
  );
}
