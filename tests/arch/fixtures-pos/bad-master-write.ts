export async function overwriteCatalog(db: { product: { bulkPut: (rows: unknown[]) => Promise<void> } }) {
  await db.product.bulkPut([{ id: '1', name: 'Bad' }])
}
