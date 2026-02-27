import type { NextConfig } from "next";
import { baseURL } from "./baseUrl";
import path from "node:path";

// Use the symlink path (not resolved real path) so Turbopack sees it as inside the project
const sdkSymlink = path.join(__dirname, "node_modules/@waniwani/sdk");

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  transpilePackages: ["@waniwani/sdk"],
  turbopack: {
    resolveAlias: {
      "@waniwani/sdk/mcp/react": path.join(sdkSymlink, "dist/mcp/react.js"),
      "@waniwani/sdk/mcp": path.join(sdkSymlink, "dist/mcp/index.js"),
      "@waniwani/sdk/chat/server": path.join(sdkSymlink, "dist/chat/server/index.js"),
      "@waniwani/sdk/chat": path.join(sdkSymlink, "dist/chat/index.js"),
      "@waniwani/sdk/next-js": path.join(sdkSymlink, "dist/chat/next-js/index.js"),
      "@waniwani/sdk": path.join(sdkSymlink, "dist/index.js"),
    },
  },
  webpack: (config) => {
    config.resolve.symlinks = false;
    // Prioritize demo-mcp's node_modules so the symlinked SDK's own react isn't picked up
    config.resolve.modules = [
      path.join(__dirname, "node_modules"),
      ...(config.resolve.modules || ["node_modules"]),
    ];
    return config;
  },
  assetPrefix: baseURL,
  allowedDevOrigins: ["*"],
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
