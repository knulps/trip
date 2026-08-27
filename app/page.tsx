import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Trip } from '@/types/supabase'
import { getTranslations, getFormatter } from 'next-intl/server'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import { formatFullDate } from '@/lib/format'

// 초대 라우트가 실패 시 붙여 보내는 error 쿼리 값
const INVITE_ERROR_KEYS = {
  invalid_invite: 'errorInvalidInvite',
  invite_failed: 'errorInviteFailed',
} as const

type InviteErrorCode = keyof typeof INVITE_ERROR_KEYS

function toInviteErrorCode(value: string | string[] | undefined): InviteErrorCode | null {
  const code = Array.isArray(value) ? value[0] : value
  // in 연산자는 prototype chain 까지 훑어 constructor, toString, valueOf, __proto__ 같은
  // Object.prototype 의 키도 통과시킨다. 그러면 INVITE_ERROR_KEYS[code] 가 번역 키 문자열이
  // 아니라 함수를 내놓고, 그 값이 t() 에 들어가면 내부에서 key.split('.') 를 부르다 터진다.
  // 이 페이지는 서버 컴포넌트라 그대로 500 이 된다 (?error=constructor 한 방).
  // 그래서 객체 자신이 직접 가진 키인지만 본다.
  if (code && Object.hasOwn(INVITE_ERROR_KEYS, code)) return code as InviteErrorCode
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
            <p className="text-sm text-gray-400">{t('empty')}</p>
            {/*
              토큰이 완전히 유실된 사용자가 스스로 복구할 수 있는 유일한 실마리다.
              쿠키가 따라오지 못한 상황을 앱이 알아서 이어 붙이는 방법은 없다 —
              그런 용도로 두었던 브라우저 저장소 백업은 나중에 로그인한 다른 계정이
              남의 초대를 대신 수락해 버리는 문제가 있어 걷어냈다. 사용자가 초대
              링크를 직접 다시 여는 것이 의도가 확인된 유일한 안전한 복구 경로다.
            */}
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
