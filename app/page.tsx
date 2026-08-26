import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Trip } from '@/types/supabase'
import { getTranslations, getFormatter } from 'next-intl/server'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import PendingInviteRedirect from '@/components/PendingInviteRedirect'
import { formatFullDate } from '@/lib/format'

// 초대 라우트가 실패 시 붙여 보내는 error 쿼리 값
const INVITE_ERROR_KEYS = {
  invalid_invite: 'errorInvalidInvite',
  invite_failed: 'errorInviteFailed',
} as const

type InviteErrorCode = keyof typeof INVITE_ERROR_KEYS

function toInviteErrorCode(value: string | string[] | undefined): InviteErrorCode | null {
  const code = Array.isArray(value) ? value[0] : value
  if (code && code in INVITE_ERROR_KEYS) return code as InviteErrorCode
  return null
}

// Supabase 조인 결과는 관계 정의에 따라 객체/배열/null 로 올 수 있어 런타임에서 좁힌다
function isTrip(value: unknown): value is Trip {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.start_date === 'string' &&
    typeof row.end_date === 'string' &&
    typeof row.created_at === 'string'
  )
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const t = await getTranslations('home')
  const tCommon = await getTranslations('common')
  // 서버 컴포넌트에서는 훅 대신 getFormatter() 로 같은 포맷터를 얻는다
  const format = await getFormatter()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Next 16 에서 searchParams 는 Promise 라 await 이 필요하다
  const inviteError = toInviteErrorCode((await searchParams).error)

  // 내가 멤버인 여행 목록 (trip_members → trips JOIN)
  const { data: memberships } = await supabase
    .from('trip_members')
    .select('trips(*)')
    .eq('user_id', user.id)

  const trips = (memberships ?? [])
    .flatMap(m => {
      const joined: unknown = m.trips
      if (Array.isArray(joined)) return joined.filter(isTrip)
      return isTrip(joined) ? [joined] : []
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <main className="flex flex-col h-full">
      <header className="flex items-center justify-between px-5 pb-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Link
            href="/trip/new"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white text-xl leading-none"
            aria-label={t('newTrip')}
          >
            +
          </Link>
        </div>
      </header>

      {/* 초대 실패 안내 — 닫기는 error 쿼리를 뗀 '/' 로 이동해서 처리한다 */}
      {inviteError && (
        <div className="px-5 pb-3">
          <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3">
            <p className="flex-1 text-xs text-red-600">{t(INVITE_ERROR_KEYS[inviteError])}</p>
            <Link
              href="/"
              aria-label={tCommon('close')}
              className="shrink-0 text-red-400 text-sm leading-none"
            >
              ✕
            </Link>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            {/*
              여행이 하나도 없을 때만 대기 중인 초대를 마저 처리한다.
              여행이 있으면 렌더하지 않으므로, 초대가 이미 성공한 사용자가 나중에
              홈에 들어와도 엉뚱한 곳으로 튕기지 않는다.
              초대 오류를 표시 중일 때도 제외한다 — 방금 실패한 초대를 다시 시도해
              같은 오류를 반복하게 만들 이유가 없다.
            */}
            {!inviteError && <PendingInviteRedirect />}
            <p className="text-sm text-gray-400">{t('empty')}</p>
            {/* 토큰이 완전히 유실된 사용자가 스스로 복구할 수 있는 유일한 실마리 */}
            <p className="text-xs text-gray-400">{t('inviteHint')}</p>
            <Link
              href="/trip/new"
              className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white"
            >
              {t('createFirst')}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {trips.map(trip => (
              <li key={trip.id}>
                <Link
                  href={`/trip/${trip.id}`}
                  className="flex flex-col gap-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-transform active:scale-95"
                >
                  <span className="font-medium">{trip.name}</span>
                  <span className="text-xs text-gray-400">
                    {formatFullDate(format, trip.start_date)} – {formatFullDate(format, trip.end_date)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
