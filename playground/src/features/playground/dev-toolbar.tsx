"use client";

import type { Layout, Mode } from "./types";
import { LAYOUTS, MODES } from "./types";

export function DevToolbar({
  layout,
  mode,
  onLayoutChange,
  onModeChange,
}: {
  layout: Layout;
  mode: Mode;
  onLayoutChange: (layout: Layout) => void;
  onModeChange: (mode: Mode) => void;
}) {
  return (
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
          onClick={() => onLayoutChange(l)}
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

      <div style={{ width: 1, background: "rgba(255,255,255,0.2)", margin: "4px 4px" }} />

      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onModeChange(m)}
          style={{
            padding: "5px 14px",
            borderRadius: 7,
            border: "none",
            cursor: "pointer",
            fontWeight: 500,
            transition: "all 150ms",
            background: mode === m ? "#fff" : "transparent",
            color: mode === m ? "#000" : "rgba(255,255,255,0.6)",
          }}
        >
          {m === "dark" ? "Dark" : "Light"}
        </button>
      ))}
    </div>
  );
}
