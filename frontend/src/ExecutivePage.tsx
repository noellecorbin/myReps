import { useEffect, useState } from 'react'
import { safeUrl } from './utils'

interface ExecutiveOfficial {
  role: string
  name: string
  party: string | null
  term: string
  photoUrl: string | null
  officialWebsite: string | null
  wikipediaUrl: string | null
}

export default function ExecutivePage() {
  const [officials, setOfficials] = useState<ExecutiveOfficial[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/executive')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || 'Failed to load')
        setOfficials(
          data.officials.map((o: ExecutiveOfficial) => ({
            ...o,
            photoUrl: safeUrl(o.photoUrl),
            officialWebsite: safeUrl(o.officialWebsite),
            wikipediaUrl: safeUrl(o.wikipediaUrl),
          }))
        )
      })
      .catch((e) => setError(e.message))
  }, [])

  return (
    <section>
      <h2>Executive Branch</h2>
      <p className="subtitle">
        The President and Vice President of the United States.
      </p>
      {error && <p className="error">{error}</p>}
      {!officials && !error && <p className="muted">Loading…</p>}
      {officials && (
        <div className="cards">
          {officials.map((o) => (
            <article key={o.name} className="card">
              {o.photoUrl && (
                <img src={o.photoUrl} alt={o.name} className="photo" loading="lazy" />
              )}
              <div className="info">
                <h3>{o.name}</h3>
                <p className="role">{o.role}</p>
                <p className="party">
                  {o.party} · Term {o.term}
                </p>
                <div className="links">
                  {o.officialWebsite && (
                    <a href={o.officialWebsite} target="_blank" rel="noreferrer">
                      WhiteHouse.gov
                    </a>
                  )}
                  {o.wikipediaUrl && (
                    <a href={o.wikipediaUrl} target="_blank" rel="noreferrer">
                      Wikipedia
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
