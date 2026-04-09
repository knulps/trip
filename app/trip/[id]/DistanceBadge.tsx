'use client'
import { useEffect, useState } from 'react'
import type { Place } from '@/types/supabase'

interface DistanceResult {
  minutes: number
  distance: string
  icon: string
}

const cache = new Map<string, DistanceResult | null>()

export default function DistanceBadge({ from, to }: { from: Place; to: Place }) {
  const [result, setResult] = useState<DistanceResult | null | undefined>(undefined)
  const cacheKey = `${from.id}:${to.id}`

  useEffect(() => {
    if (cache.has(cacheKey)) {
      setResult(cache.get(cacheKey))
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
      .then((data: DistanceResult | null) => {
        const val = data?.minutes != null ? data : null
        cache.set(cacheKey, val)
        setResult(val)
      })
      .catch(() => {
        cache.set(cacheKey, null)
        setResult(null)
      })
  }, [cacheKey, from.lat, from.lng, to.lat, to.lng])

  if (!result) return null  // loading or error → show nothing

  return (
    <div className="flex items-center justify-center py-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {result.icon} {result.minutes}분 · {result.distance}
      </span>
    </div>
  )
}
