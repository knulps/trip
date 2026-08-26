'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { PENDING_INVITE_KEY, isInviteToken } from '@/lib/invite'

// 쿠키가 유실된 채 로그인만 끝나서 빈 홈으로 떨어진 경우, localStorage 에 남은
// 초대를 마저 처리한다. 화면에 보이는 것은 없고 이동만 담당한다.
export default function PendingInviteRedirect() {
  const router = useRouter()
  // React StrictMode 는 개발 중 effect 를 두 번 실행하므로 ref 로 한 번만 돌게 막는다
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    let token: string | null = null
    // 사파리 프라이빗 모드 등에서는 접근 자체가 throw 한다
    try {
      token = localStorage.getItem(PENDING_INVITE_KEY)
      // 이동하기 전에 먼저 지운다 — 초대 처리가 실패해 다시 홈으로 돌아와도
      // 같은 토큰으로 또 이동해 무한 루프가 도는 것을 막아야 한다
      localStorage.removeItem(PENDING_INVITE_KEY)
    } catch {
      return
    }

    if (isInviteToken(token)) {
      router.replace(`/invite/${token}`)
    }
  }, [router])

  return null
}
