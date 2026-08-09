import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { ToastProvider } from "@/components/ui/ToastProvider";
import SiteFooter from "@/components/footer/SiteFooter";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rental by Maddy & Cassy",
  description:
    "Premium camera and iPhone rentals in Metro Manila. Quality equipment, simple booking, transparent pricing.",
  icons: {
    icon: "/images/maddy-cassy-rentals-icon.png",
    apple: "/images/maddy-cassy-rentals-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={poppins.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
            <SiteFooter />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
