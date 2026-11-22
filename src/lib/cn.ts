import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'total-xl',
        'total-lg',
        'display',
        'h1',
        'h2',
        'h3',
        'title',
        'body-lg',
        'body',
        'body-sm',
        'caption',
        'label',
        'label-sm',
        'button-lg',
        'button',
        'num-xl',
        'num-lg',
        'num-md',
        'num-sm',
        'code-id',
      ],
      radius: ['xs', 'sm', 'md', 'control', 'lg', 'card', 'modal', 'full'],
      shadow: ['none', 'card', 'pill', 'popover', 'modal'],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
