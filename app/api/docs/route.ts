import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export function GET() {
  redirect('/api-docs');
}
