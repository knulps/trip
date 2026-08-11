import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, parseLatLng, readJsonObject, requireUser } from '@/lib/api-auth'

const FETCH_TIMEOUT_MS = 6000
const MAX_REDIRECTS = 3
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_NAME_LENGTH = 200
const MAX_URL_LENGTH = 2048

// SSRF 방지: 직접 fetch 를 허용할 호스트 목록 (hostname 완전 일치로만 비교)
const ALLOWED_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'goo.gl',
  'maps.app.goo.gl',
  'g.co',
])
// google.co.kr, maps.google.co.jp 같은 국가별 도메인.
// 정규식으로 뒷부분을 뭉뚱그리면(예: google\.[a-z.]{2,6}) 점까지 함께 매칭되어
// google.xyz.io 처럼 공격자가 가진 도메인의 하위 도메인도 통과한다.
// 그래서 실제 존재하는 국가 도메인만 목록으로 고정하고 완전 일치로만 비교한다.
const GOOGLE_TLDS = [
  'ad', 'ae', 'al', 'am', 'as', 'at', 'az', 'ba', 'be', 'bf', 'bg', 'bi', 'bj', 'bs', 'bt',
  'by', 'ca', 'cat', 'cd', 'cf', 'cg', 'ch', 'ci', 'cl', 'cm', 'cn', 'cv', 'cz', 'de', 'dj',
  'dk', 'dm', 'dz', 'ee', 'es', 'fi', 'fm', 'fr', 'ga', 'ge', 'gg', 'gl', 'gm', 'gr', 'gy',
  'hn', 'hr', 'ht', 'hu', 'ie', 'im', 'iq', 'is', 'it', 'je', 'jo', 'kg', 'ki', 'kz', 'la',
  'li', 'lk', 'lt', 'lu', 'lv', 'md', 'me', 'mg', 'mk', 'ml', 'mn', 'mu', 'mv', 'mw', 'ne',
  'nl', 'no', 'nr', 'nu', 'pl', 'pn', 'ps', 'pt', 'ro', 'rs', 'ru', 'rw', 'sc', 'se', 'sh',
  'si', 'sk', 'sm', 'sn', 'so', 'sr', 'st', 'td', 'tg', 'tl', 'tm', 'tn', 'to', 'tt', 'vu',
  'ws',
]
const GOOGLE_CO_TLDS = [
  'ao', 'bw', 'ck', 'cr', 'id', 'il', 'in', 'jp', 'ke', 'kr', 'ls', 'ma', 'mz', 'nz', 'th',
  'tz', 'ug', 'uk', 'uz', 've', 'vi', 'za', 'zm', 'zw',
]
const GOOGLE_COM_TLDS = [
  'af', 'ag', 'ar', 'au', 'bd', 'bh', 'bn', 'bo', 'br', 'bz', 'co', 'cu', 'cy', 'do', 'ec',
  'eg', 'et', 'fj', 'gh', 'gi', 'gt', 'hk', 'jm', 'kh', 'kw', 'lb', 'ly', 'mm', 'mt', 'mx',
  'my', 'na', 'ng', 'ni', 'np', 'om', 'pa', 'pe', 'pg', 'ph', 'pk', 'pr', 'py', 'qa', 'sa',
  'sb', 'sg', 'sl', 'sv', 'tj', 'tr', 'tw', 'ua', 'uy', 'vc', 'vn',
]
const GOOGLE_COUNTRY_HOSTS = new Set<string>([
  ...GOOGLE_TLDS.map(tld => `google.${tld}`),
  ...GOOGLE_CO_TLDS.map(tld => `google.co.${tld}`),
  ...GOOGLE_COM_TLDS.map(tld => `google.com.${tld}`),
])

/** hostname 이 허용 목록(고정 목록 또는 Google 국가 도메인)에 완전히 일치하는지 확인한다. */
function isAllowedHost(host: string): boolean {
  if (ALLOWED_HOSTS.has(host)) return true
  // www. / maps. 접두사 하나만 떼어 보고, 나머지가 국가 도메인 목록과 정확히 같아야 한다
  const bare = host.startsWith('www.')
    ? host.slice(4)
    : host.startsWith('maps.')
      ? host.slice(5)
      : host
  return GOOGLE_COUNTRY_HOSTS.has(bare)
}

/**
 * 허용된 Google 호스트의 https URL 인지 확인한다.
 * base 를 주면 상대 경로 Location 헤더도 해석한다. 허용되지 않으면 null.
 */
function allowedGoogleUrl(raw: string, base?: URL): URL | null {
  if (raw.length > MAX_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = base ? new URL(raw, base) : new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (isAllowedHost(parsed.hostname.toLowerCase())) return parsed
  return null
}

/** 응답 본문을 최대 MAX_BODY_BYTES 만큼만 읽는다 (거대한 응답으로 메모리가 터지지 않게). */
async function readCappedText(res: Response): Promise<string> {
  const body = res.body
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let received = 0
  try {
    while (received < MAX_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text
}

// 2차 단계의 결과. 실패했을 때 그것이 '이 링크로는 원래 안 되는 것'(transient: false)인지
// '이번 호출이 안 된 것'(transient: true)인지 구분한다.
// 구분하지 않으면 일시 장애가 3차까지 내려가 '좌표 없음'(404)으로 굳어 되살릴 수 없다.
type GooglePageResult =
  | { ok: true; finalUrl: string; html: string }
  | { ok: false; transient: boolean }

/**
 * Google 단축 링크는 리다이렉트되므로 hop 마다 수동으로 호스트를 다시 검사한다.
 * redirect: 'follow' 를 쓰면 검사 없이 임의 호스트로 끌려갈 수 있다.
 */
async function fetchGooglePage(start: URL): Promise<GooglePageResult> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return { ok: false, transient: false }
      const next = allowedGoogleUrl(location, current)
      // 허용 목록 밖으로 나가는 리다이렉트는 따라가지 않는다 (다시 시도해도 마찬가지다)
      if (!next) return { ok: false, transient: false }
      current = next
      continue
    }

    // 5xx 와 429 는 다시 시도하면 될 수 있다. 404 같은 응답은 재시도해도 같다.
    if (!res.ok) return { ok: false, transient: res.status >= 500 || res.status === 429 }
    return { ok: true, finalUrl: current.toString(), html: await readCappedText(res) }
  }
  return { ok: false, transient: false } // hop 초과
}

// Google Places API 가 HTTP 200 으로 내려보내는 실패 상태.
// '그런 장소가 없다'(ZERO_RESULTS)가 아니라 '이번 호출이 되지 않았다'는 뜻이라
// 못 찾음(404)이 아니라 재시도 대상으로 다뤄야 한다.
// REQUEST_DENIED 는 키에 Places API 가 안 켜져 있을 때도 나오는데,
// 그걸 못 찾음으로 기록하면 CSV 전체가 '좌표 없음'으로 굳어 되살릴 방법이 없어진다.
const RETRYABLE_PLACE_STATUSES = new Set([
  'OVER_QUERY_LIMIT',
  'REQUEST_DENIED',
  'UNKNOWN_ERROR',
])

interface PlaceDetailsResponse {
  status?: string
  result?: {
    geometry?: { location?: { lat: number; lng: number } }
    name?: string
    formatted_address?: string
  }
}

interface FindPlaceResponse {
  status?: string
  candidates?: Array<{
    geometry?: { location?: { lat: number; lng: number } }
    name?: string
    formatted_address?: string
  }>
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return errorResponse('no_key', 503)

  const body = await readJsonObject(req)
  if (!body.ok) return body.response

  const rawUrl = body.value.url
  const rawName = body.value.name
  if (typeof rawUrl !== 'string') return errorResponse('invalid_url', 400)
  if (typeof rawName !== 'string') return errorResponse('invalid_name', 400)

  // 길이 제한을 넘는 URL 은 400 이 아니라 '쓸 수 없는 URL' 로 본다.
  // 400 을 내면 그 행은 이름 검색까지 가 보지도 못하고 영영 못 살리는 행이 된다.
  const url = rawUrl.length > MAX_URL_LENGTH ? '' : rawUrl.trim()
  const name = rawName.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return errorResponse('invalid_name', 400)
  }

  // URL 이 비어 있거나 허용 목록 밖이면 '없는 것'으로 보고 이름 검색(3차)까지 내려간다.
  // 여기서 400 을 내면 http:// 링크나 열이 밀린 CSV 한 줄이 영영 못 살리는 행이 된다
  // (클라이언트는 400 을 '다시 시도해도 소용없음'으로 처리한다).
  const targetUrl = url.length > 0 ? allowedGoogleUrl(url) : null

  // Google 이 '없다'고 확답한 것과 호출 자체가 실패한 것을 구분한다.
  // 실패를 404 로 내리면 클라이언트가 '좌표 없음' 으로 영구 기록해 재시도 대상에서 빠진다.
  let callFailed = false

  // 1차: URL에서 CID 추출 후 Place Details API로 정확한 장소 조회
  const cidMatch = targetUrl ? url.match(/!1s0x[0-9a-fA-F]+:(0x[0-9a-fA-F]+)/) : null
  if (cidMatch) {
    try {
      const cidDecimal = BigInt(cidMatch[1]).toString()
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?cid=${cidDecimal}&fields=geometry,name,formatted_address&key=${apiKey}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      )

      if (!res.ok) {
        callFailed = true
      } else {
        const data = await res.json() as PlaceDetailsResponse
        if (data.status !== undefined && RETRYABLE_PLACE_STATUSES.has(data.status)) {
          callFailed = true
        }
        const location = data.status === 'OK' ? data.result?.geometry?.location : undefined
        const coords = parseLatLng(location)
        if (coords) {
          return NextResponse.json({
            lat: coords.lat,
            lng: coords.lng,
            name: data.result?.name ?? name,
            address: data.result?.formatted_address ?? '',
          })
        }
      }
    } catch {
      // 타임아웃·네트워크 오류·본문 파싱 실패 — 다음 단계로 넘어가되 실패했음은 기억한다
      callFailed = true
    }
  }

  // 2차: Google Maps URL을 직접 fetch해서 좌표 추출
  if (targetUrl) {
    try {
      const page = await fetchGooglePage(targetUrl)
      if (!page.ok) {
        if (page.transient) callFailed = true
      } else {
        // 최종 URL이나 HTML에서 @lat,lng 패턴 추출
        const urlCoords = page.finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
        const fromUrl = urlCoords
          ? parseLatLng({ lat: parseFloat(urlCoords[1]), lng: parseFloat(urlCoords[2]) })
          : null
        if (fromUrl) {
          return NextResponse.json({ lat: fromUrl.lat, lng: fromUrl.lng, name, address: '' })
        }

        // HTML 내 좌표 패턴 검색 (center=[lat,lng] 또는 [null,null,lat,lng])
        const htmlCoords = page.html.match(/\[null,null,(-?\d+\.\d{4,}),(-?\d+\.\d{4,})\]/)
        const fromHtml = htmlCoords
          ? parseLatLng({ lat: parseFloat(htmlCoords[1]), lng: parseFloat(htmlCoords[2]) })
          : null
        if (fromHtml) {
          return NextResponse.json({ lat: fromHtml.lat, lng: fromHtml.lng, name, address: '' })
        }
      }
    } catch {
      // 타임아웃·네트워크 오류 — 3차로 넘어가되 실패했음은 기억한다
      callFailed = true
    }
  }

  // 3차: 이름으로 검색 (최후 수단)
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name)}&inputtype=textquery&fields=geometry,name,formatted_address&key=${apiKey}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )

    if (!res.ok) {
      callFailed = true
    } else {
      const data = await res.json() as FindPlaceResponse
      if (data.status !== undefined && RETRYABLE_PLACE_STATUSES.has(data.status)) {
        callFailed = true
      }
      const place = data.status === 'OK' ? data.candidates?.[0] : undefined
      const coords = parseLatLng(place?.geometry?.location)
      if (place && coords) {
        return NextResponse.json({
          lat: coords.lat,
          lng: coords.lng,
          name: place.name ?? name,
          address: place.formatted_address ?? '',
        })
      }
    }
  } catch {
    callFailed = true
  }

  // 호출이 한 번이라도 실패했다면 '못 찾음' 이 아니다.
  // 재시도 가능한 503 으로 내려보내 클라이언트가 재시도 목록에 남기게 한다.
  if (callFailed) return errorResponse('upstream_error', 503)

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
