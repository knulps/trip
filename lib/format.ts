/**
 * 날짜·거리 표시 형식을 한곳에 모은 모듈.
 *
 * 화면마다 `${date.getMonth() + 1}/${date.getDate()}` 처럼 직접 조립하거나
 * 요일 이름을 메시지 카탈로그의 배열에서 꺼내 쓰면, 로케일을 추가할 때마다
 * 플랫폼이 이미 갖고 있는 데이터를 손으로 다시 써야 한다.
 * 여기서는 모두 Intl(next-intl 의 `useFormatter()`)에 맡긴다.
 */

import type { useFormatter } from 'next-intl'

/**
 * 포맷터 타입.
 * 클라이언트의 `useFormatter()` 와 서버의 `await getFormatter()` 가 같은 것을 돌려주므로
 * 아래 함수들은 서버 컴포넌트에서도 그대로 쓸 수 있다.
 */
export type Formatter = ReturnType<typeof useFormatter>

/**
 * 'YYYY-MM-DD' 를 로컬 자정으로 파싱한다.
 * new Date('2026-05-03') 은 UTC 자정으로 해석되어 UTC 오프셋이 음수인 지역에서 하루 밀린다.
 */
export function parseLocalDate(value: string): Date {
  return new Date(value + 'T00:00:00')
}

/** Date → 'YYYY-MM-DD' (toISOString() 은 UTC 기준이라 사용하지 않는다) */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 'YYYY-MM-DD' 는 시간대가 없는 달력 날짜다.
 * 로컬 자정으로 읽은 연/월/일을 그대로 UTC 순간으로 옮겨 두고 항상 UTC 로 포맷하면,
 * 서버 머신 시간대·방문자 시간대·전역 timeZone 설정이 무엇이든 같은 글자가 나온다.
 * (로컬 자정 인스턴트를 고정 시간대로 포맷하면 그 시간대보다 동쪽에 있는 사용자에게
 *  하루 이른 날짜가 보이고 hydration mismatch 도 난다)
 */
const CALENDAR_TIME_ZONE = 'UTC'

function toCalendarInstant(isoDate: string): Date | null {
  const local = parseLocalDate(isoDate)
  if (Number.isNaN(local.getTime())) return null
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()))
}

// 날짜 탭·날짜 헤더용 짧은 표기 (ko: "5. 3. (일)" / en: "Sun, 5/3")
const DAY_DATE_OPTIONS = {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  timeZone: CALENDAR_TIME_ZONE,
} as const

// 여행 기간 표기 (ko: "2026년 5월 3일" / en: "May 3, 2026")
const FULL_DATE_OPTIONS = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: CALENDAR_TIME_ZONE,
} as const

/** 날짜 탭·날짜 헤더에 붙이는 월/일 + 요일. 날짜가 깨져 있으면 원문을 그대로 보여준다. */
export function formatDayDate(format: Formatter, isoDate: string): string {
  const instant = toCalendarInstant(isoDate)
  if (!instant) return isoDate
  return format.dateTime(instant, DAY_DATE_OPTIONS)
}

/** 여행 기간처럼 연도까지 보여주는 날짜. 날짜가 깨져 있으면 원문을 그대로 보여준다. */
export function formatFullDate(format: Formatter, isoDate: string): string {
  const instant = toCalendarInstant(isoDate)
  if (!instant) return isoDate
  return format.dateTime(instant, FULL_DATE_OPTIONS)
}

/**
 * 미터 단위 거리를 로케일 표기로 바꾼다.
 * 1km 이상은 소수 한 자리 km, 그 미만은 정수 m — 반올림 기준은 서버가 문자열을
 * 만들던 때와 같고, 단위 이름과 소수점 문자만 로케일이 정한다.
 */
export function formatDistance(format: Formatter, meters: number | null | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return ''
  if (meters >= 1000) {
    return format.number(meters / 1000, {
      style: 'unit',
      unit: 'kilometer',
      unitDisplay: 'short',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
  }
  return format.number(Math.round(meters), {
    style: 'unit',
    unit: 'meter',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  })
}
