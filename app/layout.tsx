import './globals.css';
import type { Metadata } from 'next';
import CartBadgeHydrator from '@/components/CartBadgeHydrator';
import CurrentRouteHighlight from '@/components/CurrentRouteHighlight';

export const metadata: Metadata = {
  title: 'Seedlings Microgreens',
  description: 'Seedlings Microgreens',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><CartBadgeHydrator /><CurrentRouteHighlight />{children}</body></html>;
}
