// `waniwani init` does not copy this file. It writes its own, carrying the name
// and the title the person answered with, the way create-next-app writes a
// package.json instead of shipping one. This copy is what makes the folder
// around it a real app: `waniwani check` runs against it, and
// `tsconfig.templates.json` type-checks every file here.
import { defineApp } from "@waniwani/kit";

export default defineApp({
	// The MCP server name. Hosts show `title` to humans and use this one as the id.
	name: "starter",
	title: "Starter",
});
