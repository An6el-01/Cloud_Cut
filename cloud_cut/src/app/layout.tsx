import type { Metadata } from "next";
import { GeistSans, GeistMono } from 'geist/font';
import "./globals.css";
import ClientProvider from "@/components/ClientProvider";
import RouteProtection from "@/components/RouteProtection";

export const metadata: Metadata = {
  title: "CloudCut - Nest Cutting System",
  description: "Advanced cutting system management platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased bg-white dark:bg-gray-900">
        <ClientProvider>
          <RouteProtection>
            {children}
          </RouteProtection>
        </ClientProvider>
      </body>
    </html>
  );
}