import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

// Mantem as Server Functions perto do Supabase hospedado no Brasil.
export const preferredRegion = 'gru1';

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Proton-e",
    template: "%s | Proton-e",
  },
  description: "Gestao digital de documentos fiscais",
  applicationName: "Proton-e",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/proton-e-mark-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/proton-e-mark-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/brand/proton-e-apple-touch.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${spaceGrotesk.className} bg-[var(--ground)] text-[var(--ink)] antialiased`}>{children}</body>
    </html>
  );
}
