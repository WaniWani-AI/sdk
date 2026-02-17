import { resolve } from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@waniwani/sdk"],
  turbopack: {
    root: resolve(process.cwd(), ".."),
  },
};

export default nextConfig;
