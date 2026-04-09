import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 503 })

  const { origin, destination } = await req.json() as {
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
  }

  // Try modes in order: TRANSIT → DRIVE → WALK
  const modes = ['TRANSIT', 'DRIVE', 'WALK'] as const

  for (const travelMode of modes) {
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

      if (element && element.status === 'OK' && element.duration) {
        const seconds = parseInt(element.duration.replace('s', ''), 10)
        const minutes = Math.round(seconds / 60)
        const distanceM = element.distanceMeters ?? 0
        const distance = distanceM >= 1000
          ? `${(distanceM / 1000).toFixed(1)}km`
          : `${distanceM}m`

        const modeIcon = travelMode === 'TRANSIT' ? '🚌' : travelMode === 'DRIVE' ? '🚕' : '🚶'

        return NextResponse.json({ minutes, distance, mode: travelMode, icon: modeIcon })
      }
    } catch {
      // try next mode
    }
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
