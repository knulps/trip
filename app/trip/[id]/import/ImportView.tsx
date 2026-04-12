'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
  added: boolean       // 이미 추가된 장소
  addedToDay: string   // 추가된 Day 라벨
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

  const [parsedPlaces, setParsedPlaces] = useState<ParsedPlace[]>([])
  const [selectedDayId, setSelectedDayId] = useState<string>(days[0]?.id ?? '')
  const [importing, setImporting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  function getDayLabel(dayId: string) {
    const idx = days.findIndex(d => d.id === dayId)
    if (idx === -1) return ''
    const day = days[idx]
    const date = new Date(day.date + 'T00:00:00')
    const dayOfWeek = ['일','월','화','수','목','금','토'][date.getDay()]
    return `Day ${idx + 1} (${date.getMonth() + 1}/${date.getDate()} ${dayOfWeek})`
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const lines = text.split('\n').filter(line => line.trim())
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
          selected: false,
          resolved: false,
          added: false,
          addedToDay: '',
        }
      })

      setParsedPlaces(places)
    }
    reader.readAsText(f, 'UTF-8')
  }

  // 선택된 항목의 좌표 검색 (URL의 CID로 정확한 장소 조회)
  async function resolveSelected() {
    const toResolve = parsedPlaces.filter(p => p.selected && !p.resolved && !p.added)
    if (toResolve.length === 0) return

    setResolving(true)
    setProgress({ current: 0, total: toResolve.length })

    const updated = [...parsedPlaces]

    let count = 0
    for (let i = 0; i < updated.length; i++) {
      if (!updated[i].selected || updated[i].resolved || updated[i].added) continue

      count++
      setProgress({ current: count, total: toResolve.length })

      try {
        const res = await fetch('/api/resolve-place', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: updated[i].url, name: updated[i].name }),
        })

        if (res.ok) {
          const data = await res.json() as { lat: number; lng: number; name: string; address: string }
          updated[i] = {
            ...updated[i],
            lat: data.lat,
            lng: data.lng,
            address: data.address,
            name: data.name,
            resolved: true,
          }
        } else {
          updated[i] = { ...updated[i], resolved: true }
        }
      } catch {
        updated[i] = { ...updated[i], resolved: true }
      }

      await new Promise(r => setTimeout(r, 200))
    }

    setParsedPlaces(updated)
    setResolving(false)
  }

  // 선택된 항목을 선택한 Day에 추가
  async function addSelectedToDay() {
    if (!selectedDayId) return
    const toImport = parsedPlaces.filter(p => p.selected && p.resolved && p.lat != null && !p.added)
    if (toImport.length === 0) return

    setImporting(true)
    const supabase = createClient()

    // 중복 체크
    const { data: existingPlaces } = await supabase
      .from('places')
      .select('name')
      .eq('day_id', selectedDayId)

    const existingNames = new Set((existingPlaces ?? []).map(p => p.name))
    const filtered = toImport.filter(p => !existingNames.has(p.name))
    const skipped = toImport.length - filtered.length

    if (filtered.length === 0) {
      alert(`선택한 장소 ${toImport.length}개 모두 이미 추가되어 있습니다.`)
      setImporting(false)
      return
    }

    if (skipped > 0) {
      alert(`중복 ${skipped}개 스킵, ${filtered.length}개 추가합니다.`)
    }

    const { data: lastPlaces } = await supabase
      .from('places')
      .select('order_key')
      .eq('day_id', selectedDayId)
      .order('order_key', { ascending: false })
      .limit(1)

    let lastKey = lastPlaces?.[0]?.order_key ?? null
    const dayLabel = getDayLabel(selectedDayId)
    const addedNames = new Set(filtered.map(p => p.name))

    for (const place of filtered) {
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

    // 추가된 항목 마킹
    setParsedPlaces(prev => prev.map(p =>
      addedNames.has(p.name) && p.selected && p.resolved && p.lat != null
        ? { ...p, added: true, addedToDay: dayLabel, selected: false }
        : p
    ))

    setImporting(false)
  }

  const selectableCount = parsedPlaces.filter(p => !p.added).length
  const selectedCount = parsedPlaces.filter(p => p.selected && !p.added).length
  const needsResolve = parsedPlaces.some(p => p.selected && !p.resolved && !p.added)
  const canImport = parsedPlaces.some(p => p.selected && p.resolved && p.lat != null && !p.added)
  const allDone = parsedPlaces.length > 0 && parsedPlaces.every(p => p.added || !p.lat)

  return (
    <main className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 pb-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link href={`/trip/${trip.id}`} className="text-gray-400 dark:text-gray-500 text-lg">&#8249;</Link>
        <h1 className="text-base font-semibold">장소 가져오기</h1>
      </header>

      <div className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto pb-4">
        {/* 파일 업로드 */}
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400">CSV 파일 선택</label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="w-full mt-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:file:bg-gray-100 dark:file:text-gray-900"
          />
        </div>

        {parsedPlaces.length > 0 && (
          <>
            {/* Day 선택 + 전체 선택/해제 */}
            <div className="flex items-center gap-2">
              <select
                value={selectedDayId}
                onChange={(e) => setSelectedDayId(e.target.value)}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
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
              <button
                onClick={() => {
                  const allSelected = parsedPlaces.filter(p => !p.added).every(p => p.selected)
                  setParsedPlaces(prev => prev.map(p => p.added ? p : { ...p, selected: !allSelected }))
                }}
                className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300"
              >
                {parsedPlaces.filter(p => !p.added).every(p => p.selected) ? '전체 해제' : '전체 선택'}
              </button>
            </div>

            {/* 액션 버튼 */}
            {selectedCount > 0 && (
              <div className="flex gap-2">
                {needsResolve && (
                  <button
                    onClick={resolveSelected}
                    disabled={resolving}
                    className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
                  >
                    {resolving ? `좌표 검색 중... (${progress.current}/${progress.total})` : `${selectedCount}개 좌표 검색`}
                  </button>
                )}
                {canImport && (
                  <button
                    onClick={addSelectedToDay}
                    disabled={importing}
                    className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {importing ? '추가 중...' : `${parsedPlaces.filter(p => p.selected && p.resolved && p.lat && !p.added).length}개 추가`}
                  </button>
                )}
              </div>
            )}

            {/* 완료 버튼 */}
            {allDone && (
              <button
                onClick={() => router.push(`/trip/${trip.id}`)}
                className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white"
              >
                완료 - 여행으로 돌아가기
              </button>
            )}

            {/* 장소 리스트 */}
            <p className="text-xs text-gray-400">
              {selectableCount}개 중 {selectedCount}개 선택
              {parsedPlaces.some(p => p.added) && ` · ${parsedPlaces.filter(p => p.added).length}개 추가 완료`}
            </p>
            <div className="flex flex-col divide-y divide-gray-50 dark:divide-gray-800">
              {parsedPlaces.map((place, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 py-2 ${place.added ? 'opacity-40' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={place.selected}
                    disabled={place.added}
                    onChange={() => {
                      if (place.added) return
                      const updated = [...parsedPlaces]
                      updated[i] = { ...updated[i], selected: !updated[i].selected }
                      setParsedPlaces(updated)
                    }}
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{place.name}</p>
                    {place.memo && <p className="text-xs text-gray-400 truncate">{place.memo}</p>}
                    {place.added ? (
                      <p className="text-xs text-blue-500">&#10003; {place.addedToDay}에 추가됨</p>
                    ) : place.resolved && place.lat ? (
                      <p className="text-xs text-green-500 truncate">&#10003; {place.address}</p>
                    ) : place.resolved && !place.lat ? (
                      <p className="text-xs text-red-400">&#10007; 좌표를 찾을 수 없음</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export default function ImportView({ trip, days }: { trip: Trip; days: Day[] }) {
  return <ImportViewInner trip={trip} days={days} />
}
