import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
