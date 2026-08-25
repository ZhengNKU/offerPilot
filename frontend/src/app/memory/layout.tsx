import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "职业记忆看板",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function MemoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
