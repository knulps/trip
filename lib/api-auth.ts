import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * API route 공통 가드 결과.
 * ok=false 면 호출부는 response 를 그대로 return 하면 된다.
 */
export type GuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse }

export function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status })
}

/**
 * 로그인한 Supabase 사용자만 통과시킨다.
 * Google 유료 API 를 대신 호출하는 route 는 모두 이 함수를 먼저 거친다.
 */
export async function requireUser(): Promise<GuardResult<string>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) {
      return { ok: false, response: errorResponse('unauthorized', 401) }
    }
    return { ok: true, value: data.user.id }
  } catch {
    // Supabase 설정 오류나 쿠키 파싱 실패도 인증 실패로 처리한다 (열어두지 않는다)
    return { ok: false, response: errorResponse('unauthorized', 401) }
  }
}

/** 요청 본문을 JSON 객체로 읽는다. 본문이 깨졌거나 객체가 아니면 400. */
export async function readJsonObject(
  req: Request
): Promise<GuardResult<Record<string, unknown>>> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return { ok: false, response: errorResponse('invalid_json', 400) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: errorResponse('invalid_body', 400) }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

export interface LatLng {
  lat: number
  lng: number
}

/** {lat, lng} 형태이고 값이 유효 범위 안인지 확인한다. 아니면 null. */
export function parseLatLng(input: unknown): LatLng | null {
  if (typeof input !== 'object' || input === null) return null
  const { lat, lng } = input as { lat?: unknown; lng?: unknown }
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null
  return { lat, lng }
}
