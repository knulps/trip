'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import {
  defaultLocale,
  isLocale,
  locales,
  setLocaleCookie,
  type Locale,
} from '@/i18n/config'

// 버튼에 찍히는 이름은 두 글자 언어 코드로 통일한다 (한 → KO)
const LOCALE_LABELS: Record<Locale, string> = {
  ko: 'KO',
  en: 'EN',
}

export default function LocaleSwitcher() {
  const locale = useLocale()
  const t = useTranslations('nav')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // 로케일이 셋 이상으로 늘어나도 순환하도록 목록에서 다음 값을 구한다
  const current: Locale = isLocale(locale) ? locale : defaultLocale
  const next: Locale = locales[(locales.indexOf(current) + 1) % locales.length]

  function toggle() {
    setLocaleCookie(next)
    startTransition(() => router.refresh())
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      aria-busy={isPending}
      className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-50"
      aria-label={t('switchLanguage')}
    >
      {LOCALE_LABELS[next]}
    </button>
  )
}
