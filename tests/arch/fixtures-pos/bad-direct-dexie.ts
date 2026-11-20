import Dexie from 'dexie'

export function illegalOpen(db: { sale: { get: (id: string) => Promise<unknown> } }) {
  const rogue = new Dexie('solva-rogue')
  return [rogue, db.sale.get('s1')]
}
