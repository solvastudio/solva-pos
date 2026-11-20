export function renderChangelogEntry(version, dateIso, commits) {
  const datePart = String(dateIso).slice(0, 10)
  const features = []
  const fixes = []
  const breaking = []

  for (const raw of commits) {
    const line = String(raw ?? '').trim().split(/\r?\n/, 1)[0] ?? ''
    if (!line) continue
    if (/!:|BREAKING CHANGE/.test(raw)) {
      breaking.push(line)
    }
    if (/^feat(?:\([^)]*\))?!?:\s*/.test(line)) {
      features.push(line)
    } else if (/^(?:fix|perf|refactor)(?:\([^)]*\))?!?:\s*/.test(line)) {
      fixes.push(line)
    }
  }

  const lines = [`## ${version} (${datePart})`, '']
  if (breaking.length > 0) {
    lines.push('### Breaking Changes', ...breaking.map((b) => `- ${b}`), '')
  }
  if (features.length > 0) {
    lines.push('### Features', ...features.map((f) => `- ${f}`), '')
  }
  if (fixes.length > 0) {
    lines.push('### Fixes & Improvements', ...fixes.map((f) => `- ${f}`), '')
  }
  if (features.length === 0 && fixes.length === 0 && breaking.length === 0) {
    lines.push('- Maintenance release', '')
  }
  return `${lines.join('\n')}\n`
}

export function prependChangelog(existingContent, newEntry) {
  const header = '# Changelog\n\n'
  if (!existingContent || existingContent.trim().length === 0) {
    return `${header}${newEntry}`
  }
  const stripped = existingContent.startsWith('# Changelog')
    ? existingContent.replace(/^# Changelog\r?\n+/, '')
    : existingContent
  return `${header}${newEntry}${stripped}`
}
