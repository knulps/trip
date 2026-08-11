import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, parseLatLng, readJsonObject, requireUser } from '@/lib/api-auth'

const FETCH_TIMEOUT_MS = 8000

const MODES = ['TRANSIT', 'DRIVE', 'WALK'] as const
type TravelMode = (typeof MODES)[number]

function parseMode(input: unknown): TravelMode | null {
  return MODES.includes(input as TravelMode) ? (input as TravelMode) : null
}

interface RouteSegment {
  type: 'WALK' | 'TRANSIT'
  encodedPolyline: string
  vehicle?: string
  lineName?: string
  lineShort?: string
  color?: string
  departureStop?: string
  arrivalStop?: string
  stopCount?: number
  startLat?: number
  startLng?: number
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
  polyline?: { encodedPolyline?: string }
  travelMode?: string
  startLocation?: { latLng?: { latitude?: number; longitude?: number } }
  endLocation?: { latLng?: { latitude?: number; longitude?: number } }
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
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return errorResponse('no_key', 503)

  const body = await readJsonObject(req)
  if (!body.ok) return body.response

  const origin = parseLatLng(body.value.origin)
  const destination = parseLatLng(body.value.destination)
  if (!origin || !destination) return errorResponse('invalid_coordinates', 400)

  const mode = parseMode(body.value.mode)
  if (!mode) return errorResponse('invalid_mode', 400)

  const fieldMask = mode === 'TRANSIT'
    ? 'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters,routes.legs.steps.transitDetails,routes.legs.steps.polyline,routes.legs.steps.travelMode,routes.legs.steps.startLocation,routes.legs.steps.endLocation'
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    // 4xx/5xx 는 파싱하지 않고 not_found 로 떨어뜨린다
    if (!res.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const data = await res.json() as { routes?: GoogleRoute[] }
    const route = data.routes?.[0]

    if (route?.polyline?.encodedPolyline) {
      const result: {
        encodedPolyline: string
        duration: string | undefined
        distanceMeters: number | undefined
        routeSegments?: RouteSegment[]
      } = {
        encodedPolyline: route.polyline.encodedPolyline,
        duration: route.duration,
        distanceMeters: route.distanceMeters,
      }

      if (mode === 'TRANSIT' && route.legs) {
        const routeSegments: RouteSegment[] = []
        for (const leg of route.legs) {
          for (const step of leg.steps ?? []) {
            const stepPolyline = step.polyline?.encodedPolyline
            if (!stepPolyline) continue

            if (step.transitDetails) {
              const td = step.transitDetails
              routeSegments.push({
                type: 'TRANSIT',
                encodedPolyline: stepPolyline,
                vehicle: td.transitLine?.vehicle?.type ?? 'BUS',
                lineName: td.transitLine?.name ?? '',
                lineShort: td.transitLine?.nameShort ?? '',
                color: td.transitLine?.color ?? '#6b7280',
                departureStop: td.stopDetails?.departureStop?.name ?? '',
                arrivalStop: td.stopDetails?.arrivalStop?.name ?? '',
                stopCount: td.stopCount ?? 0,
                startLat: step.startLocation?.latLng?.latitude,
                startLng: step.startLocation?.latLng?.longitude,
              })
            } else {
              routeSegments.push({
                type: 'WALK',
                encodedPolyline: stepPolyline,
              })
            }
          }
        }
        if (routeSegments.length > 0) {
          result.routeSegments = routeSegments
        }
      }

      return NextResponse.json(result)
    }
  } catch { /* fall through */ }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
