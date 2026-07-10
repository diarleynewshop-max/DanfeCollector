import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// Fonte fina e arredondada, com curvas mais encorpadas nos pesos altos.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DanfeCollector",
  description: "Sincronização direta de NF-e com a SEFAZ",
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
