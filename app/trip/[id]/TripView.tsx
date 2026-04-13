'use client'

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import type { Trip, Day, Place } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import PlaceList from './PlaceList'
import EditPlaceModal from './EditPlaceModal'
import Link from 'next/link'

interface RouteSegment {
  type: 'WALK' | 'TRANSIT'
  encodedPolyline: string
  vehicle?: string
  lineName?: string
  lineShort?: string
  color?: string
  departureStop?: string
  arrivalStop?: string
  stopCount?: number
  startLat?: number
  startLng?: number
}

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
  const [mapFocusMode, setMapFocusMode] = useState(false)
  const [editingPlace, setEditingPlace] = useState<Place | null>(null)
  const [activeRoute, setActiveRoute] = useState<{
    encodedPolyline?: string
    mode: string
    routeSegments?: RouteSegment[]
    origin?: { lat: number; lng: number }
    destination?: { lat: number; lng: number }
    originPlaceId?: string
    destinationPlaceId?: string
  } | null>(null)
  const [clickedPoi, setClickedPoi] = useState<{
    placeId: string
    name: string
    address: string
  } | null>(null)
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)

  const dayRefs = useRef<globalThis.Map<string, HTMLDivElement>>(new globalThis.Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const selectedDay = days.find(d => d.id === selectedDayId) ?? days[0]
  const places = selectedDay?.places ?? []

  // 포커스 모드에서 표시할 장소 (모든 Day에서 검색)
  const allPlaces = days.flatMap(d => d.places)
  const focusedPlace = focusedPlaceId
    ? allPlaces.find(p => p.id === focusedPlaceId) ?? null
    : null

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

  async function handleSelectRoute(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    mode: string,
    fromPlaceId?: string,
    toPlaceId?: string
  ) {
    try {
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          mode,
        }),
      })
      if (!res.ok) {
        setActiveRoute(null)
        return
      }
      const data = await res.json() as {
        encodedPolyline?: string
        routeSegments?: RouteSegment[]
      }
      if (mode === 'TRANSIT' && data.routeSegments && data.routeSegments.length > 0) {
        setActiveRoute({
          mode,
          routeSegments: data.routeSegments,
          origin,
          destination,
          originPlaceId: fromPlaceId,
          destinationPlaceId: toPlaceId,
        })
      } else if (data.encodedPolyline) {
        setActiveRoute({
          encodedPolyline: data.encodedPolyline,
          mode,
          origin,
          destination,
          originPlaceId: fromPlaceId,
          destinationPlaceId: toPlaceId,
        })
      } else {
        setActiveRoute(null)
      }
    } catch {
      setActiveRoute(null)
    }
  }

  function requestCurrentLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => alert('위치 정보를 가져올 수 없습니다.'),
      { enableHighAccuracy: true }
    )
  }

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
      <header className="flex items-center gap-3 px-4 pb-2" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link href="/" className="text-gray-400">
          ‹
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{trip.name}</h1>
          <p className="text-xs text-gray-400">
            {trip.start_date} – {trip.end_date}
          </p>
        </div>
        {/* 더보기 메뉴 */}
        <HeaderMenu tripId={trip.id} inviteToken={trip.invite_token} />
      </header>

      {/* 날짜 탭 + 편집 토글 */}
      <div className="flex items-center gap-2 px-4 pb-2">
        <button
          onClick={() => setEditMode(v => !v)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            editMode
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {editMode ? '완료' : '편집'}
        </button>
        <div className={`flex gap-2 overflow-x-auto scrollbar-hide ${editMode ? 'pt-2' : ''}`}>
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
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  <span className="flex flex-col items-center leading-tight">
                    <span>Day {i + 1}</span>
                    <span className="text-[10px] opacity-60">{dateLabel}</span>
                  </span>
                </button>
                {editMode && !isOnly && (
                  <button
                    aria-label="날짜 삭제"
                    onClick={() => deleteDay(day.id)}
                    className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-[9px] text-white active:bg-red-700"
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}
          <AddDayButton tripId={trip.id} onAdded={refreshDays} />
        </div>
      </div>

      {/* 지도 — 단일 인스턴스, 높이만 변경 */}
      <div
        style={{
          height: mapFocusMode ? '55dvh' : '35dvh',
          transition: 'height 0.3s ease',
        }}
        className=""
      >
        <Map
          defaultCenter={mapDefaultCenter}
          defaultZoom={13}
          mapId="trip-map"
          disableDefaultUI
          gestureHandling="greedy"
          clickableIcons={true}
          onClick={(e) => {
            // POI 클릭은 MapPOIHandler가 처리
            if (e.detail.placeId) return
            // 빈 지도 클릭 시 POI 카드 닫기
            setClickedPoi(null)
            if (allPlaces.length > 0) {
              setMapFocusMode(true)
              if (!focusedPlaceId) setFocusedPlaceId(allPlaces[0].id)
            }
          }}
        >
          <MapController
            selectedDayId={selectedDayId}
            places={places}
            allPlaces={allPlaces}
            focusedPlaceId={focusedPlaceId}
          />
          <MapPOIHandler onPoiClick={setClickedPoi} />
          {places.map((place, i) => {
            const isFocused = place.id === focusedPlaceId
            return (
              <AdvancedMarker
                key={place.id}
                position={{ lat: place.lat, lng: place.lng }}
              >
                <div
                  onClick={() => {
                    setClickedPoi(null)
                    setFocusedPlaceId(place.id)
                    setMapFocusMode(true)
                  }}
                  className={`flex items-center justify-center rounded-full font-bold text-white shadow transition-all cursor-pointer ${
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
          {!activeRoute && polylinePath.length >= 2 && (
            <Polyline path={polylinePath} />
          )}
          {activeRoute?.routeSegments && (
            <TransitRouteSegments segments={activeRoute.routeSegments} />
          )}
          {activeRoute?.encodedPolyline && (
            <RoutePolyline encodedPolyline={activeRoute.encodedPolyline} mode={activeRoute.mode} />
          )}
          {activeRoute?.origin && (
            <AdvancedMarker position={activeRoute.origin}>
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-[10px] font-bold shadow-md">출</div>
            </AdvancedMarker>
          )}
          {activeRoute?.destination && (
            <AdvancedMarker position={activeRoute.destination}>
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-[10px] font-bold shadow-md">도</div>
            </AdvancedMarker>
          )}
        </Map>
      </div>

      {/* POI 정보 카드 */}
      {clickedPoi && (
        <div className="border-t border-gray-100 bg-white px-4 py-3 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{clickedPoi.name}</p>
            {clickedPoi.address && (
              <p className="text-xs text-gray-500 truncate mt-0.5">{clickedPoi.address}</p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <a
              href={`https://www.google.com/maps/place/?q=place_id:${clickedPoi.placeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100 active:bg-blue-200"
            >
              구글맵 ↗
            </a>
            <button
              onClick={() => setClickedPoi(null)}
              className="text-gray-400 hover:text-gray-600 text-sm px-1"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 대중교통 경로 상세 */}
      {activeRoute?.routeSegments && activeRoute.routeSegments.length > 0 && (
        <TransitStepsBar
          segments={activeRoute.routeSegments}
          origin={activeRoute.origin}
          destination={activeRoute.destination}
          onDismiss={() => setActiveRoute(null)}
        />
      )}

      {/* 포커스 모드: 하단 장소 카드 / 일반 모드: 장소 리스트 */}
      {mapFocusMode ? (
        <div className="flex-1 overflow-y-auto border-t border-gray-100">
          {/* 헤더 */}
          <div className="px-4 py-2 flex items-center justify-between">
            <button
              onClick={() => { setMapFocusMode(false); setActiveRoute(null) }}
              className="text-gray-400 text-sm"
            >
              ← 목록
            </button>
          </div>
          {focusedPlace && (
            <div className="px-4">
              {/* 장소 헤더 + 아이콘 */}
              <div className="flex items-center gap-3 py-2">
                <p className="flex-1 text-sm font-semibold">{focusedPlace.name}</p>
                <button
                  onClick={() => setEditingPlace(focusedPlace)}
                  className="shrink-0 text-gray-300 transition-colors hover:text-gray-500 active:text-gray-700"
                  aria-label="수정"
                >
                  ✏️
                </button>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(focusedPlace.name + ' ' + focusedPlace.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-gray-300 transition-colors hover:text-blue-400 active:text-blue-600"
                  aria-label="지도에서 보기"
                >
                  📍
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(focusedPlace.name + ' ' + focusedPlace.address)}&travelmode=transit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-gray-300 transition-colors hover:text-green-400 active:text-green-600"
                  aria-label="길찾기"
                >
                  ↗
                </a>
              </div>

              {/* 상세 정보 */}
              <div className="flex flex-col gap-1.5 pb-2 text-xs text-gray-500">
                <p>📫 {focusedPlace.address}</p>
                {focusedPlace.visit_time && (
                  <p>🕐 {focusedPlace.visit_time.slice(0, 5)}</p>
                )}
                {focusedPlace.memo && (
                  <p className="whitespace-pre-wrap">📝 {focusedPlace.memo}</p>
                )}
              </div>

              {/* 현위치 거리 */}
              <button
                onClick={requestCurrentLocation}
                className="text-xs text-blue-600 py-1"
              >
                📍 현위치에서 거리 확인
              </button>
              {currentLocation && (
                <CurrentLocationDistance
                  from={currentLocation}
                  to={focusedPlace}
                  onSelectRoute={(mode) => handleSelectRoute(
                    currentLocation,
                    { lat: focusedPlace.lat, lng: focusedPlace.lng },
                    mode
                  )}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          <PlaceList
            days={days}
            editMode={editMode}
            onRefresh={refreshDays}
            onFocusPlace={(place) => {
              setFocusedPlaceId(place.id)
            }}
            onSelectRoute={handleSelectRoute}
            dayRefs={dayRefs}
            activeRoutePlaceIds={activeRoute?.originPlaceId && activeRoute?.destinationPlaceId ? { from: activeRoute.originPlaceId, to: activeRoute.destinationPlaceId } : null}
          />
        </div>
      )}
      {editingPlace && (
        <EditPlaceModal
          place={editingPlace}
          days={days}
          onClose={() => setEditingPlace(null)}
          onSave={refreshDays}
        />
      )}
    </div>
    </APIProvider>
  )
}

// 헤더 더보기 메뉴 (가져오기 + 초대)
function HeaderMenu({ tripId, inviteToken }: { tripId: string; inviteToken: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function copyInviteLink() {
    const url = `${window.location.origin}/invite/${inviteToken}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => { setCopied(false); setOpen(false) }, 1500)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 active:bg-gray-200 text-lg leading-none"
        aria-label="더보기"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 min-w-[120px] rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
          <Link
            href={`/trip/${tripId}/import`}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
            onClick={() => setOpen(false)}
          >
            가져오기
          </Link>
          <button
            onClick={copyInviteLink}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
          >
            {copied ? '복사됨 ✓' : '초대 링크 복사'}
          </button>
        </div>
      )}
    </div>
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
  allPlaces,
  focusedPlaceId,
}: {
  selectedDayId: string | null
  places: Place[]
  allPlaces: Place[]
  focusedPlaceId: string | null
}) {
  const map = useMap()

  // 선택된 날이 바뀌면 첫 번째 장소로 pan
  useEffect(() => {
    if (!map || places.length === 0) return
    map.panTo({ lat: places[0].lat, lng: places[0].lng })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayId, map])

  // 장소 클릭 시 해당 장소로 pan (모든 Day에서 검색)
  useEffect(() => {
    if (!map || !focusedPlaceId) return
    const place = allPlaces.find(p => p.id === focusedPlaceId)
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

// Route Polyline (decoded from encoded polyline)
function RoutePolyline({ encodedPolyline, mode }: { encodedPolyline: string; mode: string }) {
  const map = useMap()
  const geometryLib = useMapsLibrary('geometry')

  useEffect(() => {
    if (!map || !geometryLib || !encodedPolyline) return

    const path = geometryLib.encoding.decodePath(encodedPolyline)
    const color = mode === 'TRANSIT' ? '#2563eb' : mode === 'DRIVE' ? '#f59e0b' : '#10b981'

    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: color,
      strokeOpacity: 0.8,
      strokeWeight: 4,
    })

    polyline.setMap(map)

    const bounds = new google.maps.LatLngBounds()
    path.forEach(p => bounds.extend(p))
    map.fitBounds(bounds, 50)

    return () => polyline.setMap(null)
  }, [map, geometryLib, encodedPolyline, mode])

  return null
}

// 지도 POI 클릭 핸들러
function MapPOIHandler({
  onPoiClick,
}: {
  onPoiClick: (poi: { placeId: string; name: string; address: string }) => void
}) {
  const map = useMap()
  const placesLib = useMapsLibrary('places')
  const onPoiClickRef = useRef(onPoiClick)
  onPoiClickRef.current = onPoiClick

  useEffect(() => {
    if (!map || !placesLib) return
    const service = new placesLib.PlacesService(map)

    const listener = map.addListener('click', (e: google.maps.IconMouseEvent) => {
      if (!e.placeId) return
      e.stop()
      service.getDetails(
        { placeId: e.placeId, fields: ['name', 'formatted_address'] },
        (result, status) => {
          if (status === placesLib.PlacesServiceStatus.OK && result) {
            onPoiClickRef.current({
              placeId: e.placeId!,
              name: result.name ?? '',
              address: result.formatted_address ?? '',
            })
          }
        }
      )
    })

    return () => {
      google.maps.event.removeListener(listener)
    }
  }, [map, placesLib])

  return null
}

// 대중교통 구간별 폴리라인 + 탑승 마커
function TransitRouteSegments({ segments }: { segments: RouteSegment[] }) {
  const map = useMap()
  const geometryLib = useMapsLibrary('geometry')

  useEffect(() => {
    if (!map || !geometryLib || segments.length === 0) return

    const polylines: google.maps.Polyline[] = []
    const bounds = new google.maps.LatLngBounds()

    for (const seg of segments) {
      const path = geometryLib.encoding.decodePath(seg.encodedPolyline)
      path.forEach(p => bounds.extend(p))

      if (seg.type === 'TRANSIT') {
        // 외곽선 polyline (뒤)
        const outline = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: '#000000',
          strokeOpacity: 0.18,
          strokeWeight: 7,
          zIndex: 1,
        })
        outline.setMap(map)
        polylines.push(outline)

        // 컬러 polyline (앞)
        const colorLine = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: seg.color || '#2563eb',
          strokeOpacity: 0.9,
          strokeWeight: 4,
          zIndex: 2,
        })
        colorLine.setMap(map)
        polylines.push(colorLine)
      } else {
        // WALK: 원형 점선
        const walkLine = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeOpacity: 0,
          strokeWeight: 3,
          icons: [{
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: '#1d4ed8',
              fillOpacity: 1,
              strokeColor: 'white',
              strokeWeight: 2,
              scale: 4,
            },
            offset: '0',
            repeat: '14px',
          }],
        })
        walkLine.setMap(map)
        polylines.push(walkLine)
      }
    }

    map.fitBounds(bounds, 50)

    return () => {
      polylines.forEach(p => p.setMap(null))
    }
  }, [map, geometryLib, segments])

  return (
    <>
      {segments.filter(s => s.type === 'TRANSIT' && s.startLat && s.startLng).map((seg, i) => (
        <AdvancedMarker key={i} position={{ lat: seg.startLat!, lng: seg.startLng! }}>
          <div className="flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 shadow text-[9px] font-medium border border-gray-200"
               style={{ borderColor: seg.color || '#2563eb' }}>
            <span style={{ color: seg.color || '#2563eb' }}>
              {seg.vehicle === 'SUBWAY' ? '\u{1F687}' : seg.vehicle === 'BUS' ? '\u{1F68C}' : seg.vehicle === 'RAIL' ? '\u{1F686}' : '\u{1F68C}'}
            </span>
            <span className="text-gray-700">{seg.departureStop}</span>
          </div>
        </AdvancedMarker>
      ))}
    </>
  )
}

// 대중교통 경로 상세 바
function TransitStepsBar({
  segments,
  origin,
  destination,
  onDismiss,
}: {
  segments: RouteSegment[]
  origin?: { lat: number; lng: number }
  destination?: { lat: number; lng: number }
  onDismiss: () => void
}) {
  const vehicleEmoji: Record<string, string> = {
    SUBWAY: '\u{1F687}',
    BUS: '\u{1F68C}',
    RAIL: '\u{1F686}',
    TRAM: '\u{1F68A}',
    COMMUTER_TRAIN: '\u{1F686}',
    HIGH_SPEED_TRAIN: '\u{1F685}',
    HEAVY_RAIL: '\u{1F686}',
    LONG_DISTANCE_TRAIN: '\u{1F686}',
  }

  // 연속된 동일 타입 세그먼트 합치기 (도보→도보 중복 방지)
  const mergedSegments = segments.reduce<RouteSegment[]>((acc, seg) => {
    if (acc.length > 0 && acc[acc.length - 1].type === seg.type && seg.type === 'WALK') return acc
    acc.push(seg)
    return acc
  }, [])

  const transitSegments = segments.filter(s => s.type === 'TRANSIT')
  const firstDeparture = transitSegments[0]?.departureStop
  const lastArrival = transitSegments[transitSegments.length - 1]?.arrivalStop

  return (
    <div className="border-t border-b border-gray-100 bg-white px-3 py-2">
      {/* 출발 → 도착 헤더 */}
      {(firstDeparture || lastArrival) && (
        <div className="flex items-center gap-1 mb-1.5">
          {firstDeparture && (
            <span className="text-xs font-semibold text-gray-800 truncate">{firstDeparture}</span>
          )}
          {firstDeparture && lastArrival && (
            <span className="text-gray-400 text-xs shrink-0">{'\u2192'}</span>
          )}
          {lastArrival && (
            <span className="text-xs font-semibold text-gray-800 truncate">{lastArrival}</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {mergedSegments.map((seg, i) => {
              if (seg.type === 'WALK') {
                return (
                  <span key={i} className="contents">
                    {i > 0 && <span className="text-gray-300 mx-0.5">{'\u2192'}</span>}
                    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 bg-gray-100 text-gray-500 text-[11px] font-medium">
                      {'\u{1F6B6}'} {'\uB3C4\uBCF4'}
                    </span>
                  </span>
                )
              }
              const emoji = vehicleEmoji[seg.vehicle ?? ''] ?? '\u{1F68C}'
              const label = seg.lineShort || seg.lineName
              return (
                <span key={i} className="contents">
                  {i > 0 && <span className="text-gray-300 mx-0.5">{'\u2192'}</span>}
                  <span
                    className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-white text-[11px] font-medium"
                    style={{ backgroundColor: seg.color }}
                  >
                    {emoji} {label} {'\u00B7'} {seg.stopCount}{'\uC815\uAC70\uC7A5'}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {origin && destination && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=transit`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100 active:bg-blue-200"
            >
              구글맵 ↗
            </a>
          )}
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 text-sm px-1"
            aria-label="닫기"
          >
            {'\u2715'}
          </button>
        </div>
      </div>
    </div>
  )
}

// 현위치에서 장소까지 거리
function CurrentLocationDistance({
  from,
  to,
  onSelectRoute,
}: {
  from: { lat: number; lng: number }
  to: Place
  onSelectRoute?: (mode: string) => void
}) {
  const [results, setResults] = useState<Array<{ mode: string; minutes: number; distance: string; icon: string }> | null>(null)

  useEffect(() => {
    fetch('/api/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { results?: Array<{ mode: string; minutes: number; distance: string; icon: string }> } | null) => {
        if (data?.results) setResults(data.results)
      })
      .catch(() => {})
  }, [from.lat, from.lng, to.lat, to.lng])

  if (!results) return <p className="text-[10px] text-gray-400 mt-1">계산 중...</p>

  return (
    <div className="flex items-center gap-2 mt-1">
      {results.map((r) => (
        <button
          key={r.mode}
          onClick={() => onSelectRoute?.(r.mode)}
          className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 active:bg-blue-100"
        >
          {r.icon} {r.minutes}분 · {r.distance}
        </button>
      ))}
    </div>
  )
}
