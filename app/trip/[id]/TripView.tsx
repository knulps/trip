'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
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

export default function TripView({ trip, days: initialDays, userId }: Props) {
  const [days, setDays] = useState(initialDays)
  const [selectedDayId, setSelectedDayId] = useState(initialDays[0]?.id ?? null)
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null)

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

  // Supabase Realtime — places 변경 실시간 반영
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
          // 변경 발생 시 최신 데이터 재조회
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

  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <header className="flex items-center gap-3 px-4 pt-10 pb-3">
        <Link href="/" className="text-gray-400">
          ‹
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{trip.name}</h1>
          <p className="text-xs text-gray-400">
            {trip.start_date} – {trip.end_date}
          </p>
        </div>
        {/* 초대 링크 복사 */}
        <InviteButton tripId={trip.id} inviteToken={trip.invite_token} />
      </header>

      {/* 날짜 탭 */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
        {days.map((day, i) => (
          <button
            key={day.id}
            onClick={() => setSelectedDayId(day.id)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              day.id === selectedDayId
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            Day {i + 1}
          </button>
        ))}
        <AddDayButton tripId={trip.id} onAdded={refreshDays} />
      </div>

      {/* 지도 — 45dvh */}
      <div style={{ height: '45dvh' }}>
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

      {/* 장소 리스트 — 55dvh */}
      <div style={{ height: '55dvh' }} className="overflow-y-auto">
        <PlaceList
          dayId={selectedDayId}
          places={places}
          onRefresh={refreshDays}
          onPlaceClick={(place) => {
            setFocusedPlaceId(place.id)
          }}
        />
      </div>
    </div>
    </APIProvider>
  )
}

// 초대 링크 복사 버튼
function InviteButton({ tripId, inviteToken }: { tripId: string; inviteToken: string }) {
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
      className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50"
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
      className="shrink-0 rounded-full bg-gray-100 px-3.5 py-1.5 text-xs font-medium text-gray-500"
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
