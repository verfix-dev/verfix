import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import WorkspaceShell from '@/components/WorkspaceShell';

export const metadata: Metadata = {
  title: 'Verfix — AI Verification Runtime',
  description: 'Reliable browser verification for AI-generated software.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeScript = `
    try {
      var saved = localStorage.getItem('verfix-theme') || 'system';
      var resolved = saved === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : saved;
      document.documentElement.dataset.theme = resolved;
    } catch (_) {
      document.documentElement.dataset.theme = 'dark';
    }
  `;

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <Script id="verfix-theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <WorkspaceProvider>
          <WorkspaceShell>
            {children}
          </WorkspaceShell>
        </WorkspaceProvider>
      </body>
    </html>
  );
}

