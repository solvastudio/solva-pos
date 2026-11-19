# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status proyek: masih tahap spesifikasi

Repo ini **belum berisi kode aplikasi**, `package.json`, atau konfigurasi apa pun. Isinya hanya dokumen di `docs/`. Konsekuensinya:

- **Perintah build / lint / test / dev server belum ada.** Jangan mengarang perintah `npm`/`pnpm`. Setelah proyek di-scaffold, tambahkan perintah yang sebenarnya ke bagian ini.
- **Jangan membuat kode aplikasi, struktur folder, atau file konfigurasi** sebelum user menyuruh. Struktur folder pada `docs/ARCHITECTURE.md` Bab 8 adalah *blueprint*, bukan instruksi untuk membuatnya sekarang.
- Folder `D:\React\Tanstack router\financeDashboard` adalah referensi struktur dan pola (logging, layering, rilis). **Hanya dibaca, jangan diubah.**

Solva POS = POS web **offline-first, multi-tenant**, untuk F&B + retail. Repo git: `solvastudio/solva-pos` (branch `main`).

## Dokumen sumber kebenaran

Semua dokumen berbahasa Indonesia (istilah teknis tetap Inggris). Ditulis oleh sesi terpisah; rujuk dengan **ID**, jangan menyalin isinya.

| Dokumen | Isi | Kapan dibuka |
|---|---|---|
| `docs/PRD.md` | Aturan bisnis: `KEP` (keputusan), `AP` (prinsip), `BR-<DOMAIN>-nnn`, `FR`, `NFR`, `EC` (edge case), `FLOW`, `RSK`, `OQ`; Lampiran D = vektor uji kanonik V-01…V-30 | Sebelum menulis/mengubah perilaku bisnis |
| `docs/SCHEMA.md` | Tabel PostgreSQL, store Dexie, kolom sinkronisasi, RLS, katalog enum (Lampiran A) dan tipe perintah push (Lampiran B) | Sebelum menyentuh data/migrasi |
| `docs/ARCHITECTURE.md` | Keputusan `AD-nn`, sync engine, auth, rate limit, versioning, error management, blueprint folder (Bab 8), aturan impor antar lapisan | Sebelum menentukan letak/struktur kode |
| `docs/DESIGN.md` | Layar `SCR-*`, komponen `CMP-*`, design token (Bab 2, 8, Lampiran C), mikrocopy i18n, aksesibilitas | Sebelum membuat UI |

**Aturan konflik:** PRD menang untuk aturan bisnis; PRD, SCHEMA, dan DESIGN menang atas ARCHITECTURE (selisih dicatat di ARCHITECTURE Bab 11). Tag status: `DISEPAKATI` (keputusan user, jangan dibantah ulang), `DIUSULKAN` (boleh diubah, dampak kecil), `PERLU KONFIRMASI` (belum diputuskan; daftar di PRD Bab 15, ARCHITECTURE Bab 13, SCHEMA Bab 9–10). Bila ragu atau menemukan celah/kontradiksi antar dokumen, **tandai `PERLU KONFIRMASI` dan tanyakan ke user, jangan menebak**. Bila user memutuskan sesuatu, perbarui dokumen yang berwenang, jangan hanya mengingatnya.

## Stack yang diputuskan

TanStack Start + React + TypeScript + TanStack Query · Tailwind v4 (tanpa shadcn) · PostgreSQL 18 (self-host VPS, Docker Compose) + Row Level Security · Drizzle ORM (migrasi additive-only) · Better Auth (plugin *organization*) · Dexie (IndexedDB) + outbox custom · Workbox via `vite-plugin-pwa` (`injectManifest`) · Zod · UUIDv7 · i18next (id/en) · Node 22 (keputusan user; ARCHITECTURE hanya menulis "Node LTS" dan kompatibilitas pustaka dengan Node 22 masih `VERIFIKASI`). Rate limit: Nginx + pustaka di aplikasi (kandidat `rate-limiter-flexible`, final setelah spike F1). Detail versi paket: ARCHITECTURE §2.6.

## Arsitektur (gambaran besar)

**Modular monolith, satu aplikasi, satu deployable, satu PostgreSQL** (AP-12, AD-01). Rute (PRD §5.3, ARCHITECTURE §1.7):

- `/<slug>/admin`: back-office, SSR, **online-only**, pintu RPC = server function (`createServerFn`) + TanStack Query. Satu-satunya tempat CRUD master data.
- `/<slug>/pos`: SPA offline (`ssr: false`), membaca master dari Dexie, bicara ke server lewat API JSON bervers `/api/pos/v1/*` (tanpa slug; tenant dari token device).
- `/<slug>` polos = pemilih Terminal Kasir/Back-office; `/<slug>/join` dan `/<slug>/reset` = halaman publik penukaran kode; `/platform` = admin platform (akun terpisah); `/` = 404.

**Alur data satu arah** (AP-04): master turun (server → device, **pull** dengan counter versi per tenant `tenant_sync`, cursor `(version, id)`, tombstone ikut); transaksi naik (device → server, **push** outbox FIFO per register). Finalisasi penjualan = **satu perintah atomik idempoten** `FinalizeSale` (key = UUIDv7 buatan client) yang diproses server dalam satu transaksi. Server adalah otoritas (stok, HPP, nomor final, flag); client hanya pencatat fakta awal. Kegagalan *bisnis* (stok minus, harga beda, produk nonaktif) **diterima sebagai fakta** lalu di-flag, bukan ditolak (AP-02, BR-SYN-030).

**Paket bersama client + server** (`lib/kernel`, `lib/sales-calc`, `lib/contracts`; AP-06/AD-15) menjamin struk offline = catatan server; diuji dengan vektor V-01…V-30 (PRD Lampiran D). Kode harus deterministik (waktu/acak disuntik; tidak ada `Date.now()` dsb. di kernel).

**Isolasi tenant:** RLS `FORCE` per transaksi (`set_config('app.tenant_id', …, true)`, peran `solva_app` `NOBYPASSRLS`, FK komposit `(tenant_id, x_id)`). Tenant otoritatif = sesi (admin) atau token device (POS); **slug di URL hanya petunjuk yang dicocokkan, bukan sumber tenant**. Di device, Dexie dan semua penanda lokal dinamai `tenant_id` (AD-34).

**Modul server** di `src/modules/<m>/` (blueprint): `identity`, `catalog`, `sales`, `shift`, `inventory`, `fnb`, `sync`, `audit`, `reporting`, dengan `public.ts` (antarmuka server) dan `shared.ts` (isomorfik). Arah dependensi hanya ke bawah; modul `sync` memanggil modul bisnis lewat registry/komposisi (`server/composition.ts`), bukan impor. Penulisan master hanya lewat `sync.writeMaster` (BR-ARC-006). Aturan impor lengkap: ARCHITECTURE §8.4.

## Aturan yang sering terlanggar

- **Uang = integer** (`bigint` di PG, bilangan bulat aman di JS); **kuantitas = desimal** (`numeric(18,4)` di PG, **string** kanonik di JSON/Dexie). **Tidak pernah float**, tidak pernah `NUMERIC` untuk uang. Pecahan dibulatkan di titik terdefinisi (half-up; alokasi largest remainder), **hasil disimpan dan tidak dihitung ulang** (AP-05, BR-MNY-*, SCHEMA §1.3).
- **Semua timestamp UTC (`timestamptz`)** + `business_date` yang dihitung sekali saat transaksi dibuat (zona IANA + jam potong per outlet) dan **disimpan**. **Jam device tidak dipercaya**; urutan otoritatif memakai waktu/urutan server (BR-TIM-*).
- **Offline-first:** tiap device mandiri, **tanpa sync LAN antar device** (AP-03). Cetak tidak boleh menggagalkan checkout (AP-10). Data pending tidak pernah dibuang.
- **Invoice:** seri per register, **tanpa celah**, format `{PREFIKS}-{MMYY}-{URUT6}`; `invoice_no` **bukan PK**. PK = UUIDv7 buatan client. Ledger stok, audit log, event bill = **append-only**.
- **Master data tidak ditulis dari POS**; snapshot (harga, tarif, nama) disalin ke transaksi (AP-07).
- **Identitas:** satu email = satu akun global; keanggotaan + peran per tenant. **Tidak ada email di MVP** (undangan/reset password lewat kode sekali pakai terikat email; penerbit tidak pernah melihat/menetapkan password). **Cookie sesi per slug** (`Path=/<slug>`); kunci rate limit login = email lintas slug.
- **Rate limit dua lapisan** (Nginx + aplikasi); `429` + `Retry-After` diperlakukan klien sebagai retry transien, bukan kegagalan.
- **Error:** kode stabil `KODE#id` dari katalog (SCHEMA Lampiran A.5, ARCHITECTURE §9.7); **log operasional = file JSON (pino), bukan tabel DB**.
- **Migrasi DB additive** (expand → contract dua rilis); bundle `/pos` hanya roll-forward; empat nomor versi terpisah (aplikasi, kontrak `schema_version`, protokol sync, Dexie).
- **UI:** semua teks lewat kunci i18n (tanpa string literal); token desain lewat variabel/utilitas Tailwind, bukan hex/`px` arbitrer (DESIGN Bab 8).

## Konvensi kerja

- Dokumen ditulis dalam **bahasa Indonesia**.
- **Conventional Commits**; **SemVer** `vMAJOR.MINOR.PATCH` dengan **git tag sebagai sumber kebenaran** versi (ARCHITECTURE §9.6.1).
- Commit/push **hanya bila user meminta**.
- Gerbang tes di GitHub Actions; **rilis/deploy manual** dari komputer user (ARCHITECTURE §9.5, OQ-A21).
- Strategi uji (nanti): Vitest `unit`/`db` (PostgreSQL 18 nyata), `fast-check`, `fake-indexeddb`, Playwright offline; kualitas sync = gerbang rilis (ARCHITECTURE §9.2).
