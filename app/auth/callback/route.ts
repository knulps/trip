import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error') ?? searchParams.get('error_description')

  // OAuth provider가 에러를 실어 보낸 경우 (사용자 거부, 설정 오류 등)
  if (oauthError) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  // 초대 토큰 처리: 쿠키에 저장된 invite_token이 있으면 초대 수락 라우트로
  const inviteToken = request.cookies.get('invite_token')?.value
  if (inviteToken) {
    const response = NextResponse.redirect(`${origin}/invite/${inviteToken}`)
    response.cookies.delete({ name: 'invite_token', path: '/' })
    return response
  }

  return NextResponse.redirect(`${origin}/`)
}
