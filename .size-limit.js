import {
  getPosInitialAssetPaths,
  POS_INITIAL_GZIP_LIMIT_BYTES,
} from './scripts/ci/bundle-guard.mjs'

export default [
  {
    name: 'pos-initial-js-css',
    path: getPosInitialAssetPaths(),
    limit: `${POS_INITIAL_GZIP_LIMIT_BYTES} B`,
    gzip: true,
  },
]
