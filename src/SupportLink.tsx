export const SUPPORT_URL = 'https://buy.stripe.com/3cIaEX97E1deg6jekUcwg0b'

export default function SupportLink() {
  return (
    <a className="support-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
      💜 Support SWIVEL <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}
