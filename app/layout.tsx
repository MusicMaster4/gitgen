import type { Metadata } from "next";
import { Space_Mono, DM_Sans } from "next/font/google";
import "./globals.css";

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
  display: "swap",
});

const dmSans = DM_Sans({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Git Command Generator",
  description: "Escreve, o comando aparece. Sem frescura.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${spaceMono.variable} ${dmSans.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
