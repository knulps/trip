import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  INVITE_TOKEN_COOKIE,
  INVITE_TOKEN_MAX_AGE,
  normalizeInviteToken,
} from '@/lib/invite'

// Next.js 16 에서 `middleware` 파일/이름 규칙은 deprecated 되고 `proxy` 로 바뀌었다.
// proxy 의 런타임은 항상 nodejs 이며 설정으로 바꿀 수 없다 (runtime 을 지정하면 에러).
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // 세션 토큰 자동 갱신 — 이 줄을 삭제하거나 이동하지 말 것
  const { data: { user } } = await supabase.auth.getUser()

  // 로그인 필요 경로 보호
  if (!user && request.nextUrl.pathname.startsWith('/trip')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // /login?invite=<uuid> 로 들어온 초대 — 이 처리가 proxy 에 있는 이유는
  // 페이지 렌더(서버 컴포넌트/클라이언트 컴포넌트) 로는 httpOnly 쿠키를 심을 수 없기 때문이다.
  // 여기서 쿠키를 다시 심어 두면 앱 내 브라우저에서 외부 브라우저로 링크가 넘어가
  // 원래 쿠키가 따라오지 못한 경우에도 바뀐 브라우저에 토큰이 새로 남는다.
  //
  // 쿼리에 적힌 대소문자를 그대로 흘려보내지 않는다. 여기서 맞춰 두면 아래에서 심는 쿠키와
  // /invite 로 보내는 주소가 초대 라우트가 쓰는 값과 같은 모양이 된다
  // (왜 정규화가 필요한지는 lib/invite.ts 의 normalizeInviteToken 에 적어 두었다).
  const inviteToken = normalizeInviteToken(request.nextUrl.searchParams.get('invite'))
  if (request.nextUrl.pathname === '/login' && inviteToken) {
    // 이미 로그인한 사용자라면 로그인 화면을 다시 볼 이유가 없으니 바로 초대 수락으로 보낸다
    if (user) {
      const url = request.nextUrl.clone()
      url.pathname = `/invite/${inviteToken}`
      url.search = ''
      const redirectResponse = NextResponse.redirect(url)
      // 위 getUser() 가 refresh 토큰을 회전시켰다면 갱신된 세션 쿠키가
      // supabaseResponse 에만 실려 있다. 새로 만든 redirect 응답을 그대로 반환하면
      // 그 Set-Cookie 가 통째로 사라지고, 브라우저에는 이미 폐기된 옛 토큰만 남아
      // 이어지는 /invite 요청에서 조용히 로그아웃된다. 그래서 옮겨 붙인다.
      supabaseResponse.cookies.getAll().forEach(cookie =>
        redirectResponse.cookies.set(cookie)
      )
      // 이미 로그인한 사용자를 보내는 길이라 초대 쿠키는 쓸 데가 없다 —
      // URL 의 토큰만으로 수락이 끝난다. 반대로 예전에 그만둔 다른 초대의 쿠키가
      // 남아 있으면 다음 로그인에서 그 여행에도 자동으로 합류하게 되므로 여기서 지운다.
      // 세션 쿠키 이관에 덮이지 않도록 이관 뒤에 지운다.
      redirectResponse.cookies.delete({ name: INVITE_TOKEN_COOKIE, path: '/' })
      return redirectResponse
    }

    // supabaseResponse 는 위 setAll 콜백에서 새로 만들어졌을 수 있으므로
    // 반환 직전인 여기서 쿠키를 심어야 한다.
    supabaseResponse.cookies.set(INVITE_TOKEN_COOKIE, inviteToken, {
      httpOnly: true,
      maxAge: INVITE_TOKEN_MAX_AGE,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * 아래 경로는 proxy 를 태우지 않는다. 매칭될 때마다 Supabase getUser() 왕복이
     * 한 번씩 더 붙기 때문에, 세션 갱신이 필요 없는 요청은 전부 제외한다.
     *
     * - api: route handler 들이 lib/api-auth.ts 의 requireUser() 로 자체 인증을 하므로
     *   proxy 에서 getUser() 를 또 부르는 건 순수한 지연 시간 낭비다. proxy 는 원래도
     *   /api 를 막지 않았고(리다이렉트 대상은 /trip 뿐) 쿠키 갱신은 페이지 이동 때
     *   이루어지므로, 제외해도 동작이 달라지지 않는다.
     * - sw.js, icon.svg, manifest.webmanifest: service worker 와 PWA 정적 자산.
     *   설치된 앱이 주기적으로 다시 받아가는데 인증과는 무관하다.
     * - _next/static, _next/image, favicon.ico, 이미지 파일: 정적 자산.
     *
     * 주의: Server Function(Server Action)은 별도 경로가 아니라 그 함수를 쓰는
     * 페이지 경로로 오는 POST 다. 여기서 제외한 경로는 Server Function 호출도 함께
     * 빠지므로, 인증이 필요한 경로를 matcher 에서 빼지 말 것.
     */
    '/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|icon\\.svg|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
