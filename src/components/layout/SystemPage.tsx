import type { ReactNode } from 'react'
import { BRAND_NAME } from '~/lib/brand'
import { cn } from '~/lib/cn'
import { LangToggle } from './LangToggle'

export interface SystemPageProps {
  children: ReactNode
  wide?: boolean
}

export function SystemPage({ children, wide = false }: SystemPageProps) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
      <p className="mb-4 text-title font-bold tracking-tight text-ink">{BRAND_NAME}</p>
      <main
        role="main"
        className={cn(
          'w-full rounded-modal border border-line bg-surface p-6 shadow-card md:p-8',
          wide ? 'max-w-dialog-lg' : 'max-w-dialog-md',
        )}
      >
        {children}
      </main>
      <div className="fixed bottom-4 right-4">
        <LangToggle />
      </div>
    </div>
  )
}
