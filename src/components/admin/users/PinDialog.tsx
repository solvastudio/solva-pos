import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CircleAlert, Dialog, Field, Input, useToast } from '~/components/ui'
import { resetPinFn, setPinFn } from '~/functions/identity/pin.fn'
import { validatePin, type MemberDirectoryView } from '~/modules/identity/shared'

export interface PinDialogProps {
  tenantSlug: string
  target: MemberDirectoryView | null
  onOpenChange: (open: boolean) => void
}

function pinPolicyMessageKey(
  reason: 'LENGTH' | 'NOT_DIGITS' | 'WEAK',
): 'admin.users.pin.policyWeak' | 'admin.users.pin.policyDigits' | 'admin.users.pin.policyLength' {
  if (reason === 'WEAK') return 'admin.users.pin.policyWeak'
  if (reason === 'NOT_DIGITS') return 'admin.users.pin.policyDigits'
  return 'admin.users.pin.policyLength'
}

export function PinDialog({ tenantSlug, target, onOpenChange }: PinDialogProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const inputId = useId()

  const [pin, setPin] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setPin('')
      setErrorMsg(null)
    }
  }, [target])

  const isReset = target ? target.pinStatus !== 'unset' : false

  const mutation = useMutation({
    retry: 0,
    mutationFn: async () => {
      if (!target) throw new Error('Missing target member')
      const fn = isReset ? resetPinFn : setPinFn
      return fn({ data: { userId: target.appUserId, pin } })
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setErrorMsg(t(res.errorKey as never, { defaultValue: t('admin.users.failed') }))
        return
      }
      setPin('')
      void queryClient.invalidateQueries({ queryKey: ['identity', tenantSlug, 'members'] })
      toast.show({ tone: 'success', message: t('admin.users.pin.saved') })
      onOpenChange(false)
    },
    onError: () => {
      setErrorMsg(t('admin.users.failed'))
    },
  })

  function handlePinChange(raw: string) {
    const cleaned = raw.replace(/\D/g, '').slice(0, 6)
    setPin(cleaned)
    if (cleaned.length > 0) {
      const check = validatePin(cleaned)
      setErrorMsg(check.ok ? null : t(pinPolicyMessageKey(check.reason)))
    } else {
      setErrorMsg(null)
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const check = validatePin(pin)
    if (!check.ok) {
      setErrorMsg(t(pinPolicyMessageKey(check.reason)))
      return
    }
    setErrorMsg(null)
    mutation.mutate()
  }

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={onOpenChange}
      title={
        target
          ? t(isReset ? 'admin.users.pin.resetTitle' : 'admin.users.pin.setTitle', {
              name: target.displayName,
            })
          : ''
      }
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form={`${inputId}-form`}
            variant="primary"
            size="md"
            loading={mutation.isPending}
          >
            {t('admin.users.pin.save')}
          </Button>
        </>
      }
    >
      <form id={`${inputId}-form`} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label={t('admin.users.pin.inputLabel')}
          htmlFor={inputId}
          hint={t('admin.users.pin.hint')}
          error={errorMsg ?? undefined}
        >
          <Input
            id={inputId}
            kind="pin"
            maxLength={6}
            value={pin}
            invalid={Boolean(errorMsg)}
            onChange={(e) => handlePinChange(e.target.value)}
            autoFocus
          />
        </Field>
        {errorMsg ? (
          <div className="sr-only" role="status">
            <CircleAlert className="size-4" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        ) : null}
      </form>
    </Dialog>
  )
}
