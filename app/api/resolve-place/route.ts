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

/**
 * Google 단축 링크는 리다이렉트되므로 hop 마다 수동으로 호스트를 다시 검사한다.
 * redirect: 'follow' 를 쓰면 검사 없이 임의 호스트로 끌려갈 수 있다.
 */
async function fetchGooglePage(start: URL): Promise<{ finalUrl: string; html: string } | null> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return null
      const next = allowedGoogleUrl(location, current)
      if (!next) return null // 허용 목록 밖으로 나가는 리다이렉트는 따라가지 않는다
      current = next
      continue
    }

    if (!res.ok) return null
    return { finalUrl: current.toString(), html: await readCappedText(res) }
  }
  return null
}

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
  if (typeof rawUrl !== 'string' || rawUrl.length > MAX_URL_LENGTH) {
    return errorResponse('invalid_url', 400)
  }
  if (typeof rawName !== 'string') return errorResponse('invalid_name', 400)

  const url = rawUrl.trim()
  const name = rawName.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return errorResponse('invalid_name', 400)
  }

  // URL 이 비어 있거나 허용 목록 밖이면 '없는 것'으로 보고 이름 검색(3차)까지 내려간다.
  // 여기서 400 을 내면 http:// 링크나 열이 밀린 CSV 한 줄이 영영 못 살리는 행이 된다
  // (클라이언트는 400 을 '다시 시도해도 소용없음'으로 처리한다).
  const targetUrl = url.length > 0 ? allowedGoogleUrl(url) : null

  // 1차: URL에서 CID 추출 후 Place Details API로 정확한 장소 조회
  const cidMatch = targetUrl ? url.match(/!1s0x[0-9a-fA-F]+:(0x[0-9a-fA-F]+)/) : null
  if (cidMatch) {
    try {
      const cidDecimal = BigInt(cidMatch[1]).toString()
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?cid=${cidDecimal}&fields=geometry,name,formatted_address&key=${apiKey}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
      )

      if (res.ok) {
        const data = await res.json() as PlaceDetailsResponse
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
    } catch { /* fallback */ }
  }

  // 2차: Google Maps URL을 직접 fetch해서 좌표 추출
  if (targetUrl) {
    try {
      const page = await fetchGooglePage(targetUrl)
      if (page) {
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
    } catch { /* fallback */ }
  }

  // 3차: 이름으로 검색 (최후 수단)
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name)}&inputtype=textquery&fields=geometry,name,formatted_address&key=${apiKey}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    )

    if (res.ok) {
      const data = await res.json() as FindPlaceResponse
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
  } catch { /* ignore */ }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
