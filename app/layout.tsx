import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Infinite",
  description: "Spatial UI Dev Tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
      </head>
      <body>{children}</body>
    </html>
  );
}
