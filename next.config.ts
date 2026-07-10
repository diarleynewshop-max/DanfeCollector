import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  // Evita que `next build` apague chunks usados pelo servidor local em execução.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  experimental: {
    // Upload de anexos (PDF/foto/planilha) via server action — o padrão é 1MB.
    serverActions: { bodySizeLimit: "30mb" },
  },
  // pdf-parse (usa pdfjs) roda melhor fora do bundle do servidor.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
