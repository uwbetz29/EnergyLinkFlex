import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // Bundle WASM files for DWG parsing in serverless functions
  outputFileTracingIncludes: {
    "/api/dwg/parse": [
      path.join(
        __dirname,
        "node_modules/@mlightcad/libredwg-web/wasm/**/*"
      ),
    ],
  },
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Allow WASM imports in server-side code
    if (isServer) {
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      };
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "tkmnomntevbskxpgsuaf.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
