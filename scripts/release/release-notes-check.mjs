const NUMERICAL_SENSITIVE_PREFIXES = [
  'src/lib/sales-calc',
  'src/lib/kernel/rounding',
  'src/modules/inventory/server/costing',
  'docs/PRD.md',
]

export function requiresNumericalReleaseNotes(changedFiles) {
  return changedFiles.some((filePath) => {
    const normalized = String(filePath).replace(/\\/g, '/')
    return NUMERICAL_SENSITIVE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  })
}

export function hasPopulatedNumericalSection(markdown) {
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    return false
  }
  const sectionMatch = /^##\s+(?:Perubahan angka|Numerical changes)\s*\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/im.exec(
    markdown,
  )
  if (!sectionMatch) return false
  const body = (sectionMatch[1] ?? '').trim()
  return body.length > 0
}

export function checkReleaseNotes({ tag, changedFiles, readReleaseNote }) {
  const needsNumericalNotes = requiresNumericalReleaseNotes(changedFiles)
  if (!needsNumericalNotes) {
    return { required: false, ok: true }
  }

  const content = readReleaseNote(tag)
  if (!content) {
    return {
      required: true,
      ok: false,
      reason: `Missing required release notes file docs/releases/${tag}.md for numerical changes`,
    }
  }
  if (!hasPopulatedNumericalSection(content)) {
    return {
      required: true,
      ok: false,
      reason: `docs/releases/${tag}.md must include a non-empty "## Perubahan angka" section`,
    }
  }

  return { required: true, ok: true }
}
