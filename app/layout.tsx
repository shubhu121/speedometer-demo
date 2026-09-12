import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'Speedometer Gauge Component',
  description: 'Interactive digital and analog automotive speedometer and tachometer cluster gauge component demo.',
  openGraph: {
    title: 'Speedometer Gauge Component',
    description: 'Interactive digital and analog automotive speedometer and tachometer cluster gauge component demo.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Speedometer Gauge Component',
    description: 'Interactive digital and analog automotive speedometer and tachometer cluster gauge component demo.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning className="bg-[#0b0d0c] text-white antialiased overflow-hidden min-h-screen">
        {children}
      </body>
    </html>
  );
}
