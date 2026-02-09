"use client";

import { ChatWidget } from "@waniwani/sdk/chat";

export default function Page() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <ChatWidget
        api="/api/chat"
        title="WaniWani Chat"
        subtitle="SDK Playground"
        welcomeMessage="Hey! How can I help you today?"
        width={420}
        height={640}
        allowAttachments
        onMessageSent={(msg) => console.log("[playground] sent:", msg)}
        onResponseReceived={() => console.log("[playground] response received")}
      />
    </div>
  );
}
