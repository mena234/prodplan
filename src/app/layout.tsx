import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import "../production/components/platform.css";
import "../components/product-tour.css";
export const metadata: Metadata = {
  title: "ProdPlan · Production planning",
  description:
    "Plan manufacturing orders around machine capacity, materials and delivery dates. Try the real production app without an account.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
