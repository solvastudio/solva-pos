export interface InvoiceGapRow {
  readonly id: string
  readonly outletId: string
  readonly registerId: string
  readonly docType: 'INVOICE' | 'CREDIT_NOTE'
  readonly period: string
  readonly seqFrom: number
  readonly seqTo: number
  readonly origin: 'DETECTED' | 'RECOVERY_DECLARED'
  readonly status: 'OPEN' | 'EXPLAINED' | 'FILLED'
  readonly reasonCode: string | null
  readonly reasonText: string | null
  readonly explainedBy: string | null
  readonly explainedAt: string | null
  readonly filledAt: string | null
  readonly detectedAt: string
}
