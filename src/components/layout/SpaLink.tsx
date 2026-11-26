import { useNavigate } from '@tanstack/react-router'
import type { AnchorHTMLAttributes, MouseEvent } from 'react'

export interface SpaLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
}

/**
 * Plain anchor that navigates client-side by string path (avoids a full document reload) while
 * keeping native behaviour for modified clicks, `target`, and middle-click.
 */
export function SpaLink({ href, onClick, target, ...rest }: SpaLinkProps) {
  const navigate = useNavigate()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      (target && target !== '_self') ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    void navigate({ href })
  }

  return <a {...rest} href={href} target={target} onClick={handleClick} />
}
