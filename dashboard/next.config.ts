import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const cliPkg = require("../cli/package.json") as { version: string };

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: cliPkg.version,
  },
};

export default nextConfig;
