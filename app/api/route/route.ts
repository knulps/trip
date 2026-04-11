import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 503 })

  const { origin, destination, mode } = await req.json() as {
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
    mode: 'TRANSIT' | 'DRIVE' | 'WALK'
  }

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: mode,
      }),
    })

    const data = await res.json() as { routes?: Array<{ polyline?: { encodedPolyline?: string }; duration?: string; distanceMeters?: number }> }
    const route = data.routes?.[0]

    if (route?.polyline?.encodedPolyline) {
      return NextResponse.json({
        encodedPolyline: route.polyline.encodedPolyline,
        duration: route.duration,
        distanceMeters: route.distanceMeters,
      })
    }
  } catch { /* fall through */ }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
