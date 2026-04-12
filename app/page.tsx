import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Trip } from '@/types/supabase'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // 내가 멤버인 여행 목록 (trip_members → trips JOIN)
  const { data: memberships } = await supabase
    .from('trip_members')
    .select('trips(*)')
    .eq('user_id', user.id)

  const trips = memberships
    ?.flatMap(m => (m.trips ? [m.trips as Trip] : []))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)) ?? []

  return (
    <main className="flex flex-col h-full">
      <header className="flex items-center justify-between px-5 pb-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <h1 className="text-xl font-semibold">여행</h1>
        <Link
          href="/trip/new"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white text-xl leading-none"
          aria-label="새 여행 만들기"
        >
          +
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <p className="text-sm text-gray-400">아직 여행이 없어요</p>
            <Link
              href="/trip/new"
              className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white"
            >
              첫 여행 만들기
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {trips.map(trip => (
              <li key={trip.id}>
                <Link
                  href={`/trip/${trip.id}`}
                  className="flex flex-col gap-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-transform active:scale-95 dark:border-gray-800 dark:bg-gray-950 dark:shadow-gray-900"
                >
                  <span className="font-medium">{trip.name}</span>
                  <span className="text-xs text-gray-400">
                    {trip.start_date} – {trip.end_date}
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
