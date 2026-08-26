// 초대 링크 처리에 쓰이는 상수와 토큰 형식 검증을 한 곳에 모은다.
// proxy, 초대 라우트, 로그인 화면이 모두 같은 값을 봐야 하므로 중복 정의하지 않는다.

// 초대 토큰을 실어 나르는 쿠키 이름
export const INVITE_TOKEN_COOKIE = 'invite_token'

// 초대 토큰 쿠키 수명(초). 양쪽으로 위험이 있어 가운데를 잡은 값이다.
// 길면 — 이 쿠키가 남아 있는 동안 초대와 무관한 로그인에도 딸려 들어가 엉뚱한 여행에
//        합류시킨다. 앱에 여행 나가기 기능이 없어 되돌릴 수도 없다.
// 짧으면 — 구글 계정을 새로 만들거나 2단계 인증을 거치는 동안 만료돼 초대가 유실된다.
//        이 구간에서 사용자는 구글 화면에 머물다 콜백으로 바로 돌아오므로,
//        /login?invite=<token> 주소를 다시 열어 쿠키를 갱신할 기회가 없다.
// 잔류 위험은 초대 처리가 끝나는 모든 지점에서 쿠키를 지워 대부분 막았고,
// 수명만으로 막아야 하는 것은 '로그인하지 않고 떠난 경우' 하나뿐이라 30분으로 둔다.
export const INVITE_TOKEN_MAX_AGE = 60 * 30 // 30분

// invite_token 컬럼이 uuid 타입이라 형식이 맞지 않으면 Postgres가 에러를 낸다
export const INVITE_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 쿼리와 쿠키에서 읽은 값은 전부 신뢰할 수 없으므로 이 helper로 걸러 쓴다
export function isInviteToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value)
}
