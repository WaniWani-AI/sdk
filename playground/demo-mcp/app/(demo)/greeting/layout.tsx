"use client";

import { WidgetProvider } from "@waniwani/sdk/mcp/react";

export const dynamic = "force-dynamic";

export default function GreetingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WidgetProvider>{children}</WidgetProvider>;
}
