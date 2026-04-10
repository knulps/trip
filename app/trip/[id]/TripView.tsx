'use client'

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import type { Trip, Day, Place } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import PlaceList from './PlaceList'
import Link from 'next/link'

type DayWithPlaces = Day & { places: Place[] }

interface Props {
  trip: Trip
  days: DayWithPlaces[]
  userId: string
}

export default function TripView({ trip, days: initialDays, userId: _userId }: Props) {
  const [days, setDays] = useState(initialDays)
  const [selectedDayId, setSelectedDayId] = useState(initialDays[0]?.id ?? null)
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)

  const dayRefs = useRef<globalThis.Map<string, HTMLDivElement>>(new globalThis.Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const selectedDay = days.find(d => d.id === selectedDayId) ?? days[0]
  const places = selectedDay?.places ?? []

  // Polyline 좌표 — useMemo로 불필요한 재계산 방지
  const polylinePath = useMemo(
    () => places.map(p => ({ lat: p.lat, lng: p.lng })),
    [places]
  )

  // 지도 초기 중심: 장소가 있으면 첫 번째 장소, 없으면 파리
  const mapDefaultCenter = useMemo(
    () =>
      places[0]
        ? { lat: places[0].lat, lng: places[0].lng }
        : { lat: 48.8566, lng: 2.3522 }, // 파리 (유럽 여행)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Supabase Realtime — places / days 변경 실시간 반영
  const supabase = createClient()

  useEffect(() => {
    const tripId = trip.id

    const channel = supabase
      .channel(`trip:${tripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'places',
        },
        () => {
          refreshDays()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'days',
        },
        () => {
          refreshDays()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])

  const refreshDays = useCallback(async () => {
    const { data } = await supabase
      .from('days')
      .select('*, places(*)')
      .eq('trip_id', trip.id)
      .order('date', { ascending: true })

    if (data) {
      setDays(
        data.map(day => ({
          ...day,
          places: (day.places ?? []).sort(
            (a: Place, b: Place) => (a.order_key < b.order_key ? -1 : 1)
          ),
        }))
      )
    }
  }, [supabase, trip.id])

  async function deleteDay(dayId: string) {
    const day = days.find(d => d.id === dayId)
    if (!day) return

    if (day.places.length > 0) {
      const confirmed = window.confirm(
        `이 날의 장소 ${day.places.length}개도 함께 삭제됩니다. 계속할까요?`
      )
      if (!confirmed) return
    }

    // 장소 먼저 삭제 (CASCADE 보장 안됨)
    await supabase.from('places').delete().eq('day_id', dayId)
    await supabase.from('days').delete().eq('id', dayId)

    // 인접 날짜로 포커스 이동
    const currentIndex = days.findIndex(d => d.id === dayId)
    const nextDays = days.filter(d => d.id !== dayId)
    if (nextDays.length > 0) {
      const newIndex = Math.max(0, currentIndex - 1)
      setSelectedDayId(nextDays[newIndex]?.id ?? nextDays[0].id)
    }

    refreshDays()
  }

  // Scroll to day section when tab is clicked
  function scrollToDay(dayId: string) {
    const el = dayRefs.current.get(dayId)
    if (el && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const containerTop = container.getBoundingClientRect().top
      const elTop = el.getBoundingClientRect().top
      container.scrollTo({
        top: container.scrollTop + (elTop - containerTop),
        behavior: 'smooth',
      })
    }
    setSelectedDayId(dayId)
  }

  // Update selectedDayId based on scroll position
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    function handleScroll() {
      const containerTop = container!.getBoundingClientRect().top
      let closestId: string | null = null
      let closestDist = Infinity

      dayRefs.current.forEach((el, dayId) => {
        const dist = Math.abs(el.getBoundingClientRect().top - containerTop)
        if (dist < closestDist) {
          closestDist = dist
          closestId = dayId
        }
      })

      if (closestId) setSelectedDayId(closestId)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [days])

  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <header className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <Link href="/" className="text-gray-400 dark:text-gray-500">
          ‹
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{trip.name}</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {trip.start_date} – {trip.end_date}
          </p>
        </div>
        {/* 초대 링크 복사 */}
        <InviteButton tripId={trip.id} inviteToken={trip.invite_token} />
      </header>

      {/* 날짜 탭 + 편집 토글 */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          onClick={() => setEditMode(v => !v)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            editMode
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          {editMode ? '완료' : '편집'}
        </button>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {days.map((day, i) => {
          const date = new Date(day.date + 'T00:00:00')
          const dayOfWeek = ['일','월','화','수','목','금','토'][date.getDay()]
          const dateLabel = `${date.getMonth() + 1}/${date.getDate()} ${dayOfWeek}`
          const isOnly = days.length === 1

          return (
            <div key={day.id} className="relative shrink-0">
              <button
                onClick={() => scrollToDay(day.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  day.id === selectedDayId
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                <span className="flex flex-col items-center leading-tight">
                  <span>Day {i + 1}</span>
                  <span className="text-[10px] opacity-60">{dateLabel}</span>
                </span>
              </button>
              {!isOnly && (
                <button
                  aria-label="날짜 삭제"
                  onClick={() => deleteDay(day.id)}
                  className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center"
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-400 text-[9px] text-white hover:bg-red-400 dark:bg-gray-600 dark:hover:bg-red-500">
                    ✕
                  </span>
                </button>
              )}
            </div>
          )
        })}
        <AddDayButton tripId={trip.id} onAdded={refreshDays} />
        </div>
      </div>

      {/* 지도 — 45dvh */}
      <div style={{ height: '45dvh' }} className="dark:bg-gray-900">
        <Map
          defaultCenter={mapDefaultCenter}
          defaultZoom={13}
          mapId="trip-map"
          disableDefaultUI
          gestureHandling="greedy"
        >
          <MapController
            selectedDayId={selectedDayId}
            places={places}
            focusedPlaceId={focusedPlaceId}
          />
          {places.map((place, i) => {
            const isFocused = place.id === focusedPlaceId
            return (
              <AdvancedMarker key={place.id} position={{ lat: place.lat, lng: place.lng }}>
                <div
                  className={`flex items-center justify-center rounded-full font-bold text-white shadow transition-all ${
                    isFocused
                      ? 'h-8 w-8 bg-blue-600 text-xs'
                      : 'h-6 w-6 bg-gray-900 text-[10px]'
                  }`}
                >
                  {i + 1}
                </div>
              </AdvancedMarker>
            )
          })}
          {polylinePath.length >= 2 && (
            <Polyline path={polylinePath} />
          )}
        </Map>
      </div>

      {/* 장소 리스트 — 55dvh, all days in continuous scroll */}
      <div ref={scrollContainerRef} style={{ height: '55dvh' }} className="overflow-y-auto">
        <PlaceList
          days={days}
          editMode={editMode}
          onRefresh={refreshDays}
          onFocusPlace={(place) => {
            setFocusedPlaceId(place.id)
          }}
          dayRefs={dayRefs}
        />
      </div>
    </div>
    </APIProvider>
  )
}

// 초대 링크 복사 버튼
function InviteButton({ tripId: _tripId, inviteToken }: { tripId: string; inviteToken: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    const url = `${window.location.origin}/invite/${inviteToken}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copyLink}
      className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {copied ? '복사됨 ✓' : '초대'}
    </button>
  )
}

// 날짜 추가 버튼
function AddDayButton({ tripId, onAdded }: { tripId: string; onAdded: () => void }) {
  const supabase = createClient()

  async function addDay() {
    const { data: existingDays } = await supabase
      .from('days')
      .select('date')
      .eq('trip_id', tripId)
      .order('date', { ascending: false })
      .limit(1)

    const lastDate = existingDays?.[0]?.date
    const nextDate = lastDate
      ? new Date(new Date(lastDate).getTime() + 86400000)
          .toISOString()
          .split('T')[0]
      : new Date().toISOString().split('T')[0]

    await supabase.from('days').insert({ trip_id: tripId, date: nextDate })
    onAdded()
  }

  return (
    <button
      onClick={addDay}
      className="shrink-0 rounded-full bg-gray-100 px-3.5 py-1.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
    >
      + 날짜
    </button>
  )
}

// MapController: 날짜 변경 시 첫 번째 장소로 이동, 장소 클릭 시 해당 장소로 이동
function MapController({
  selectedDayId,
  places,
  focusedPlaceId,
}: {
  selectedDayId: string | null
  places: Place[]
  focusedPlaceId: string | null
}) {
  const map = useMap()

  // 선택된 날이 바뀌면 첫 번째 장소로 pan
  useEffect(() => {
    if (!map || places.length === 0) return
    map.panTo({ lat: places[0].lat, lng: places[0].lng })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayId, map])

  // 장소 클릭 시 해당 장소로 pan
  useEffect(() => {
    if (!map || !focusedPlaceId) return
    const place = places.find(p => p.id === focusedPlaceId)
    if (place) map.panTo({ lat: place.lat, lng: place.lng })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPlaceId, map])

  return null
}

// Polyline 컴포넌트 (Google Maps API 직접 사용)
function Polyline({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap()

  useEffect(() => {
    if (!map || path.length < 2) return

    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#111827',
      strokeOpacity: 0.7,
      strokeWeight: 2,
    })

    polyline.setMap(map)
    return () => polyline.setMap(null)
  }, [map, path])

  return null
}
