import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { INVITE_TOKEN_COOKIE, normalizeInviteToken } from '@/lib/invite'

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

  // 초대 토큰 처리: 쿠키에 저장된 invite_token이 있으면 초대 수락 라우트로.
  // 주소에 끼워 넣기 전에 형식을 확인하고 소문자로 맞춘다 — 초대 토큰은 값을 받는 자리마다
  // 한 번 맞춰 두는 것이 규칙이다 (lib/invite.ts 참고). 여기서 맞추면 형식에 맞지 않는
  // 값이 경로에 그대로 실려 나가는 일도 함께 막힌다.
  const rawInviteToken = request.cookies.get(INVITE_TOKEN_COOKIE)?.value
  const inviteToken = normalizeInviteToken(rawInviteToken)
  if (inviteToken) {
    const response = NextResponse.redirect(`${origin}/invite/${inviteToken}`)
    response.cookies.delete({ name: INVITE_TOKEN_COOKIE, path: '/' })
    return response
  }

  // 값은 있는데 형식이 맞지 않는 경우. 지금까지는 그대로 /invite/<값> 으로 보내 초대
  // 라우트가 걸러 냈고, 그 끝은 쿠키를 지우고 /?error=invalid_invite 로 보내는 것이었다.
  // 형식을 여기서 이미 확인했으니 같은 자리로 바로 보낸다 — 사용자가 보는 결과는 같고
  // 왕복만 하나 줄었다. 쿠키는 반드시 지운다. 남겨 두면 수명이 다할 때까지 로그인마다
  // 다시 집혀 같은 실패를 되풀이한다.
  if (rawInviteToken) {
    const response = NextResponse.redirect(`${origin}/?error=invalid_invite`)
    response.cookies.delete({ name: INVITE_TOKEN_COOKIE, path: '/' })
    return response
  }

  return NextResponse.redirect(`${origin}/`)
}
