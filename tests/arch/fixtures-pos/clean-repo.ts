export async function readProductSafely(db: { product: { get: (id: string) => Promise<unknown> } }) {
  return db.product.get('p1')
}
