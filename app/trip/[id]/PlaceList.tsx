'use client'

import { useState } from 'react'
import type { Place } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { generateKeyBetween } from 'fractional-indexing'

interface Props {
  dayId: string | null
  places: Place[]
  onRefresh: () => void
  onPlaceClick?: (place: Place) => void
}

export default function PlaceList({ dayId, places, onRefresh, onPlaceClick }: Props) {
  const supabase = createClient()

  async function deletePlace(id: string) {
    await supabase.from('places').delete().eq('id', id)
    onRefresh()
  }

  if (!dayId) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <p className="text-sm text-gray-400">날짜를 선택하거나 추가해주세요</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {places.length}개 장소
        </span>
        <Link
          href={`/trip/add?dayId=${dayId}`}
          className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white"
        >
          + 장소 추가
        </Link>
      </div>

      {places.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-gray-400">아직 장소가 없어요</p>
        </div>
      ) : (
        <ol className="flex flex-col divide-y divide-gray-50 px-4 dark:divide-gray-800">
          {places.map((place, i) => (
            <li
              key={place.id}
              className="flex items-center gap-3 py-3 cursor-pointer"
              onClick={() => onPlaceClick?.(place)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{place.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                  {place.visit_time && <span className="mr-1">{place.visit_time.slice(0, 5)}</span>}
                  {place.address}
                </p>
              </div>
              <button
                onClick={() => deletePlace(place.id)}
                className="shrink-0 text-gray-300 transition-colors hover:text-red-400 active:text-red-600 dark:text-gray-600 dark:hover:text-red-400"
                aria-label="장소 삭제"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
