import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
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
  title: "EnergyLinkage - Power Generation Drawing Scaling Tool",
  description:
    "Scale power generation CAD drawing components in seconds. Upload DXF/DWG drawings, click components, enter new dimensions, and export updated drawings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${overpass.className} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
