# Laporan Spike F1 — Verifikasi Pustaka Pembatas Laju (OQ-A26)

## 1. Ringkasan

Spike ini memverifikasi kesiapan `rate-limiter-flexible@11.5.0` (AD-40, OQ-A26) pada Node 22 (`v22.17.0`), keterpisahan dari bundel klien melalui aturan ESLint, pengendalian jam palsu, serta ketepatan kebijakan jeda progresif login (BR-RLM-003, V-40) di balik antarmuka `Limiter`.

Seluruh verifikasi lulus. `rate-limiter-flexible@11.5.0` diputuskan **dipakai** untuk pembatas hitung-jendela di memori (dan store Postgres/Redis bila kelak multi-instance), sedangkan kebijakan jeda progresif tetap memakai modul murni [progressive.ts](file:///d:/React/Tanstack%20start/solva-pos/src/lib/ratelimit/progressive.ts) dengan jam disuntik.

## 2. Metadata pustaka

Hasil perintah `npm view rate-limiter-flexible version license repository.url time.modified dist-tags engines --json`:

| Atribut | Nilai Terobservasi | Memenuhi Syarat |
|---|---|---|
| Paket | `rate-limiter-flexible` | Ya |
| Versi terpasang (pinned) | `11.5.0` (`dist-tags.latest: "11.5.0"`) | Ya (`-E`) |
| Lisensi | `ISC` | Ya (ISC/MIT) |
| Repositori | `git+https://github.com/animir/node-rate-limiter-flexible.git` | Ya |
| Pembaruan terakhir (`time.modified`) | `2026-11-15T18:36:42.412Z` (< 12 bulan terakhir) | Ya |
| `engines` di metadata registry | Tidak tercantum (`undefined`) | Diverifikasi manual di Node 22 |

## 3. Hasil uji (Node 22, bundle, jam palsu, jeda progresif)

| Uji | Cara Uji | Hasil |
|---|---|---|
| **Kompatibilitas Node 22** | `node scripts/lib/rlf-smoke.mjs` di Node `v22.17.0`: `RateLimiterMemory({ points: 3, duration: 60 })`, `consume('k')` 4× | **LULUS** — `blocked after 3: true msBeforeNext: 60000` (percobaan ke-4 melempar objek berisi `msBeforeNext`). |
| **Bundle-guard & ESLint** | Cek impor di `src/` + penambahan grup `'rate-limiter-flexible'` ke `CLIENT_SERVER_PATTERNS` pada `eslint.config.js` + `npm run lint` | **LULUS** — `src_imports=0`; impor dari `src/pos`, `src/components`, `src/hooks`, `src/queries`, `src/routes` (kecuali `api`), dan `src/lib/**` dicegah ESLint `no-restricted-imports`. |
| **Jam palsu & `.block()`** | Overwrite `Date.now` pada skrip asap Node 22 (`RateLimiterMemory({ points: 2, duration: 10 })` + `block('prog', 30)`) | **LULUS** — `fakeClock: {"blockedAtT0":true,"afterAdvanceRemaining":1,"blockMs":30000,"afterBlockRemaining":1}`. Pustaka membaca `Date.now()` sehingga adaptor di Fase 17 dapat diuji deterministik dengan `vi.useFakeTimers()`. |
| **Jeda progresif (V-40)** | `npm run test:unit` menjalankan `src/lib/ratelimit/progressive.test.ts` (4 tes unit + properti `fast-check`) | **LULUS** — jadwal V-40 persis (`0/0/0/30_000/60_000/120_000/300_000/900_000` ms), `isBlocked` tepat batas, `onLoginSuccess` mereset (tanpa penguncian permanen), serta properti `fast-check` monoton tak turun dan `<= 900_000` ms. |

## 4. Keputusan: pustaka dipakai / cadangan buatan sendiri

- **Keputusan utama (OQ-A26): `rate-limiter-flexible@11.5.0` DIPAKAI** untuk pembatas hitung-jendela berbasis jendela waktu (`RateLimiterMemory` per `device_id`, `IP + slug`, `slug`, `tenant_id`, dan pembatas global push).
- **Kebijakan progresif login:** memakai implementasi murni buatan sendiri di [progressive.ts](file:///d:/React/Tanstack%20start/solva-pos/src/lib/ratelimit/progressive.ts) (dengan `nowMs` disuntik) yang dipadukan bersama penyimpanan memori terbatas (`<= 10.000` entri) di balik antarmuka [limiter.ts](file:///d:/React/Tanstack%20start/solva-pos/src/lib/ratelimit/limiter.ts). Ini memastikan jadwal V-40 dan mode waspada per-slug deterministik serta bebas ketergantungan internal timer.
- **Cadangan:** apabila di kemudian hari ditemukan kendala pada `rate-limiter-flexible`, antarmuka `Limiter` tetap sama sehingga adaptor `src/server/auth/rate-limit/` dapat diganti tanpa menyentuh pemanggil maupun kebijakan progresif.

## 5. Dampak ke Fase 17

1. Adaptor server di `src/server/auth/rate-limit/` mengimplementasikan antarmuka `Limiter` ([limiter.ts](file:///d:/React/Tanstack%20start/solva-pos/src/lib/ratelimit/limiter.ts)) di atas `RateLimiterMemory` dan men-tes integrasinya memakai `vi.useFakeTimers()`.
2. Pembatas login admin memakai [progressive.ts](file:///d:/React/Tanstack%20start/solva-pos/src/lib/ratelimit/progressive.ts) dengan kunci akun global (tanpa IP), dipadukan dengan lapisan `RateLimiterMemory` per `slug` dan jaring per `IP + slug`.
3. Aturan `eslint.config.js` menjamin `rate-limiter-flexible` tidak pernah masuk ke bundel klien (`src/pos`, `src/lib`, komponen UI).
4. Pembatas bawaan Better Auth tetap dinonaktifkan (`rateLimit.enabled = false`) agar tidak terjadi penghitungan ganda.
