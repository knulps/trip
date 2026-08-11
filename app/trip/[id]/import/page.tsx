import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ImportView from './ImportView'

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 여행이 있는지만 확인한다 (id 는 이미 params 로 알고 있다)
  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  // 조회 자체가 실패한 것과 여행이 없는 것은 다르게 다룬다
  if (tripError) throw new Error(`여행 정보를 불러오지 못했습니다: ${tripError.message}`)
  if (!trip) redirect('/')

  const { data: days, error: daysError } = await supabase
    .from('days')
    .select('*')
    .eq('trip_id', id)
    .order('date', { ascending: true })

  if (daysError) throw new Error(`여행 날짜를 불러오지 못했습니다: ${daysError.message}`)

  return <ImportView tripId={id} days={days ?? []} />
}
