import type { Metadata } from "next";
import "./globals.css";
import { InitializeNextJsInChatGpt } from "@waniwani/sdk/mcp/react";
import { baseURL } from "@/baseUrl";

export const metadata: Metadata = {
  title: "demo",
  description: "MCP Server powered by Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <InitializeNextJsInChatGpt baseUrl={baseURL} />
      </head>
      <body>{children}</body>
    </html>
  );
}
