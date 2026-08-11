'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import type { Day } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import { formatDayDate } from '@/lib/format'
import { generateKeyBetween } from 'fractional-indexing'
import Link from 'next/link'

// 좌표 검색 동시 실행 개수 (직렬로 돌리면 100개에 몇 분씩 걸린다)
const RESOLVE_CONCURRENCY = 3
// insert 한 번에 보낼 최대 행 수
const INSERT_CHUNK_SIZE = 50

type ResolveStatus = 'pending' | 'resolved' | 'notFound' | 'failed'
type DuplicateKind = 'day' | 'file'

interface ParsedPlace {
  id: string          // 파싱 시점에 부여하는 고유 id (이름이 같아도 행을 구분한다)
  name: string
  memo: string
  url: string
  lat: number | null
  lng: number | null
  address: string
  selected: boolean
  status: ResolveStatus
  added: boolean                    // 이미 추가된 장소
  addedToDay: string                // 추가된 Day 라벨
  duplicate: DuplicateKind | null   // 중복이라 건너뛴 이유
  addError: boolean                 // 추가하다 실패한 행
}

type ResolvedPlace = ParsedPlace & { lat: number; lng: number }

type BannerTone = 'success' | 'error' | 'info'
interface Banner {
  tone: BannerTone
  text: string
}

type ResolveOutcome =
  | { kind: 'ok'; lat: number; lng: number; name: string; address: string }
  | { kind: 'notFound' }      // 진짜로 좌표를 못 찾은 경우 (재시도해도 같다)
  | { kind: 'failed' }        // 네트워크/서버 일시 오류 (재시도 가능)
  | { kind: 'aborted' }       // 사용자가 취소했거나 화면을 떠난 경우
  | { kind: 'auth' }          // 401 - 로그인 세션 만료
  | { kind: 'unavailable' }   // 503 - 서버에서 검색 기능을 쓸 수 없음

let rowIdSeq = 0
function nextRowId(): string {
  rowIdSeq += 1
  return `csv-${rowIdSeq}`
}

/**
 * RFC 4180 방식 CSV 토크나이저.
 * 따옴표 안의 ""는 따옴표 한 글자로 읽고, 따옴표 밖의 개행에서만 행을 나눈다.
 * (구글맵 저장목록 CSV의 댓글 칸에는 줄바꿈이 들어있는 경우가 있다)
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // BOM 제거
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  for (; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      // \r\n 은 개행 하나로 센다
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

// 헤더가 없는 CSV의 첫 줄을 잃지 않도록, 진짜 헤더일 때만 건너뛴다
const HEADER_NAME_COLUMN = new Set(['이름', '제목', 'title', 'name'])
// 이름 칸 말고 다른 칸에서 헤더임을 한 번 더 뒷받침해 주는 단어.
// 'note' 처럼 메모 값으로도 흔히 쓰는 말은 넣지 않는다 (데이터 행을 헤더로 오인한다).
const HEADER_OTHER_COLUMNS = new Set([
  '메모', '설명', '비고', 'memo', 'description',
  'url', '링크', '주소', 'link', 'address',
  '태그', '댓글', 'tag', 'tags', 'comment', 'comments',
])
function looksLikeHeader(row: string[]): boolean {
  if (row.length === 0) return false
  const url = (row[2] ?? '').trim().toLowerCase()
  if (url === 'url') return true
  // 세 번째 칸에 진짜 링크가 있으면 데이터 행이다.
  if (url.startsWith('http://') || url.startsWith('https://')) return false
  if (!HEADER_NAME_COLUMN.has((row[0] ?? '').trim().toLowerCase())) return false
  // 이름 칸 하나만 맞는다고 헤더로 단정하지 않는다.
  // ('Name' 이라는 이름의 장소가 URL 칸이 비었다는 이유로 조용히 사라지지 않도록)
  // 다른 칸에도 헤더 단어가 있거나, 이름 말고는 아무 값도 없을 때만 헤더로 본다.
  const rest = row.slice(1).map(cell => (cell ?? '').trim().toLowerCase())
  return rest.some(cell => HEADER_OTHER_COLUMNS.has(cell)) || rest.every(cell => cell === '')
}

function hasCoords(place: ParsedPlace): place is ResolvedPlace {
  return place.lat != null && place.lng != null
}

// 좌표를 아직 찾지 않았거나 일시 오류로 실패한 행 (재시도 대상)
function needsCoords(place: ParsedPlace): boolean {
  return !place.added && (place.status === 'pending' || place.status === 'failed')
}

async function resolveOne(place: ParsedPlace, signal: AbortSignal): Promise<ResolveOutcome> {
  try {
    const res = await fetch('/api/resolve-place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: place.url, name: place.name }),
      signal,
    })

    if (res.ok) {
      const data = await res.json() as {
        lat?: unknown; lng?: unknown; name?: unknown; address?: unknown
      }
      if (typeof data.lat === 'number' && typeof data.lng === 'number') {
        return {
          kind: 'ok',
          lat: data.lat,
          lng: data.lng,
          name: typeof data.name === 'string' && data.name.trim() ? data.name : place.name,
          address: typeof data.address === 'string' ? data.address : '',
        }
      }
      return { kind: 'notFound' }
    }

    if (res.status === 401) return { kind: 'auth' }
    if (res.status === 503) {
      // 503 은 두 갈래다.
      //   no_key         → 서버에 키가 없어 더 보내도 소용없다 (전체 중단)
      //   upstream_error → Google 호출이 이번에만 실패했다 (이 행만 재시도 대상)
      // 본문을 못 읽으면 아래 catch 로 떨어져 재시도 가능한 실패로 남는다.
      const detail = await res.json() as { error?: unknown }
      return detail.error === 'upstream_error' ? { kind: 'failed' } : { kind: 'unavailable' }
    }
    // 404(못 찾음), 400(주소/이름이 잘못됨)은 다시 보내도 결과가 같다
    if (res.status === 404 || res.status === 400) return { kind: 'notFound' }
    // 그 외(5xx, 429 등)는 일시 오류로 보고 재시도할 수 있게 남긴다
    return { kind: 'failed' }
  } catch {
    if (signal.aborted) return { kind: 'aborted' }
    return { kind: 'failed' }
  }
}

export default function ImportView({ tripId, days }: { tripId: string; days: Day[] }) {
  const router = useRouter()
  const t = useTranslations('trip.import')
  const tCommon = useTranslations('common')
  const tNav = useTranslations('nav')
  const format = useFormatter()

  const [parsedPlaces, setParsedPlaces] = useState<ParsedPlace[]>([])
  const [parsed, setParsed] = useState(false)
  const [selectedDayId, setSelectedDayId] = useState<string>(days[0]?.id ?? '')
  const [importing, setImporting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [banner, setBanner] = useState<Banner | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // 화면을 떠나면 진행 중인 좌표 검색을 끊는다
  useEffect(() => () => { abortRef.current?.abort() }, [])

  function getDayLabel(dayId: string) {
    const idx = days.findIndex(d => d.id === dayId)
    if (idx === -1) return t('unknownDay')
    // 로케일에 따라 날짜 표기 자체에 괄호가 들어가므로(ko: "5. 3. (일)") 가운뎃점으로 잇는다
    return `${tCommon('dayLabel', { n: idx + 1 })} · ${formatDayDate(format, days[idx].date)}`
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const f = input.files?.[0]
    // 같은 파일을 다시 골라도 change 가 일어나도록 값을 비운다
    input.value = ''
    if (!f) return

    setBanner(null)

    const reader = new FileReader()

    reader.onerror = () => {
      setParsedPlaces([])
      setParsed(false)
      setBanner({ tone: 'error', text: t('fileReadError') })
    }

    reader.onload = (ev) => {
      const result = ev.target?.result
      if (typeof result !== 'string') {
        setParsedPlaces([])
        setParsed(false)
        setBanner({ tone: 'error', text: t('fileReadError') })
        return
      }

      const rows = parseCSV(result)
      const dataRows = rows.length > 0 && looksLikeHeader(rows[0]) ? rows.slice(1) : rows

      const places: ParsedPlace[] = dataRows
        .filter(cols => (cols[0] ?? '').trim() !== '')
        .map(cols => ({
          id: nextRowId(),
          name: (cols[0] ?? '').trim(),
          memo: (cols[1] ?? '').trim(),
          url: (cols[2] ?? '').trim(),
          lat: null,
          lng: null,
          address: '',
          selected: false,
          status: 'pending' as const,
          added: false,
          addedToDay: '',
          duplicate: null,
          addError: false,
        }))

      setParsedPlaces(places)
      setParsed(true)
    }

    reader.readAsText(f, 'UTF-8')
  }

  // 좌표 검색 (URL의 CID로 정확한 장소 조회). 동시 3개씩, 취소 가능
  async function runResolve(targets: ParsedPlace[]) {
    if (targets.length === 0 || resolving || importing) return

    const controller = new AbortController()
    abortRef.current = controller

    setResolving(true)
    setBanner(null)
    setProgress({ current: 0, total: targets.length })

    // 재시도 시 이전 실패 표시를 지우고 선택 상태로 맞춘다
    const targetIds = new Set(targets.map(p => p.id))
    setParsedPlaces(prev => prev.map(p => targetIds.has(p.id)
      ? { ...p, selected: true, status: 'pending' as const }
      : p))

    const queue = targets.slice()
    let done = 0
    let okCount = 0
    let notFoundCount = 0
    let failedCount = 0
    let authFailed = false
    let unavailable = false

    async function worker(): Promise<void> {
      for (;;) {
        if (controller.signal.aborted || authFailed || unavailable) return
        const place = queue.shift()
        if (!place) return

        const outcome = await resolveOne(place, controller.signal)

        if (outcome.kind === 'aborted') return
        if (outcome.kind === 'auth') { authFailed = true; return }
        if (outcome.kind === 'unavailable') { unavailable = true; return }

        // 오래 걸리는 작업이라 그 사이 목록이 바뀌었을 수 있다. 항상 최신 상태 위에 반영한다
        if (outcome.kind === 'ok') {
          okCount++
          setParsedPlaces(prev => prev.map(p => p.id === place.id
            ? {
                ...p,
                lat: outcome.lat,
                lng: outcome.lng,
                address: outcome.address,
                name: outcome.name,
                status: 'resolved' as const,
              }
            : p))
        } else if (outcome.kind === 'notFound') {
          notFoundCount++
          setParsedPlaces(prev => prev.map(p => p.id === place.id
            ? { ...p, status: 'notFound' as const }
            : p))
        } else {
          failedCount++
          setParsedPlaces(prev => prev.map(p => p.id === place.id
            ? { ...p, status: 'failed' as const }
            : p))
        }

        done++
        setProgress({ current: done, total: targets.length })
      }
    }

    const workerCount = Math.min(RESOLVE_CONCURRENCY, targets.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    abortRef.current = null
    setResolving(false)
    setProgress({ current: 0, total: 0 })

    if (authFailed) {
      setBanner({ tone: 'error', text: t('sessionExpired') })
    } else if (unavailable) {
      setBanner({ tone: 'error', text: t('resolveUnavailable') })
    } else if (controller.signal.aborted) {
      setBanner({ tone: 'info', text: t('resolveCancelled') })
    } else if (failedCount > 0) {
      setBanner({ tone: 'error', text: t('resolveDoneWithFailures', { resolved: okCount, failed: failedCount }) })
    } else if (notFoundCount > 0) {
      setBanner({ tone: 'info', text: t('resolveDoneWithMissing', { resolved: okCount, notFound: notFoundCount }) })
    } else {
      setBanner({ tone: 'success', text: t('resolveDone', { resolved: okCount }) })
    }
  }

  function resolveSelected() {
    void runResolve(parsedPlaces.filter(p => p.selected && needsCoords(p)))
  }

  function retryFailed() {
    void runResolve(parsedPlaces.filter(p => !p.added && p.status === 'failed'))
  }

  function cancelResolve() {
    abortRef.current?.abort()
  }

  // 선택된 항목을 선택한 Day에 추가
  async function addSelectedToDay() {
    if (!selectedDayId || resolving || importing) return
    const toImport = parsedPlaces.filter((p): p is ResolvedPlace =>
      p.selected && !p.added && hasCoords(p))
    if (toImport.length === 0) return

    setImporting(true)
    setBanner(null)
    setImportProgress({ current: 0, total: toImport.length })

    // 지난 시도의 실패 표시는 지우고 시작한다
    const attemptIds = new Set(toImport.map(p => p.id))
    setParsedPlaces(prev => prev.map(p =>
      p.addError && attemptIds.has(p.id) ? { ...p, addError: false } : p))

    const supabase = createClient()
    const dayLabel = getDayLabel(selectedDayId)

    // 중복 체크 — 조회가 실패하면 중복을 못 걸러 그대로 또 넣게 되므로 여기서 멈춘다
    const { data: existingPlaces, error: existingError } = await supabase
      .from('places')
      .select('name')
      .eq('day_id', selectedDayId)

    if (existingError || !existingPlaces) {
      setBanner({ tone: 'error', text: t('duplicateCheckFailed') })
      setImporting(false)
      setImportProgress({ current: 0, total: 0 })
      return
    }

    const existingNames = new Set(existingPlaces.map(p => p.name))

    // 이 날짜에 이미 있는 이름, 그리고 이번 CSV 안에서 겹치는 이름을 모두 걸러낸다
    const batchNames = new Set<string>()
    const targets: ResolvedPlace[] = []
    const dupInDay = new Set<string>()
    const dupInFile = new Set<string>()

    for (const place of toImport) {
      if (existingNames.has(place.name)) {
        dupInDay.add(place.id)
      } else if (batchNames.has(place.name)) {
        dupInFile.add(place.id)
      } else {
        batchNames.add(place.name)
        targets.push(place)
      }
    }

    const skipped = dupInDay.size + dupInFile.size
    if (skipped > 0) {
      // 중복 행은 선택을 풀고 이유를 표시해 계속 걸리지 않게 한다
      setParsedPlaces(prev => prev.map(p => {
        if (dupInDay.has(p.id)) return { ...p, duplicate: 'day' as const, selected: false, addError: false }
        if (dupInFile.has(p.id)) return { ...p, duplicate: 'file' as const, selected: false, addError: false }
        return p
      }))
    }

    if (targets.length === 0) {
      setBanner({ tone: 'info', text: t('allDuplicates', { count: toImport.length }) })
      setImporting(false)
      setImportProgress({ current: 0, total: 0 })
      return
    }

    setImportProgress({ current: 0, total: targets.length })

    const { data: lastPlaces, error: lastError } = await supabase
      .from('places')
      .select('order_key')
      .eq('day_id', selectedDayId)
      .order('order_key', { ascending: false })
      .limit(1)

    if (lastError) {
      setBanner({ tone: 'error', text: t('addAllFailed') })
      setImporting(false)
      setImportProgress({ current: 0, total: 0 })
      return
    }

    // order_key 는 배치 전체에 걸쳐 순서대로 이어 붙인다
    let lastKey = lastPlaces?.[0]?.order_key ?? null
    const rows = targets.map(place => {
      const newKey = generateKeyBetween(lastKey, null)
      lastKey = newKey
      return {
        day_id: selectedDayId,
        order_key: newKey,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        memo: place.memo || null,
      }
    })

    // 한 건씩 보내면 60개에 60번 왕복하므로 묶어서 보낸다
    const addedIds = new Set<string>()
    const failedIds = new Set<string>()

    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE)
      const chunkIds = targets.slice(i, i + INSERT_CHUNK_SIZE).map(p => p.id)

      const { error } = await supabase.from('places').insert(chunk)

      // 실패를 성공으로 표시하면 다시 시도할 방법이 없어지므로 결과를 반드시 본다
      for (const id of chunkIds) {
        if (error) failedIds.add(id)
        else addedIds.add(id)
      }

      setImportProgress({ current: Math.min(i + INSERT_CHUNK_SIZE, rows.length), total: rows.length })
    }

    // 실제로 저장된 행만 추가됨으로 표시한다
    setParsedPlaces(prev => prev.map(p => {
      if (addedIds.has(p.id)) {
        return { ...p, added: true, addedToDay: dayLabel, selected: false, addError: false, duplicate: null }
      }
      if (failedIds.has(p.id)) return { ...p, addError: true }
      return p
    }))

    const skippedNote = skipped > 0 ? ` ${t('skippedDuplicates', { count: skipped })}` : ''
    if (addedIds.size === 0) {
      setBanner({ tone: 'error', text: t('addAllFailed') })
    } else if (failedIds.size > 0) {
      setBanner({
        tone: 'error',
        text: t('addPartialFailure', { added: addedIds.size, failed: failedIds.size }) + skippedNote,
      })
    } else {
      setBanner({
        tone: 'success',
        text: t('addSuccess', { count: addedIds.size, day: dayLabel }) + skippedNote,
      })
    }

    setImporting(false)
    setImportProgress({ current: 0, total: 0 })
  }

  const busy = resolving || importing
  const selectableCount = parsedPlaces.filter(p => !p.added).length
  const selectedCount = parsedPlaces.filter(p => p.selected && !p.added).length
  // 버튼에 적는 수는 실제로 검색을 보낼 행 수와 같아야 한다 (resolveSelected 와 같은 조건)
  const resolvableCount = parsedPlaces.filter(p => p.selected && needsCoords(p)).length
  const needsResolve = resolvableCount > 0
  const importableCount = parsedPlaces.filter(p => p.selected && !p.added && hasCoords(p)).length
  const failedCount = parsedPlaces.filter(p => !p.added && p.status === 'failed').length
  const allSelected = parsedPlaces.filter(p => !p.added).every(p => p.selected)
  // 좌표를 못 찾았거나(더 할 일 없음) 이미 추가된 행만 남았을 때가 진짜 완료다
  const allDone = parsedPlaces.length > 0 && parsedPlaces.every(p =>
    p.added || p.status === 'notFound' || p.duplicate !== null)

  const bannerTone: Record<BannerTone, string> = {
    success: 'bg-green-50 text-green-600',
    error: 'bg-red-50 text-red-600',
    info: 'bg-gray-50 text-gray-600',
  }

  const header = (
    <header className="flex items-center gap-3 px-4 pb-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
      <Link href={`/trip/${tripId}`} aria-label={tNav('back')} className="text-gray-400 text-lg">&#8249;</Link>
      <h1 className="text-base font-semibold">{t('title')}</h1>
    </header>
  )

  // 날짜가 하나도 없으면 추가할 곳이 없다 — 이유를 알려준다
  if (days.length === 0) {
    return (
      <main className="flex flex-col h-full">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-sm text-gray-500">{t('noDays')}</p>
          <p className="text-xs text-gray-400">{t('noDaysHint')}</p>
          <Link
            href={`/trip/${tripId}`}
            className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            {t('backToTrip')}
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-col h-full">
      {header}

      <div className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto pb-4">
        {/* 파일 업로드 */}
        <div>
          <label htmlFor="csv-file" className="text-xs text-gray-500">{t('csvSelect')}</label>
          <input
            id="csv-file"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            disabled={busy}
            className="w-full mt-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white disabled:opacity-50"
          />
        </div>

        {/* 알림 배너 */}
        {banner && (
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${bannerTone[banner.tone]}`}>
            <p className="flex-1">{banner.text}</p>
            <button
              type="button"
              onClick={() => setBanner(null)}
              aria-label={tCommon('close')}
              className="shrink-0 leading-none opacity-60"
            >
              &#215;
            </button>
          </div>
        )}

        {parsed && parsedPlaces.length === 0 && (
          <p className="text-xs text-gray-400">{t('emptyCsv')}</p>
        )}

        {parsedPlaces.length > 0 && (
          <>
            {/* Day 선택 + 전체 선택/해제 */}
            <div className="flex items-center gap-2">
              <select
                value={selectedDayId}
                disabled={busy}
                onChange={(e) => {
                  setSelectedDayId(e.target.value)
                  // 중복 표시는 날짜별 판정이라 날짜가 바뀌면 지운다
                  setParsedPlaces(prev => prev.map(p =>
                    p.duplicate === 'day' ? { ...p, duplicate: null } : p))
                }}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm disabled:opacity-50"
              >
                {days.map((day, i) => (
                  <option key={day.id} value={day.id}>
                    {`${tCommon('dayLabel', { n: i + 1 })} - ${formatDayDate(format, day.date)}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setParsedPlaces(prev => {
                    const everySelected = prev.filter(p => !p.added).every(p => p.selected)
                    return prev.map(p => p.added ? p : { ...p, selected: !everySelected })
                  })
                }}
                className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 disabled:opacity-50"
              >
                {allSelected ? t('deselectAll') : t('selectAll')}
              </button>
            </div>

            {/* 액션 버튼 */}
            {(selectedCount > 0 || resolving) && (
              <div className="flex gap-2">
                {needsResolve && (
                  <button
                    type="button"
                    onClick={resolveSelected}
                    disabled={busy}
                    className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {resolving
                      ? t('resolving', { current: progress.current, total: progress.total })
                      : t('resolveCoords', { count: resolvableCount })}
                  </button>
                )}
                {resolving && (
                  <button
                    type="button"
                    onClick={cancelResolve}
                    className="shrink-0 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-600"
                  >
                    {tCommon('cancel')}
                  </button>
                )}
                {importableCount > 0 && (
                  <button
                    type="button"
                    onClick={addSelectedToDay}
                    disabled={busy}
                    className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {importing
                      ? (importProgress.total > 0
                          ? t('addingProgress', { current: importProgress.current, total: importProgress.total })
                          : t('adding'))
                      : t('addItems', { count: importableCount })}
                  </button>
                )}
              </div>
            )}

            {/* 일시 오류로 실패한 행 재시도 */}
            {failedCount > 0 && !busy && (
              <button
                type="button"
                onClick={retryFailed}
                className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600"
              >
                {t('retryFailed', { count: failedCount })}
              </button>
            )}

            {/* 완료 버튼 */}
            {allDone && !busy && (
              <button
                type="button"
                onClick={() => router.push(`/trip/${tripId}`)}
                className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white"
              >
                {t('finish')}
              </button>
            )}

            {/* 장소 리스트 */}
            <p className="text-xs text-gray-400">
              {t('selectionStatus', { total: selectableCount, selected: selectedCount })}
              {parsedPlaces.some(p => p.added) && ` · ${t('addedCount', { count: parsedPlaces.filter(p => p.added).length })}`}
            </p>
            <div className="flex flex-col divide-y divide-gray-50">
              {parsedPlaces.map(place => (
                <div
                  key={place.id}
                  className={`flex items-center gap-3 py-2 ${place.added ? 'opacity-40' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={place.selected}
                    disabled={place.added || busy}
                    aria-label={t('selectPlace', { name: place.name })}
                    onChange={() => {
                      setParsedPlaces(prev => prev.map(p =>
                        p.id === place.id && !p.added ? { ...p, selected: !p.selected } : p))
                    }}
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{place.name}</p>
                    {place.memo && <p className="text-xs text-gray-400 truncate">{place.memo}</p>}
                    {place.added ? (
                      <p className="text-xs text-blue-500">{t('addedToDay', { day: place.addedToDay })}</p>
                    ) : place.addError ? (
                      <p className="text-xs text-red-500">{t('addFailedRow')}</p>
                    ) : place.duplicate === 'day' ? (
                      <p className="text-xs text-amber-500">{t('duplicateInDay')}</p>
                    ) : place.duplicate === 'file' ? (
                      <p className="text-xs text-amber-500">{t('duplicateInFile')}</p>
                    ) : hasCoords(place) ? (
                      <p className="text-xs text-green-500 truncate">&#10003; {place.address}</p>
                    ) : place.status === 'notFound' ? (
                      <p className="text-xs text-red-400">{t('coordsNotFound')}</p>
                    ) : place.status === 'failed' ? (
                      <p className="text-xs text-red-400">{t('resolveFailedRow')}</p>
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
