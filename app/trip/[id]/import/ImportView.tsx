'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps'
import type { Trip, Day } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import { generateKeyBetween } from 'fractional-indexing'
import Link from 'next/link'

interface ParsedPlace {
  name: string
  memo: string
  url: string
  lat: number | null
  lng: number | null
  address: string
  selected: boolean
  resolved: boolean
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function ImportViewInner({ trip, days }: { trip: Trip; days: Day[] }) {
  const router = useRouter()
  const placesLib = useMapsLibrary('places')

  const [file, setFile] = useState<File | null>(null)
  const [parsedPlaces, setParsedPlaces] = useState<ParsedPlace[]>([])
  const [selectedDayId, setSelectedDayId] = useState<string>(days[0]?.id ?? '')
  const [importing, setImporting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const lines = text.split('\n').filter(line => line.trim())
      // Skip header (제목,메모,URL,태그,댓글) and filter empty rows
      const dataLines = lines.slice(1).filter(line => {
        const cols = parseCSVLine(line)
        return cols[0]?.trim()
      })

      const places: ParsedPlace[] = dataLines.map(line => {
        const cols = parseCSVLine(line)
        return {
          name: cols[0]?.trim() ?? '',
          memo: cols[1]?.trim() ?? '',
          url: cols[2]?.trim() ?? '',
          lat: null,
          lng: null,
          address: '',
          selected: true,
          resolved: false,
        }
      })

      setParsedPlaces(places)
    }
    reader.readAsText(f, 'UTF-8')
  }

  async function resolveCoordinates() {
    if (!placesLib || parsedPlaces.length === 0) return
    setResolving(true)
    setProgress({ current: 0, total: parsedPlaces.length })

    const service = new placesLib.PlacesService(document.createElement('div'))

    const resolved = [...parsedPlaces]
    for (let i = 0; i < resolved.length; i++) {
      if (!resolved[i].selected) continue

      setProgress({ current: i + 1, total: resolved.length })

      try {
        const result = await new Promise<google.maps.places.PlaceResult | null>((resolve) => {
          service.findPlaceFromQuery(
            {
              query: resolved[i].name,
              fields: ['geometry', 'formatted_address', 'name'],
            },
            (results, status) => {
              if (status === google.maps.places.PlacesServiceStatus.OK && results?.[0]) {
                resolve(results[0])
              } else {
                resolve(null)
              }
            }
          )
        })

        if (result?.geometry?.location) {
          resolved[i] = {
            ...resolved[i],
            lat: result.geometry.location.lat(),
            lng: result.geometry.location.lng(),
            address: result.formatted_address ?? '',
            name: result.name ?? resolved[i].name,
            resolved: true,
          }
        } else {
          resolved[i] = { ...resolved[i], resolved: true }
        }
      } catch {
        resolved[i] = { ...resolved[i], resolved: true }
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200))
    }

    setParsedPlaces(resolved)
    setResolving(false)
  }

  async function importPlaces() {
    if (!selectedDayId) return
    setImporting(true)

    const supabase = createClient()
    const toImport = parsedPlaces.filter(p => p.selected && p.resolved && p.lat != null)

    // Get current last order_key for the day
    const { data: lastPlaces } = await supabase
      .from('places')
      .select('order_key')
      .eq('day_id', selectedDayId)
      .order('order_key', { ascending: false })
      .limit(1)

    let lastKey = lastPlaces?.[0]?.order_key ?? null

    for (const place of toImport) {
      const newKey = generateKeyBetween(lastKey, null)
      await supabase.from('places').insert({
        day_id: selectedDayId,
        order_key: newKey,
        name: place.name,
        lat: place.lat!,
        lng: place.lng!,
        address: place.address,
        memo: place.memo || null,
      })
      lastKey = newKey
    }

    setImporting(false)
    router.push(`/trip/${trip.id}`)
  }

  return (
    <main className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 pb-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link href={`/trip/${trip.id}`} className="text-gray-400 dark:text-gray-500 text-lg">&#8249;</Link>
        <h1 className="text-base font-semibold">장소 가져오기</h1>
      </header>

      <div className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
        {/* Step 1: File upload */}
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">CSV 파일 선택</label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="w-full mt-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:file:bg-gray-100 dark:file:text-gray-900"
          />
        </div>

        {/* Step 2: Day selection */}
        {parsedPlaces.length > 0 && (
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">가져올 Day 선택</label>
            <select
              value={selectedDayId}
              onChange={(e) => setSelectedDayId(e.target.value)}
              className="w-full mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {days.map((day, i) => {
                const date = new Date(day.date + 'T00:00:00')
                const dayOfWeek = ['일','월','화','수','목','금','토'][date.getDay()]
                return (
                  <option key={day.id} value={day.id}>
                    Day {i + 1} - {date.getMonth() + 1}/{date.getDate()} {dayOfWeek}
                  </option>
                )
              })}
            </select>
          </div>
        )}

        {/* Step 3: Resolve button */}
        {parsedPlaces.length > 0 && !parsedPlaces.some(p => p.resolved) && (
          <button
            onClick={resolveCoordinates}
            disabled={resolving}
            className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
          >
            {resolving ? `좌표 검색 중... (${progress.current}/${progress.total})` : `${parsedPlaces.filter(p => p.selected).length}개 장소 좌표 검색`}
          </button>
        )}

        {/* Place list with checkboxes */}
        {parsedPlaces.length > 0 && (
          <div className="flex flex-col divide-y divide-gray-50 dark:divide-gray-800">
            {parsedPlaces.map((place, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={place.selected}
                  onChange={() => {
                    const updated = [...parsedPlaces]
                    updated[i] = { ...updated[i], selected: !updated[i].selected }
                    setParsedPlaces(updated)
                  }}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{place.name}</p>
                  {place.memo && <p className="text-xs text-gray-400 truncate">{place.memo}</p>}
                  {place.resolved && place.lat ? (
                    <p className="text-xs text-green-500 truncate">&#10003; {place.address}</p>
                  ) : place.resolved && !place.lat ? (
                    <p className="text-xs text-red-400">&#10007; 좌표를 찾을 수 없음</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Import button */}
        {parsedPlaces.some(p => p.resolved && p.lat) && (
          <button
            onClick={importPlaces}
            disabled={importing}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {importing ? '가져오는 중...' : `${parsedPlaces.filter(p => p.selected && p.resolved && p.lat).length}개 장소 가져오기`}
          </button>
        )}
      </div>
    </main>
  )
}

export default function ImportView({ trip, days }: { trip: Trip; days: Day[] }) {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
      <ImportViewInner trip={trip} days={days} />
    </APIProvider>
  )
}
