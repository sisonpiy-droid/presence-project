import "./globals.css";

export const metadata = {
  title: "BrandSync — catch off-brand content before it goes live",
  description: "Check every draft against your brand guide with AI. See the rule it breaks, get a fix, approve with confidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
