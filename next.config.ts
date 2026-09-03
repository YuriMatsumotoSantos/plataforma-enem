import type { NextConfig } from "next";
import { getSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  headers() {
    return [
      {
        source: "/:path*",
        headers: getSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
