import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const origin = new URL(request.url).origin

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // 미인증: 토큰을 쿠키에 저장하고 로그인으로
  if (!user) {
    const response = NextResponse.redirect(`${origin}/login`)
    response.cookies.set('invite_token', token, {
      httpOnly: true,
      maxAge: 60 * 10, // 10분
      sameSite: 'lax',
    })
    return response
  }

  // 토큰으로 여행 조회
  const serviceSupabase = createServiceClient()
  const { data: trip } = await serviceSupabase
    .from('trips')
    .select('id')
    .eq('invite_token', token)
    .single()

  if (!trip) {
    return NextResponse.redirect(`${origin}/?error=invalid_invite`)
  }

  // 이미 멤버인지 확인
  const { data: existing } = await serviceSupabase
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    await serviceSupabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: user.id,
      role: 'member',
    })
  }

  return NextResponse.redirect(`${origin}/trip/${trip.id}`)
}
