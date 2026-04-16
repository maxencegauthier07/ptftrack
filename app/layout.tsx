import type { Metadata } from "next";
import "./globals.css";
import { UserProvider } from "@/components/UserContext";

export const metadata: Metadata = {
  title: "ptftrack",
  description: "Personal wealth tracker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <UserProvider>{children}</UserProvider>
      </body>
    </html>
  );
}