type PosEventMap = {
  finalized: { saleId: string }
}

type Listener<T> = (payload: T) => void

const listeners = new Map<keyof PosEventMap, Set<Listener<never>>>()

export function onPosEvent<K extends keyof PosEventMap>(
  event: K,
  listener: Listener<PosEventMap[K]>,
): () => void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(listener as Listener<never>)
  return () => {
    set?.delete(listener as Listener<never>)
  }
}

export function emitPosEvent<K extends keyof PosEventMap>(
  event: K,
  payload: PosEventMap[K],
): void {
  const set = listeners.get(event)
  if (!set) return
  for (const fn of set) {
    ;(fn as Listener<PosEventMap[K]>)(payload)
  }
}
