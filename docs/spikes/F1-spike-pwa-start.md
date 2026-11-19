# Laporan Spike F1 — Start + PWA + Shell /pos Statis (OQ-A02)

## 1. Ringkasan dan Rekomendasi

Spike **F1** memvalidasi kelayakan integrasi `@tanstack/react-start` + `vite-plugin-pwa` (Strategi `injectManifest`, Workbox 7) + Service Worker per-tenant (`/$tenant/pos/`) menggunakan shell statis `/pos-shell.html` di direktori terpisah `D:\React\Tanstack start\solva-pos-spike-pwa\` tanpa menyentuh repo `solva-pos`.

Semua delapan pertanyaan teknis (**Q1–Q8**) berstatus **LULUS**. Kompatibilitas `vite-plugin-pwa@2.0.0` dengan `vite@8.3.5` terpasang bersih tanpa peer conflict, meskipun memerlukan satu plugin jembatan ringan (`pwaAfterStartBuild`) agar `sw.js` terbit setelah hook Vite 8 `buildApp` milik `@tanstack/react-start` selesai melakukan prerender `/pos-shell.html`.

**Rekomendasi tunggal: Opsi A — Native TanStack Start `spa` shell + `vite-plugin-pwa` (`injectManifest`) dengan `pwaAfterStartBuild()` + `PrecacheController` union-GC.** Total aset precache hanya **449.401 B raw / 143.929 B gzip (~140,6 KiB)** pada v1 (7 entri, ditambah `sw.js` **68.882 B raw / 17.889 B gzip**), jauh di bawah anggaran precache 2,5 MB dan anggaran awal 350 KB gzip.

---

## 2. Lingkungan (versi Node, npm, paket terpasang persis)

| Komponen | Versi Terpasang (Eksak) |
|---|---|
| OS / Shell | Windows / PowerShell |
| Node.js (`node -v`) | `v24.14.1` |
| npm (`npm -v`) | `11.11.0` |
| `react` / `react-dom` | `19.3.1` / `19.3.1` |
| `@tanstack/react-start` | `1.169.4` |
| `@tanstack/react-router` | `1.170.46` |
| `@tanstack/react-router-ssr-query` | `1.167.3` |
| `@tanstack/react-query` | `5.105.0` |
| `vite` / `@vitejs/plugin-react` | `8.3.5` / `6.3.0` |
| `tailwindcss` / `@tailwindcss/vite` | `4.3.3` / `4.3.3` |
| `vite-plugin-pwa` | `2.0.0` |
| `workbox-build` / `workbox-core` / `workbox-precaching` / `workbox-routing` / `workbox-window` | `7.4.1` |
| `dexie` | `4.4.7` |
| `zod` / `decimal.js` / `clsx` / `tailwind-merge` | `4.6.7` / `10.6.0` / `2.1.1` / `3.7.0` |
| `@playwright/test` (Chromium headless) | `1.65.1` |
| `typescript` | `5.9.3` |

---

## 3. Hasil Q1–Q8 (tabel: ID, lulus/gagal, bukti perintah+keluaran ringkas)

Semua verifikasi Q1–Q8 dijalankan lewat `node spike\verify-all.mjs` (Playwright Chromium terhadap `spike/rewrite-proxy.mjs` pada port `3199`) dan inspeksi hasil build `dist/client/`.

| ID | Pertanyaan / Uji | Status | Bukti Perintah & Keluaran Ringkas |
|---|---|---|---|
| **Q1** | `vite-plugin-pwa@2.0.0` terpasang dengan Vite 8 & `injectManifest` menghasilkan `sw.js` + `self.__WB_MANIFEST` tanpa memasukkan chunk `/admin` & `/join` | **LULUS** | `vite build` + cek `dist/client/assets` & `globIgnores: ['**/admin-*.js', '**/join-*.js']`: `admin-CrtScpe5.js` & `join-DSwT-uqH.js` ada di `dist/client/assets/`, namun `Q1/Q2/Q8 v1` `count: 7` (hanya `pos-shell.html`, 5 chunk JS non-admin/join, 1 CSS); `sw.js` **68.882 B raw / 17.889 B gzip**. |
| **Q2** | Shell statis `/pos-shell.html` dihasilkan saat build tanpa data tenant / slug | **LULUS** | Konfigurasi `tanstackStart({ spa: { enabled: true, maskPath: '/_shell/pos', prerender: { outputPath: '/pos-shell' } } })` menghasilkan `dist/client/pos-shell.html` (**1.951 B raw / 1.043 B gzip**). Uji Node `(Get-Content dist\client\pos-shell.html -Raw) -match 'slug\|tenant'` -> `False` (`has slug: false has data: false`). |
| **Q3** | Offline reload `/slugA/pos/` dan sub-route `/slugB/pos/x/y` dilayani `pos-shell.html` dari SW & hydrate membaca slug runtime | **LULUS** | `await context.setOffline(true)` di Playwright: `Q3 offline: {"slugAInfo":{"slug":"slugA","index":"POS Index Ready","transferSize":0},"slugBInfo":{"slug":"slugB","sub":"POS Subroute: x/y","transferSize":0},"navHeadersA":[{"url":"http://127.0.0.1:3199/slugA/pos/","fromSw":"1","status":200},{"url":"http://127.0.0.1:3199/slugB/pos/x/y","fromSw":"1","status":200}]}`. Header `X-From-SW: 1` terbukti pada kedua navigasi offline. |
| **Q4** | SW scope per-tenant (`/$tenant/pos/`) dari satu `/sw.js` tanpa `Service-Worker-Allowed` | **LULUS** | Registrasi `navigator.serviceWorker.register('/sw.js', { scope: '/slugA/pos/' })` & `/slugB/pos/` berhasil terpisah: `Q4 registrations & caches: {"scopes":["/slugA/pos/","/slugB/pos/"],"cachesList":["solva-manifests","solva-precache"]}`. |
| **Q5** | Multi-tenant version skew: `slugA` update ke v2, `slugB` tetap offline di v1 tanpa aset terhapus; saat `slugB` ikut update ke v2, aset v1 usang dibersihkan | **LULUS** | Setelah `slugA` ke v2 (`solva-precache` berisi **13 entri**: aset v1 + v2), `slugB` offline masih terbuka utuh: `Q5 slugB offline v1 after slugA updated to v2: {"slug":"slugB","index":"POS Index Ready"}`. Setelah `slugB` ikut update ke v2: `Q5 CACHES AFTER BOTH A & B UPDATED TO V2 (count=7)` (6 aset v1 ter-GC). |
| **Q6** | Alur prompt update (`waiting` -> `SKIP_WAITING` -> `controllerchange`) pada kedua registrasi | **LULUS** | `Q6 slugA before SKIP_WAITING (waiting present): POS Index Ready` -> `Q6 slugA after SKIP_WAITING + controllerchange: POS Index Ready v2`; `Q6 slugB after SKIP_WAITING + controllerchange: POS Index Ready v2`. |
| **Q7** | `createStart` me-rewrite server function ke `/<tenant>/_serverFn/...` dan reverse-proxy rewrite meneruskan ke `/_serverFn/...` + `X-Tenant-Slug` | **LULUS** | `src/start.ts` (`createStart(() => ({ serverFns: { fetch } }))`) memanggil `http://127.0.0.1:3199/slugA/_serverFn/ac301c2e8aec4f51953cd239a4aec84a18adfebb019e2f168fdd494d4a319d9c`; `spike/rewrite-proxy.mjs` meneruskan ke Start dengan `X-Tenant-Slug: slugA` dan menerima `pong: {"ok":true,"tenantSlug":"slugA"}`. |
| **Q8** | Ukuran bundle precache & CSS berada dalam batas anggaran (< 350 KB gzip awal / < 2,5 MB precache) | **LULUS** | Total v1 precache: **449.401 B raw / 143.929 B gzip** (~140,6 KiB): `index-*.js` (441.408 B / 140.315 B gz), `app-*.css` (4.230 B / 1.415 B gz), `pos-shell.html` (1.951 B / 1.043 B gz), 4 chunk route `_-*.js`/`routes-*.js`/`pos-*.js` total 1.812 B raw / 1.156 B gz. |

---

## 4. Opsi yang Layak (A/B/C) dengan data dan trade-off

| Opsi | Arsitektur | Data Terukur (Q8) | Kelebihan | Kekurangan / Trade-off |
|---|---|---|---|---|
| **Opsi A (Direkomendasikan)** | **Native TanStack Start `spa` prerender (`/pos-shell.html`) + `vite-plugin-pwa` `injectManifest` + hook `pwaAfterStartBuild()` + `PrecacheController` union-GC** | **449.401 B raw / 143.929 B gzip** (7 entri precache) + `sw.js` 68.882 B raw / 17.889 B gzip | Tetap memakai pipeline native `@tanstack/react-start` (manifest CSS/JS & entry hydration otomatis konsisten); nol duplikasi script build HTML custom; `pos-shell.html` bersih tanpa slug/data tenant. | Membutuhkan plugin kecil (~20 baris `pwaAfterStartBuild()`) pada Vite 8 hingga `vite-plugin-pwa` mendukung hook `buildApp`; wajib memakai `PrecacheController` manual (bukan `precacheAndRoute`) agar multi-tenant GC tidak menghapus aset v1 tenant lain. |
| **Opsi B** | Post-build script Node terpisah: merender atau menyalin HTML client shell sendiri + memanggil `workbox-build.injectManifest()` secara manual di script `package.json` | Mirip Opsi A (~144 KB gzip), karena menghasilkan manifest Workbox yang sama | Tidak bergantung pada plugin hooks Vite 8 milik `vite-plugin-pwa`. | Harus sinkron manual dengan struktur output Vite 8 / TanStack Start; memisahkan build PWA dari `vite build` standar; dev/preview flow lebih rentan drift dengan `vite.config.ts`. |
| **Opsi C** | Menjaga route `/$tenant/pos/*` tetap SSR/network-first dengan fallback HTML per-tenant di runtime cache SW (bukan satu `pos-shell.html` statis bersama) | Setiap tenant menyimpan HTML sendiri di runtime cache + JS/CSS bersama | Tidak membutuhkan `spa.prerender` `/pos-shell.html` ataupun union GC atas revisi `pos-shell.html` yang berbeda isi per tenant. | Melanggar prinsip **satu shell statis bebas-tenant**; meningkatkan risiko kebocoran/stale HTML per-tenant saat cold offline boot dan menambah kompleksitas cache invalidation per registrasi. |

---

## 5. Temuan Tak Terduga dan Risiko Tersisa (RSK-A18, RSK-A19)

1. **`vite-plugin-pwa@2.0.0` belum mengimplementasikan Vite 8 `buildApp` hook:**  
   `@tanstack/react-start` pada Vite 8 memakai Environment API (`builder.buildApp`), sedangkan plugin internal `vite-plugin-pwa:build` hanya memicu generasi SW di alur build Rollup klasik non-SSR. Akibatnya `vite build` awal tidak menerbitkan `dist/client/sw.js` sampai ditambahkannya plugin `pwaAfterStartBuild()` (`apply: 'build'`, `enforce: 'post'`, `buildApp: { order: 'post' }`) yang memanggil `pwaApi.generateSW()` sesudah `@tanstack/start-core` selesai menulis `dist/client/pos-shell.html`.
2. **`precacheAndRoute()` milik Workbox menghapus aset tenant v1 secara otomatis (RSK-A18 / RSK-A19):**  
   Pada uji Q5 pertama, memakai `precacheAndRoute(manifest)` menyebabkan SW v2 milik `slugA` menghapus entri `pos-shell.html?__WB_REVISION__=<v1>` dan chunk v1 dari `solva-precache` saat event `activate` (karena `PrecacheController.activate()` internal selalu menghapus semua key di luar manifest SW aktif). Hal ini memicu `net::ERR_FAILED` ketika `slugB` masih offline di v1. Menggantinya dengan `new PrecacheController(...)` + `pc.install(event)` + `registerRoute(new PrecacheRoute(pc))` (tanpa `pc.activate()`) dan hanya menjalankan GC union atas `solva-manifests` menyelesaikan masalah sepenuhnya.
3. **Risiko konsistensi CSS Tailwind v4 saat rebuild (`.gitignore`):**  
   Tanpa `.gitignore` yang mengecualikan `dist/`, Tailwind v4 memindai artefak build lama saat rebuild sehingga menghasilkan hash CSS berbeda antara SSR dan client (`404` pada CSS). Fase 00 telah memiliki `dist/` di `.gitignore`, dan hal ini wajib tetap dijaga pada lingkungan build CI/lokal.
4. **Risiko tersisa (RSK-A18, RSK-A19):**  
   - Jika dua tenant mendaftar pada scope berbeda namun tidak pernah melakukan navigasi ulang/update, entri manifest di `solva-manifests` tetap menyimpan referensi versi lama (disengaja agar tenant offline tetap aman, namun kapasitas cache perlu dipantau jika jumlah tenant di 1 perangkat sangat banyak).
   - Perubahan signature internal `vite-plugin-pwa` (`pwa.api.generateSW`) atau `@tanstack/start-plugin-core` (`buildApp` ordering) saat upgrade minor/major harus diuji ulang sebelum menaikkan versi di `package.json`.

---

## 6. Keputusan yang Diminta dari User

Pilih **Opsi A, B, atau C** untuk shell `/pos` (Fase 26).
