import { useRef } from 'react'

export default function AboutLink() {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" className="footer-link" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        ℹ️ About
      </button>
      <dialog
        ref={dialog}
        className="about"
        aria-labelledby="about-title"
        // Clicks on the backdrop land on the dialog element itself
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      >
        <div className="about-body">
          <h2 id="about-title">About SWIVEL</h2>
          <p className="about-tagline">
            <strong>Safety Warning &amp; Instant Vigilance Entity Lookup</strong>
          </p>
          <h3>Privacy</h3>
          <ul>
            <li>Your browser only asks for your location after you press "Use my location".</li>
            <li>Address lookups go through our server, so the geocoding service never sees your IP address.</li>
            <li>Map tiles load directly from OpenStreetMap, which can see your IP address and the area you view.</li>
            <li>No analytics or tracking. Usage is counted anonymously, without coordinates, search text or IP addresses.</li>
          </ul>
          <h3>Data</h3>
          <p>
            Listings come from public datasets (HIFLD, US DOT, EPA, DOE, FBI, Census and others) that may be out of date.
            Verify anything you rely on. In an emergency call 911.
          </p>
          <p>
            <a href="https://github.com/pjuxio/swivel" target="_blank" rel="noopener noreferrer">
              Source code and data sources on GitHub <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
          <form method="dialog">
            <button className="primary" autoFocus>Close</button>
          </form>
        </div>
      </dialog>
    </>
  )
}
