import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import TripView from './TripView'

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 여행 조회 (RLS가 멤버 여부 검사)
  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .single()

  if (!trip) notFound()

  // 날짜별 일정 + 장소 조회
  const { data: days } = await supabase
    .from('days')
    .select('*, places(*)')
    .eq('trip_id', id)
    .order('date', { ascending: true })

  const sortedDays = (days ?? []).map(day => ({
    ...day,
    places: (day.places ?? []).sort((a: { order_key: string }, b: { order_key: string }) =>
      a.order_key < b.order_key ? -1 : 1
    ),
  }))

  return (
    <TripView trip={trip} days={sortedDays} userId={user.id} />
  )
}
