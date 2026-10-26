import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["pg", "sharp"],
  poweredByHeader: false,
};
export default config;
