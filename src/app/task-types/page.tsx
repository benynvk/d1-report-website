'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Task types now live in Settings; keeps old bookmarks working. */
export default function TaskTypesRedirect() {
  const router = useRouter();
  useEffect(() => router.replace('/settings'), [router]);
  return null;
}
