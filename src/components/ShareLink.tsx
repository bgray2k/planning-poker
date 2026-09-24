import { useState } from "react";
import { Check, Link } from "lucide-react";

interface ShareLinkProps {
  readonly roomId: string;
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function ShareLink({ roomId }: ShareLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/room/${roomId}`;

  async function copy() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        fallbackCopy(url);
      }
    } catch {
      fallbackCopy(url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="share-link">
      <button
        type="button"
        className={`share-link__button${copied ? " share-link__button--copied" : ""}`}
        onClick={copy}
        aria-label={copied ? "Room link copied" : "Copy room link"}
        title={copied ? "Room link copied" : "Copy room link"}
      >
        {copied ? <Check aria-hidden="true" size={16} /> : <Link aria-hidden="true" size={16} />}
      </button>
      <output className={`share-link__tooltip${copied ? " share-link__tooltip--visible" : ""}`}>
        {copied ? "Copied!" : ""}
      </output>
    </div>
  );
}
