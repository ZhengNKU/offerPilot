import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "职业驾驶舱",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
