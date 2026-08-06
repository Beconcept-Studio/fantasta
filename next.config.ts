import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Processo Node persistente su un singolo VPS (PLAN §1): niente serverless.
  // Lo scheduler in-process e lo stream SSE dipendono da questo.
  output: "standalone",
};

export default nextConfig;
