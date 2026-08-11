/**
 * 로케일 관련 상수의 단일 출처.
 *
 * 서버(`i18n/request.ts`)와 클라이언트(`components/LocaleSwitcher.tsx`) 양쪽에서
 * import 하므로 server-only / client-only 의존을 두지 않는다.
 */

export const locales = ['ko', 'en'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'ko'

/**
 * 명시적으로 고정한 시간대.
 *
 * 지정하지 않으면 서버는 머신 시간대로, 클라이언트는 방문자 시간대로 날짜를
 * 포맷해서 `format.dateTime` 을 쓰는 순간 hydration mismatch 가 난다.
 */
export const timeZone = 'Asia/Seoul'

/** 로케일 쿠키 이름 (서버/클라이언트가 같은 값을 써야 한다) */
export const LOCALE_COOKIE = 'NEXT_LOCALE'

/** 로케일 쿠키 유효기간 (초) — 1년 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * 허용 목록 검사. 사용자 입력(쿠키·헤더)을 로케일로 좁히는 유일한 통로이며,
 * `messages/${locale}.json` 동적 import 앞에서 반드시 먼저 호출해야 한다.
 */
export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}

/**
 * 로케일 쿠키를 쓰는 유일한 함수.
 *
 * 같은 쿠키를 두 군데서 조립하면 한쪽만 고쳐져 표기가 어긋난다
 * (헤더 메뉴와 LocaleSwitcher 가 실제로 그렇게 갈라진 적이 있다).
 * `document` 를 만지므로 브라우저에서만 호출할 수 있다 — 이 모듈 자체는
 * 서버에서도 import 되니 최상위에서 실행하지 말 것.
 */
export function setLocaleCookie(next: Locale): void {
  // HTTPS 로 서빙될 때만 Secure 를 붙인다 (http 로컬 개발에서는 붙이면 저장되지 않음)
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}
