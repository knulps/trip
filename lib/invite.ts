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

// 형식이 맞으면 소문자로 맞춰 돌려주고, 아니면 null.
//
// 왜 정규화가 필요한가 — 위 정규식은 /i 라 대소문자를 가리지 않고, Postgres 의 uuid 비교도
// 그렇다. 그래서 /invite/A1B2C3D4-... 같은 주소로도 여행은 정상적으로 찾아진다. 그런데
// Postgres 가 돌려주는 uuid 는 언제나 소문자라, 받은 값을 그대로 들고 있다가 조회 결과와
// 문자열로 견주면 같은 토큰인데도 다르다고 판정한다. 초대 라우트의 수락 후 토큰 재확인이
// 정확히 그 비교여서, 대문자 링크로 들어온 사람은 가입까지 된 뒤 그 멤버십이 되돌려졌다.
//
// 왜 비교를 대소문자 무시로 바꾸지 않고 값을 정규화하는가 — 이 토큰은 URL, 쿠키,
// 리다이렉트 주소를 거쳐 여러 경로로 흐르고, 비교하는 자리는 앞으로 늘 수 있다. 비교마다
// 대소문자를 챙기는 규칙은 한 곳만 빠져도 같은 결함이 되살아나므로, 값이 들어오는 자리에서
// 한 번 맞춰 아래로는 언제나 같은 모양이 흐르게 한다.
// (toLowerCase 는 로케일을 타지 않는다 — 위 정규식을 통과한 값은 [0-9a-f-] 뿐이다)
export function normalizeInviteToken(
  value: string | null | undefined
): string | null {
  return isInviteToken(value) ? value.toLowerCase() : null
}
