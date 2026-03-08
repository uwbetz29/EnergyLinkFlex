import type { Metadata } from "next";
import { Roboto, Asap, Geist_Mono } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const asap = Asap({
  variable: "--font-asap",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
    <html lang="en">
      <body
        className={`${roboto.variable} ${asap.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
