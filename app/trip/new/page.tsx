'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'
import { formatLocalDate, parseLocalDate } from '@/lib/format'

// 여행 최대 기간 (오타로 연도를 잘못 입력해 수만 건이 insert 되는 것을 막는다)
const MAX_TRIP_DAYS = 60

const MS_PER_DAY = 24 * 60 * 60 * 1000

export default function NewTripPage() {
  const t = useTranslations('trip.new')
  const tNav = useTranslations('nav')
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // days 생성만 실패한 경우 여행 자체는 정상이므로, 중복 생성 대신 이동 버튼을 노출한다
  const [createdTripId, setCreatedTripId] = useState<string | null>(null)

  async function createTrip() {
    if (!name || !startDate || !endDate) return
    setError(null)

    const start = parseLocalDate(startDate)
    const end = parseLocalDate(endDate)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError(t('errorInvalidDate'))
      return
    }

    // input 의 min 속성은 키보드 입력이나 일부 모바일 피커에서 우회되므로 직접 검사한다
    if (end.getTime() < start.getTime()) {
      setError(t('errorEndBeforeStart'))
      return
    }

    // DST 때문에 하루가 정확히 24시간이 아닐 수 있어 반올림한다
    const dayCount = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
    if (dayCount > MAX_TRIP_DAYS) {
      setError(t('errorTooLong', { max: MAX_TRIP_DAYS }))
      return
    }

    setSaving(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert({ name, start_date: startDate, end_date: endDate, created_by: user.id })
      .select('id')
      .single()

    if (tripError || !trip) {
      setError(t('errorCreate'))
      setSaving(false)
      return
    }

    // owner로 trip_members에 추가
    // 실패하면 멤버가 하나도 없는 여행이 남는다. days/places 의 RLS 는 멤버 여부로 판정하므로
    // 만든 본인조차 날짜와 장소를 넣을 수 없다. 그래서 방금 만든 여행을 되돌린 뒤 에러를 알린다.
    const { error: memberError } = await supabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'owner',
    })

    if (memberError) {
      await supabase.from('trips').delete().eq('id', trip.id)
      setError(t('errorMember'))
      setSaving(false)
      return
    }

    // 시작일~종료일 days 자동 생성 (로컬 기준 날짜 연산)
    const dayInserts = Array.from({ length: dayCount }, (_, i) => ({
      trip_id: trip.id,
      date: formatLocalDate(
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      ),
    }))

    const { error: daysError } = await supabase.from('days').insert(dayInserts)

    if (daysError) {
      // 여행과 멤버십은 정상이므로 여행 화면에서 날짜를 직접 추가하면 복구된다
      setCreatedTripId(trip.id)
      setError(t('errorDays'))
      setSaving(false)
      return
    }

    // 이동이 끝날 때까지 saving 을 유지해 중복 생성을 막는다
    router.push(`/trip/${trip.id}`)
  }

  return (
    <main className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 pb-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button onClick={() => router.back()} aria-label={tNav('back')} className="text-gray-400 text-lg">
          ‹
        </button>
        <h1 className="text-base font-semibold">{t('title')}</h1>
      </header>

      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500">{t('nameLabel')}</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500">{t('startDate')}</label>
            <input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setError(null) }}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors"
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500">{t('endDate')}</label>
            <input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setError(null) }}
              min={startDate}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-600">
            {error}
          </p>
        )}

        {createdTripId ? (
          <button
            onClick={() => { setSaving(true); router.push(`/trip/${createdTripId}`) }}
            disabled={saving}
            className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white disabled:opacity-40 transition-opacity mt-2"
          >
            {t('openTrip')}
          </button>
        ) : (
          <button
            onClick={createTrip}
            disabled={!name || !startDate || !endDate || saving}
            className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white disabled:opacity-40 transition-opacity mt-2"
          >
            {saving ? t('submitting') : t('submit')}
          </button>
        )}
      </div>
    </main>
  )
}
