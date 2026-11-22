import { Anton, DM_Serif_Display, Lora, Tinos, UnifrakturMaguntia } from "next/font/google";
import type { Metadata } from "next";
import { APP_URL } from "@/lib/app-url";
import "./newsletter.css";

export const metadata: Metadata = { metadataBase: APP_URL ? new URL(APP_URL) : undefined };

const tinos = Tinos({ variable: "--font-nl-tinos", subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"] });
const lora = Lora({ variable: "--font-nl-lora", subsets: ["latin"], style: ["normal", "italic"] });
const anton = Anton({ variable: "--font-nl-anton", subsets: ["latin"], weight: "400" });
const dmSerif = DM_Serif_Display({ variable: "--font-nl-dmserif", subsets: ["latin"], weight: "400" });
const fraktur = UnifrakturMaguntia({ variable: "--font-nl-fraktur", subsets: ["latin"], weight: "400" });

export default function NewsletterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`newsletter ${tinos.variable} ${lora.variable} ${anton.variable} ${dmSerif.variable} ${fraktur.variable} min-h-full`}
    >
      {children}
    </div>
  );
}
