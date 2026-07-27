import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Danfe Collect",
    template: "%s | Danfe Collect",
  },
  description: "Gestao digital de documentos fiscais",
  applicationName: "Danfe Collect",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/danfe-collect-mark-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/danfe-collect-mark-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/brand/danfe-collect-apple-touch.png", sizes: "180x180", type: "image/png" },
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
      <body className={`${poppins.className} bg-[var(--ground)] text-[var(--ink)] antialiased`}>{children}</body>
    </html>
  );
}
