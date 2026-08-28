import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  INVITE_TOKEN_COOKIE,
  INVITE_TOKEN_MAX_AGE,
  isInviteToken,
} from '@/lib/invite'

// Postgres unique_violation — 두 탭에서 동시에 수락한 경우
const UNIQUE_VIOLATION = '23505'

// 초대 처리가 끝나는 모든 지점에서 쓰는 리다이렉트 — 초대 쿠키를 같이 지운다.
// 여기서 지우지 않으면 실패했거나 중도에 그만둔 초대의 쿠키가 수명이 다할 때까지 남고,
// 그 사이에 다른 로그인을 하면 auth/callback 이 그 쿠키를 집어 엉뚱한 여행에 합류시킨다.
function redirectClearingInvite(url: string) {
  const response = NextResponse.redirect(url)
  response.cookies.delete({ name: INVITE_TOKEN_COOKIE, path: '/' })
  return response
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const origin = new URL(request.url).origin

  if (!isInviteToken(token)) {
    return redirectClearingInvite(`${origin}/?error=invalid_invite`)
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
    return redirectClearingInvite(`${origin}/?error=invalid_invite`)
  }

  // 이미 멤버인지 확인
  const { data: existing } = await serviceSupabase
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', trip.id)
    .eq('user_id', user.id)
    .maybeSingle()

  // 이번 요청이 멤버십을 실제로 새로 넣었는가. 아래 토큰 재확인에서 되돌릴지가 이 값으로 갈린다.
  let joinedNow = false
  // 이번 요청이 넣은 행의 joined_at. 되돌림 delete 를 이 값으로 좁힌다.
  //
  // trip_members 의 PK 는 (trip_id, user_id) 뿐이라, 되돌림을 그 키로만 좁히면 '이 요청이
  // 넣은 행'이 아니라 '지금 그 자리에 있는 행'을 지우게 된다. 같은 사람이 옛 링크와 새
  // 링크를 거의 동시에 열면, 옛 링크 쪽 요청의 되돌림이 새 링크로 정당하게 생긴 멤버십을
  // 지워 버린다 — 그 사람은 유효한 링크를 눌렀는데 멤버십 없이 여행 화면에 도착한다.
  // joined_at 까지 견주면 그 사이에 다른 경로로 새로 생긴 행은 건드리지 않는다.
  let joinedAt: string | null = null

  if (!existing) {
    const { data: inserted, error: insertError } = await serviceSupabase
      .from('trip_members')
      .insert({
        trip_id: trip.id,
        user_id: user.id,
        role: 'member',
      })
      .select('joined_at')
      .maybeSingle()

    // 중복 키는 이미 멤버가 된 것이므로 성공으로 처리
    if (insertError && insertError.code !== UNIQUE_VIOLATION) {
      return redirectClearingInvite(`${origin}/?error=invite_failed`)
    }

    // 다만 중복 키는 '다른 탭이 방금 넣었다'는 뜻이라 이 요청이 넣은 행은 아니다.
    // 그 행을 우리가 되돌리면 남이 만든 멤버십을 지우게 되므로 넣은 것으로 세지 않는다.
    // (그 요청도 아래와 같은 재확인을 하므로, 되돌려야 할 상황이면 그쪽이 되돌린다)
    joinedNow = !insertError
    joinedAt = inserted?.joined_at ?? null
  }

  // 토큰 재확인 — 위의 여행 조회와 이 insert 사이에 여행을 만든 사람이 초대 링크를 새로
  // 만들면, 이미 조회를 통과한 이 요청은 토큰을 다시 보지 않은 채 가입을 끝낸다. 그러면
  // '새로 만들면 지금까지 뿌린 링크가 곧바로 무효가 된다'는 약속이 성립하지 않는다.
  // 그래서 넣고 난 뒤에 토큰이 아직 우리가 쓴 값인지 한 번 더 본다.
  //
  // 이 확인은 이번 요청이 실제로 멤버십을 넣은 경우에만 한다. 원래 멤버였다면 이 요청이
  // 새로 준 접근 권한이 없어 되돌릴 것도 없고, 그런 사람을 죽은 링크를 눌렀다는 이유로
  // 홈으로 돌려보내면 멀쩡히 가진 접근 권한을 없는 것처럼 알리게 된다.
  //
  // 이것으로 경합이 완전히 사라지지는 않는다. 재확인과 아래 삭제 사이에도 창이 남고,
  // 삭제가 실패하면 멤버십은 그대로 남는다(그때는 되돌린 경우와 다른 안내로 보낸다 — 아래
  // 참고). joined_at 으로 좁혀도 '다른 요청이 우리가 넣은 그 행을 자기 멤버십으로 보고
  // 그냥 지나간' 경우까지는 가리지 못한다. 근본 해결은 초대 수락(여행 조회 + 가입 +
  // 토큰 확인)을 RPC 하나로 묶어 원자화하는 것이고, 그것은 별도 작업이다.
  if (joinedNow) {
    const { data: current, error: recheckError } = await serviceSupabase
      .from('trips')
      .select('invite_token')
      .eq('id', trip.id)
      .maybeSingle()

    // 재확인 조회 자체가 실패하면 되돌리지 않고 그대로 진행한다. 토큰이 바뀌었는지 모르는
    // 상태인데, 멀쩡한 가입을 조회 한 번 실패했다는 이유로 취소하는 쪽이 더 나쁘다 —
    // 초대받은 사람은 링크가 살아 있는데도 들어오지 못하고, 왜인지 알 방법도 없다.
    if (!recheckError && current && current.invite_token !== token) {
      // joined_at 을 받아 두지 못했으면 되돌리지 않는다 (fail-safe). 그 값이 없으면
      // (trip_id, user_id) 로만 지우게 되는데, 그것이 이 요청이 넣은 행이라는 보장이 없다.
      // 죽은 링크로 들어온 사람을 남겨 두는 것보다, 남이 정당하게 얻은 멤버십을 잘못 지우는
      // 쪽이 나쁘다 — 그 사람은 유효한 링크를 눌렀는데도 멤버십 없이 여행 화면에 도착하고,
      // 무엇이 잘못됐는지 알 방법이 없다.
      if (!joinedAt) {
        return redirectClearingInvite(`${origin}/?error=invite_failed`)
      }

      // .select('user_id') 로 실제 지워진 행을 받아 온다. delete 는 한 행도 지우지 못해도
      // error 가 null 이라, 결과를 보지 않으면 실패를 성공으로 오인한다 (leaveTrip 과
      // rotateInvite 가 모두 같은 방식을 쓴다).
      //
      // 되돌림의 성공/실패로 안내를 가르는 이유 — 되돌리지 못하면 멤버십이 그대로 남아
      // 이 사람은 /trip/{id} 에 그냥 들어갈 수 있는데, invalid_invite 는 '초대 링크가
      // 올바르지 않다'고 알려 여행을 만든 사람은 차단됐다고 믿게 된다. 화면에 남는 신호가
      // 사실과 반대인 것은 그냥 둘 수 없다.
      //   - 되돌렸다   → invalid_invite ('링크가 올바르지 않거나 만료되었습니다')
      //   - 못 되돌렸다 → invite_failed ('처리하지 못했습니다. 잠시 후 다시 시도해 주세요')
      // 0행도 못 되돌린 것으로 센다. 우리가 넣은 행이 이미 없다는 뜻인데 그 자리에 무엇이
      // 남아 있는지는 알 수 없고, 확인하지 못한 것을 성공으로 세지 않는다.
      const { data: removed, error: deleteError } = await serviceSupabase
        .from('trip_members')
        .delete()
        .eq('trip_id', trip.id)
        .eq('user_id', user.id)
        .eq('joined_at', joinedAt)
        .select('user_id')

      if (deleteError || !removed || removed.length === 0) {
        return redirectClearingInvite(`${origin}/?error=invite_failed`)
      }

      return redirectClearingInvite(`${origin}/?error=invalid_invite`)
    }
  }

  return redirectClearingInvite(`${origin}/trip/${trip.id}`)
}
