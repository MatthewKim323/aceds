import { supabase } from './supabase'
import type { ScheduleCandidate } from './api'

export type SavedScheduleRow = {
  id: string
  user_id: string
  quarter_code: string
  label: string | null
  score: number | null
  total_units: number | null
  rank_in_run: number | null
  candidate: ScheduleCandidate
  created_at: string
}

export async function listSavedSchedules(userId: string): Promise<SavedScheduleRow[]> {
  const { data, error } = await supabase
    .from('saved_schedules')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(error.message)
  return (data ?? []) as SavedScheduleRow[]
}

export async function insertSavedSchedule(params: {
  userId: string
  quarterCode: string
  candidate: ScheduleCandidate
  rankInRun?: number
  label?: string
}) {
  const { userId, quarterCode, candidate, rankInRun, label } = params
  const { data, error } = await supabase
    .from('saved_schedules')
    .insert({
      user_id: userId,
      quarter_code: quarterCode,
      candidate: candidate as unknown as Record<string, unknown>,
      score: candidate.score,
      total_units: candidate.total_units,
      rank_in_run: rankInRun ?? null,
      label: label ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data?.id as string
}

export async function deleteSavedSchedule(userId: string, id: string) {
  const { error } = await supabase.from('saved_schedules').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(error.message)
}
