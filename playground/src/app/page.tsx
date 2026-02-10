"use client";

import { ChatWidget } from "@waniwani/sdk/chat";

export default function Page() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <ChatWidget
        api="/api/chat"
        welcomeMessage="Hey! How can I help you today?"
        allowAttachments
        onMessageSent={(msg) => console.log("[playground] sent:", msg)}
        onResponseReceived={() => console.log("[playground] response received")}
      />
    </div>
  );
}
