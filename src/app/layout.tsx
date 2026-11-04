import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "El Mall Vivo",
  description: "Juego de terror en primera persona dentro de un centro comercial.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-CR">
      <body>{children}</body>
    </html>
  );
}
