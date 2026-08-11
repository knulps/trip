import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// invite_token 컬럼이 uuid 타입이라 형식이 맞지 않으면 Postgres가 에러를 낸다
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Postgres unique_violation — 두 탭에서 동시에 수락한 경우
const UNIQUE_VIOLATION = '23505'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const origin = new URL(request.url).origin

  if (!UUID_PATTERN.test(token)) {
    return NextResponse.redirect(`${origin}/?error=invalid_invite`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 미인증: 토큰을 쿠키에 저장하고 로그인으로
  if (!user) {
    const response = NextResponse.redirect(`${origin}/login`)
    response.cookies.set('invite_token', token, {
      httpOnly: true,
      maxAge: 60 * 10, // 10분
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })
    return response
  }

  // 토큰으로 여행 조회
  const serviceSupabase = createServiceClient()
  const { data: trip } = await serviceSupabase
    .from('trips')
    .select('id')
    .eq('invite_token', token)
    .maybeSingle()

  if (!trip) {
    return NextResponse.redirect(`${origin}/?error=invalid_invite`)
  }

  // 이미 멤버인지 확인
  const { data: existing } = await serviceSupabase
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    const { error: insertError } = await serviceSupabase
      .from('trip_members')
      .insert({
        trip_id: trip.id,
        user_id: user.id,
        role: 'member',
      })

    // 중복 키는 이미 멤버가 된 것이므로 성공으로 처리
    if (insertError && insertError.code !== UNIQUE_VIOLATION) {
      return NextResponse.redirect(`${origin}/?error=invite_failed`)
    }
  }

  return NextResponse.redirect(`${origin}/trip/${trip.id}`)
}
