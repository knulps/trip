'use client'

import { useMemo, useState, useEffect, useCallback, useRef, useTransition } from 'react'
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import type { Trip, Day, Place } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import PlaceList from './PlaceList'
import EditPlaceModal from './EditPlaceModal'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations, useLocale } from 'next-intl'
import {
  defaultLocale,
  isLocale,
  locales,
  setLocaleCookie,
  type Locale,
} from '@/i18n/config'
import {
  formatDayDate,
  formatDistance,
  formatFullDate,
  formatLocalDate,
  parseLocalDate,
} from '@/lib/format'

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

// 서버는 거리를 미터 숫자로 내려주고, 표기는 화면에서 로케일에 맞춰 만든다.
interface DistanceResult {
  mode: string
  minutes: number
  distanceMeters: number
  icon: string
}

// Realtime payload에서 필요한 컬럼만 읽기 위한 최소 타입
// (INSERT는 old가 {}, DELETE는 new가 {}이고 old에는 PK만 담겨 오는 경우가 많음)
type ChangedRow<T> = { new: Partial<T>; old: Partial<T> }

// Realtime refetch 합치기 / scroll-spy 억제 / 위치 조회 타이밍 (ms)
const REFRESH_DEBOUNCE_MS = 300
const SPY_SETTLE_MS = 180
const SPY_MAX_SUPPRESS_MS = 1500
const GEO_TIMEOUT_MS = 10000
const GEO_MAX_AGE_MS = 60000

interface Props {
  trip: Trip
  days: DayWithPlaces[]
  userId: string
}

export default function TripView({ trip, days: initialDays, userId }: Props) {
  const t = useTranslations('trip.view')
  const tCommon = useTranslations('common')
  const tNav = useTranslations('nav')
  const format = useFormatter()

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
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [deletingDayId, setDeletingDayId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const dayRefs = useRef<globalThis.Map<string, HTMLDivElement>>(new globalThis.Map())
  // 스크롤 컨테이너는 지도 포커스 모드에서 언마운트되고 목록으로 돌아올 때 새로 만들어진다.
  // ref 로만 들고 있으면 새 노드에 scroll 리스너를 다시 붙일 계기가 없어 scroll-spy 가 멈춘다.
  // state 로 두면 노드가 바뀔 때마다 아래 effect 가 다시 돌아 리스너를 옮겨 붙인다.
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null)

  // scroll-spy 제어 (rAF 스로틀 + 프로그램 스크롤 중 억제)
  const spyRafRef = useRef<number | null>(null)
  const suppressSpyRef = useRef(false)
  const spySettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spyMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedDay = useMemo(
    () => days.find(d => d.id === selectedDayId) ?? days[0],
    [days, selectedDayId]
  )
  const places = useMemo(() => selectedDay?.places ?? [], [selectedDay])

  // 포커스 모드에서 표시할 장소 (모든 Day에서 검색)
  const allPlaces = days.flatMap(d => d.places)
  const focusedPlace = focusedPlaceId
    ? allPlaces.find(p => p.id === focusedPlaceId) ?? null
    : null

  // 포커스한 장소가 목록에서 사라지면 포커스도 함께 푼다.
  // MapController 는 '보고 있는 장소가 있으면' 날짜 변경 pan 을 건너뛰는데,
  // 그 장소가 이미 지워졌으면 장소 pan 도 대상을 못 찾아 지도가 지워진 자리에 멈춘다.
  // 삭제 경로(내가 지운 날짜, 다른 사용자가 Realtime 으로 지운 장소)마다 챙기지 않고
  // '가리키는 장소가 실제로 없으면 푼다' 는 조건 하나로 모두 덮는다.
  useEffect(() => {
    if (focusedPlaceId !== null && focusedPlace === null) setFocusedPlaceId(null)
  }, [focusedPlaceId, focusedPlace])

  // 선택한 날짜도 같은 방식으로 실제 목록과 맞춘다.
  // 다른 사용자가 지운 날짜를 가리킨 채로 두면 화면은 selectedDay 의 대체값(days[0])을 보여 주는데
  // 탭 하이라이트는 어디에도 안 붙고, deleteDay 의 'dayId === selectedDayId' 판정도 빗나가
  // 눈에 보이는 그 날짜를 지워도 인접 날짜로 옮겨 가지 않는다.
  // scroll-spy 는 days 에 있는 id 만 쓰므로 이 effect 와 서로 밀어내지 않는다.
  useEffect(() => {
    if (selectedDayId !== null && !days.some(d => d.id === selectedDayId)) {
      setSelectedDayId(selectedDay?.id ?? null)
    }
  }, [days, selectedDayId, selectedDay])

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

  // 구글 지도 API 키가 없으면 지도 대신 안내 박스를 보여줌 (SDK가 조용히 죽는 것 방지)
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  // 헤더 기간 표기 — 날짜 파싱/포맷 규칙은 lib/format 에 모아 두었다
  const dateRangeLabel = useMemo(
    () => `${formatFullDate(format, trip.start_date)} – ${formatFullDate(format, trip.end_date)}`,
    [format, trip.start_date, trip.end_date]
  )

  // Supabase Realtime — places / days 변경 실시간 반영
  const supabase = createClient()

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

  // 이벤트가 몰릴 때(드래그 정렬, 일괄 삭제) refetch를 한 번으로 합침
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      void refreshDays()
    }, REFRESH_DEBOUNCE_MS)
  }, [refreshDays])

  // 현재 로드된 day / place id — places 테이블 이벤트를 클라이언트에서 걸러내는 데 사용
  const knownDayIdsRef = useRef<Set<string>>(new Set(initialDays.map(d => d.id)))
  const knownPlaceIdsRef = useRef<Set<string>>(
    new Set(initialDays.flatMap(d => d.places.map(p => p.id)))
  )
  // 이 여행 소속이 아님이 확인된 day id (같은 이벤트로 반복 조회하지 않기 위한 캐시)
  const foreignDayIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    knownDayIdsRef.current = new Set(days.map(d => d.id))
    knownPlaceIdsRef.current = new Set(days.flatMap(d => d.places.map(p => p.id)))
  }, [days])

  useEffect(() => {
    const tripId = trip.id

    // places에는 trip_id 컬럼이 없어 서버 필터를 걸 수 없음 → payload로 직접 걸러냄
    function handlePlaceChange(payload: ChangedRow<Place>) {
      const dayId = payload.new.day_id ?? payload.old.day_id ?? null
      const placeId = payload.new.id ?? payload.old.id ?? null

      // 지금 화면에 있는 장소가 바뀐 경우 (DELETE는 old에 PK만 오는 경우가 많음)
      if (placeId && knownPlaceIdsRef.current.has(placeId)) {
        scheduleRefresh()
        return
      }
      if (!dayId) return
      if (knownDayIdsRef.current.has(dayId)) {
        scheduleRefresh()
        return
      }
      if (foreignDayIdsRef.current.has(dayId)) return

      // 아직 모르는 Day — 다른 사용자가 방금 만든 이 여행의 날짜일 수 있으므로 소속을 확인
      void (async () => {
        const { data, error } = await supabase
          .from('days')
          .select('trip_id')
          .eq('id', dayId)
          .maybeSingle()
        if (error) {
          scheduleRefresh() // 확인에 실패하면 놓치지 않도록 새로고침
          return
        }
        if (data?.trip_id === tripId) scheduleRefresh()
        else foreignDayIdsRef.current.add(dayId)
      })()
    }

    const channel = supabase
      .channel(`trip:${tripId}`)
      .on<Place>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'places',
        },
        handlePlaceChange
      )
      // days는 trip_id로 서버 필터가 가능.
      // 단 DELETE는 old에 PK만 담겨 와서 trip_id 필터가 매칭되지 않으므로 따로 구독해 id로 판단
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'days',
          filter: `trip_id=eq.${tripId}`,
        },
        () => scheduleRefresh()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'days',
          filter: `trip_id=eq.${tripId}`,
        },
        () => scheduleRefresh()
      )
      .on<Day>(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'days',
        },
        (payload) => {
          const removedId = payload.old.id
          if (removedId && knownDayIdsRef.current.has(removedId)) scheduleRefresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])

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
    if (locating) return
    setLocationError(null)

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError(t('locationUnsupported'))
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        setLocating(false)
        setLocationError(
          err.code === err.PERMISSION_DENIED ? t('locationDenied') : t('locationError')
        )
      },
      {
        enableHighAccuracy: true,
        timeout: GEO_TIMEOUT_MS,
        maximumAge: GEO_MAX_AGE_MS,
      }
    )
  }

  async function deleteDay(dayId: string) {
    if (deletingDayId) return // 연타 방지
    const day = days.find(d => d.id === dayId)
    if (!day) return

    if (day.places.length > 0) {
      const confirmed = window.confirm(t('deleteDay', { count: day.places.length }))
      if (!confirmed) return
    }

    setDeletingDayId(dayId)
    setActionError(null)
    try {
      // places.day_id 는 days(id) on delete cascade 라 날짜만 지우면 장소도 함께 지워진다.
      // (cascade 는 테이블 소유자 권한으로 돌아 호출자의 RLS 를 타지 않는다)
      // 장소를 먼저 지우면 날짜 삭제가 실패했을 때 장소만 영영 사라진 상태로 남는다.
      // delete 는 RLS 에 막혀 한 행도 지우지 못해도 error 가 null 이라 지워진 행 수까지 봐야 한다.
      // 다른 탭에서 이 여행을 나간 뒤라면 days_all 정책에 막혀 0행이 되는데, 그대로 진행하면
      // 이어지는 refreshDays 의 select 도 전부 걸러져 날짜와 장소가 사라진 화면만 남는다.
      // 사용자는 에러 한 줄 없이 자기가 여행을 통째로 지웠다고 믿게 된다.
      const { data: deletedDays, error: dayError } = await supabase
        .from('days')
        .delete()
        .eq('id', dayId)
        .select('id')
      if (dayError || !deletedDays || deletedDays.length === 0) {
        setActionError(t('deleteDayFailed'))
        return
      }

      // 지운 날짜에 있던 장소를 보고 있었다면 포커스도 같은 커밋에서 함께 푼다.
      // 아래 invariant effect 에 맡기면 refreshDays 가 끝난 뒤라 한 커밋 늦는다.
      // 그 사이 MapController 의 날짜 pan effect(deps: selectedDayId)가 '보는 장소가 있다'며
      // 그냥 지나가 버리고, 뒤늦게 포커스가 풀려도 그 effect 의 deps 는 그대로라 다시 돌지 않는다.
      // 결국 지도가 지워진 장소에 멈춘 채 남는다.
      if (focusedPlaceId !== null && day.places.some(p => p.id === focusedPlaceId)) {
        setFocusedPlaceId(null)
      }

      // 삭제에 성공했고, 지운 날짜가 지금 보고 있던 날짜일 때만 인접 날짜로 포커스 이동.
      // 다른 날짜를 지웠는데도 선택을 옮기면 보고 있던 날짜에서 튕겨 나가 지도까지 따라 움직인다.
      // (선택한 날짜가 사라지는 경우는 selectedDay 의 days[0] 대체로도 덮이지만,
      //  그러면 항상 첫 날로 가므로 여기서 인접 날짜로 옮겨 준다)
      if (dayId === selectedDayId) {
        const currentIndex = days.findIndex(d => d.id === dayId)
        const nextDays = days.filter(d => d.id !== dayId)
        if (nextDays.length > 0) {
          const newIndex = Math.max(0, currentIndex - 1)
          setSelectedDayId(nextDays[newIndex]?.id ?? nextDays[0].id)
        }
      }

      void refreshDays()
    } finally {
      setDeletingDayId(null)
    }
  }

  // 프로그램 스크롤이 멈추면 scroll-spy를 다시 켬
  const releaseSpySoon = useCallback(() => {
    if (spySettleTimerRef.current) clearTimeout(spySettleTimerRef.current)
    spySettleTimerRef.current = setTimeout(() => {
      spySettleTimerRef.current = null
      suppressSpyRef.current = false
    }, SPY_SETTLE_MS)
  }, [])

  // 언마운트 시 scroll-spy 타이머 정리
  useEffect(() => {
    return () => {
      if (spySettleTimerRef.current) clearTimeout(spySettleTimerRef.current)
      if (spyMaxTimerRef.current) clearTimeout(spyMaxTimerRef.current)
    }
  }, [])

  // Scroll to day section when tab is clicked
  function scrollToDay(dayId: string) {
    const el = dayRefs.current.get(dayId)
    if (el && el.isConnected && scrollContainer) {
      const container = scrollContainer
      const containerTop = container.getBoundingClientRect().top
      const elTop = el.getBoundingClientRect().top

      // smooth 스크롤 중간 프레임마다 spy가 동작해 탭 하이라이트가 깜빡이는 것을 막음
      suppressSpyRef.current = true
      releaseSpySoon()
      if (spyMaxTimerRef.current) clearTimeout(spyMaxTimerRef.current)
      spyMaxTimerRef.current = setTimeout(() => {
        spyMaxTimerRef.current = null
        suppressSpyRef.current = false
      }, SPY_MAX_SUPPRESS_MS)

      container.scrollTo({
        top: container.scrollTop + (elTop - containerTop),
        behavior: 'smooth',
      })
    }
    setSelectedDayId(dayId)
  }

  // Update selectedDayId based on scroll position (rAF 스로틀, 값이 바뀔 때만 setState)
  useEffect(() => {
    const container = scrollContainer
    if (!container) return

    const liveDayIds = new Set(days.map(d => d.id))
    const refs = dayRefs.current

    function updateSelectedDay() {
      spyRafRef.current = null
      if (suppressSpyRef.current) return

      const containerTop = container!.getBoundingClientRect().top
      let closestId: string | null = null
      let closestDist = Infinity

      for (const [dayId, el] of refs) {
        // 삭제된 Day가 남긴 stale ref / 현재 days에 없는 id는 건너뜀
        if (!el.isConnected || !liveDayIds.has(dayId)) continue
        const dist = Math.abs(el.getBoundingClientRect().top - containerTop)
        if (dist < closestDist) {
          closestDist = dist
          closestId = dayId
        }
      }

      if (closestId !== null) {
        const nextId = closestId
        setSelectedDayId(prev => (prev === nextId ? prev : nextId))
      }
    }

    function handleScroll() {
      // 탭 클릭으로 시작된 스크롤이면 spy를 쉬게 두고, 멈추는 시점만 감지
      if (suppressSpyRef.current) {
        releaseSpySoon()
        return
      }
      if (spyRafRef.current !== null) return
      spyRafRef.current = requestAnimationFrame(updateSelectedDay)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (spyRafRef.current !== null) {
        cancelAnimationFrame(spyRafRef.current)
        spyRafRef.current = null
      }
    }
  }, [days, releaseSpySoon, scrollContainer])

  const content = (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <header className="flex items-center gap-3 px-4 pb-2" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link
          href="/"
          aria-label={tNav('back')}
          className="flex h-8 w-8 items-center justify-center text-xl text-gray-400"
        >
          ‹
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{trip.name}</h1>
          <p className="text-xs text-gray-400">
            {dateRangeLabel}
          </p>
        </div>
        {/* 더보기 메뉴 */}
        {/* 여행을 만든 사람은 나가지 못한다 (schema.sql 의 trip_members_delete 와 같은 조건) */}
        <HeaderMenu
          tripId={trip.id}
          inviteToken={trip.invite_token}
          userId={userId}
          canLeave={trip.created_by !== userId}
          onError={setActionError}
        />
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
          {editMode ? tCommon('done') : tCommon('edit')}
        </button>
        <div className={`flex gap-2 overflow-x-auto scrollbar-hide ${editMode ? 'pt-2' : ''}`}>
          {days.map((day, i) => {
            const dateLabel = formatDayDate(format, day.date)
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
                    <span>{tCommon('dayLabel', { n: i + 1 })}</span>
                    <span className="text-[10px] opacity-60">{dateLabel}</span>
                  </span>
                </button>
                {editMode && !isOnly && (
                  <button
                    aria-label={t('deleteDate')}
                    onClick={() => deleteDay(day.id)}
                    disabled={deletingDayId !== null}
                    className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-[9px] text-white active:bg-red-700 disabled:opacity-50"
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}
          <AddDayButton tripId={trip.id} onAdded={refreshDays} onError={setActionError} />
        </div>
      </div>

      {/* 날짜 추가/삭제, 여행 나가기 실패 안내 */}
      {actionError && (
        <div className="flex items-start gap-2 px-4 pb-2">
          <p role="alert" className="flex-1 text-xs text-red-600">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            aria-label={tCommon('close')}
            className="shrink-0 text-xs text-gray-400"
          >
            ✕
          </button>
        </div>
      )}

      {/* 지도 — 단일 인스턴스, 높이만 변경 */}
      <div
        style={{
          height: mapFocusMode ? '55dvh' : '35dvh',
          transition: 'height 0.3s ease',
        }}
        className=""
      >
        {mapsApiKey ? (
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
              const focusThisPlace = () => {
                setClickedPoi(null)
                setFocusedPlaceId(place.id)
                setMapFocusMode(true)
              }
              return (
                <AdvancedMarker
                  key={place.id}
                  position={{ lat: place.lat, lng: place.lng }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={t('markerLabel', { index: i + 1, name: place.name })}
                    aria-pressed={isFocused}
                    onClick={focusThisPlace}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        focusThisPlace()
                      }
                    }}
                    className={`flex items-center justify-center rounded-full font-bold text-white shadow transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
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
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white text-[10px] font-bold shadow-md">{t('departure')}</div>
              </AdvancedMarker>
            )}
            {activeRoute?.destination && (
              <AdvancedMarker position={activeRoute.destination}>
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-[10px] font-bold shadow-md">{t('arrival')}</div>
              </AdvancedMarker>
            )}
          </Map>
        ) : (
          /* NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 누락 — 지도만 안내 박스로 대체 */
          <div className="flex h-full items-center justify-center bg-gray-50 px-6 text-center">
            <p className="text-xs leading-relaxed text-gray-500">{t('mapUnavailable')}</p>
          </div>
        )}
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
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clickedPoi.name)}&query_place_id=${clickedPoi.placeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100 active:bg-blue-200"
            >
              {t('googleMaps')}
            </a>
            <button
              onClick={() => setClickedPoi(null)}
              className="text-gray-400 hover:text-gray-600 text-sm px-1"
              aria-label={tCommon('close')}
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
              {tNav('backToList')}
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
                  aria-label={tCommon('edit')}
                >
                  ✏️
                </button>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(focusedPlace.name + ' ' + focusedPlace.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-gray-300 transition-colors hover:text-blue-400 active:text-blue-600"
                  aria-label={t('viewOnMap')}
                >
                  📍
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(focusedPlace.name + ' ' + focusedPlace.address)}&travelmode=transit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-gray-300 transition-colors hover:text-green-400 active:text-green-600"
                  aria-label={t('directions')}
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
                disabled={locating}
                aria-busy={locating}
                className="text-xs text-blue-600 py-1 disabled:opacity-50"
              >
                {locating ? t('locating') : t('checkDistanceFromHere')}
              </button>
              {locationError && (
                <p role="alert" className="text-[10px] text-red-500">{locationError}</p>
              )}
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
        <div ref={setScrollContainer} className="flex-1 overflow-y-auto">
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
  )

  // API 키가 없으면 APIProvider 자체를 띄우지 않고 나머지 UI는 그대로 사용
  return mapsApiKey ? (
    <APIProvider apiKey={mapsApiKey}>{content}</APIProvider>
  ) : (
    content
  )
}

// 헤더 더보기 메뉴 (가져오기 + 초대 + 나가기)
function HeaderMenu({
  tripId,
  inviteToken,
  userId,
  canLeave,
  onError,
}: {
  tripId: string
  inviteToken: string
  userId: string
  canLeave: boolean
  onError: (message: string) => void
}) {
  const t = useTranslations('trip.view')
  const tCommon = useTranslations('common')
  const tNav = useTranslations('nav')
  const locale = useLocale()
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [manualCopyUrl, setManualCopyUrl] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    // pointerdown이면 마우스/터치/펜을 모두 덮음
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // 다음 로케일은 공유 목록에서 순환시켜 구한다 (LocaleSwitcher 와 같은 규칙)
  const current: Locale = isLocale(locale) ? locale : defaultLocale
  const nextLocale: Locale = locales[(locales.indexOf(current) + 1) % locales.length]

  // 메뉴에는 코드(KO/EN)가 아니라 그 언어가 스스로를 부르는 이름을 쓴다.
  // Intl 이 갖고 있는 이름이라 로케일을 추가해도 문자열을 손으로 늘리지 않는다.
  // (메뉴는 open 일 때만 그려져 서버에서는 렌더되지 않으므로 hydration 과 무관하다)
  const nextLocaleName = useMemo(
    () => new Intl.DisplayNames([nextLocale], { type: 'language' }).of(nextLocale) ?? nextLocale,
    [nextLocale]
  )

  function toggleLocale() {
    setLocaleCookie(nextLocale)
    startTransition(() => { router.refresh(); setOpen(false) })
  }

  async function copyInviteLink() {
    const url = `${window.location.origin}/invite/${inviteToken}`
    setManualCopyUrl(null)
    try {
      // HTTPS가 아니거나 권한이 거부되면 clipboard가 없거나 reject됨
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => { setCopied(false); setOpen(false) }, 1500)
    } catch {
      // 직접 복사할 수 있도록 주소를 노출
      setManualCopyUrl(url)
    }
  }

  async function leaveTrip() {
    if (leaving) return // 연타 방지
    if (!window.confirm(t('leaveTripConfirm'))) return

    setLeaving(true)
    try {
      // .select('user_id') 로 실제 지워진 행을 받아 온다.
      // PostgREST 의 delete 는 RLS 에 막혀 한 행도 지우지 못해도 error 가 null 이라
      // if (error) 만 보면 실패를 성공으로 오인해 홈으로 보내게 된다.
      // 사용자는 나갔다고 믿지만 멤버십은 그대로 남는다 → 지워진 행 수까지 확인한다.
      const { data, error } = await supabase
        .from('trip_members')
        .delete()
        .eq('trip_id', tripId)
        .eq('user_id', userId)
        .select('user_id')

      if (error) {
        failLeave()
        return
      }

      // 0행에는 서로 다른 두 상황이 섞여 있어 그것만으로는 성공/실패를 가릴 수 없다.
      //   (a) 다른 탭에서 이미 나갔다 → 지울 행이 없었을 뿐 실제로는 성공한 상태
      //   (b) RLS 에 막혔다 → 실패. 여행을 만든 사람이 직접 호출했거나, 새 DB 에
      //       schema.sql 을 다시 돌리지 않아 trip_members_delete 만 빠진 경우다.
      // 0행을 그냥 성공으로 보면 (b) 에서 사용자가 "나갔다"는 화면을 보고 홈으로 가지만
      // 실제로는 나가지 못한 상태가 되고 아무도 이상을 눈치채지 못한다.
      // 그래서 0행일 때만 자기 멤버십을 한 번 더 조회한다. 이 조회는 trip_members_select
      // 정책(= is_trip_member(trip_id))을 타므로 (a) 는 null 이 오고 (b) 는 자기 행이
      // 그대로 조회된다. 추가 왕복은 드문 실패 경로에서만 생긴다.
      //
      // 가리지 못하는 경우 하나 — 정책이 하나도 없는 DB 라면 이 조회도 0행이라 (a) 로
      // 잘못 본다. 다만 그런 DB 에서는 trips_select 도 없어 trip/[id]/page.tsx 의 여행
      // 조회부터 비어 notFound 로 끝나므로, 이 버튼이 있는 화면 자체에 닿을 수 없다.
      if (!data || data.length === 0) {
        const { data: remaining, error: recheckError } = await supabase
          .from('trip_members')
          .select('user_id')
          .eq('trip_id', tripId)
          .eq('user_id', userId)
          .maybeSingle()

        // 조회가 실패하면 나갔는지 알 수 없으므로 실패로 본다 (fail-closed)
        if (recheckError || remaining) {
          failLeave()
          return
        }
      }

      // 성공하면 leaving 을 되돌리지 않는다. 이 화면은 곧 사라지므로,
      // 이동이 끝나기 전에 버튼이 다시 눌리는 일만 막으면 된다.
      // '/' 는 쿠키로 인증하는 dynamic 라우트라 staleTimes.dynamic 기본값 0 에서
      // 이동할 때마다 서버에서 다시 가져온다. router.refresh() 는 같은 것을 한 번 더
      // 가져오는 낭비라 부르지 않는다.
      router.replace('/')
    } catch {
      failLeave()
    }
  }

  function failLeave() {
    setLeaving(false)
    setOpen(false) // 메뉴는 닫고 안내는 화면 하단에 띄운다
    // 메뉴가 사라지면 지금 포커스가 있는 '나가기' 버튼도 함께 언마운트되어
    // 키보드/스크린리더 포커스가 <body> 로 떨어진다. Escape 처리와 같게 트리거로 되돌린다.
    triggerRef.current?.focus()
    onError(t('leaveTripFailed'))
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => { setManualCopyUrl(null); setOpen(v => !v) }}
        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 active:bg-gray-200 text-lg leading-none"
        aria-label={tNav('moreMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-50 min-w-[120px] rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
          <Link
            href={`/trip/${tripId}/import`}
            role="menuitem"
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
            onClick={() => setOpen(false)}
          >
            {tNav('import')}
          </Link>
          <button
            onClick={copyInviteLink}
            role="menuitem"
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
          >
            {copied ? tCommon('copied') : tNav('copyInviteLink')}
          </button>
          {manualCopyUrl && (
            <div className="px-4 pb-2">
              <p role="alert" className="text-[10px] leading-snug text-red-500">{t('copyLinkFailed')}</p>
              <input
                readOnly
                value={manualCopyUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={tNav('copyInviteLink')}
                className="mt-1 w-48 rounded border border-gray-200 px-2 py-1 text-[10px] text-gray-700"
              />
            </div>
          )}
          <button
            onClick={toggleLocale}
            disabled={isPending}
            aria-busy={isPending}
            /* 보이는 글자(언어 이름)를 접근성 이름 안에 그대로 품게 해 음성 입력으로도 누를 수 있게 한다 */
            aria-label={`${tNav('switchLanguage')} (${nextLocaleName})`}
            role="menuitem"
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50"
          >
            {`🌐 ${nextLocaleName}`}
          </button>
          {canLeave && (
            <button
              onClick={leaveTrip}
              disabled={leaving}
              aria-busy={leaving}
              role="menuitem"
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50"
            >
              {tNav('leaveTrip')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// 날짜 추가 버튼
function AddDayButton({
  tripId,
  onAdded,
  onError,
}: {
  tripId: string
  onAdded: () => void
  onError: (message: string | null) => void
}) {
  const t = useTranslations('trip.view')
  const supabase = createClient()
  const [adding, setAdding] = useState(false)

  async function addDay() {
    if (adding) return // 연타로 여러 건이 들어가지 않도록
    setAdding(true)
    onError(null)
    try {
      const { data: existingDays, error: selectError } = await supabase
        .from('days')
        .select('date')
        .eq('trip_id', tripId)
        .order('date', { ascending: false })
        .limit(1)

      if (selectError) {
        onError(t('addDayFailed'))
        return
      }

      const lastDate = existingDays?.[0]?.date
      let next: Date
      if (lastDate) {
        next = parseLocalDate(lastDate)
        next.setDate(next.getDate() + 1)
      } else {
        next = new Date()
      }

      const { error: insertError } = await supabase
        .from('days')
        .insert({ trip_id: tripId, date: formatLocalDate(next) })

      if (insertError) {
        // days(trip_id, date) unique 제약 위반 — 같은 날짜가 이미 있음
        onError(insertError.code === '23505' ? t('addDayDuplicate') : t('addDayFailed'))
        return
      }

      onAdded()
    } finally {
      setAdding(false)
    }
  }

  return (
    <button
      onClick={addDay}
      disabled={adding}
      aria-busy={adding}
      className="shrink-0 rounded-full bg-gray-100 px-3.5 py-1.5 text-xs font-medium text-gray-500 disabled:opacity-50"
    >
      {t('addDate')}
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

  // 포커스 중인 장소를 최신 값으로 들고 있기 (날짜 변경 effect가 focus 변경으로 재실행되지 않도록)
  // 이 effect 는 아래 날짜 pan effect 보다 반드시 먼저 선언돼 있어야 한다.
  // 한 커밋에서 포커스 해제와 날짜 변경이 함께 일어날 때(날짜 삭제) 같은 순서로 실행되므로,
  // 여기서 ref 가 먼저 비워져야 날짜 pan effect 가 '보는 장소 없음' 으로 보고 pan 을 한다.
  const focusedPlaceIdRef = useRef(focusedPlaceId)
  useEffect(() => {
    focusedPlaceIdRef.current = focusedPlaceId
  }, [focusedPlaceId])

  // 선택된 날이 바뀌면 첫 번째 장소로 pan
  useEffect(() => {
    if (!map || places.length === 0) return
    // 특정 장소를 보고 있는 중이면 지도를 뺏지 않음 (스크롤로 날짜가 바뀌어도 그대로 유지)
    if (focusedPlaceIdRef.current) return
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

    const bounds = new google.maps.LatLngBounds()
    path.forEach(p => bounds.extend(p))

    let polyline: google.maps.Polyline

    if (mode === 'WALK') {
      polyline = new google.maps.Polyline({
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
    } else {
      const color = mode === 'DRIVE' ? '#f59e0b' : '#2563eb'
      polyline = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: 0.8,
        strokeWeight: 4,
      })
    }

    polyline.setMap(map)
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
  // 렌더 중 ref 쓰기는 React 규칙 위반 — effect에서 최신 콜백으로 갱신
  useEffect(() => {
    onPoiClickRef.current = onPoiClick
  }, [onPoiClick])

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
  const t = useTranslations('trip.view')
  const tCommon = useTranslations('common')
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
                      {'\u{1F6B6}'} {t('walking')}
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
                    {emoji} {label} {'\u00B7'} {seg.stopCount}{t('stops')}
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
              {t('googleMaps')}
            </a>
          )}
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 text-sm px-1"
            aria-label={tCommon('close')}
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
  const t = useTranslations('trip.view')
  const format = useFormatter()
  // 요청 키를 함께 담아두고 렌더에서 비교 — effect 안에서 동기 setState 하지 않기 위함
  const [state, setState] = useState<{
    key: string
    status: 'error' | 'ok'
    results: DistanceResult[]
  } | null>(null)

  const requestKey = `${from.lat},${from.lng}->${to.lat},${to.lng}`

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
      }),
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('distance request failed'))))
      .then((data: { results?: DistanceResult[] }) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, status: 'ok', results: data.results ?? [] })
      })
      .catch(() => {
        // 언마운트/재요청으로 취소된 경우는 무시 (죽은 컴포넌트 setState 방지)
        if (controller.signal.aborted) return
        setState({ key: requestKey, status: 'error', results: [] })
      })

    return () => controller.abort()
  }, [from.lat, from.lng, to.lat, to.lng, requestKey])

  const current = state && state.key === requestKey ? state : null

  if (!current) return <p className="text-[10px] text-gray-400 mt-1">{t('calculating')}</p>
  if (current.status === 'error') return <p role="alert" className="text-[10px] text-red-500 mt-1">{t('distanceError')}</p>
  if (current.results.length === 0) return <p className="text-[10px] text-gray-400 mt-1">{t('distanceEmpty')}</p>

  const results = current.results

  return (
    <div className="flex items-center gap-2 mt-1">
      {results.map((r) => (
        <button
          key={r.mode}
          onClick={() => onSelectRoute?.(r.mode)}
          className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 active:bg-blue-100"
        >
          {r.icon} {r.minutes}{t('minutesDot')}{formatDistance(format, r.distanceMeters)}
        </button>
      ))}
    </div>
  )
}
