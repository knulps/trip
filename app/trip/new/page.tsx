'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function NewTripPage() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)

  async function createTrip() {
    if (!name || !startDate || !endDate) return
    setSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: trip, error } = await supabase
      .from('trips')
      .insert({ name, start_date: startDate, end_date: endDate, created_by: user.id })
      .select('id')
      .single()

    if (error || !trip) { setSaving(false); return }

    // owner로 trip_members에 추가
    await supabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'owner',
    })

    // 시작일~종료일 days 자동 생성
    const start = new Date(startDate)
    const end = new Date(endDate)
    const dayInserts = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dayInserts.push({ trip_id: trip.id, date: d.toISOString().split('T')[0] })
    }
    if (dayInserts.length > 0) {
      await supabase.from('days').insert(dayInserts)
    }

    router.push(`/trip/${trip.id}`)
  }

  return (
    <main className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 pt-10 pb-4">
        <button onClick={() => router.back()} className="text-gray-400 dark:text-gray-500 text-lg">
          ‹
        </button>
        <h1 className="text-base font-semibold">새 여행</h1>
      </header>

      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">여행 이름</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="예: 파리 여행"
            className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-gray-500 dark:focus:bg-gray-800"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">시작일</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:bg-gray-800"
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">종료일</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              min={startDate}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:bg-gray-800"
            />
          </div>
        </div>

        <button
          onClick={createTrip}
          disabled={!name || !startDate || !endDate || saving}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white disabled:opacity-40 transition-opacity mt-2"
        >
          {saving ? '만드는 중...' : '여행 만들기'}
        </button>
      </div>
    </main>
  )
}
