import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "营业执照",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function LicenseLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
