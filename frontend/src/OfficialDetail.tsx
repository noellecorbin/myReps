import { useEffect, useState } from 'react'
import { safeUrl } from './utils'

interface Term {
  chamber: string
  state: string
  district: number | null
  party: string
  start: string
  end: string | null
  current: boolean
  years: number
}

interface Vote {
  date: string
  position: string
  billId: string | null
  billTitle: string | null
  billUrl: string | null
  policyArea: string | null
  rollCallUrl: string | null
}

interface OfficialDetail {
  bioguide: string
  name: string
  role: string
  party: string | null
  state: string
  district: number | null
  photoUrl: string | null
  officialWebsite: string | null
  contactUrl: string | null
  birthday: string | null
  gender: string | null
  totalYears: number
  terms: Term[]
  votingStats: {
    congress: number
    totalVotes: number
    yea: number
    nay: number
    present: number
    notVoting: number
    partyLoyaltyPct: number | null
  } | null
  recentVotes: Vote[]
  sources: { congress: string | null; wikipedia: string | null }
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function positionClass(p: string) {
  const v = p.toLowerCase()
  if (v === 'yea') return 'pos-yea'
  if (v === 'nay') return 'pos-nay'
  return 'pos-other'
}

export default function OfficialDetail({
  bioguide,
  onBack,
}: {
  bioguide: string
  onBack: () => void
}) {
  const [official, setOfficial] = useState<OfficialDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setOfficial(null)
    fetch(`/api/official/${bioguide}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || 'Failed to load official')
        setOfficial({
          ...data,
          photoUrl: safeUrl(data.photoUrl),
          officialWebsite: safeUrl(data.officialWebsite),
          contactUrl: safeUrl(data.contactUrl),
          sources: {
            congress: safeUrl(data.sources?.congress),
            wikipedia: safeUrl(data.sources?.wikipedia),
          },
          recentVotes: (data.recentVotes ?? []).map((v: Vote) => ({
            ...v,
            billUrl: safeUrl(v.billUrl),
            rollCallUrl: safeUrl(v.rollCallUrl),
          })),
        })
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [bioguide])

  if (loading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">{error}</p>
  if (!official) return null

  const stats = official.votingStats

  return (
    <section className="detail">
      <button className="back" onClick={onBack}>
        ← Back to results
      </button>

      <header className="detail-header">
        {official.photoUrl && (
          <img src={official.photoUrl} alt={official.name} className="photo large" />
        )}
        <div>
          <h2>{official.name}</h2>
          <p className="role">
            {official.role}
            {official.district === 0
              ? ' (At-Large)'
              : official.district != null
                ? `, District ${official.district}`
                : ''}
            {' — '}
            {official.state}
          </p>
          {official.party && <p className="party">{official.party}</p>}
          <div className="links">
            {official.officialWebsite && (
              <a href={official.officialWebsite} target="_blank" rel="noreferrer">
                Official website
              </a>
            )}
            {official.contactUrl && (
              <a href={official.contactUrl} target="_blank" rel="noreferrer">
                Contact
              </a>
            )}
            {official.sources.congress && (
              <a href={official.sources.congress} target="_blank" rel="noreferrer">
                Congress.gov
              </a>
            )}
            {official.sources.wikipedia && (
              <a href={official.sources.wikipedia} target="_blank" rel="noreferrer">
                Wikipedia
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="facts">
        <div className="fact">
          <span className="fact-value">{official.totalYears}</span>
          <span className="fact-label">Years in office</span>
        </div>
        {official.birthday && (
          <div className="fact">
            <span className="fact-value">{formatDate(official.birthday)}</span>
            <span className="fact-label">Born</span>
          </div>
        )}
        {stats && (
          <>
            <div className="fact">
              <span className="fact-value">{stats.totalVotes}</span>
              <span className="fact-label">Votes cast (119th)</span>
            </div>
            {stats.partyLoyaltyPct != null && (
              <div className="fact">
                <span className="fact-value">{stats.partyLoyaltyPct}%</span>
                <span className="fact-label">Party loyalty</span>
              </div>
            )}
          </>
        )}
      </div>

      <h3>Term history</h3>
      <table className="terms">
        <thead>
          <tr>
            <th>Chamber</th>
            <th>State / District</th>
            <th>Party</th>
            <th>Start</th>
            <th>End</th>
            <th>Years</th>
          </tr>
        </thead>
        <tbody>
          {[...official.terms].reverse().map((t, i) => (
            <tr key={i} className={t.current ? 'current' : ''}>
              <td>{t.chamber}</td>
              <td>
                {t.state}
                {t.district != null && t.district !== 0 ? `-${t.district}` : ''}
                {t.district === 0 ? ' (At-Large)' : ''}
              </td>
              <td>{t.party}</td>
              <td>{formatDate(t.start)}</td>
              <td>{t.current ? 'Present' : formatDate(t.end)}</td>
              <td>{t.years}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {stats && (
        <>
          <h3>Voting record — {stats.congress}th Congress</h3>
          <div className="vote-summary">
            <span className="chip yea">Yea {stats.yea}</span>
            <span className="chip nay">Nay {stats.nay}</span>
            <span className="chip other">Present {stats.present}</span>
            <span className="chip other">Not voting {stats.notVoting}</span>
          </div>
        </>
      )}

      <h3>Recent votes</h3>
      {official.recentVotes.length === 0 ? (
        <p className="muted">No roll-call votes found for the current Congress.</p>
      ) : (
        <ul className="votes">
          {official.recentVotes.map((v, i) => (
            <li key={i} className="vote">
              <span className={`position ${positionClass(v.position)}`}>{v.position}</span>
              <div className="vote-body">
                {v.billTitle ? (
                  <a href={v.billUrl ?? '#'} target="_blank" rel="noreferrer">
                    {v.billTitle}
                  </a>
                ) : (
                  <span className="muted">Roll call vote</span>
                )}
                <span className="vote-meta">
                  {formatDate(v.date)}
                  {v.policyArea ? ` · ${v.policyArea}` : ''}
                  {v.rollCallUrl && (
                    <>
                      {' · '}
                      <a href={v.rollCallUrl} target="_blank" rel="noreferrer">
                        roll call
                      </a>
                    </>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
