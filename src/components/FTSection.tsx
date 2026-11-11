import { useState } from 'react'
import { loadFt, loadFtDigest, recentIssues, type FtData, type FtDigest } from '../google/ft'
import type { EmailSummary } from '../google/gmail'
import type { FetchState } from '../hooks/useFetch'
import { useGoogleQuery } from '../hooks/useGoogleQuery'
import { EmailSheet } from './EmailSheet'
import { FTAlertsCard } from './FTAlertsCard'
import { FTBriefingCard } from './FTBriefingCard'
import { FTNewslettersCard } from './FTNewslettersCard'

/** `digest: null` means there were no newsletter issues since yesterday morning. */
export type DigestState = FetchState<{ digest: FtDigest | null }>

/** Loads FT emails once, then the AI digest, and shares both with the three FT cards. */
export function FTSection({ token }: { token: string }) {
  const ft = useGoogleQuery(token, loadFt)
  const [open, setOpen] = useState<EmailSummary | null>(null)

  const digestKey = ft.data ? recentIssues(ft.data).map((i) => i.email.id).join(',') || 'none' : 'waiting'
  const digestQuery = useGoogleQuery(
    token,
    async (t, signal) => ({ digest: ft.data ? await loadFtDigest(ft.data, t, signal) : null }),
    digestKey,
  )
  // Until the FT emails are in, the digest hasn't really started.
  const digest: DigestState = ft.data ? digestQuery : { ...digestQuery, data: null, loading: true, error: null }

  return (
    <>
      <FTBriefingCard ft={ft} digest={digest} />
      <FTNewslettersCard ft={ft} digest={digest} onOpen={setOpen} />
      <FTAlertsCard ft={ft} onOpen={setOpen} />
      {open && ft.data && <EmailSheet token={token} account={ft.data.account} email={open} onClose={() => setOpen(null)} />}
    </>
  )
}

export type FtState = FetchState<FtData>
