import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 503 })

  const { url, name } = await req.json() as { url: string; name: string }

  // 1차: URL에서 CID 추출 후 Place Details API로 정확한 장소 조회
  const cidMatch = url.match(/!1s0x[0-9a-fA-F]+:(0x[0-9a-fA-F]+)/)
  if (cidMatch) {
    try {
      const cidDecimal = BigInt(cidMatch[1]).toString()
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?cid=${cidDecimal}&fields=geometry,name,formatted_address&key=${apiKey}`
      )
      const data = await res.json() as {
        status?: string
        result?: {
          geometry?: { location?: { lat: number; lng: number } }
          name?: string
          formatted_address?: string
        }
      }

      if (data.status === 'OK' && data.result?.geometry?.location) {
        return NextResponse.json({
          lat: data.result.geometry.location.lat,
          lng: data.result.geometry.location.lng,
          name: data.result.name ?? name,
          address: data.result.formatted_address ?? '',
        })
      }
    } catch { /* fallback */ }
  }

  // 2차: Google Maps URL을 직접 fetch해서 좌표 추출
  if (url.includes('google.com/maps')) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
        redirect: 'follow',
      })
      const html = await res.text()

      // 응답 URL이나 HTML에서 @lat,lng 패턴 추출
      const finalUrl = res.url
      const urlCoords = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
      if (urlCoords) {
        return NextResponse.json({
          lat: parseFloat(urlCoords[1]),
          lng: parseFloat(urlCoords[2]),
          name,
          address: '',
        })
      }

      // HTML 내 좌표 패턴 검색 (center=[lat,lng] 또는 [null,null,lat,lng])
      const htmlCoords = html.match(/\[null,null,(-?\d+\.\d{4,}),(-?\d+\.\d{4,})\]/)
      if (htmlCoords) {
        return NextResponse.json({
          lat: parseFloat(htmlCoords[1]),
          lng: parseFloat(htmlCoords[2]),
          name,
          address: '',
        })
      }
    } catch { /* fallback */ }
  }

  // 3차: 이름으로 검색 (최후 수단)
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(name)}&inputtype=textquery&fields=geometry,name,formatted_address&key=${apiKey}`
    )
    const data = await res.json() as {
      status?: string
      candidates?: Array<{
        geometry?: { location?: { lat: number; lng: number } }
        name?: string
        formatted_address?: string
      }>
    }

    if (data.status === 'OK' && data.candidates?.[0]?.geometry?.location) {
      const place = data.candidates[0]
      return NextResponse.json({
        lat: place.geometry!.location!.lat,
        lng: place.geometry!.location!.lng,
        name: place.name ?? name,
        address: place.formatted_address ?? '',
      })
    }
  } catch { /* ignore */ }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
