import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  INVITE_TOKEN_COOKIE,
  INVITE_TOKEN_MAX_AGE,
  isInviteToken,
} from '@/lib/invite'

// Postgres unique_violation — 두 탭에서 동시에 수락한 경우
const UNIQUE_VIOLATION = '23505'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const origin = new URL(request.url).origin

  if (!isInviteToken(token)) {
    return NextResponse.redirect(`${origin}/?error=invalid_invite`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 미인증: 토큰을 쿠키에 저장하고 로그인으로.
  // 쿼리에도 토큰을 남기는 이유 — 카카오톡 등 앱 내 브라우저에서 링크를 열면
  // 구글 OAuth 가 웹뷰를 막아 사용자가 "다른 브라우저로 열기"로 넘어가는데,
  // 이때 넘어가는 건 URL 뿐이고 쿠키는 앱 내 브라우저에 남는다.
  // URL 에 토큰이 있으면 바뀐 브라우저에서도 proxy 가 쿠키를 다시 심어 준다.
  if (!user) {
    const response = NextResponse.redirect(`${origin}/login?invite=${token}`)
    response.cookies.set(INVITE_TOKEN_COOKIE, token, {
      httpOnly: true,
      maxAge: INVITE_TOKEN_MAX_AGE,
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
