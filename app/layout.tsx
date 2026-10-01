import './globals.css';
import type { Metadata } from 'next';
import CartBadgeHydrator from '@/components/CartBadgeHydrator';
import CurrentRouteHighlight from '@/components/CurrentRouteHighlight';
import AccountSidebarHydrator from '@/components/AccountSidebarHydrator';
import CustomerLoginModal from '@/components/CustomerLoginModal';
import PaymentRecoveryHydrator from '@/components/PaymentRecoveryHydrator';

export const metadata: Metadata = {
  title: 'Seedlings Microgreens',
  description: 'Seedlings Microgreens',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><CartBadgeHydrator /><CurrentRouteHighlight /><AccountSidebarHydrator /><CustomerLoginModal /><PaymentRecoveryHydrator />{children}</body></html>;
}
