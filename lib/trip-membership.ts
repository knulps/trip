// "내가 아직 이 여행의 멤버인가" 판정을 한 곳에 모은다.
// PostgREST 의 delete/update 는 RLS 에 막혀 한 행도 바꾸지 못해도 error 가 null 이라,
// 바뀐 행이 0개일 때 그것이 '이미 남이 처리했다'인지 '내가 막혔다'인지 여기서 가른다.
//
// 왜 trip_members 조회 하나로 판정이 되는가:
//   - trip_members_select 정책이 is_trip_member(trip_id) 하나뿐이라
//     "내 행이 보인다 ⟺ 내가 이 여행의 멤버다" 가 성립한다.
//   - days_all 정책도 조건이 is_trip_member(trip_id) 하나뿐이고,
//     places_all 은 "그 장소가 달린 날짜의 여행에 내가 멤버인가" 하나뿐이다.
//     그래서 이 두 테이블에서 mutation 이 RLS 에 막히는 이유는 '내가 멤버가 아니다' 단 하나다.
//     (대상 행이 이미 사라진 경우는 RLS 가 아니라 조건에 맞는 행이 없는 것이라 구분된다)

import type { createClient } from '@/lib/supabase/client'

type BrowserClient = ReturnType<typeof createClient>

// 'unknown' 은 조회 자체가 실패한 상태다. 'not-member' 로 뭉개면 안 된다 —
// 호출부가 이 값을 보고 fail-closed 로(화면을 비우지 않고 실패로) 판단해야 한다.
export type TripMembership = 'member' | 'not-member' | 'unknown'

export async function checkTripMembership(
  supabase: BrowserClient,
  tripId: string,
  userId: string
): Promise<TripMembership> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return 'unknown'
  return data ? 'member' : 'not-member'
}
