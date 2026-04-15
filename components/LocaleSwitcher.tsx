'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export default function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function toggle() {
    const next = locale === 'ko' ? 'en' : 'ko'
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; SameSite=Lax`
    startTransition(() => router.refresh())
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-50"
      aria-label="Switch language"
    >
      {locale === 'ko' ? 'EN' : '한'}
    </button>
  )
}
