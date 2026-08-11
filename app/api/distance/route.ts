import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, parseLatLng, readJsonObject, requireUser, type LatLng } from '@/lib/api-auth'

const MODES = ['TRANSIT', 'DRIVE', 'WALK'] as const
type TravelMode = (typeof MODES)[number]

interface DistanceResult {
  mode: TravelMode
  minutes: number
  /** 원본 거리(미터). 단위·소수점 표기는 화면에서 로케일에 맞춰 만든다. */
  distanceMeters: number
  /**
   * @deprecated 예전 화면이 그대로 쓰던 표시용 문자열("1.2km").
   * 배포 도중 아직 열려 있는 화면이 깨지지 않도록 당분간만 함께 내려준다.
   * 새 화면은 distanceMeters 만 읽는다.
   */
  distance: string
  icon: string
}

// computeRouteMatrix 응답 배열의 원소 (RouteMatrixElement)
interface RouteMatrixElement {
  condition?: string
  status?: { code?: number; message?: string }
  duration?: string
  distanceMeters?: number
}

const FETCH_TIMEOUT_MS = 8000

// 같은 좌표를 다시 조회할 때 Google 과금이 반복되지 않도록 하는 캐시.
// 서버 인스턴스 메모리에만 존재한다 — 인스턴스마다 별도이고 재시작하면 사라진다.
// 캐시 키에 로케일이 없어도 되는 이유: 담기는 값이 로케일과 무관한 숫자(분·미터)뿐이고,
// 사람이 읽는 표기는 화면에서 만든다. (로케일별 문자열을 여기 담으면 키에 로케일이 빠져
//  한국어 사용자에게 영어 표기가 그대로 나갈 수 있다)
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 500
const distanceCache = new Map<string, { expiresAt: number; result: DistanceResult | null }>()

function makeCacheKey(origin: LatLng, destination: LatLng, mode: TravelMode): string {
  const r = (n: number) => n.toFixed(5)
  return `${r(origin.lat)},${r(origin.lng)}|${r(destination.lat)},${r(destination.lng)}|${mode}`
}

function cacheGet(key: string): { result: DistanceResult | null } | undefined {
  const hit = distanceCache.get(key)
  if (!hit) return undefined
  if (hit.expiresAt <= Date.now()) {
    distanceCache.delete(key)
    return undefined
  }
  return hit
}

function cacheSet(key: string, result: DistanceResult | null): void {
  // 재삽입해서 삽입 순서를 갱신 — Map 은 삽입 순서를 유지하므로 맨 앞이 가장 오래된 항목
  distanceCache.delete(key)
  distanceCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result })
  while (distanceCache.size > CACHE_MAX_ENTRIES) {
    const oldest = distanceCache.keys().next()
    if (oldest.done) break
    distanceCache.delete(oldest.value)
  }
}

/**
 * 응답에서 첫 번째 element 를 꺼낸다.
 * 정상 응답은 배열이지만, 요청 자체가 거부되면 { error: {...} } 객체가 온다.
 */
function pickElement(data: unknown): RouteMatrixElement | null {
  if (!Array.isArray(data)) return null
  const first: unknown = data[0]
  if (typeof first !== 'object' || first === null) return null
  return first as RouteMatrixElement
}

/**
 * mode 하나를 조회한다.
 * cacheable=true 는 "Google 이 확정 답을 줬다"는 뜻 — 결과가 null 이어도 캐시한다.
 * 네트워크 오류·타임아웃처럼 일시적 실패는 cacheable=false 로 두어 다음에 다시 시도한다.
 */
async function fetchMode(
  apiKey: string,
  origin: LatLng,
  destination: LatLng,
  travelMode: TravelMode
): Promise<{ cacheable: boolean; result: DistanceResult | null }> {
  try {
    const res = await fetch(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'originIndex,destinationIndex,duration,distanceMeters,status,condition',
        },
        body: JSON.stringify({
          origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
          destinations: [{ waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } } }],
          travelMode,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    )

    // 4xx/5xx 는 이 mode 만 실패한 것으로 처리한다 (전체 요청을 깨뜨리지 않음)
    if (!res.ok) return { cacheable: false, result: null }

    const data: unknown = await res.json()
    const element = pickElement(data)
    if (!element) return { cacheable: false, result: null }

    // ROUTE_NOT_FOUND 등은 경로가 없다는 확정 답이므로 결과로 내보내지 않는다
    if (element.condition !== undefined && element.condition !== 'ROUTE_EXISTS') {
      return { cacheable: true, result: null }
    }
    // status 는 google.rpc.Status — 정상일 때는 비어 있고, code 가 있으면 오류다
    if (typeof element.status?.code === 'number' && element.status.code !== 0) {
      return { cacheable: true, result: null }
    }
    if (typeof element.duration !== 'string') {
      return { cacheable: true, result: null }
    }

    const seconds = Number.parseInt(element.duration.replace('s', ''), 10)
    if (!Number.isFinite(seconds)) return { cacheable: true, result: null }

    const minutes = Math.round(seconds / 60)
    const distanceMeters = typeof element.distanceMeters === 'number' ? element.distanceMeters : 0
    const distance = distanceMeters >= 1000
      ? `${(distanceMeters / 1000).toFixed(1)}km`
      : `${distanceMeters}m`
    const icon = travelMode === 'TRANSIT' ? '🚌' : travelMode === 'DRIVE' ? '🚕' : '🚶'

    return { cacheable: true, result: { mode: travelMode, minutes, distanceMeters, distance, icon } }
  } catch {
    // 타임아웃·네트워크 오류 → 이 mode 만 건너뛴다
    return { cacheable: false, result: null }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return errorResponse('no_key', 503)

  const body = await readJsonObject(req)
  if (!body.ok) return body.response

  const origin = parseLatLng(body.value.origin)
  const destination = parseLatLng(body.value.destination)
  if (!origin || !destination) return errorResponse('invalid_coordinates', 400)

  // Fetch all modes in parallel
  const results = await Promise.all(
    MODES.map(async (travelMode) => {
      const key = makeCacheKey(origin, destination, travelMode)
      const cached = cacheGet(key)
      if (cached) return cached.result

      const { cacheable, result } = await fetchMode(apiKey, origin, destination, travelMode)
      if (cacheable) cacheSet(key, result)
      return result
    })
  )

  const validResults = results.filter((r): r is DistanceResult => r !== null)
  if (validResults.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 도보 10분 미만이고 대중교통이 도보보다 느리면 대중교통 제거
  const walkResult = validResults.find(r => r.mode === 'WALK')
  const filteredResults = walkResult && walkResult.minutes < 10
    ? validResults.filter(r => !(r.mode === 'TRANSIT' && r.minutes >= walkResult.minutes))
    : validResults

  return NextResponse.json({ results: filteredResults })
}
