import { workerFetch } from '../api/worker'
import { useGoogleQuery } from './useGoogleQuery'

export type ScheduleItem = { id: string; title: string; start: string; end: string; allDay: boolean; location: string }
export type Deadline = { id: string; title: string; due: string }
export type BlackboardData = { today: ScheduleItem[]; deadlines: Deadline[]; hasLectureEvents: boolean }

const loadBlackboard = (token: string, signal: AbortSignal) => workerFetch<BlackboardData>('/calendar', token, signal)

/** One /calendar request shared by ScheduleCard and DeadlinesCard. */
export function useBlackboard(token: string) {
  return useGoogleQuery(token, loadBlackboard)
}
