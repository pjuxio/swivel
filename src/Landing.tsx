import GlowCanvas from './GlowCanvas'
import SupportLink from './SupportLink'
import AboutLink from './AboutLink'

type Props = {
  address: string
  finding: boolean
  locating: boolean
  error: string | null
  onAddressChange: (value: string) => void
  onSubmitAddress: (e: React.FormEvent) => void
  onUseLocation: () => void
}

export default function Landing({ address, finding, locating, error, onAddressChange, onSubmitAddress, onUseLocation }: Props) {
  return (
    <main className="landing">
      <GlowCanvas />
      <div className="landing-card">
        <p className="brand">SWIVEL</p>
        <h1>Know what's around{'\u00a0'}you.{'\u00a0'}👀</h1>
        <p className="landing-lead">
          Find nearby services, safety resources and community data for any place in the United States, then layer on
          county{'\u2011'}level{'\u00a0'}maps.
        </p>
        <p className="landing-badge">🇺🇸 United States only: data and searches cover the{'\u00a0'}US.</p>
        <button className="primary landing-cta" onClick={onUseLocation} disabled={locating} autoFocus>
          {locating ? 'Finding you…' : '📍 Use my location'}
        </button>
        <p className="landing-or" aria-hidden="true"><span>or</span></p>
        <form className="lookup landing-lookup" onSubmit={onSubmitAddress}>
          <input
            type="search"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Enter a US address, city or ZIP"
            aria-label="US address, city or ZIP"
          />
          <button type="submit" className="primary" disabled={!address.trim() || finding}>{finding ? '…' : 'Go'}</button>
        </form>
        <div role="alert">{error && <p className="error">{error}</p>}</div>
        <p className="hint">
          Your browser only asks to share your location if you choose "Use my location". Searching by address never
          needs it.
        </p>
        <p className="sos">Always maintain situational awareness. In an emergency call 911.</p>
        <div className="footer-links">
          <SupportLink />
          <AboutLink />
        </div>
      </div>
    </main>
  )
}
