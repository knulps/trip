'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { Place, Day } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import { generateKeyBetween } from 'fractional-indexing'

interface Props {
  place: Place
  days?: Day[]
  onClose: () => void
  onSave: () => void
}

export default function EditPlaceModal({ place, days, onClose, onSave }: Props) {
  const t = useTranslations('trip.editPlace')
  const tCommon = useTranslations('common')
  const tRoot = useTranslations()
  const days_arr = tRoot.raw('days') as string[]

  const [name, setName] = useState(place.name)
  const [visitTime, setVisitTime] = useState(place.visit_time?.slice(0, 5) ?? '')
  const [memo, setMemo] = useState(place.memo ?? '')
  const [selectedDayId, setSelectedDayId] = useState(place.day_id)
  const [saving, setSaving] = useState(false)

  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function handleResize() {
      const kbHeight = window.innerHeight - vv!.height
      setKeyboardHeight(kbHeight > 0 ? kbHeight : 0)
    }

    vv.addEventListener('resize', handleResize)
    return () => vv.removeEventListener('resize', handleResize)
  }, [])

  const supabase = createClient()
  const dayChanged = selectedDayId !== place.day_id

  async function handleSave() {
    setSaving(true)

    if (dayChanged) {
      // 새 Day의 마지막 order_key 조회
      const { data: lastPlaces } = await supabase
        .from('places')
        .select('order_key')
        .eq('day_id', selectedDayId)
        .order('order_key', { ascending: false })
        .limit(1)

      const lastKey = lastPlaces?.[0]?.order_key ?? null
      const newKey = generateKeyBetween(lastKey, null)

      await supabase
        .from('places')
        .update({
          name,
          visit_time: visitTime || null,
          memo: memo || null,
          day_id: selectedDayId,
          order_key: newKey,
        })
        .eq('id', place.id)
    } else {
      await supabase
        .from('places')
        .update({ name, visit_time: visitTime || null, memo: memo || null })
        .eq('id', place.id)
    }

    setSaving(false)
    onSave()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50"
      onClick={onClose}
    >
      <div
        className="fixed bottom-0 left-0 right-0 rounded-t-2xl bg-white p-6 transition-transform"
        style={{ transform: keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          {t('title')}
        </h2>

        <div className="mb-4 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500">
            {t('nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>

        {days && days.length > 1 && (
          <div className="mb-4 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500">
              {t('moveDate')}
            </label>
            <select
              value={selectedDayId}
              onChange={(e) => setSelectedDayId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 pl-3 pr-8 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
            >
              {days.map((day, i) => {
                const date = new Date(day.date + 'T00:00:00')
                const dayOfWeek = days_arr[date.getDay()]
                return (
                  <option key={day.id} value={day.id}>
                    Day {i + 1} - {date.getMonth() + 1}/{date.getDate()} {dayOfWeek}
                    {day.id === place.day_id ? ` ${t('current')}` : ''}
                  </option>
                )
              })}
            </select>
          </div>
        )}

        <div className="mb-4 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500">
            {t('visitTime')}
          </label>
          <input
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>

        <div className="mb-6 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500">
            {t('memo')}
          </label>
          <textarea
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('submitting') : dayChanged ? t('submitMove') : t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
