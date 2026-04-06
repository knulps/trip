import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // 초대 토큰 처리: 쿠키에 저장된 invite_token이 있으면 멤버 추가
  const inviteToken = request.cookies.get('invite_token')?.value
  if (inviteToken) {
    const response = NextResponse.redirect(`${origin}/api/invite/${inviteToken}`)
    response.cookies.delete('invite_token')
    return response
  }

  return NextResponse.redirect(`${origin}/`)
}
