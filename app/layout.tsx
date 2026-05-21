import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";

export const viewport: Viewport = {
  themeColor: "#0a0a0a"
};

export const metadata: Metadata = {
  title: "Infinite",
  description: "Spatial UI Dev Tool",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Infinite"
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon-192.png"
  }
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="serviceworker" href="/sw.js" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}