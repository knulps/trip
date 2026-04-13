import { NextRequest, NextResponse } from 'next/server'

interface TransitStep {
  vehicle: string
  lineName: string
  lineShort: string
  color: string
  departureStop: string
  arrivalStop: string
  stopCount: number
}

interface GoogleTransitDetails {
  stopDetails?: {
    arrivalStop?: { name?: string }
    departureStop?: { name?: string }
  }
  transitLine?: {
    name?: string
    nameShort?: string
    vehicle?: { type?: string }
    color?: string
  }
  stopCount?: number
}

interface GoogleStep {
  transitDetails?: GoogleTransitDetails
}

interface GoogleLeg {
  steps?: GoogleStep[]
}

interface GoogleRoute {
  polyline?: { encodedPolyline?: string }
  duration?: string
  distanceMeters?: number
  legs?: GoogleLeg[]
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return NextResponse.json({ error: 'no_key' }, { status: 503 })

  const { origin, destination, mode } = await req.json() as {
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
    mode: 'TRANSIT' | 'DRIVE' | 'WALK'
  }

  const fieldMask = mode === 'TRANSIT'
    ? 'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters,routes.legs.steps.transitDetails'
    : 'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters'

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: mode,
        ...(mode === 'TRANSIT' && {
          computeAlternativeRoutes: false,
          departureTime: new Date().toISOString(),
        }),
      }),
    })

    const data = await res.json() as { routes?: GoogleRoute[] }
    const route = data.routes?.[0]

    if (route?.polyline?.encodedPolyline) {
      const result: {
        encodedPolyline: string
        duration: string | undefined
        distanceMeters: number | undefined
        transitSteps?: TransitStep[]
      } = {
        encodedPolyline: route.polyline.encodedPolyline,
        duration: route.duration,
        distanceMeters: route.distanceMeters,
      }

      if (mode === 'TRANSIT' && route.legs) {
        const transitSteps: TransitStep[] = []
        for (const leg of route.legs) {
          for (const step of leg.steps ?? []) {
            const td = step.transitDetails
            if (!td) continue
            transitSteps.push({
              vehicle: td.transitLine?.vehicle?.type ?? 'BUS',
              lineName: td.transitLine?.name ?? '',
              lineShort: td.transitLine?.nameShort ?? '',
              color: td.transitLine?.color ?? '#6b7280',
              departureStop: td.stopDetails?.departureStop?.name ?? '',
              arrivalStop: td.stopDetails?.arrivalStop?.name ?? '',
              stopCount: td.stopCount ?? 0,
            })
          }
        }
        if (transitSteps.length > 0) {
          result.transitSteps = transitSteps
        }
      }

      return NextResponse.json(result)
    }
  } catch { /* fall through */ }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
