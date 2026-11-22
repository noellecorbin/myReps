import { useState } from 'react'
import OfficialDetail from './OfficialDetail'
import ExecutivePage from './ExecutivePage'
import './App.css'

interface Official {
  bioguide: string | null
  name: string
  role: string
  party: string | null
  state: string
  district: number | null
  officialWebsite: string | null
  contactUrl: string | null
  photoUrl: string | null
}

interface OfficialsResponse {
  zip: string
  location: {
    city: string | null
    stateAbbr: string
    stateName: string
    county: string | null
    congressionalDistrict: string | null
  }
  officials: Official[]
}

function App() {
  const [zip, setZip] = useState('')
  const [result, setResult] = useState<OfficialsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'congress' | 'executive'>('congress')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    setSelected(null)
    try {
      const res = await fetch(`/api/officials?zip=${encodeURIComponent(zip)}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'Something went wrong')
      } else {
        setResult(data)
      }
    } catch {
      setError('Could not reach the server. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const { location } = result ?? {}

  return (
    <main className="page">
      <nav className="tabs">
        <button
          className={`tab${tab === 'congress' ? ' active' : ''}`}
          onClick={() => setTab('congress')}
        >
          Congress (federal)
        </button>
        <button
          className={`tab${tab === 'executive' ? ' active' : ''}`}
          onClick={() => setTab('executive')}
        >
          Executive
        </button>
      </nav>

      {tab === 'executive' ? (
        <ExecutivePage />
      ) : selected ? (
        <OfficialDetail bioguide={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <h1>Find Your Elected Officials</h1>
          <p className="subtitle">Enter a ZIP code to see your members of Congress.</p>

          <form onSubmit={handleSubmit} className="search-form">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{5}"
          maxLength={5}
          placeholder="ZIP code"
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          required
        />
        <button type="submit" disabled={loading || zip.length !== 5}>
          {loading ? 'Searching…' : 'Look up'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && location && (
        <section>
          <h2 className="location">
            {[location.city, location.stateAbbr].filter(Boolean).join(', ')}
            {location.county ? ` — ${location.county}` : ''}
          </h2>
          <div className="cards">
            {result.officials.map((o) => (
              <article
                key={`${o.name}-${o.role}`}
                className={`card clickable${o.bioguide ? '' : ' disabled'}`}
                onClick={() => o.bioguide && setSelected(o.bioguide)}
                role={o.bioguide ? 'button' : undefined}
                tabIndex={o.bioguide ? 0 : undefined}
                onKeyDown={(e) => {
                  if (o.bioguide && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    setSelected(o.bioguide)
                  }
                }}
              >
                {o.photoUrl && (
                  <img src={o.photoUrl} alt={o.name} className="photo" loading="lazy" />
                )}
                <div className="info">
                  <h3>{o.name}</h3>
                  <p className="role">
                    {o.role}
                    {o.district === 0
                      ? ' (At-Large)'
                      : o.district !== null && o.district !== undefined
                        ? `, District ${o.district}`
                        : ''}
                  </p>
                  {o.party && <p className="party">{o.party}</p>}
                  <div className="links">
                    {o.officialWebsite && (
                      <a
                        href={o.officialWebsite}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Website
                      </a>
                    )}
                    {o.contactUrl && (
                      <a
                        href={o.contactUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Contact
                      </a>
                    )}
                  </div>
                  {o.bioguide && <span className="view-profile">View profile →</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
        </>
      )}
    </main>
  )
}

export default App
