'use client'

import { useEffect, useRef, useState } from 'react'
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateKeyBetween } from 'fractional-indexing'
import { useTranslations } from 'next-intl'

interface PlaceResult {
  name: string
  address: string
  lat: number
  lng: number
}

function AddPlaceViewInner() {
  const t = useTranslations('trip.addPlace')
  const tNav = useTranslations('nav')
  const searchParams = useSearchParams()
  const dayId = searchParams.get('dayId')
  const router = useRouter()
  const supabase = createClient()

  const [selected, setSelected] = useState<PlaceResult | null>(null)
  const [visitTime, setVisitTime] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const placesLib = useMapsLibrary('places')

  useEffect(() => {
    if (!placesLib || !inputRef.current) return

    // TODO: google.maps.places.Autocomplete 는 Google 이 deprecated 처리했다.
    //       후속 API 인 google.maps.places.PlaceAutocompleteElement (웹 컴포넌트) 로
    //       마이그레이션 필요. 이벤트/필드 형태가 달라 별도 작업으로 진행한다.
    const autocomplete = new placesLib.Autocomplete(inputRef.current, {
      fields: ['name', 'formatted_address', 'geometry'],
    })

    const listener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place.geometry?.location) return

      setError(null)
      setSelected({
        name: place.name ?? '',
        address: place.formatted_address ?? '',
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      })
    })

    return () => {
      // effect 가 다시 돌 때 리스너가 중첩되고 드롭다운이 쌓이는 것을 막는다
      listener.remove()
      google.maps.event.clearInstanceListeners(autocomplete)
      // Autocomplete 는 드롭다운(.pac-container)을 document.body 에 직접 붙이고 정리하지 않는다
      document.querySelectorAll('.pac-container').forEach(node => node.remove())
    }
  }, [placesLib])

  // 검색 결과 선택 해제 (잘못 고른 장소를 다시 검색할 수 있게)
  function clearSelection() {
    setSelected(null)
    setError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.focus()
    }
  }

  async function savePlace() {
    if (!selected || !dayId) return
    setSaving(true)
    setError(null)

    // 현재 마지막 order_key 조회
    const { data: lastPlaces, error: lastError } = await supabase
      .from('places')
      .select('order_key')
      .eq('day_id', dayId)
      .order('order_key', { ascending: false })
      .limit(1)

    if (lastError) {
      setSaving(false)
      setError(t('errorSave'))
      return
    }

    const lastKey = lastPlaces?.[0]?.order_key ?? null
    const newKey = generateKeyBetween(lastKey, null)

    const { error: insertError } = await supabase.from('places').insert({
      day_id: dayId,
      order_key: newKey,
      name: selected.name,
      lat: selected.lat,
      lng: selected.lng,
      address: selected.address,
      visit_time: visitTime || null,
      memo: memo || null,
    })

    if (insertError) {
      setSaving(false)
      setError(t('errorSave'))
      return
    }

    router.refresh()
    router.back()
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
        {/* dayId 없이 들어온 경우 저장이 불가능하므로 이유를 알려준다 */}
        {!dayId && (
          <div className="rounded-xl bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-700">{t('noDaySelected')}</p>
            <button
              onClick={() => router.back()}
              className="mt-2 text-xs font-medium text-amber-800 underline"
            >
              {t('goBack')}
            </button>
          </div>
        )}

        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors"
          />
        </div>

        {selected && (
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{selected.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{selected.address}</p>
              </div>
              <button
                onClick={clearSelection}
                aria-label={t('clearSelection')}
                className="shrink-0 text-gray-400 text-sm leading-none px-1 py-0.5"
              >
                ✕
              </button>
            </div>
            {/*
              위경도는 로케일 표기로 바꾸지 않고 소수점을 마침표로 고정한다.
              지도·검색창에 그대로 붙여 넣는 값이라 마침표가 사실상 표준이고,
              소수점에 쉼표를 쓰는 로케일(de, fr 등)에서는 "48,8584, 2,2945" 처럼
              위도와 경도를 가르는 쉼표와 구분되지 않는다.
            */}
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <span>{selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">{t('visitTime')}</label>
          <input
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">{t('memo')}</label>
          <textarea
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={t('memoPlaceholder')}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white transition-colors"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-600">
            {error}
          </p>
        )}

        <button
          onClick={savePlace}
          disabled={!selected || !dayId || saving}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-medium text-white disabled:opacity-40 transition-opacity"
        >
          {saving ? t('submitting') : t('submit')}
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
