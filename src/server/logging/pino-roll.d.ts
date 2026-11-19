declare module 'pino-roll' {
  export type RollingStream = {
    write(chunk: string): boolean
    flushSync(): void
    end(): void
    on(event: 'error', listener: (error: Error) => void): RollingStream
  }

  export type PinoRollOptions = {
    file: string
    frequency?: 'daily' | 'hourly' | number
    dateFormat?: string
    extension?: string
    mkdir?: boolean
  }

  const build: (options: PinoRollOptions) => Promise<RollingStream>
  export default build
}
