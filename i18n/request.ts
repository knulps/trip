import { getRequestConfig } from 'next-intl/server'
import { IntlErrorCode } from 'next-intl'
import { cookies, headers } from 'next/headers'
import {
  defaultLocale,
  isLocale,
  timeZone,
  LOCALE_COOKIE,
  type Locale,
} from './config'

/**
 * `Accept-Language` 협상.
 *
 * "en-US,en;q=0.9,ko;q=0.8" 처럼 q 값이 붙은 목록을 q 내림차순으로 정렬한 뒤
 * 기본 언어 태그(en-US → en)를 허용 목록과 맞춰본다. 맞는 것이 없으면 null.
 */
function negotiateLocale(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null

  const candidates = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.find(p => p.trim().startsWith('q='))
      const parsedQ = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1
      const q = Number.isFinite(parsedQ) ? parsedQ : 0
      // q 가 같으면 헤더에 적힌 순서를 유지한다
      return { tag: tag.trim().toLowerCase(), q, index }
    })
    .filter(c => c.tag.length > 0 && c.q > 0)
    .sort((a, b) => (b.q - a.q) || (a.index - b.index))

  for (const { tag } of candidates) {
    if (tag === '*') return defaultLocale
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return null
}

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value
  // 사용자가 직접 고른 값이 최우선
  if (isLocale(fromCookie)) return fromCookie

  // 첫 방문이라 쿠키가 없으면 브라우저 언어로 협상한다
  const headerStore = await headers()
  return negotiateLocale(headerStore.get('accept-language')) ?? defaultLocale
}

export default getRequestConfig(async ({ locale: requestedLocale }) => {
  // getTranslations({locale}) 처럼 명시적으로 넘어온 값이 있으면 그것을 쓴다
  const resolved: Locale = isLocale(requestedLocale)
    ? requestedLocale
    : await resolveLocale()

  // 여기까지 온 resolved 는 locales 허용 목록을 통과한 값이므로
  // 아래 동적 import 의 경로에 안전하게 넣을 수 있다 (path traversal 차단)
  return {
    locale: resolved,
    timeZone,
    messages: (await import(`../messages/${resolved}.json`)).default,
    onError(error) {
      // 기본 동작(console.error)에 의존하면 어떤 키가 빠졌는지 프로덕션 로그에 남지 않는다
      if (error.code === IntlErrorCode.MISSING_MESSAGE) {
        console.warn(`[next-intl] missing message (${resolved}): ${error.message}`)
        return
      }
      console.error(`[next-intl] ${error.code} (${resolved}):`, error)
    },
    getMessageFallback({ namespace, key, error }) {
      const path = [namespace, key].filter(Boolean).join('.')
      // 개발 중에는 전체 경로를 그대로 보여 눈에 띄게 하고,
      // 프로덕션에서는 내부 키 구조가 화면에 노출되지 않도록 마지막 조각만 남긴다
      if (process.env.NODE_ENV !== 'production') {
        return `${path} (${error.code})`
      }
      return key.split('.').pop() ?? path
    },
  }
})
