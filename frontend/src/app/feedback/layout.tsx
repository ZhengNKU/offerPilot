import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "体验反馈中心",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function FeedbackLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
