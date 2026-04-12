'use client'

import { useEffect, useRef, useState } from 'react'
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateKeyBetween } from 'fractional-indexing'

interface PlaceResult {
  name: string
  address: string
  lat: number
  lng: number
}

function AddPlaceViewInner() {
  const searchParams = useSearchParams()
  const dayId = searchParams.get('dayId')
  const router = useRouter()
  const supabase = createClient()

  const [selected, setSelected] = useState<PlaceResult | null>(null)
  const [visitTime, setVisitTime] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const placesLib = useMapsLibrary('places')

  useEffect(() => {
    if (!placesLib || !inputRef.current) return

    const autocomplete = new placesLib.Autocomplete(inputRef.current, {
      fields: ['name', 'formatted_address', 'geometry'],
    })

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place.geometry?.location) return

      setSelected({
        name: place.name ?? '',
        address: place.formatted_address ?? '',
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      })
    })
  }, [placesLib])

  async function savePlace() {
    if (!selected || !dayId) return
    setSaving(true)

    // 현재 마지막 order_key 조회
    const { data: lastPlaces } = await supabase
      .from('places')
      .select('order_key')
      .eq('day_id', dayId)
      .order('order_key', { ascending: false })
      .limit(1)

    const lastKey = lastPlaces?.[0]?.order_key ?? null
    const newKey = generateKeyBetween(lastKey, null)

    const { error } = await supabase.from('places').insert({
      day_id: dayId,
      order_key: newKey,
      name: selected.name,
      lat: selected.lat,
      lng: selected.lng,
      address: selected.address,
      visit_time: visitTime || null,
      memo: memo || null,
    })

    setSaving(false)
    if (!error) {
      router.refresh()
      router.back()
    }
  }

  return (
    <main className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 pt-10 pb-4">
        <button onClick={() => router.back()} className="text-gray-400 dark:text-gray-500 text-lg">
          ‹
        </button>
        <h1 className="text-base font-semibold">장소 추가</h1>
      </header>

      <div className="flex flex-col gap-4 px-4">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            placeholder="장소 검색 (예: 에펠탑, 루브르 박물관)"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-gray-500 dark:focus:bg-gray-800"
          />
        </div>

        {selected && (
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:shadow-gray-900">
            <p className="font-medium text-sm">{selected.name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{selected.address}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <span>{selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">방문 시간 (선택)</label>
          <input
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-gray-500 dark:focus:bg-gray-800"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">메모 (선택)</label>
          <textarea
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모를 입력하세요"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-gray-500 dark:focus:bg-gray-800"
          />
        </div>

        <button
          onClick={savePlace}
          disabled={!selected || saving}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white disabled:opacity-40 transition-opacity"
        >
          {saving ? '저장 중...' : '일정에 추가'}
        </button>
      </div>
    </main>
  )
}

export default function AddPlaceView() {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
      <AddPlaceViewInner />
    </APIProvider>
  )
}
