'use client'
import { useEffect, useRef, useState } from 'react'
import type { Place } from '@/types/supabase'
import { useTranslations } from 'next-intl'

// 서버는 거리를 미터 숫자로 내려주고, 표기는 화면에서 로케일에 맞춰 만든다.
interface DistanceResult {
  mode: string
  minutes: number
  distanceMeters: number
  icon: string
}

interface DistanceBadgeProps {
  from: Place
  to: Place
  onSelectRoute?: (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }, mode: string, fromPlaceId?: string, toPlaceId?: string) => void
}

/* ── 모듈 레벨 캐시 ── */
// null = 조회 실패 또는 결과 없음. undefined(= 미조회)와 구분해야 하므로 Map 에 null 을 그대로 담는다.
type DistanceValue = DistanceResult[] | null

const cache = new Map<string, DistanceValue>()

interface PendingRequest {
  promise: Promise<DistanceValue>
  controller: AbortController
  subscribers: number
}

// 같은 구간을 동시에 요청하는 badge 들이 하나의 promise 를 공유한다 (결과가 아니라 promise 자체를 캐시).
const pending = new Map<string, PendingRequest>()

// 좌표가 바뀌면(장소 위치 수정) 캐시가 무효화되도록 반올림한 좌표를 키에 포함한다.
function buildCacheKey(from: Place, to: Place) {
  return `${from.id}:${to.id}@${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === 'AbortError'
}

function acquire(cacheKey: string, from: Place, to: Place): PendingRequest {
  const existing = pending.get(cacheKey)
  if (existing) {
    existing.subscribers += 1
    return existing
  }

  const controller = new AbortController()
  const request: PendingRequest = {
    controller,
    subscribers: 1,
    promise: fetch('/api/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
      }),
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { results?: DistanceResult[] } | null) => {
        const value: DistanceValue = data?.results?.length ? data.results : null
        cache.set(cacheKey, value)
        return value
      })
      .catch((err: unknown) => {
        // 언마운트로 인한 중단은 "실패"가 아니므로 캐시에 남기지 않는다 (다시 보이면 재시도).
        if (!isAbortError(err)) cache.set(cacheKey, null)
        return null
      })
      .finally(() => {
        // 언마운트→재마운트 사이에 새 요청이 같은 키로 등록됐을 수 있다.
        // 키만 보고 지우면 남의(더 새로운) 요청을 지워 abort 도 dedup 도 못 하게 된다.
        if (pending.get(cacheKey) === request) pending.delete(cacheKey)
      }),
  }

  pending.set(cacheKey, request)
  return request
}

function release(cacheKey: string) {
  const request = pending.get(cacheKey)
  if (!request) return
  request.subscribers -= 1
  if (request.subscribers <= 0) {
    request.controller.abort()
    pending.delete(cacheKey)
  }
}

/* ── DistanceBadge ── */
export default function DistanceBadge({ from, to, onSelectRoute }: DistanceBadgeProps) {
  const t = useTranslations('trip.view')
  const containerRef = useRef<HTMLDivElement>(null)
  const cacheKey = buildCacheKey(from, to)

  // IntersectionObserver 가 없는 환경(SSR 등)에서는 처음부터 보이는 것으로 취급한다.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [loaded, setLoaded] = useState<{ key: string; value: DistanceValue } | null>(null)

  // 캐시 값은 effect 안에서 setState 하지 않고 렌더 중에 바로 읽는다 (cascading render 방지).
  const cached = cache.get(cacheKey)
  const results: DistanceValue | undefined =
    cached !== undefined ? cached : loaded?.key === cacheKey ? loaded.value : undefined

  // 화면에 들어올 때까지 요청하지 않는다 (스크롤하지 않은 Day 의 Google API 호출 비용 절감).
  useEffect(() => {
    if (visible) return
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    if (cache.has(cacheKey)) return // 이미 캐시됨 → 렌더에서 읽는다

    const request = acquire(cacheKey, from, to)
    let active = true

    request.promise.then(value => {
      if (active) setLoaded({ key: cacheKey, value })
    })

    return () => {
      active = false
      release(cacheKey)
    }
    // from/to 는 cacheKey 에 좌표까지 인코딩되어 있으므로 cacheKey 로 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, cacheKey])

  // 실패/결과 없음 → 조용히 아무것도 표시하지 않는다 (부가 기능이므로 에러 UI 없음).
  if (results === null) return null

  return (
    <div ref={containerRef} className="flex items-center justify-center gap-2 py-1.5">
      {results === undefined ? (
        // 로딩 자리표시: 결과 pill 과 동일한 박스를 미리 잡아 값이 도착해도 레이아웃이 밀리지 않는다.
        <span
          aria-hidden="true"
          className="invisible inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px]"
        >
          {'\u00A0'}
        </span>
      ) : (
        results.map(r => (
          <button
            key={r.mode}
            onClick={() => onSelectRoute?.({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, r.mode, from.id, to.id)}
            className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 active:bg-blue-100"
          >
            {r.icon} {r.minutes}{t('minutes')}
          </button>
        ))
      )}
    </div>
  )
}
