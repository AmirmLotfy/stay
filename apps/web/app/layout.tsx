import '@fontsource-variable/atkinson-hyperlegible-next';
import './styles.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'STAY — Help that keeps you in control',
  description: 'Adaptive independent living and Circle coordination for Alexa+.',
  applicationName: 'STAY',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { rel: 'icon', url: '/icon.svg', type: 'image/svg+xml' },
      { rel: 'icon', url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f0e8' },
    { media: '(prefers-color-scheme: dark)', color: '#1e2321' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
