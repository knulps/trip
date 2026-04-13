import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 503 })

  const { origin, destination } = await req.json() as {
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
  }

  const modes = ['TRANSIT', 'DRIVE', 'WALK'] as const

  // Fetch all modes in parallel
  const results = await Promise.all(
    modes.map(async (travelMode) => {
      try {
        const res = await fetch(
          'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status',
            },
            body: JSON.stringify({
              origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
              destinations: [{ waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } } }],
              travelMode,
            }),
          }
        )
        const data: unknown = await res.json()
        const element = Array.isArray(data) ? (data[0] as { status?: string; duration?: string; distanceMeters?: number } | undefined) : null

        if (element && element.duration) {
          const seconds = parseInt(element.duration.replace('s', ''), 10)
          const minutes = Math.round(seconds / 60)
          const distanceM = element.distanceMeters ?? 0
          const distance = distanceM >= 1000
            ? `${(distanceM / 1000).toFixed(1)}km`
            : `${distanceM}m`
          const icon = travelMode === 'TRANSIT' ? '🚌' : travelMode === 'DRIVE' ? '🚕' : '🚶'
          return { mode: travelMode, minutes, distance, icon }
        }
      } catch { /* skip failed mode */ }
      return null
    })
  )

  const validResults = results.filter(Boolean)
  if (validResults.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 도보 10분 미만이고 대중교통이 도보보다 느리면 대중교통 제거
  const walkResult = validResults.find(r => r?.mode === 'WALK')
  const filteredResults = walkResult && walkResult.minutes < 10
    ? validResults.filter(r => !(r?.mode === 'TRANSIT' && r.minutes >= walkResult.minutes))
    : validResults

  return NextResponse.json({ results: filteredResults })
}
