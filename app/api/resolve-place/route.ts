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
// google.co.kr, maps.google.co.jp 같은 국가별 도메인
const GOOGLE_COUNTRY_HOST = /^(www\.|maps\.)?google\.[a-z.]{2,6}$/

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
  const host = parsed.hostname.toLowerCase()
  if (ALLOWED_HOSTS.has(host) || GOOGLE_COUNTRY_HOST.test(host)) return parsed
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

  // URL 이 비어 있으면 이름 검색만 한다. 값이 있는데 Google 호스트가 아니면 거부.
  const targetUrl = url.length > 0 ? allowedGoogleUrl(url) : null
  if (url.length > 0 && !targetUrl) return errorResponse('invalid_url', 400)

  // 1차: URL에서 CID 추출 후 Place Details API로 정확한 장소 조회
  const cidMatch = url.match(/!1s0x[0-9a-fA-F]+:(0x[0-9a-fA-F]+)/)
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
