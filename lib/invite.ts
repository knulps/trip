// 초대 링크 처리에 쓰이는 상수와 토큰 형식 검증을 한 곳에 모은다.
// proxy, 초대 라우트, 로그인 화면이 모두 같은 값을 봐야 하므로 중복 정의하지 않는다.

// 초대 토큰을 실어 나르는 쿠키 이름
export const INVITE_TOKEN_COOKIE = 'invite_token'

// 초대 토큰 쿠키 수명(초). 구글 계정을 새로 만들거나 2단계 인증을 거치면
// 10분으로는 부족해서 로그인 도중에 토큰이 사라지는 일이 있었다.
export const INVITE_TOKEN_MAX_AGE = 60 * 60 // 1시간

// invite_token 컬럼이 uuid 타입이라 형식이 맞지 않으면 Postgres가 에러를 낸다
export const INVITE_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 쿼리와 쿠키에서 읽은 값은 전부 신뢰할 수 없으므로 이 helper로 걸러 쓴다
export function isInviteToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value)
}
