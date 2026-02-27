import { Playground } from "@/features/playground";
import { cookies } from "next/headers";

export default async function Page() {
  const cookieStore = await cookies();
  const layout = cookieStore.get("playground-layout")?.value ?? "card";
  const mode = cookieStore.get("playground-mode")?.value ?? "dark";
  const locale = cookieStore.get("WANIWANI_LOCALE")?.value ?? "fr";

  return (
    <Playground
      initialLayout={layout}
      initialMode={mode}
      initialLocale={locale}
    />
  );
}
