'use client'
import { useEffect, useState } from 'react'
import type { Place } from '@/types/supabase'
import { useTranslations } from 'next-intl'

interface DistanceResult {
  mode: string
  minutes: number
  distance: string
  icon: string
}

interface DistanceBadgeProps {
  from: Place
  to: Place
  onSelectRoute?: (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }, mode: string, fromPlaceId?: string, toPlaceId?: string) => void
}

const cache = new Map<string, DistanceResult[] | null>()

export default function DistanceBadge({ from, to, onSelectRoute }: DistanceBadgeProps) {
  const t = useTranslations('trip.view')
  const [results, setResults] = useState<DistanceResult[] | null | undefined>(undefined)
  const cacheKey = `${from.id}:${to.id}`

  useEffect(() => {
    if (cache.has(cacheKey)) {
      setResults(cache.get(cacheKey))
      return
    }

    fetch('/api/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { results?: DistanceResult[] } | null) => {
        const val = data?.results?.length ? data.results : null
        cache.set(cacheKey, val)
        setResults(val)
      })
      .catch(() => {
        cache.set(cacheKey, null)
        setResults(null)
      })
  }, [cacheKey, from.lat, from.lng, to.lat, to.lng])

  if (!results) return null  // loading or error → show nothing

  return (
    <div className="flex items-center justify-center gap-2 py-1.5">
      {results.map(r => (
        <button
          key={r.mode}
          onClick={() => onSelectRoute?.({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, r.mode, from.id, to.id)}
          className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 active:bg-blue-100"
        >
          {r.icon} {r.minutes}{t('minutes')}
        </button>
      ))}
    </div>
  )
}
