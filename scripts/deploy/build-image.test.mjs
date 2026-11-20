import { describe, expect, it } from 'vitest'
import { buildReleaseImage } from './build-image.mjs'

describe('build-image clean tag and gate enforcement', () => {
  it('rejects dirty working tree and non-single or missing tags on HEAD', async () => {
    await expect(
      buildReleaseImage({
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'status') return ' M src/index.ts\n'
          return ''
        },
      }),
    ).rejects.toThrow(/dirty/i)

    await expect(
      buildReleaseImage({
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'status') return ''
          if (cmd === 'git' && args[0] === 'tag') return ''
          return ''
        },
      }),
    ).rejects.toThrow(/exactly one git tag/i)
  })

  it('blocks rc tags for production target and succeeds for staging with clean sequence', async () => {
    await expect(
      buildReleaseImage({
        target: 'production',
        run: (cmd, args) => {
          if (cmd === 'git' && args[0] === 'status') return ''
          if (cmd === 'git' && args[0] === 'tag') return 'v1.6.0-rc.1\n'
          return ''
        },
      }),
    ).rejects.toThrow(/cannot be built for production/i)

    const calls = []
    const res = await buildReleaseImage({
      target: 'staging',
      harvestSourcemaps: () => ['assets/app.js.map'],
      findSourceMapUrlLeaks: () => [],
      run: (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`)
        if (cmd === 'git' && args[0] === 'status') return ''
        if (cmd === 'git' && args[0] === 'tag') return 'v1.6.0-rc.1\n'
        return ''
      },
    })

    expect(res).toEqual({
      tag: 'v1.6.0-rc.1',
      imageTag: 'solva-pos:v1.6.0-rc.1',
      target: 'staging',
      archivedMaps: ['assets/app.js.map'],
    })
    expect(calls).toContain('npm run test:unit -- src/lib/kernel')
    expect(calls).toContain('npm run test:db')
    expect(calls).toContain('npm run build')
    expect(calls).toContain('docker build --build-arg APP_VERSION=v1.6.0-rc.1 -t solva-pos:v1.6.0-rc.1 .')
  })

  it('aborts before docker build if sourceMappingURL leak is found in public assets', async () => {
    const calls = []
    await expect(
      buildReleaseImage({
        target: 'production',
        harvestSourcemaps: () => [],
        findSourceMapUrlLeaks: () => ['.output/public/assets/main.js'],
        run: (cmd, args) => {
          calls.push(cmd)
          if (cmd === 'git' && args[0] === 'status') return ''
          if (cmd === 'git' && args[0] === 'tag') return 'v1.6.0\n'
          return ''
        },
      }),
    ).rejects.toThrow(/leak/i)
    expect(calls).not.toContain('docker')
  })
})
