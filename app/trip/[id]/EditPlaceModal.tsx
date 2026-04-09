'use client'

import { useState } from 'react'
import type { Place } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'

interface Props {
  place: Place
  onClose: () => void
  onSave: () => void
}

export default function EditPlaceModal({ place, onClose, onSave }: Props) {
  const [name, setName] = useState(place.name)
  const [visitTime, setVisitTime] = useState(place.visit_time?.slice(0, 5) ?? '')
  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  async function handleSave() {
    setSaving(true)
    await supabase
      .from('places')
      .update({ name, visit_time: visitTime || null })
      .eq('id', place.id)
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
        className="fixed bottom-0 left-0 right-0 rounded-t-2xl bg-white p-6 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-gray-900 dark:text-gray-100">
          장소 수정
        </h2>

        <div className="mb-4 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            장소 이름
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500"
          />
        </div>

        <div className="mb-6 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            방문 시간
          </label>
          <input
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
