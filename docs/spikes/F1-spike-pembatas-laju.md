# Laporan Spike F1 — Verifikasi Pustaka Pembatas Laju (OQ-A26)

## 1. Ringkasan

Spike ini memverifikasi kesiapan `rate-limiter-flexible@11.5.0` (AD-40, OQ-A26) pada Node.js >= 22, keterpisahan dari bundel klien melalui aturan ESLint, pengendalian jam palsu dengan `vi.useFakeTimers()`, serta ketepatan kebijakan jeda progresif login (BR-RLM-003, V-40) di balik antarmuka [`Limiter`](../../src/lib/ratelimit/limiter.ts).

Seluruh verifikasi lulus. `rate-limiter-flexible@11.5.0` diputuskan **dipakai** untuk pembatas hitung-jendela di memori ([`window-limiter.ts`](../../src/server/auth/rate-limit/window-limiter.ts)), sedangkan kebijakan jeda progresif login di produksi memakai modul murni [`login-policy.ts`](../../src/lib/ratelimit/login-policy.ts) yang mengambil jadwal V-40 tunggal dari konstanta `LOGIN_DELAY_SCHEDULE_MS` di [`progressive.ts`](../../src/lib/ratelimit/progressive.ts).

## 2. Metadata pustaka

Hasil pemeriksaan metadata `rate-limiter-flexible`:

| Atribut | Nilai Terobservasi | Memenuhi Syarat |
|---|---|---|
| Paket | `rate-limiter-flexible` | Ya |
| Versi terpasang (pinned) | `11.5.0` | Ya (`-E`) |
| Lisensi | `ISC` | Ya (ISC/MIT) |
| Repositori | `https://github.com/animir/node-rate-limiter-flexible` | Ya |
| `engines` di metadata registry | Tidak tercantum (`undefined`) | Diverifikasi langsung di Node.js >= 22 |

## 3. Hasil uji (Node >= 22, bundle, jam palsu, kebijakan login progresif)

| Uji | Cara Uji (di repositori) | Hasil |
|---|---|---|
| **Hitung jendela & konsumsi poin** | `npm run test:unit -- src/server/auth/rate-limit/window-limiter.test.ts` (`RateLimiterMemory({ points: 2, duration: 10 })`) | **LULUS** — `consume` ke-1 mengembalikan `{ allowed: true, remaining: 1 }`, ke-2 `{ allowed: true, remaining: 0 }`, ke-3 ditolak `{ allowed: false, retryAfterMs }` (`1 <= retryAfterMs <= 10_000`), dan kunci terpisah (`key-2`) tetap mendapat sisa penuh (`remaining: 1`). |
| **Bundle-guard & ESLint** | Aturan `'rate-limiter-flexible'` di `eslint.config.js` + `npm run lint` + `npm run guard:bundle` | **LULUS** — impor dari `src/pos`, `src/components`, `src/hooks`, `src/queries`, `src/routes` (kecuali `api`), dan `src/lib/**` dicegah ESLint `no-restricted-imports` dan tidak masuk bundel POS klien. |
| **Jam palsu & `.reset()`** | `vi.useFakeTimers()` pada [`window-limiter.test.ts`](../../src/server/auth/rate-limit/window-limiter.test.ts) (`vi.advanceTimersByTime(10_001)` dan `limiter.reset('key-1')`) | **LULUS** — karena `RateLimiterMemory` membaca `Date.now()` internal (mengabaikan argumen `nowMs` pada `Limiter`), memajukan jam vitest sebesar `10_001` ms memulihkan kuota `key-1` menjadi `{ allowed: true, remaining: 1 }` setelah 1 konsumsi baru, dan `reset()` mengembalikan penuh `{ allowed: true, remaining: 2 }`. (Pada catatan awal spike sebelum digantikan tes Vitest ini, nilai `afterBlockRemaining: 1` merujuk ke sisa kuota setelah jendela waktu dipulihkan dan satu permintaan baru dikonsumsi, sedangkan tes saat ini memverifikasinya langsung via `remaining` & `retryAfterMs` di bawah `vi.useFakeTimers()`.) |
| **Jeda progresif (V-40, V-46)** | [`login-policy.test.ts`](../../src/lib/ratelimit/login-policy.test.ts) & [`progressive.test.ts`](../../src/lib/ratelimit/progressive.test.ts) + properti `fast-check` | **LULUS** — jadwal V-40 persis (`0/0/0/30_000/60_000/120_000/300_000/900_000` ms), mode waspada per-slug menggeser jeda ke kegagalan ke-2, `applyLoginSuccess` & kadaluarsa `resetAfterMs` mereset tanpa penguncian permanen, dan properti `fast-check` menjamin `0 <= retryAfterMs <= 900_000`. |

## 4. Keputusan: pustaka dipakai / implementasi kebijakan login

- **Keputusan utama (OQ-A26): `rate-limiter-flexible@11.5.0` DIPAKAI** untuk pembatas hitung-jendela berbasis jendela waktu ([`window-limiter.ts`](../../src/server/auth/rate-limit/window-limiter.ts), digunakan di [`limiters.ts`](../../src/server/auth/rate-limit/limiters.ts) per `device_id`, `IP + slug`, `slug`, `tenant_id`, dan semafor concurrency).
- **Kebijakan progresif login:** produksi memakai modul murni [`login-policy.ts`](../../src/lib/ratelimit/login-policy.ts) (diorkestrasi [`login-limiter.ts`](../../src/server/auth/rate-limit/login-limiter.ts) dengan `nowMs` tersuntik dan penyimpanan berkapasitas terbatas) yang membaca jadwal V-40 kanonis `LOGIN_DELAY_SCHEDULE_MS` dari [`progressive.ts`](../../src/lib/ratelimit/progressive.ts). Fungsi lama yang tidak terpakai (`onLoginFailure`, `onLoginSuccess`, `isBlocked`, `loginDelayMs`) di [`progressive.ts`](../../src/lib/ratelimit/progressive.ts) telah dihapus agar tidak ada duplikasi kebijakan.
- **Kontrak [`Limiter`](../../src/lib/ratelimit/limiter.ts):** didokumentasikan eksplisit bahwa implementasi berbasis `RateLimiterMemory` (`createWindowLimiter`) membaca `Date.now()` internal dan mengabaikan parameter `nowMs`, sehingga seluruh tes yang memajukan waktu wajib memakai `vi.useFakeTimers()`.
- **Cadangan:** apabila kelak dibutuhkan store terdistribusi atau penggantian pustaka, antarmuka `Limiter` tetap stabil sehingga adaptor `src/server/auth/rate-limit/` dapat diganti tanpa menyentuh pemanggil maupun `login-policy.ts`.

## 5. Dampak ke Fase 17

1. Adaptor server di [`src/server/auth/rate-limit/`](../../src/server/auth/rate-limit/limiters.ts) mengimplementasikan antarmuka `Limiter` ([`limiter.ts`](../../src/lib/ratelimit/limiter.ts)) di atas `RateLimiterMemory` dan menguji progresi waktu dengan `vi.useFakeTimers()` di [`window-limiter.test.ts`](../../src/server/auth/rate-limit/window-limiter.test.ts).
2. Pembatas login admin memakai [`login-policy.ts`](../../src/lib/ratelimit/login-policy.ts) + [`login-limiter.ts`](../../src/server/auth/rate-limit/login-limiter.ts) dengan kunci akun global ter-hash SHA-256 (`keyForAccount`, tanpa IP), dipadukan dengan lapisan `RateLimiterMemory` per `IP + slug` dan tracker per `slug`.
3. Aturan `eslint.config.js` menjamin `rate-limiter-flexible` tidak pernah masuk ke bundel klien (`src/pos`, `src/lib`, komponen UI).
4. Pembatas bawaan Better Auth tetap dinonaktifkan (`rateLimit.enabled = false`) agar tidak terjadi penghitungan ganda.
