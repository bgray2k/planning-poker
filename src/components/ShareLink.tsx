import { useState } from 'react'
import { Link } from 'lucide-react'

interface ShareLinkProps {
  roomId: string
}

export function ShareLink({ roomId }: ShareLinkProps) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/room/${roomId}`

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="share-link">
      <button
        type="button"
        className="share-link__button"
        onClick={copy}
        aria-label={copied ? 'Room link copied' : 'Copy room link'}
        title={copied ? 'Room link copied' : 'Copy room link'}
      >
        <Link aria-hidden="true" size={16} />
      </button>
      <span className="share-link__status" role="status">
        {copied ? 'Room link copied' : ''}
      </span>
    </div>
  )
}
