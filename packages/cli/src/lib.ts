/**
 * What `@waniwani/kit` imports from this package: the platform commands, and
 * the pieces its own `dev` uses to link a kit app to the platform. Nothing here
 * is meant for app code.
 */

export { type Flags, parseArgs } from "./args.js";
export { Platform, PlatformError } from "./client.js";
export { PLATFORM_COMMANDS, runPlatform } from "./commands.js";
export { goLive, type LinkPlan, type Live, plan } from "./link.js";
export { devScript } from "./script.js";
export { serve } from "./serve.js";
