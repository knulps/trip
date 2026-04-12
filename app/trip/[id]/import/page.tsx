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

  const { data: trip } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .single()

  if (!trip) redirect('/')

  const { data: days } = await supabase
    .from('days')
    .select('*')
    .eq('trip_id', id)
    .order('date', { ascending: true })

  return <ImportView trip={trip} days={days ?? []} />
}
