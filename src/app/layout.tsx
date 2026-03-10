import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/providers/auth-provider";
import { DevBanner } from "@/components/dev-banner";
import "./globals.css";

const overpass = localFont({
  src: [
    {
      path: "../../public/fonts/Overpass-VariableFont_wght.ttf",
      style: "normal",
    },
    {
      path: "../../public/fonts/Overpass-Italic-VariableFont_wght.ttf",
      style: "italic",
    },
  ],
  variable: "--font-overpass",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EnergyLink FLEX",
  description: "EnergyLink FLEX — Engineering drawing tools for power generation systems",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${overpass.className} ${geistMono.variable}`}>
      <body className="antialiased">
        <AuthProvider>
          {children}
          <DevBanner />
        </AuthProvider>
      </body>
    </html>
  );
}
