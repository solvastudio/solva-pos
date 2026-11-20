import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Download, Field, Input, Select } from '~/components/ui'
import type { ReportGroupBy } from '~/modules/reporting/shared'

export interface ReportOutletOption {
  readonly id: string
  readonly code: string
  readonly name: string
}

export interface ReportFiltersProps {
  readonly outlets: readonly ReportOutletOption[]
  readonly selectedOutletId: string
  readonly from: string
  readonly to: string
  readonly groupBy?: ReportGroupBy
  readonly showGroupBy?: boolean
  readonly loading?: boolean
  readonly busy?: boolean
  readonly onOutletChange: (outletId: string) => void
  readonly onFromChange: (from: string) => void
  readonly onToChange: (to: string) => void
  readonly onGroupByChange?: (groupBy: ReportGroupBy) => void
  readonly onSubmit: () => void | Promise<void>
  readonly onExportCsv?: () => void | Promise<void>
}

export function ReportFilters({
  outlets,
  selectedOutletId,
  from,
  to,
  groupBy = 'DAY',
  showGroupBy = false,
  loading = false,
  busy = false,
  onOutletChange,
  onFromChange,
  onToChange,
  onGroupByChange,
  onSubmit,
  onExportCsv,
}: ReportFiltersProps) {
  const { t } = useTranslation()
  const idPrefix = useId()

  return (
    <Card className="p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void onSubmit()
        }}
        className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('admin.report.filterOutletsLabel')} htmlFor={`${idPrefix}-outlet`}>
            <Select
              id={`${idPrefix}-outlet`}
              value={selectedOutletId}
              onValueChange={onOutletChange}
              options={[
                { value: '', label: t('admin.report.filterAllOutlets') },
                ...outlets.map((o) => ({
                  value: o.id,
                  label: `${o.code} — ${o.name}`,
                })),
              ]}
            />
          </Field>

          <Field label={t('admin.report.filterFromLabel')} htmlFor={`${idPrefix}-from`}>
            <Input
              id={`${idPrefix}-from`}
              type="date"
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
            />
          </Field>

          <Field label={t('admin.report.filterToLabel')} htmlFor={`${idPrefix}-to`}>
            <Input
              id={`${idPrefix}-to`}
              type="date"
              value={to}
              onChange={(e) => onToChange(e.target.value)}
            />
          </Field>

          {showGroupBy && onGroupByChange ? (
            <Field label={t('admin.report.filterGroupByLabel')} htmlFor={`${idPrefix}-group`}>
              <Select
                id={`${idPrefix}-group`}
                value={groupBy}
                onValueChange={(v) => onGroupByChange(v as ReportGroupBy)}
                options={[
                  { value: 'DAY', label: t('admin.report.groupDAY') },
                  { value: 'WEEK', label: t('admin.report.groupWEEK') },
                  { value: 'MONTH', label: t('admin.report.groupMONTH') },
                ]}
              />
            </Field>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            disabled={loading || busy}
          >
            {t('admin.report.showButton')}
          </Button>
          {onExportCsv ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              loading={loading}
              disabled={loading || busy}
              leadingIcon={<Download className="size-4" aria-hidden="true" />}
              onClick={() => void onExportCsv()}
            >
              {t('admin.report.exportCsvButton')}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  )
}
