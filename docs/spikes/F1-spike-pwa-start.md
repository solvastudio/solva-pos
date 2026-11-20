# Laporan Spike F1 — Start + PWA + Shell /pos Statis (OQ-A02)

## 1. Ringkasan dan Rekomendasi

Spike **F1** memvalidasi kelayakan integrasi `@tanstack/react-start` + `vite-plugin-pwa` (Strategi `injectManifest`, Workbox 7) + Service Worker per-tenant (`/$tenant/pos/`) menggunakan shell statis `/pos-shell.html` di direktori terpisah `D:\React\Tanstack start\solva-pos-spike-pwa\` tanpa menyentuh repo `solva-pos`.

Semua delapan pertanyaan teknis (**Q1–Q8**) berstatus **LULUS** pada uji Node `v24.14.1` maupun uji ulang di Node `v22.17.0` (`npm 10.9.2`, sesuai target `engines >=22.12.0`). `vite-plugin-pwa@2.0.0` terpasang bersih dengan `vite@8.3.5`, dan memerlukan satu plugin jembatan ringan (`pwaAfterStartBuild`) agar `sw.js` diterbitkan sesudah hook Vite 8 `buildApp` milik `@tanstack/react-start` selesai melakukan prerender `/pos-shell.html`.

**Rekomendasi tunggal: Opsi A — Prerender satu shell `/pos` saat build (`/pos-shell.html`) dipakai sebagai `navigateFallback` via `vite-plugin-pwa` (`injectManifest`) + `pwaAfterStartBuild()` + `PrecacheController` union-GC.** Biaya dasar bundle shell v1 tercatat **449.401 B raw / 143.929 B gzip (~140,6 KiB)** dalam 7 entri precache (hanya React + TanStack Start + placeholder minimal Dexie `spikeDb`; **tidak** memuat skema aplikasi, i18n, `zod`, `sales-calc`, font Plus Jakarta Sans, ikon Lucide, ataupun WASM barcode). Dibandingkan anggaran ARCHITECTURE (`<= 350 KB` gzip rute awal dan `<= 2,5 MB` total precache), biaya dasar ini menyisakan sekitar ~209 KB gzip ruang anggaran rute awal untuk seluruh kode aplikasi nyata; `sw.js` (**68.882 B raw / ~17,9 KB gzip**) berada di luar daftar precache.

---

## 2. Lingkungan (versi Node, npm, paket terpasang persis)

| Komponen | Versi / Kondisi Terpasang |
|---|---|
| OS / Shell uji | Windows / PowerShell *(batasan: bukan Linux Docker)* |
| Reverse-proxy Q7 | Proxy Node lokal `spike/rewrite-proxy.mjs` pada port `3199` *(batasan: bukan Nginx)* |
| Node.js / npm (uji awal) | `v24.14.1` / `11.11.0` |
| Node.js / npm (uji ulang target LTS) | `v22.17.0` / `10.9.2` — **LULUS** semua Q1–Q8 dengan ukuran bundle identik (`0 B` selisih) |
| `react` / `react-dom` | `19.3.1` / `19.3.1` |
| `@tanstack/react-start` | `1.169.4` |
| `@tanstack/react-router` | `1.170.46` |
| `@tanstack/react-router-ssr-query` | `1.167.3` |
| `@tanstack/react-query` | `5.105.0` |
| `vite` / `@vitejs/plugin-react` | `8.3.5` / `6.3.0` |
| `tailwindcss` / `@tailwindcss/vite` | `4.3.3` / `4.3.3` |
| `vite-plugin-pwa` | `2.0.0` |
| `workbox-build` / `workbox-core` / `workbox-precaching` / `workbox-routing` / `workbox-window` | `7.4.1` |
| `dexie` | `4.4.7` *(diimpor hanya sebagai placeholder minimal `spikeDb` untuk Q8)* |
| `zod` / `decimal.js` / `clsx` / `tailwind-merge` | `4.6.7` / `10.6.0` / `2.1.1` / `3.7.0` |
| `@playwright/test` (Chromium headless) | `1.65.1` |
| `typescript` | `5.9.3` |

---

## 3. Hasil Q1–Q8 (tabel: ID, lulus/gagal, bukti perintah+keluaran ringkas)

Semua verifikasi Q1–Q8 dijalankan lewat `node spike\verify-all.mjs` (Playwright Chromium terhadap `spike/rewrite-proxy.mjs`) di Node `v24.14.1` dan diulang di Node `v22.17.0`, serta inspeksi langsung hasil `dist/client/`.

| ID | Pertanyaan / Uji | Status | Bukti Perintah & Keluaran Ringkas |
|---|---|---|---|
| **Q1** | `vite-plugin-pwa@2.0.0` terpasang dengan Vite 8 & `injectManifest` menghasilkan `sw.js` + `self.__WB_MANIFEST` tanpa memasukkan chunk `/admin` & `/join` | **LULUS** | `dist/client/assets/` memuat `admin-CrtScpe5.js` dan `join-DSwT-uqH.js`; `self.__WB_MANIFEST` (dengan `globIgnores: ['**/admin-*.js', '**/join-*.js']`) berisi **7 entri** (`pos-shell.html`, 5 chunk JS, 1 CSS) tanpa keduanya. Berkas `dist/client/sw.js` berukuran **68.882 B raw / 17.889 B gzip**. |
| **Q2** | Shell statis `/pos-shell.html` dihasilkan saat build tanpa data tenant / slug | **LULUS** | `tanstackStart({ spa: { enabled: true, maskPath: '/_shell/pos', prerender: { outputPath: '/pos-shell' } } })` menghasilkan `dist/client/pos-shell.html` (**1.951 B raw / 1.043 B gzip**). Uji PowerShell `Select-String -Path 'dist\client\pos-shell.html' -Pattern 'slug','tenant'` -> `matches=0`; uji Node `/slugA\|slugB/.test(shell)` dan `/POS Index/.test(shell)` -> `has slug: false has data: false`. |
| **Q3** | Offline reload `/slugA/pos/` dan sub-route `/slugB/pos/x/y` dilayani `pos-shell.html` dari SW & hydrate membaca slug runtime | **LULUS** | `await context.setOffline(true)` di Playwright: `Q3 offline: {"slugAInfo":{"slug":"slugA","index":"POS Index Ready","transferSize":0},"slugBInfo":{"slug":"slugB","sub":"POS Subroute: x/y","transferSize":0},"navHeadersA":[{"url":"http://127.0.0.1:3199/slugA/pos/","fromSw":"1","status":200},{"url":"http://127.0.0.1:3199/slugB/pos/x/y","fromSw":"1","status":200}]}`. Header `X-From-SW: 1` terbukti pada kedua navigasi offline. |
| **Q4** | SW scope per-tenant (`/$tenant/pos/`) dari satu `/sw.js` tanpa `Service-Worker-Allowed` | **LULUS** | Registrasi `navigator.serviceWorker.register('/sw.js', { scope: '/slugA/pos/' })` & `/slugB/pos/` terpisah: `Q4 registrations & caches: {"scopes":["/slugA/pos/","/slugB/pos/"],"cachesList":["solva-manifests","solva-precache"]}`. |
| **Q5** | Multi-tenant version skew: `slugA` update ke v2, `slugB` tetap offline di v1 tanpa aset terhapus; saat `slugB` ikut update ke v2, aset v1 usang dibersihkan | **LULUS** | Setelah `slugA` ke v2 (`solva-precache` berisi **13 entri**: aset v1 + v2), `slugB` offline tetap terbuka utuh: `Q5 slugB offline v1 after slugA updated to v2: {"slug":"slugB","index":"POS Index Ready"}`. Setelah `slugB` ikut update ke v2: `Q5 CACHES AFTER BOTH A & B UPDATED TO V2 (count=7)` (6 aset v1 ter-GC). |
| **Q6** | Alur prompt update (`waiting` -> `SKIP_WAITING` -> `controllerchange`) pada kedua registrasi | **LULUS** *(uji mentah)* | Diuji dengan `navigator.serviceWorker` + `reg.waiting?.postMessage({ type: 'SKIP_WAITING' })` + `controllerchange` (bukan `workbox-window`): `Q6 slugA before SKIP_WAITING (waiting present): POS Index Ready` -> `Q6 slugA after SKIP_WAITING + controllerchange: POS Index Ready v2`; `Q6 slugB after SKIP_WAITING + controllerchange: POS Index Ready v2`. Implementasi `workbox-window` (`Workbox` / `messageSkipWaiting`) di Fase 26 wajib diuji ulang. |
| **Q7** | `createStart` me-rewrite server function ke `/<tenant>/_serverFn/...` dan reverse-proxy rewrite meneruskan ke `/_serverFn/...` + `X-Tenant-Slug` | **LULUS** | `src/start.ts` (`createStart(() => ({ serverFns: { fetch } }))`) memanggil `http://127.0.0.1:3199/slugA/_serverFn/ac301c2e8aec4f51953cd239a4aec84a18adfebb019e2f168fdd494d4a319d9c`; `spike/rewrite-proxy.mjs` meneruskan ke Start dengan `X-Tenant-Slug: slugA` dan menerima `pong: {"ok":true,"tenantSlug":"slugA"}`. |
| **Q8** | Biaya dasar bundle precache & CSS terhadap anggaran (`<= 350 KB` gzip rute awal, `<= 2,5 MB` total precache) | **LULUS** *(biaya dasar)* | Total precache v1: **449.401 B raw / 143.929 B gzip** (~140,6 KiB): `index-*.js` (441.408 B / 140.315 B gz), `app-*.css` (4.230 B / 1.415 B gz), `pos-shell.html` (1.951 B / 1.043 B gz), 4 chunk route `_-*.js`/`routes-*.js`/`pos-*.js` (total 1.812 B / 1.156 B gz). Hanya memuat React + TanStack Start + placeholder `spikeDb` Dexie (tanpa i18n, zod, `sales-calc`, font, Lucide, WASM barcode). `sw.js` (**68.882 B raw / ~17,9 KB gzip**) berada di luar precache. |

---

## 4. Opsi yang Layak (A/B/C) dengan data dan trade-off

Definisi Opsi A/B/C di bawah diselaraskan dengan ARCHITECTURE §2.3 dan `plans/02` (catatan pemetaan: isi "skrip post-build" yang sempat disebut Opsi B pada draf awal kini berada di **Opsi C**, sedangkan **Opsi B** merujuk ke `NetworkFirst` tanpa shell statis).

| Opsi | Arsitektur | Data / Pengukuran | Kelebihan | Kekurangan / Trade-off |
|---|---|---|---|---|
| **Opsi A (Direkomendasikan)** | Prerender satu shell `/pos` (`/pos-shell.html`) saat build via `tanstackStart({ spa: ... })`, dipakai sebagai `navigateFallback` dengan `vite-plugin-pwa` (`injectManifest`) + `pwaAfterStartBuild()` + `PrecacheController` union-GC | Biaya dasar terukur **449.401 B raw / 143.929 B gzip** (~140,6 KiB; 7 entri precache) + `sw.js` 68.882 B raw / 17.889 B gzip *(sisa anggaran ~209 KB gzip untuk kode app nyata)* | Tetap memakai pipeline native `@tanstack/react-start` (hash CSS/JS & entry hydration otomatis konsisten); `pos-shell.html` bebas data & slug tenant; nol duplikasi skrip HTML kustom. | Bergantung pada plugin jembatan ~20 baris (`pwaAfterStartBuild()`) selama `vite-plugin-pwa` belum mendukung Vite 8 `buildApp`; wajib memakai `PrecacheController` manual (bukan `precacheAndRoute`) agar multi-tenant GC aman. |
| **Opsi B** | Tanpa shell statis: `NetworkFirst` pada navigasi `/$tenant/pos/*` dengan fallback ke halaman ter-cache *(varian B: menyimpan dokumen HTML per tenant di runtime cache SW)* | **Tidak diukur / tidak diuji** di spike F1 *(hanya analisis)* | Tidak membutuhkan `spa.prerender` `/pos-shell.html` maupun plugin jembatan Vite 8 untuk prerender HTML. | Saat cold start online lambat sebelum timeout, fallback dapat terlambat; varian B yang menyimpan HTML per tenant berisiko mencampur/menyimpan HTML stale antar-kunjungan dan tidak menjamin cold start offline bebas jaringan apabila cache runtime belum terisi pada kunjungan pertama. |
| **Opsi C** | Skrip build kustom (`scripts/build-pos-shell.mjs`) yang menyalin/membentuk HTML hasil Start secara pasca-build lalu menyuntikkannya ke manifest Workbox (`workbox-build`) | **Tidak diukur langsung** *(secara ukuran diperkirakan sebanding dengan biaya dasar Opsi A, ~140,6 KiB gzip)* | Memisahkan generasi `pos-shell.html` & `sw.js` dari hook internal plugin Vite (`buildApp` / `pwa.api.generateSW`). | Harus sinkron manual dengan struktur output Vite 8 / TanStack Start dan hash aset SSR/client; memisahkan alur PWA dari `vite build` standar sehingga dev/preview lebih rentan drift dengan `vite.config.ts`. |

---

## 5. Temuan Tak Terduga dan Risiko Tersisa (RSK-A18, RSK-A19)

1. **Ketergantungan `pwaAfterStartBuild()` pada Vite 8 `buildApp` & versi paket:**  
   `@tanstack/react-start` pada Vite 8 memakai Environment API (`builder.buildApp`), sedangkan plugin internal `vite-plugin-pwa:build` hanya memicu generasi SW di alur build Rollup non-SSR sehingga `sw.js` awalnya tidak terbit. Plugin jembatan `pwaAfterStartBuild()` (`apply: 'build'`, `enforce: 'post'`, `buildApp: { order: 'post' }`) bergantung eksplisit pada urutan hook internal (`buildApp`, `pwa.api.generateSW`) dan kombinasi versi yang diuji: `@tanstack/react-start@1.169.4`, `vite-plugin-pwa@2.0.0`, `vite@8.3.5`. **Checklist wajib:** setiap upgrade versi salah satu dari ketiga paket ini wajib mengulang uji Q1/Q2.
2. **RSK-A18 (perilaku cache bersama & pembersihan lintas pendaftaran) — teratasi di spike:**  
   Pada uji Q5 pertama, memakai `precacheAndRoute(manifest)` menyebabkan SW v2 milik `slugA` memanggil `PrecacheController.activate()` internal sehingga menghapus entri `pos-shell.html?__WB_REVISION__=<v1>` dan chunk v1 dari cache bersama `solva-precache`. Akibatnya `slugB` yang masih offline di v1 gagal memuat (`net::ERR_FAILED`). Menggantinya dengan `new PrecacheController(...)` + `pc.install(event)` + `registerRoute(new PrecacheRoute(pc))` (tanpa memanggil `pc.activate()`) dan hanya membersihkan `solva-precache` berdasarkan union manifest aktif di `solva-manifests` menjaga aset `slugB` tetap utuh dan membersihkan 6 entri v1 setelah `slugB` ikut update ke v2.
3. **RSK-A19 (halaman pemulihan saat shell rusak & "Reset aplikasi" lintas tenant) — belum diuji di spike ini:**  
   Alur pemulihan (`recovery.html` statis di precache, penanda `BOOT_OK`, penahanan cleanup versi terakhir yang berfungsi, dan tombol "Reset aplikasi") **belum diuji di spike F1** dan menjadi cakupan implementasi **Fase 26 / Fase 30**. Implikasi desain wajib: tindakan "Reset aplikasi" pada satu tenant **hanya boleh menghapus entri `solva-manifests` milik pendaftaran tenant tersebut (lalu memicu GC union) serta storage/DB tenant bersangkutan**, dan **tidak boleh** menghapus seluruh `solva-precache` atau data tenant lain.
4. **Risiko tersisa & batasan lingkungan:**  
   - **Batasan lingkungan Q7 & OS:** Uji proxy `/<tenant>/_serverFn/...` berjalan menggunakan Node proxy `spike/rewrite-proxy.mjs` di Windows/PowerShell, bukan Nginx di container Linux Docker; konfigurasi `proxy_pass` Nginx tetap perlu diverifikasi saat setup deployment.
   - **Batasan Q6 (`workbox-window`):** Q6 diuji dengan `postMessage` mentah; migrasi ke `workbox-window` (`Workbox` / `messageSkipWaiting`) di Fase 26 perlu diuji ulang lewat Playwright.
   - **Konsistensi Tailwind v4 & `.gitignore`:** Tanpa `.gitignore` mengecualikan `dist/`, Tailwind v4 memindai output build lama dan memicu mismatch hash CSS antara SSR dan client (`404`). `.gitignore` proyek sudah mengecualikan `dist/` dan harus tetap terjaga di CI/lokal.
   - **Akumulasi manifest stale:** Tenant yang tidak pernah dibuka kembali setelah update rilis akan tetap menahan daftar aset lamanya di `solva-manifests` hingga registrasi tersebut diperbarui atau dicabut.

---

## 6. Keputusan User (Final — 2026-11-20)

- **Keputusan:** **Opsi A DIPILIH** oleh user pada **2026-11-20** dan telah diimplementasikan pada **Fase 26** (`/pos-shell.html` sebagai `navigateFallback` via `vite-plugin-pwa` `injectManifest` + `pwaAfterStartBuild()` + `PrecacheController` union-GC lintas tenant).
- **Catatan pemetaan label (revisi draf awal):** skema "skrip pasca-build" yang sempat dilabeli Opsi B pada draf pertama dokumen ini tetap dipetakan sebagai **Opsi C**, sementara **Opsi B** adalah pendekatan tanpa shell statis (`NetworkFirst` navigasi `/$tenant/pos/*`). Pilihan user (**Opsi A**) merujuk pada definisi baku di Bagian 4 dan `docs/ARCHITECTURE.md` §2.3.
