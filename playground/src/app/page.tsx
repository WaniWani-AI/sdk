import { Playground } from "@/features/playground";
import { cookies } from "next/headers";

export default async function Page() {
  const cookieStore = await cookies();
  const layout = cookieStore.get("playground-layout")?.value ?? "card";
  const mode = cookieStore.get("playground-mode")?.value ?? "dark";

  return <Playground initialLayout={layout} initialMode={mode} />;
}
