# ARCHITECTURE — Cetak Biru Arsitektur Teknis Solva POS

| Atribut | Nilai |
|---|---|
| Nama produk | Solva POS |
| Jenis dokumen | Cetak biru arsitektur teknis (sistem, sinkronisasi, penyimpanan lokal, keamanan, perangkat keras, struktur kode, operasi). **Bukan** kode, **bukan** file konfigurasi, **bukan** struktur folder sungguhan |
| Status dokumen | **Draft 0.2 — siap direview.** Butir `PERLU KONFIRMASI` dikumpulkan di Bab 13 (`OQ-A…`); tidak ada yang memblokir penulisan dokumen |
| Tanggal | 2026-11-19 (Draft 0.1: 2026-11-18) |
| Riwayat revisi | **0.2 (2026-11-19):** identitas global + keanggotaan per tenant, sesi per slug, tanpa email (undangan/reset berkode, `member_code`, daftar Undangan tertunda, halaman `/<slug>/join` dan `/<slug>/reset`), rate limit dua lapisan (AD-40, §6.9), tanpa pengalih tenant, jawaban OQ-A (A01…A29), manajemen error, versioning/rilis/feature flag, tenant di URL; Bab 11.4 dirapikan (daftar keselarasan lama menjadi riwayat). **0.1 (2026-11-18):** draf awal lengkap (Bab 0–14) |
| Peran penyusun | Principal Software Architect + Distributed Systems Engineer |
| Sumber kebenaran | `docs/PRD.md` (versi terkini di folder `docs/`; aturan bisnis; ID `KEP/AP/BR/FR/NFR/EC/FLOW/RSK/OQ`), `docs/SCHEMA.md` (versi terkini di folder `docs/`; tabel PostgreSQL, store Dexie, kolom sinkronisasi, tipe perintah; ID `OQ-S`), `docs/DESIGN.md` (versi terkini di folder `docs/`; UI, token, keadaan sistem; ID `SCR/CMP/DP/DOQ`). **Bila dokumen ini berbeda dari ketiganya, ketiganya yang menang**; setiap selisih (termasuk selisih terhadap brief sesi ini) dicatat di Bab 11 |
| Referensi struktur kode | `D:\React\Tanstack router\financeDashboard` (dibaca saja: `package.json`, `CLAUDE.md`, `docs/project-structure.md`, `eslint.config.js`, `vite.config.ts`, `src/**`, `scripts/**`) |
| Verifikasi versi paket | Versi terbaru dicek ke registry npm pada 2026-11-18 (§2.6). Yang tidak dapat diverifikasi dari registry (perilaku integrasi, dukungan peramban) ditandai **`VERIFIKASI`** dan dijadwalkan sebagai spike di fase yang disebut |

---

## 0. Cara Membaca Dokumen Ini

### 0.1 Tag status

| Tag | Arti di dokumen ini |
|---|---|
| `DISEPAKATI` | Bersumber langsung dari keputusan PRD/SCHEMA/DESIGN berstatus `DISEPAKATI`. Tidak dibantah ulang; hanya dijelaskan **bagaimana** diwujudkan secara teknis. |
| `DIUSULKAN` | Keputusan arsitektur yang ditetapkan dokumen ini agar rancangan tidak ambigu, konsisten dengan yang `DISEPAKATI`, dan tidak memblokir pengembangan. Dapat diubah dengan dampak yang disebut. |
| `PERLU KONFIRMASI` | Pilihan teknologi/mekanisme yang belum dikunci dokumen sebelumnya dan punya opsi nyata. Berisi rekomendasi + opsi + trade-off + asumsi sementara di **Bab 13** (`OQ-A`). |
| `VERIFIKASI` | Klaim teknis yang bergantung perilaku peramban/perangkat/integrasi pustaka yang belum dapat dipastikan dari dokumen atau registry; wajib divalidasi lewat spike (fase disebut). Bukan keputusan bisnis. |

### 0.2 Konvensi ID dokumen ini

| Pola | Makna | Contoh |
|---|---|---|
| `AD-nn` | **A**rchitecture **D**ecision: keputusan teknis + alasan + trade-off | AD-06 |
| `OQ-Ann` | Open question arsitektur (`PERLU KONFIRMASI`), Bab 13 | OQ-A03 |
| `RSK-Ann` | Risiko arsitektur + mitigasi, Bab 12 | RSK-A02 |
| `RK-nn` | Butir rekonsiliasi dengan PRD/SCHEMA/DESIGN/brief, Bab 11 | RK-04 |
| ID PRD/SCHEMA/DESIGN | Dipakai apa adanya (tidak dibuat ulang) | `BR-SYN-010`, `FLOW-14`, `outbox_command`, `SCR-P14` |

Istilah: **client** = browser/PWA di perangkat kasir; **server** = proses TanStack Start + PostgreSQL; **device** = perangkat fisik yang di-enroll (satu device aktif per register, BR-INV-001); **instance** `/pos` = satu tab/jendela PWA yang aktif menulis ke Dexie. **Singkatan rute (AD-33):** `/admin` dan `/pos` berarti `/<slug>/admin` dan `/<slug>/pos` (slug tenant di URL, §1.7); `/api/pos/v1/*`, `/health`, `/sw.js`, `/platform` tidak berslug. Nama penyimpanan lokal/kunci yang ditulis tanpa `<tenant_id>` di bagian lama tetap berarti **per tenant** (AD-34).

### 0.3 Ringkasan keputusan arsitektur (satu halaman)

| ID | Keputusan | Bab | Status |
|---|---|---|---|
| AD-01 | Satu aplikasi TanStack Start, **modular monolith**; `/admin` SSR online-only, `/pos` SPA offline (`ssr: false`); satu deployable, satu PostgreSQL | 1, 8 | `DISEPAKATI` (KEP-02, KEP-20, AP-12) |
| AD-02 | Penyimpanan offline = **Dexie (IndexedDB) + outbox custom**; PGlite **tidak** dipakai | 2.2 | `DISEPAKATI` (KEP-01); alasan teknis `DIUSULKAN` |
| AD-03 | Dexie `liveQuery` untuk semua pembacaan data yang ada di device; TanStack Query hanya untuk data yang hanya ada di server (online-only) dan seluruh `/admin` | 2.1 | `DIUSULKAN` |
| AD-04 | PostgreSQL 18 + **Drizzle ORM**; migrasi SQL **additive-only**; objek yang tak terwakili Drizzle (RLS `FORCE`, trigger, `EXCLUDE`, grants) lewat migrasi SQL kustom | 2.4 | `DISEPAKATI` (Drizzle); detail `DIUSULKAN` |
| AD-05 | **RLS per transaksi**: `set_config('app.tenant_id', …, true)` di awal setiap transaksi, peran `solva_app` `NOBYPASSRLS`, tipe `TenantTx` bermerek agar repo tidak dapat dipanggil tanpa konteks | 2.4, 6.8 | `DISEPAKATI` (BR-TNT-001); mekanisme `DIUSULKAN` |
| AD-06 | `/admin` memakai **server function** (`createServerFn`) seperti `financeDashboard`; `/pos` memakai **API HTTP JSON bervers** `/api/pos/v1/*` (global, tanpa slug; tenant dari token device) dengan kontrak Zod bersama | 1.4, 1.7, 4 | `DISEPAKATI` (user 2026-11-18) |
| AD-33 | **Tenant diidentifikasi lewat sub-path `/<slug>/…`** dengan **resolver tenant** terpisah dari bentuk URL; slug dibaca saat runtime (satu build); tenant otoritatif = **sesi (terikat tenant saat login, keanggotaan diperiksa saat login dan tiap permintaan)** atau **token device** (URL hanya petunjuk, dicocokkan); slug permanen; admin platform di `/platform`; domain kustom belum diputuskan | 1.7, 6.2 | `DISEPAKATI` (user 2026-11-18; dipertegas 2026-11-19 bersama OQ-A29); domain kustom `OQ-A22` |
| AD-40 | **Rate limit dua lapisan**: Nginx `limit_req`/`limit_conn` per IP (IP asli via `X-Real-IP` yang ditimpa proxy) + **pustaka pembatas pihak ketiga** di app (kandidat `rate-limiter-flexible`, store memori, jalur Postgres/Redis) di balik lapisan tipis; kunci `device_id` (API device) atau IP+slug (enroll/slug, tanpa login); **login admin progresif per akun global (email lintas slug; kunci utama, tanpa IP; IP hanya jaring longgar per IP+slug; mode waspada per slug)** tanpa kunci permanen, celah penundaan pemilik `OQ-A27`; enroll per IP dan per slug; `429` + `Retry-After` = RETRY transien; pembatas Better Auth dimatikan; `/platform` tanpa pembatasan IP | 6.9, 1.6, 1.7, 4.2.4 | `DISEPAKATI` (user 2026-11-18); pustaka final `OQ-A26`; nilai batas `DIUSULKAN` |
| AD-39 | **Identitas global + keanggotaan per tenant** (Better Auth + plugin *organization*; **menggantikan** "akun terpisah per tenant" 2026-11-18): satu email = satu akun global, satu kata sandi, peran per tenant (`app_user`, `auth_user_id` nullable, dipertahankan pada anggota keluar); login hanya email, ter-scope slug, bukan anggota ⇒ pesan generik; **sesi per tenant** (cookie `Path=/<slug>`, login terpisah per tenant, logout per tenant; kata sandi diubah ⇒ semua sesi dicabut); **tanpa email di MVP**: undangan dan reset manual lewat kode sekali pakai (tabel `member_code`, terikat email, 10 karakter alfabet 32, 72 jam/24 jam, penukaran satu langkah berespons seragam, retensi 7 hari), aturan reset lintas tenant R1–R5, pra-klaim email diterima; email tidak disalin ke `app_user`, ganti email hanya pemilik/operator; 2FA owner fase lanjut; halaman pemilih `/<slug>`; tanpa warna tenant; QR pairing berfragmen | 6.2, 6.2.1, 1.7, 6.3 | `DISEPAKATI` (user 2026-11-19; OQ-A28, OQ-A29 terjawab; prosedur operator belum dirancang) |
| AD-35 | **Katalog kode error domain-spesifik yang stabil** (6 kode umum + `PRINT_FAILED`, `PIN_LOCKED`, `DEVICE_REVOKED`, `UPDATE_REQUIRED`, `STORAGE_LOW`, `SYNC_HELD`, dst.) + kalimat tindakan per kode; peta kelas → HTTP → kode → tindakan UI; tiga tingkat error di UI; login generik | 9.7.1–9.7.3 | `DISEPAKATI` (user 2026-11-18); daftar final `OQ-A24` |
| AD-36 | **Pelaporan manual** (salin `KODE#id`; tanpa tombol laporan/paket diagnostik); **ID offline `D-YYYYMMDD-HHmmss-xxxxx`** ikut `device_log`/sync; retry aksi online-only manual + kunci idempoten (enroll, serah-terima) | 9.7.4, 9.7.8 | `DISEPAKATI` (user 2026-11-18); format `D-` usulan |
| AD-37 | **Ketahanan crash dan start**: `ErrorBoundary` per area, `finalize_id` anti-penjualan-ganda, SW "terakhir berfungsi", halaman pemulihan statis, "Reset aplikasi" tanpa menyentuh Dexie; gagal cetak non-blokir | 9.7.5–9.7.7 | `DISEPAKATI` (user 2026-11-18); detail `DIUSULKAN` |
| AD-38 | **Source map privat per rilis** + penerjemah stack di `logs:find`; **notifikasi Telegram** (fatal, health check gagal, lonjakan error) tanpa dashboard dan tanpa data pelanggan | 9.7.9, 9.7.10 | `DISEPAKATI` (user 2026-11-18); ambang `OQ-A25` |
| AD-34 | **Penyimpanan lokal dinamai per tenant (`tenant_id`)**: Dexie, Cache Storage (data), localStorage/sessionStorage, BroadcastChannel, Web Locks; tak pernah dibaca lintas tenant; satu browser boleh melayani beberapa tenant; **cookie sesi per tenant + `Path=/<slug>`** (dipertahankan user 2026-11-19, OQ-A29); SW dan manifest PWA per tenant | 2.3, 3.1, 3.7, 6.2 | `DISEPAKATI` (user 2026-11-18, 2026-11-19); detail teknis `VERIFIKASI` |
| AD-07 | **Pull**: counter versi per tenant; satu transaksi `REPEATABLE READ READ ONLY` per halaman dengan batas atas `V`; cursor `(version, id)`; tombstone ikut; full resync via `snapshot_version` | 4.3 | `DISEPAKATI` (BR-SYN-010/011); detail `DIUSULKAN` |
| AD-08 | Halaman pull **di-stage** di Dexie lalu **diterapkan atomik per siklus** (layar jual berganti sekali, tahan crash) | 4.3 | `DIUSULKAN` (mewujudkan BR-CAT-014, FR-SYN-017) |
| AD-09 | **Push**: outbox FIFO per register, dependensi eksplisit (`depends_on`), batch berurutan, idempotensi `idempotency_command`, satu transaksi server per perintah | 4.2 | `DISEPAKATI` (BR-SYN-020/023); detail `DIUSULKAN` |
| AD-10 | Klasifikasi hasil: **ACK / RETRY / ATTENTION**; bisnis diterima sebagai fakta, struktural/otorisasi → "perlu perhatian", transien → backoff eksponensial **+ jitter** | 4.2 | `DISEPAKATI` (BR-SYN-030); jitter `DIUSULKAN` |
| AD-11 | Deteksi konektivitas **health probe** + state machine; `navigator.onLine` hanya petunjuk | 4.4 | `DIUSULKAN` |
| AD-12 | **Clock offset** dari respons server (titik tengah RTT) + `max_seen_time`; lease 7 hari dihitung dari waktu terkoreksi | 4.5, 6.4 | `DISEPAKATI` (BR-TIM-005, BR-AUT-013) |
| AD-13 | **Satu instance `/pos` per device** (Web Locks eksklusif); tab kedua pasif dan otomatis naik bila yang pertama tutup; `BroadcastChannel` untuk notifikasi | 3.7 | `DISEPAKATI` (EC-021, FR-SYN-014); mekanisme `DIUSULKAN` |
| AD-14 | **Finalisasi = satu transaksi IndexedDB pendek** (tanpa `await` non-IDB di dalamnya), durability `strict` | 3.3 | `DISEPAKATI` (BR-INV-004); detail `DIUSULKAN` |
| AD-15 | **Kernel bersama** (3 paket internal: `kernel`, `sales-calc`, `contracts`) dipakai client & server; vektor uji V-01…V-30 + test properti di CI | 2.5 | `DISEPAKATI` (AP-06, BR-MNY-007) |
| AD-16 | Auth device: token acak 256-bit (hash SHA-256 di server), `Authorization: Bearer`; PIN **Argon2id (WASM)** + HMAC per device; lease dari waktu terkoreksi | 6 | `DISEPAKATI` (BR-AUT-*; Argon2id + hitung di server: OQ-A06 terjawab) |
| AD-17 | PWA: `vite-plugin-pwa` **`injectManifest`**, SW satu skrip di `/sw.js` yang didaftarkan **per cakupan tenant** `/<slug>/pos/`, `registerType: 'prompt'`, **UpdateManager** menegakkan BR-SYN-003 | 2.3 | `DISEPAKATI` (Workbox); detail `DIUSULKAN` |
| AD-18 | Cetak: `ReceiptDoc` (representasi antara) → **encoder** (ESC/POS bytes atau HTML) → **PrinterAdapter** (WebUSB/BLE/print); antrean `print_job` dieksekusi di instance aktif | 7.2 | `DISEPAKATI` (BR-PRN-*); detail `DIUSULKAN` |
| AD-19 | Logging mengikuti `financeDashboard` (pino, JSON per baris, `AsyncLocalStorage`, field tertutup) dengan waktu **UTC** | 9.1 | `DISEPAKATI` (KEP-21) |
| AD-20 | Realtime = **SSE sinyal-saja** lewat `fetch` streaming ber-Bearer; interval 60 dtk tetap berjalan | 4.6 | `DISEPAKATI` (BR-SYN-041); transport `DIUSULKAN` |
| AD-21 | Deployment: **Docker Compose** (reverse proxy HTTPS, app, PostgreSQL, migrator), satu instance app | 1.6 | `DISEPAKATI` (stack); komponen `DIUSULKAN` |
| AD-22 | Pemrosesan `FinalizeSale` mengikuti **urutan lock tetap** SCHEMA §5.4.3; HPP/ledger hanya di server | 5.2–5.4 | `DISEPAKATI` (BR-STK-001, BR-HPP-001); urutan `DISEPAKATI` di SCHEMA |
| AD-23 | Nomor invoice: counter lokal per `(register, MMYY)`; server mendeteksi **gap** dan menangani **`-Dn`**; pemulihan register via `register_recovery` | 5.5 | `DISEPAKATI` (BR-INV-*) |
| AD-24 | Struktur kode = lapisan teknis `financeDashboard` + **modul domain** dengan antarmuka publik; batas ditegakkan **ESLint + dependency-cruiser** + penjaga bundle | 8 | `DISEPAKATI` (BR-ARC-009); alat `DIUSULKAN` |
| AD-25 | Kebijakan rilis `/pos`: **roll-forward** (tidak ada downgrade bundle yang membawa skema Dexie lebih baru); server boleh rollback | 3.2, 9.5 | `DIUSULKAN` |
| AD-26 | Strategi uji: piramida (unit kernel + vektor → test properti → integrasi DB (RLS, konkurensi) → Playwright offline); kualitas sync sebagai gerbang rilis | 9.2 | `DISEPAKATI` (FR-QA-*) |
| AD-27 | **Skema versi aplikasi**: SemVer `vMAJOR.MINOR.PATCH`, git tag = sumber kebenaran, rc hanya di staging; konstanta versi diisi saat build; `X-App-Version` di respons server; versi tampil hanya di footer login dan pengaturan perangkat (tanpa `VersionBanner`) | 9.6.1 | `DISEPAKATI` (user 2026-11-18) |
| AD-28 | **Model rilis**: satu build untuk semua tenant; deploy semi-manual dari komputer user dari tag bersih; `/health` (503 `degraded`) + rollback otomatis aplikasi; staging ber-DB sendiri; hotfix PATCH jalur cepat setelah uji kunci; Conventional Commits + CHANGELOG + catatan "Perubahan angka"; tanpa CI untuk rilis | 9.6.2 | `DISEPAKATI` (user 2026-11-18); ketegangan CI → `OQ-A21` |
| AD-29 | **Empat nomor versi terpisah** (aplikasi, kontrak `schema_version`, protokol sync, Dexie); kontrak menempel di tiap perintah **dan event**; **upcaster** server permanen; migrator klien maju N−1→N | 3.2, 9.6.3 | `DISEPAKATI` (user 2026-11-18) |
| AD-30 | **Klien usang / lebih baru**: server N dan N−1, jendela 30 hari (OQ-A19 terjawab); pembaruan lunak lalu keras **hanya saat shift tertutup, tanpa keranjang aktif, antrean sync kosong**; klien lebih baru dari server menahan perintah + banner "server sedang diperbarui" | 3.2, 4.7, 9.6.4 | `DISEPAKATI`; 30 hari `PERLU KONFIRMASI` ringan |
| AD-31 | **Migrasi DB aditif (expand → contract, dua rilis)**; dump penuh sebelum migrasi yang menyentuh data lama; PITR kelak (ambang `OQ-A20`) | 9.6.5 | `DISEPAKATI`; ambang `PERLU KONFIRMASI` |
| AD-32 | **Feature flag per tenant** sebagai master data (counter versi tenant), di Dexie, default per flag di kode (fail-closed/open), POS read-only | 9.6.6 | `DISEPAKATI` (user 2026-11-18) |

---

## 1. Gambaran Arsitektur Tingkat Tinggi

### 1.1 Topologi

```
┌──────────────────────── PERANGKAT KASIR (Android tablet/HP · Windows PC/laptop · Chrome/Edge) ───────────────────────┐
│                                                                                                                      │
│  PWA `/pos`  (SPA; app shell + kamus + font di-precache oleh SW `/sw.js`, scope `/<slug>/pos/`)       │
│  ┌────────────┐   ┌───────────────────────┐   ┌───────────────────────────┐   ┌─────────────────────────────────┐    │
│  │ UI React   │──►│ Domain POS            │──►│ Dexie / IndexedDB         │◄──│ Sync Engine (instance aktif)    │    │
│  │ (routes,   │   │ cart · bayar · shift  │   │ master ↓ · transaksi ↑    │   │ outbox push · pull · probe ·    │    │
│  │ components)│   │ retur · bill · lock   │   │ outbox · counter · meta   │   │ clock · lease · UpdateManager   │    │
│  └─────┬──────┘   └──────────┬────────────┘   └─────────────▲─────────────┘   └───────────────┬─────────────────┘    │
│        │ liveQuery           │ pure                         │                                 │ HTTPS (Bearer)      │
│        │                     ▼                              │                                 │                     │
│        │          ┌────────────────────────┐   ┌───────────┴──────────┐                      │                     │
│        └─────────►│ kernel · sales-calc ·  │   │ Print Queue → Printer│──► WebUSB / BLE /    │                     │
│                   │ contracts (BERSAMA)    │   │ Adapter (instance    │    window.print      │                     │
│                   └────────────────────────┘   │ aktif)               │                      │                     │
│                                                └──────────────────────┘                      │                     │
│  Scanner USB/BT (keyboard wedge) · Kamera (BarcodeDetector/WASM)                              │                     │
└──────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────┘
                                                                                                │
                  Internet (putus-nyambung; AP-03: tidak ada sync LAN antar device)             │
                                                                                                ▼
┌────────────────────────────────── VPS (Docker Compose) ──────────────────────────────────────────────────────────────┐
│  ┌──────────────┐     ┌───────────────────────────────────────────────────────────────┐     ┌────────────────────┐  │
│  │ Reverse proxy│────►│ App: TanStack Start (Node)                                    │────►│ PostgreSQL 18      │  │
│  │ HTTPS/TLS    │     │  /admin  SSR + server functions (cookie sesi Better Auth)     │ pool│  RLS FORCE         │  │
│  │ HSTS, gzip   │     │  /api/pos/v1/*  JSON bervers (Bearer device) + SSE sinyal     │ SQL │  tenant_sync       │  │
│  └──────────────┘     │  /health  ·  logging pino → stdout + file harian              │     │  idempotency_cmd   │  │
│                       │  modul: identity · catalog · sales · shift · inventory · fnb  │     │  ledger append-only│  │
│                       │         sync · audit · reporting   (+ kernel bersama)         │     └────────────────────┘  │
│                       └───────────────────────────────────────────────────────────────┘                              │
│  Volume: pgdata · logs · assets (logo struk)          Migrator (job satu kali, peran solva_owner)                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Pemisahan tanggung jawab client vs server

| Aspek | Client (`/pos`) | Server |
|---|---|---|
| Peran (AP-01) | **Pencatat fakta awal**: menyusun transaksi, menghitung dengan kernel, menyimpan lokal, mengirim | **Otoritas**: memutuskan hasil akhir (nomor final, stok, HPP, flag), menyimpan, menyiarkan master |
| Master data | **Salinan baca-saja** (AP-04, BR-SYN-001); tidak pernah ditulis dari client | Satu-satunya penulis (online di `/admin`), lewat fungsi modul Sync yang menaikkan counter (BR-ARC-006) |
| Transaksi | Lahir di client (UUIDv7), disimpan atomik di Dexie, dikirim sebagai perintah | Menerima idempoten, memproses dalam **satu transaksi** per perintah (BR-ARC-005) |
| Perhitungan uang/pajak | Kernel (`sales-calc`) menghasilkan angka yang **disimpan** | Kernel yang **sama** menghitung ulang hanya untuk verifikasi; selisih = flag `SELISIH_HITUNG`, angka client tetap fakta (BR-MNY-007) |
| Stok & HPP | Hanya **estimasi** dari snapshot (BR-STK-005); tidak menghitung HPP (BR-HPP-001) | Ledger `stock_movement` + `stock_balance`, moving average di bawah row lock (BR-STK-001) |
| Nomor invoice | Mengalokasikan **nomor lokal** di transaksi IDB (BR-INV-004) | Mencatat nomor tertinggi/gap, menangani konflik `-Dn` (BR-INV-006/007/009) |
| Waktu | Mencatat waktu device mentah + `clock_offset_ms`; hitung `business_date` dengan waktu terkoreksi | Waktu server = acuan urutan (`received_at`/`processed_at`) |
| Autentikasi | PIN lokal (offline), credential device untuk server | Memverifikasi credential device; sesi Better Auth untuk `/admin` |
| Pembatasan data | Hanya data outlet/tenant yang ditugaskan (filter pull) | RLS per tenant + filter outlet di lapisan aplikasi |
| Log | Antrean `device_log` (≤ 500) ikut sync | Log operasional JSON (stdout + file), audit log di DB |

### 1.3 Aliran data baca/tulis — online dan offline

```
══ TULIS PENJUALAN (identik online/offline; jaringan TIDAK ada di jalur kritis — G-01, NFR-PERF-001) ══

 Kasir "Selesai"
    │
    ▼
 Domain POS: validasi (Zod) → kernel hitung → siapkan objek dokumen          [di luar transaksi IDB]
    │
    ▼
 ┌─ SATU transaksi Dexie (strict durability) ──────────────────────────────────────────────────┐
 │ local_counter(register|INVOICE|MMYY) +1 · sale · sale_line · sale_payment · cash drawer/audit │
 │ outbox_command(FinalizeSale, id=sale.id) · print_job · cart_draft DISCARD                    │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
    │ commit OK ⇒ UI sukses (SCR-P09)                       │ commit gagal ⇒ rollback penuh, nomor tidak terpakai
    ├──► Print Queue (asinkron, AP-10)  ───────────────────►  struk tercetak / FAILED + cetak ulang
    └──► Sync Engine "kick" (push segera bila online)  ─────►  POST /api/pos/v1/push  ──► (alur 1.3b)

══ ALUR 1.3b: DARI OUTBOX KE POSTGRESQL (hanya saat online) ══

 Outbox PENDING ─► batch terurut per register ─► Server: auth device ─► versi skema ∈ {N, N−1}? ─► Zod ─► idempotensi
                                                                                                               │
        ACK (hasil: nomor final, flag, HPP) ◄── COMMIT ◄── satu transaksi: fakta → lock → ledger → flag → audit ◄┘
        │
        └─► Dexie: outbox ACKED + sale.sync_status/synced_at/server_result

══ BACA MASTER (selalu lokal) ══

 UI ── liveQuery ──► Dexie master (product, sku_uom, price_entry, …)      ← tidak pernah menunggu jaringan
 Server ──► (pull berhalaman, stage, apply atomik per siklus) ──► Dexie master    [hanya saat online]

══ BACA YANG BUTUH SERVER (online-only; empty state `butuh-online` bila offline, DESIGN §5.2 #29) ══

 Retur invoice register lain / di luar retensi lokal · serah-terima bill · laporan · seluruh /admin
 UI ── TanStack Query ──► /api/pos/v1/…  atau  server function (/admin)
```

### 1.4 Batas modul `/admin` vs `/pos`

| Aspek | `/admin` | `/pos` |
|---|---|---|
| Render | **SSR** (TanStack Start) + hidrasi; loader `ensureQueryData` seperti `financeDashboard` | **SPA** (`ssr: false` pada layout `/pos`); HTML shell di-precache; tanpa data dari server saat cold start |
| Konektivitas | Online-only (KEP-02) | Offline-first |
| Pintu ke server | `createServerFn` (RPC; cookie sesi Better Auth) → `functions/*.fn.ts` → service → repo | `fetch` ke **`/api/pos/v1/*`** (JSON, `Authorization: Bearer`), kontrak Zod bersama |
| Data lokal | Tidak ada (cache TanStack Query di memori) | Dexie (master turun, transaksi naik) |
| Bundle | Chunk `/admin` (tabel, grafik, form kaya) — **tidak** diunduh perangkat kasir | Chunk `/pos` minimal; **tidak boleh** memuat kode server, Drizzle, Better Auth (server), `/admin` |
| Auth | Better Auth (**email + password**, akun global) + keanggotaan per tenant (`app_user`); **sesi per tenant** (login terpisah) → tenant dari sesi | Credential device + PIN staf |
| Bahasa | i18next (SSR + klien) | i18next (klien; kamus di-bundle & di-precache) |

**AD-06 — Mengapa `/pos` memakai API HTTP bervers, bukan server function** (`DISEPAKATI`, user 2026-11-18; alasan teknis di bawah):

| Kriteria | Server function (`createServerFn`) | API HTTP JSON bervers (`/api/pos/v1/*`) — dipilih |
|---|---|---|
| Stabilitas kontrak lintas versi | Alamat/ID fungsi diturunkan dari build; klien lama (N−1, hingga ≥ 30 hari, keputusan user 2026-11-18; BR-SYN-003 mensyaratkan minimal 14) dapat memanggil fungsi yang sudah tidak ada setelah deploy `VERIFIKASI` (spike F1) | Jalur dan skema **bervers eksplisit** (`v1`, `schema_version` di badan); server mempertahankan penangan N dan N−1 |
| Auth | Cookie sesi per tenant (cocok `/admin`; `Path=/<slug>`) | `Authorization: Bearer` credential device; tanpa cookie → tidak terkena CSRF, tidak membawa sesi `/admin` |
| Streaming (SSE) & `keepalive` | Tidak natural | Natural (`Response` stream, `fetch(..., { keepalive })`) |
| Uji kontrak | Terikat framework | Zod di `contracts/` diuji langsung, dipakai client & server |
| Biaya | Sedikit lebih ringan (tanpa menulis route) | Satu berkas route tipis per endpoint (±12 endpoint) |

`/admin` tetap memakai server function karena SSR + loader + `queryOptions` sudah menjadi pola `financeDashboard` dan tidak punya masalah versi klien lama (halaman dimuat segar tiap kunjungan).

Daftar endpoint device (ringkas; rinci di §4): `POST /enroll` · `POST /push` · `POST /pull` · `POST /pull/full/start` · `GET /signals` (SSE) · `GET /ping` (health probe + waktu server) · `POST /device-log` · `POST /bill/handover` · `POST /bill/accept` · `POST /bill/handover/cancel` · `GET /invoice/{id|no}` (retur online) · `GET /assets/logo/{outletId}` · `GET /release` (versi minimum/wajib). Semua di bawah `/api/pos/v1/`.

### 1.5 Batas dependensi tingkat tinggi

```
 routes ─► components ─► hooks ─► queries ─► functions ─► modules/<m>/public ─► (service ─► repo) ─► db
                │                                  │
                └──► client-modules (pos/*) ───────┴──► kernel · sales-calc · contracts   (murni, isomorfik)
 PERATURAN: kode client (routes/components/hooks/queries/pos) TIDAK boleh mengimpor src/server, drizzle-orm, pg,
            better-auth/server; kernel/sales-calc/contracts TIDAK boleh mengimpor React, router, DOM, Node API.
 (Rinci + penegakan: Bab 8.)
```

### 1.6 Deployment dan komponen server

`DIUSULKAN` (stack `DISEPAKATI`: VPS Docker; AS-06 satu PostgreSQL, tanpa multi-region).

| Komponen (Compose) | Peran | Catatan |
|---|---|---|
| `proxy` | Terminasi TLS, HTTP→HTTPS, HSTS, kompresi, batas ukuran body, timeout panjang untuk SSE, penerusan `X-Real-IP`/`X-Forwarded-For` yang **ditimpa** dengan `$remote_addr` (bukan ditambah klaim klien), **`limit_req`/`limit_conn` per IP** untuk banjir kasar (§6.9.1) | **Nginx + certbot** (keputusan user, OQ-A01, 2026-11-18): sertifikat Let's Encrypt dikelola `certbot` (kontainer atau host) dengan pembaruan otomatis terjadwal; konfigurasi `nginx.conf` di `docker/`. Rute SSE: `proxy_buffering off`, `proxy_read_timeout` panjang, HTTP/1.1 ke upstream |
| `app` | Proses Node (TanStack Start build) — `/admin`, `/api/pos/v1`, `/health`, SSE | **Satu instance** (AS-06). Stateless kecuali: penghitung pembatas laju di memori (pustaka pembatas; NFR-SEC-005; hilang saat restart, diterima, §6.9.5), registri koneksi SSE. IP klien dibaca **hanya** dari `X-Real-IP` yang dikirim Nginx (§6.9.1). Berjalan sebagai user non-root, filesystem root read-only kecuali volume |
| `db` | PostgreSQL 18 | Volume `pgdata`; `max_connections` kecil; `shared_buffers` dan `fillfactor` tabel panas sesuai SCHEMA §5.9 |
| `migrator` | Job satu kali: `drizzle-kit`/runner SQL sebagai **`solva_owner`**, dijalankan **sebelum** `app` dinaikkan | Migrasi **additive-only** (versi lama harus tetap jalan pada skema baru; pola `financeDashboard`) |
| `backup` (opsional) | `pg_dump` terjadwal ke volume terpisah | **Di luar MVP** menurut PRD (RSK-09, NFR-OBS-001); **keputusan user (OQ-A09, 2026-11-18): disiapkan menjelang produksi** (di luar kriteria selesai MVP) |

Volume persisten: `pgdata`, `logs` (`app.<tanggal UTC>.<n>.log`, BR-LOG-014), `assets` (logo struk, OQ-S06). Rahasia (`DATABASE_URL`, `BETTER_AUTH_SECRET`, rahasia lain bila ada) hanya lewat variabel lingkungan/berkas rahasia Compose, divalidasi saat boot oleh `env.ts` (pola `APP_ENV` tiga lingkungan `financeDashboard`); tidak ada di image, repo, atau bundle client (NFR-SEC-007).

Koneksi PostgreSQL: pool `pg` (node-postgres) di dalam `app`, ukuran kecil (usulan 10–20); pooler eksternal (PgBouncer) **tidak** diperlukan untuk satu instance; bila kelak dipakai, harus mode **transaction** karena RLS memakai `SET LOCAL` per transaksi (AD-05; SCHEMA §5.9 "Koneksi").

Skala beban rujukan: ≤ 500 transaksi/hari/outlet; puncak backlog ≈ 2–10 perintah/dtk per tenant (SCHEMA §6.5.2) — dalam kapasitas satu VPS kecil bila transaksi pendek.

### 1.7 Identifikasi tenant lewat URL: sub-path `<DOMAIN>/<slug>` dengan resolver tenant (AD-33)

`DISEPAKATI` (keputusan user 2026-11-18, diteruskan dari sesi perencanaan). **Mengubah** keputusan lama "tanpa prefiks URL per klien" (RK-17) — hanya bagian prefiks URL dari KEP-03; **multi-tenant lewat RLS tetap**. Dalam dokumen ini `/admin` dan `/pos` adalah singkatan dari **`/<slug>/admin`** dan **`/<slug>/pos`** kecuali disebut lain; `/api/pos/v1/*` dan `/health` tetap global.

**Prinsip:** (1) bentuk URL hanyalah **petunjuk** tenant; **tenant otoritatif = sesi** (cookie Better Auth per tenant di `/admin`, terikat tenant saat login setelah keanggotaan diperiksa) **atau token device** (Bearer di `/pos`); akses data **tidak pernah** ditentukan dari URL. (2) Kode aplikasi hanya bergantung pada **"tenant saat ini"** lewat resolver, bukan pada bentuk URL, sehingga pindah ke subdomain/domain kustom kelak tidak menulis ulang aplikasi.

**Bentuk URL dan rute**

| URL | Perilaku |
|---|---|
| `/<slug>/admin/**`, `/<slug>/pos/**` | Halaman tenant (segmen rute dinamis **`$tenant`**; slug dibaca **saat runtime**) |
| `/<slug>/join`, `/<slug>/reset` | **Dua halaman publik terpisah** untuk penerima kode (keputusan user 2026-11-19, DOQ-26; masing-masing **satu tujuan**: `join` = terima undangan, `reset` = tukar kode reset kata sandi). SSR, online, **di luar** guard `/admin` dan di luar cakupan SW `/<slug>/pos/`; tanpa sesi. Slug tak dikenal ⇒ 404. Bukan segmen slug (dua segmen di bawah `$tenant`), sehingga **tidak masuk daftar kata terlarang slug**; tes rute mencatat anak statis `$tenant` (`admin`, `pos`, `join`, `reset`, `manifest`…) agar tidak ada anak yang saling bentrok. Tidak ditampilkan di halaman pemilih; dicapai dari tautan/QR yang disampaikan pengundang/penerbit (DESIGN menentukan tautan kecil "Punya kode?" bila perlu) |
| `/api/pos/v1/*` | **Global**, tanpa slug; tenant dari token device (Bearer); AD-06 **kini `DISEPAKATI`** |
| `/platform/**` | Admin platform (butir 9 di bawah); `platform` = kata terlarang sebagai slug |
| `/` | **404** (bukan pengarah). Mitigasi: kode QR pairing memuat alamat lengkap `https://<domain>/<slug>/pos/#pair=<kode>` (§6.3) |
| `/<slug>` polos (dan `/<slug>/`) | **Halaman pemilih sederhana** (SSR, online; keputusan user 2026-11-18): nama tenant + dua pilihan **"Terminal Kasir"** (`/<slug>/pos/`) dan **"Back-office"** (`/<slug>/admin`). Tanpa data tenant selain nama tampil; di luar cakupan SW `/<slug>/pos/` (tidak tersedia offline — perangkat terpasang membuka `start_url` langsung). Slug tak dikenal ⇒ tetap **404** |
| `/sw.js`, `/assets/*`, `/health` | Jalur bersama (SW satu skrip, aset satu cache, health) |
| Slug tidak dikenal | **404 generik** (respons dan waktu seragam; tak membocorkan slug yang ada) |
| Tenant `SUSPENDED/CLOSED` | Halaman "tidak tersedia". Perangkat offline berhenti sendiri saat lease 7 hari habis (BR-AUT-008); push ke tenant ditangguhkan dijawab `403 TENANT_SUSPENDED` dan perintah **ditahan** (kelas `SCHEMA`/ditahan, bukan "perlu perhatian") sampai tenant aktif (`DIUSULKAN`) |

**Resolver tenant** (`lib/tenancy/`, murni + adaptor)

| Bagian | Isi |
|---|---|
| Antarmuka | `TenantRef = { kind: 'slug', slug }` hari ini; kelak `{ kind: 'subdomain' \| 'domain', host }`. Server: `getTenantContext(request)` → `{ tenantId, slug, status, displayName }`; klien: `useCurrentTenant()` → `{ tenantId, slug, basePath }`. **Semua tautan dibangun dengan `tenantHref(path)`**; lint/tes melarang `href`/`navigate` literal `/pos`, `/admin` (pola `base-path-guard` referensi) |
| Pencarian slug → tenant (server) | Fungsi **`SECURITY DEFINER resolve_tenant_by_slug(slug)`** (hanya `id, status, display_name`; **tidak ada fitur warna/tema tenant di MVP**) karena tabel `tenant` ber-RLS tidak dapat dibaca sebelum konteks ada; hasil di-cache memori 60 dtk; dibatasi laju per IP + slug (anti-enumerasi; §6.9.3) dan batas umum Nginx |
| Pencocokan | Server membandingkan **slug halaman** dengan **tenant sesi/token**; **berbeda ⇒ ditolak** (404 untuk halaman, `403` untuk API/server function), dicatat di log (`reqId`, slug, tenantId sesi). Di `/admin`, `status` keanggotaan (`app_user`) juga diperiksa tiap permintaan (§6.2) |
| Klien offline | Slug → `tenant_id` dibaca dari **registri non-tenant** (IndexedDB kecil `solva-registry`: hanya `slug`, `tenant_id`, nama tampil; diisi saat enrollment/login online). Slug tak ada di registri dan offline ⇒ layar "perangkat belum terdaftar untuk tenant ini" (butuh online/pairing) |
| Tampilan | Halaman login memuat **nama tenant** (`display_name`, **diatur operator platform saat tenant dibuat; perubahan hanya lewat operator**; tidak ada layar pengaturan nama di `/admin` pada MVP); login `/admin` memakai **email** (akun global; **tidak ada username**; bukan anggota tenant ⇒ pesan generik, §6.2) dan `/pos` ter-scope slug |

**Perbandingan dengan `financeDashboard` (RK-17)**

| Aspek | `financeDashboard` | Solva POS |
|---|---|---|
| Wujud | Prefiks `/oxy-<CLIENT_ID>-finance-dashboard/` | Segmen dinamis `/<slug>/…` |
| Kapan ditetapkan | **Saat build** (`CLIENT_ID` → Vite `base`/router basepath; `dist/base-path.json`) | **Saat runtime** dari URL; **satu build** untuk semua tenant |
| Proses | Satu proses Node per klien, DB per klien | Satu proses, satu DB, tenant dipisah **RLS** |
| Helper | `basePath`, `withBasePath`, `cookieName`, `cookiePath` (build-time) | `tenantHref`, `useCurrentTenant`, nama cookie/DB per tenant (runtime) |
| Konsekuensi | Aset/URL server function ikut prefiks build | Aset **global** (`/assets/*`); server function dan SW perlu penanganan khusus (§2.3, §6.2) |

**Aturan Nginx** (sketsa; konfigurasi nyata di `docker/`): `location = /` → 404; `/<slug>` dan `/<slug>/` diteruskan ke app (halaman pemilih; slug tak dikenal → 404 dari app); pengalihan 308 huruf kecil kanonis dilakukan app (OQ-A23); `location ^~ /platform/` → diteruskan ke app **tanpa pembatasan IP** (keputusan user 2026-11-18: akun platform terpisah + batas umum per IP; membatalkan usulan `allow`/`deny`, risiko `RSK-A22`); `limit_req`/`limit_conn` per IP dan penimpaan `X-Real-IP` di semua `location` (§6.9.1); `/api/`, `/sw.js`, `/assets/`, `/health` diteruskan global (`/sw.js` `Cache-Control: no-cache`, `/assets/` `immutable`); `/<slug>/_serverFn/…` → `rewrite` ke `/_serverFn/…` dengan `proxy_set_header X-Tenant-Slug <slug>` (header serupa dari klien dibuang/ditimpa; §6.2); selebihnya diteruskan ke `app`. Nginx **tidak** mengenal daftar slug (404 slug tak dikenal berasal dari app).

**Slug (permanen)**

| Aspek | Aturan |
|---|---|
| Permanen | **Tidak dapat diubah**; mengganti = membuat tenant baru. Alasan: memutus PWA terpasang, nama IndexedDB/registri, enrollment device, cookie. **Ditegakkan dua lapis** (keputusan user 2026-11-18): (1) **aplikasi** menolak perubahan slug di semua jalur tulis; (2) **trigger database `BEFORE UPDATE OF slug`** pada `tenant` yang melempar galat (lapis kedua) |
| Format | 3–30 karakter `a-z`, `0-9`, `-`; **tidak diawali/diakhiri `-`**; unik tanpa membedakan huruf besar-kecil (disimpan huruf kecil); regex `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$` |
| Kata terlarang (**konstanta di kode**, validator murni `lib/kernel/slug`; keputusan user 2026-11-18) | `platform, admin, pos, api, health, assets, static, login, logout, signin, signup, register, auth, oauth, callback, www, app, root, system, sw, manifest, favicon, robots, sitemap, public, docs, help, support, status, billing, settings, dashboard, tenant, tenants, org, internal, cron, metrics, ping, signals, release, enroll, push, pull, webhook, webhooks, mail, cdn, files, uploads, download, v1, null, undefined, solva, shell, offline, staging, dev` ditambah **setiap segmen rute tingkat-atas statis** (mis. `_serverFn`, `_build`). **Tes** mencocokkan daftar rute statis aplikasi dengan daftar terlarang agar rute baru tidak pernah bentrok dengan slug |
| Normalisasi | URL berhuruf kapital → **308 ke huruf kecil** kanonis (dan satu bentuk garis miring akhir). Default diputuskan (OQ-A23 terjawab 2026-11-18) |

**Admin platform:** rute `/platform` di domain yang sama, akun admin platform **terpisah dari akun tenant** (penyimpanan dan instance auth sendiri, cookie `Path=/platform`), **tanpa pembatasan IP** (hanya batas umum per IP di Nginx + pembatas login; keputusan user 2026-11-18, `RSK-A22`); Operator platform membuat tenant dan menetapkan **nama tampilan** tenant (keputusan user 2026-11-18); UI tidak dirancang di sini.

**Domain kustom per tenant:** **ditunda, tanpa pekerjaan di MVP** (keputusan user 2026-11-18; OQ-A22 terjawab "ditunda"); resolver tenant sudah disiapkan, TLS per domain via certbot saat itu. Dampak kelak: sertifikat (certbot per domain, atau DNS-01 untuk wildcard), domain staging, dan **perubahan origin memutus IndexedDB** (device harus di-enroll ulang; sinkronkan antrean lebih dulu). `OQ-A22` terjawab: ditunda.

---

## 2. Tech Stack Lengkap dan Pemetaan Peran

### 2.1 Frontend & routing (React, TypeScript, TanStack Start/Router/Query, state lokal)

| Aspek | Keputusan | Alasan / trade-off |
|---|---|---|
| UI | **React 19** + **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters` — sama dengan `tsconfig.json` referensi), alias `~/*` → `src/*` | Stack `DISEPAKATI`. Konfigurasi ketat menangkap salah indeks dan kode mati sejak dini. |
| Framework + routing | **TanStack Start** + **TanStack Router** (rute berbasis berkas, `routeTree.gen.ts` dihasilkan, tidak diubah tangan) | `DISEPAKATI`. `ssr: false` dipasang pada layout `/pos` (selective SSR) sehingga `/pos` menjadi SPA murni; `/admin` tetap SSR (KEP-02). |
| Pembagian rute | `/` = **404** (bukan pengarah), **`/$tenant/join`** dan **`/$tenant/reset`** (publik, penerima kode; DOQ-26), **`/$tenant/admin/**`** (SCR-A01…A10), **`/$tenant/pos/**`** (SCR-P01…P16) dengan `$tenant` = slug (§1.7), `/platform/**`, `/api/pos/v1/**` (global, route server tipis), `/health`, `/sw.js` | Satu app, dua area dengan chunk terpisah (AD-01). |
| Guard rute `/pos` | `beforeLoad` **hanya membaca Dexie/memori** (device ter-enroll? lease valid? staf login? shift terbuka?) dan mengarahkan ke SCR-P01/P02/P03/P15; **tidak pernah** menunggu jaringan | NFR-PERF-004 (cold start ≤ 3 dtk offline). Guard yang butuh server (mis. cek rilis wajib) berjalan di latar dan hanya mengubah state `UpdateManager`. |
| Data server `/admin` | **TanStack Query** (`queryOptions` di `src/queries/`, kunci lewat `qk`), loader `ensureQueryData`, hidrasi SSR (`@tanstack/react-router-ssr-query`) | Pola `financeDashboard`; satu-satunya jalur baca data server di `/admin`. |
| Data lokal `/pos` | **Dexie `liveQuery`** (`useLiveQuery` dari `dexie-react-hooks`) untuk semua data yang ada di device (AD-03, aturan di bawah) | Satu sistem reaktif untuk data lokal; tidak menduplikasi cache. |
| State keranjang kasir | **Store kecil + persistensi tulis-susul ke Dexie `cart_draft`** (rekomendasi `zustand`; opsi `@tanstack/react-store` atau `useReducer`+context) — **keputusan user (OQ-A03, 2026-11-18): `zustand`** | Keranjang harus instan (tanpa menunggu IDB) **dan** selamat dari kunci layar/rotasi/crash (BR-AUT-015 butir 2, DESIGN §5.4 butir 4). Store menyimpan draf; mutasi melewati fungsi domain murni (kernel menghitung total); `cart_draft` ditulis tertunda 150 ms (item ditambah/dihapus ditulis seketika). Draf **tidak pernah** disinkron (BR-AUT-015 butir 2). |
| State UI | State React lokal; filter/halaman `/admin` di **URL search params** (skema Zod, seperti `lib/filters/` referensi); tema = token CSS (DESIGN Bab 8), bukan state JS | Mudah dibagikan/diuji; tidak ada store global untuk UI. |
| Komponen | Primitif aksesibel **Radix** (`radix-ui`) + `class-variance-authority` + `tailwind-merge`; **tanpa generator shadcn** | DESIGN T-01…T-15 melarang palet default/nilai literal; berkas shadcn bawaan memakai nama token berbeda (`bg-primary`). Radix menyediakan dialog/popover/select yang benar secara a11y tanpa gaya. Trade-off: komponen ditulis sendiri (CMP-01…34 memang sudah dispesifikasikan). |
| Styling | **Tailwind v4** (`@theme`, DOQ-17), token L1/L2 di `styles/tokens.css`, palet bawaan dinonaktifkan; font **Plus Jakarta Sans** self-host variabel (`@fontsource-variable/plus-jakarta-sans`), ikon **Lucide** (DOQ-01/11) | Sesuai DESIGN Bab 8. Font dan ikon ikut precache (DP-12). |
| i18n | **`i18next` + `react-i18next`**; kamus `id-ID` dan `en-US` **di-bundle statis** (bukan dimuat malas) | BR-I18N-001/003/011: ganti bahasa ≤ 200 ms tanpa jaringan (NFR-I18N-002). Dua kamus kecil → biaya bundle rendah, risiko offline nol. Jamak/interpolasi memakai fitur i18next bawaan (sufiks `_one/_other`, `{{nama}}`); ICU (`i18next-icu`) hanya bila uji kualitas BR-I18N-009 menuntut — keputusan akhir saat implementasi (BR-I18N-011). Kunci bertipe (augmentasi `i18next`), tes `keys.test.ts` memastikan kedua locale sepadan (pola referensi). |
| Pemindai & kamera | `keyboard wedge` ditangani **pendengar global** (modul `scanner`, §7.5); kamera lewat `BarcodeDetector` + polyfill | BR-CAT-007. |
| Format angka/tanggal | `Intl.NumberFormat/DateTimeFormat` di modul `kernel/format` (murni), zona **outlet** untuk tampilan waktu | BR-I18N-006, BR-TIM-002; V-26. |

**Kapan TanStack Query vs Dexie langsung** (AD-03, `DIUSULKAN`) — aturan keputusan:

| Pertanyaan | Jawaban → alat |
|---|---|
| Data ini ada di Dexie (master turun, transaksi lokal, outbox, snapshot, `meta`)? | **Dexie** — baca dengan `liveQuery`; tulis lewat fungsi repo client (`pos/data/*.repo.ts`) dalam transaksi Dexie. Tidak dibungkus Query. |
| Data hanya ada di server dan **boleh gagal bila offline** (retur invoice register lain, ambil logo, `GET /release`)? | **TanStack Query** dengan `networkMode: 'online'`, `retry` terbatas, cache tidak dipersist; UI menampilkan empty state `butuh-online` saat offline. |
| Aksi **mengubah** server dari `/pos` yang tidak lewat outbox (serah-terima bill, enroll)? | `useMutation` Query → endpoint `/api/pos/v1/*`; tombol dinonaktifkan offline dengan alasan terlihat (BR-FNB-012 butir 4). |
| Aksi yang harus **tidak hilang** (penjualan, event bill, shift, kas, audit)? | **Outbox** (Dexie) → Sync Engine. **Bukan** mutation Query. |
| `/admin` apa pun? | **TanStack Query** (+ server function). |

Mengapa tidak membungkus Dexie dengan Query (`queryFn` ke IDB): dua mesin reaktif mengamati data yang sama → invalidasi ganda, cache basi, dan latensi ekstra pada jalur kasir (NFR-PERF-003: barcode ≤ 50 ms). `liveQuery` sudah memberi reaktivitas lintas komponen dan dibatalkan otomatis saat unmount.

### 2.2 Client storage & offline engine

#### AD-02 — Dexie + outbox custom; PGlite tidak dipakai

`DISEPAKATI` (KEP-01: "Dexie + outbox custom"); perbandingan teknis di bawah menjelaskan alasannya (brief menyebut "kemungkinan PGlite" — RK-01).

| Kriteria | **Dexie (IndexedDB) — dipilih** | PGlite (Postgres WASM di browser) |
|---|---|---|
| Waktu start dingin (NFR-PERF-004 ≤ 3 dtk offline di tablet kelas menengah) | Membuka DB ≈ puluhan ms; tanpa inisialisasi WASM | Memuat WASM Postgres (megabita) + inisialisasi → risiko melampaui anggaran start dingin di perangkat lemah `VERIFIKASI` |
| Jalur kritis kasir (barcode ≤ 50 ms, cari nama ≤ 150 ms p95, simpan ≤ 300 ms p95) | Indeks IndexedDB langsung (`&barcode`, `*search_tokens`, kompon) — SCHEMA §6.3 sudah dirancang | Query SQL via WASM + berkas di IndexedDB; latensi tak jelas pada 45.000 transaksi |
| Atomisitas finalisasi (counter nomor + dokumen + outbox + print_job) | **Satu transaksi IndexedDB** multi-store (BR-INV-004) — primitif bawaan peramban | Transaksi SQL tersedia, tetapi durability di atas IndexedDB-FS tetap bergantung peramban |
| Migrasi berversi + migrasi payload outbox (BR-SYN-022, NFR-MNT-001) | `db.version(n).stores().upgrade()` — hook migrasi satu arah teruji | Migrasi SQL sendiri + kompatibilitas skema Postgres klien ≠ server |
| Ukuran bundle/precache | ±30 KB gz | Beberapa MB (WASM) — membebani precache dan update |
| Multi-tab | Satu instance aktif (AD-13); IDB sudah serial per store | Multi-tab PGlite butuh worker/leader tambahan |
| Kecocokan model | Model client **sengaja berbeda** dari server (denormalisasi untuk lookup, tanpa FK, `search_tokens`) — SCHEMA §7.6 | Hanya unggul bila skema klien = skema server (tidak berlaku: master turun terfilter, transaksi naik sebagai perintah) |
| Sinkronisasi | Outbox + pull custom (PRD) | PGlite tidak memberi sinkronisasi; butuh lapisan lain — bertentangan dengan keputusan PRD |
| Kematangan/risiko | Pustaka matang, dipakai luas | Relatif baru untuk beban transaksional produksi |

Trade-off yang diterima: tidak ada SQL di klien (laporan tidak dihitung di klien — memang di luar scope: laporan server, hanya online, BR-RPT-001); join dilakukan di kode domain.

#### Penggunaan Dexie (aturan teknis)

| Aturan | Isi | Rujukan |
|---|---|---|
| Satu database Dexie **per tenant**: **`solva-<tenant_id>`** | Nama berdasarkan **`tenant_id`** (bukan slug, karena slug hanya petunjuk URL); store sesuai SCHEMA §6.3 + `pull_stage` (§4.3, RK-07). Dibuka hanya setelah resolver (§1.7) memetakan slug → `tenant_id` lewat registri non-tenant `solva-registry`. **Tidak pernah** membuka/membaca DB tenant lain; satu browser boleh melayani beberapa tenant (tiap tenant = device terpisah, credential terpisah) | NFR-MNT-001, AD-34 |
| **Penamaan penyimpanan lain per tenant** | `localStorage`/`sessionStorage`: awalan `solva:<tenant_id>:`; Cache Storage **data** (bila ada) berawalan `<tenant_id>`; `BroadcastChannel` `solva:<tenant_id>:<deviceId>`; kunci Web Locks `solva:<tenant_id>:…` (§3.7). **Pengecualian non-data:** cache aset statis bersama (§2.3), registri `solva-registry` (hanya slug ↔ `tenant_id` + nama tampil), dan kunci perangkat keras (`print:<printerId>`, per origin, karena printer USB/BLE fisik dipakai bersama lintas tenant) | AD-34 |
| Opsi `chromeTransactionDurability: 'strict'` | Paket Dexie 4.4.x menyediakan opsi ini (terverifikasi dari paket 4.4.7 pada 2026-11-18); default Chrome `relaxed` dapat kehilangan transaksi terakhir pada mati listrik/baterai habis. Pada ≤ 500 transaksi/hari biaya fsync dapat diabaikan; **diukur di F3** (NFR-PERF-001 ≤ 300 ms p95) | AD-14, RSK-A03 |
| Transaksi pendek, **tanpa `await` non-IDB** di dalamnya | Hash PIN, perhitungan kernel, `fetch`, `crypto.subtle` dikerjakan **sebelum** transaksi; di dalam hanya operasi Dexie. Transaksi IDB yang menunggu promise non-IDB auto-commit lebih awal → atomisitas hilang | BR-INV-004, EC-020 |
| `bulkPut`/`bulkDelete` per halaman pull | Apply halaman dalam satu transaksi; ukuran halaman 500 baris | BR-SYN-013 |
| Kunci turunan untuk `null`/boolean | `outlet_key`, `sku_key`, `0/1` (IndexedDB tidak mengindeks `null`/boolean) | SCHEMA §6.3 |
| Waktu ISO-8601 UTC string | Urutan leksikografis = kronologis → `between()` aman | SCHEMA §6.3 |
| `versionchange` | Handler `db.on('versionchange')` menutup koneksi dan memunculkan prompt muat ulang (mencegah DB macet bila dua versi app terbuka) | §3.2 |
| Tidak ada ORM tambahan | Repo client = fungsi tipis di atas Dexie + tipe dari `contracts` | AP-06 |

### 2.3 PWA & caching

`DISEPAKATI`: Workbox via `vite-plugin-pwa`, app shell di-precache, update berbasis prompt (BR-SYN-002/003). Detail di bawah `DIUSULKAN`; integrasi dengan TanStack Start ditandai `VERIFIKASI`.

| Aspek | Keputusan | Alasan / trade-off |
|---|---|---|
| Strategi plugin | **`injectManifest`** (SW ditulis sendiri di `src/pwa/sw.ts`, manifest precache disuntik), `registerType: 'prompt'` | `generateSW` tidak cukup: butuh pesan `SKIP_WAITING` terkendali, fallback navigasi khusus `/pos`, dan pengecualian `/api/*`. Biaya: SW kecil (±80 baris) dipelihara sendiri. |
| Lokasi & scope SW (per tenant) | **Satu skrip** `injectManifest` disajikan di **`/sw.js`** (root; `Cache-Control: no-cache`) dan **didaftarkan per cakupan** `/<slug>/pos/` (`register('/sw.js', { scope: '/<slug>/pos/' })`); satu skrip yang sama membentuk **satu pendaftaran per tenant**. SW mengetahui tenantnya dari `self.registration.scope`. | SW hanya mengendalikan `/<slug>/pos/**`; `/<slug>/admin` (SSR, online-only) dan `/api/*` tidak pernah dicegat (aturan eksplisit: `/api/` dan jalur non-scope selalu **jaringan langsung**). Aset (`/assets/*`) diminta oleh halaman `/<slug>/pos` → tetap dicegat walau di luar scope URL-nya. Versi SW = versi skrip: tiap pendaftaran memperbarui sendiri saat tenant itu dibuka; `UpdateManager` (§4.7) dan prompt update berjalan **per tenant**. |
| **Satu cache aset bersama** | Aset statis (JS/CSS/font/kamus/ikon) disimpan di **satu Cache Storage bersama** (`cacheNames.precache` kustom), **tidak digandakan per tenant**; nama bersih-bersih entri lama hanya menghapus entri yang **tidak dirujuk pendaftaran mana pun** (tiap SW mencatat daftar manifestnya di cache bersama; pembersih memakai gabungan semuanya) | Mencegah SW tenant B yang belum diperbarui kehilangan aset karena SW tenant A sudah naik versi. Perilaku nama cache Workbox per-scope dan pembersihan lintas pendaftaran: **`VERIFIKASI` spike F1** (`OQ-A02`, `RSK-A18`) |
| Precache | Seluruh chunk JS/CSS `/pos`, kamus i18n, font Plus Jakarta Sans, ikon Lucide yang dipakai (di-bundle), manifest PWA + ikon, **shell HTML `/pos`** | DP-12: tanpa CDN saat runtime. Anggaran precache **≤ 2,5 MB** (target `DIUSULKAN`, diukur F1/F3; `size-limit` di CI, §9.3). |
| Shell HTML `/pos` (satu, tenant-netral) | Opsi A (rekomendasi): **prerender satu shell** `/pos` saat build (HTML tanpa data **dan tanpa slug**) dan masukkan ke precache sebagai `navigateFallback` untuk **setiap** `/<slug>/pos/**` dalam cakupan SW; slug dibaca dari `location.pathname` saat runtime (tidak ada HTML per tenant). Opsi B: `NetworkFirst` pada navigasi + fallback cache. | Start menghasilkan HTML lewat SSR; agar offline dingin selalu ada dokumen, shell harus statis. **`VERIFIKASI` (spike F1, `OQ-A02`)**: cara paling bersih menghasilkan shell statis dari rute `ssr:false` dan menyuntikkannya ke manifest `vite-plugin-pwa` (plugin PWA mendukung build klien; Start membangun environment klien + server). Bila A gagal → B + peringatan "kunjungan pertama wajib online" (sudah terpenuhi: enrollment butuh online, FLOW-01). |
| Runtime caching | **Tidak ada** untuk `/api/*`, `/admin/**`, dan permintaan data. Satu pengecualian: logo struk **tidak** lewat SW — diunduh sekali ke `asset_cache` (Dexie) sebagai bitmap | Menghindari data basi/tak teraudit di cache SW; logo butuh bentuk raster ESC/POS (BR-PRN-003). |
| Gagal start / pemulihan | Skrip boot inline di shell mengirim `BOOT_OK`/mencatat gagal start; SW menyimpan penanda **versi terakhir berfungsi** dan menunda pembersihan entri lamanya; **`recovery.html`** statis (tanpa bundle) masuk precache; "Reset aplikasi" tidak pernah menyentuh Dexie (§9.7.6) | Start dingin offline yang tahan bundle rusak (AD-37, RSK-A19) |
| Update | `UpdateManager` (§4.7) memegang state `none → available → pending_apply → applying`; SW baru **menunggu** (tanpa `skipWaiting` otomatis); menerapkan = `postMessage({type:'SKIP_WAITING'})` lalu reload saat `controllerchange` | BR-SYN-002/003; tidak ada pergantian versi di tengah checkout/shift. `clientsClaim` hanya pada instalasi pertama. |
| Deteksi pembaruan | `registration.update()` saat app fokus/online dan tiap 30 menit saat online; **plus** header `X-App-Version` pada respons API dan endpoint `GET /release` (versi minimum/wajib, `app_release`) | Pola `version-watch`/`X-App-Version` referensi; SW saja tidak cukup untuk mendeteksi "rilis wajib". |
| Cold start tanpa internet | SW aktif → navigasi `/pos` dilayani dari precache → bundle → buka Dexie → guard `beforeLoad` (device? lease? jam?) → SCR-P02. **Tidak ada permintaan jaringan** di jalur ini | NFR-PERF-004. |
| Versi | **Empat nomor berbeda** (§3.2, §9.6): **`app_version`** (tag SemVer git; konstanta `__APP_VERSION__` diisi saat build lewat Vite `define`, seperti referensi), **`schema_version` kontrak perintah/event** (integer monoton, `contracts`), **versi protokol sync**, **versi skema Dexie** (lokal, tidak dikirim). Tiga yang pertama dikirim sebagai header `X-App-Version`, `X-Schema-Version`, `X-Sync-Protocol`; dicatat di `device_sync_status`. Versi aplikasi hanya tampil di footer layar login dan pengaturan perangkat (tanpa `VersionBanner`) | BR-SYN-022, FR-DEV-004. |
| Manifest PWA (dinamis per tenant) | Route server `GET /<slug>/pos/manifest.webmanifest` membangun manifest dari data tenant: **hanya nama tenant** (diambil dari `display_name` yang diatur operator platform) (`name`/`short_name`); **tanpa warna tenant** (tidak ada fitur warna tenant di MVP; keputusan user 2026-11-18 menggantikan butir lama "nama dan warna"): `theme_color`/`background_color` = **warna primer aplikasi** (token `primary-700`), ikon **bersama**; `display: standalone`, **`id`**, **`start_url`** dan **`scope`** = `/<slug>/pos/` (masing-masing per tenant sehingga tiap tenant terpasang sebagai aplikasi terpisah). Slug tidak dikenal ⇒ 404; manifest hanya dibutuhkan saat pemasangan | Instal dari Chrome (Android/Windows). Windows kiosk-printing memakai pintasan `--app=https://<domain>/<slug>/pos/` (§7.2). |
| Browser didukung | Chrome/Edge (Chromium) 2 versi mayor terakhir; iOS bukan target | NFR-COMP-001 |

### 2.4 Backend & database

| Aspek | Keputusan | Alasan / trade-off |
|---|---|---|
| Runtime | **Node.js ≥ 22.12 (LTS)**, sama dengan `engines` referensi (keputusan user, OQ-A18) | Konsistensi toolchain; `pg`, `drizzle`, `hash-wasm` berjalan di keduanya. |
| Lapisan server | `routes/api/**` (tipis) · `functions/**` (`createServerFn`, `/admin`) → `modules/<m>/public` → `service` → `repo` → `db` | Pola berlapis `financeDashboard` (routes → queries → functions → services → repo) dengan tambahan batas modul (BR-ARC-003/004). |
| Entry server | `server-entry.ts`: `handleRequestWithLog` (ID referensi, `X-Request-Id`, baris access), handler `/health` lebih dulu, `installProcessHandlers`, logging file | Disalin dari pola referensi (BR-LOG-002/004/005/012). |
| ORM | **Drizzle ORM 0.45.x** + `drizzle-kit` 0.31.x; driver **`pg`** (node-postgres) | `DISEPAKATI` (Drizzle; brief menyebut "Prisma atau Drizzle" — RK-02). `pg` dipilih karena transaksi + `set_config(..., true)` + pool matang. Drizzle **1.0 (RC)** tidak dipakai di MVP — evaluasi pasca-MVP `VERIFIKASI`. |
| Gaya query | Drizzle core builder + `sql` template (kunci baris `FOR UPDATE ORDER BY`, `INSERT … ON CONFLICT`, `UNION ALL` feed); parameter selalu terikat; **repo = satu-satunya tempat SQL**; tes `sql-guard` memindai `repo/**` | Pola referensi (`sql-guard.test.ts`) diadaptasi: bebas `SELECT *`, tak ada penulisan tabel modul lain, tak ada `OFFSET` pada feed (keyset). |
| Skema Drizzle | Tiap modul memiliki `modules/<m>/server/schema.ts`; `drizzle.config.ts` mengumpulkan glob; **FK komposit `(tenant_id, x_id)`** dan `UNIQUE (tenant_id,id)` ditulis eksplisit (SCHEMA §1.8) | BR-ARC-003: modul lain tidak mengimpor skema modul pemilik (lint, §8.5). |
| Objek di luar Drizzle | `ENABLE/FORCE RLS` + kebijakan, trigger (`forbid_mutation`, penjaga lease/prefiks), `EXCLUDE USING gist` (`invoice_gap`), `GRANT/REVOKE` per kolom, view laporan, fungsi `SECURITY DEFINER` → **migrasi SQL kustom** (`drizzle-kit generate --custom`) di `drizzle/` | Drizzle tidak mewakili semua; diuji oleh tes katalog pg (§9.2: semua tabel bertenant punya FORCE RLS + kebijakan, SCHEMA §5.6 butir 9). |
| Migrasi | **Additive-only** (kolom/tabel baru; pola *expand lalu contract* lewat dua rilis; tidak ada rename/drop selagi N−1 masih didukung — jendela 30 hari, BR-SYN-003; §9.6.5); dijalankan job `migrator` sebagai `solva_owner` sebelum `app` aktif; `/health` mengembalikan `degraded` bila migrasi tertinggal | Pola referensi ("Migrations must be additive-only"); mendukung rollback app server tanpa rollback skema. |
| Zod | **Zod 4**: skema di `contracts/` dipakai `safeParse` di **setiap** batas (API device, server function, form, impor CSV); kuantitas = regex ketat `^-?\d+(\.\d{1,4})?$` (BR-MNY-008) | NFR-SEC-007. |
| Peran DB | `solva_owner` (migrasi), `solva_app` (`NOBYPASSRLS`, hak terbatas per tabel; **tanpa** UPDATE/DELETE pada `audit_log`/`stock_movement`/`bill_event`), `solva_report` (opsional) | SCHEMA §5.5. |
| Konteks tenant (AD-05) | `withTenant(tenantId, fn)`: membuka transaksi, menjalankan `select set_config('app.tenant_id', $1, true)`, memanggil `fn(tx: TenantTx)`. **`TenantTx` bermerek** (tipe nominal) — fungsi repo menerima `TenantTx`, bukan `db` mentah; tes statis melarang `db.` langsung di `repo/**` | RLS `FORCE` menjamin 0 baris bila konteks hilang (SCHEMA §5.6 butir 3); tipe bermerek menangkap kelupaan saat kompilasi. Pembacaan satu-pernyataan pun dibungkus transaksi pendek. |
| Tugas lintas tenant | Pekerja latar (pembersih tombstone, retensi log) menjalankan per tenant: daftar tenant diambil lewat fungsi **`SECURITY DEFINER list_active_tenants()`** (hanya `id`), lalu `withTenant` per tenant. Tidak ada `BYPASSRLS` untuk aplikasi | SCHEMA §5.6 butir 7. |
| Batas waktu | `statement_timeout` 15 dtk (request), 10 dtk untuk transaksi perintah push; **`lock_timeout` 5 dtk** (menunggu `tenant_sync`/baris saldo → balasan `RETRY`, bukan gagal permanen); `idle_in_transaction_session_timeout` 30 dtk | Mencegah antrean kunci menumpuk (RSK-13); transaksi master harus pendek (BR-SYN-012). |
| Pooling | Pool `pg` 10–20 koneksi; **pool terpisah kecil (2–3)** untuk pekerja latar (pola `refresh-pool` referensi) agar tidak mengambil koneksi request | Satu instance app (AS-06). |
| Better Auth | **Better Auth 1.7.x**, adapter Drizzle, plugin **`organization`** (organisasi = tenant, `tenant.auth_org_id`); **plugin `username` tidak dipakai** (login hanya email); **identitas global** (email unik se-sistem) + keanggotaan per tenant; **`sign-up` publik dinonaktifkan**; **tanpa SMTP/verifikasi email**; sesi berbasis cookie (`httpOnly`, `secure`, `sameSite=lax`) hanya untuk `/admin`, **bernama per tenant dan `Path=/<slug>`** (§6.2), endpoint auth di bawah `/<slug>/admin/api/auth/*` dibungkus untuk login ter-scope slug dan undangan/reset manual. Tabel Better Auth dibuat generator-nya ke skema Drizzle modul Identitas, **di luar RLS** (SCHEMA §1.8 butir 4); tautan: `tenant.auth_org_id`, `app_user.auth_user_id` (nullable) | `DISEPAKATI` (BR-AUT-001, OQ-S02; model identitas global user 2026-11-19, §6.2.1, AD-39). RBAC aplikasi memakai **`app_user` + `user_outlet` + `role_permission`**, bukan peran bawaan Better Auth. |
| Rate limit | **Dua lapisan (AD-40, §6.9):** Nginx `limit_req`/`limit_conn` per IP + **pustaka pembatas pihak ketiga** di app (kandidat `rate-limiter-flexible`, store memori; final `OQ-A26`) di belakang lapisan tipis `lib/ratelimit/` (kebijakan progresif murni, jam disuntik). Pembatas bawaan Better Auth **dinonaktifkan** | NFR-SEC-005. **Menyimpang dari referensi** (`login-limiter.ts`/`rate-limit.ts` buatan sendiri; RK-33) — dipertahankan sebagai cadangan. |
| Error ke client | Hanya `KODE#id` (BR-LOG-008): server function lewat `publicErrorMiddleware`; route `/api/pos/v1/*` membalas JSON `{ "error": { "code", "ref" } }` | FR-LOG-005. |

**Pemetaan HTTP ↔ kelas hasil (untuk API device)**

| Situasi | HTTP | Perilaku client |
|---|---|---|
| Hasil per perintah (ACK/ATTENTION) | `200` + `results[]` | Per perintah (lihat §4.2) |
| Batas waktu/jaringan/5xx/`DB_UNAVAILABLE`/`TIMEOUT`/`lock_timeout` | `5xx`, `503`, `504` atau kegagalan fetch | **RETRY** (backoff) — bukan "perlu perhatian" (BR-SYN-030) |
| **Pembatas laju** (§6.9): per `device_id`, banjir push, full resync > 1/jam | **`429` + `Retry-After`** (berjitter) | **RETRY transien khusus**: tunggu `max(Retry-After, backoff)`, **`attempts` tidak naik**, **bukan** `NEEDS_ATTENTION`, **bukan** kegagalan konektivitas (tidak memicu histeresis OFFLINE, tidak menggeser `last_success_sync_at` negatif). Dibedakan dari `RATE_LIMITED` (login/enroll, kode eksplisit, pesan menit untuk pengguna; §9.7.2) |
| Credential tidak sah (`CREDENTIAL_INVALID`, `DEVICE_REVOKED`, `CREDENTIAL_EXPIRED`) | `401`/`403` dengan kode eksplisit | **AUTHORIZATION** → perintah `NEEDS_ATTENTION` (BR-SYN-030); 401/403 **tanpa** kode aplikasi (mis. dari proxy) diperlakukan transien |
| Versi skema terlalu lama | `426` + `UPDATE_REQUIRED` | Perintah **ditahan** (`last_error_class='SCHEMA'`, bukan "perlu perhatian"), banner wajib update, shift baru diblokir (BR-SYN-003 butir 5) |
| Klien **lebih baru** daripada server (setelah rollback server) | `200`/`409` dengan `max_schema_version` pada `/ping` dan respons push/pull (kode `SERVER_BEHIND`) | Perintah berformat belum dikenal **ditahan** (`SCHEMA`, bukan "perlu perhatian"), banner "server sedang diperbarui", penjualan tetap tersimpan lokal, antrean terkirim otomatis setelah server cocok (§3.2 butir 6) |
| Amplop rusak (bukan JSON/Zod gagal pada amplop) | `400` `VALIDATION_FAILED` | Bug klien → log lokal; perintah dalam batch **tidak** dikirim ulang tanpa perubahan. Zod per-perintah yang gagal di server → hasil `STRUCTURAL` per perintah |

### 2.5 Paket bersama (kernel kalkulasi uang, pajak, pembulatan, penomoran)

`DISEPAKATI`: satu package perhitungan bersama client & server (AP-06, BR-MNY-007, BR-ARC-010); kernel **tidak** bergantung pada modul bisnis. Diwujudkan sebagai **tiga paket internal** dalam satu repositori (bukan npm workspace; lihat §8.3):

| Paket | Isi | Boleh bergantung pada | Pemakai |
|---|---|---|---|
| **`kernel`** (`src/lib/kernel/`) | `money` (integer rupiah bermerek, operasi aman-overflow, guard `Number.isSafeInteger`) · `qty` (desimal string skala 4 di atas `decimal.js`; konversi UOM, penolakan pecahan melanggar `allow_fraction`/skala, BR-UOM-004/005) · `rounding` (`R` half-up, **LR** dengan tie-break urutan, BR-MNY-004/006) · `ids` (UUIDv7 via `uuidv7`) · `time` (`businessDate(occurredAt, tz, cutoff)` memakai `Intl.DateTimeFormat` IANA, `invoicePeriod`, tambah bulan kalender untuk BR-RTR-003) · `numbering` (`formatInvoiceNo`, `parseInvoiceNo` dari kanan, validasi prefiks BR-INV-003/010, sufiks `-Dn`) · `format` (format/urai angka-tanggal per locale, V-26) | — (hanya `decimal.js`, `uuidv7`) | client + server |
| **`sales-calc`** (`src/lib/sales-calc/`) | `lineGross`, diskon baris/bill (persen/nominal), batas diskon efektif dua tingkat (BR-DSC-003), SC, pajak eksklusif/inklusif + DPP, **pemilihan tarif menurut `business_date`** (SCHEMA §4.1.4), pembulatan tunai (BR-TAX-009), alokasi LR ke baris, pembayaran/kembalian, split per item/qty/bagi-rata (BR-SPL-*), nilai retur dari angka tersimpan (BR-RTR-006), rumus `kas_diharapkan` (BR-SHF-005), `verifySale(payload)` → daftar selisih | `kernel` | client (hitung & simpan) + server (verifikasi) |
| **`contracts`** (`src/lib/contracts/`) | Skema Zod: amplop API, **tipe perintah** (Lampiran B SCHEMA) per `schema_version`, event bill, `result` ACK, kode error publik, enum/kode (status, alasan, flag), konstanta `SCHEMA_VERSION` + `SUPPORTED_SCHEMA_VERSIONS`, **migrator payload** `N−1 → N` per tipe perintah (murni, teruji) | `kernel` | client + server |

Perilaku kunci:
- **Jantung kebenaran angka**: semua fungsi murni, tanpa `Date.now()`/`Math.random()`/I/O (waktu dan acak disuntik) → deterministik, dapat diuji dengan vektor.
- **Vektor uji kanonik** `V-01…V-30` (PRD Lampiran D) disimpan sebagai data uji (`*.vectors.ts`) dan dijalankan oleh (a) tes unit paket, (b) tes integrasi server yang memproses `FinalizeSale` dengan payload berangka V-04…V-11/V-18…V-21/V-29/V-30 dan memeriksa angka yang tersimpan sama persis. Gerbang CI: gagal bila satu angka berbeda (FR-QA-003).
- **Test properti** (`fast-check`): Σ hasil LR = total; hasil tak bergantung urutan input setara; pembulatan tunai idempoten; `parseInvoiceNo(formatInvoiceNo(x)) = x`; perintah dengan urutan acak/duplikat → state akhir sama (konvergensi, §9.2).
- **Pembatasan**: tidak ada impor `react`, `@tanstack/*`, DOM, API Node (`node:*`), `drizzle-orm`; ditegakkan ESLint + dependency-cruiser (§8.5). `Intl` tersedia di Node dan peramban sehingga `time`/`format` tetap isomorfik.
- **Pustaka desimal**: `decimal.js` (sama dengan referensi) dengan `precision` tinggi dan `ROUND_HALF_UP`; alternatif `big.js` (±3 KB gz) cukup untuk +,−,×,÷ tetapi tidak dipilih karena referensi sudah memakai `decimal.js` dan selisih bundle (±10 KB gz) dapat diterima. Dievaluasi ulang hanya bila anggaran bundle terlampaui (RSK-A05).
- Logika **HPP/moving average** dan konsumsi resep **tidak** ada di paket bersama: hanya di server (`modules/inventory/server/costing.ts`, murni, diuji dengan V-12…V-17) karena device tidak boleh menghitung HPP (BR-HPP-001). Fungsi **ketersediaan efektif** (BR-CAT-010/016, V-27) berada di `modules/catalog/domain/` (murni, isomorfik) karena dipakai client (sembunyikan item) dan server (flag `ITEM_TIDAK_TERSEDIA`).

### 2.6 Tabel versi/paket yang direkomendasikan

Versi "registry" = terbaru di npm pada 2026-11-18. Versi "referensi" = yang dipakai `financeDashboard` (terpasang dan teruji bersama TanStack Start di proyek itu). **Rekomendasi: mulai dari versi referensi untuk paket yang sama (kompatibilitas terbukti), lalu naikkan patch/minor setelah F1 hijau; kunci versi persis (pin) seperti referensi.** Tanda `VERIFIKASI` = kompatibilitas dengan paket lain belum terbukti.

| Area | Paket | Peran | Registry | Referensi | Catatan / kompatibilitas |
|---|---|---|---|---|---|
| Runtime | Node.js | Server + tooling | — | engines `≥22.12.0` | LTS (keputusan user, OQ-A18) |
| Bahasa | `typescript` | Tipe | 7.0.2 | **5.9.3** | Pin **5.9.x**: `typescript-eslint` 8.72.1 di referensi; TS 7 dievaluasi pasca-F1 `VERIFIKASI` |
| UI | `react`, `react-dom` | UI | 19.3.1 | 19.3.1 | sama |
| Build | `vite` | Bundler | 8.3.8 | 8.3.5 | `@tanstack/react-start` mensyaratkan peer `vite >= 8` ✔; `vite-plugin-pwa` 2.0.0 mendukung `vite ^8` ✔ |
| Framework | `@tanstack/react-start` | SSR + server fn + server route | 1.169.5 | 1.169.4 | peer `react 18/19` ✔ |
| Router | `@tanstack/react-router`, `@tanstack/react-router-ssr-query` | Routing + hidrasi Query | 1.170.46 / — | 1.170.46 / 1.167.3 | sama |
| Data server | `@tanstack/react-query` | Cache server-state | 5.108.0 | 5.105.0 | — |
| Style | `tailwindcss`, `@tailwindcss/vite` | Utilitas + token | 4.3.5 | 4.3.3 | Tailwind v4 (DOQ-17) |
| Komponen | `radix-ui`, `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react` | Primitif a11y, varian, ikon | radix-ui 1.8.1 | radix 1.8.1, cva 0.7.1, tw-merge 3.7.0, clsx 2.1.1, lucide 1.63.0 | sama |
| Font | `@fontsource-variable/plus-jakarta-sans` | Font self-host | 5.3.0 | — | Verifikasi fitur `tnum` sebelum implementasi (DOQ-01) |
| Validasi | `zod` | Kontrak | 4.6.7 | 4.6.7 | sama |
| Desimal | `decimal.js` | Kuantitas/HPP | 10.6.0 | 10.6.0 | sama |
| ID | `uuidv7` | UUIDv7 client+server | 1.2.1 | — | alternatif `uuid` 14.x (mendukung v7) |
| Lokal | `dexie`, `dexie-react-hooks` | IndexedDB + `liveQuery` | 4.4.7 / 4.4.0 | — | Opsi `chromeTransactionDurability` terverifikasi di paket 4.4.7 |
| PWA | `vite-plugin-pwa`, `workbox-window`, `workbox-build` (+ modul `workbox-*` di SW) | SW, precache | 2.0.0 / 7.4.1 / 7.4.1 | — | Integrasi dengan TanStack Start (dua environment build) **`VERIFIKASI` F1** (`OQ-A02`) |
| i18n | `i18next`, `react-i18next` | Terjemahan | i18next 27.1.5 | **26.5.11** / 17.1.9 | Mulai dari **26.5.11 + 17.1.9** (kombinasi terbukti); 27.x `VERIFIKASI` |
| Store keranjang | `zustand` (keputusan user, OQ-A03) | State draf | 5.1.0 | — | dipersist manual ke Dexie `cart_draft` |
| Auth | `better-auth` | Login `/admin` | 1.7.25 | — | peer `drizzle-orm ^0.45.2` ✔, `@tanstack/react-start ^1.0.0` ✔ |
| DB | `drizzle-orm`, `drizzle-kit`, `pg` | ORM, migrasi, driver | 0.45.4 / 0.31.11 / 8.23.1 | drizzle 0.45.4, kit 0.31.11 | Rilis `1.0.0-rc.*` ada — **jangan** dipakai di MVP |
| Hash PIN | `hash-wasm` | Argon2id (WASM), PBKDF2 cadangan, SHA-256 | 4.13.0 | — | Satu implementasi untuk client dan server (hasil deterministik) |
| Barcode | `barcode-detector` (polyfill berbasis `zxing-wasm`) | Kamera di perangkat tanpa API native | 3.2.4 (zxing-wasm 3.1.7) | — | `BarcodeDetector` native belum tentu ada di Chrome Windows `VERIFIKASI` (§7.5) |
| Log | `pino`, `pino-roll` | Logging JSON | 10.4.0 / 4.0.0 | 10.4.0 / 4.0.0 | sama |
| Uji | `vitest`, `@playwright/test`, `fast-check` | Unit/integrasi, E2E offline, properti | 5.1.0 / 1.65.1 / 4.10.2 | vitest 5.0.5 | Playwright emulasi offline (`context.setOffline`) |
| Batas arsitektur | `eslint` (+`typescript-eslint`), `dependency-cruiser`, `size-limit` | Lint dependensi, siklus, anggaran bundle | dep-cruiser 18.8.0, size-limit 14.3.0 | eslint 10.13.0 | `eslint-plugin-boundaries` 7.4.4 sebagai alternatif satu-alat |
| Infra | PostgreSQL **18**, Nginx (stable) + certbot, Docker Compose | DB, proxy, orkestrasi | — | — | PG 18 diperlukan bila `uuidv7()` bawaan dipakai (SCHEMA §1.2); `NULLS NOT DISTINCT` butuh ≥ 15; tag image `VERIFIKASI` |

---

## 3. Arsitektur Penyimpanan Lokal & Siklus Data Client

### 3.1 Inisialisasi dan urutan boot `/pos`

Target: **start dingin offline sampai layar login ≤ 3 dtk** (NFR-PERF-004) pada perangkat Android kelas menengah (AS-04). Urutan boot (`DIUSULKAN`), tidak ada langkah yang memerlukan jaringan:

| # | Langkah | Anggaran (indikatif) | Bila gagal |
|---|---|---|---|
| 1 | SW melayani shell `/pos` dari precache (§2.3) | ≤ 150 ms | Kunjungan pertama tanpa SW → perlu online (FLOW-01 sudah mensyaratkan) |
| 2 | Parse bundle `/pos`, init i18next (kamus ter-bundle), pasang `ErrorBoundary` global (→ `device_log` `APP_ERROR`) | ≤ 700 ms | — |
| 2a | **Resolusi tenant**: slug dari URL → `tenant_id` lewat registri `solva-registry` (§1.7); tak ada ⇒ layar "perangkat belum terdaftar untuk tenant ini" (online/pairing) | ≤ 10 ms | Slug tak dikenal offline ⇒ tidak membuka DB apa pun |
| 3 | **Minta kunci instance** `solva:<tenant_id>:instance:<deviceId>` dengan `ifAvailable` (§3.7). Gagal → mode pasif SCR-P15 "instance ganda" | ≤ 20 ms | Tab pasif tidak membuka layar kerja |
| 4 | **Buka Dexie** (menjalankan migrasi bila versi naik, §3.2). Bila migrasi > 500 ms tampil progres "Memperbarui data lokal" | ≤ 300 ms tanpa migrasi | Migrasi gagal → mode pemulihan (§3.2) |
| 5 | Baca `meta` dalam satu `bulkGet`: `device`, `cursor`, `clock`, `last_success_sync_at`, `locale`, `idle_lock`, `catalog_cursor`, `stock_snapshot_meta` | ≤ 50 ms | Tidak ada `meta.device` → SCR-P01 (pairing; butuh online) |
| 6 | Hitung **keadaan perangkat**: lease (§6.4), jam mundur (`max_seen_time`, BR-AUT-013), prefiks/tarif tersedia, versi wajib belum diterapkan, device dicabut (dari sync terakhir) | ≤ 20 ms | Lease habis / jam mundur → SCR-P15 (terkunci); selainnya → SCR-P02 |
| 7 | Render SCR-P02 (pilih staf + PIN). Kunci layar yang tertunda dipulihkan dari `meta.idle_lock` | — | — |
| 8 | **Setelah paint pertama** (tidak menghalangi): mulai Sync Engine (probe → push → pull), `storage.persisted()/estimate()`, pemanasan indeks katalog dalam memori setelah login | latar | Kegagalan ke `device_log`, bukan galat layar |

Prinsip: **Dexie adalah sumber kebenaran saat boot**; tidak ada data di memori yang tidak dapat dibangun ulang dari Dexie (kecuali timer dan koneksi). Memuat ulang halaman kapan pun (mis. update PWA, rotasi, crash tab) tidak menghilangkan shift, keranjang (`cart_draft`), open bill, outbox, atau antrean cetak.

Sesi staf **tidak dipersist** melewati muat-ulang penuh: setelah reload pengguna memasukkan PIN lagi (lebih aman; state kerja tetap utuh karena tersimpan lokal — selaras BR-AUT-015 butir 2) — `DIUSULKAN`.

### 3.2 Migrasi skema Dexie, kompatibilitas outbox N−1, dan update di tengah shift

`DISEPAKATI`: skema Dexie dan outbox **berversi**, migrasi satu arah teruji (NFR-MNT-001), migrasi wajib menaikkan versi payload outbox tertunda (BR-SYN-022).

**Empat nomor versi, terpisah** (`DISEPAKATI`, keputusan user 2026-11-18; jangan dicampur; aturan lengkap, penerjemah, dan rilis di §9.6):

| Nomor | Contoh | Berubah bila | Dikirim ke server? | Fungsi |
|---|---|---|---|---|
| (a) **Versi aplikasi** (`app_version`) | `v1.8.0` (tag SemVer git) | Tiap rilis | Ya (`X-App-Version`; dicatat per perintah dan penjualan) | Identitas rilis; tampil di footer layar login dan pengaturan perangkat (SCR-P16) saja; `app_release` |
| (b) **Versi kontrak** (`schema_version`, integer monoton, N) | `7` | Hanya bila format perintah/event berubah dengan cara **tidak dapat diproses penerima lama** (isian wajib baru; ubah nama/tipe/satuan; hapus/ubah makna). Isian **opsional** baru **tidak** wajib menaikkan | Ya (`X-Schema-Version`; menempel di tiap perintah **dan tiap event**) | Format payload di wire dan di `outbox_command`; server menerima **N dan N−1** (BR-SYN-022) dan membaca kontrak lama **selamanya** lewat penerjemah (upcaster) |
| (c) **Versi protokol sync** | `2` | Cara tukar data berubah (bukan isinya): bentuk amplop, cursor, urutan siklus | Ya (`X-Sync-Protocol`) | Negosiasi klien–server atas mekanisme push/pull |
| (d) **Versi skema Dexie** | `12` | Bentuk store/indeks lokal berubah | **Tidak** | Lokal saja; **tidak dapat diturunkan** (alasan roll-forward only, AD-25) |

Aturan migrasi (`DIUSULKAN`):

1. **Urutan upgrade** Dexie berjalan berurutan `v(k) → v(k+1)` di dalam satu transaksi `versionchange` (atomik: gagal ⇒ DB tetap di versi lama). Tiap langkah: (a) ubah store/indeks (deklaratif), (b) `upgrade(tx)` untuk transformasi data.
2. **Upgrade tidak pernah menghapus data pending**: `outbox_command` non-`ACKED`, dokumen transaksi ber-`sync_status ≠ ACKED`, `local_counter`, `meta.device`, `cart_draft` dipertahankan (NFR-STOR-003).
3. **Migrasi payload outbox** di dalam upgrade: untuk tiap `outbox_command` non-`ACKED` dengan `schema_version < SCHEMA_VERSION`, jalankan **rantai migrator** `contracts/migrators/<tipe>` (`N−1 → N`, murni, ber-golden-test per pasangan versi). Hasil divalidasi Zod versi baru. Gagal pada satu perintah ⇒ perintah **tidak dihapus** melainkan `last_error_class='SCHEMA'` + `last_error_code='SCHEMA_NOT_MIGRATABLE'` (ditahan, dapat diekspor; EC-007) — bukan menggagalkan seluruh upgrade.
4. **Master turun** tidak dimigrasi per baris bila bentuknya berubah: Dexie meninggalkan data lama, menandai `meta.full_resync = true`; siklus pull berikutnya melakukan **full resync** (§4.3) — lebih sederhana dan aman daripada transformasi data baca-saja (BR-SYN-010 butir 6: "versi skema tidak kompatibel").
5. **Kompatibilitas wire**: klien versi baru (N+1) selalu mengirim payload **N+1**; server menerima {N+1, N}. Klien lama yang belum memperbarui tetap mengirim N hingga **30 hari** sejak N+1 dirilis (`app_release.accept_previous_until`; keputusan user 2026-11-18, lebih panjang dari lease offline 7 hari dan dari minimum 14 hari BR-SYN-003 butir 3; keputusan user, OQ-A19 terjawab). Setelah itu server menjawab `426 UPDATE_REQUIRED` **untuk pengiriman**; **kemampuan membaca** kontrak lama (event yang sudah tersimpan) tetap selamanya lewat upcaster (§9.6.3). Pembaruan lunak (banner) lalu keras (§4.7) mengikuti jendela ini.
6. **Klien lebih baru daripada server** (setelah rollback server): server menjawab `max_schema_version` pada `/ping` dan respons push/pull. Klien **menahan** perintah yang kontraknya melebihi nilai itu (`last_error_class='SCHEMA'`, kode `SERVER_BEHIND`; **bukan** "perlu perhatian"), menampilkan banner "server sedang diperbarui", penjualan tetap tersimpan lokal, dan antrean dikirim otomatis setelah server cocok — tidak ada data hilang. Rollback server hanya ke versi yang mengenal semua kontrak yang sudah dipakai klien di lapangan (konsisten dengan OQ-A14).
7. **Tes**: fixture Dexie "dunia lama" per versi (data + outbox beragam, termasuk 12 perintah `v7` pending dari contoh EC-006) → jalankan upgrade → afirmasi: tak ada baris hilang, payload valid, nomor invoice berikutnya benar, Playwright memuat ulang app di tengah antrean (FR-QA-001).

**Update aplikasi di tengah shift** (FLOW-17, BR-SYN-002/003) — urutan:

```
SW baru terpasang (waiting) ─► UpdateManager: state=available ─► banner + dialog (tidak memotong checkout/bayar)
    ├─ pengguna "Muat ulang" (momen apa pun yang tidak memotong checkout/bayar)
    │  ATAU pembaruan KERAS (setelah batas waktu jendela dukungan, §9.6.4) & MOMEN AMAN:
    │      MOMEN AMAN = tidak ada checkout/pembayaran/keranjang aktif ∧ shift tertutup ∧ antrean sync kosong
    │                   ∧ antrean sync kosong (tidak ada perintah outbox non-ACKED)
    │      └─► state=applying: tunggu transaksi IDB berjalan selesai ─► SKIP_WAITING ─► controllerchange ─► reload
    │                          └─► bundle baru ─► Dexie upgrade (§3.2) ─► SCR-P02 (PIN) ─► shift/keranjang utuh
    └─ pengguna "Nanti" ─► banner tetap; dialog muncul lagi tiap 2 jam; "Muat ulang" ditunda selama checkout/bayar
Pembaruan keras TIDAK PERNAH diterapkan di tengah shift atau saat ada antrean sync; shift boleh dilanjutkan dan ditutup, shift BARU diblokir
bila rilis wajib belum diterapkan; update diterapkan otomatis begitu momen aman tercapai (selaras keputusan user 2026-11-18, §9.6.4).
```

**Mode pemulihan (upgrade Dexie gagal)**: bila `Dexie.open()` pada versi baru gagal (mis. kuota penuh, bug migrasi), aplikasi **tidak** menghapus DB. Ia membuka SCR-P15 varian "Gagal memperbarui data lokal" dengan: (a) **Ekspor pending** — dibaca lewat Dexie **mode dinamis** (`new Dexie('Solva').open()` tanpa deklarasi versi membaca skema yang ada) sehingga ekspor tidak bergantung pada kode skema baru; (b) "Coba lagi"; (c) instruksi menghubungi pengembang dengan `KODE#id`. Tidak ada tombol "reset data" tanpa ekspor lebih dulu.

**Kebijakan rollback `/pos` (AD-25, `DIUSULKAN`)**: IndexedDB **menolak** dibuka dengan versi lebih rendah (`VersionError`). Karena itu bundle `/pos` yang membawa versi Dexie lebih tinggi **tidak boleh** di-rollback ke bundle lama; perbaikan dilakukan **roll-forward** (hotfix bernomor lebih tinggi yang boleh mempertahankan store yang sama). Urutan deploy: (1) migrasi DB additive → (2) server (menerima N dan N−1) → (3) bundle `/pos`. Server **boleh** di-rollback hanya ke versi yang masih menerima/mengenal `schema_version` yang dipakai klien di lapangan; bila rollback server membuat klien lebih baru daripada server, berlaku butir 6 di atas. **Keputusan user (OQ-A14, 2026-11-18): roll-forward saja** untuk bundle `/pos`; rollback aplikasi **server** otomatis bila health check gagal (§9.6.2).

### 3.3 Transaksi finalisasi (AD-14)

`DISEPAKATI` (BR-INV-004, EC-020, NFR-REL-003): satu transaksi IndexedDB menyimpan semuanya atau tidak sama sekali.

**Tahap A — di luar transaksi** (boleh async): ambil kunci sumber daya `solva:<tenant_id>:res:finalize:{registerId}` (§3.7); validasi Zod keranjang; `sales-calc` menghitung semua angka (gross, diskon, SC, pajak, rounding, alokasi LR, pembayaran, kembalian); tentukan `business_date` dari waktu terkoreksi (`device_now + clock_offset`) + zona/jam potong outlet; pilih tarif menurut `business_date`; baca prefiks register berlaku untuk periode itu; bentuk `id` (UUIDv7), semua `id` baris anak, `command_id = sale.id`, entri audit (PIN supervisor/diskon override bila ada); bangun payload `FinalizeSale` bervers `N`; hitung `payload_hash` bila dipakai.

**Tahap B — satu transaksi Dexie `rw`** pada store: `local_counter`, `sale`, `sale_line`, `sale_line_modifier`, `sale_payment`, `shift` (bila rekap lokal berubah), `bill`/`bill_item` (F&B), `outbox_command`, `print_job`, `cart_draft`, `device_log` (opsional). Operasi (tanpa `await` non-IDB):

| Urut | Operasi | Catatan |
|---|---|---|
| 1 | Baca `local_counter["{register}\|INVOICE\|{MMYY}"]` → `seq = last_seq + 1`; tulis kembali `last_seq = seq` | **Baca-ubah-tulis di dalam transaksi yang sama** — dua penulis tak dapat memperoleh `seq` yang sama (transaksi `rw` dengan cakupan bertumpuk diserialkan oleh IndexedDB) |
| 2 | Bentuk `invoice_no = formatInvoiceNo(prefix, MMYY, seq)` (kernel); verifikasi unik lokal (`&invoice_no`) | Gagal unik ⇒ abort (tak boleh terjadi; indikasi bug) |
| 3 | Tulis `sale`, `sale_line*`, `sale_payment*` (`sync_status='PENDING'`) | Angka dari Tahap A, **tidak dihitung ulang** (BR-MNY-003) |
| 4 | Tulis `outbox_command` (`status='PENDING'`, `device_seq = counter+1` dari `local_counter["device_seq"]`, `depends_on` sesuai §4.2) | `device_seq` juga dinaikkan di transaksi ini |
| 5 | Tulis `print_job` (`kind='RECEIPT'`, `status='QUEUED'`, `receipt_locale` dari dokumen) | Cetak tidak menghalangi (AP-10) |
| 6 | Tandai `cart_draft` dipakai (hapus) / bill F&B `status` lokal | — |
| commit | Resolve ⇒ UI sukses (SCR-P09) | Target p95 ≤ 300 ms (NFR-PERF-001) |

**Tahap C — setelah commit**: pancarkan sinyal internal (`finalized`) → `PrintQueue.kick()` dan `SyncEngine.kick()` (push segera bila online, BR-SYN-040 butir d); buka laci kas bila ada pembayaran tunai (BR-PRN-006).

**Jaminan**: crash/pemadaman di mana pun sebelum commit ⇒ rollback penuh, keranjang tetap ada, **nomor tidak terpakai** (EC-020, FR-POS-007); sesudah commit ⇒ data durable berkat `strict` (§2.2). Kegagalan menyalakan cetak **tidak** membatalkan apa pun. Kasir yang menekan "Selesai" dua kali tidak membuat dua penjualan: kunci `finalize` (§3.7) + `cart_draft` yang dikonsumsi di transaksi pertama.

Aturan yang sama (satu transaksi pendek, tanpa `await` non-IDB, counter di dalamnya) berlaku untuk **nota kredit** (`INVOICE`→`CREDIT_NOTE` seri sendiri, BR-INV-010), **void**, **buka/tutup shift**, **kas masuk/keluar**, dan **event bill** (tiap event + `device_seq` + proyeksi `bill_item` lokal dalam satu transaksi).

### 3.4 Kapasitas storage, `storage.persist()`, dan estimasi

| Aspek | Keputusan | Rujukan |
|---|---|---|
| `persist()` | Diminta **saat pertama berjalan** (SCR-P01), hasil (`granted/denied`) disimpan di `meta.storage.persist` dan dilaporkan ke `device_sync_status.storage_persist`; diperiksa ulang tiap boot (`persisted()`) | BR-SYN-050, FR-DEV-005 |
| Bila `denied` | Chip peringatan di SCR-P16; pada device dengan pending > 0, banner diperkuat ("pasang aplikasi ke layar utama") — peramban cenderung memberi `persist` kepada PWA yang terpasang/sering dipakai `VERIFIKASI` (heuristik Chrome; spike F1) | BR-SYN-053 (risiko residual RSK-02 diterima) |
| `estimate()` | Dipanggil saat boot dan tiap 10 menit saat idle; `usage/quota` → `storage_used_pct` (dikirim ke server, FR-DEV-004) | BR-SYN-054 |
| Ambang | **> 70%** banner peringatan + progress di SCR-P16 (non-blokir). **> 85%**: pruning dijalankan segera (§3.5) dan retensi payload `ACKED` outbox dipersingkat ke 1 hari. Pending **tidak pernah** dibuang berapa pun persentasenya | BR-SYN-054, EC-009 |
| Anggaran target | Retail ±160–210 MB, F&B ±220–310 MB (SCHEMA §6.5.1); kuota Chrome umumnya jauh di atas itu. **Diukur di F3** pada perangkat uji (DOQ-06) | NFR-STOR-002 |
| Tulis gagal `QuotaExceededError` | Transaksi finalisasi gagal **tanpa efek** (rollback); UI tampil pesan khusus + tautan ekspor/pruning; tidak ada nomor hangus | EC-009, EC-020 |

### 3.5 Pruning (retensi lokal) dan ekspor pending

`DISEPAKATI`: retensi riwayat tersinkron **3 bulan**; **data yang belum sync tidak pernah dibuang**; ekspor pending ke file tersedia kapan pun (BR-SYN-052/054, FR-SYN-012).

**Pembersih** (`pos/maintenance/retention.ts`; berjalan di instance aktif saat idle — `requestIdleCallback`/`scheduler.postTask('background')`, per potongan kecil 200 baris agar tidak mengganggu kasir):

| Objek | Syarat dihapus | Catatan |
|---|---|---|
| `sale`, `sale_line*`, `sale_payment`, `credit_note*`, `cash_movement`, `shift` | `sync_status = 'ACKED'` **dan** `business_date` < awal bulan kalender (hari ini − 3 bulan) (BR-SYN-054) | Dipilih lewat indeks `[sync_status+business_date]`; baris `PENDING`/`SENDING`/`NEEDS_ATTENTION` **tak pernah** dipilih. Anak ikut induk dalam satu transaksi potongan. |
| `bill`, `bill_item*`, `bill_event` | Bill selesai (`PAID/CANCELED/MERGED/CLOSED_BY_SPLIT`) + semua event `ACKED` + lewat retensi | Bill `OPEN` tidak pernah dibuang |
| `outbox_command` | `ACKED` lebih dari **7 hari** (payload dibuang, ringkasan tetap hingga dokumennya dipangkas) | SCHEMA §6.1.B; `PENDING/SENDING/NEEDS_ATTENTION` tak pernah |
| `print_job` | `DONE` > 7 hari | `FAILED` dipertahankan sampai dicetak ulang/diabaikan |
| `device_log` | Penuh (> 500) → entri **tertua** dibuang; terkirim → dibuang | Satu-satunya data yang boleh dibuang tanpa syarat (BR-LOG-010) |
| `pull_stage` | Siklus selesai/dibatalkan | §4.3 |
| `cart_draft` | Dipakai, dibuang manual, atau shift staf ditutup (override) | BR-AUT-015 |

**Ekspor pending**: tombol di banner pending (CMP-17) dan SCR-P14/P15 menghasilkan berkas **JSON Lines** `solva-pending_{deviceId}_{UTC}.jsonl` (unduhan lokal, tanpa jaringan): baris pertama = header (`device_id`, `register_id`, `app_version`, `schema_version`, waktu terkoreksi, jumlah, hash SHA-256 isi), lalu satu `outbox_command` lengkap per baris (payload apa adanya + `device_seq`). Tersedia saat **terkunci** (lease habis) dan di mode pemulihan (§3.2). Impor di server: §5.9. Ekspor dicatat sebagai audit lokal (`export.pending`, BR-AUD-001) dan ikut terkirim saat online.

### 3.6 Kapan full resync

Full resync mengganti **tabel master lokal saja** (bukan outbox, bukan transaksi) — `DISEPAKATI` (FLOW-15 langkah 6, EC-022). Pemicu:

| Pemicu | Sumber |
|---|---|
| Cursor `<` `tombstone_floor_version` (server membalas `FULL_RESYNC_REQUIRED`) | BR-SYN-010 butir 6 |
| Versi skema Dexie/master tidak kompatibel (`meta.full_resync` dari migrasi, §3.2) | BR-SYN-010 butir 6 |
| Enrollment awal / device dipulihkan (FLOW-01, FLOW-16) | FLOW-01 |
| **Pemeriksaan integritas gagal** (`meta.cursor` ada tetapi store master kosong/tak lengkap; hitungan baris master ≠ ringkasan `manifest` dari server pada akhir pull) | `DIUSULKAN` — pengaman terhadap korupsi/pembersihan peramban parsial |
| Pengguna menekan "Perbaiki data katalog" di SCR-P16 (butuh online) | `DIUSULKAN` |

Prosedur lengkap di §4.3. Selama full resync berjalan, layar jual tetap memakai katalog **lama** (jika ada) sampai penerapan atomik — kecuali device baru (belum punya katalog; tampil progres SCR-P01).

### 3.7 Koordinasi multi-tab dan sumber daya

`DISEPAKATI` (EC-021, FR-SYN-014): **hanya satu instance `/pos` aktif per device**; tab kedua pasif/ditolak sehingga tidak ada balapan counter nomor. Mekanisme di bawah `DIUSULKAN` (brief meminta "leader election sync, satu tab leader cetak" — RK-05: dengan batas "satu instance aktif" dari PRD, *leader* = *instance aktif*; tidak ada beberapa tab yang bekerja sekaligus).

**Lapisan perlindungan (pertahanan berlapis):**

| Lapis | Mekanisme | Mencegah |
|---|---|---|
| 1. **Kunci instance** | `navigator.locks.request('solva:<tenant_id>:instance:<deviceId>', {mode:'exclusive', ifAvailable:true}, cb)` (satu kunci **per tenant**: tab tenant berbeda tidak saling memblokir); `cb` menahan kunci selama tab hidup (promise yang tak pernah selesai). Dapat → **instance aktif (primer)**. Tidak dapat → **pasif** (SCR-P15 "instance ganda") dan **mengantre** permintaan kunci menunggu (tanpa `ifAvailable`) | Dua tab bekerja; dua mesin sync/cetak |
| 2. **Kunci sumber daya** (di dalam instance aktif) | `solva:<tenant_id>:res:<deviceId>:<nama>` — `finalize:{registerId}` (alokasi nomor + simpan), `shift:{registerId}`, `pull-apply`, `push-batch`, `print:{printerId}`, `bill:{billId}` (aksi bill) | Interleaving async dalam satu tab (klik ganda "Selesai", sync menerapkan pull saat kasir membuka katalog, dua aksi bill bersamaan); menjadi jaring pengaman bila asumsi lapis 1 terlewat |
| 3. **Serialisasi IndexedDB** | Transaksi `rw` dengan cakupan store bertumpuk diserialkan; counter dibaca-diubah-ditulis di **dalam** transaksi | Nomor ganda walau dua penulis lolos lapis 1–2 |
| 4. **Server** | `UQ (register_id, invoice_period, invoice_seq, invoice_conflict_idx)`, `UQ (tenant_id, invoice_no)`, idempotensi per `command_id`; `-Dn` (BR-INV-009) | Nomor ganda lintas device/pemulihan |

**Peran instance aktif**: satu-satunya yang menjalankan **Sync Engine** (push/pull/probe/SSE), **antrean cetak** (`print_job`, akses perangkat USB/BLE), **UpdateManager**, **pengirim `device_log`**, pembersih retensi, dan **otoritas timer kunci layar**. Tab pasif hanya menampilkan SCR-P15; ia **tidak** membuka layar kerja, tidak menulis Dexie, tidak menjalankan jaringan.

**`BroadcastChannel('solva:<tenant_id>:<deviceId>')`** — pesan (semuanya informatif; kebenaran tetap di Dexie/lock):

| Pesan | Arah | Fungsi |
|---|---|---|
| `hello` / `alive` (heartbeat 5 dtk) | primer → pasif | Pasif menampilkan "Instance aktif di tab lain" vs "Tab lain tidak merespons" bila heartbeat hilang > 20 dtk |
| `locked` / `unlocked` | primer ↔ pasif | Sinkron tampilan kunci layar bila pengguna memindah fokus |
| `promoted` | pasif yang naik jadi primer | Hanya log |
| `update-ready` | primer → pasif | Pasif diberi tahu bahwa muat ulang akan terjadi |

Perubahan data lintas tab dilihat lewat `liveQuery` Dexie (Dexie menyiarkan perubahan antartab sendiri) — tidak perlu pesan khusus.

**Skenario yang diuji (Playwright, 2 tab satu konteks):**

| Skenario | Hasil yang wajib |
|---|---|
| Dua tab menekan **Bayar/Selesai bersamaan** | Tab kedua tidak pernah interaktif (pasif); bila kunci instance sengaja dipaksa lepas (uji), kunci `finalize` + serialisasi IDB menghasilkan **dua nomor berurutan** (`…000123`, `…000124`), tanpa duplikat/celah |
| Tab primer ditutup (bukan crash) saat tab pasif menunggu | Tab pasif otomatis menjadi primer, re-init (§3.1 langkah 4–8); keranjang `cart_draft` utuh |
| Tab primer crash/dibuang peramban | Kunci dilepas otomatis oleh peramban; tab pasif naik; transaksi IDB yang sedang berjalan di-rollback (tak ada nomor hangus) |
| Tab primer **membeku** (tidak ditutup) | Pasif menampilkan "Tab lain tidak merespons"; **tidak ada pengambilalihan paksa** (keputusan user, OQ-A07, 2026-11-18); pengguna menutup tab itu |
| Dua tab membuka **shift yang sama** | Hanya primer yang dapat menulis; `OpenShift` kedua tak mungkin dibuat. Server pun menolak shift ganda per register (`UQ (register_id) WHERE status='OPEN'`) |
| `/admin` terbuka di tab lain pada profil yang sama | Tidak terdampak (tidak menyentuh Dexie `/pos`; kunci instance hanya dimiliki `/pos`) |
| Dua **profil/peramban** berbeda pada mesin yang sama | Dianggap **dua device** terpisah (IndexedDB terpisah); enrollment kedua pada register yang sama mensyaratkan pencabutan device pertama (satu device aktif per register, BR-INV-001) |
| **Dua tenant berbeda** di satu browser/profil (`/<slugA>/pos` dan `/<slugB>/pos`) | **Diizinkan**: database, kunci, saluran, dan cookie dinamai per `tenant_id`/slug, sehingga masing-masing tenant memiliki instance aktif, antrean sync, dan SW sendiri; tidak ada data yang dibaca lintas tenant. Kuota storage dan izin `persist` dibagi per origin; printer fisik yang sama dipakai bergantian lewat kunci `print:<printerId>` (per origin) |

**Mengapa bukan "leader election dinamis antar tab setara"**: model itu cocok untuk aplikasi yang boleh dipakai di banyak tab sekaligus. PRD justru melarangnya (EC-021) karena counter nomor dan sesi kasir bersifat tunggal; kunci eksklusif lebih sederhana, lebih mudah diuji, dan menghilangkan seluruh kelas bug koordinasi. Trade-off: pengguna tidak dapat membuka dua tab `/pos` untuk "membandingkan layar" — memang tidak dimaksudkan.

---

## 4. Mesin Sinkronisasi Dua Arah

Prinsip (tidak dibantah ulang): master **satu arah turun**, transaksi **satu arah naik** (AP-04); server otoritas (AP-01); fakta tidak ditolak (AP-02); tidak ada sync LAN (AP-03); **tidak ada resolusi konflik merge/LWW** (SCHEMA §2.1) — konflik = penerimaan fakta + flag/antrean.

### 4.1 Komponen Sync Engine (hanya di instance aktif)

```
                        ┌──────────────────────────── Sync Engine (instance aktif) ────────────────────────────┐
  event: online · focus  │                                                                                      │
  visibility · interval ─►  Scheduler ──► Connectivity (probe, state machine) ──► Clock (offset, max_seen)       │
  60 dtk · finalized     │      │                    │                                                           │
  SSE signal ────────────►      ├──► Pusher  ◄─ outbox_command (Dexie) ──────────────► POST /push ──► Server    │
                         │      │      (batch, dependensi, backoff+jitter, klasifikasi hasil)                   │
                         │      ├──► Puller  ──► pull_stage (Dexie) ──► Applier (1 transaksi) ──► master store  │
                         │      │      (cursor, halaman 500, full resync)           ▲                           │
                         │      ├──► Snapshots (stok, open bill, rilis, command_updates, logo)                  │
                         │      ├──► LogShipper (device_log, batas laju, tidak memblokir)                       │
                         │      └──► StatusReporter (pending, offset, app/schema version, storage → server)     │
                         │                                                                                      │
                         │  Keluaran ke UI: SyncState (store reaktif) → indikator CMP-17, SCR-P14, banner       │
                         └──────────────────────────────────────────────────────────────────────────────────────┘
```

Satu **siklus sinkron** = `probe → push → pull(+apply) → snapshot → lapor status`. Push dilakukan **sebelum** pull agar perubahan stok/ACK terkini ikut terbaca (BR-SYN-040: "push lalu pull"). Satu siklus berjalan pada satu waktu (kunci `solva:<tenant_id>:res:<deviceId>:sync`); pemicu yang datang saat siklus berjalan digabung menjadi satu siklus lanjutan (*coalescing*).

**Pemicu** (`DISEPAKATI`, BR-SYN-040): app aktif/dibuka/fokus; event `online`; interval **60 dtk** saat online; setelah finalisasi (push segera); ditambah sinyal SSE (BR-SYN-041, §4.6). Event `online` memicu push **≤ 5 dtk** (FR-SYN-008) setelah probe sukses (jitter awal 0–2 dtk agar ratusan device tidak menyerbu bersamaan setelah gangguan ISP). **Background Sync API tidak diandalkan** (BR-SYN-040).

### 4.2 Outbound — outbox → server

#### 4.2.1 Bentuk perintah (`outbox_command`, SCHEMA §4.6.9) dan amplop API

Perintah di Dexie memuat: `id` (UUIDv7 = idempotency key; untuk `FinalizeSale` = `sale.id`), `type` (Lampiran B SCHEMA), `payload`, `schema_version`, `device_seq`, `register_id`, `status` (`PENDING/SENDING/ACKED/NEEDS_ATTENTION`), `dependency_key`, `depends_on[]`, `attempts`, `next_retry_at`, `last_error_class` (`TRANSIENT/STRUCTURAL/AUTHORIZATION/SCHEMA`), `last_error_code/ref`, `result`.

Amplop (kontrak `contracts`, ilustrasi bentuk — bukan kode final):

```
POST /api/pos/v1/push                       Authorization: Bearer <device token>
  X-App-Version · X-Schema-Version · X-Sync-Protocol · X-Request-Id (opsional, hanya bila aman — BR-LOG-005)
  { "sent_at_device": ISO, "clock_offset_ms": int,
    "commands": [ { "id","type","schema_version","device_seq","depends_on":[...],
                    "created_at_device": ISO, "payload": {...} } ...  ≤ 20 perintah / ≤ 256 KB ] }

200 { "server_time": ISO,
      "results": [ { "id","outcome":"ACK"|"ATTENTION"|"RETRY"|"HELD",
                     "result":{ ...disimpan sbg idempotency_command.result... },     // ACK
                     "reason_class":"STRUCTURAL"|"AUTHORIZATION","reason_code":"…","ref":"20261117-143551-k7q2m" } ] }
```

`outcome` (selaras BR-LOG-009 `ACK/RETRY/ATTENTION`; `HELD` tambahan murni dependensi, tidak dicatat sebagai kegagalan):

| outcome | Arti | Efek di client |
|---|---|---|
| `ACK` | Diproses (atau **replay** hasil lama) | `ACKED`; simpan `result` (nomor final, flag, HPP, `received_at`); cerminkan ke dokumen (`sync_status`, `synced_at`, `server_result`) |
| `ATTENTION` | Gagal struktural/otorisasi; ditulis ke antrean "perlu perhatian" | `NEEDS_ATTENTION` + `last_error_*`; **tidak** dikirim ulang otomatis; dependen tetap tertahan |
| `RETRY` | Transien di sisi server (`lock_timeout`, deadlock, `serialization_failure`, DB tak tersedia) | tetap `PENDING`; `attempts++`; `next_retry_at` per perintah (backoff) |
| `HELD` | Induk (`depends_on` / `blocked_by_command_id`) belum selesai di server | tetap `PENDING`, **tanpa** menaikkan `attempts`; dicoba lagi pada siklus berikut |

#### 4.2.2 Pemrosesan di server (per perintah = satu transaksi; BR-SYN-020, BR-ARC-005)

```
request ─► (1) autentikasi device: Bearer → SHA-256 → device (belum dicabut, belum kedaluwarsa) → tenant/register/outlet
        ─► (2) X-Schema-Version ∈ SUPPORTED? tidak → 426 UPDATE_REQUIRED (seluruh request; tak ada efek)
        ─► untuk tiap perintah, berurutan menurut device_seq (satu request = satu urutan; antar-device paralel):
             (3) Zod(contracts[type][schema_version]) gagal ──────────────► ATTENTION (STRUCTURAL: VALIDATION_FAILED)
             (4) withTenant(tx):
                   a. INSERT idempotency_command(command_id, payload_hash, …) ON CONFLICT DO NOTHING
                        └ sudah ada: payload_hash sama → kembalikan result tersimpan (REPLAY, tanpa efek) → ACK
                                     payload_hash beda → ATTENTION (STRUCTURAL) — kunci dipakai ulang/dirusak
                   b. cek ketergantungan (depends_on ACKED? parent ATTENTION OPEN?) tidak terpenuhi → rollback → HELD
                   c. dispatch ke penangan modul (sales/shift/fnb/identity) — di tx yang sama, urutan lock SCHEMA §5.4.3
                   d. tulis result jsonb, status ACKED, duration_ms
                   e. COMMIT
             gagal transien (lock_timeout 55P03, 40001, 40P01, koneksi) ──► rollback ──► RETRY (tidak dicatat sebagai baris)
             gagal struktural/otorisasi di (c) ──► rollback ──► TX BARU: idempotency_command(status=ATTENTION)
                                                    + attention_item + (audit terkait diteruskan lewat AppendAudit, §4.2.5) ──► ATTENTION
```

Catatan desain:
- **Satu transaksi per perintah**, bukan per batch: kegagalan satu perintah tidak menggulung perintah lain (tidak ada *head-of-line blocking*, BR-SYN-030); keduanya tetap atomik di dalam dirinya (tidak ada penjualan setengah jadi, BR-ARC-005).
- **Replay** (kunci sama, hash sama) mengembalikan **hasil yang sama persis** tanpa efek ganda (EC-004, NFR-REL-001) — termasuk bila respons sebelumnya hilang di jalan.
- **Kondisi bisnis tidak pernah gagal**: stok minus, harga stale, item nonaktif/tidak tersedia, tarif berbeda, selisih hitung, nomor konflik → `data_flag`/`-Dn`, hasil `ACK` (AP-02, BR-SYN-030 baris 1; BR-LOG-009).
- **Identitas pengirim berasal dari credential**, bukan payload: `tenant_id/register_id/outlet_id/device_id` diisi server dari `device`; payload yang mengklaim register lain → `ATTENTION (AUTHORIZATION)`. Register berjenis `WAITER` mengirim `FinalizeSale/OpenShift/…` → `ATTENTION (AUTHORIZATION)` (SCHEMA §4.1.13).
- Perintah dari device **dicabut**: seluruh request `403 DEVICE_REVOKED`; client menandai perintah `NEEDS_ATTENTION (AUTHORIZATION)` **hanya** untuk kode eksplisit (§2.4); manager kemudian "terima manual" (§5.9).

#### 4.2.3 Urutan, dependensi, dan prioritas

`DISEPAKATI` (BR-SYN-023): **FIFO per register** (`device_seq`), kecuali perintah bergantung. Tidak ada prioritas yang mengubah urutan relatif; yang ada hanya **pelompatan** perintah yang belum boleh dikirim (`next_retry_at > now` atau induk belum `ACKED`) sehingga tidak ada HOL blocking.

| Perintah | `depends_on` (diisi client saat membuat outbox, selama induk belum `ACKED`) | Alasan |
|---|---|---|
| `FinalizeSale` | `OpenShift` shift-nya; pada F&B: `AppendBillEvents` pending milik `bill_id` itu | Server menyimpan `shift_id` (FK) dan butuh bill lengkap (BR-FNB-006) |
| `VoidSale` | `FinalizeSale` yang sama | BR-INV-005 |
| `FinalizeCreditNote` | `FinalizeSale` invoice asal (bila belum `ACKED`) | EC-027, BR-RTR-001 |
| `RecordCashMovement`, `CloseShift` | `OpenShift` shift-nya | — |
| `AppendBillEvents` | `AppendBillEvents` sebelumnya milik bill yang sama (urutan `bill_seq`) | BR-SYN-021, FR-SYN-005 |
| `AppendAudit`, `ReportPinState` | — (tak bergantung) | BR-AUD-003 |

Server memverifikasi ulang (`HELD`) karena induk bisa berstatus `ATTENTION` di server walau client belum tahu. Bila induk **diselesaikan manager**: `ACCEPTED_MANUAL` → dependen diproses; `DISMISSED` → dependen berubah `ATTENTION (UNKNOWN_REFERENCE)` (FLOW-18 langkah 3). Client mengetahui keputusan manager lewat blok `command_updates` pada respons pull (client mengirim daftar `id` yang `NEEDS_ATTENTION`; server membalas status terkini) — `DIUSULKAN`.

**Batch**: hingga **20 perintah atau 256 KB** (mana lebih dulu), diproses berurutan; ukuran dikecilkan (5) bila jaringan tidak stabil (§4.4). Satu loop push aktif pada satu waktu (`push-batch`).

#### 4.2.4 Retry, backoff, dan klasifikasi kegagalan

| Kelas | Contoh | Perlakuan | Rujukan |
|---|---|---|---|
| **Bisnis** | stok minus, harga beda, item nonaktif, pajak berubah | **Diterima** (`ACK` + flag) | BR-SYN-030 |
| **Struktural** | Zod gagal, referensi tak dikenal, `payload_hash` beda, retur melebihi qty, `PAYMENT_MISMATCH` | `ATTENTION` → antrean "perlu perhatian" | BR-SYN-030 |
| **Otorisasi** | device dicabut/credential tidak valid, register `WAITER` memakai perintah kasir | `ATTENTION` | BR-SYN-030 |
| **Transien** | timeout, jaringan, 5xx, `lock_timeout`, deadlock | **RETRY** — backoff, **tanpa batas percobaan**, bukan "perlu perhatian" | BR-SYN-024/030 |
| **Transien — dibatasi laju** | `429` + `Retry-After` dari pembatas laju (§6.9) | **RETRY** menurut `Retry-After` (bila lebih lama dari backoff): **`attempts` tidak naik**, tidak `NEEDS_ATTENTION`, bukan kegagalan konektivitas | AD-40 |
| **Skema** | `426 UPDATE_REQUIRED`, payload tak dapat dimigrasi | **Ditahan** (`SCHEMA`), banner wajib update, shift baru diblokir, ekspor tersedia | BR-SYN-003 butir 5, EC-007 |

**Backoff** (`DISEPAKATI` jadwal dasar BR-SYN-024: 5 dtk → 15 dtk → 1 mnt → 5 mnt maks): `delay_n = base_n × U(0,8 … 1,2)` (**jitter ±20%**, tambahan arsitektur — RK-06: mencegah *thundering herd* setelah gangguan; tidak mengubah urutan/batas PRD). Backoff diterapkan pada **level loop push** untuk kegagalan request (jaringan/5xx) dan pada **level perintah** untuk `RETRY` per-perintah. Keberhasilan mereset indeks backoff. Event `online`/sinyal SSE/finalisasi **melewati** penantian backoff satu kali (mencoba segera) tetapi tetap menghormati *coalescing*.

**Antrean "perlu perhatian"**: di device = `outbox_command.status='NEEDS_ATTENTION'` (SCR-P14, tampil `KODE#id`, indikator `sync_error`); di server = `attention_item` terlihat manager di `/admin` (SCR-A09) dengan keputusan terima manual / abaikan+alasan / eskalasi (FLOW-18, FR-ADM-001). Kasir tetap bekerja (BR-SYN-030).

#### 4.2.5 Audit offline tidak boleh hilang (BR-AUD-003)

Entri audit yang lahir offline (persetujuan PIN supervisor, override diskon, void, kas masuk/keluar, ekspor pending, laci) dikirim sebagai perintah **`AppendAudit` tersendiri** (tak bergantung) yang dibuat **dalam transaksi Dexie yang sama** dengan dokumen bisnisnya; entri memuat `related_command_id`. Alasan (`DIUSULKAN`, memilih salah satu dari dua opsi SCHEMA §2.4): bila audit tertanam di `FinalizeSale`, kegagalan struktural perintah itu menggulung audit-nya; BR-AUD-003 mewajibkan audit **tetap tercatat** walau perintah terkait masuk "perlu perhatian". Trade-off: satu perintah tambahan per tindakan teraudit (volume kecil, ≤ beberapa persen transaksi).

#### 4.2.6 Konfigurasi sisi server yang berpengaruh pada push

`lock_timeout` 5 dtk, `statement_timeout` 10 dtk per transaksi perintah, batas 50 perintah/1 MB per request (di atas batas client), `Content-Encoding: gzip` diterima; log satu baris per perintah (`commandId`, `commandType`, `schemaVersion`, `outcome`, `durationMs`; BR-LOG-009). Target `FinalizeSale` p95 ≤ **500 ms** (NFR-PERF-005).

### 4.3 Inbound — pull master, tombstone, snapshot

#### 4.3.1 Kontrak pull

`DISEPAKATI` (BR-SYN-010): cursor `(version, id)`; server mengembalikan baris `version > cursor` urut `(version, id)` **termasuk tombstone**, terfilter tenant + outlet device, berhalaman.

```
POST /api/pos/v1/pull
  { "cursor": {"version": 120, "id": "0192…"} | null,
    "cycle": null | {"id":"…","upper": 122},            // dilanjutkan pada halaman berikutnya
    "page_size": 500,
    "attention_ids": ["…"],                               // untuk command_updates
    "stock_etag": "…", "bill_etag": "…" }                 // untuk snapshot hemat bandwidth
200 { "server_time": ISO, "upper": 122, "tombstone_floor": 60,
      "rows": [ {"entity":"price_entry","op":"upsert","row":{…}} | {"entity":"sku","op":"delete","id":"…"} ... ≤ 500 ],
      "next_cursor": {"version": 121, "id": "…"}, "has_more": true,
      // hanya pada halaman terakhir siklus:
      "stock": { "etag","as_of_server_time","acked_device_seq","rows":[…] } | "unchanged",
      "bills": { "etag","rows":[…] } | "unchanged",
      "command_updates": [ {"id","status"} ], "release": {…}, "manifest": {"counts": {…}} }
200 { "full_resync_required": true, "reason": "CURSOR_BELOW_FLOOR" | "SCHEMA_INCOMPATIBLE" }
```

**Algoritma server (satu transaksi `REPEATABLE READ READ ONLY` per halaman — AD-07)**:

1. Halaman pertama siklus: baca `V = tenant_sync.version` **di dalam** transaksi itu → `upper = V`; halaman lanjutan menerima `upper` dari client dan memakai `version <= upper`.
2. Bila `cursor.version < tenant_sync.tombstone_floor_version` → `FULL_RESYNC_REQUIRED` (§4.3.4).
3. Ambil 500 **kunci** berikutnya lintas tabel kelas M berurut `(version, id)` — secara konseptual `UNION ALL` ringkas (SCHEMA §5.2.1), diwujudkan sebagai ***k-way merge*** hasil `FeedSource` tiap modul pemilik tabel di transaksi yang sama (§8.4, RK-10); satu cursor cukup karena UUIDv7 unik lintas tabel, terfilter outlet per tabel (`outlet_id = $outlet`, `OR outlet_id IS NULL` untuk `price_entry`/`tax_rate_history`/`user_outlet`; `register_id = device.register` untuk `register_invoice_prefix`; `device_id = $device` untuk `staff_pin`).
4. Hidrasi baris lengkap per entitas (`WHERE id = ANY($ids)`), **termasuk baris `deleted_at IS NOT NULL`** (dikirim sebagai `op: delete`).
5. Hitung `next_cursor` = `(version, id)` baris terakhir; `has_more` bila masih ada baris `≤ upper`.

**Mengapa urutan versi aman (tidak melewatkan baris)** — ringkasan alasan BR-SYN-011 dalam konteks implementasi ini:

| Pendekatan | Cacat | Penjelasan |
|---|---|---|
| Cursor `updated_at`/`now()` | `now()` = waktu **awal** transaksi, bukan commit: A (mulai 10:00:00, commit 10:00:05) dan B (mulai 10:00:02, commit 10:00:03); device menarik di 10:00:04, melihat B, cursor := 10:00:02; A tidak pernah terpilih | Melewatkan baris |
| Cursor `bigserial`/sequence | Nilai sequence diberikan saat *insert*, bukan commit: A=101, B=102; B commit lebih dulu; cursor := 102; A (101) commit kemudian → `101 > 102` salah | Melewatkan baris |
| **Counter `tenant_sync` + row lock** (dipakai) | Penulis master meng-`UPDATE tenant_sync` dan menahan lock sampai commit; penulis berikutnya menunggu → versi yang committed selalu **prefiks tanpa celah**; `V` yang dibaca di snapshot yang sama dengan baris menjamin semua versi `≤ V` sudah terlihat | Aman; biaya: penulis master per tenant diserialkan (RSK-13, transaksi master harus pendek, BR-SYN-012) |
| Filter per outlet (brief: "delta sync per outlet dengan `updated_at`/`version`") | Counter **per tenant**, bukan per outlet: cursor tetap satu; filter outlet hanya menyaring baris | Satu cursor per device; tidak ada counter per outlet (RK-03) |

Catatan: pull berjalan di `READ ONLY` + `REPEATABLE READ` sehingga `UNION ALL`, hidrasi, dan pembacaan `V` melihat **satu snapshot**; ini juga menjadi pagar bila kelak dipasang replika baca.

#### 4.3.2 Stage lalu terapkan atomik per siklus (AD-08)

`DIUSULKAN` — mewujudkan BR-CAT-014 ("layar jual baru diperbarui setelah seluruh halaman satu siklus pull diterapkan"), FR-SYN-017, EC-050, DESIGN §5.2 #32, dan tahan crash:

```
Puller:  halaman 1..k  ──► [Dexie tx kecil] pull_stage += halaman, meta.stage = {cycle_id, upper, stage_cursor, pages}
                                (crash di sini ⇒ boot berikutnya melanjutkan dari stage_cursor; baris tidak hilang — FR-SYN-002)
         has_more = false ──► Applier: SATU transaksi Dexie 'rw' pada store master + pull_stage + meta:
                                 untuk setiap halaman berurutan: upsert/hapus baris; hitung ulang field turunan
                                 (search_tokens, outlet_key, sku_key); meta.cursor = next_cursor akhir;
                                 meta.catalog_cursor = upper; hapus pull_stage
                              ──► commit ⇒ liveQuery memicu render; layar jual berganti SEKALI
```

- Tidak ada keadaan setengah-diterapkan yang terlihat (item baru tanpa baris ketersediaannya, EC-050).
- `meta.cursor` dimajukan **setelah** semuanya diterapkan; PRD FLOW-15 langkah 4 ("memajukan cursor setelah halaman tersimpan") dipenuhi pada tingkat *stage* (`stage_cursor` durable per halaman) — selisih mekanisme dicatat di **RK-07**.
- **Anggaran**: siklus inkremental tipikal kecil (puluhan baris). Siklus besar (impor 4.000 SKU = satu versi ≈ 16 ribu baris) tetap satu transaksi; transaksi `rw` pada store master menahan pembacaan store itu selama berlangsung → diterapkan saat **idle** (bukan di tengah input kasir) dan **diukur di F2** (`RSK-A04`). Ambang `DIUSULKAN`: > 60.000 baris → penerapan per tabel (jalur full resync, §4.3.4).
- Pembaruan **konfigurasi** yang memengaruhi perhitungan (mode harga, profil pajak, tarif SC, `cash_rounding_unit`) berlaku untuk transaksi **berikutnya** setelah apply (EC-025); transaksi yang sedang disusun memakai snapshot konfigurasi yang diambil saat keranjang dibuka (§5.1).

#### 4.3.3 Snapshot non-feed (stok, open bill) dan blok pendamping

| Blok | Sumber | Isi | Penyegaran |
|---|---|---|---|
| `stock` | `stock_balance` outlet device + **`acked_device_seq`** | Qty (string) per SKU; nilai hanya untuk role berizin; digantikan **penuh** tiap perubahan (`stock_etag`) | Tiap siklus online bila `etag` berubah. Server membaca saldo **dan** `max(device_seq)` perintah device itu yang `ACKED` **dalam snapshot yang sama**, sehingga estimasi lokal = `snapshot.qty − Σ penjualan lokal dengan device_seq > acked_device_seq` benar tanpa penghitungan ganda (BR-STK-005) |
| `bills` | `bill`+`bill_item` outlet bukan milik device ini (+ "bill masuk" ke register ini) | Open bill read-only + `last_event_at`, `is_awaiting_payment`, `handover_*` | Tiap siklus (F5); diganti utuh (FR-SYN-016) |
| `command_updates` | `idempotency_command`/`attention_item` | Status terkini perintah `NEEDS_ATTENTION` milik device | Tiap siklus bila ada |
| `release` | `app_release` | Versi terbaru, `min_accepted_schema_version`, `is_mandatory`, `accept_previous_until` | Tiap siklus + `GET /release` |
| `manifest` | server | Hitungan baris per entitas pada `upper` (verifikasi integritas §3.6) | Halaman terakhir siklus penuh |

#### 4.3.4 Full resync

`DISEPAKATI` (FLOW-15 langkah 6): cursor terlalu tua/tidak kompatibel → ambil ulang **seluruh master**, **outbox tidak disentuh**. **Batas (AD-40, §6.9.3): maks. 1 full resync per jam per device**; `/pull/full/start` yang kedua dalam sejam dijawab `429` + `Retry-After` dan klien tetap memakai katalog lama (device baru tanpa katalog tidak terkena karena permulaan pertamanya dihitung sekali; resync yang gagal di tengah **dilanjutkan** dari stage, bukan dihitung ulang).

1. `POST /pull/full/start` → server mencatat **`snapshot_version = tenant_sync.version`** (di transaksi `REPEATABLE READ`) dan membalas dengan `snapshot_version`, `tombstone_floor`, `manifest`.
2. Client menarik **seluruh baris hidup** (`deleted_at IS NULL`) per entitas dalam urutan tetap, keyset `id`, halaman 500 (tanpa filter versi). Setiap halaman di-**stage**; keluaran konsisten karena konvergensi: baris yang berubah selama proses diterima lagi pada tahap berikutnya.
3. Selesai → **satu transaksi**: kosongkan store **master** (bukan `meta`, transaksi, outbox, counter, `cart_draft`, `device_log`), isi dari stage, `meta.cursor = (snapshot_version, "0000…")`, `meta.catalog_cursor = snapshot_version`.
4. Lanjutkan **pull inkremental** dari `snapshot_version` (upsert idempoten sehingga tumpang tindih aman); logo struk diunduh bila `logo_sha256` berubah.
5. Pada **device yang sudah punya katalog**, layar jual tetap memakai katalog lama hingga langkah 3; pada device baru, progres bersegmen SCR-P01 ("Mengunduh data 3/8").

Pembersih tombstone (server, berkala per tenant): menaikkan `tombstone_floor_version` untuk versi yang tombstone-nya lebih tua dari **30 hari** (BR-SYN-010) dan menghapus fisik hanya baris yang tak dirujuk transaksi (SCHEMA §1.7). Device yang offline > 30 hari otomatis full resync — selaras lease 7 hari: device itu sudah terkunci dan harus online dulu (BR-AUT-008).

### 4.4 Deteksi konektivitas dan state machine

`navigator.onLine` **hanya petunjuk**: `false` = pasti tidak ada jaringan; `true` **tidak** berarti server terjangkau (captive portal, Wi-Fi tanpa internet, DNS mati, *lie-fi*).

**Probe**: `GET /api/pos/v1/ping` (≤ 200 byte JSON `{ "ok": true, "server_time": ms, "min_schema": N-1, … }`, `cache: 'no-store'`, `AbortSignal.timeout(4000)`). Dianggap sukses bila **HTTP 200 + JSON berbentuk benar + header `X-App-Version`** (menolak halaman login captive portal yang membalas 200 HTML). Jalur kritis kasir **tidak pernah** menunggu probe.

| Keadaan klien | Jadwal probe |
|---|---|
| `navigator.onLine=false` | Tanpa probe (OFFLINE); sanity probe tiap 60 dtk |
| `true` tetapi probe terakhir gagal | tiap 15 dtk → mundur eksponensial sampai 60 dtk |
| ONLINE | Probe implisit lewat setiap request sync (interval 60 dtk); probe eksplisit bila request gagal |
| Event `online`, fokus, `visibilitychange→visible` | Probe segera (dengan jitter 0–2 dtk) |

**Histeresis** (anti-kedip, DESIGN CMP-17: `syncing` hanya bila > 400 ms): ONLINE → OFFLINE setelah **2 kegagalan berturut-turut** atau 1 kegagalan + event `offline`; OFFLINE → ONLINE setelah **1** probe sukses. Bila ≥ 3 perubahan keadaan dalam 2 menit → status `UNSTABLE`: batch push 5 perintah, `timeout` dinaikkan (push 25 dtk, pull 30 dtk), indikator tidak berkedip (tetap `offline` sampai stabil 60 dtk).

**`429` bukan kegagalan konektivitas:** respons `429` (+ `Retry-After`) membuktikan server **terjangkau**; ia tidak dihitung dalam "2 kegagalan berturut-turut" histeresis, tidak membuat OFFLINE, dan penjadwal hanya menunda siklus berikutnya sampai `Retry-After` lewat (§4.2.4, §6.9.7).

**Putus-nyambung di tengah request**: respons hilang setelah server commit → pengiriman ulang idempoten mengembalikan hasil lama (EC-004); pull yang terputus melanjutkan dari `stage_cursor`; push yang terputus di tengah batch → perintah tanpa hasil tetap `PENDING`/`SENDING→PENDING` (status `SENDING` yang tertinggal saat boot dikembalikan ke `PENDING`).

```
                         ┌───────────────────────────────────────────────────────────────────────────┐
                         │                       (orthogonal: LEASE · UPDATE · CLOCK · ATTENTION)     │
  BOOT ──(boot §3.1)──► OFFLINE ◄──────────── 2× gagal / event offline ─────────────┐                  │
                         │  ▲                                                        │                  │
          probe sukses   │  │ siklus gagal transien (tetap pending)                  │                  │
           / event online▼  │                                                        │                  │
                       PROBING ──probe sukses──► ONLINE_IDLE ──kick/interval/sinyal──► SYNCING ─────────┘
                                                   ▲   │                                │
                                                   │   └──── siklus selesai ◄───────────┘
                                                   │         (sukses ⇒ last_success_sync_at diperbarui)
  Overlay keadaan antrean:   queue = CLEAN | PENDING(n, umur) | ATTENTION(m)
  Overlay perangkat:         device = OK | LEASE_WARNING | LOCKED (lease/jam mundur/dicabut)
  Overlay rilis:             update = NONE | AVAILABLE | PENDING_APPLY | REQUIRED
  Catatan 429:               SYNCING ──429 + Retry-After──► ONLINE_IDLE (tunda sampai Retry-After; attempts tetap;
                             TIDAK ke OFFLINE, TIDAK NEEDS_ATTENTION; §4.2.4, §6.9.7)
```

Pemetaan ke status UI DESIGN §2.1.5/CMP-17 (prioritas indikator ringkas, tertinggi di atas): `device_locked` (layar penuh SCR-P15) > `sync_error`/`needs_attention` (m > 0) > `syncing` (SYNCING > 400 ms) > `offline` (OFFLINE/UNSTABLE) > `online`/`synced` (ONLINE_IDLE, tampil jam sync terakhir). Lencana `pending` (angka + umur) **aditif** dan permanen selama ada perintah non-`ACKED` (BR-SYN-051); banner tumpuk maks. 2 sesuai urutan CMP-17B. Indikator = fungsi murni `deriveSyncIndicator(SyncState)` yang diuji tabel (DESIGN tidak dibebani logika).

**Definisi "sync sukses"** (menggeser `last_success_sync_at`, dasar lease 7 hari; BR-AUT-008): siklus yang (a) menyelesaikan push **tanpa kegagalan transien** (perintah `ATTENTION` bukan kegagalan transien; `RETRY/HELD/timeout` adalah), **dan** (b) menyelesaikan pull + penerapan. Nilainya = `server_time` dari respons (bukan jam device), bersama jangkar waktu monotonik (§4.5).

### 4.5 Clock offset dan waktu terkoreksi

`DISEPAKATI`: jam device tidak dipercaya; device mencatat waktu lokal + clock offset; `business_date = f(device_now + offset)` (BR-TIM-005, BR-AUT-013, AP-08).

| Aspek | Keputusan |
|---|---|
| Sampel offset | Tiap respons API membawa `server_time` (ms, di badan JSON; header `Date` hanya resolusi 1 dtk). `offset = server_time − (t_kirim + rtt/2)` dengan `t` dari `Date.now()` dan `rtt` dari `performance.now()` (algoritma Cristian) |
| Pemilihan | Simpan **lima sampel terakhir**, pakai sampel ber-**RTT terkecil**; abaikan sampel ber-RTT > 5 dtk |
| Penyimpanan | `meta.clock = { offset_ms, measured_at_device, rtt_ms, server_time_at_measure, max_seen_time }` |
| `device_now_corrected` | `Date.now() + offset_ms`; **dalam satu sesi halaman** diperkuat dengan pasangan `performance.now()` terhadap jangkar sehingga lompatan jam di tengah sesi terdeteksi (selisih `Date` vs monotonik > 5 dtk ⇒ log `CLOCK_ANOMALY`, pakai monotonik) |
| `max_seen_time` | Diperbarui (≥ tiap 30 dtk aktif dan tiap finalisasi) ke waktu terkoreksi tertinggi yang pernah teramati; jam terkoreksi `< max_seen_time − 5 mnt` ⇒ **dikunci sampai sync** (BR-AUT-013, BR-TIM-006) |
| Peringatan | `\|offset\| > 10 mnt` ⇒ banner `warning` + dilaporkan ke `device_sync_status` (BR-TIM-006) |
| Dipakai untuk | `occurred_at`, `business_date`, `invoice_period`, lease 7 hari, `locked_until` PIN, `last_success_sync_at`. **Tidak** dipakai untuk menolak/menyusun urutan di server (hanya label; BR-CAT-013) |
| Sebelum sync pertama | Device baru: offset diukur saat enrollment (SCR-P01) |

*Contoh (BR-TIM-005):* jam device cepat 7 menit ⇒ `offset = −7 mnt`; device menampilkan 02:30 saat sebenarnya 02:23; `business_date` dihitung dari 02:23 ⇒ tetap 2026-11-17 (outlet jam potong 04:00).

### 4.6 Realtime: sinyal "ada perubahan, silakan pull"

`DISEPAKATI` (BR-SYN-041, FR-SYN-009): realtime hanya **sinyal**; data tetap lewat pull; kehilangan sinyal tidak kehilangan data (interval 60 dtk tetap).

| Aspek | Keputusan | Alasan / trade-off |
|---|---|---|
| Transport | **SSE** (`GET /api/pos/v1/signals`, `text/event-stream`) dibaca dengan **`fetch` + `ReadableStream`** (bukan `EventSource`) | `EventSource` tidak dapat menyetel header `Authorization`; menaruh token di URL membocorkan ke log proxy (dilarang BR-LOG-007). WebSocket **ditolak**: dua arah tidak diperlukan, lebih rewel di balik proxy/HTTP2, state koneksi lebih banyak. |
| Pesan | `{"t":"pull","v":<version>}` (master berubah), `{"t":"release"}` (rilis baru/wajib), `{"t":"bills"}` (F5, open bill outlet berubah). Komentar `: ping` tiap 25 dtk | Minimal; tanpa data bisnis → tak ada kebocoran bila disadap |
| Penerbit | Fungsi Sync `bumpAndNotify` mengirim sinyal **setelah commit** transaksi master (hook pasca-commit), digabung per tenant 500 ms (*coalescing*); `AcceptBill`/`HandOverBill` menerbitkan `bills` | Tidak pernah di dalam transaksi |
| Klien | **Satu aliran aktif per device** (server membatasi: koneksi baru dari `device_id` yang sama **menggantikan** yang lama; AD-40); reconnect `1 → 30 dtk` + jitter (menghormati `Retry-After` bila `429`); tak ada pesan/ping > 90 dtk ⇒ sambung ulang; sinyal ⇒ `Scheduler.kick('signal')` | Sinyal tidak mengubah semantik probe/histeresis |
| Proxy | Rute SSE tanpa buffering (`proxy_buffering off` dan `proxy_read_timeout` panjang pada Nginx), timeout idle panjang | `VERIFIKASI` saat F1 |
| Skala | Satu instance app: registri koneksi di memori (≈ jumlah device aktif); untuk >1 instance kelak: `LISTEN/NOTIFY` PostgreSQL sebagai bus (`OQ-A17`) | AS-06 |

### 4.7 UpdateManager (PWA) di dalam mesin sinkron

State: `NONE → AVAILABLE(soft|hard) → PENDING_APPLY → APPLYING`. Masukan: event SW (`waiting`), blok `release` dari pull/`GET /release` (versi terbaru, `min_accepted_schema_version`, `accept_previous_until`, `is_mandatory`), `meta.update` (`next_prompt_at`, `dismissed_at`), kondisi kerja (`checkout_in_progress`, `payment_in_progress`, `cart_active`, `shift_open`, `outbox_pending`). Aturan (BR-SYN-003 + keputusan user 2026-11-18, §9.6.4): **pembaruan lunak** = banner non-blokir di semua halaman + dialog "Muat ulang?" yang **ditunda** selama checkout/pembayaran, "Nanti" menjadwalkan dialog 2 jam kemudian (`next_prompt_at` dipersist agar selamat dari reload); **pembaruan keras** (rilis wajib, atau batas jendela dukungan 30 hari terlewati) ⇒ tanpa "Nanti", diterapkan otomatis **hanya di momen aman**: `!checkout && !payment && !cart_active && !shift_open && !outbox_pending` — **tidak pernah** di tengah shift atau saat ada antrean sync; shift terbuka boleh dilanjutkan/ditutup, **shift baru diblokir**; device usang (versi lewat toleransi, `426`) menahan perintah (kelas `SCHEMA`) dan memblokir shift baru. Tidak ada banner "versi berbeda" ala `VersionBanner` referensi; versi hanya di footer login dan pengaturan perangkat. Banner tambahan "server sedang diperbarui" muncul bila klien lebih baru daripada server (§3.2 butir 6). Semua transisi dicatat ke `device_log` (`UPDATE_ACCEPTED/REJECTED`, BR-LOG-010).

### 4.8 Diagram urutan

**Push (satu siklus, jalur normal dan transien):**

```
Kasir/Domain     Dexie                 SyncEngine(Pusher)            Server (/push)                PostgreSQL
    │ Selesai ───► tx: sale+outbox ─┐         │                           │                            │
    │ ◄ sukses ─────────────────────┘         │                           │                            │
    │ finalized ────────────────────────────► kick ─ probe ───────────────► /ping 200                    │
    │                                         │ ambil PENDING terurut(device_seq), lewati depends_on     │
    │                                         │ ──── POST /push {commands[≤20]} ───────────────────────► │
    │                                         │                            auth·skema·Zod                 │
    │                                         │                            tx(per perintah) ────────────► INSERT idempotency_command
    │                                         │                                                          │ INSERT sale…, UPDATE stock_balance FOR UPDATE…
    │                                         │                            ◄──────────── COMMIT ◄────────┘
    │                                         │ ◄── 200 results[ACK{no_final,flag,HPP}] ──┘
    │          ◄── tx: outbox ACKED, sale.synced_at, server_result ──┘
    │                                         │
    │   (jika respons hilang)  ──► kirim ulang id yang sama ──► REPLAY hasil lama ──► ACK (tanpa efek ganda)
    │   (jika 503/timeout)     ──► PENDING, backoff 5s/15s/1m/5m ±20% ──► coba lagi
```

**Pull (siklus penuh dengan stage dan apply atomik):**

```
SyncEngine(Puller)                         Server (/pull)                          Dexie
   │ cursor=(120,id) ───────────────────────► RR-RO tx: V=tenant_sync.version (122) ; UNION ALL feed ≤500
   │ ◄── rows(+tombstone), upper=122, has_more ──┘
   │ ───────────────────────────────────────────────────────────────────────────► tx: pull_stage += halaman
   │ halaman berikut (cycle.upper=122) … has_more=false (+stock,+bills,+command_updates,+release)
   │ ───────────────────────────────────────────────────────────────────────────► SATU tx: apply semua halaman →
   │                                                                                master; meta.cursor/catalog_cursor
   │ ◄──────────────────────────────────────────────────────────────────────────── commit ⇒ liveQuery ⇒ UI baru
   │ last_success_sync_at := server_time (bila push juga bersih)
```

### 4.9 Siklus hidup satu transaksi penjualan (dari checkout sampai diterima server)

| # | Tahap | Di mana | Status | Jika gagal |
|---|---|---|---|---|
| 1 | Keranjang disusun (`cart_draft`), konfigurasi disalin sebagai snapshot saat keranjang dibuka | Dexie `cart_draft` (lokal saja) | `ACTIVE` | Crash/kunci layar: draf utuh (BR-AUT-015) |
| 2 | "Selesai": kernel menghitung, transaksi Dexie tunggal (§3.3) | Dexie | `sale` `PENDING`, `outbox` `PENDING`, `print_job` `QUEUED`, counter +1 | Rollback penuh; nomor tak terpakai; keranjang tetap |
| 3 | UI sukses; cetak asinkron; laci dibuka | UI / PrintQueue | `print_job` `PRINTING→DONE/FAILED` | `FAILED` ⇒ chip + **Cetak ulang**; penjualan tak terpengaruh (AP-10) |
| 4 | `kick` sync; probe; push | SyncEngine | `outbox` `SENDING` | Offline ⇒ tetap `PENDING`; banner pending (BR-SYN-051) |
| 5 | Server: auth → skema → Zod → idempotensi → **satu transaksi**: `sale`, `sale_line`, `sale_payment`, `invoice_series`/`invoice_gap`, `stock_movement`+`stock_balance` (HPP, resep bila F&B), `data_flag`, `bill`→`PAID`, ikat ke shift, `audit` | PostgreSQL | `idempotency_command` `ACKED` | Transien ⇒ `RETRY`; struktural/otorisasi ⇒ `ATTENTION` (rollback penuh) |
| 6 | Respons `ACK` (nomor final bila `-Dn`, flag, `cost_snapshot`, `received_at`) | Jaringan | — | Respons hilang ⇒ kirim ulang ⇒ replay hasil lama |
| 7 | Client menyimpan hasil | Dexie | `outbox` `ACKED`, `sale.sync_status='ACKED'`, `synced_at`, `server_result` | — |
| 8 | Pull berikutnya membawa **snapshot stok** baru (efek penjualan terlihat di estimasi) | Dexie `stock_snapshot` | — | — |
| 9 | Pembersihan: payload outbox 7 hari, dokumen setelah 3 bulan kalender | Dexie | dipangkas | `PENDING` tak pernah dipangkas |

### 4.10 Indikator sinkron di UI (selaras DESIGN)

| Sumber state | Tampilan (DESIGN) | Rujukan |
|---|---|---|
| ONLINE_IDLE + queue CLEAN | `synced` ("Tersinkron 14.05" di SCR-P14/tooltip) | CMP-17 A |
| SYNCING > 400 ms | `syncing` ("Menyinkronkan…") | FLOW-14/15 |
| OFFLINE / UNSTABLE | `offline` (amber) + banner "Offline. Penjualan tetap tersimpan…" | G-01 |
| queue PENDING(n) | lencana `pending` + banner "Ada N transaksi belum terkirim sejak X jam" + **Ekspor/Lihat** (permanen) | BR-SYN-051/052 |
| queue ATTENTION(m) | `sync_error`/`needs_attention` (danger) + daftar di SCR-P14 dengan `KODE#id` | BR-SYN-030 |
| device LEASE_WARNING / LOCKED | banner `lease_warning` / SCR-P15 `device_locked` | BR-AUT-008 |
| update AVAILABLE / REQUIRED | `update_available` / `update_required` | BR-SYN-003 |
| selisih jam > 10 mnt | banner "Jam perangkat berbeda lebih dari 10 menit dari server" | BR-TIM-006 |

Umur pending ("sejak X jam") dihitung dari `created_at` perintah non-`ACKED` tertua (waktu terkoreksi). Interval pembaruan UI ≤ 1 menit; teks memakai jamak i18n (BR-I18N-009).

---

## 5. Resolusi Konflik dan Edge Cases (arsitektural)

Bab ini **tidak** mengulang kebijakan PRD (Bab 9, EC-001…063); ia menetapkan **mekanisme teknis** yang membuat kebijakan itu benar secara konstruksi. Prinsip pengikat: **tidak ada penggabungan dua arah**; setiap konflik diselesaikan dengan salah satu dari lima pola — (P1) *tidak mungkin terjadi* (kepemilikan tunggal), (P2) *serialisasi di server* (lock + urutan commit), (P3) *penerimaan sebagai fakta + flag* (AP-02), (P4) *idempotensi/replay*, (P5) *antrean keputusan manusia* ("perlu perhatian").

### 5.1 Data master read-only di device dan perubahan versi di tengah transaksi

| Hal | Mekanisme | Rujukan |
|---|---|---|
| Master tidak pernah ditulis dari device | Tidak ada jalur tulis ke store master selain **Applier** (satu modul, satu pintu); `pos/data/*.repo.ts` untuk master hanya mengekspor fungsi baca; ESLint melarang `db.<master>.put/add/delete` di luar `pos/sync/applier` | BR-SYN-001, AP-04 |
| **Tidak ada konflik merge** | Tidak ada pembanding `version` di client; `version` hanya posisi feed; admin concurrent diserialkan oleh `tenant_sync` (EC-049: versi 131 lalu 132, keduanya teraudit) | SCHEMA §2.1 |
| Perubahan master tiba **saat keranjang terbuka** | Penerapan pull dijalankan **saat idle** dan atomik (§4.3.2). Keranjang membawa **snapshot penuh per baris** (kode SKU, nama, kode UOM, faktor, harga satuan, `taxable`, `is_open_price`, modifier) yang diambil saat baris ditambah — finalisasi **tidak** membaca ulang master selain untuk id, sehingga apply di tengah keranjang tidak dapat merusaknya (AP-07, BR-PRC-003) | EC-001, EC-002 |
| Konfigurasi penghitung (mode harga, profil pajak, tarif SC, unit pembulatan) | Keranjang membawa **`ConfigSnapshot`** (pengaturan outlet + baris `tax_rate_history` relevan + prefiks register berperiode) yang diambil saat keranjang **dibuat**; finalisasi menghitung dengan snapshot itu dan **menyalinnya** ke `sale` (kolom snapshot SCHEMA §4.5.3-c). Perubahan konfigurasi yang tiba kemudian berlaku untuk **keranjang berikutnya** | EC-025, EC-005 |
| `business_date` & tarif | `business_date` dan pemilihan tarif/prefiks dilakukan **saat finalisasi** dari `ConfigSnapshot` + waktu terkoreksi (BR-TIM-004) — keranjang yang melintasi jam potong mendapat tanggal saat bayar | BR-TIM-004 |
| Item di keranjang menjadi **tidak tersedia/nonaktif/tombstone** setelah apply | Baris keranjang tetap valid (snapshot sendiri); UI menampilkan toast info (DESIGN §5.2 #32); penjualan tetap dibayar (fakta). `catalog_cursor` yang tersimpan = cursor **saat finalisasi** (BR-CAT-013, FR-POS-014); bila device sudah menerima perubahan sebelum finalisasi, server tidak memberi flag `ITEM_TIDAK_TERSEDIA` (device sudah tahu) — selaras PRD (flag hanya untuk penjualan sebelum perubahan sampai ke device) | BR-CAT-013/020 |
| Harga berubah saat offline | Harga di keranjang = fakta; server menandai `HARGA_STALE` dengan selisih (BR-PRC-003) | EC-002 |
| Konfigurasi wajib hilang (mis. tarif pajak tak dapat ditentukan, prefiks register belum ada) | Fungsi `canSell()` (domain) mengembalikan alasan terstruktur; tombol Bayar nonaktif + alasan terlihat; tidak pernah menebak nilai | SCHEMA §4.1.4, FR-POS-007 |
| Staf dinonaktifkan/role berubah saat sesi berjalan | `SessionGuard` mengevaluasi ulang setelah tiap apply: perubahan permission berlaku pada operasi berikutnya; staf **tidak lagi ada/aktif** ⇒ sesi dikunci pada titik aman berikut (bukan di tengah pembayaran); PIN-nya tak lagi diterima | EC-012, EC-036, BR-AUT-010 |

### 5.2 Stok minus, pengurangan optimistik, dan rekonsiliasi

**Di device — tidak ada pengurangan stok yang bersifat otoritatif.** Device hanya menampilkan **estimasi** = `snapshot.qty − Σ qty_base penjualan lokal dengan device_seq > acked_device_seq` (§4.3.3). Estimasi ≤ 0 ⇒ peringatan non-blokir (`stock_estimate_low`, FR-POS-011); penjualan tetap lolos (AP-02). Tidak ada tulis ke `stock_snapshot` oleh transaksi penjualan (snapshot hanya diganti dari server) sehingga tidak ada "stok lokal" yang dapat menyimpang secara permanen.

**Di server — urutan dan kunci (AD-22, ringkasan kontrak SCHEMA §5.4.3):**

```
FinalizeSale (satu transaksi):
 1  idempotency_command            INSERT … ON CONFLICT                     ─┐ urutan kunci TETAP
 2  bill (F&B)                     SELECT … FOR UPDATE                        │ (mencegah siklus tunggu / deadlock)
 3  invoice_series (register)      SELECT … FOR UPDATE  (+gap/konflik §5.5)   │
 4  stock_balance  kumpulan (outlet,sku) dari item + resep + modifier,         │
                   DIURUTKAN (outlet_id, sku_id) ASC → INSERT … ON CONFLICT   │
                   DO NOTHING (baris malas) lalu SELECT … FOR UPDATE ORDER BY  │
 5  tulis sale, sale_line*, sale_payment*, stock_movement*, data_flag*       │
 6  audit_chain_head               FOR UPDATE — TERAKHIR (lock tersingkat)    │
 7  COMMIT                                                                  ─┘
```

- **Penerapan ledger** memakai fungsi murni `costing` di modul Inventori: input saldo `(qty, inventory_value, ref_value, ref_qty, rev)` + `qty_out` → `(HPP, saldo baru, cost_basis, is_negative_result)`; baris berurutan menurut `line_no`, bahan berurutan menurut `sku_id` (deterministik, BR-RCP-003). Tiap movement mendapat `bal_seq = rev + 1` (urutan pemrosesan otoritatif per `(outlet, SKU)`; `UQ (outlet_id, sku_id, bal_seq)`).
- **Stok tidak cukup tidak pernah gagal**: bagian tertutup stok memakai rumus rata-rata (habiskan nilai bila `q_out = qty`), kekurangan dihargai biaya referensi (`ref_value/ref_qty`), saldo menjadi negatif; movement ditandai `cost_basis='MIXED'|'REFERENCE'`, `is_negative_result=true`, dan **`data_flag STOK_MINUS`** (BR-STK-002, BR-HPP-005).
- **Penandaan selisih**: `data_flag` (`HARGA_STALE`, `ITEM_NONAKTIF`, `ITEM_TIDAK_TERSEDIA`, `TARIF_BERBEDA`, `SELISIH_HITUNG`, `NOMOR_KONFLIK`, `STOK_MINUS`, `TANPA_RESEP`, …), unik per `(entitas, flag)` sehingga **replay tidak menggandakan flag**.
- **Rekonsiliasi**: opname (online, `/admin`) memakai delta terhadap `snapshot_qty` (BR-STK-031) sehingga penjualan yang tiba kemudian tidak hilang; posting opname dalam satu transaksi yang mengunci baris saldo dengan urutan yang sama, membuat movement `ADJUSTMENT`, dan **me-resolve** `STOK_MINUS` otomatis bila `qty_after ≥ 0`.
- **Kontensi**: SKU populer menjadi titik serial per `(outlet, SKU)`; waktu tahan lock = satu transaksi pendek (target p95 ≤ 500 ms untuk perintah penuh, NFR-PERF-005). `lock_timeout` 5 dtk ⇒ `RETRY` (bukan gagal). Beban ≤ 500 transaksi/hari/outlet membuat kontensi dapat diabaikan; uji paralel F4 (FR-INV-002).

### 5.3 HPP: tidak ada di device; kalkulasi otoritatif server

`DISEPAKATI` (BR-HPP-001/004, KEP-08): **device tidak menghitung HPP**. Keputusan arsitektur:

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Adakah "HPP sementara" di device? | **Tidak.** Device tidak menyimpan biaya rata-rata. `stock_snapshot.inventory_value` (opsional, hanya role berizin) murni informasi tampilan, **tidak dipakai dalam perhitungan apa pun** | Biaya bergantung pada urutan proses server; angka device selalu salah pada kasus GR di antara waktu jual dan waktu proses (BR-HPP-004, contoh +Rp2.083) |
| Kapan HPP ditetapkan? | Saat server memproses `FinalizeSale` (**biaya rata-rata saat itu**, bukan saat dijual, bukan backdate); disimpan di `sale_line.cost_snapshot` dan `stock_movement.value_delta` | BR-HPP-004 |
| Bagaimana device mengetahuinya? | Lewat `result` ACK (`cost_snapshot` per baris) disimpan di `server_result` — informasi, tidak mengubah total transaksi | SCHEMA §6.2 |
| Retur/void | Masuk/balik pada **biaya snapshot** penjualan asal (`cost_basis='SNAPSHOT'`; retur terakhir mengambil sisa) | BR-HPP-007, BR-RTR-008 |
| Resep + modifier | `HPP_baris = Σ bahan R(nilai × qty_konsumsi / qty_saldo)`, per bahan sebagai movement `RECIPE_CONSUMPTION` di transaksi yang sama | BR-RCP-003/005 |
| Urutan pemrosesan ledger | Per `(outlet, SKU)` oleh `bal_seq` di bawah row lock; antar-perintah oleh urutan commit; `occurred_at` (label) dan `processed_at` (acuan) keduanya tersimpan | BR-STK-006 |
| Penyelesaian saat saldo **berubah di antara** | Tidak ada koreksi mundur; GR berikutnya menutup kekurangan dengan biaya lama (BR-HPP-005) | RSK-08 (diterima) |

### 5.4 Idempotensi dan replay (sifat yang dijamin dan diuji)

| Invarian | Mekanisme | Uji |
|---|---|---|
| **I1** Kunci sama + payload sama ⇒ hasil sama, **nol efek tambahan** | `idempotency_command` PK `command_id`; replay mengembalikan `result` tersimpan | Test properti: kirim ulang N kali ⇒ 1 `sale`, 1 set `stock_movement`, 1 `audit_log` |
| **I2** Kunci sama + payload beda ⇒ **struktural** | `payload_hash` SHA-256 payload kanonik (kunci diurutkan) | Uji unit + integrasi |
| **I3** Movement unik per sumber | `UQ (tenant_id, source_type, source_id, sku_id, movement_type)` | Replay yang melewati cek idempotensi tetap tidak menggandakan |
| **I4** Event bill unik & berurutan | `INSERT … ON CONFLICT (id) DO NOTHING`; `UQ (bill_id, bill_seq)`, `UQ (device_id, device_seq)`; event bernomor melompat **ditahan** (`HELD`) sampai lengkap | Acak urutan kedatangan ⇒ proyeksi `bill` sama (FR-SYN-005) |
| **I5** Flag unik | `UQ (tenant_id, entity_type, entity_id, flag_code)` | Replay tidak menggandakan |
| **I6** Konvergensi | Himpunan perintah independen menghasilkan state akhir **identik** untuk urutan/duplikasi/putus-nyambung acak, **kecuali** nilai yang bergantung urutan commit yang memang disengaja (HPP, `bal_seq`, `-Dn`) — keluaran yang bergantung-urutan diperiksa dengan *invarian* (Σ nilai = saldo), bukan kesamaan nilai | NFR-REL-002; test properti + Playwright "urutan acak" (FR-QA-001/002) |

### 5.5 Penomoran invoice offline (alokasi register, gap, pemulihan, `-Dn`)

`DISEPAKATI` (BR-INV-001…011, SCHEMA §4.5.8–4.5.10): seri **per register**, `{PREFIKS}-{MMYY}-{URUT6}`, tanpa celah, dihitung lokal.

**Alokasi (client)**: counter `local_counter["{register}|INVOICE|{MMYY}"]` dinaikkan di transaksi finalisasi (§3.3); periode baru ⇒ baris counter baru mulai dari `1` (reset bulanan). Nilai awal counter: **enrollment** device baru mengembalikan `counters = { INVOICE: {period, next_seq}, CREDIT_NOTE: {…} }` dari `invoice_series.max_seq_received + 1` atau `register_recovery.next_seq` (register baru: tidak ada baris ⇒ 1). Seri nota kredit **terpisah** (`CREDIT_NOTE`, `…-NK-…`).

**Pencatatan di server** (`recordSeries`, di dalam transaksi pemrosesan, setelah mengunci baris `invoice_series`):

```
lock invoice_series(register, doc_type, period)  -- buat bila belum ada (max=0, count=0)
s = seq dari perintah
if s == max+1 : max = s ; count++                                              # normal
elif s > max+1: buat invoice_gap [max+1 .. s-1] origin=DETECTED ; max = s ; count++   # lompatan ⇒ gap OPEN
else  (s ≤ max):
     if sudah ada dokumen dengan (register, period, s, conflict_idx=0) milik command LAIN:
           idx = conflict_idx berikutnya ; invoice_no ← "…-D{idx}" ; flag NOMOR_KONFLIK ;
           attention_item (diterima + butuh perhatian) ; (count tidak bertambah)         # BR-INV-009
     else: nomor ini mengisi lubang gap → pecah/kecilkan gap yang menutupinya; bila kosong ⇒ status FILLED ; count++
invarian: max − count = Σ panjang gap berstatus OPEN/EXPLAINED   (verifikasi ringan setelah tiap pemrosesan)
```

- **`-Dn`**: penjualan tetap **diterima sebagai fakta** (AP-02) dan memperoleh `invoice_conflict_idx ≥ 1`; `UQ (register_id, invoice_period, invoice_seq, invoice_conflict_idx)` dan `UQ (tenant_id, invoice_no)` tetap utuh. Idempotensi lebih dulu daripada deteksi konflik (kunci sama ≠ konflik). Status perintah tetap `ACKED`; `attention_item` berkelas `STRUCTURAL`/kode `SERIES_CONFLICT` berstatus `OPEN` untuk keputusan manager — **klarifikasi atas SCHEMA §4.6.2/4.6.3** yang tidak memiliki status "diterima-dengan-perhatian" (RK-09, `DIUSULKAN`).
- **Pemulihan register** (FLOW-16, BR-INV-008): server function `recoverRegister(registerId, declaredLastSeq?)` di modul **Penjualan** (memanggil Identitas lewat antarmuka publik; arah dependensi BR-ARC-004 terpenuhi): (1) cabut device lama; (2) ambil `highest_received_seq`; (3) bila `declaredLastSeq` diisi buat `invoice_gap` `RECOVERY_DECLARED`; (4) tulis `register_recovery.next_seq = COALESCE(declared, highest)+1`; (5) terbitkan kode pairing baru; (6) audit. Device baru menerima `counters` saat enroll.
- **Device lama kembali** dengan antrean pending: ditolak otorisasi (dicabut) ⇒ "perlu perhatian"; manager "terima manual" memproses payload yang sama lewat jalur manual (§5.9) ⇒ nomor bentrok ⇒ `-Dn`; atau impor berkas ekspor (EC-034, EC-011).
- **Jam salah di batas bulan**: nomor tetap unik/tanpa celah dalam **seri yang dipakainya**; hanya `MMYY` yang dapat keliru (diterima, BR-INV-003). Server **tidak** mengubah nomor.
- **Perubahan prefiks**: dipilih menurut `business_date` dari baris `register_invoice_prefix` berperiode yang diunduh device; server memverifikasi komposisi `invoice_no` terhadap `(invoice_prefix, invoice_period, invoice_seq)` dan **menandai** (bukan menolak) bila tak cocok.
- **Void tidak menghapus nomor**; **keranjang batal tidak mengonsumsi nomor** (nomor dialokasikan hanya di transaksi finalisasi, BR-INV-004).
- **Risiko residual** yang diterima (RSK-02): storage dibersihkan/device hilang sebelum sync ⇒ nomor bolong yang hanya dapat dicatat bila manager mengisi "nomor struk fisik terakhir".

### 5.6 Open bill: lease, serah-terima (hanya online), dan event

| Hal | Mekanisme |
|---|---|
| **Kepemilikan tunggal (P1)** | Bill dimiliki satu device (`lease_device_id` + `lease_register_id`); event dari device **bukan pemegang saat ini** atau dari pemegang saat `handover_status='PENDING'` ⇒ `ATTENTION (AUTHORIZATION)` (kecuali `BILL_HANDOVER_CANCELED` oleh pengirim). Lease hanya berubah di fungsi `acceptBill` (trigger + hak kolom, SCHEMA §5.4.2) — tidak ada take-over/tutup paksa (BR-FNB-004) |
| **Serah-terima bukan outbox** | `HandOverBill/AcceptBill/CancelBillHandover` = permintaan HTTP sinkron (`/bill/handover`, `/bill/accept`, `/bill/handover/cancel`); tombol dinonaktifkan offline dengan alasan (BR-FNB-012 butir 4, EC-058) |
| **Pra-syarat "event bersih"** | Dicek **dua kali**: client (tak ada `outbox_command` non-`ACKED` untuk `bill:{id}`) dan **server** (client menyertakan `known_last_event_seq`; server menolak `EVENTS_PENDING` bila `bill.last_event_seq` ≠ klaim — melindungi dari status client yang basi). EC-059 |
| **Serialisasi accept vs cancel vs bayar** | Ketiganya `SELECT … FOR UPDATE` pada baris `bill` (kunci urutan #2): yang commit lebih dulu menang; yang kalah ditolak `409 HANDOVER_NOT_PENDING` dengan pesan jelas (EC-061) |
| **Event serah-terima** | `bill_seq = bill.last_event_seq + 1` ditetapkan **server** dalam transaksi yang sama (OQ-S21); `device_seq` event memakai penghitung device pemanggil |
| **Peralihan data setelah accept** | Respons `AcceptBill` memuat bill lengkap (header, `bill_item`, `last_event_seq`) ⇒ device penerima menyimpannya sebagai bill **miliknya** (↑ lokal) dan melanjutkan `bill_seq` dari `last_event_seq`; salinan pengirim berubah read-only dan pada pull berikutnya menjadi `bill_snapshot` |
| **Hasil tak diketahui** (koneksi putus saat memanggil) | Pengirim memegang status lokal "menunggu — memeriksa" (**read-only**, aman) sampai `GET /bill/{id}/state` atau pull memastikan: masih `PENDING` ⇒ boleh dibatalkan; sudah diterima ⇒ beralih ke snapshot. Tidak ada jendela di mana dua device dapat mengedit |
| **Pembayaran bill** | `FinalizeSale` ber-`bill_id` divalidasi server: register pembayar = `lease_register_id`, berjenis `CASHIER`, `handover_status='NONE'`, shift terbuka (SCHEMA §4.5.3-b); pelanggaran ⇒ `ATTENTION` |
| **Bill ganda per meja / yatim** | Diterima + flag `BILL_GANDA_MEJA`; yatim = view `v_orphan_bill` (laporan), tanpa pemulihan (BR-FNB-004, EC-015) |
| **Event tiba acak / celah `bill_seq`** | Ditahan (`HELD`) sampai lengkap; dependensi per `bill:{id}` (§4.2.3) |

### 5.7 Device dicabut, lease habis, jam salah

| Situasi | Deteksi | Perilaku | Pemulihan |
|---|---|---|---|
| **Device dicabut** | Kontak server berikutnya: `403 DEVICE_REVOKED` | SCR-P15 "Perangkat dicabut"; login ditolak; perintah pending ⇒ `NEEDS_ATTENTION (AUTHORIZATION)`, **tidak dibuang**; ekspor tersedia | Manager: terima manual / impor ekspor (§5.9); device baru di-enroll (FLOW-16). Pencabutan tidak berlaku offline (BR-AUT-010) selain batas lease |
| **Staf dicabut/dinonaktifkan** | Pull (`app_user.is_active=false`/`user_outlet` tombstone) | Hilang dari layar pilih staf; sesi berjalan dikunci pada titik aman; perintah lama staf itu tetap diterima (fakta) | — |
| **Lease 7 hari habis** | `trusted_now − last_success_sync_at > 7 hari` (§6.4) di boot dan tiap menit aktif | SCR-P15 terkunci; tidak ada login/transaksi baru; **ekspor pending tetap ada**; peringatan 24 jam sebelum (`lease_warning`) | Sync sukses ⇒ buka kunci; kerja dilanjutkan (EC-013) |
| **Credential kedaluwarsa (180 hari)** | `401 CREDENTIAL_EXPIRED` | Sama dengan dicabut | Pairing ulang |
| **Jam mundur > 5 mnt** | `trusted_now < max_seen_time − 5 mnt` | Terkunci sampai sync (BR-AUT-013) | Sync mengoreksi offset; `max_seen_time` direset hanya oleh sync sukses |
| **Jam salah (selisih jam > 10 mnt)** | Sampel offset | Banner + `device_sync_status.clock_offset_ms`; `business_date` tetap benar karena memakai waktu terkoreksi | Manager menyetel jam perangkat |
| **Jam maju manual** | Selisih jam-dinding vs monotonik dalam sesi; lease tampak habis lebih awal | Anomali dicatat di `device_log` (`CLOCK_ANOMALY`); efek terburuk: terkunci lebih cepat (bukan celah keamanan) | Sync |

### 5.8 Matriks "konflik → pola → komponen"

| Konflik/situasi (PRD) | Pola | Komponen pelaksana |
|---|---|---|
| Dua admin ubah master bersamaan (EC-049) | P2 | `tenant_sync` row lock |
| Dua device jual SKU sama, stok minus (EC-003) | P2+P3 | lock `stock_balance` + `STOK_MINUS` |
| Harga/produk/tarif basi (EC-001/002/005) | P3 | `data_flag` |
| Perintah terkirim dua kali (EC-004) | P4 | `idempotency_command` |
| Nomor invoice bentrok (EC-034) | P3+P5 | `recordSeries` + `-Dn` + `attention_item` |
| Dua device buka bill di meja sama (EC-014) | P3 | `BILL_GANDA_MEJA` |
| Terima vs batal serah-terima (EC-061) | P2 | `FOR UPDATE bill` + `409` |
| Dua tab `/pos` (EC-021) | P1 | Web Locks (§3.7) |
| Payload rusak/otorisasi gagal (EC-007/011) | P5 | `ATTENTION` + FLOW-18 |
| Hitung client ≠ server (EC-029) | P3 | `verifySale` ⇒ `SELISIH_HITUNG` |
| Storage dibersihkan sebelum sync (EC-008) | (residual) | gap + pemulihan (§5.5) |

### 5.9 "Terima manual" dan impor berkas ekspor (FLOW-16, FLOW-18)

Satu **jalur pemrosesan tunggal** `processCommand(ctx, command)` dipakai oleh tiga pintu: (a) push device, (b) **terima manual** item `attention_item` oleh manager, (c) **impor berkas ekspor** (§3.5). Pintu (b)/(c) menjalankan penangan modul yang sama dengan identitas pengirim = device/register **asal** (dari `idempotency_command`/header berkas), bukan identitas manager, dan mencatat `accepted_by`, status `ACCEPTED_MANUAL`, serta entri audit (BR-AUD-001: penyelesaian "perlu perhatian"). Karena idempotensi, mengimpor berkas yang sebagian sudah terkirim aman (kunci sama ⇒ replay). Konflik nomor ⇒ `-Dn` (§5.5). Perintah dependen dilepas setelah induknya `ACCEPTED_MANUAL`. Server function impor memvalidasi hash berkas, Zod tiap perintah, batas ukuran, dan hanya untuk permission `user.manage`/manager.

---

## 6. Autentikasi, Otorisasi, dan Isolasi

### 6.1 Dua jalur identitas

```
 BACK-OFFICE (/admin, online)                              TERMINAL (/pos, offline-capable)
 ───────────────────────────                               ─────────────────────────────────
 Orang (owner/manager/…) — identitas GLOBAL               Perangkat (device) + Staf (PIN)
   │ email + password (tanpa username)                       │ enrollment: kode pairing 8 karakter (online, sekali)
   ▼                                                         ▼
 Better Auth (cookie sesi httpOnly PER TENANT, login      credential device (token 256-bit, Bearer)  ← identitas MESIN
   │  terpisah per tenant; akun tetap GLOBAL)                │
   │ + keanggotaan aktif (app_user) diperiksa saat login     ▼
   ▼                                                         tenant_id/outlet_id/register_id dari device (server)
 tenant_id + app_user + user_outlet + role_permission
   │                                                         │ PIN lokal (Argon2id + HMAC per device)  ← identitas ORANG
   └──────────────► withTenant(tenant_id) ► RLS ◄────────────┘      permission dari role_permission yang diunduh
```

Dua identitas di terminal sengaja **terpisah**: *device* mengotentikasi ke server; *staf* mengotentikasi ke device. Server tidak pernah menerima PIN dari terminal (BR-AUT-004); apa yang staf lakukan offline dipertanggungjawabkan lewat `staff_id` pada payload + audit, bukan lewat kredensial staf ke server.

### 6.2 Login awal online (back-office)

`DISEPAKATI` (BR-AUT-001, FR-AUT-001; **direvisi 2026-11-19**, AD-39): **Better Auth** dengan **identitas global + keanggotaan per tenant** — satu email = satu akun global (unik se-sistem), satu kata sandi, **keanggotaan dan peran per tenant** lewat plugin *organization* (organisasi = tenant); login back-office **hanya dengan email + kata sandi** (tanpa username; staf kasir memakai PIN di POS, §6.4); tanpa SSO (DOQ-15). Ini **menggantikan** model "akun terpisah per tenant" (keputusan 2026-11-18) **untuk akun** — tetapi **sesi tetap per tenant** (cookie per slug, login terpisah per tenant; keputusan user 2026-11-19, OQ-A29) — rincian di §6.2.1.

| Aspek | Keputusan |
|---|---|
| Sesi (cookie per tenant; login terpisah per tenant) | `DISEPAKATI` (user 2026-11-19, OQ-A29; **mempertahankan** keputusan 2026-11-18, RK-37 dicabut): cookie `httpOnly; Secure; SameSite=Lax` untuk `/admin` dengan **nama per tenant** (mis. `solva_s_<slug>`) dan **`Path=/<slug>`** (pola `cookieName`/`cookiePath` referensi). **Akun global, sesi per tenant:** setelah login di `/<slug>/admin` sesi **terikat tenant itu** (organisasi tenant tercatat pada sesi); **logout hanya mengakhiri sesi tenant itu**; **dua tenant di satu browser butuh login terpisah** (email dan kata sandi yang sama). **Ubah/reset kata sandi mencabut semua sesi akun di semua tenant** (kata sandinya satu). Konsekuensi: **semua** endpoint yang membutuhkan cookie harus berada di bawah `/<slug>/…` — endpoint Better Auth di `/<slug>/admin/api/auth/*`, dan server function `/admin` dipanggil lewat URL berawalan slug: `createStart` memakai `fetch` kustom yang menulis ulang `/_serverFn/…` menjadi `/<slug>/_serverFn/…`, Nginx me-`rewrite` ke `/_serverFn/…` + `X-Tenant-Slug` (§1.7; header dari klien dibuang/ditimpa). Better Auth bernama/berjalur cookie statis ⇒ kandidat: **pabrik instance per slug** (di-cache; `cookiePrefix` + `defaultCookieAttributes.path` per slug). **`VERIFIKASI` spike F1** (`RSK-A18`); cadangan: `Path=/` dengan nama cookie per tenant + pemeriksaan `X-Tenant-Slug`. Masa berlaku bergulir (sliding, usulan 12 jam idle / 7 hari maks.); kedaluwarsa ⇒ `UNAUTHORIZED#id` ⇒ pengalihan ke halaman login slug dengan `returnTo` aman (pola `safe-redirect` referensi) |
| Penentuan tenant | **Dari sesi** (terikat tenant saat login) → organisasi → `tenant.auth_org_id`; **tidak pernah** dari input pengguna **atau dari URL**. Slug di URL hanyalah petunjuk yang **dicocokkan** dengan tenant sesi/token (`getTenantContext`, §1.7): berbeda ⇒ ditolak. `getAuthContext()` memuat `app_user` untuk `(auth_user_id, tenant sesi)` dan **memeriksa `status = ACTIVE` pada tiap permintaan** (baris itu dimuat juga untuk izin, jadi tanpa biaya tambahan): keanggotaan dikeluarkan/ditangguhkan ⇒ sesi tenant itu **dicabut** dan permintaan ditolak (pencabutan seketika). Hasil: `{ tenantId, appUserId, permissions, outletScope }`; `withTenant` dipanggil dengan nilai itu (AD-05). Pemeriksaan keanggotaan saat login (tenant belum berkonteks) memakai fungsi sempit `SECURITY DEFINER` (di arsitektur disebut `resolve_membership(auth_user_id, tenant_id)`; nama final di SCHEMA) |
| Login ter-scope slug | `POST` login di `/<slug>/admin/login`: (1) slug → `tenant_id` (404 bila tak dikenal); (2) batas laju (§6.9); (3) verifikasi email + kata sandi lewat Better Auth (hash tiruan bila email tak ada, waktu seragam); (4) **baru setelah sukses**: periksa **keanggotaan aktif** pada tenant slug itu; (5) bila anggota ⇒ buat **sesi terikat tenant itu** + cookie slug. **Bukan anggota, kata sandi salah, atau email tak ada ⇒ satu pesan generik yang sama** ("Email atau kata sandi salah") dan **tidak ada sesi** — tak ada pembeda yang membocorkan keberadaan akun atau keanggotaan (§9.7.3). Halaman login memuat nama tenant |
| Email sebagai pengenal | Email dinormalisasi (huruf kecil, dipangkas) dan **unik se-sistem**; **tidak ada verifikasi email, tidak ada surel keluar** di MVP (§6.2.1) — email hanyalah pengenal login. Alias `…@auth.solva.invalid`, `username` Better Auth, dan fungsi `find_login_identity` **tidak dipakai lagi** |
| Hash password | Bawaan Better Auth (scrypt); tidak dibuat sendiri |
| Throttling | Pembatas login **progresif per akun global** (kunci utama = `auth_user_id`/hash email; tanpa IP; tanpa penguncian permanen) + hitungan per slug (semprot kata sandi) + jaring longgar per IP + slug, lewat pustaka pembatas (§6.9.3–6.9.4, celah §6.9.10 — mitigasi **tanpa** (OQ-A27 terjawab)); pembatas bawaan Better Auth **dimatikan** agar tak ada penghitungan ganda; IP dari `X-Real-IP` Nginx saja; kegagalan login mencatat **hash pendek 8 karakter dan panjang** input (bukan nilainya; BR-LOG-007) |
| CSRF | Cookie `SameSite=Lax` + `Path=/<slug>` (cookie tenant A tidak terkirim ke `/<slugB>`) + semua mutasi lewat `POST` server function (token anti-CSRF bawaan framework `VERIFIKASI`) + pemeriksaan `Origin`/`Sec-Fetch-Site`; route `/api/pos/v1/*` memakai Bearer (tanpa cookie) sehingga bebas CSRF |
| Isolasi di satu origin | Satu origin sudah diputuskan (OQ-A10); cookie sesi `HttpOnly` per tenant, tidak terbaca skrip. **Sesi curian satu tenant tidak membuka tenant lain** (cookie dan sesi terikat tenant); yang tetap berlaku: **kata sandi yang bocor membuka semua tenant orang itu** karena akun global (RSK-A28). Data lokal tetap dibagi satu origin (RSK-A17) |
| Penanda tenant aktif dan multi-tab | Header `/admin` menampilkan **nama tenant aktif** (teks, bukan warna) dan judul tab memuat nama tenant. **Tidak ada pengalih tenant** (keputusan user 2026-11-19, selaras DESIGN DOQ-24): akun global, tetapi sesi per slug — pengguna multi-tenant membuka `/<slug-lain>/admin` langsung (alamat/markah/tautan) dan **login terpisah** di sana. Fungsi `list_memberships(auth_user_id)` yang semula disiapkan untuk menu pengalih **dihapus dari rancangan** (RK-45). **Multi-tab:** tab pada tenant yang sama berbagi sesi (cookie yang sama); tab pada tenant berbeda memakai sesi independen sehingga **dapat terbuka bersamaan**; logout di satu tenant tidak memengaruhi tenant lain |
| Atur PIN staf | Owner/manager menetapkan/reset PIN di `/admin` (SCR-A08): server function menerima PIN **sekali lewat TLS**, menghitung `verifier = Argon2id(PIN, kdf_salt, params)` (hash-wasm), menyimpan **hanya** `user_pin_credential` (`pin_epoch++`) dan menurunkan `staff_pin` per device (HMAC); PIN polos **tidak disimpan/dicatat** (BR-LOG-007). **PIN bersifat per tenant** (per `app_user`): orang yang sama di dua tenant punya dua PIN terpisah. Alternatif: hash di browser `/admin` sebelum dikirim — server tak pernah melihat PIN tetapi tak dapat menegakkan kebijakan PIN (panjang 4–6, pola lemah); **`DISEPAKATI`** (OQ-A06 terjawab 2026-11-18: dihitung di server) |

#### 6.2.1 Identitas global dan keanggotaan per tenant (AD-39, direvisi 2026-11-19)

`DISEPAKATI` (keputusan user 2026-11-19; pola industri — Square/Shopify/Toast: satu identitas, banyak toko/tenant): **satu email = satu akun global, satu kata sandi; keanggotaan dan peran per tenant.** **Menggantikan** keputusan 2026-11-18 ("dua akun terpisah per tenant; alias internal `…@auth.solva.invalid`; email boleh sama lintas tenant") — RK-28 diganti RK-37…RK-39. Kendala lama (tabel `user` Better Auth menuntut email unik se-sistem) kini **sejalan** dengan model (tidak perlu pembungkus/alias).

| Opsi | Cara | Trade-off |
|---|---|---|
| **A — identitas global + keanggotaan (dipilih, 2026-11-19)** | Tabel Better Auth dipakai utuh: `user` (global, `email` unik), `account` (kata sandi), `session`, `organization` (= tenant, `tenant.auth_org_id`), `member` (orang × tenant). **Keanggotaan otoritatif aplikasi = `app_user`** (profil per tenant: `tenant_id`, `auth_user_id` **nullable**, peran, `user_outlet`, `status`, PIN): UQ `(tenant_id, auth_user_id)` bila ada. Baris `member` Better Auth dibuat **searah** agar plugin konsisten dan **tidak dibaca untuk otorisasi** (`VERIFIKASI` spike F1 bahwa plugin berjalan tanpa membaca `member`; peran bawaan Better Auth tidak dipakai — RBAC = `app_user`/`role_permission`). **Staf kasir tanpa akses back-office** punya `app_user` **tanpa** `auth_user_id` (hanya PIN di POS) — tidak ada akun global untuknya | Tanpa pembungkus login/alias/`find_login_identity`; cocok dengan plugin standar; satu kata sandi untuk banyak tenant. Biaya: **satu identitas membuka beberapa tenant** (RSK-A28), pemulihan tanpa email manual (RSK-A29), keanggotaan lintas tenant perlu fungsi `SECURITY DEFINER` sempit (`resolve_membership`, `list_memberships`, `auth_account_membership_count`) |
| B — akun terpisah per tenant (keputusan 2026-11-18) | Alias internal turunan id, email asli di `app_user` | **Digantikan**: kata sandi dan sesi berlipat untuk orang yang sama; pembungkus login; tidak lazim; pemulihan tak sederhana |
| C — satu instance/skema Better Auth per tenant | Isolasi penuh | Migrasi dan konfigurasi berlipat per tenant; **ditolak** |

**Asumsi detail identitas — diterima user 2026-11-19 (OQ-S37):** (1) **peran Better Auth hanya cerminan kasar** (mis. `owner`/`member`); **izin sebenarnya dari tabel kita** (`app_user` + `role_permission`); (2) **email tidak disalin ke data akun tenant**: `app_user` tidak menyimpan email (hanya `user` Better Auth); daftar pengguna di `/admin` membaca email lewat fungsi sempit `SECURITY DEFINER` yang hanya mengembalikan anggota **tenant pemanggil**; (3) **ganti email hanya oleh pemilik akun atau operator platform** (owner tenant tidak dapat mengganti email anggotanya); (4) **`auth_user_id` dipertahankan pada anggota yang dikeluarkan** (status `REMOVED`, riwayat audit tetap menunjuk orangnya; **mengundang ulang mengaktifkan kembali** baris `app_user` yang sama, UQ `(tenant_id, auth_user_id)` tetap); `auth_account_membership_count` menghitung **hanya keanggotaan `ACTIVE`**; (5) **kunci rate limit login memakai email lintas slug** (§6.9.3).

**Dampak pada data (diteruskan ke sesi SCHEMA, bukan diubah di sini):** `app_user.auth_user_id` nullable; `app_user` **tanpa email/username** (email hanya pada `user` Better Auth); status `ACTIVE`/`REMOVED` dengan `auth_user_id` dipertahankan; tabel baru **`member_code`** (undangan dan kode reset; § di bawah); fungsi `SECURITY DEFINER` keanggotaan dan direktori anggota tenant; `username` Better Auth dan `find_login_identity` dihapus; sesi Better Auth menyimpan tenant (organisasi) sesi.

**Tanpa email di MVP (keputusan user 2026-11-19; alur dan aturan reset dikonfirmasi user 2026-11-19, OQ-A28 terjawab opsi a):** tidak ada SMTP/penyedia email, tidak ada verifikasi email, **tidak ada "Lupa kata sandi" mandiri**. Undangan dan reset kata sandi **manual**, lewat **kode sekali pakai** yang disampaikan pengundang di luar sistem (lisan/aplikasi pesan). Kode **tidak pernah dikirim sistem**.

**Alur undangan tanpa email** (`DISEPAKATI`, OQ-A28 opsi a; reuse undangan bawaan Better Auth `VERIFIKASI` F1, bila tidak cocok memakai tabel sendiri):

1. Owner/manager (izin `user.invite`; peran yang diberikan ≤ peran pemberi) mengisi email + nama + peran + outlet di `/admin`. Server membuat profil `app_user` berstatus **`PENDING`** (tanpa `auth_user_id` sampai kode ditukar) dan baris **`member_code`** (jenis `INVITE`, `app_user_id` → profil itu): `tenant_id` **NOT NULL** (RLS seragam dengan tabel bertenant lain), **email terikat** (ternormalisasi), peran, cakupan outlet, `code_hash = SHA-256(kode)`, `expires_at` +72 jam, `used_at`; **tanpa kolom jumlah percobaan** — percobaan salah dihitung di **memori** oleh pembatas laju (§6.9.3). Kode **10 karakter dari alfabet 32** (tanpa huruf mirip; 32¹⁰ ≈ 1,1×10¹⁵), **ditampilkan sekali** kepada pengundang. Satu kode aktif per **`(app_user_id, kind)`**: kode baru mencabut yang lama (`revoked_at` + `revoke_reason` = `REPLACED`).
2. **Penukaran satu langkah** di `/<slug>/join` (tautan opsional `…/join#code=<kode>`, fragmen): penerima mengisi **email + kode + kata sandi** sekaligus; petunjuk netral di formulir: "Jika Anda sudah punya akun Solva, masukkan kata sandi akun itu; jika belum, buat kata sandi baru" (**tidak** membuka bahwa akun ada). Server: batas laju (per email dan per slug, §6.9.3) → slug → `tenant_id` → `withTenant` → cari `member_code` aktif (hash kode + email terikat; belum kedaluwarsa/terpakai) → **cabang internal yang tak terlihat dari luar:** (a) email **belum punya akun** ⇒ akun global + keanggotaan dibuat dengan kata sandi yang diketik (kebijakan panjang ≥ 10); (b) akun **sudah ada** ⇒ kata sandi harus **cocok dengan akun itu** (diverifikasi lewat pembatas login yang sama, kunci akun global, sehingga penukaran bukan jalur tebak kata sandi tanpa batas) ⇒ keanggotaan ditambahkan atau **diaktifkan kembali** (anggota yang pernah dikeluarkan). **Semua kegagalan** — kode salah/kedaluwarsa/terpakai, email tak cocok, kata sandi akun salah, batas laju — dijawab **satu respons seragam** ("Kode atau data tidak valid") dengan waktu seragam (hash tiruan), sehingga **keberadaan akun tidak terbuka** bahkan bagi pemegang kode. `used_at` diisi dalam transaksi yang sama (sekali pakai). Audit: `member.invited`/`member.accepted`.
3. **Retensi dan pembersihan:** baris `member_code` (undangan maupun reset) **disimpan 7 hari setelah kedaluwarsa atau terpakai** (jejak audit/diagnostik), lalu **dihapus fisik** oleh **pekerja latar** yang juga men-**soft-delete profil `PENDING` yatim** (profil tanpa kode aktif/terpakai setelah kodenya dibersihkan) (pembersih `member_code`: berkala, mis. tiap jam, per batch kecil, *advisory lock*, pool terpisah — §9.5 "Pekerja latar"; lintas tenant lewat `list_active_tenants()` agar RLS tetap berlaku). Kode polos tidak pernah disimpan (hanya hash).
4. **Daftar "Undangan tertunda" di `/admin`** (keputusan user 2026-11-19, DOQ-26) dengan aksi **Batalkan** dan **Terbitkan ulang** (kode baru; **kode lama otomatis tak berlaku**). Dua halaman penerima **terpisah**: `/<slug>/join` (terima undangan) dan `/<slug>/reset` (tukar kode reset) — satu tujuan per halaman. Pendaftaran publik (`sign-up`) Better Auth **dinonaktifkan**: akun hanya lahir lewat undangan (atau operator platform untuk owner pertama saat tenant dibuat).

**Fungsi server Undangan tertunda** (`DIUSULKAN` detailnya; modul `identity`, `functions/invites.fn.ts` → `identity/public` → service → repo; semua `withTenant`, izin **owner** (`user.invite`), kode galat publik `KODE#id`, audit tanpa kode):

| Fungsi | Pemeriksaan | Efek |
|---|---|---|
| `listPendingInvites()` | Izin owner; RLS membatasi ke tenant sendiri | Mengembalikan profil `PENDING` beserta kode `INVITE` terbarunya: `id`, email, peran, cakupan outlet, `issued_by`, `created_at`, `expires_at`, status `PENDING`/`EXPIRED` (yang kedaluwarsa tetap tampil selama retensi 7 hari agar dapat diterbitkan ulang; yang dicabut tidak tampil). **Tidak pernah** mengembalikan kode atau hash. Hanya baca, **satu indeks sederhana** `(app_user_id, kind, created_at DESC)` |
| `cancelInvite(id)` | Izin owner; baris milik tenant dan belum terpakai; sudah dibatalkan ⇒ sukses idempoten | Mengisi `revoked_at` + `revoke_reason` = **`CANCELED`** ⇒ kode tak berlaku seketika; **membatalkan undangan murni** (profil `PENDING`) **ikut soft-delete profil itu**; audit `member.invite_canceled` (aktor di `audit_log.actor`; tanpa kolom `revoked_by`); baris kode tetap tunduk retensi 7 hari |
| `reissueInvite(id)` | Izin owner; baris `INVITE` milik tenant, **belum terpakai** (terpakai ⇒ galat "sudah diterima") dan **belum dicabut** (dibatalkan ⇒ buat undangan baru lewat formulir); status `PENDING` atau `EXPIRED` dalam retensi; email **belum menjadi anggota `ACTIVE`** tenant ini; **peran yang diberikan ≤ peran pemberi** (diperiksa ulang); **batas penerbitan** (di bawah) | Dalam **satu transaksi**: baris lama diisi `revoked_at` + `revoke_reason` = **`REPLACED`** ⇒ **kode lama tak berlaku seketika**; baris baru (profil `PENDING` yang sama, `issued_by` = owner) dengan kode baru (10 karakter, alfabet 32), `expires_at` +72 jam; kode baru **ditampilkan sekali** (respons yang hilang ⇒ terbitkan ulang lagi, kode sebelumnya otomatis batal — tidak perlu kunci idempoten); **tidak ada kolom `replaced_by`** — tautan kode lama → baru hanya di `audit_log` (`member.invite_reissued`, id lama → id baru); **penghitung penukaran `slug + email` di memori direset** agar penerima yang terblokir salah ketik dapat mencoba lagi |

**Pemeriksaan hitungan keanggotaan pada penerbitan:** penerbitan/terbit ulang menjaga **satu kode aktif per `(app_user_id, kind)`** (bukan per tenant+email). `auth_account_membership_count(auth_user_id)` (SCHEMA) menghitung `app_user` belum dihapus **termasuk `PENDING`**, sehingga undangan aktif di sebuah tenant **menahan reset oleh owner tenant lain** (jatuh ke operator platform) selama profil `PENDING` itu ada — arah aman, dicatat sebagai efek yang diterima; kedaluwarsa 72 jam + pembersihan profil yatim membatasi dampaknya. Penerbitan **kode reset** (`issueResetCode`, izin `user.reset_password`, R1 diperiksa saat penerbitan) mengikuti prinsip yang sama (satu kode aktif per profil+jenis, kode lama batal); tidak ada daftar khusus untuk kode reset di MVP.

**Alur reset kata sandi manual dan aturan keamanan** (`DISEPAKATI`, OQ-A28 opsi a; **prosedur operator platform untuk verifikasi identitas di luar sistem belum dirancang** — dicatat di RSK-A29):

- **Ubah sendiri:** pengguna yang sedang login mengganti kata sandi (kata sandi lama wajib) ⇒ sesi lain dicabut.
- **Lupa kata sandi:** tidak ada alur mandiri. Pemulihan lewat **kode reset sekali pakai** — baris `member_code` jenis `RESET` (hash, email terikat, berlaku 24 jam, **`tenant_id` NOT NULL**, retensi dan pembersihan sama seperti undangan) — yang diterbitkan oleh pihak berwenang dan disampaikan di luar sistem. **Penukaran satu langkah** di **halaman terpisah** `/<slug>/reset`: email + kode + kata sandi baru, **respons seragam** untuk semua kegagalan (tidak membuka apakah akun ada), batas laju per email dan per slug (§6.9.3). **Penerbit tidak pernah menetapkan atau melihat kata sandi.** Redeem ⇒ semua sesi akun (semua tenant) dicabut, audit `member.password_reset`. **Reset oleh operator platform** memakai **konteks salah satu tenant tempat akun menjadi anggota** (operator memilih tenant; `withTenant` biasa, tanpa `BYPASSRLS`; baris `member_code` ber-`tenant_id` tenant itu) dan pemilik akun menukar kode di `/<slug>/reset` tenant tersebut — operator menyebutkan slug-nya bersama kode.
- **Risiko yang HARUS ditutup — pengambilalihan lintas tenant:** *owner tenant A mereset kata sandi Ani, yang juga owner tenant B ⇒ ia dapat masuk sebagai Ani dan mengambil alih B.* **Aturan usulan:**
  - **R1.** Owner/manager (izin `user.reset_password`) **hanya boleh menerbitkan kode reset untuk akun yang keanggotaannya hanya di tenantnya** (server memeriksa `auth_account_membership_count(auth_user_id) = 1` **saat penerbitan dan saat penukaran**; **hitungan menyertakan keanggotaan `ACTIVE` dan undangan aktif lintas tenant** — fungsi `SECURITY DEFINER` membaca `member_code` semua tenant dan hanya mengembalikan angka; kode yang beredar batal begitu keanggotaan atau undangan kedua muncul).
  - **R2.** Akun **multi-tenant** hanya dapat direset oleh **operator platform** (`/platform`, setelah verifikasi identitas di luar sistem — prosedur di luar dokumen ini) atau diubah sendiri oleh pemiliknya.
  - **R3.** Akun ber-peran **owner** hanya oleh operator platform; manager tidak dapat mereset peran ≥ perannya.
  - **R4.** Penolakan R1–R3 memakai **satu pesan generik** ("Reset tidak tersedia untuk akun ini di sini; hubungi operator platform") agar tidak membocorkan apakah akun multi-tenant.
  - **R5.** Tiap penerbitan/penukaran kode tercatat audit dan di log; operator platform melihat penerbitan reset di akun multi-tenant.
- **Pra-klaim email (squatting) — `DITERIMA` di MVP (keputusan user 2026-11-19, OQ-S39):** tanpa verifikasi email, pengundang yang juga memegang kodenya dapat menukar kodenya sendiri dan membuat akun atas email orang lain (kata sandi diketahuinya) sebelum orang itu mendaftar. **Mitigasi yang ada:** (1) owner hanya mereset akun yang keanggotaannya **hanya di tenantnya** (R1; hitungan menyertakan undangan aktif lintas tenant); (2) **bergabung ke tenant lain butuh kode dari tenant itu dan kata sandi akun yang sudah ada** — pra-klaim tidak otomatis membuka tenant lain; (3) audit `member.*`; (4) operator platform dapat mereset setelah verifikasi identitas di luar sistem. **Verifikasi email = fase lanjut.** Dicatat di RSK-A29.
- **2FA:** **tidak ada di MVP** (keputusan user); satu identitas membuka beberapa tenant ⇒ risiko dicatat (RSK-A28) dan **2FA owner menjadi fase lanjut**; mitigasi sementara: kebijakan kata sandi, pembatas login (§6.9), audit dan log, sesi sliding terbatas, `/admin` hanya online.

- **Organization Better Auth:** wadah tenant (`tenant.auth_org_id`, BR-AUT-001); orang dapat menjadi anggota **banyak** organisasi; peran bawaan hanya **cerminan kasar** (izin dari tabel kita); fitur undangan email Better Auth tidak dipakai kecuali verifikasi F1 menyatakan undangan dapat dipakai tanpa surel.
- **Pengujian:** satu email masuk ke tenant A dan B dengan satu kata sandi; **bukan anggota ⇒ pesan sama dengan kata sandi salah** (isi dan waktu); pencabutan keanggotaan mencabut sesi tenant itu dan berlaku pada permintaan berikutnya; **dua tenant di satu browser: login terpisah, logout satu tenant tidak memengaruhi yang lain, dua tab dua tenant bersamaan**; cookie tenant A tidak terkirim ke `/<slugB>`; sesi tenant A pada `/<slugB>/admin` ⇒ ditolak; ubah kata sandi mencabut sesi di semua tenant; keanggotaan `REMOVED` tidak dihitung di `auth_account_membership_count` dan undangan ulang mengaktifkan baris yang sama; owner A tidak dapat menerbitkan reset untuk akun multi-tenant (R1–R4), **termasuk akun dengan undangan aktif di tenant lain**, dan kode lama batal saat keanggotaan/undangan kedua muncul; **penukaran satu langkah:** respons dan waktu identik untuk kode salah, email tak cocok, kata sandi akun salah, dan akun tak ada vs ada; replay ditolak; 5 kegagalan per email ⇒ ditolak sementara (penghitung memori, tanpa kolom DB); penukaran akun ada ikut menghitung di pembatas login; reset operator berjalan dalam konteks satu tenant anggota; pembersih `member_code` menghapus baris > 7 hari; tanpa `sign-up` publik; logout global.

### 6.3 Enrollment device (FLOW-01) dan credential

```
Manager (/admin) ── buat register + prefiks ── "Buat kode pairing" ──► server: kode acak 8 karakter (alfabet tanpa huruf mirip),
                                                                       simpan SHA-256(kode), expires_at = +15 mnt, terikat register
Perangkat (/pos, online) ── POST /api/pos/v1/enroll {code, device_name, user_agent} ──► server (satu transaksi):
   1. UPDATE pairing_code SET used_at=now() WHERE code_hash=$h AND used_at IS NULL AND expires_at>now()  (1 baris atau ditolak)
   2. register aktif? register_type? device aktif lain pada register? (UQ) → harus nol (mengganti device = cabut dulu, FLOW-16)
   3. token = 256-bit acak (CSPRNG); simpan SHA-256(token) di device.credential_hash; credential_expires_at = +180 hari
   4. device_sync_status; staff_pin per staf outlet = HMAC(device_salt, verifier) + parameter KDF
   5. respons: {device_id, credential(token, SEKALI), expires_at, config outlet/register, counters awal, server_time}
   6. audit "device di-enroll" ; lalu client memulai FULL PULL
Perangkat: simpan token di Dexie meta.device → storage.persist() → logo → offset jam → shell sudah ter-cache
```

- Brute force kode: ruang 32⁸ ≈ 1,1×10¹²; **rate limit** (10 percobaan/5 mnt **per IP** dan ±30/5 mnt **per slug** untuk menahan penyerang terdistribusi; §6.9.3) + kedaluwarsa 15 mnt + sekali pakai (NFR-SEC-004/005).
- **Konteks tenant saat enrollment**: pairing dilakukan di `/<slug>/pos/`; kode pairing terikat register → tenant, dan server menolak bila slug halaman ≠ tenant kode. **QR pairing** (keputusan user 2026-11-18): dibuat di dialog pairing `/admin` (SCR-A08) dan memuat alamat lengkap **`https://<DOMAIN>/<slug>/pos`** + kode pairing di **fragmen URL** (`#pair=<kode>`). Fragmen **tidak dikirim ke server saat URL dibuka**, tidak ada di log proxy, dan tidak ikut `Referer`; SCR-P01 membacanya lalu menghapusnya dari URL (`history.replaceState`) dan mengisi kolom kode. Dibuka lewat aplikasi kamera OS (membuka peramban) **atau** dipindai langsung di SCR-P01 (`BarcodeDetector`/polyfill, §7.5; format `qr_code`). Kode **sekali pakai, kedaluwarsa 15 menit** (BR-AUT-002); **ketik manual 8 karakter tetap cadangan**. `/` yang 404 tidak lagi menjadi titik masuk. Setelah sukses, registri `solva-registry` menyimpan `slug ↔ tenant_id`.
- **Autentikasi per request**: `Authorization: Bearer <token>` → SHA-256 → cari `device.credential_hash` (indeks unik) → cek `revoked_at IS NULL`, `credential_expires_at > now()`, status register/tenant. Hasil boleh di-cache LRU **15 dtk** (pencabutan berlaku ≤ 15 dtk setelah kontak; BR-AUT-010 mengizinkan "saat online berikutnya"). Kegagalan berulang dari satu IP/token dibatasi lajunya.
- **Pembaruan bergulir** 180 hari: setiap sync sukses, bila sisa < 150 hari server memperpanjang `credential_expires_at` (menghindari tulis baris panas, SCHEMA §4.1.14); token tidak berubah. **Rotasi token** pada pembaruan = opsi pengerasan (`OQ-A05`).
- **Satu device aktif per register**: `UQ (register_id) WHERE revoked_at IS NULL`; peramban/profil kedua = device kedua yang tak dapat di-enroll tanpa mencabut yang pertama (§3.7).

### 6.4 PIN lokal, supervisor override, lease 7 hari, kunci layar

**Verifikasi PIN (offline)** — `DISEPAKATI` hash lambat + salt per device (BR-AUT-004); algoritma `DIUSULKAN`:

```
pilih nama (app_user dari Dexie) ─► input PIN 4–6 digit
  1. (pesimistik) tulis staff_pin_state.failed_count+1 + last_failed_at  [1 tx Dexie]   ← jawab "PIN salah" tidak dapat dihindari dengan mematikan tab
  2. Web Worker: verifier' = Argon2id(PIN, staff_pin.kdf_salt, staff_pin.kdf_params)      (hash-wasm; 250–500 ms target, NFR-PERF-007)
  3. WebCrypto: h = HMAC-SHA256(key = staff_pin.device_salt, data = verifier')
  4. bandingkan h dengan staff_pin.pin_hash (waktu-konstan)
  5. cocok ⇒ failed_count=0, buka sesi lokal dengan permission staf (role_permission) ; tidak cocok ⇒ tampilkan sisa percobaan
kunci: 5 gagal ⇒ 5 mnt ; 5 berikutnya ⇒ 15 mnt ; total 15 ⇒ sampai reset manager (BR-AUT-005) — locked_until diukur dengan waktu TERKOREKSI
```

| Aspek | Keputusan | Alasan |
|---|---|---|
| Algoritma | **Argon2id** (`hash-wasm`) dengan parameter dikalibrasi di perangkat uji (memori ≈ 19 MiB, iterasi ≥ 2, paralel 1 sebagai titik awal OWASP); cadangan **PBKDF2-SHA256** (WebCrypto) bila WASM gagal dimuat. `kdf_algo`/`kdf_params` disimpan per baris (SCHEMA §4.1.16–17) sehingga perubahan parameter = reset epoch | Ruang PIN 10⁴–10⁶ amat kecil: bila hash diekstrak dari IndexedDB, serangan offline hanya dihambat oleh biaya per tebakan. Argon2id (memory-hard) jauh menyulitkan GPU dibanding PBKDF2; PBKDF2 unggul pada kecepatan/tanpa WASM. **`DISEPAKATI`** Argon2id (OQ-A06 terjawab 2026-11-18); hanya **parameter** (memori/iterasi) yang masih dikalibrasi pada perangkat nyata F3 |
| Tempat hitung | **Web Worker** | UI tidak membeku 250–500 ms |
| Hasil di Dexie | `staff_pin_state` (percobaan, `lock_tier`, `locked_until`, `pin_epoch_seen`); **jeda dihitung dari `meta.clock.max_seen_time` tanpa kolom baru** dan `ReportPinState` dikirim **saat `lock_tier` berubah** (keputusan user 2026-11-19, OQ-S36; audit `pin.locked` bila terkunci) | BR-AUT-005, BR-AUD-001 |
| Reset manager | Menaikkan `user_pin_credential.pin_epoch`; device yang melihat epoch lebih tinggi membersihkan penghitung lokal | FR-AUT-007 |

**PIN supervisor (override)**: diverifikasi **lokal** terhadap `staff_pin` penyetuju (nama dipilih, PIN dimasukkan) dengan jalur yang sama; syarat: penyetuju ≠ peminta (BR-AUT-007), memiliki permission (`discount.approve` / `return.approve` / `sale.void`) dan batas role ≥ persen diminta (BR-DSC-003). Hasilnya dicatat sebagai entri audit (peminta, penyetuju, nilai, alasan, register) lewat `AppendAudit` (§4.2.5). **Server tidak dapat memverifikasi ulang PIN** (tidak menyimpan PIN); ia memeriksa **struktural** (penyetuju ≠ peminta, penyetuju ada di tenant dan outlet) dan mencatat — keputusan bisnis offline = fakta (AP-02).

**Lease offline 7 hari (BR-AUT-008) dan waktu tepercaya:**

```
trusted_now      = Date.now() + clock.offset_ms                       (§4.5; dalam sesi: diperkuat jangkar monotonik)
lease_elapsed    = trusted_now − meta.last_success_sync_at(server_time)
LOCKED           bila lease_elapsed > 7 hari  ATAU  trusted_now < max_seen_time − 5 mnt
LEASE_WARNING    bila lease_elapsed > 7 hari − 24 jam
```

Dievaluasi di boot, tiap menit (instance aktif), dan sebelum membuka shift/login. Saat terkunci: tidak ada login/transaksi baru; **ekspor pending tetap tersedia** (§3.5); unlock hanya oleh sync sukses. Ini ditegakkan **di device** (server hanya mengomunikasikan; SCHEMA §4.6.7).

**Kunci layar otomatis 10 menit (BR-AUT-015, FLOW-20):** pewaktu di instance aktif memakai `performance.now()` (kebal lompatan jam) yang direset oleh aktivitas (pointer/tombol/pindai); **berhenti** selama `payment_in_progress` atau dialog PIN supervisor terbuka (bendera state domain, bukan tebakan UI); saat habis ⇒ `meta.idle_lock = {locked:true, locked_staff_id, locked_at}` dan navigasi ke SCR-P02 varian terkunci — **tidak ada state yang dibuang** (keranjang/bill/input tetap di store + `cart_draft`). Pembuka: staf yang sama (PIN) atau pengguna ber-`screen.unlock_override` (hanya "Tutup shift"; draf dibuang, `AppendAudit` override + jumlah draf). Kunci/buka biasa tidak diaudit (log operasional saja).

### 6.5 Token kedaluwarsa saat offline dan silent refresh

| Artefak | Masa berlaku | Perilaku offline | Perilaku online (refresh) |
|---|---|---|---|
| Sesi Better Auth `/admin` | sliding 12 jam idle | `/admin` online-only: tak relevan | Pembaruan cookie otomatis oleh Better Auth; kedaluwarsa ⇒ login ulang |
| Credential device | 180 hari bergulir | Tidak "kedaluwarsa" dalam praktik: lease 7 hari mengunci jauh sebelumnya | Diperpanjang diam-diam pada sync sukses (§6.3); tanpa interaksi pengguna |
| Sesi staf lokal | Selama instance hidup; hilang saat reload (PIN lagi) | Tidak bergantung server | — |
| Lease | 7 hari dari `last_success_sync_at` | Dihitung lokal | Direset sync sukses |

Tidak ada *access token* berumur pendek di jalur `/pos`: otorisasi device adalah credential berumur panjang yang dapat dicabut (KEP-05); otorisasi staf adalah PIN lokal. Ini sengaja: token pendek akan gagal diperbarui saat offline berjam-jam–berhari-hari dan memaksa kasir keluar (bertentangan dengan G-01).

### 6.6 Penyimpanan kredensial/kunci di device; risiko dan opsi pengerasan

`DISEPAKATI`: **tanpa enkripsi IndexedDB di MVP** (BR-AUT-011, NFR-SEC-006, RSK-05); pencabutan hanya berlaku saat online (BR-AUT-010).

**Inventaris data sensitif di device:**

| Data | Lokasi | Sensitivitas | Mitigasi MVP |
|---|---|---|---|
| Token credential device | `meta.device` (Dexie, polos) | Tinggi: memungkinkan memanggil API sebagai device itu sampai dicabut | Dapat dicabut; lease 7 hari; hanya kontak dari origin sendiri; audit |
| `staff_pin` (hash PIN, `kdf_salt`, `device_salt`, params) semua staf outlet | Dexie `staff_pin` | Tinggi-sedang: PIN pendek rentan brute-force offline bila hash diekstrak | Argon2id + HMAC per device (hash berbeda antar device); batas percobaan hanya melindungi UI, **tidak** serangan offline (BR-AUT-014 — diterima) |
| Permission/role, batas diskon | Dexie | Rendah | — |
| Transaksi 3 bulan (nama/telepon pelanggan opsional, jumlah, item) | Dexie | Sedang (data pribadi terbatas) | Retensi 3 bulan; telepon dimasker di laporan; tidak pernah di log |
| Katalog, harga | Dexie | Rendah-sedang | — |

**Perlindungan lingkungan (anjuran operasional, bukan fitur):** enkripsi disk OS (Android: FBE default; Windows: BitLocker), kunci layar perangkat, akun peramban khusus kasir. Dicantumkan di panduan pemasangan.

**Opsi pengerasan masa depan** (keputusan user, OQ-A05, 2026-11-18: **tidak masuk MVP**; dievaluasi kelak):

| Opsi | Manfaat | Biaya/risiko |
|---|---|---|
| H1 Kunci perangkat **non-extractable** (WebCrypto ECDSA) + tanda tangan per request (gaya DPoP); token saja tak cukup | Token yang bocor (ekspor IDB/log) tak dapat dipakai dari mesin lain | Kompleksitas; tidak melindungi bila perangkat fisik dicuri dan dibuka |
| H2 Rotasi token pada tiap pembaruan bergulir | Membatasi umur token bocor | Perlu penanganan gagal-di-tengah (token lama + baru bersama sementara) |
| H3 Enkripsi lapis-amplop store sensitif (kunci data dibungkus per-staf dari PIN) | Data di disk tak terbaca tanpa PIN | Bertabrakan dengan login multi-staf offline + biaya kinerja + kehilangan akses bila PIN lupa; sudah ditunda PRD |
| H4 Hanya unduh `staff_pin` staf yang boleh bertugas di register itu | Memperkecil permukaan | Perlu atribut penugasan register (tidak ada di SCHEMA) |
| H5 Autentikasi platform (WebAuthn) untuk membuka kunci | Menggantikan PIN pendek | Dukungan perangkat bervariasi; di luar scope |

### 6.7 Otorisasi (RBAC) dan titik penegakan

Model: **permission = kode** (`permission` global, SCHEMA §4.1.10) → `role_permission` per tenant → `user_outlet` (peran per outlet; `outlet_id NULL` = semua outlet). Batas diskon = `role.discount_limit_pct`.

| Tempat | Penegak | Sifat |
|---|---|---|
| `/admin` (server function) | `requirePermission(ctx, code, { outletId? })` di **service** (bukan di komponen); `outletScope` membatasi manager ke outlet yang ditugaskan; semua tulis lewat modul pemilik data | **Wajib & otoritatif** (online) |
| API device (`/api/pos/v1`) | Autentikasi device; **otorisasi struktural** (register tidak boleh memakai perintah jenis tertentu; entitas milik outlet/tenant itu) | Otoritatif untuk akses data/kanal |
| `/pos` offline (UI) | Gating UI dari permission yang diunduh (tombol disembunyikan/dinonaktifkan; PIN supervisor) | **UX + kontrol operasional**, bukan keamanan server |
| Aksi offline sensitif (void, diskon di atas batas, retur) | PIN supervisor lokal + audit | Server **tidak dapat mencegah** (offline); ia mencatat dan memeriksa struktur (AP-02); diterima secara eksplisit (BR-AUT-010, RSK-05) |

Perubahan permission/role disinkron lewat feed (`role`, `role_permission`, `user_outlet`) dan **berlaku pada sync berikutnya** (BR-AUT-012, EC-036). Pembatalan staf berlaku saat device online (§5.7).

### 6.8 Isolasi tenant dan outlet

| Lapisan | Mekanisme | Uji |
|---|---|---|
| **Database** | RLS `ENABLE`+`FORCE` pada semua tabel bertenant; kebijakan `tenant_id = current_setting('app.tenant_id', true)::uuid`; `solva_app` `NOBYPASSRLS`; konteks diisi per transaksi oleh `withTenant` (AD-05); tanpa konteks ⇒ 0 baris | Tes lintas-tenant untuk setiap tabel (baca/tulis tenant B sebagai tenant A = 0 baris); tes katalog pg: tiap tabel bertenant punya `FORCE` + kebijakan (F1 kriteria 1) |
| **Integritas referensi** | **FK komposit** `(tenant_id, x_id)` (pemeriksaan FK tak tunduk RLS) | Tes: insert dengan `tenant_id` A merujuk baris B ⇒ ditolak |
| **URL/slug (petunjuk saja)** | Slug di URL tidak pernah menentukan akses data; server mencocokkannya dengan tenant sesi (cookie) atau token device dan **menolak bila berbeda** (404 halaman, `403` API/server function); status keanggotaan (`app_user`) diperiksa tiap permintaan `/admin` | Uji: sesi tenant A pada `/<slugB>/admin` ⇒ ditolak; cookie A tidak terkirim ke `/<slugB>` (`Path`); keanggotaan dicabut ⇒ ditolak pada permintaan berikutnya |
| **API device** | `tenant/outlet/register/device` dari **credential**, tidak dari badan (API global tanpa slug); pull **tidak menerima parameter outlet** (selalu outlet device); id di payload divalidasi milik tenant/outlet (FK komposit + cek eksplisit) | Uji: payload merujuk `sku_id` tenant lain ⇒ `ATTENTION (STRUCTURAL)` |
| **`/admin`** | `getAuthContext` ⇒ `tenantId`; `outletScope` diterapkan di service untuk pengguna ber-outlet terbatas (Manager `Y*`) | FR-CAT-013: manager di luar outletnya ditolak |
| **Penyimpanan lokal** | **Dinamai per `tenant_id`** (Dexie `solva-<tenant_id>`, kunci, saluran, cookie; AD-34) dan tidak pernah dibaca lintas tenant. Dexie hanya memuat: master tingkat tenant (katalog, role, metode bayar), master outlet device, transaksi register **ini**; invoice register lain (untuk retur online) hanya di **memori/cache Query**, tidak masuk store `sale` | Uji: isi Dexie setelah full resync tidak memuat outlet lain |
| **Log** | `tenantId` otomatis di konteks log; nilai sensitif tak pernah ditulis (BR-LOG-007) | NFR-OBS-002 |
| **Operator platform** | Tidak ada `BYPASSRLS` untuk aplikasi; tugas lintas tenant per-tenant lewat `list_active_tenants()` | SCHEMA §5.6 butir 7 |

### 6.9 Rate limit dan anti-brute-force (AD-40)

`DISEPAKATI` (keputusan user 2026-11-18, **direvisi 2026-11-19**: kunci utama login admin = **slug + akun**, lalu (identitas global, 2026-11-19) **akun global / email lintas slug**; IP hanya jaring pengaman longgar; **menggantikan** tabel lama "5 gagal/15 mnt per akun dan 20/15 mnt per IP" dan penghitung buatan sendiri). Angka di bawah adalah **nilai awal konservatif** (`DIUSULKAN`), dikonfigurasi lewat **variabel lingkungan** `RL_*` (masuk daftar kunci yang divalidasi `env.ts`, diuji agar tak ada nama liar) dan **dikalibrasi dari log** (§6.9.8).

#### 6.9.1 Dua lapisan dan IP klien yang benar

| Lapisan | Tugas | Alat |
|---|---|---|
| **1. Nginx (banjir kasar)** | Membuang banjir per **IP/path** sebelum menyentuh Node | `limit_req_zone`/`limit_req` (laju + `burst`) dan `limit_conn_zone`/`limit_conn` (koneksi bersamaan) per `$binary_remote_addr`, `limit_req_status 429`/`limit_conn_status 429`; zona terpisah untuk (a) halaman/API umum, (b) jalur tanpa login (login admin, `/enroll`, slug/pemilih, **`/<slug>/join` dan `/<slug>/reset`** lewat `location ~ ^/[^/]+/(join|reset)$` karena Nginx tak mengenal daftar slug), (c) SSE `/api/pos/v1/signals` (koneksi panjang, tidak ikut batas koneksi umum) |
| **2. Aplikasi (aturan bermakna)** | Pembatasan per **akun / device / slug / tenant** yang tak dapat dilihat Nginx | Pustaka pembatas (§6.9.4) di belakang satu lapisan tipis |

**IP klien: Nginx adalah satu-satunya batas kepercayaan.** Nginx **menimpa** (bukan menambah) header: `proxy_set_header X-Real-IP $remote_addr;` dan `proxy_set_header X-Forwarded-For $remote_addr;` — **bukan** `$proxy_add_x_forwarded_for`, yang menambahkan nilai klaim klien. Aplikasi membaca IP **hanya dari `X-Real-IP`**, dan **hanya bila** koneksi TCP datang dari proxy tepercaya (alamat jaringan internal Compose); header yang sama dari luar proxy diabaikan. Bila kelak ada proxy/CDN di depan Nginx: `real_ip_header` + `set_real_ip_from <CIDR tepercaya>` di Nginx saja.

**Jebakan yang dijaga:**

| Jebakan | Akibat | Penjagaan |
|---|---|---|
| **Semua klien terbaca satu IP** (aplikasi memakai alamat kontainer Nginx; atau Nginx melihat alamat gateway Docker karena `userland-proxy`/IPv6 tanpa `ip6tables`/jaringan `bridge`) | Satu penyerang atau satu outlet memblokir **semua** pengguna (batas per IP jatuh ke satu kunci) | App wajib membaca `X-Real-IP`; Nginx harus melihat IP asli (mis. `network_mode: host` untuk proxy atau konfigurasi IPv6 Docker yang benar); **uji asap saat deploy**: permintaan dari luar harus terbaca dengan IP-nya sendiri, bukan IP gateway/kontainer (`RSK-A24`) |
| **Memercayai `X-Forwarded-For` dari klien** | Penyerang memutar IP palsu untuk lolos dari batas | Header ditimpa Nginx; app tidak membaca XFF; uji: header palsu dari luar tidak mengubah IP terbaca |
| **Satu outlet/daerah = satu IP publik (NAT/seluler/CGNAT)** — banyak staf, kasir, dan device berbagi IP yang sama (keputusan user 2026-11-19) | Batas per IP menghukum seluruh outlet; satu orang salah ketik dapat menunda rekannya | **IP bukan kunci utama**: API terautentikasi per `device_id`; login admin per **akun global / email lintas slug** (IP hanya jaring longgar bernilai tinggi, per IP + slug); batas Nginx per IP longgar. Efek sisa yang diterima: **enroll** >10 device dalam 5 menit dari satu IP menunggu (nilai `RL_*` dapat dinaikkan saat onboarding outlet) |

#### 6.9.2 Kunci pembatasan

| Jenis endpoint | Kunci |
|---|---|
| **API device terautentikasi** (`push`, `pull`, `ping`, `signals`, `device-log`, serah-terima, `invoice`) | **`device_id`** (**bukan** IP) |
| **Tanpa login**: `POST /enroll`, `POST /join`/`POST /reset` (kode), penebakan slug/halaman pemilih | **IP + slug** (dan per slug saja untuk `enroll`, §6.9.3) |
| **Login admin** (revisi 2026-11-19, identitas global) | **Kunci utama: akun global** — jeda progresif, **tanpa IP**, **tanpa slug**: satu kata sandi untuk semua tenant orang itu, sehingga satu hitungan per akun (memakai kunci `slug + email` akan melipatgandakan jatah tebakan sebanyak slug yang ditebak penyerang). Kunci akun = `auth_user_id` bila email terdaftar, atau **hash email ternormalisasi** bila tak ada (anti-enumerasi, hitungan seragam). **Bukan anggota tenant** pada slug itu diperlakukan sebagai kegagalan biasa (satu hitungan, satu pesan generik; §6.2). Lapis tambahan: **per slug** (semprot kata sandi lintas akun) dan **per IP + slug** (jaring pengaman **longgar**, angka tinggi, banjir/pemindaian) |
| **`/admin` terautentikasi** (laporan berat; penerbitan kode undangan/reset) | **`tenant_id`** (bersamaan), pengguna, dan `tenant + email` (penerbitan kode) |
| **`/platform`** | IP (batas umum Nginx) + akun platform |
| Endpoint publik (`/health`, slug tak dikenal) | Tanpa batas khusus; hanya batas umum per IP di Nginx |

#### 6.9.3 Batas (nilai awal)

| Titik | Batas awal | Perilaku |
|---|---|---|
| **Nginx umum** (per IP) | API/halaman: ±50 r/dtk, `burst` 100; jalur tanpa login: ±5 r/dtk, `burst` 10; koneksi bersamaan ±50 per IP (SSE zona terpisah) | `429`; mencegah banjir dan **menopang perlindungan penebakan slug** (batas umum **tetap ada**, SCHEMA slug) |
| **Login admin — progresif per akun global (kunci utama)** | Kegagalan 1–3: tanpa jeda; ke-4: 30 dtk; ke-5: 1 mnt; ke-6: 2 mnt; ke-7: 5 mnt; ke-8 dan seterusnya: 15 mnt (maks.); hitungan direset setelah login sukses atau 15 mnt tanpa kegagalan. Selama jeda, percobaan **ditolak tanpa memverifikasi kata sandi** | **Tanpa penguncian akun permanen** (tidak ada kunci yang tak bisa lepas sendiri). **Konsekuensi jujur karena kunci tanpa IP:** siapa pun, dari mana pun, yang mengetahui email dapat menunda pemilik akun hingga 15 menit selama ia terus gagal — **di semua tenant orang itu**, karena akun global; celah di §6.9.10, **diterima tanpa mitigasi** (keputusan user 2026-11-19, OQ-A27 terjawab opsi D). Pesan perkiraan menit: **"Coba lagi dalam sekitar N menit"** (kunci i18n `{menit}`), sama untuk akun ada maupun tak ada (anti-enumerasi, §9.7.3) |
| **Login admin — per slug (semprot kata sandi lintas akun)** | ±100 kegagalan / 15 mnt untuk satu slug (semua akun) | Bukan blokir: slug masuk **mode waspada** 15 mnt — log `warn`, jadwal progresif per akun dimulai lebih dini (jeda sejak kegagalan ke-2), kegagalan dijawab dengan tarpit tetap ±2 dtk; login yang **benar** tetap lolos bila akunnya tak sedang dalam jeda. `DIUSULKAN`; nilai dikalibrasi (`OQ-A26`) |
| **Login admin — per IP + slug (jaring pengaman longgar)** | ±100 kegagalan / 15 mnt per IP **dan** slug → jeda 15 mnt | **Bukan kunci utama** — hanya menahan banjir/pemindaian dari satu sumber; angka sengaja tinggi karena satu daerah/outlet dapat berbagi IP (§6.9.1). Di atasnya Nginx menahan laju kasar per IP |
| **Ukuran penyimpanan hitungan login** | Hitungan nama akun palsu **dibatasi**: masukan dinormalisasi lalu dipotong ≤ 64 karakter dan di-hash; maks. ±10.000 kunci aktif di memori (kedaluwarsa 15 mnt; penuh ⇒ yang terlama dibuang lebih dulu, akun nyata dengan jeda aktif dipertahankan) | Mencegah memori membengkak oleh nama acak; banjirnya sendiri ditahan Nginx dan batas per IP + slug |
| **`POST /enroll`** | **10 / 5 mnt per IP** **dan** **±30 / 5 mnt per slug** | Penyerang terdistribusi (banyak IP) tetap tertahan oleh batas per slug; kode 32⁸ ≈ 1,1×10¹², 15 mnt, sekali pakai |
| **`POST /join` dan `POST /reset` (penukaran kode, satu langkah; dua halaman terpisah)** | **Per email dalam slug (kunci `slug + email`): ±5 percobaan gagal / 15 mnt**; **per slug: ±30 / 5 mnt**; per IP + slug: **10 / 5 mnt** (jaring) | Penghitung **di memori** (pembatas §6.9.4), **tanpa kolom percobaan di `member_code`**; lewat batas ⇒ ditolak sementara 15 mnt dengan respons seragam (kode **tidak** dihanguskan: entropi 32¹⁰ ≈ 1,1×10¹⁵, berlaku ≤ 72/24 jam, sekali pakai; hilangnya penghitung saat restart diterima, §6.9.5). **Terbit ulang/batalkan undangan mereset penghitung `slug + email`** (relief bagi penerima yang terblokir; penyerang tak dapat memicunya karena butuh sesi owner). Penukaran untuk **akun yang sudah ada** juga menghitung pada **kunci login akun global** (progresif) agar bukan jalur tebak kata sandi |
| **Penerbitan kode di `/admin`** (`createInvite`, `reissueInvite`, `issueResetCode`; DOQ-26) | **Per tenant: ±20 penerbitan / jam**; **per `tenant + email`: ±5 / jam** (kunci pembatas aplikasi, pengguna terautentikasi — bukan IP) | Mencegah spam kode dan **inflasi `auth_account_membership_count` lintas tenant** pada email yang sama; lewat batas ⇒ `RATE_LIMITED` dengan pesan menit (jalur terautentikasi, pesan boleh spesifik); `listPendingInvites` dan `cancelInvite` hanya tunduk batas umum |
| **Penebakan slug / halaman pemilih** | per IP + slug ±60 / 5 mnt (di atas batas Nginx) | 404 seragam; tidak membocorkan slug |
| **Credential device salah** (sebelum autentikasi) | ±30 / 5 mnt per IP | `429` |
| **API device (per `device_id`)** | `push` ±60 req/mnt; `pull` ±30 req/mnt; `ping` ±30 req/mnt; serah-terima ±30 req/mnt; `device-log` ≤ 20 laporan / 10 mnt (kelebihan **dibuang**, BR-LOG-010) | `429` + `Retry-After` berjitter (kecuali `device-log`) |
| **Full resync** | **maks. 1 per jam per device** | `429` + `Retry-After`; klien tetap memakai katalog lama |
| **SSE** | **satu koneksi aktif per device**; koneksi baru **menggantikan** yang lama | Mencegah penumpukan koneksi |
| **Banjir push (server)** | Batas pemrosesan push **bersamaan** (semafor global ≤ ukuran pool transaksi push, ±8; satu request aktif per device) | Kelebihan ⇒ `429` + `Retry-After` berjitter (±2–10 dtk) |
| **Laporan berat `/admin`** | **±2 bersamaan per tenant** + `statement_timeout` | Berlebih diminta menunggu ("Laporan lain sedang diproses, coba lagi sebentar") |
| **Kuota per tenant** | **Tidak ada di MVP** (hanya per device) | Risiko "tetangga berisik" **diterima** (`RSK-A23`) |
| **`/platform`** | Akun platform terpisah + batas umum Nginx; **tanpa pembatasan IP** | Membatalkan butir lama "pembatasan IP di Nginx"; risiko diterima (`RSK-A22`) |
| **PIN di device** | 5/5 mnt → 5/15 mnt → 15 total (BR-AUT-005) | Lokal (§6.9.6) |

#### 6.9.4 Pustaka pembatas di aplikasi

`DISEPAKATI` (pilihan user): **pustaka pihak ketiga**, menggantikan usulan "buatan sendiri". Final `PERLU KONFIRMASI` **`OQ-A26`**.

| Aspek | Rancangan |
|---|---|
| **Kandidat** | **`rate-limiter-flexible`** — terverifikasi registry 2026-11-18: versi **11.5.0**, lisensi **ISC**, terakhir diperbarui 2026-11-15 (dipelihara aktif). Store **memori** sekarang (`RateLimiterMemory`); store **PostgreSQL/Redis** siap untuk multi-instance kelak (`OQ-A17`); mendukung blokir berdurasi |
| **`VERIFIKASI` sebelum dikunci** | Nama/versi final dan lisensi; pemeliharaan; **kompatibilitas Node 22** (registry tidak mencantumkan `engines`); **kecocokan `server-only`/bundle-guard** (hanya dimuat di `src/server`; ditambahkan ke daftar penanda terlarang bundle `/pos`); **uji dengan jam palsu** (bergantung `Date.now()`: pakai `vi.useFakeTimers`); cara terbaik membangun **jeda progresif** dari primitifnya (blokir + penalti) |
| **Lapisan tipis (`lib`)** | Antarmuka murni di `lib/ratelimit/` (`check(key) → { allowed, retryAfterMs }`, `fail(key)`, `reset(key)`) + **kebijakan jeda progresif** murni (jadwal 30 dtk/1/2/5/15 mnt) yang diuji dengan jam disuntik; adaptor server `src/server/auth/rate-limit/` membungkus pustaka. Mengganti pustaka = mengganti adaptor saja |
| **Better Auth** | Pembatas bawaan **dinonaktifkan** (`rateLimit.enabled = false`) agar tidak ada penghitungan ganda; login dibungkus pembatas kita (§6.2.1) |
| **Perbandingan dengan buatan sendiri ala referensi** | Referensi (`rate-limit.ts`): jendela geser di memori, `hit(key, nowMs)` dengan waktu disuntik. **Kelebihan:** nol dependensi, mudah diuji. **Kekurangan:** memangkas **seluruh** peta pada tiap `hit` (O(jumlah kunci)), tanpa jeda progresif/blokir berdurasi, tanpa store yang dapat diganti (multi-instance), tanpa `msBeforeNext`. **Ditolak** sebagai jalur utama (pilihan user: pustaka); **dipertahankan sebagai cadangan** bila pustaka gagal verifikasi (diadaptasi di belakang antarmuka tipis yang sama) |

#### 6.9.5 Keterbatasan yang diterima

Penghitung di memori proses **hilang saat restart** — **diterima di MVP**: Nginx menahan banjir kasar, dan kode pairing (32⁸, 15 menit, sekali pakai) tahan terhadap reset penghitung. Jalur naik: store PostgreSQL/Redis di pustaka yang sama (`OQ-A17`). Tidak ada kuota per tenant (`RSK-A23`).

#### 6.9.6 PIN di device

Hitungan percobaan **monotonik** (hanya naik sampai reset; dicatat **sebelum** verifikasi, §6.4); jeda dihitung dengan **jam yang tidak dapat dimundurkan lewat tanggal tablet** — tenggat = `max(trusted_now, max_seen_time) + durasi`, dengan `max_seen_time` hanya naik (§4.5, BR-AUT-013) dan penghitung dalam sesi memakai `performance.now()`; **reset total** hanya oleh supervisor/manager (`pin_epoch`, FR-AUT-007). Status dilaporkan ke server saat online (`ReportPinState`) **hanya ketika `lock_tier` berubah** (OQ-S36); jeda dihitung dari `meta.clock.max_seen_time` tanpa kolom baru. **Jujur tentang batasnya:** ini **bukan** perlindungan terhadap penyerang mahir yang memegang perangkat — Dexie dapat diubah lewat devtools; serangan itu dilawan oleh **hash lambat (Argon2id) + HMAC per device**, bukan oleh penghitung (BR-AUT-014, RSK-05).

#### 6.9.7 Banjir sync dan `429`

Server menjawab `429` + `Retry-After` (berjitter). **Sync engine** (§4.2.4/§4.4): mematuhi `Retry-After` (menunggu `max(Retry-After, backoff)`), **tidak menaikkan `attempts`**, **tidak** menjadi `NEEDS_ATTENTION`, dan **tidak** dianggap kegagalan konektivitas (server terjangkau, tidak memicu histeresis OFFLINE). Kelasnya **transien/RETRY**. Pembeda di UI/kode (§9.7.2): `429` dari **pembatas laju** = transien tanpa dialog, sedangkan `RATE_LIMITED` yang tampil kepada pengguna hanya untuk **login/enroll** (pesan menit).

#### 6.9.8 Pencatatan, notifikasi, konfigurasi

Pelanggaran **hanya dicatat log** (`warn`; kunci ditulis sebagai **hash pendek**, bukan nilai asli, BR-LOG-007; field terdaftar `ip`, `outcome`, `errorClass`); **Telegram tetap hanya untuk lonjakan error** (§9.7.10), bukan untuk pelanggaran batas. Nilai batas dari variabel lingkungan `RL_*` (mis. `RL_LOGIN_*` jadwal progresif per akun global (email lintas slug), ambang mode waspada per slug, jaring per IP+slug, batas ukuran hitungan login; enroll per IP/slug; API per device; push bersamaan; laporan per tenant) dan **dikalibrasi dari log** setelah pemakaian nyata.

#### 6.9.9 Pengujian

| Uji | Isi |
|---|---|
| Unit pembatas | **Jam palsu**: jadwal progresif, reset setelah sukses/15 mnt, **tanpa kunci permanen**, kunci **akun global** (akun lain tidak terdampak; **IP berbeda dan tenant lain tetap tertunda** — perilaku yang diterima, §6.9.10), bukan-anggota dihitung sebagai kegagalan biasa dengan pesan identik, mode waspada per slug, batas ukuran hitungan (nama acak > 10.000 tidak membengkakkan memori), pesan menit; adaptor pustaka dengan `useFakeTimers` |
| **Konfigurasi Nginx di CI** | Kontainer Nginx + `curl`: IP terbaca **hanya dari header yang dikirim Nginx** (header palsu dari luar diabaikan); `limit_req` mengembalikan `429` setelah `burst`; SSE tidak terkena `limit_conn` umum |
| Integrasi | Banyak device satu IP tidak saling memblokir (kunci `device_id`); enroll per slug menahan penyerang terdistribusi; full resync 2× dalam sejam ⇒ `429`; SSE kedua menggantikan yang pertama |
| Playwright | `429` + `Retry-After` pada push ⇒ klien menunggu, `attempts` tetap, tidak `NEEDS_ATTENTION`, tidak OFFLINE |
| Asap deploy | Permintaan dari luar terbaca dengan IP-nya sendiri (bukan IP gateway/kontainer) |

#### 6.9.10 Celah sisa login admin tanpa kunci IP (`OQ-A27` **TERJAWAB 2026-11-19: tanpa mitigasi, hanya log**)

Dengan kunci **akun global** (tanpa IP), dua celah **sengaja diterima** dan didokumentasikan jujur. **Keputusan user 2026-11-19 (OQ-A27): opsi (D) tanpa mitigasi, hanya log** (jeda maks. 15 menit); opsi lain dipertahankan di bawah sebagai jejak keputusan dan jalur naik bila celah terbukti mengganggu:

| Celah | Penjelasan | Yang sudah ada | Opsi mitigasi (usulan, belum dipilih) |
|---|---|---|---|
| **G-RL1 — Penundaan pemilik akun oleh pihak luar** | Penyerang dari IP mana pun yang terus salah memasukkan kata sandi untuk akun korban membuat **pemilik sah** menunggu hingga **15 menit** (jeda maks.). Tidak ada penguncian permanen, tetapi penundaan berulang mengganggu operasional back-office (kasir `/pos` tidak terdampak: login PIN lokal dan token device) | Jeda maks. 15 mnt, reset otomatis; Nginx membatasi laju per IP; log `warn`. **Akun global ⇒ penundaan berlaku di semua tenant orang itu** | **(A) Penanda perangkat tepercaya**: cookie bertanda tangan (`HttpOnly; Secure; Path=/`, ±30 hari) diterbitkan setelah login sukses; hitungan jeda **terpisah per akun + penanda** sehingga pemilik di browser biasanya **tidak ikut tertunda** oleh penyerang tanpa penanda (hitungan penyerang tanpa penanda terpisah). Biaya: cookie fungsional baru, rahasia penanda, penanda dicabut saat reset kata sandi, tidak menolong login pertama di browser baru. **(B) Reset jeda oleh owner/manager** (menghapus jeda staf lewat `/admin`; pemilik terkunci diurus operator platform; tunduk pada aturan reset lintas tenant, §6.2.1). **(C) Jeda maks. lebih pendek** (mis. 5 mnt): kerugian korban lebih kecil tetapi tebakan lebih cepat. **(D) Tanpa mitigasi** di MVP (hanya log) — **DIPILIH user 2026-11-19** |
| **G-RL2 — Memori hitungan nama akun palsu** | Penyerang dapat mengirim nama akun acak sebanyak-banyaknya untuk membengkakkan memori hitungan | **Sudah dimitigasi** (§6.9.3): normalisasi + potong ≤ 64 + hash, maks. ±10.000 kunci aktif, kedaluwarsa 15 mnt, pembuangan terlama, batas per IP + slug dan Nginx | Tidak ada tambahan; angka dikalibrasi dari log |

Keputusan: **(D)**. Pemantauan lewat log `warn` (hash pendek) memungkinkan evaluasi ulang setelah pemakaian nyata; **(A)+(B)** menjadi jalur naik bila diperlukan. Bahasa UI tidak membocorkan apakah akun ada (pesan menit sama).

---

## 7. Multi-Device dan Perangkat Keras

### 7.1 Satu logika, tiga kelas perangkat (HP / tablet / desktop)

`DISEPAKATI` (NFR-COMP-002, DESIGN §2.8): satu basis kode responsif — **bukan** tiga aplikasi. Aturan arsitektur (`DIUSULKAN`):

| Aturan | Isi | Mencegah |
|---|---|---|
| **Domain tanpa UI** | Logika kasir berada di `src/pos/usecases/*` (fungsi/kelas murni terhadap Dexie + kernel; tanpa React, tanpa DOM): `addItem`, `setQty`, `applyDiscount`, `pay`, `finalize`, `openShift`, `closeShift`, `createReturn`, `voidSale`, `openBill`, `addBillItem`, `splitBill`, `mergeBill`, `handOver`, … Mengembalikan hasil terstruktur (sukses / alasan penolakan sebagai kode) | Duplikasi aturan bisnis per tata letak; menguji aturan tanpa merender layar |
| **Hook sebagai jembatan** | `src/pos/hooks/use-*.ts` membungkus use case + `liveQuery` menjadi state reaktif (`useCart`, `usePaymentState`, `useShift`, `useCatalogSearch`, `useSyncState`) | Komponen tidak menyentuh Dexie/kernel langsung |
| **Presenter vs layout** | Komponen layar dibagi: *container* (memanggil hook) dan *presenter* (props → JSX) yang sama dipakai semua kelas perangkat; **tata letak** dipilih dengan CSS (breakpoint Tailwind `sm/md/lg/xl`, varian `portrait:/landscape:`, `pointer-coarse:/pointer-fine:`) | Tiga versi layar yang menyimpang |
| **Fitur, bukan platform** | Deteksi **kemampuan** (`'usb' in navigator`, `navigator.bluetooth`, `BarcodeDetector`, `matchMedia('(hover: hover)')`, `navigator.storage`) lewat satu `capabilities` service; **tidak ada UA sniffing** | Cabang `if (isAndroid)` tersebar dan rapuh |
| **JS untuk perilaku, CSS untuk bentuk** | Hanya perbedaan perilaku (panel keranjang ↔ *bottom sheet* di < `lg`; rail ↔ bottom nav) yang memakai `useMediaQuery` yang sama dengan breakpoint token | Layout shift dan hidrasi tak konsisten |
| **Pintasan keyboard** | Lapisan `useShortcuts` diaktifkan hanya bila ada keyboard fisik/`(hover: hover)`; mengabaikan burst pemindai dan kolom numerik/PIN aktif (DESIGN §7.3, DOQ-16) | Pintasan terpicu oleh pemindai |
| **Uji lintas ukuran** | Playwright memuat skenario kasir di viewport DOQ-06: 360×800, 800×1280, 1280×800, 1366×768 (+ zoom 200%); tes domain tidak bergantung viewport | Regresi responsif |

### 7.2 Arsitektur cetak (AD-18)

`DISEPAKATI`: satu antarmuka printer, banyak adapter (WebUSB, Web Bluetooth BLE, `window.print` + `--kiosk-printing`); cetak **asinkron** dan tidak menghalangi checkout; kegagalan cetak tidak menggagalkan penjualan; cetak ulang selalu tersedia; struk = teks ESC/POS + logo bitmap ter-cache; **kecepatan cetak = prioritas user** (BR-PRN-001…003, AP-10, NFR-PERF-002).

```
 Dokumen tersimpan (Dexie)         ┌───────────── pos/printing ─────────────────────────────────────────────────────────┐
 sale / credit_note / bill / shift │                                                                                    │
        │  print_job(QUEUED) ──────►  PrintQueue (instance aktif; 1 pekerja per printer)                               │
        ▼                          │      │ ambil job → ReceiptBuilder(dokumen, receipt_locale, outlet_receipt_setting) │
 ReceiptDoc  (representasi antara, │      ▼                                                                            │
  printer-netral: teks/rata/baris/ │  ReceiptDoc ──► Encoder ──► EscPosEncoder(profil) ──► Uint8Array ──┐              │
  pemisah/logo/pemotong/laci)      │                       └──► HtmlPrintEncoder ──► DOM @page 58/80mm ─┤              │
                                   │                                                                     ▼              │
                                   │  PrinterAdapter  ◄── WebUsbAdapter │ WebBluetoothAdapter │ BrowserPrintAdapter   │
                                   └──────────────────────────────────────┬─────────────────────────────────────────────┘
                                                                          ▼  perangkat (USB / BLE / driver OS)
```

**Antarmuka printer** (kontrak; ilustrasi bentuk, bukan kode final):

```
interface PrinterAdapter {
  readonly kind: 'webusb' | 'webbluetooth' | 'browser-print'
  readonly capabilities: { paperWidthMm: 58|80, columns: 32|48, canCut, canOpenDrawer, supportsNvLogo,
                           maxWriteBytes, writePacingMs, codePage }
  state(): 'UNPAIRED' | 'DISCONNECTED' | 'READY' | 'BUSY' | 'ERROR'
  connect(opts: { userGesture: boolean }): Promise<void>      // izin persisten dipakai bila ada
  print(job: { bytes?: Uint8Array; doc?: ReceiptDoc }): Promise<PrintResult>   // HTML adapter memakai doc
  openDrawer(): Promise<void>                                   // tidak didukung oleh browser-print
  status(): Promise<{ online, paperOut?, coverOpen? }>          // bila printer mendukung DLE EOT
  disconnect(): Promise<void>
}
```

| Bagian | Keputusan | Alasan / trade-off |
|---|---|---|
| **Representasi antara `ReceiptDoc`** | `ReceiptBuilder` (murni) menghasilkan daftar node (`text`, `row(kiri,kanan)`, `sep`, `image(logoRef)`, `qr`, `feed`, `cut`, `drawer`) dari dokumen tersimpan + `receipt_locale` + `outlet_receipt_setting`; label dari kamus i18n, angka via `kernel/format` | Satu sumber isi untuk **dua** keluaran (ESC/POS dan HTML kiosk); kegagalan encoder tak mengubah isi; golden-test pada IR dan pada byte |
| **Encoder ESC/POS sendiri** | Modul kecil `escpos/` (init `ESC @`, pemilihan code page, rata, tebal, ukuran ganda, `GS v 0` raster, `GS V` potong, `ESC p` pulsa laci); **tanpa pustaka pihak ketiga** | Permukaan kecil dan stabil; menghindari dependensi bermasalah di bundle `/pos`; diuji dengan **vektor byte emas** (Contoh 1 BR-PRN-007, struk ber-diskon, retur, pra-bill). Dialek khusus per model ditangani lewat profil printer (OQ-A04, dikoreksi 2026-11-18) |
| **Teks, bukan HTML→gambar** | `DISEPAKATI` (BR-PRN-003); logo = bitmap raster ter-cache (`asset_cache`) | Kecepatan; konsistensi; transliterasi ke ASCII bagi karakter di luar code page (BR-I18N-008) |
| **Logo & kecepatan** | Raster logo besar lambat di BLE. Rekomendasi: simpan logo ke **memori NV printer** saat setup (`FS q`/`GS ( L`) dan cetak dengan `FS p` bila `supportsNvLogo`; selain itu kirim raster ter-cache | NFR-PERF-002 (mulai kirim ≤ 1 dtk). Bergantung model; ditentukan per profil printer |
| **Konfigurasi printer per register** | Disimpan **lokal** di `meta.printer` (adapter, id perangkat, profil model, lebar kertas, code page, potong, laci); **bukan** master tersinkron. Yang tersinkron hanya kustomisasi struk outlet (logo, header, footer, bahasa) dan `paper_width_mm` register | Pilihan perangkat keras bersifat milik perangkat; FR-PRN-006 |
| **Waktu & kamus di cetakan** | Builder **tidak** memanggil `Date.now()`; waktu cetak = waktu dokumen (zona outlet); cetak ulang ⇒ node tambahan `"CETAK ULANG"` dan kontennya **identik** dengan cetakan pertama (locale = `sale.receipt_locale`, BR-I18N-007). Header/footer/logo diambil dari pengaturan outlet **saat cetak** (tidak di-snapshot) — **keputusan user (OQ-A08, 2026-11-18): cukup bahasanya yang sama** | "Cetak ulang identik" menurut PRD hanya mewajibkan bahasa yang sama |

**Antrean cetak asinkron** (`print_job`, SCHEMA §4.6.9):

| Aspek | Keputusan |
|---|---|
| Pemilik | **Instance aktif** saja (akses USB/BLE eksklusif per tab); satu pekerja per printer (kunci `print:{printerId}`) |
| Pemicu | Dibuat dalam **transaksi finalisasi** (`QUEUED`); `PrintQueue.kick()` setelah commit; pekerja juga berjalan saat boot (`PRINTING` yang tertinggal ⇒ `QUEUED`) |
| Alur job | `QUEUED → PRINTING → DONE` atau `FAILED`; percobaan ulang otomatis **3×** (1/3/5 dtk) untuk `DISCONNECTED/TIMEOUT`; `NO_PRINTER`/`ENCODE_ERROR` langsung `FAILED` |
| Urutan | FIFO per printer; pulsa laci diantrikan **sebelum** teks struk bila pembayaran tunai (laci terbuka seketika) |
| Kegagalan | Tidak mengubah penjualan; chip `print_failed` + tombol **Cetak ulang** (DESIGN §5.2 #18); entri `device_log` (`PRINT_FAILED`) ikut sync; job `FAILED` dipertahankan sampai dicetak ulang/diabaikan |
| Cetak ulang | Membuat job `REPRINT` baru dari dokumen tersimpan; tersedia untuk semua dokumen di riwayat lokal (FR-PRN-004). Risiko diterima: bila printer putus di tengah cetakan, percobaan ulang dapat menghasilkan struk ganda/terpotong (tak ada konfirmasi cetak dari perangkat) |
| Jenis | `RECEIPT`, `REPRINT`, `PREBILL`, `SHIFT_RECAP`, `CASH_DRAWER`, `TEST` |
| Kinerja | Teks ≤ 2 KB ⇒ pengiriman USB ≪ 200 ms; **jaga koneksi tetap hangat** (BLE GATT terhubung, USB `claimInterface` terbuka) agar tak ada ongkos `connect` di jalur cetak; logo raster/NV dihitung sebelumnya |

**Izin perangkat persisten dan koneksi ulang:**

| Teknologi | Izin | Koneksi ulang tanpa gesture |
|---|---|---|
| WebUSB | `navigator.usb.requestDevice()` (butuh **gesture** sekali di SCR-P16); izin diingat per origin; `navigator.usb.getDevices()` mengembalikan perangkat yang sudah diizinkan | Ya: `getDevices()` → `open()` → `claimInterface()`; mendengarkan event `usb connect/disconnect` |
| Web Bluetooth (BLE) | `navigator.bluetooth.requestDevice()` (gesture); izin persisten bergantung dukungan `navigator.bluetooth.getDevices()` pada versi Chrome/Edge target — **`VERIFIKASI` (spike F3)** | Bila tersedia: `getDevices()` → `gatt.connect()`; bila tidak: status `NEEDS_PAIRING` dan job menunggu hingga pengguna mengetuk "Hubungkan printer" |
| `window.print` | Tidak ada izin perangkat; printer = printer bawaan OS | Selalu siap |

**Batasan platform (RSK-07, BR-PRN-004):**

| Platform | WebUSB | Web Bluetooth | `window.print` kiosk |
|---|---|---|---|
| **Android (Chrome)** | Didukung; printer thermal USB-OTG umumnya dapat di-claim (tanpa driver OS) | **Hanya BLE** (printer Bluetooth klasik/SPP **tidak** didukung) | Tidak ada `--kiosk-printing` |
| **Windows (Chrome/Edge)** | Sering **terkunci driver bawaan** (kelas printer): perlu driver **WinUSB** (mis. lewat Zadig) agar dapat di-claim | BLE didukung (Windows 10/11) | **Fallback utama**: `--kiosk-printing` + printer bawaan thermal (driver OS); struk dirender HTML `@page { size: 80mm auto; margin: 0 }` |
| Keduanya | HTTPS wajib; hanya Chromium | — | Laci kas **tidak** dapat dipicu lewat `window.print` kecuali driver printer disetel "buka laci sebelum/ sesudah cetak" |

**Pemasangan kiosk-printing (Windows):** pintasan Chrome/Edge dengan `--kiosk-printing --app=https://<domain>/<slug>/pos/` (+ profil khusus kasir), printer bawaan diatur ke printer thermal; `HtmlPrintEncoder` menghasilkan dokumen monospace berlebar kertas; **tidak** ada dialog cetak. Edge (Chromium) mendukung flag yang sama `VERIFIKASI`. Ini dicantumkan di panduan perangkat.

### 7.3 Cash drawer

`DIUSULKAN` (BR-PRN-006): laci dipicu **lewat printer** (konektor RJ11) dengan pulsa `ESC p m t1 t2`; otomatis saat pembayaran **tunai** (job `CASH_DRAWER` mendahului struk); pembukaan manual tanpa transaksi butuh permission `drawer.open` dan ditulis ke audit (`drawer.opened_manual`, via `AppendAudit`). Pada adapter `browser-print` laci tidak didukung (status `canOpenDrawer=false`; UI menyembunyikan tombolnya). Kegagalan membuka laci tidak menggagalkan apa pun.

### 7.4 Barcode scanner (keyboard wedge)

`DISEPAKATI` (BR-CAT-007): pemindai USB/Bluetooth berperilaku **keyboard**; deteksi rentetan cepat (< 50 ms antar karakter, parameter `DIUSULKAN`) diakhiri `Enter`. Rancangan modul `pos/scanner/` (`DIUSULKAN`):

```
window keydown (fase capture) ─► ScannerBuffer
   karakter tercetak datang dengan jeda ≤ 50 ms ⇒ tambah ke buffer ; jeda > 50 ms ⇒ buffer lama dibuang (ketikan manusia)
   Enter ⇒ bila panjang buffer ≥ 4 dan seluruh karakter datang dalam burst ⇒ SCAN(code) ; selain itu ⇒ abaikan
SCAN ──► use case addByBarcode(code) ──► lookup sku_uom.&barcode ──► ketersediaan efektif ──► harga ──► keranjang
```

| Isu | Keputusan |
|---|---|
| Karakter awal bocor ke kolom fokus (karakter pertama baru ketahuan "burst" setelah karakter kedua) | Bila **tidak ada** kolom teks berfokus (kasus normal): semua karakter printable ditelan (`preventDefault`) dan ditahan 50 ms; bila hanya 1 karakter dan tak ada karakter lanjutan ⇒ dilepas sebagai ketikan. Bila kolom pencarian berfokus: burst yang diakhiri `Enter` dianggap scan dan isi yang diketik burst **dihapus** dari kolom |
| Kolom numerik/PIN/kuantitas aktif | Pemindaian **diabaikan** (DESIGN §7.3 butir 1) agar tidak mengacaukan input |
| Pintasan keyboard | Karakter burst tidak diteruskan ke handler pintasan |
| Pindai ganda (key repeat/double-trigger) | Kode identik dalam ≤ 150 ms diabaikan; pemindaian berulang yang disengaja lebih lama menaikkan qty baris yang ada (FLOW-04 langkah 2) |
| Keyboard virtual di tablet | Kolom scan memakai `inputmode="none"`; keyboard virtual hanya bila pengguna mengetuk kolom (DESIGN §5.4) |
| Terminator selain `Enter` (Tab) | Profil pemindai di SCR-P16 (terminator, panjang minimum, awalan/akhiran dibuang) disimpan di `meta.scanner` |
| Umpan balik | **Visual saja** (DOQ-10): baris keranjang berkedip sekali + wilayah `aria-live` ("Kopi Bubuk 200g, 2"); barcode tak dikenal vs tak tersedia di outlet memakai pesan berbeda (BR-CAT-006/015) |
| Kinerja | Lookup `&barcode` ≤ 50 ms (NFR-PERF-003) |

### 7.5 Kamera sebagai pemindai

`DISEPAKATI` (BR-CAT-007, FR-POS-002): **`BarcodeDetector`** + polyfill WASM bila tidak tersedia.

| Aspek | Keputusan |
|---|---|
| Deteksi dukungan | `'BarcodeDetector' in window` dan `getSupportedFormats()` mencakup EAN-13/EAN-8/Code128/QR; Chrome Android umumnya mendukung; **Chrome di Windows desktop mungkin tidak** ⇒ polyfill diperlukan di sana `VERIFIKASI` (spike F3) |
| Polyfill | `barcode-detector` (ponyfill; mesin `zxing-wasm`) dimuat **malas** hanya saat kamera dibuka dan API native tidak ada; berkas WASM **ikut precache** (agar bekerja offline) tetapi **di luar anggaran muat awal**; ukuran dicatat dalam anggaran precache 2,5 MB (`RSK-A05`) |
| Alur | `getUserMedia({ video: { facingMode: 'environment' } })` → `requestVideoFrameCallback` → `detect()` ≈ 5–10 fps → dedupe (kode sama < 1,5 dtk) → `addByBarcode` yang sama dengan wedge |
| Izin | Izin kamera diminta saat pertama dipakai (gesture), diingat per origin; ditolak ⇒ pesan + tautan pengaturan, wedge tetap berfungsi |
| Daya/pelepasan | Aliran kamera **dihentikan** saat dialog ditutup/tab tersembunyi (hemat baterai) |

---

## 8. Struktur Direktori Proyek (blueprint — jangan dibuat)

> Referensi **utama**: `D:\React\Tanstack router\financeDashboard` (dibaca saja). Yang dibaca: `package.json`, `CLAUDE.md` (arsitektur berlapis, aturan emas, logging, env, rilis), `docs/project-structure.md` (peta folder + tabel "file baru ditaruh di mana" + penjaga otomatis), `eslint.config.js` (layering lewat `no-restricted-imports`), `vite.config.ts`, `vitest.config.ts` (proyek `unit`/`db`), `tsconfig.json`, `src/**` (routes → queries → functions → server/{services,repo} → lib), `scripts/**` (ops, release, env, logs-find). Bab ini hanya **rancangan**; tidak ada folder yang dibuat.

### 8.1 Pohon blueprint

```
solva-pos/
├─ docs/                          PRD.md · SCHEMA.md · DESIGN.md · ARCHITECTURE.md (+ catatan keputusan kelak)
├─ drizzle/                       migrasi SQL: hasil drizzle-kit + migrasi KUSTOM (RLS FORCE, trigger, EXCLUDE, GRANT, view, fungsi)
├─ docker/                        nginx.conf (+ certbot) · init-roles.sql (solva_owner/solva_app/solva_report) · contoh env
├─ scripts/                       local.mjs (muat env dev) · db-migrate.ts · logs-find.ts · seed/ · ops/ (env-check, health-check)
│                                 · lib/ (aturan env/versi, .mjs murni+tes) · ci/ (bundle-guard, rls-catalog-check)
│                                 · deploy/ (susun image dari tag bersih; uji kunci lokal) · release/ (versi dari commit, CHANGELOG, catatan rilis)
│                                 · ops/ (deploy: backup bersyarat → migrasi → ganti kontainer → tunggu /health → rollback otomatis)
├─ (volume server) sourcemaps/    <appVersion>/*.map — PRIVAT, bukan bagian direktori publik; diisi skrip deploy dari artefak rilis (§9.7.9)
├─ docs/releases/                 vX.Y.Z.md — catatan rilis, wajib "Perubahan angka" bila memengaruhi pajak/pembulatan/HPP/kas
├─ tests/                         integration/ (*.int.test.ts, proyek `db`) · e2e/ (Playwright, offline) · fixtures/ · empty-module.ts
├─ public/                        ikon PWA · recovery.html (halaman pemulihan statis, tanpa bundle utama; §9.7.6)
├─ Dockerfile · compose.yaml · .env.example · dependency-cruiser.cjs · eslint.config.js · vite.config.ts · vitest.config.ts
├─ playwright.config.ts · drizzle.config.ts · tsconfig.json · package.json (versi di-pin)
└─ src/
   ├─ routes/                     __root.tsx · index.tsx (404, bukan pengarah) · $tenant.tsx (resolver tenant + pencocokan slug↔sesi/token) · $tenant/index.tsx (pemilih "Terminal Kasir"/"Back-office") · $tenant/join.tsx · $tenant/reset.tsx (publik, SSR, penukaran kode satu langkah; tanpa guard sesi)
   │  │                            · $tenant/admin.tsx (layout SSR + guard sesi) · $tenant/pos.tsx (layout ssr:false + guard Dexie) · platform/… (admin platform)
   │  ├─ admin/…                  SCR-A01…A10 (login, dashboard, produk, harga, ketersediaan, stok, pengaturan, pengguna/device, perlu-perhatian, meja)
   │  ├─ pos/…                    SCR-P01…P16 (pairing, staf+PIN, shift, kasir, meja, bill, split/merge, bayar, selesai, riwayat, retur, kas, tutup, antrean sinkron, sistem, perangkat)
   │  └─ api/                     route server TIPIS: pos/v1/{enroll,push,pull,pull-full,ping,signals,device-log,bill-*,invoice,assets,release}.ts · health.ts
   ├─ components/
   │  ├─ ui/                      primitif bebas-domain (Button, Input, Dialog, Chip, DataTable, Numpad…) — CMP-01…34; shadcn/ TIDAK dipakai
   │  ├─ layout/                  AdminShell, PosShell (top bar, rail/bottom-nav, slot banner), SyncIndicator, Banners
   │  ├─ admin/<layar>/           komponen per layar /admin (produk, harga, availability, stok, perhatian, device…)
   │  └─ pos/<layar>/             komponen per layar /pos (kasir, keranjang, bayar, shift, retur, bill, meja, antrean…)
   ├─ hooks/                      hook lintas area (use-lang, use-media-query, use-shortcuts, use-capabilities…)
   ├─ queries/                    queryOptions TanStack Query untuk /admin + bagian online-only /pos; keys.ts (qk)
   ├─ functions/<modul>/          *.fn.ts (createServerFn) — pintu RPC /admin; middleware.ts (authMiddleware, publicErrorMiddleware)
   ├─ pos/                        SELURUH logika klien /pos (tanpa server)                                     ← menyimpang dari referensi
   │  ├─ db/                      instance Dexie, definisi versi + upgrade (migrasi), tipe store
   │  ├─ data/                    repo Dexie per modul (catalog, sales, shift, fnb, outbox, meta…) — satu-satunya penyentuh store
   │  ├─ usecases/<modul>/        use case murni (addItem, finalize, openShift, createReturn, handOver…) — tanpa React/DOM
   │  ├─ hooks/                   use-cart, use-shift, use-catalog-search, use-sync-state… (jembatan liveQuery ⇄ komponen)
   │  ├─ session/                 PIN (worker Argon2id), lease, jam tepercaya, kunci layar, supervisor override
   │  ├─ sync/                    scheduler, connectivity, pusher, puller, applier, snapshots, signals(SSE), clock, update-manager, log-shipper
   │  ├─ printing/                receipt-builder (ReceiptDoc), escpos/, html-print/, adapters/{webusb,webbluetooth,browser-print}, print-queue
   │  ├─ scanner/                 wedge-buffer, camera (BarcodeDetector + ponyfill malas)
   │  ├─ locks/                   Web Locks (instance, sumber daya) + BroadcastChannel
   │  └─ maintenance/             retention (pruning), export-pending, storage (persist/estimate), device-log
   ├─ pwa/                        sw.ts (Workbox injectManifest), register.ts
   ├─ modules/                    MODUL DOMAIN SERVER (modular monolith, BR-ARC-002) — satu folder per modul
   │  ├─ identity/                tenant, entitas hukum, outlet, register, device, user, role, PIN, otorisasi
   │  ├─ catalog/                 kategori, produk, SKU, UOM, harga, ketersediaan, modifier, resep (definisi)
   │  ├─ sales/                   sale, diskon/pajak/pembayaran (penyimpanan), invoice & seri, gap, retur/nota kredit, pemulihan register
   │  ├─ shift/                   shift, kas masuk/keluar, blind count, rekap
   │  ├─ inventory/               ledger, saldo, HPP, GR, transfer, opname, konsumsi resep
   │  ├─ fnb/                     meja, bill, event bill, lease, serah-terima, split/merge
   │  ├─ sync/                    tenant_sync (stamp+notify), feed registry, push pipeline, idempotency, attention, flag, app_release
   │  ├─ audit/                   audit_log + rantai hash
   │  └─ reporting/               read model/view R-01…R-04 (baca-saja)
   │       └─ (tiap modul:)       public.ts (ANTARMUKA PUBLIK server) · shared.ts (ekspor ISOMORFIK: tipe + domain murni, aman bagi klien) · domain/ (murni, isomorfik) · server/{schema.ts,*.repo.ts,*.service.ts,commands/*.ts,feed.ts} · *.test.ts
   ├─ server/                     INFRA server (bukan modul bisnis)
   │  ├─ db/                      pool pg, withTenant + TenantTx (AD-05), helper kunci/urut, tipe uang bigint
   │  ├─ auth/                    konfigurasi Better Auth (pembatas bawaan dimatikan), device-auth, getAuthContext
   │  │  └─ rate-limit/           adaptor pustaka pembatas (kandidat rate-limiter-flexible, OQ-A26), pembacaan IP dari X-Real-IP, semafor push/laporan (AD-40)
   │  ├─ notify/                  notifikasi Telegram (antrean dalam memori, asinkron, pemutus sirkuit, batas frekuensi; bukan titik gagal; §9.7.10)
   │  ├─ logging/                 DISALIN pola referensi: logger-core, log-context, log-fields, request-id, request-log, error-serializer, file-destination, log-search, log-time, process-handlers
   │  ├─ composition.ts           wiring: daftarkan CommandHandler & FeedSource tiap modul ke modul Sync (inversi dependensi)
   │  └─ env.ts · log.ts · public-error.ts · error-classify.ts · health.ts · health-core.ts · context.ts
   ├─ lib/                        LOGIKA MURNI (tanpa DB, tanpa React, tanpa DOM-spesifik)
   │  ├─ kernel/                  money · qty · rounding(LR) · ids · time(business_date) · numbering · format      ← PAKET BERSAMA #1
   │  ├─ sales-calc/              diskon · SC · pajak · pembulatan tunai · alokasi · split · retur · kas shift        ← PAKET BERSAMA #2
   │  ├─ contracts/               Zod: amplop API, perintah (per schema_version), event, hasil ACK, kode error, enum, migrator ← PAKET BERSAMA #3
   │  ├─ core/ (app-env, base-path?, i18n-label…) · client-errors/ (skema+reporter laporan error browser) · app-version/ · feature-flags/ (registry + default per flag) · filters/ (skema URL /admin) · table/
   │  │                            (lib/contracts juga memuat migrators/ [klien, maju] dan upcasters/ [server, baca kontrak lama selamanya])
   │  └─ brand.ts · cn.ts · error-message.ts
   ├─ i18n/                       index.ts · locales/{id.json,en.json} · keys.test.ts (kunci sepadan; tak ada string literal UI)
   └─ styles/                     tokens.css (L1/L2 DESIGN Bab 8) · app.css · receipt-print.css (HTML kiosk-printing)
```

### 8.2 Yang meniru `financeDashboard` dan yang menyimpang (beserta alasan)

| Aspek | Referensi | Solva POS | Alasan |
|---|---|---|---|
| Kerangka lapisan | `routes → queries → functions → server/services → server/repo → lib` | **Sama** untuk `/admin` (`routes → queries → functions → modules/<m>/public → service → repo`) | Pola terbukti; jalur baca `/admin` identik dengan referensi |
| Penamaan berkas | `*.fn.ts`, `*.repo.ts`, `*.service.ts`, `*.queries.ts`, `use-*.ts`, `*.test.ts` di sebelah berkas, `PascalCase.tsx`, `kebab-case.ts` | **Sama** | Konvensi `docs/project-structure.md` §6 |
| Alias & TS | `~/*` → `src/*`, TS strict + `noUncheckedIndexedAccess`, versi paket di-pin | **Sama** | — |
| Penanda server | `import '@tanstack/react-start/server-only'` di modul server; alias Vitest ke `tests/empty-module.ts` | **Sama** | Server-only tak masuk bundle klien |
| Penjaga | ESLint `no-restricted-imports` (UI tak boleh impor `~/server`/`drizzle-orm`), `lib` murni, `no-console` di server, tes `sql-guard`, tes `server-function-imports`, tes `keys` i18n | **Sama + ditambah** dependency-cruiser (batas modul, siklus), penjaga bundle `/pos`, tes katalog RLS | PRD AP-12/NFR-MNT-002 menuntut batas modul ditegakkan di CI |
| Logging | pino, `AsyncLocalStorage`, `YYYYMMDD-HHmmss-xxxxx`, `X-Request-Id`, `CODE#id`, field tertutup, file harian, `logs:find` | **Sama**; waktu **UTC** (referensi memakai zona tunggal; Solva punya tiga zona outlet, BR-LOG-003) | KEP-21 |
| Env | `APP_ENV` wajib (development/staging/production), `env.ts` menolak start, daftar kunci env diuji | **Sama** (`DATABASE_URL`, rahasia Better Auth, `LOG_*`) **+ `RL_*`** (nilai batas laju: login, enroll IP/slug, API per device, push bersamaan, laporan per tenant; AD-40) dan `TRUSTED_PROXY_CIDR` (jaringan proxy tepercaya untuk membaca `X-Real-IP`) | Pola aman terbukti |
| i18n | `i18next` + `react-i18next`, `en.json`/`id.json`, `keys.test.ts` | **Sama**; kamus **di-bundle & precache** untuk offline | BR-I18N-003 |
| Token/Tailwind | `styles/tokens.css`, Tailwind v4 | **Sama** (token DESIGN Bab 8); **tanpa shadcn** | DESIGN T-01…T-15 |
| Pengorganisasian domain | **Per lapisan teknis**, satu domain besar dipecah per folder (`services/ap-ar/`, `repo/ap-ar/`) | **Per modul bisnis** di `src/modules/<m>/` dengan `public.ts`; lapisan teknis hidup **di dalam** modul | Aplikasi referensi = satu domain (keuangan) read-only; Solva = banyak domain yang saling memanggil dalam transaksi (BR-ARC-001…012) — batas modul harus eksplisit dan ditegakkan |
| Logika murni | `src/lib/**` (core, finance, format…) | `src/lib/{kernel,sales-calc,contracts}` + `lib/*` pendukung; **`modules/<m>/domain/`** untuk logika murni milik modul yang juga dipakai klien | Dua tingkat kemurnian: paket bersama (tanpa bisnis) vs domain modul |
| Klien offline | Tidak ada (SSR, baca saja) | **`src/pos/`** (Dexie, sync, cetak, scanner, kunci) + `src/pwa/` | Kebutuhan inti Solva |
| Mutasi | Hampir tak ada (baca-saja; satu tulis pengaturan) | Perintah atomik, idempotensi, RLS, `TenantTx`, penulisan master hanya lewat modul Sync (BR-ARC-006) | — |
| Skema DB | Drizzle `pull` dari MySQL ERP; tabel `dash_*` | Drizzle **sumber skema** (`schema.ts` per modul) + migrasi SQL kustom | Solva memiliki DB-nya |
| Pintu klien→server | Server function untuk semuanya | Server function (`/admin`) **+ API HTTP bervers (`/pos`)** | AD-06 |
| Deploy | Paket `.tgz` + installer Node semi-manual (CentOS, systemd, tanpa CI) | **Docker Compose**; **tetap semi-manual** (skrip di komputer user menyusun image dari tag bersih; user menjalankan deploy), **tanpa CI untuk rilis**; rollback aplikasi otomatis bila `/health` gagal | Stack Solva = VPS Docker (PRD §5.1); pola kunci versi, `/health` (503 `degraded`), migrasi additive, rollback, `scripts/deploy` + `scripts/ops` dipertahankan (§9.6.2). Gerbang tes di GitHub Actions bersifat terpisah (OQ-A11/A21) |
| Rilis/versi | Tag git SemVer, `X-App-Version`, `VersionBanner`, `release-it` oleh owner, satu `CLIENT_ID` per klien | **Sama** untuk SemVer/tag/Conventional Commits/CHANGELOG/catatan "Perubahan angka"/`X-App-Version` + `app_release` DB + `UpdateManager` klien; **tanpa `VersionBanner`** (versi hanya di footer login dan pengaturan perangkat); **satu build untuk semua tenant**; **empat nomor versi** | BR-SYN-003; keputusan user 2026-11-18 (§9.6) |
| Feature flag | Satu baris `system_main` (JSON), baca-saja, daftar nama di `lib/feature-flags/registry.ts`, gagal-tutup | Tabel master `tenant_feature_flag` per tenant, ikut counter versi → Dexie; daftar nama + default per flag di `lib/feature-flags/registry.ts` (fail-closed/open per flag) | Per tenant + offline (§9.6.6) |
| Multi-klien (`CLIENT_ID`, prefiks URL **saat build**) | Ya: satu build per klien, proses per klien | **Satu build untuk semua tenant**; tenant di URL **saat runtime** (`/<slug>/…`, segmen `$tenant`) lewat resolver tenant; multi-tenant lewat RLS | KEP-03 (bagian prefiks URL diubah user 2026-11-18); §1.7, RK-17 |

### 8.3 Satu paket (bukan workspace) — keputusan

`DIUSULKAN` (`OQ-A15`): **satu `package.json`**, tiga paket bersama sebagai folder `src/lib/*` dengan aturan lint sendiri — bukan npm workspaces. *Trade-off:* workspace memberi isolasi dependensi nyata dan kemungkinan menerbitkan paket, tetapi menambah konfigurasi bundler/Vitest/TS-references dan versi ganda untuk solo developer; batas folder + lint + dependency-cruiser sudah menjamin "tanpa React/Node" (AP-06) dan satu-deployable (AP-12). Bila kelak kernel dipakai proyek lain, ekstraksi ke workspace hanya memindah folder (impor sudah lewat alias).

### 8.4 Aturan impor antar lapisan

```
 KLIEN (masuk bundle browser)                     SERVER (tak boleh masuk bundle /pos)
 routes ─► components ─► hooks ─► queries          functions ─► modules/<m>/public ─► service ─► repo ─► server/db
              │            │                                          │                               │
              ▼            ▼                                          ▼                               ▼
          pos/hooks ─► pos/usecases ─► pos/data ─► pos/db         lib/* (murni)                    lib/* (murni)
              │              │
              └──────────────┴──► pos/{sync,session,printing,scanner,locks,maintenance}  (infra klien)
 lib/kernel ◄─ lib/sales-calc, lib/contracts ◄─ (semua)        modules/<m>/domain (murni) ◄─ klien & server
```

| Dari ↓ / boleh impor → | `lib/kernel` | `lib/sales-calc` | `lib/contracts` | `modules/*/shared` (domain murni) | `modules/*/public` | `server/*` | `pos/*` | `components/*` | `react`/router |
|---|---|---|---|---|---|---|---|---|---|
| `lib/kernel` | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `lib/sales-calc` | ✓ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `lib/contracts` | ✓ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `modules/<m>/domain` | ✓ | ✓ | ✓ | hanya milik sendiri | ✗ | ✗ | ✗ | ✗ | ✗ |
| `modules/<m>/server` | ✓ | ✓ | ✓ | ✓ (sendiri) | modul **di bawahnya** (arah BR-ARC-004) | ✓ | ✗ | ✗ | ✗ |
| `functions/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (terbatas: auth, log, env) | ✗ | ✗ | ✗ |
| `routes/api/*` | ✓ | ✓ | ✓ | — | ✓ | ✓ (auth, log) | ✗ | ✗ | ✗ |
| `pos/*` | ✓ | ✓ | ✓ | ✓ (hanya via `shared.ts`) | ✗ (tidak boleh mengimpor kode `server/`) | **✗** | ✓ (sesama) | ✗ | `pos/hooks`: ✓ React; lainnya ✗ |
| `components/*`, `routes/*` (UI) | ✓ | ✓ | ✓ | ✓ (via public) | ✗ | **✗** | `pos/hooks` & `pos/usecases` (pos) | ✓ | ✓ |

Arah antar-modul (BR-ARC-004, `DIUSULKAN`, hanya ke bawah; tanpa siklus):

```
 fnb ──► sales ──► shift ──► identity            sync, audit, logging, lib/kernel : dipakai semua; TIDAK bergantung modul bisnis
              ├──► inventory ──► catalog ──► identity            (Sync memanggil modul bisnis HANYA lewat registry/komposisi, bukan impor)
              └──► catalog                                        reporting ──(baca-saja, view terdaftar)──► semua
```

- **Inversi dependensi untuk Sync**: modul Sync mendefinisikan antarmuka `CommandHandler` (per tipe perintah) dan `FeedSource` (per entitas master); tiap modul **mendaftarkan** implementasinya di `server/composition.ts`. Dengan itu modul Sync tidak mengimpor modul bisnis (BR-ARC-004), namun dapat menjalankan `FinalizeSale` dan menyusun feed pull.
- **Feed pull lintas modul**: SQL `UNION ALL` pada SCHEMA §5.2.1 adalah ilustrasi; karena modul **tidak boleh join lintas kepemilikan tabel** (BR-ARC-003), Sync melakukan **k-way merge** hasil `FeedSource.selectKeys(tx, cursor, upper, scope, 500)` tiap modul di dalam transaksi `REPEATABLE READ` yang sama lalu `hydrate(tx, ids)` ke modul pemilik (RK-10). Biaya: puluhan kueri indeks kecil per halaman; target NFR-PERF-006 (≤ 1 dtk/500 baris) diukur di F2.
- **Penulisan master satu pintu** (BR-ARC-006): modul pemilik memanggil `sync.writeMaster(ctx, (w) => …)`; `w` menaikkan `tenant_sync.version`, men-stamp `version` pada setiap baris yang ditulis, dan menerbitkan sinyal pasca-commit. Tes memastikan tidak ada `INSERT/UPDATE` pada tabel kelas M di luar jalur ini.
- **Dua pintu masuk per modul**: `public.ts` = antarmuka publik **server** (fungsi use case yang menerima `TenantTx`/konteks + tipe; hanya diimpor server, `functions/*`, `routes/api/*`, dan modul lain di atasnya); `shared.ts` = ekspor **isomorfik** (tipe + bagian `domain/` murni) yang boleh diimpor klien. Berkas lain di modul = internal.

**Mencegah kode server masuk bundle `/pos` — empat lapis:**

| # | Lapis | Mekanisme |
|---|---|---|
| 1 | Konvensi + penanda | Semua modul `server/` dan `src/server/**` diawali `import '@tanstack/react-start/server-only'` (pengecualian murni seperti referensi: skema Drizzle yang juga dimuat `drizzle-kit`) |
| 2 | **Lint** | ESLint `no-restricted-imports`: `pos/**`, `components/**`, `routes/**` (kecuali `routes/api/**`), `queries/**`, `lib/**` dilarang mengimpor `~/server/**`, `~/modules/*/server/**`, `drizzle-orm`, `pg`, `better-auth` (sisi server), `hash-wasm` di luar `pos/session` dan `modules/identity`; `lib/**` dilarang `react`, `@tanstack/*` |
| 3 | **dependency-cruiser** | Aturan graf: tidak ada jalur dari entri `/pos` ke `server`/`modules/*/server`; tidak ada siklus; impor lintas modul hanya ke `modules/<x>/public` (server) atau `modules/<x>/shared` (isomorfik); tidak ada impor mundur arah BR-ARC-004; `lib/kernel` hanya bergantung `decimal.js`/`uuidv7` |
| 4 | **Penjaga bundle (CI)** | `scripts/ci/bundle-guard`: setelah `vite build`, memindai chunk `/pos` (dari manifest) dan **gagal** bila memuat penanda terlarang (`drizzle-orm`, `node-postgres`, `better-auth/server`, `pino-roll`, string rahasia contoh) atau bila ada chunk `/admin` (recharts, tabel) di grafik impor `/pos`; juga memeriksa ukuran (anggaran §9.3) |

### 8.5 Penegakan otomatis (CI)

| Penjaga | Menegakkan | Rujukan |
|---|---|---|
| ESLint layering (di atas) + `lib` murni + `ui` bebas domain | §8.4 | NFR-MNT-002 |
| dependency-cruiser | Batas modul, arah, siklus, antarmuka publik | BR-ARC-009 |
| Aturan khusus: **dilarang** `Date.now()`, `new Date()` tanpa argumen, `Math.random()`, `crypto.randomUUID` di `lib/kernel`, `lib/sales-calc`, `modules/*/domain` (waktu/acak disuntik) | Determinisme kernel | AP-06 |
| **Dilarang** operator aritmetika float pada kuantitas/uang di luar kernel (aturan ESLint kustom ringan: impor `decimal.js` hanya dari `lib/kernel`) | Disiplin desimal | BR-MNY-001/002 |
| `sql-guard.test.ts` (adaptasi) | SQL hanya di `repo`; parameter terikat; tanpa `SELECT *`; tabel modul lain tak ditulis; tabel kelas M hanya ditulis via `sync.writeMaster` | BR-ARC-003/006 |
| `rls-catalog.int.test.ts` | Tiap tabel bertenant: `ENABLE`+`FORCE` RLS + kebijakan; tabel append-only tanpa UPDATE/DELETE hak | SCHEMA §5.6 butir 9, FR-AUD-001 |
| `pos-data-guard.test.ts` | Store master Dexie hanya ditulis oleh `pos/sync/applier`; `pos/data/*` satu-satunya pemakai `db.<store>` | §5.1 |
| `keys.test.ts` (i18n) + aturan lint "tanpa string UI literal" | Kamus sepadan; tak ada literal | FR-I18N-001/008 |
| `server-function-imports.test.ts` (adaptasi) | Komponen hanya mengimpor server function untuk **mengubah** data | pola referensi |
| `tokens` guard | Tak ada hex/`px` arbitrer di komponen (DESIGN T-01/T-02) | DP-10 |
| `size-limit` + bundle-guard | Anggaran bundle `/pos` dan precache | §9.3 |

### 8.6 Di mana setiap ID PRD/modul tinggal

| Modul / topik | BR (PRD) | FR | Server (`src/modules/…`) | Klien (`src/pos/…`) | Rute | Tes utama |
|---|---|---|---|---|---|---|
| **Identitas & Tenancy** | BR-TNT, BR-AUT, BR-I18N-002 | FR-TNT, FR-AUT, FR-DEV | `identity/` (+ `server/auth/`) | `session/`, `data/` (staf, role), `usecases/identity/` | `/admin/*` (A01, A07, A08), `/pos` (P01, P02, P15, P16) | RLS, PIN, enrollment, lease |
| **Katalog** | BR-CAT, BR-UOM, BR-PRC | FR-CAT, FR-PRC | `catalog/` (+`domain/availability`) | `usecases/catalog/`, `data/catalog.repo` (lookup barcode/nama) | A03–A05; P04 | V-24, V-27, kinerja lookup |
| **Penjualan** | BR-MNY, BR-TAX, BR-DSC, BR-PAY, BR-INV, BR-RTR | FR-POS, FR-PAY, FR-RTR | `sales/` (invoice, gap, retur, pemulihan) | `usecases/sales/` + `lib/sales-calc` | P04, P08–P11 | V-01…V-11, V-18…V-20, V-23, V-25, V-29, V-30 |
| **Shift & Kas** | BR-SHF | FR-SHF | `shift/` | `usecases/shift/` | P03, P12, P13; A02 (R-03) | V-21 |
| **Inventori** | BR-STK, BR-HPP, BR-TRF, BR-RCP | FR-INV | `inventory/` (`server/costing.ts`) | (hanya `stock_snapshot` estimasi) `data/stock.repo` | A06 | V-12…V-17, paralel (row lock) |
| **F&B** | BR-FNB, BR-SPL | FR-FNB | `fnb/` | `usecases/fnb/` | P05–P07 | V-19, V-20, serah-terima, EC-058…061 |
| **Sync** | BR-SYN, BR-TIM | FR-SYN | `sync/` (push pipeline, feed, idempotensi, attention, flag, `app_release`) | `sync/`, `db/`, `maintenance/` | `routes/api/pos/v1/*`; P14, P15 | Konkurensi versi, replay, konvergensi, Playwright offline |
| **Audit** | BR-AUD | FR-AUD | `audit/` | `usecases/*` memancarkan `AppendAudit` | A09 | Immutability, rantai hash |
| **Laporan** | BR-RPT | FR-RPT | `reporting/` (view) | — | A02 | V-25 |
| **Cetak** | BR-PRN | FR-PRN | — (tanpa tabel server) | `printing/` | P09, P16 | Golden byte ESC/POS |
| **Lokalisasi** | BR-I18N | FR-I18N | — | `i18n/`, `lib/kernel/format` | semua | V-26, `keys.test.ts` |
| **Log** | BR-LOG | FR-LOG | `server/logging/` | `maintenance/device-log`, `lib/client-errors` | — | Uji redaksi (NFR-OBS-002) |
| **Kernel bersama** | BR-MNY, BR-TIM, BR-INV-003/010 (format) | FR-QA-003 | `lib/kernel`, `lib/sales-calc`, `lib/contracts` | idem | — | Vektor V-01…V-30 + properti |

---

## 9. Observabilitas, Pengujian, Kinerja, Keamanan, Deployment

### 9.1 Observabilitas dan logging (PRD Bab 5.11, KEP-21)

`DISEPAKATI` (BR-LOG-001…014): log operasional **≠** audit log; JSON per baris; pola `financeDashboard`; waktu UTC. Monitoring sync-lag dan backup off-site **di luar MVP** (RSK-09, NFR-OBS-001) — arsitektur ini memastikan log menjadi fondasi yang membuat keduanya murah ditambahkan.

| Aspek | Rancangan |
|---|---|
| **Pembuat logger tunggal** | `src/server/logging/logger-core` (pino) + `log.ts#createLogger(scope)`; tidak ada `console.*` di `src/server/**`/`src/functions/**` (ESLint). Level `trace…silent`, default `info` (konfigurasi); produksi menolak `debug/trace` (pola `app-env` referensi) |
| **Konteks otomatis** | `AsyncLocalStorage` (`log-context`): `reqId`, `tenantId`, `userId`, `deviceId`, `registerId`, `commandId`, `jobId`/`parentReqId`, `env`, `appVersion`, `schemaVersion`. Diisi di **tiga titik**: `server-entry` (`reqId`), `authMiddleware`/`deviceAuth` (tenant/user/device/register), pipeline push (`commandId` per perintah via `runWithContext`). Pemanggil tidak mengisi manual (BR-LOG-004) |
| **ID referensi** | `YYYYMMDD-HHmmss-xxxxx` (UTC + 5 karakter alfabet tanpa `i l o 0 1`); `job-…` untuk latar; `X-Request-Id` dari proxy dipakai hanya bila ≤ 64 karakter `A–Z a–z 0–9 . _ -`; satu baris **access** per request (metode, path tanpa data sensitif, status, durasi) (BR-LOG-005) |
| **Field tertutup** | `log-fields.ts` memuat daftar BR-LOG-006 (`err, reason, label, durationMs, fn, publicCode, method, path, status, ip, commandId, commandType, outcome, saleId, invoiceNo, outletId, cursorFrom, cursorTo, rowCount, schemaVersion, appVersion, origin, route, userAgent, componentStack, clientError, usernameHash, usernameLength` — **kini menghitung email** karena login hanya email; nama dari PRD BR-LOG-006 tetap sampai PRD diselaraskan); nama field baru harus didaftarkan dulu — dipaksa tipe TypeScript dan CI (FR-LOG-003) |
| **Redaksi** | **Tidak pernah** mencatat objek payload/baris bisnis; hanya id (`saleId`, `invoiceNo`, `commandId`). Serializer galat membuang nilai parameter dari pesan galat DB (SQL ber-placeholder; stack hanya baris `at …`); percobaan login/PIN gagal hanya **hash 8 karakter + panjang**. Nama/telepon pelanggan, PIN, hash PIN, token, kode pairing, isi struk: tak pernah. **Tes otomatis (NFR-OBS-002):** kirim payload berisi nilai sentinel (PIN, nama, telepon, token, parameter SQL) melalui seluruh jalur (login, enroll, push, galat DB) dan pastikan **tidak ada** sentinel di keluaran log (stdout + file) |
| **Tujuan tulis** | stdout (log kontainer) **dan** file harian `app.<tanggal UTC>.<n>.log` di volume `logs` (rotasi harian, `pino-roll`); gagal berkas ⇒ tetap stdout dan buka ulang tiap 60 dtk; tulis asinkron sehingga tidak menambah latensi `FinalizeSale` (NFR-OBS-003) |
| **Retensi** | 30 hari (dapat diatur 1–3650), pembersih tiap 6 jam, **hanya** berkas ber-pola nama log (BR-LOG-011/014); log tidak ikut backup DB |
| **Kegagalan proses** | `unhandledRejection/uncaughtException` ⇒ `fatal`, flush, keluar di produksi (restart oleh kebijakan Compose) (BR-LOG-012) |
| **Kode error publik** | `KODE#ID` (enam kode umum `UNAUTHORIZED, FORBIDDEN, VALIDATION_FAILED, DB_UNAVAILABLE, TIMEOUT, INTERNAL_ERROR` **ditambah katalog domain-spesifik** dan aturan kestabilan di §9.7.1; ID offline berawalan `D-`, §9.7.4); `/admin` lewat `publicErrorMiddleware`; `/api/pos/v1` membalas `{error:{code,ref}}`. Layar menampilkan kode + ID + tombol Salin (DESIGN §5.2 #30) |
| **Log sync** | Satu baris per perintah (`commandId, commandType, schemaVersion, outcome ACK/RETRY/ATTENTION, durationMs`); kegagalan struktural/otorisasi = `error` dengan `commandId` **sama** dengan `attention_item`; satu baris per pull (`cursorFrom, cursorTo, rowCount, durationMs`). Kondisi bisnis yang diterima **bukan** log `error` (BR-LOG-009) |
| **Log device** | `pos/maintenance/device-log`: sumber = error render (ErrorBoundary), `window.onerror`/`unhandledrejection`, kegagalan cetak/sync, anomali jam, `persist` ditolak, kuota tinggi, update diterima/ditolak. Antrean Dexie ≤ 500 (tertua dibuang); dikirim lewat `POST /api/pos/v1/device-log` ≤ 100 entri per siklus dan ≤ 20 laporan / 10 mnt / device; server menulisnya sebagai baris log ber-`scope: device`; **pengiriman log tidak pernah memblokir sync transaksi dan kegagalannya tidak masuk "perlu perhatian"** (BR-LOG-010). Skema laporan di `lib/client-errors/report-schema` (pola referensi) |
| **Pencarian** | CLI `scripts/logs-find.ts` (dibundel ke `dist/ops` agar jalan tanpa `tsx` di server): filter `reqId/commandId/jobId/parentReqId`, level minimum, rentang UTC, `tenantId`, `userId/deviceId`, awalan path; hanya membaca berkas harian relevan; menampilkan rantai penyebab (BR-LOG-013) |
| **Kesehatan** | `GET /health` (tanpa log): `status` (`ok`/`degraded` bila migrasi tertinggal), `version`, cek DB ringan; dipakai healthcheck Compose |
| **Ringkasan berkala (opsional, di luar MVP — keputusan user OQ-A12: pemantauan mengikuti PRD)** | Satu baris `info` tiap 5 menit: koneksi SSE aktif, jumlah push/pull, p95 durasi, jumlah `RETRY/ATTENTION` — nol biaya infrastruktur dan menjadi bahan awal monitoring sync-lag pasca-MVP (RSK-09) |

### 9.2 Strategi pengujian (AD-26)

`DISEPAKATI` (FR-QA-001…003, NFR-TEST-001/002): kualitas sinkronisasi adalah **gerbang rilis**. Piramida:

| Tingkat | Alat / proyek | Isi (selaras PRD) | Gerbang |
|---|---|---|---|
| **Unit — kernel & kalkulasi** | Vitest `unit` | **Vektor V-01…V-30** (PRD Lampiran D) pada `lib/kernel`, `lib/sales-calc`, `modules/inventory/server/costing` (V-12…V-17), `modules/catalog/domain` (V-27), `lib/kernel/numbering` (V-29), `lib/kernel/time` (V-22/V-23), `format` (V-26) | Satu angka berbeda ⇒ CI merah (FR-QA-003) |
| **Unit — properti** | `fast-check` | Σ LR = total & tak bergantung urutan; pembulatan tunai idempoten; `parse∘format` nomor; `costing`: nilai/qty invarian (`qty=0 ⇒ nilai=0`); migrator payload `N−1→N` selalu lolos Zod `N`; `deriveSyncIndicator` total terhadap semua kombinasi state | CI |
| **Unit — klien** | Vitest + `fake-indexeddb` | Use case `finalize` (atomik, nomor tak hangus bila transaksi diabort), `retention` (pending tak pernah terpilih), `wedge-buffer` (simulasi waktu), clock offset (sampel RTT), state machine konektivitas (histeresis), `UpdateManager`, `escpos` golden byte | CI |
| **Kontrak** | Vitest | Fixture payload per `schema_version` diterima server N dan N−1; amplop API; `426` untuk skema usang | CI |
| **Integrasi DB** | Vitest `db` + PostgreSQL 18 nyata (service container) | **RLS** semua tabel (0 baris silang-tenant) + FK komposit; hak append-only; **konkurensi `tenant_sync`** (N penulis paralel ⇒ versi berurutan tanpa celah) + pull yang disisipkan acak **tidak pernah melewatkan baris** (F1 kriteria 2); `FinalizeSale` dengan payload V-04…V-11/V-18…V-21/V-30 ⇒ angka tersimpan identik; **idempotensi** (kirim ulang N kali ⇒ 1 efek); **row lock stok** (penjualan paralel SKU sama; himpunan SKU acak ⇒ tanpa deadlock); gap/`-Dn`/pemulihan (contoh BR-INV-008); serah-terima accept↔cancel↔bayar; urutan `bill_seq` acak; antrean perlu-perhatian + dependen; full resync konvergen; `lock_timeout ⇒ RETRY` | CI |
| **Konvergensi (properti sistem)** | `fast-check` + `db` | Himpunan perintah acak dari beberapa device (jual, void, retur, kas, event bill) dikirim dengan **urutan acak, duplikasi, kegagalan transien disimulasikan** ⇒ invarian: tak ada dokumen ganda; Σ `stock_movement` = saldo; `max_seq − count = Σ gap`; hasil ACK replay = ACK pertama; state akhir identik untuk setiap urutan yang menghormati dependensi (kecuali kolom bergantung-urutan yang disengaja: HPP, `bal_seq`, `-Dn`) | CI (NFR-REL-002, FR-QA-002) |
| **E2E offline** | **Playwright** (Chromium; `context.setOffline`, `route` untuk 503/timeout/respons hilang, `page.clock`, CDP) | Skenario penuh offline (PIN → shift → jual → cetak (adapter virtual) → retur → tutup shift) lalu online & verifikasi di server; **putus-nyambung**; respons hilang setelah commit; *lie-fi* (200 HTML captive portal); reload di tengah antrean + upgrade Dexie fixture; dua tab; lease habis & jam mundur; kuota storage (CDP `overrideQuotaForOrigin`); start dingin offline dengan SW; prompt update (opsional/wajib/ditolak); kunci layar; tiga viewport DOQ-06; dua konteks = dua device terhadap satu server (stok, serah-terima) | CI harian + sebelum rilis (FR-QA-001) |
| **Kinerja** | Skrip benchmark + perangkat nyata | Lihat §9.3 | Pra-rilis F3 |
| **Keamanan** | Vitest `db`, skrip CI | Redaksi log (sentinel), **rate limit (unit jam palsu + konfigurasi Nginx di CI + integrasi per-device/per-slug, §6.9.9)**, header/CSP (laporan dulu), `npm audit`, bundle-guard (tak ada rahasia/kode server di `/pos`) | CI |
| **Matriks perangkat** | Manual terjadwal | Satu printer per jalur (USB, BLE, kiosk-print), pemindai wedge, kamera, tablet Android + PC Windows (DOQ-06); hasilnya di catatan F3 | Kriteria selesai F3 |

Data uji: pembuat data sintetis (`tests/fixtures/`) menghasilkan katalog 5.000 SKU + 45.000 transaksi lokal untuk benchmark Dexie (SCHEMA §6.5) dan dunia lama per versi untuk uji migrasi. Skenario Bab 9 PRD berprioritas tinggi (EC-001…EC-063) dipetakan ke tes dan dilacak di matriks traceability tes (Bab 10 mengacu).

### 9.3 NFR kinerja dan anggaran

| NFR | Target | Cara dicapai | Cara diukur |
|---|---|---|---|
| NFR-PERF-001 | "Selesai" → tersimpan p95 ≤ **300 ms** (5.000 SKU, 45.000 transaksi lokal) | Satu transaksi Dexie pendek, kernel dihitung **sebelumnya**, tanpa jaringan, `strict` durability **diukur** (bila melampaui: `relaxed` + `flush` per transaksi finalisasi — `RSK-A03`) | Benchmark F3 pada perangkat DOQ-06 dengan dataset penuh |
| NFR-PERF-002 | Mulai kirim byte cetak ≤ **1 dtk** (≤ 40 baris), UI tak terblokir | Antrean asinkron, koneksi printer hangat, ESC/POS teks, logo NV/raster ter-cache, encoder murah | Pengukuran dari commit ke byte pertama pada tiap jalur |
| NFR-PERF-003 | Barcode ≤ 50 ms; cari nama ≤ 150 ms (p95, 5.000 SKU) | Indeks `&barcode`, `*search_tokens` (token huruf kecil tanpa diakritik), tanpa render ulang katalog penuh (virtualisasi grid) | Benchmark F2 |
| NFR-PERF-004 | Start dingin offline → layar login ≤ **3 dtk** | Precache shell+bundle; boot §3.1; sync di latar setelah paint; bundle kecil | Lighthouse/`web-vitals` + Playwright pada Android kelas menengah |
| NFR-PERF-005 | `FinalizeSale` server p95 ≤ **500 ms** | Transaksi pendek, urutan lock tetap, indeks sesuai SCHEMA §5.2, `INSERT … ON CONFLICT`, tanpa N+1 | Tes integrasi + log `durationMs` |
| NFR-PERF-006 | Pull 500 baris ≤ **1 dtk** (4G) | Keyset `(version,id)`, k-way merge terindeks, `gzip`, halaman 500 | Benchmark F2 (termasuk k-way merge, RK-10) |
| NFR-PERF-007 | Verifikasi PIN 250–500 ms | Argon2id dikalibrasi, Web Worker | Kalibrasi parameter pada perangkat uji F3 |
| NFR-I18N-002 | Ganti bahasa ≤ 200 ms tanpa jaringan | Kamus ter-bundle, i18next sinkron | Playwright mode pesawat |

**Anggaran bundle `/pos` (`DIUSULKAN`, dikunci setelah benchmark F1/F3; ditegakkan `size-limit` + bundle-guard):**

| Item | Anggaran |
|---|---|
| JS + CSS rute awal `/pos` (gzip) | ≤ **350 KB** |
| Total precache `/pos` (termasuk font, kamus, ikon, WASM) | ≤ **2,5 MB** |
| WASM Argon2id (`hash-wasm`) | dimuat malas saat login PIN pertama, tetap di precache |
| `barcode-detector`/`zxing-wasm` | **di luar** muat awal; di precache untuk offline (`RSK-A05`) |
| Chunk `/admin` (recharts, tabel, form) | **tidak** pernah di precache/dimuat perangkat kasir |

Teknik: code-splitting per rute `/pos` (layar jarang: retur, tutup shift, pengaturan perangkat); komponen berat (kamera, dialog split/merge) `lazy`; hanya ikon Lucide yang dipakai (impor bernama); tanpa pustaka tanggal besar (kernel memakai `Intl`).

### 9.4 Keamanan lintas bagian

| Topik | Rancangan |
|---|---|
| **TLS** | HTTPS wajib (NFR-SEC-001; juga prasyarat PWA/WebUSB/Web Bluetooth); `Strict-Transport-Security` (preload tidak diaktifkan di MVP); HTTP→HTTPS di proxy |
| **CSP** | Dimulai **Report-Only**, lalu enforced: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` (+ nonce untuk skrip inline hidrasi `/admin` `VERIFIKASI`); `connect-src 'self'`; `img-src 'self' data: blob:`; `font-src 'self'`; `style-src 'self'` (+ nonce bila diperlukan); `worker-src 'self' blob:`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; tanpa CDN eksternal (DP-12). WASM memerlukan `'wasm-unsafe-eval'` |
| **Header lain** | `X-Content-Type-Options: nosniff`; `Referrer-Policy: same-origin`; `Permissions-Policy`: `usb=(self), bluetooth=(self), camera=(self)`, lainnya dimatikan; `Cross-Origin-Opener-Policy: same-origin`; `/api/*`: `Cache-Control: no-store`; **`/sw.js`: `Cache-Control: no-cache`** (agar pembaruan SW terdeteksi; satu skrip untuk semua tenant); aset ber-hash: `immutable`; **cookie sesi**: `HttpOnly; Secure; SameSite=Lax; Path=/<slug>` dengan nama per tenant (§6.2); `/platform`: tanpa pembatasan IP (akun platform terpisah + batas umum Nginx; §1.7, `RSK-A22`) |
| **Rate limit** | **Dua lapisan (AD-40, §6.9)**: Nginx `limit_req`/`limit_conn` per IP (IP asli dari `X-Real-IP` yang ditimpa Nginx) + pustaka pembatas di app dengan kunci `device_id` (API device), IP+slug (enroll, slug) atau **akun global / email lintas slug** (login admin progresif tanpa penguncian permanen; IP hanya jaring longgar; celah §6.9.10), enroll per IP **dan** per slug, full resync 1/jam, SSE satu koneksi/device, laporan berat ±2 bersamaan per tenant; respons `429` + `Retry-After`; pelanggaran hanya dicatat log (hash pendek), bukan Telegram |
| **Rahasia/env** | Hanya lewat variabel lingkungan/secret Compose; divalidasi `env.ts` saat boot (menolak start bila salah); daftar kunci env diuji; **tidak ada rahasia di bundle klien** (bundle-guard, NFR-SEC-007); nilai tak pernah ditulis di pesan galat/log |
| **Validasi** | Zod di setiap batas (API, server function, form, impor CSV); kuantitas desimal pola ketat (BR-MNY-008); ukuran body dibatasi |
| **Unggah logo** | Hanya PNG/JPEG, ≤ 200 KB, dimensi dibatasi; verifikasi *magic bytes* di server; **tanpa SVG**; disajikan lewat endpoint terautentikasi device; hash `logo_sha256` |
| **Ekspor/impor** | Ekspor CSV mengawali sel berawalan `= + - @` dengan `'` (anti formula-injection); impor file ekspor pending divalidasi hash + Zod + ukuran (§5.9) |
| **Database** | Peran `solva_app` `NOBYPASSRLS`; DB tidak terpapar publik (jaringan internal Compose); `REVOKE UPDATE/DELETE` untuk append-only; trigger `forbid_mutation`; verifikasi rantai audit terjadwal |
| **Host** | Kontainer non-root, filesystem root read-only (kecuali volume), hanya 80/443 terbuka, SSH berkunci, pembaruan keamanan otomatis OS |
| **Rantai pasok** | Versi paket di-pin (pola referensi); `npm audit` di CI; pembaruan terjadwal manual; tanpa skrip pasca-pasang yang tak dikenal |
| **Privasi** | Nama/telepon pelanggan dimasker di laporan tanpa `customer.view_phone` (BR-CUS-002); tak pernah di log; retensi server mengikuti OQ-03 |
| **Perangkat hilang** | Pencabutan device di `/admin` (berlaku saat online); lease 7 hari; audit; anjuran enkripsi disk (§6.6) |

### 9.5 Deployment dan CI

`DISEPAKATI` stack: VPS + Docker. Rincian `DIUSULKAN`:

| Aspek | Rancangan |
|---|---|
| **Lingkungan** | `development` (Postgres Docker lokal; `scripts/local.mjs` memuat env dev), **`staging` (database sendiri, terpisah dari produksi)**, `production`; `APP_ENV` eksplisit dan wajib, tanpa nilai bawaan, dan memicu aturan (produksi menolak `LOG_LEVEL` debug/trace) — pola `financeDashboard` D66. Detail pembagian rc/stabil di §9.6.2 |
| **Image** | `Dockerfile` multi-tahap: *build* (`vite build` + `build:ops`) → *runtime* Node LTS slim, `npm ci --omit=dev`, user non-root; tag image = **versi git dari tag bersih** (`X-App-Version`, `__APP_VERSION__`); `bundle-imports` memeriksa bahwa setiap paket yang diimpor server terpasang di runtime (pola `scripts/deploy` referensi). **Image disusun oleh skrip di komputer user, bukan oleh CI** (§9.6.2) |
| **Compose** | Layanan `proxy` · `app` · `db` · `migrator` (job); `healthcheck` `app` = `/health`, `db` = `pg_isready`; `app` menunggu `migrator` selesai sukses; restart `unless-stopped`; volume `pgdata`, `logs`, `assets` |
| **Urutan rilis** *(source map privat dipindah ke volume `sourcemaps` sebelum image disusun/di-deploy: §9.7.9)* | (1) skrip di komputer user menyusun image dari **tag bersih** → (2) **user** menjalankan deploy: **backup penuh** bila migrasi menyentuh data lama (§9.6.5) → **migrator** menjalankan migrasi **additive-only** sebagai `solva_owner` → (3) ganti kontainer `app`; gerbang `/health` (503 `degraded` bila migrasi tertinggal); bila gagal, **rollback otomatis aplikasi** ke image sebelumnya (skema tetap aman karena additive) → (4) bundle `/pos` baru aktif ketika klien mengambil SW baru. **Bundle `/pos` hanya roll-forward** (§3.2, AD-25). Rincian §9.6 |
| **`app_release`** | Baris dimasukkan saat rilis lewat skrip ops (`app_version`, `schema_version`, `is_mandatory`, `min_accepted_schema_version`, `accept_previous_until = released_at + 30 hari`); rilis wajib hanya bila tidak kompatibel (BR-SYN-003 butir 4). Jendela 30 hari: keputusan user (OQ-A19 terjawab) |
| **Downtime** | Satu instance ⇒ restart beberapa detik. Dampak ke kasir **nol**: client offline-first, push mencoba ulang, SSE tersambung kembali; deploy dianjurkan di luar jam padat |
| **Gerbang kualitas** (GitHub Actions, OQ-A11) — **hanya untuk tes, bukan untuk rilis/deploy** | Pada tiap push/PR: `typecheck`, `lint` (ESLint + dependency-cruiser), `unit`, `db` (service container `postgres:18`), `build` + bundle-guard + `size-limit`, Playwright smoke offline. **Tidak ada** pembuatan paket/image, publikasi, atau deploy lewat CI: itu dijalankan user dari komputernya (§9.6.2, keputusan user 2026-11-18 "tanpa CI" untuk rilis). Diputuskan user (OQ-A21 terjawab): tes otomatis sebagai gerbang di GitHub Actions, rilis dan deploy manual dari komputer user (RK-18) |
| **Backup** | Di luar kriteria selesai MVP (RSK-09), tetapi **keputusan user (OQ-A09): `pg_dump` terjadwal + salinan luar VPS + uji restore disiapkan sebelum go-live produksi**; ditambah **dump penuh sebelum migrasi yang menyentuh data lama** dan jalur PITR kelak (§9.6.5) |
| **Pekerja latar** | Pembersih tombstone (tiap tenant, naikkan `tombstone_floor_version`), **pembersih `member_code` (hapus fisik 7 hari setelah kedaluwarsa/terpakai; keputusan user 2026-11-19, OQ-S39) + soft-delete profil `PENDING` yatim (OQ-S40)**, pembersih log, verifikasi rantai audit, kosongkan `idempotency_command.result` lama: dijalankan **di proses `app`** dengan *advisory lock* (aman walau kelak >1 instance), memakai pool terpisah kecil |
| **Skalabilitas** | Satu instance cukup (SCHEMA §6.5.2). Menambah instance menuntut: bus sinyal SSE (`LISTEN/NOTIFY`), **store pembatas bersama** (PostgreSQL/Redis pada pustaka pembatas yang sama, §6.9.4–6.9.5), pekerja latar ber-lock — dicatat `OQ-A17`; tidak dilakukan di MVP |

### 9.6 Versioning, rilis, dan feature flag

`DISEPAKATI` (keputusan user 2026-11-18, diteruskan dari sesi perencanaan; pola `financeDashboard` D66 lingkungan, D67/D68 rilis & deploy, D69 feature flag, D70 versi & rilis). Yang `DIUSULKAN` di sini hanya **cara** mewujudkannya; satu butir masih `PERLU KONFIRMASI` ringan: ambang ukuran data untuk PITR (`OQ-A20`); jendela 30 hari (`OQ-A19`) dan gerbang tes GitHub Actions vs rilis manual (`OQ-A21`) sudah terjawab user.

**Peta tanggung jawab empat nomor versi (ringkas; tabel lengkap di §3.2):**

```
 tag git v1.8.0 ──build──► __APP_VERSION__ (klien) ──► X-App-Version ─┐
 contracts SCHEMA_VERSION=7 ─────────────────────────► X-Schema-Version ├─► server (app_release, device_sync_status,
 protokol sync = 2 ──────────────────────────────────► X-Sync-Protocol ─┘    per-perintah/penjualan: app_version + schema_version)
 Dexie versi 12 ──── (lokal saja, tidak dikirim, tidak bisa turun) ──► alasan roll-forward only
```

#### 9.6.1 Skema versi aplikasi (AD-27)

| Aspek | Keputusan |
|---|---|
| Format | **SemVer** `vMAJOR.MINOR.PATCH`; **tag git = sumber kebenaran**; tag rc `vX.Y.Z-rc.N` **hanya di staging**; produksi hanya tag stabil `vX.Y.Z` |
| Konstanta di bundle | `__APP_VERSION__` diisi **saat build** (Vite `define`: tag git, `dev` pada `npm run dev`) — satu teks yang sama untuk bundle klien dan server (pola `src/lib/app-version` dan `vite.config.ts` referensi) |
| Server | Header **`X-App-Version`** pada setiap respons (`request-log` pola referensi); `app_version` pembuat dicatat di `idempotency_command`/`sale` (SCHEMA sudah memiliki kolomnya) |
| Tampilan | Versi tampil **hanya di footer layar login (SCR-P02) dan pengaturan perangkat (SCR-P16)**, serta di daftar device `/admin` (FR-DEV-004). **Tidak ada `VersionBanner`** seperti referensi (perbedaan versi klien–server tidak ditampilkan sebagai banner tersendiri); banner **pembaruan tersedia/wajib** tetap ada (§4.7, DESIGN CMP-17) |

*Konsekuensi:* karena tidak ada banner pembanding string versi, perbedaan klien–server hanya ditangani lewat **kontrak** (`schema_version`, `min_accepted_schema_version`) dan blok `release`; satu-satunya banner terkait server tertinggal adalah "server sedang diperbarui" (§3.2 butir 6).

#### 9.6.2 Model rilis, lingkungan, dan hotfix (AD-28)

```
 komputer user                                         VPS staging (DB sendiri)         VPS produksi
 ───────────────────────────────────────────────       ───────────────────────          ─────────────────
 Conventional Commits ──► versi berikutnya dari commit
 MINOR/MAJOR: tag rc vX.Y.Z-rc.N ──► skrip susun image ──► user deploy ──► uji ──┐
                                      (dari TAG BERSIH)                          ▼
 tag stabil vX.Y.Z (+ catatan "Perubahan angka" bila perlu) ──► skrip susun image ──► user deploy ─────────► produksi
 PATCH hotfix (jalur cepat, TANPA rc): hanya setelah UJI OTOMATIS KUNCI lulus lokal ──► tag stabil ──► deploy ───► produksi
 deploy = [backup bila perlu §9.6.5] → migrasi additive → ganti kontainer app → tunggu /health (versi baru, sehat)
          └─ gagal ⇒ ROLLBACK OTOMATIS aplikasi ke image sebelumnya (skema tetap aman: additive)
```

| Aspek | Keputusan |
|---|---|
| **Satu build untuk semua tenant** | SaaS; tidak ada `CLIENT_ID` dan **tidak ada prefiks URL yang ditanam saat build**; slug tenant dibaca saat runtime (§1.7; menyimpang dari referensi, RK-17) |
| **Semi-manual dari komputer user** | Skrip (`scripts/deploy/`) menyusun image **hanya dari tag bersih** (tolak working tree kotor atau commit bukan tag persis; aturan `version-rules` referensi). **User** yang memindahkan image dan menjalankan deploy; skrip ops di VPS (`scripts/ops/`) menjalankan urutan deploy dan **tidak pernah** dipanggil otomatis oleh pihak lain |
| **Tanpa CI untuk rilis** | Tidak ada pipeline yang membangun/menerbitkan/men-deploy. Gerbang tes di GitHub Actions (OQ-A11) hanya memeriksa kode; diputuskan user (OQ-A21 terjawab, RK-18) |
| **Health check & rollback** | `GET /health` (tanpa log): `200 healthy` dengan versi build baru; **`503 degraded`** bila migrasi DB tertinggal. Deploy menunggu `/health` sehat dengan versi baru; bila gagal → **rollback otomatis ke image sebelumnya**. Rollback server **dibatasi**: sebelum rollback, skrip memeriksa bahwa image tujuan mengenal kontrak tertinggi yang dipakai klien (`max(device_sync_status.schema_version)`); bila tidak, rollback ditolak dengan peringatan (konsisten dengan OQ-A14 dan §3.2 butir 6) |
| **Lingkungan** | `development` (lokal), **`staging` terpisah dengan database sendiri**, `production`; `APP_ENV` eksplisit tanpa default; staging menerima tag rc **dan** stabil, produksi hanya stabil (D66, D70) |
| **Jalur rilis** | **MINOR/MAJOR**: melalui staging dan rc. **PATCH/hotfix**: jalur cepat tanpa rc, **hanya** setelah **pengujian otomatis kunci** lulus — vektor kernel hitung (V-01…V-30 + properti), konvergensi/idempotensi sync, tes RLS — dijalankan **lokal oleh skrip rilis** (karena tanpa CI) dan menjadi syarat skrip menyusun image |
| **Konvensi** | **Conventional Commits**; versi berikutnya diturunkan dari commit (aturan `feat`→MINOR, `fix`→PATCH, `!`/`BREAKING`→MAJOR; aturan 0.x seperti referensi); `CHANGELOG.md` otomatis; **catatan rilis tertulis** `docs/releases/vX.Y.Z.md` wajib untuk perubahan yang memengaruhi **angka** (pajak, pembulatan, HPP, hitung kas) dengan bagian **"Perubahan angka"** terisi; rilis rc diperiksa kelengkapannya (pola D70). Pembuatan tag/rilis dijalankan **user** sendiri |

#### 9.6.3 Kontrak, upcaster, dan protokol sync (AD-29)

| Hal | Aturan |
|---|---|
| **Kapan `schema_version` naik** | Hanya bila format perintah/event berubah dengan cara **tidak dapat diproses penerima lama**: isian wajib baru; ubah nama/tipe/satuan; hapus/ubah makna. **Isian opsional baru tidak wajib menaikkan.** Nomor integer monoton; ditegakkan tes: perubahan skema Zod yang melanggar aturan ini tanpa kenaikan nomor ⇒ gagal (uji snapshot skema per versi di `lib/contracts`) |
| **Menempel di tiap perintah dan event** | `schema_version` ada pada `outbox_command`, `idempotency_command`, `bill_event`, `audit_log`, `sale` (SCHEMA STD-T); event append-only (mis. `ITEM_ADDED`) **disimpan permanen** dengan nomor kontraknya |
| **Penerjemah (upcaster) di server** | Server **harus bisa membaca kontrak lama selamanya**: pembangunan ulang proyeksi (`bill`, `bill_item`), replay, dan penampil audit membaca payload/event bernomor lama lewat rantai `upcaster` murni `v(k) → v(k+1) → … → terbaru` di `lib/contracts/upcasters/`. **Upcaster tidak boleh dibuang** walau dukungan **mengirim** kontrak lama dihentikan; fixture emas tiap versi dipertahankan selamanya dan diuji |
| **Migrator vs upcaster** | *Migrator* = klien, **maju** `N−1 → N` untuk payload outbox yang tertunda saat upgrade Dexie (§3.2 butir 3). *Upcaster* = server, membaca data **tersimpan** apa pun usianya. Dua alat berbeda, keduanya murni dan berpasangan dengan fixture |
| **Versi protokol sync** | Bilangan terpisah (`X-Sync-Protocol`): berubah bila **cara** tukar data berubah (bentuk amplop push/pull, bentuk cursor, urutan siklus, semantik `HELD`), bukan isinya. Server mendukung protokol saat ini dan sebelumnya; di luar itu `426 UPDATE_REQUIRED` + `min_protocol`. Tidak dicatat per transaksi |
| **Jejak per transaksi** | **`app_version` dan `schema_version`** disimpan di tiap perintah outbox dan tiap penjualan (juga di `idempotency_command`). **Versi protokol sync dan skema Dexie tidak** dicatat per transaksi |

#### 9.6.4 Klien usang dan klien lebih baru (AD-30)

| Hal | Aturan |
|---|---|
| **Kontrak yang didukung** | Server menerima **N dan N−1** dan menetapkan **versi minimum yang didukung** (`app_release.min_accepted_schema_version` — **kolom pada baris `app_release` terbaru**, keputusan user 2026-11-19 OQ-S25). **Jendela dukungan kontrak lama: N−1 selama minimal 30 hari** sejak rilis baru (`accept_previous_until`; lebih lama dari lease offline 7 hari; PRD BR-SYN-003 hanya mensyaratkan ≥ 14 hari). **Keputusan user (OQ-A19 terjawab 2026-11-18)** |
| **Lunak lalu keras** | **Lunak** (hari 0 → akhir jendela): banner pembaruan tersedia + dialog yang dapat ditunda (§4.7). **Keras** (jendela habis, atau rilis wajib): tanpa "Nanti"; diterapkan otomatis **hanya di momen aman** |
| **Momen aman** | Tidak ada keranjang/checkout/pembayaran aktif ∧ **shift tertutup** ∧ antrean sync kosong. **Tidak pernah** di tengah shift atau saat ada antrean sync. Perintah yang **ditahan karena kontrak usang** (`SCHEMA`, tak dapat diterima server lagi) **tidak dihitung** sebagai antrean sync untuk uji ini — kalau dihitung terjadi kebuntuan (update menunggu antrean kosong, antrean tak bisa kosong tanpa update); upgrade Dexie justru memigrasikannya ke kontrak terbaru (§3.2 butir 3) sehingga terkirim sesudahnya |
| **Klien lebih baru dari server** | §3.2 butir 6 (tahan perintah belum dikenal, banner "server sedang diperbarui", antrean terkirim otomatis, tidak ada data hilang); rollback server hanya ke versi yang mengenal kontrak yang sudah dipakai klien |
| **Sebelum batas keras** | Device yang lama offline dikunci lease 7 hari lebih dulu; begitu tersambung ia mendapat blok `release` dan pembaruan sesuai momen aman |

#### 9.6.5 Migrasi database server dan backup sebelum migrasi (AD-31)

| Hal | Aturan |
|---|---|
| **Aditif saja: expand lalu contract** | Rilis *k* (**expand**): tambah kolom/tabel/indeks baru (kolom baru nullable atau berdefault), server menulis ganda bila perlu, klien lama tetap berjalan. Rilis *k+1* (**contract**): pakai bentuk baru. **Perubahan destruktif** (drop/rename/ubah tipe sempit) hanya **setelah versi minimum naik dan jendela dukungan lewat** dan tidak ada device yang masih melapor kontrak lama (`device_sync_status`) |
| **Backup sebelum migrasi** | **Dump penuh** (`pg_dump` format kustom) **sebelum migrasi yang menyentuh data lama** (backfill, tulis ulang tabel, ubah tipe/constraint pada data ada). **Migrasi aditif murni** (tabel/kolom baru kosong) cukup **health check + rollback aplikasi**. Skrip deploy memutuskan berdasarkan penanda pada berkas migrasi (mis. `-- touches-existing-data`) |
| **PITR (penjelasan singkat)** | *Point-In-Time Recovery*: selain salinan penuh berkala, PostgreSQL terus menyimpan **catatan setiap perubahan (WAL)** ke tempat lain; bila terjadi kesalahan, database dapat **dipulihkan ke satu titik waktu** (mis. "tepat sebelum migrasi pukul 14:02") — bukan hanya ke saat dump terakhir, sehingga transaksi di antara dua dump tidak hilang. Biaya: ruang arsip WAL, alat (mis. pgBackRest/WAL-G), dan latihan restore. Dump penuh sederhana tetapi makin lama dan mahal seiring data tumbuh |
| **Kapan pindah ke PITR** | Bila **ukuran data melewati ambang** dan **saat backup off-site masuk** (RSK-09/OQ-A09). Ambang `PERLU KONFIRMASI` **`OQ-A20`** (asumsi sementara: ±10 GB, atau dump penuh + salinan keluar > ±15 menit; SCHEMA §6.5.2 memperkirakan 15–35 GB/tahun untuk 10 outlet campuran) |

#### 9.6.6 Feature flag (AD-32)

| Aspek | Keputusan |
|---|---|
| **Bentuk nilai (OQ-S26, 2026-11-19)** | **Boolean + `params` opsional** (JSON kecil) per flag; perubahan **berlaku setelah siklus pull** yang membawanya (bukan seketika di tengah transaksi) |
| **Cakupan** | **Per tenant**; hanya **owner** yang mengubah (lewat back-office atau langsung di DB); **aplikasi POS read-only** (tidak ada jalur tulis dari `/pos`) |
| **Penyimpanan & penyebaran** | Bagian **master data**: tabel server kelas M `tenant_feature_flag` (`tenant_id`, `flag_key`, `enabled`, `version`, `deleted_at`) ditulis lewat `sync.writeMaster` sehingga ikut **counter versi tenant** dan feed pull (BR-SYN-010); tersalin ke Dexie (store `feature_flag`, baca-saja, hanya Applier yang menulis). *SCHEMA perlu menambah tabel dan store; sesi skema diberi tahu terpisah.* |
| **Offline** | Klien memakai **nilai terakhir** yang tersimpan; tidak ada panggilan jaringan untuk membaca flag |
| **Nilai bawaan** | Ditetapkan **di kode per flag** (`lib/feature-flags/registry.ts`, satu daftar nama flag): tiap flag menyatakan **fail-closed** (mati bila tak ada baris/tak terbaca) atau **fail-open** (hidup) sesuai sifatnya — pola D69 referensi (`fail closed` bawaan) dengan pengecualian eksplisit per flag |
| **Penggunaan** | `featureEnabled(key)` (murni, baca Dexie/memori) di klien; di server `assertFeatureEnabled(key)` pada server function/route yang dilindungi flag (kode error publik `FEATURE_DISABLED`; cache 1 menit seperti referensi). Flag **bukan batas keamanan** dan **tidak** dipakai untuk perubahan kontrak yang tak kompatibel (itu urusan `schema_version`) |
| **Flag yang memengaruhi perhitungan** | Diperlakukan seperti konfigurasi hitung: ikut `ConfigSnapshot` keranjang (§5.1), berlaku untuk keranjang **berikutnya**, tidak di tengah transaksi |
| **Uji** | Parser/registry (`lib/feature-flags` murni); tes bahwa flag tak dikenal/hilang memakai default per flag; Playwright: ubah flag di server ⇒ klien offline tetap memakai nilai lama sampai pull |

### 9.7 Manajemen error (AD-35…AD-38)

`DISEPAKATI` (keputusan user 2026-11-18, diteruskan dari sesi perencanaan; pola `financeDashboard`: `public-error` `CODE#id`, ID request, log file, `logs:find`). Melengkapi §9.1 (log) dan BR-LOG-006/008/010. **Daftar kode final diterima user (OQ-A24 terjawab)**; ambang notifikasi dan retensi peta diputuskan (OQ-A25 terjawab).

#### 9.7.1 Katalog kode error dan kalimat tindakan (AD-35)

**Aturan kestabilan:** kode **stabil** — arti tidak pernah berubah; katalog **hanya bertambah**; kode yang dihentikan **tetap dikenali** (registri menandai `deprecated`, `replacedBy`). Satu registri di `lib/contracts/error-codes.ts` (dipakai klien dan server) diuji **snapshot emas**: menghapus/mengubah arti kode ⇒ tes gagal. Klien yang menerima kode tak dikenal memperlakukannya menurut **kelas** (bidang `class` pada respons) dan tetap menampilkan `KODE#id`. **Kode dan ID tidak diterjemahkan**; **kalimat tindakan** memakai kunci i18n `error.<KODE>.action` (`id-ID` default + `en-US`, BR-I18N-001/004).

| Kode | Kelas | Sumber | HTTP | Kalimat tindakan (`id-ID`) |
|---|---|---|---|---|
| `UNAUTHORIZED` | otorisasi | server | 401 | Sesi berakhir. Masuk kembali. |
| `FORBIDDEN` | otorisasi | server | 403 | Anda tidak punya izin untuk tindakan ini. Hubungi manager. |
| `VALIDATION_FAILED` | struktural | server | 400 | Data tidak valid. Periksa isian lalu coba lagi. |
| `DB_UNAVAILABLE` | transien | server | 503 | Layanan sedang sibuk. Coba lagi sebentar lagi. |
| `TIMEOUT` | transien | server/klien | 504 | Permintaan terlalu lama. Periksa koneksi lalu coba lagi. |
| `INTERNAL_ERROR` | sistem | server | 500 | Terjadi kesalahan sistem. Salin kode ini dan hubungi pengembang. |
| `PRINT_FAILED` | transien | klien | — | Struk belum tercetak. Periksa printer dan kertas, lalu ketuk Cetak ulang. |
| `PIN_LOCKED` | otorisasi | klien | — | PIN terkunci sementara. Tunggu {menit} menit atau minta manager mereset. |
| `DEVICE_REVOKED` | otorisasi | server | 403 | Perangkat ini sudah dicabut. Ekspor transaksi tertunda, lalu hubungi manager. |
| `CREDENTIAL_EXPIRED` | otorisasi | server | 401 | Kredensial perangkat kedaluwarsa. Pasangkan ulang perangkat. |
| `LEASE_EXPIRED` | otorisasi | klien | — | Perangkat terkunci karena 7 hari tanpa sinkron. Hubungkan ke internet. |
| `UPDATE_REQUIRED` | skema | server | 426 | Aplikasi perlu diperbarui. Selesaikan shift, lalu muat ulang saat diminta. |
| `SYNC_HELD` | skema | klien/server | — | Sebagian transaksi ditahan menunggu pembaruan atau server. Tidak ada data yang hilang. (alasan di `reason_code`: `SCHEMA`, `SERVER_BEHIND`, `TENANT_SUSPENDED`) |
| `TENANT_SUSPENDED` | otorisasi | server | 403 | Layanan untuk tenant ini sedang tidak tersedia. Hubungi penyedia layanan. |
| `STORAGE_LOW` | transien | klien | — | Penyimpanan perangkat hampir penuh. Sinkronkan dan bebaskan ruang; transaksi tertunda tidak dihapus. |
| `STORAGE_FULL` | sistem | klien | — | Penyimpanan penuh, transaksi tidak tersimpan. Ekspor transaksi tertunda lalu bebaskan ruang. |
| `LOCAL_DB_FAILED` | sistem | klien | — | Data lokal tidak dapat dibuka. Ekspor transaksi tertunda lalu hubungi pengembang. |
| `APP_ERROR` | sistem | klien | — | Layar ini mengalami masalah. Ketuk Coba lagi; draf Anda aman. |
| `HANDOVER_NOT_PENDING` | bisnis | server | 409 | Bill sudah diterima atau dibatalkan. Muat ulang daftar bill. |
| `EVENTS_PENDING` | bisnis | server | 409 | Masih ada perubahan bill yang belum terkirim. Tunggu sinkron selesai. |
| `RATE_LIMITED` | otorisasi | server | 429 | Terlalu banyak percobaan. Tunggu beberapa menit. (Login/enroll: **"Coba lagi dalam sekitar N menit"**, kunci i18n bermenit; §6.9.3.) **Hanya** untuk jalur interaktif (login, enroll, penukaran kode, dan penerbitan kode di `/admin`); `429` pembatas laju pada API device (push/pull/ping/resync) **bukan** kode ini — transien tanpa dialog (§4.2.4, §6.9.7) |
| `FEATURE_DISABLED` | otorisasi | server | 403 | Fitur ini tidak aktif untuk tenant Anda. |

(Enam kode pertama = kode umum BR-LOG-008. Kode `reason_code` antrean "perlu perhatian" — mis. `SERIES_CONFLICT`, `SCHEMA_NOT_MIGRATABLE` — adalah kode **data** (SCHEMA §4.6.3), bukan kode tampilan kasir.)

#### 9.7.2 Peta kelas kegagalan → HTTP → kode → tindakan UI

| Kelas (BR-SYN-030) | HTTP / kanal | Kode tipikal | Tindakan klien / UI |
|---|---|---|---|
| **Bisnis** (stok minus, harga stale, item nonaktif, tarif berbeda) | Bukan error: `ACK` + `data_flag` | — | Diterima; tak ada pesan ke kasir (DESIGN §5.2 #15); hanya laporan R-04 |
| **Validasi/aturan UI** | Klien menolak sebelum kirim; server `400`/`409` | pesan aturan; `VALIDATION_FAILED`, `HANDOVER_NOT_PENDING`, `EVENTS_PENDING` | Tingkat (a) §9.7.3: pesan jelas **tanpa** kode (aturan), kode hanya bila datang dari server tak terduga |
| **Struktural** | `ATTENTION` per perintah (`200`); `400` untuk amplop rusak | `VALIDATION_FAILED` (+ `reason_code`) | `NEEDS_ATTENTION`, indikator `sync_error`, daftar SCR-P14; keputusan manager di SCR-A09 |
| **Otorisasi** | `401`/`403`/`429` (`429` hanya untuk `RATE_LIMITED` jalur tanpa-login; `429` pembatas laju API device = transien, bukan kelas ini) | `UNAUTHORIZED`, `FORBIDDEN`, `DEVICE_REVOKED`, `CREDENTIAL_EXPIRED`, `TENANT_SUSPENDED`, `RATE_LIMITED`, `FEATURE_DISABLED` | `/admin`: ke login; `/pos`: layar sistem SCR-P15 / `NEEDS_ATTENTION` (kode eksplisit saja, §2.4) |
| **Transien** | `5xx`/`503`/`504`, putus jaringan | `DB_UNAVAILABLE`, `TIMEOUT`, `PRINT_FAILED`, `STORAGE_LOW` | Tingkat (b): indikator + **retry otomatis** (backoff), tanpa dialog |
| **Skema** | `426`; `max_schema_version` | `UPDATE_REQUIRED`, `SYNC_HELD` | Ditahan, banner pembaruan/"server sedang diperbarui", tak ada data hilang (§3.2, §4.7) |
| **Sistem tak terduga** | `500`; klien: `ErrorBoundary`, `QuotaExceeded`, `Dexie` gagal | `INTERNAL_ERROR`, `APP_ERROR`, `STORAGE_FULL`, `LOCAL_DB_FAILED` | Tingkat (c): pesan + `KODE#id` + **Salin** |

**Dua pintu server, satu format ID:** (1) **server function `/admin`** — `publicErrorMiddleware` (dipakai juga oleh `authMiddleware`) mengubah galat menjadi `Error` berpesan `KODE#id` (TanStack Start hanya mengirim pesan Error); (2) **`/api/pos/v1/*`** — membalas `{ "error": { "code", "ref", "class" } }` + `X-Request-Id`. Keduanya memakai ID request yang sama dengan seluruh baris log request itu; galat mentah (stack, SQL ber-placeholder) hanya di log.

#### 9.7.3 Tiga tingkat error di UI dan login generik

| Tingkat | Kapan | Tampilan | Contoh |
|---|---|---|---|
| **(a) Aturan bisnis/validasi** | Pengguna melanggar aturan (diskon > batas, qty tak sah, pembayaran non-tunai melebihi sisa) | **Pesan jelas tanpa kode**, inline dekat sumbernya (DESIGN §3.0.1 `error`) | "Kuantitas harus menghasilkan pcs bulat" |
| **(b) Gangguan sementara** | Jaringan/5xx/timeout, printer terputus | **Indikator** (offline/pending/`print_failed`) + **retry otomatis**; **tanpa dialog** | Banner pending, chip cetak gagal |
| **(c) Kesalahan sistem tak terduga** | 500, render crash, kuota penuh, DB lokal gagal | Pesan + **`KODE#id`** + tombol **Salin** (DESIGN §5.2 #30) | `INTERNAL_ERROR#20261117-143551-k7q2m` |

**Login generik (anti-enumerasi):** login `/admin` selalu menjawab satu pesan yang sama — "Email atau kata sandi salah" — untuk email tak terdaftar, kata sandi salah, akun nonaktif, **atau akun yang bukan anggota tenant pada slug itu** (identitas global, §6.2), dengan **waktu respons yang seragam** (hash tiruan bila akun tak ada) dan batas laju (§6.9). Pesan khusus hanya untuk `RATE_LIMITED`. Slug tak dikenal = 404 generik (§1.7). Login PIN staf memilih nama dari daftar lokal (tidak ada enumerasi), pesan "PIN salah. Sisa percobaan: N" (BR-AUT-005).

#### 9.7.4 Pelaporan manual dan ID saat offline (AD-36)

- **Pelaporan = salin `KODE#id` lalu WhatsApp/telepon.** **Tidak ada** tombol "Laporkan masalah" atau paket diagnostik di MVP. Pencarian log memakai ID itu (`logs:find`, BR-LOG-013).
- **ID saat offline:** ID lokal berformat sama dengan **awalan khusus perangkat** `D-YYYYMMDD-HHmmss-xxxxx` (waktu **terkoreksi offset** UTC, 5 karakter dari alfabet tanpa `i l o 0 1`, BR-LOG-005), mis. `APP_ERROR#D-20261117-143551-k7q2m`. Disimpan di `device_log` (`ref_local`), dikirim lewat `POST /device-log`/sync, ditulis server sebagai baris log ber-cakupan `device` dengan field baru **`refLocal`** — sehingga `logs:find D-20261117-…` menemukan baris device bersama log server.
- **Field terdaftar tambahan BR-LOG-006:** `refLocal`, `errorClass`, `notifyKind` (dan `idempotencyKey` untuk aksi §9.7.8); nama baru wajib didaftarkan (FR-LOG-003).

#### 9.7.5 Crash render: ErrorBoundary per area (AD-37)

| Aspek | Rancangan |
|---|---|
| Batas | `ErrorBoundary` **per area** (kasir/keranjang, pembayaran, riwayat/retur, shift, bill/meja, antrean sinkron, pengaturan perangkat) **ditambah** satu batas akar (`AppShell`). Area yang crash menampilkan fallback **hanya di areanya**; area lain tetap hidup (mis. banner pending, tombol ekspor) |
| Pencatatan | `device_log` `APP_ERROR` (`route`, `componentStack` dipotong, `appVersion`, `ref_local` `D-…`); tanpa isi keranjang/PIN/pelanggan (BR-LOG-007) |
| Fallback area | Pesan tingkat (c): kalimat tindakan `APP_ERROR` + `KODE#id` + **Salin**, tombol **Coba lagi** (me-render ulang area) dan **Kembali ke beranda**. **Tanpa muat ulang otomatis** (mencegah putaran crash) |
| Keselamatan data | Keranjang/bill **aman di Dexie** (`cart_draft`, event bill lokal); store keranjang dibangun ulang dari draf setelah render ulang. Agar tidak ada **penjualan ganda** bila crash terjadi di sekitar finalisasi, draf membawa **`finalize_id`** (UUIDv7 yang dibuat saat draf dibuat dan dipakai sebagai `sale.id`); setelah pemulihan, domain memeriksa apakah `sale` ber-id itu sudah tersimpan (⇒ "Transaksi sudah tersimpan", ke SCR-P09) |
| Layar pemulihan (batas akar) | Kode + `KODE#id`, **Muat ulang** (manual), **Ekspor transaksi tertunda** (§3.5), dan tautan ke "mode aman" (§9.7.6). Dua crash akar dalam 60 dtk setelah boot ⇒ langsung mode aman |

#### 9.7.6 Gagal start, "last known good", dan "Reset aplikasi"

```
shell HTML (statis, tenant-netral) memuat SKRIP BOOT KECIL INLINE (tanpa dependensi bundle):
   pasang pencatat galat muat + timer 15 dtk  ──bundle utama selesai render pertama──► kirim BOOT_OK{appVersion, dbVersion} ke SW, reset penghitung gagal
   └─ galat muat/timeout ──► penghitung gagal (kunci solva:<tenant_id>:bootfail) +1 ; log device_log
        gagal ke-1 : coba sekali lagi (muat ulang tanpa cache jaringan)
        gagal ke-2 : SW masuk "MODE TERAKHIR BERFUNGSI" ─► layani shell+aset versi terakhir yang BOOT_OK dari cache
        masih gagal : arahkan ke halaman pemulihan statis /<slug>/pos/recovery (dari precache; TANPA bundle utama)
```

| Hal | Rancangan |
|---|---|
| **SW kembali ke versi terakhir yang berfungsi** | Entri precache versi lama **tidak dihapus** sampai versi baru mengirim `BOOT_OK` (pembersih memakai gabungan manifest semua pendaftaran, §2.3) dan SW menyimpan penanda `lastGood` (versi + manifest + `dexieVersion`). Pada mode "terakhir berfungsi" SW melayani navigasi/aset dari manifest `lastGood` dan mencatat log. **Syarat:** `lastGood.dexieVersion ≥ dbVersion` yang dilaporkan klien — bila bundle baru **sudah** menaikkan versi Dexie, bundle lama **tidak dapat** membuka DB (`VersionError`, roll-forward only, §3.2/AD-25) sehingga fallback tidak dipakai dan langsung ke halaman pemulihan; perbaikan = **roll-forward** hotfix |
| **Halaman pemulihan statis** | `recovery.html` (tenant-netral, CSS/JS inline minimal, **tanpa ketergantungan pada bundle utama**), masuk precache dan dilayani SW untuk `/<slug>/pos/recovery` dan sebagai cadangan terakhir navigasi. Isi: kode + `KODE#id`, **Ekspor transaksi tertunda** (halaman Reset aplikasi menyediakan ekspor ini — keputusan user 2026-11-19, DOQ-23) (membaca IndexedDB `solva-<tenant_id>` langsung lewat API IndexedDB polos — tanpa Dexie/bundle — store `outbox_command` non-`ACKED`), **Coba lagi**, dan **Reset aplikasi** |
| **Reset aplikasi** | Hanya oleh aksi manual (konfirmasi mengetik "RESET"); **membersihkan** (a) pendaftaran SW **tenant ini** (`/<slug>/pos/`) dan (b) entri cache aset **yang hanya dirujuk pendaftaran ini** (cache bersama tidak dihapus buta, agar tenant lain di browser yang sama tidak kehilangan shell offline); penghitung gagal start. **Tidak pernah** menyentuh Dexie `solva-<tenant_id>`, `solva-registry`, kunci/saluran, atau cookie. Setelah reset aplikasi dimuat ulang (**butuh internet**), SW versi terbaru terpasang baru; Dexie diperbarui lewat jalur upgrade normal (§3.2). Reset tidak menurunkan versi dan tidak melewati update berbasis prompt (kondisi aman tetap berlaku untuk update berikutnya, §4.7/§9.6.4) |
| Skope per tenant | Semua langkah beroperasi pada cakupan `/<slug>/pos/` tenant yang sedang dibuka; tenant lain di browser yang sama tidak terpengaruh |

#### 9.7.7 Gagal cetak

Penjualan **selalu selesai** (AP-10). Kegagalan memunculkan **banner non-blokir** + chip `print_failed` + tombol **Cetak ulang** (kalimat tindakan `PRINT_FAILED`); `PRINT_FAILED` ditulis ke `device_log`; cetak ulang tersedia dari riwayat (FR-PRN-004). Antrean `print_job` tetap asinkron dengan percobaan ulang otomatis terbatas (§7.2). Tidak ada dialog yang menahan kasir.

#### 9.7.8 Retry aksi online-only dan kunci idempoten non-outbox

| Jenis | Aturan |
|---|---|
| **Bacaan** online-only (TanStack Query) | Dicoba ulang **otomatis**, batas `retry: 2` dengan backoff pendek (1 dtk → 3 dtk), `networkMode: 'online'`; gagal ⇒ empty state/tingkat (b) |
| **Aksi yang mengubah data** (enroll, `HandOverBill`, `AcceptBill`, `CancelBillHandover`, aksi `/admin`) | **Tidak pernah diulang diam-diam** (`useMutation` `retry: 0`). Tombol **dinonaktifkan selama berjalan**; gagal ⇒ pesan + tombol **"Coba lagi" manual** |
| **Kunci idempoten klien** | Satu kunci UUIDv7 per **niat pengguna** (dibuat saat aksi dimulai, disimpan di memori/`sessionStorage` bernama per tenant sampai sukses/dibatalkan) dikirim sebagai `Idempotency-Key`. "Coba lagi" memakai kunci **yang sama**; niat baru = kunci baru |
| `HandOverBill`/`AcceptBill`/`CancelBillHandover` | Kunci = `command_id` pada `idempotency_command` (sudah dirancang SCHEMA Lampiran B; **dibedakan lewat kolom `channel` di `idempotency_command`** — keputusan user 2026-11-18): pengiriman ulang mengembalikan hasil lama tanpa efek ganda; kondisi sudah berubah ⇒ `409 HANDOVER_NOT_PENDING` |
| **Enroll** | Klien membuat `enroll_attempt_id`. Server mengikatnya pada `pairing_code` saat dipakai (`used_attempt_key`). Pengulangan dengan kunci **sama** (respons hilang) ⇒ server **menerbitkan ulang** token untuk **device yang sama** (mengganti `credential_hash`; token lama yang hilang tidak berlaku) dan membalas `device_id` yang sama; kunci **berbeda** pada kode terpakai ⇒ ditolak. *Menambah satu kolom di `pairing_code` (SCHEMA); kunci enroll dan serah-terima memakai kolom `channel` di `idempotency_command`* |
| Aksi `/admin` | Server function dengan kunci niat untuk mutasi yang berisiko ganda (impor, posting GR/transfer/opname, pemulihan register) dicatat di tabel/uji kunci idempoten modul pemiliknya; selebihnya tombol nonaktif saat berjalan |

#### 9.7.9 Source map privat dan penerjemah stack (AD-38)

| Aspek | Rancangan |
|---|---|
| Pembuatan | Saat build tiap rilis: `build.sourcemap: 'hidden'` (peta dibuat **tanpa** komentar `sourceMappingURL` di bundle publik). Skrip rilis (`scripts/deploy`) **memindahkan** `*.map` dari direktori publik ke artefak rilis **sebelum** image disusun |
| Penyimpanan **privat** (berkas per versi aplikasi; **tanpa kolom di `app_release`**, keputusan user 2026-11-18) | Di server: `releases/<appVersion>/sourcemaps/` pada volume `sourcemaps` (di luar direktori yang dilayani); **tidak pernah dilayani publik** (Nginx menolak `\.map$` dengan 404 sebagai pertahanan kedua). Dicocokkan dengan **`appVersion`** yang ada di tiap entri log klien (BR-LOG-004) |
| Pagar CI/rilis | `bundle-guard` (§8.4) gagal bila ada berkas `.map` atau teks `sourceMappingURL` di aset publik; skrip deploy memeriksa hal yang sama pada image |
| Retensi | Peta dipertahankan selama versinya masih dilaporkan perangkat (`device_sync_status.app_version`) **dan** ≥ 90 hari setelah tidak lagi dilaporkan; dipangkas oleh skrip deploy (keputusan user, OQ-A25 terjawab) |
| Penerjemah | Skrip pencarian log `logs:find` (BR-LOG-013; dibundel ke `dist/ops`) mendapat opsi untuk **menerjemahkan stack klien** (`err`, `componentStack`, `clientError`) ke **berkas dan baris asli** memakai peta `appVersion` baris itu (`@jridgewell/trace-mapping` atau setara); **alat penerjemah masuk lingkup MVP** |
| Integrasi rilis | Langkah baru di urutan deploy (§9.6.2): peta ikut paket rilis, disalin ke volume `sourcemaps` oleh skrip ops; rollback aplikasi tidak menghapus peta |

#### 9.7.10 Notifikasi operasional (Telegram) tanpa dashboard

| Pemicu | Sumber | Catatan |
|---|---|---|
| **Error fatal** proses (BR-LOG-012) | `process-handlers` (`fatal`) | Kirim sesingkat mungkin (batas 2 dtk) **sebelum** proses keluar; gagal kirim tidak menunda restart |
| **Health check gagal** | **Pemantau uptime eksternal** pada `GET /health` (layanan yang punya integrasi Telegram) + skrip deploy saat `/health` gagal/rollback | Server yang mati tidak dapat memberi tahu dirinya; karena itu pemantau eksternal |
| **Lonjakan error** | Penghitung dalam proses: jumlah `INTERNAL_ERROR`/baris `error` per jendela waktu | Ambang **keputusan user (OQ-A25)**: ≥ 10 `INTERNAL_ERROR` dalam 5 menit; maks. 1 pesan Telegram per 10 menit |

Mekanisme pengiriman (`src/server/notify/`): antrean dalam memori + pengirim **asinkron** (fire-and-forget, `timeout` 3 dtk, **pemutus sirkuit** sesudah kegagalan berturut-turut); **tidak pernah menjadi titik gagal** (kegagalan hanya `warn` di log; tidak melempar ke jalur bisnis); **batas frekuensi** (satu pesan per jenis per 10 menit dengan penggabungan/ringkasan, maks. 20 pesan/jam); deduplikasi menurut sidik jari (`kode + jenis`). **Isi pesan tanpa data pelanggan**: hanya kode, ID, jenis error, `appVersion`, lingkungan, waktu UTC, jumlah. Token bot (`TELEGRAM_BOT_TOKEN`) dan `TELEGRAM_CHAT_ID` adalah **rahasia lingkungan** (masuk daftar kunci `env.ts`, tak pernah di log/bundle); bila tak diisi, notifikasi nonaktif dengan peringatan saat boot. **Tidak ada dashboard.**

#### 9.7.11 Diagnostik tenant

**Tidak ada di MVP** (hanya CLI developer, `logs:find`); antrean "perlu perhatian" SCR-A09 tetap sebagai satu-satunya alat diagnostik tenant.

---

## 10. Matriks Traceability: Keputusan Arsitektur ↔ BR / FR / NFR

| ID | Keputusan | BR / KEP / AP | FR | NFR / EC / FLOW | Verifikasi |
|---|---|---|---|---|---|
| AD-01 | Satu app, modular monolith, `/admin` SSR & `/pos` SPA | KEP-02, KEP-20, AP-12, BR-ARC-001…012 | — | NFR-MNT-002 | dependency-cruiser, bundle-guard |
| AD-02 | Dexie + outbox; bukan PGlite | KEP-01, BR-SYN-020, BR-SYN-022 | FR-SYN-004/006 | NFR-PERF-001/004, NFR-MNT-001 | Benchmark F3, uji migrasi |
| AD-03 | `liveQuery` untuk data lokal; Query untuk online-only | AP-04 | FR-POS-003, FR-RTR-004 | NFR-PERF-003 | Playwright, tinjauan |
| AD-04 | PostgreSQL 18 + Drizzle; migrasi additive | KEP-01/05 (stack), BR-SYN-003 | — | NFR-DATA-001 | `/health`, uji migrasi |
| AD-05 | RLS per transaksi + `TenantTx` | BR-TNT-001, BR-ARC-008 | FR-TNT-004 | NFR-SEC-002 | `rls-catalog`, uji lintas-tenant |
| AD-06 | Server fn `/admin`; API bervers `/pos` | BR-SYN-022, BR-SYN-003 | FR-SYN-006/013 | EC-006, EC-007 | Uji kontrak N/N−1 |
| AD-07 | Pull counter versi, snapshot RR-RO, `(version,id)` | BR-SYN-010/011, RSK-03 | FR-SYN-001/002/003 | EC-022, FLOW-15, NFR-PERF-006 | Uji konkurensi F1 |
| AD-08 | Stage lalu apply atomik per siklus | BR-CAT-014, BR-SYN-010 | FR-SYN-017, FR-SYN-002 | EC-050, DESIGN §5.2 #32 | Playwright, uji crash |
| AD-09 | Outbox FIFO, dependensi, idempotensi | BR-SYN-020/021/023, BR-ARC-005 | FR-SYN-004/005 | EC-004, EC-027, FLOW-14, NFR-REL-001 | Test properti |
| AD-10 | ACK/RETRY/ATTENTION, backoff+jitter | BR-SYN-024, BR-SYN-030, BR-LOG-009 | FR-SYN-007, FR-ADM-001 | EC-007/011, FLOW-18 | Playwright, integrasi |
| AD-11 | Probe + state machine konektivitas | BR-SYN-040, BR-SYN-051 | FR-SYN-008/010 | DP-03, G-01 | Playwright (lie-fi) |
| AD-12 | Clock offset + `max_seen_time` + lease | BR-TIM-005/006, BR-AUT-008/013 | FR-SYN-011, FR-AUT-006 | EC-010/013, AP-08 | Unit + `page.clock` |
| AD-13 | Satu instance `/pos` (Web Locks) | EC-021 | FR-SYN-014 | DESIGN §5.2 #25 | Playwright 2 tab |
| AD-14 | Finalisasi satu transaksi IDB `strict` | BR-INV-004 | FR-POS-007 | EC-020, NFR-REL-003, NFR-PERF-001 | Uji crash/abort |
| AD-15 | Kernel bersama + vektor | AP-05/06, BR-MNY-001…008, BR-ARC-010 | FR-POS-006, FR-QA-003 | G-03 | V-01…V-30 + properti |
| AD-16 | Auth device + PIN Argon2id + lease | KEP-05, BR-AUT-001…015 | FR-AUT-*, FR-DEV-* | NFR-SEC-003/004/005, NFR-PERF-007, EC-012/036 | Uji kunci/lease, kalibrasi |
| AD-17 | PWA `injectManifest`, prompt, UpdateManager | BR-SYN-002/003, KEP-02 | FR-SYN-013/018 | FLOW-17, NFR-PERF-004, DP-12 | Playwright SW |
| AD-18 | `ReceiptDoc` + encoder + adapter + antrean | BR-PRN-001…007, AP-10 | FR-PRN-001…007 | EC-019, NFR-PERF-002, RSK-07 | Golden byte, matriks perangkat |
| AD-19 | Logging pino ala referensi | KEP-21, BR-LOG-001…014 | FR-LOG-001…008 | NFR-OBS-001/002/003 | Uji redaksi |
| AD-20 | SSE sinyal-saja | BR-SYN-041 | FR-SYN-009 | — | Playwright (sinyal hilang) |
| AD-21 | Docker Compose, satu instance | KEP-01 (stack), AS-06 | — | NFR-SEC-001 | Smoke deploy |
| AD-22 | Urutan lock tetap, HPP server | BR-STK-001, BR-HPP-001…008, BR-RCP-003 | FR-INV-002…005, FR-INV-010 | EC-003, NFR-PERF-005, RSK-08 | V-12…V-17, uji paralel |
| AD-23 | Nomor invoice: counter lokal, gap, `-Dn`, pemulihan | BR-INV-001…011 | FR-POS-015, FR-DEV-003, FR-ADM-002 | EC-008/020/034, RSK-02 | V-29, contoh BR-INV-008 |
| AD-24 | Struktur: lapisan + modul + penjaga | BR-ARC-002…012 | — | NFR-MNT-002 | CI |
| AD-25 | Roll-forward bundle `/pos` | BR-SYN-003, BR-SYN-022 | FR-SYN-006 | EC-006/007 | Uji migrasi + panduan rilis |
| AD-26 | Piramida uji, sync sebagai gerbang | KEP-15 | FR-QA-001/002/003 | NFR-TEST-001/002 | CI |
| AD-27 | Skema versi aplikasi (SemVer, tag, `X-App-Version`, footer saja) | BR-SYN-003 butir 6 | FR-DEV-004 | NFR-MNT-001, DESIGN SCR-P02/P16 | Uji aturan versi (`version-rules`), tampilan footer |
| AD-28 | Model rilis semi-manual, `/health`, rollback otomatis, staging, hotfix, konvensi | KEP-01 (stack), BR-SYN-003 | FR-SYN-013/018 | NFR-MNT-001, NFR-OBS-001, FLOW-17 | Uji skrip rilis/deploy (fake), smoke staging |
| AD-29 | Empat nomor versi, kontrak pada tiap event, upcaster permanen | BR-SYN-022, BR-SYN-021, AP-09 | FR-SYN-005/006 | EC-006, EC-007, NFR-MNT-001 | Fixture emas per versi, uji snapshot skema |
| AD-30 | Jendela N−1 ≥ 30 hari, pembaruan lunak→keras di momen aman, klien lebih baru dari server | BR-SYN-002, BR-SYN-003, BR-AUT-008 | FR-SYN-013, FR-SYN-018 | EC-006, EC-007, FLOW-17 | Playwright (update, server-behind) |
| AD-31 | Migrasi DB expand→contract, backup sebelum migrasi, PITR kelak | BR-SYN-003 butir 3, NFR-DATA-001 | — | RSK-09, RSK-12 | Uji migrasi, latihan restore |
| AD-33 | Tenant di URL (`/<slug>`), resolver tenant, tenant otoritatif = sesi/token, slug permanen, `/platform`, 404 root | KEP-03 (RLS tetap), BR-TNT-001, BR-AUT-001 | FR-TNT-001, FR-AUT-001, FR-DEV-001 | NFR-SEC-002, EC-012 | Uji lintas-tenant (slug ≠ sesi), uji daftar kata terlarang ↔ rute statis, Playwright dua tenant |
| AD-35 | Katalog kode error stabil, peta kelas→HTTP→kode→UI, tiga tingkat, login generik | BR-LOG-008, BR-SYN-030, BR-I18N-001/004 | FR-LOG-005 | NFR-OBS-002, NFR-I18N-003 | Tes snapshot registri kode, uji redaksi, uji waktu respons login |
| AD-36 | Pelaporan manual, ID offline `D-`, retry manual + kunci idempoten non-outbox | BR-LOG-005/010, BR-FNB-012 butir 4, BR-AUT-002 | FR-LOG-007, FR-FNB-013, FR-DEV-002 | EC-058, EC-060, NFR-REL-001 | Uji replay enroll/serah-terima, `logs:find` mencari ID `D-` |
| AD-37 | ErrorBoundary per area, `finalize_id`, SW terakhir-berfungsi, pemulihan statis, reset tanpa menyentuh Dexie; gagal cetak non-blokir | AP-10, BR-INV-004, BR-PRN-002, BR-SYN-052 | FR-POS-007, FR-PRN-002/004 | EC-019, EC-020, NFR-STOR-003 | Playwright (crash render, bundle rusak, SW fallback, reset) |
| AD-38 | Source map privat + penerjemah stack; notifikasi Telegram | BR-LOG-012/013, BR-LOG-007 | FR-LOG-008 | NFR-OBS-001/003, RSK-09 | bundle-guard (tanpa `.map` publik), uji penerjemah, uji notifier non-blokir |
| AD-39 | Identitas global + keanggotaan per tenant, sesi per tenant (cookie per slug, login/logout terpisah), login email-only generik, tanpa email (undangan/reset manual berkode, aturan reset lintas tenant), asumsi detail OQ-S37, pemilih `/<slug>`, tanpa warna tenant, QR berfragmen | BR-AUT-001/002/003, KEP-03 | FR-AUT-001/007, FR-DEV-001 | NFR-SEC-004/005 | Uji satu email dua tenant (login terpisah), bukan-anggota ≡ kata sandi salah (isi+waktu), pencabutan keanggotaan seketika, cookie tenant A tak terkirim ke tenant B, ubah kata sandi mencabut semua sesi, aturan R1–R4 reset, dua halaman `/<slug>/join` dan `/<slug>/reset`, daftar Undangan tertunda (daftar/batalkan/terbit ulang: owner, kode lama batal, reset penghitung penukaran, batas penerbitan), penukaran satu langkah (respons+waktu seragam, 5 gagal per email ⇒ tolak sementara, replay, undangan aktif lintas tenant memblokir reset owner, pembersih `member_code` 7 hari), tanpa sign-up publik, replay QR/kode kedaluwarsa |
| AD-40 | Rate limit dua lapisan (Nginx per IP + pustaka pembatas di app per device/akun global/slug/IP+slug/tenant); login progresif per akun global (email lintas slug) tanpa kunci permanen; `429` + `Retry-After` = RETRY transien tanpa `attempts++`; PIN lokal monotonik | BR-AUT-005, BR-AUT-014, BR-SYN-024/030, BR-LOG-007/010 | FR-AUT-004, FR-SYN-007 | NFR-SEC-004/005, NFR-REL-001 | Unit jam palsu, konfigurasi Nginx di CI (IP asli, `limit_req`), integrasi per-device/per-slug, Playwright 429 (attempts tetap, tidak OFFLINE) |
| AD-34 | Penyimpanan, kunci, saluran, cookie sesi (`Path=/<slug>`), SW, dan manifest per tenant | BR-SYN-050, BR-AUT-008, EC-021 | FR-SYN-014, FR-DEV-005 | NFR-STOR-001, NFR-SEC-002 | Playwright: dua tenant satu browser (isolasi Dexie/kunci/cookie), uji cache aset bersama |
| AD-32 | Feature flag per tenant (master data, Dexie, default per flag) | BR-SYN-001, BR-SYN-010, BR-ARC-006 | FR-SYN-002 | NFR-MNT-001 | Uji registry/default, Playwright offline |

---

## 11. Rekonsiliasi dengan PRD / SCHEMA / DESIGN

Prinsip: **PRD/SCHEMA/DESIGN menang atas brief sesi ini**. Keputusan `DISEPAKATI` tidak dibantah ulang; di bawah dicatat setiap titik brief atau rancangan ini yang berbeda atau menambah, beserta alasan. **Tidak ada kontradiksi** terhadap keputusan `DISEPAKATI` yang ditemukan; butir yang bersifat penambahan/penjelasan dipisah di §11.2–11.3.

### 11.1 Selisih brief ↔ dokumen sumber (dokumen sumber diikuti)

| ID | Topik | Brief (kemungkinan/arah) | Dokumen sumber (diikuti) | Alasan dan konsekuensi di arsitektur |
|---|---|---|---|---|
| **RK-01** | Mesin penyimpanan offline | "Kemungkinan PGlite" | **Dexie (IndexedDB) + outbox custom** — KEP-01, SCHEMA §7.6 | Perbandingan teknis §2.2: start dingin, jalur kritis kasir, atomisitas IDB, migrasi payload outbox, bundle, tidak ada sync bawaan. Tidak ada SQL di klien |
| **RK-02** | ORM | "Prisma atau Drizzle" | **Drizzle** — PRD §5.1 | Drizzle 0.45.x stabil; objek yang tak terwakili (RLS `FORCE`, trigger, `EXCLUDE`, grants) lewat migrasi SQL kustom (§2.4) |
| **RK-03** | Delta sync | "Per outlet dengan `updated_at` atau `version`" | **Counter versi per tenant** (`tenant_sync`), cursor `(version, id)` `ORDER BY version, id`, **termasuk tombstone** — BR-SYN-010/011 | `updated_at`/`now()` = awal transaksi dan sequence = saat insert, keduanya dapat **melewatkan baris** (contoh Kopi/Susu dan 101/102 di §4.3.1). Satu counter per tenant → satu cursor per device; **filter outlet** hanya menyaring baris, bukan membuat counter per outlet. `updated_at` hanya informasi |
| **RK-04** | Konflik data master | (Mengandaikan resolusi merge dua arah) | **Master hanya diedit online di `/admin`; device = salinan baca-saja; tidak ada merge** — BR-SYN-001, AP-04, SCHEMA §2.1 | Konflik master berarti dua admin: diserialkan counter versi (EC-049). Applier = satu-satunya penulis master di klien (§5.1). `version` bukan pembanding konflik |
| **RK-05** | Multi-tab | "Leader election sync, satu tab leader untuk cetak, kunci per sumber daya" | **Hanya satu instance `/pos` aktif per device**; tab kedua pasif/ditolak — EC-021, FR-SYN-014, DESIGN SCR-P15 "instance ganda" | Leader = instance aktif (kunci eksklusif); kunci sumber daya + serialisasi IDB + batas unik server sebagai pertahanan berlapis (§3.7). Tab pasif otomatis naik bila yang aktif tertutup. Opsi `steal` tidak di MVP (`OQ-A07`) |
| **RK-06** | Retry | "Exponential backoff dan jitter" | Backoff 5 dtk → 15 dtk → 1 mnt → 5 mnt (maks), tanpa batas percobaan — BR-SYN-024 (`DIUSULKAN`) | Jadwal PRD dipertahankan; **jitter ±20%** ditambahkan sebagai penambahan arsitektur (tidak mengubah urutan/batas) untuk mencegah *thundering herd* setelah gangguan |
| **RK-07** | Penerapan pull | — (PRD FLOW-15 langkah 4: upsert per halaman, cursor maju setelah halaman tersimpan) | BR-CAT-014 / FR-SYN-017: layar jual diperbarui **setelah seluruh siklus** diterapkan; EC-050 | Halaman **di-stage** (`pull_stage`, durable per halaman — memenuhi "melanjutkan tanpa kehilangan baris", FR-SYN-002) dan diterapkan **atomik per siklus**; `meta.cursor` maju saat apply. Menambah satu store Dexie klien-saja (`pull_stage`) dan kunci `meta` (`stage`, `full_resync`, `update`, `printer`, `scanner`) — **aditif**, tidak mengubah tabel server |
| **RK-08** | Audit offline | — (SCHEMA §2.4 memberi dua opsi: tersemat atau `AppendAudit` tersendiri) | BR-AUD-003: audit offline **tidak hilang** walau perintah terkait masuk "perlu perhatian" | Dipilih `AppendAudit` **tersendiri**, dibuat di transaksi Dexie yang sama (§4.2.5); `related_command_id` untuk korelasi |
| **RK-09** | `-Dn` dan antrean | PRD BR-INV-009: diterima **dan** masuk "perlu perhatian" | SCHEMA §4.6.2: `status` perintah ∈ {`ACKED`, `ATTENTION`, `ACCEPTED_MANUAL`, `DISMISSED`}; `attention_item.reason_class` ∈ {`STRUCTURAL`, `AUTHORIZATION`} | Tidak ada status "diterima-dengan-perhatian". Diasumsikan: perintah `ACKED` + `attention_item` `OPEN` (`STRUCTURAL`/`SERIES_CONFLICT`). `DIUSULKAN`; perlu satu baris klarifikasi di SCHEMA bila disetujui |
| **RK-10** | Feed lintas tabel | SCHEMA §5.2.1: `UNION ALL` satu pernyataan | BR-ARC-003: modul tak join/menulis tabel modul lain | Sync melakukan **k-way merge** hasil `FeedSource` tiap modul di satu transaksi `REPEATABLE READ` (§8.4). Hasil identik; biaya diukur (NFR-PERF-006) |
| **RK-11** | Dependensi perintah | SCHEMA Lampiran B: `FinalizeSale` ber-`dependency_key = sale:{id}` (+ `bill:{bill_id}`) | BR-SYN-023: perintah bergantung ditahan | Ditambahkan `depends_on` ke `OpenShift` (dan perintah event bill pending) agar `FinalizeSale` tidak gagal "referensi tak dikenal" bila shift belum terkirim (§4.2.3). Kolom `depends_on` sudah ada di SCHEMA |
| **RK-12** | Penomoran invoice | (Opsi seri terpusat/per outlet) | **Seri per register tanpa celah**, `{PREFIKS}-{MMYY}-{URUT6}`, dihitung lokal; gap & pemulihan; `-Dn` — BR-INV-001…011 (OQ-02 terjawab) | Seri terpusat mustahil offline tanpa alokasi blok (OQ-02 opsi B). Mekanisme §5.5; konfirmasi auditor tetap disarankan (BR-INV-011) |
| **RK-13** | HPP | (Snapshot HPP sementara di device) | **Moving average per outlet, otoritatif di server** — BR-HPP-001/004 | Device tak punya biaya; HPP kembali via ACK `cost_snapshot` (§5.3). Perbedaan akibat penjualan telat diterima (RSK-08) |
| **RK-14** | Sesi/token terenkripsi | (Sesi terenkripsi/token berumur pendek) | **Enrollment device + PIN lokal, hash lambat + salt per device, lease 7 hari, tanpa enkripsi IndexedDB di MVP** — BR-AUT-002…015, KEP-05 | §6: credential berumur panjang yang dapat dicabut (bukan token pendek, yang akan gagal diperbarui saat offline); risiko tablet dicuri diterima (RSK-05); opsi pengerasan `OQ-A05` |
| **RK-15** | Penamaan jenis register | PRD/DESIGN: `KASIR`/`PELAYAN` | SCHEMA §7.2: `register_type` ∈ {`CASHIER`, `WAITER`} | Dokumen ini memakai nilai kolom **`CASHIER`/`WAITER`** untuk kode/tipe dan **KASIR/PELAYAN** sebagai istilah konsep, mengikuti SCHEMA |

**Keputusan versioning/rilis (user, 2026-11-18) — selisih terhadap PRD/referensi:**

| ID | Topik | Dokumen sumber | Keputusan (diikuti) | Alasan dan konsekuensi |
|---|---|---|---|---|
| **RK-16** | Jendela dukungan kontrak lama | PRD BR-SYN-003 butir 3: versi yang digantikan diterima **minimal 14 hari**; Lampiran C: "N−1 minimal 14 hari" | **N−1 minimal 30 hari** (keputusan user; OQ-A19 terjawab) | Tetap memenuhi "minimal 14"; lebih panjang dari lease 7 hari. PRD Lampiran C, BR-SYN-003 (contoh 15 Desember), SCHEMA `app_release.accept_previous_until` perlu diselaraskan |
| **RK-17** *(direvisi 2026-11-18)* | Satu build vs per-klien; **prefiks URL** | Referensi: `CLIENT_ID` + prefiks `/oxy-<CLIENT_ID>-finance-dashboard/` **ditanam saat build**, satu proses per klien. Versi lama RK-17: "tanpa prefiks URL per klien" | **Satu build untuk semua tenant** (SaaS) **dengan slug tenant di URL dibaca saat runtime** (`/<slug>/pos`, `/<slug>/admin`), lewat resolver tenant yang terpisah dari bentuk URL (AD-33) | KEP-03: multi-tenant lewat RLS tetap; hanya bagian "tanpa prefiks URL" yang berubah. Pembangunan per klien tidak ada; perbandingan lengkap di §1.7. Konsekuensi: SW/manifest per tenant, penyimpanan per `tenant_id`, cookie per tenant (§2.3, §3.1, §6.2) |
| **RK-18** | CI | Referensi: tanpa CI; OQ-A11 (user): GitHub Actions | **Tanpa CI untuk rilis/deploy** (user); GitHub Actions hanya untuk gerbang tes | Dua jawaban user yang tampak bertabrakan didamaikan dengan memisah fungsi; dikonfirmasi user (OQ-A21 terjawab) |
| **RK-19** | Kondisi pembaruan keras | PRD BR-SYN-003 butir 4: diterapkan otomatis begitu **tidak ada checkout/pembayaran dan tidak ada shift terbuka** | Ditambah syarat **tanpa keranjang aktif dan tanpa antrean sync**; tidak pernah di tengah shift | Lebih ketat daripada PRD; perintah yang ditahan karena kontrak usang tidak dihitung sebagai antrean (hindari kebuntuan, §9.6.4). PRD perlu diselaraskan |
| **RK-20** | Banner versi | Referensi: `VersionBanner` bila versi klien ≠ server | **Tidak ada**; versi hanya di footer login dan SCR-P16 | DESIGN perlu menambah footer versi dan banner "server sedang diperbarui" |
| **RK-21** | Nomor versi | PRD/SCHEMA: `schema_version` (kontrak) dan versi Dexie; tidak ada versi protokol sync | **Empat nomor**: + **versi protokol sync**; kontrak menempel di tiap event; upcaster permanen | PRD BR-SYN-022 dan SCHEMA (kolom/header protokol) perlu diselaraskan |
| **RK-22** | Feature flag | Tidak ada di PRD/SCHEMA | **Per tenant, master data**, Dexie, default di kode | Butuh tabel `tenant_feature_flag` + store Dexie + FR baru |

### 11.2 Penambahan arsitektural yang tidak bertentangan (perincian yang tidak diatur dokumen sumber)

| Topik | Penambahan | Rujukan |
|---|---|---|
| Kontrak API device | Jalur `/api/pos/v1/*` bervers, amplop, kode HTTP ↔ kelas hasil, `HELD` sebagai hasil per perintah | §1.4, §2.4, §4.2 — AD-06 |
| Konteks keranjang | `ConfigSnapshot` diambil saat keranjang dibuat; baris keranjang membawa snapshot penuh; `catalog_cursor` = cursor **saat finalisasi** | §5.1 — selaras BR-CAT-013, AP-07 |
| Sinyal realtime | SSE sinyal-saja dengan `fetch` streaming; jenis pesan `pull`, `release`, `bills` | §4.6 — BR-SYN-041 |
| `command_updates` | Blok pada respons pull agar device mengetahui keputusan manager atas `NEEDS_ATTENTION` | §4.2.3 |
| `acked_device_seq` pada snapshot stok | Dibaca dalam snapshot DB yang sama dengan saldo | §4.3.3 — BR-STK-005, SCHEMA §4.6.9 |
| Anti-bypass kunci PIN | Penambahan penghitung percobaan **sebelum** verifikasi (pesimistik) | §6.4 — BR-AUT-005 |
| Mode pemulihan Dexie | Ekspor pending lewat Dexie mode dinamis bila upgrade skema gagal | §3.2 — BR-SYN-052 |
| Durability transaksi | `chromeTransactionDurability: 'strict'` | §2.2 — BR-INV-004 (ketahanan) |
| Tamper-evidence ekspor | Header berkas ekspor memuat hash SHA-256 isi | §3.5 — BR-SYN-052 |

### 11.3 Celah/ambiguitas pada dokumen sumber yang ditemukan saat menyusun (tidak diubah di sini)

| # | Dokumen | Temuan | Penanganan sementara |
|---|---|---|---|
| G-1 | SCHEMA §4.6.2/4.6.3 | Tidak ada status "diterima-dengan-perhatian" untuk konflik nomor `-Dn` | RK-09 |
| G-2 | PRD FLOW-15 langkah 4 vs BR-CAT-014 | Cursor maju per halaman vs layar jual diperbarui setelah seluruh siklus | RK-07 |
| G-3 | PRD BR-FNB-005 | Daftar event 12 jenis tak memuat `DISCOUNT_SET/BILL_SPLIT/BILL_MERGED` (sudah dicatat SCHEMA §7.2) | Mengikuti SCHEMA |
| G-4 | PRD BR-I18N-007 | "Cetak ulang identik" hanya mensnapshot bahasa; header/footer/logo tidak | `OQ-A08` |
| G-5 | DESIGN §2.1.5 | Status UI `online` dan `synced` terpisah; PRD tidak mendefinisikan kapan `synced` | Dipetakan §4.10: `synced` = ONLINE_IDLE + queue CLEAN |
| G-6 | PRD BR-AUT-013 | "Waktu berjalan monotonik" tidak melewati muat-ulang/restart peramban | Waktu dinding + offset + `max_seen_time` lintas sesi, monotonik dalam sesi (§4.5) |
| G-7 | SCHEMA §6.3 | Daftar store Dexie tak memuat `pull_stage`; kunci `meta` tak memuat `update/printer/scanner/stage` | RK-07 (aditif) |
| G-8 | PRD KEP-02 | Satu origin untuk **semua tenant**, `/admin`, dan `/pos`: XSS di halaman tenant mana pun dapat membaca IndexedDB, cookie non-`httpOnly`, dan credential device **semua tenant yang dipakai di browser itu** (penamaan per `tenant_id` mencegah **pencampuran tak sengaja**, bukan serangan) | CSP ketat; **keputusan user (OQ-A10): tetap satu origin**; subdomain per tenant (resolver sudah disiapkan, `OQ-A22`) menjadi opsi pengerasan kelak |

---

**Keputusan identitas dan URL tenant lanjutan (user, 2026-11-18):**

| ID | Topik | Sumber | Keputusan (diikuti) | Alasan dan konsekuensi |
|---|---|---|---|---|
| **RK-28** *(DIGANTIKAN 2026-11-19 oleh RK-38)* | Email/akun lintas tenant | PRD BR-AUT-001 ("satu orang = satu tenant"); SCHEMA OQ-S02/S30 (email unik se-sistem; Better Auth email/username unik global) | ~~Email boleh sama di tenant berbeda; dua akun terpisah; identitas internal turunan id~~ — **tidak berlaku lagi**; dipertahankan sebagai jejak keputusan | Lihat RK-38: kini **identitas global (email unik se-sistem)** + keanggotaan per tenant, yang justru **sejalan** dengan SCHEMA OQ-S02/S30 awal |
| **RK-32** | Nama tampilan, slug, idempotensi non-outbox (2026-11-18) | SCHEMA: `tenant.name`, `tenant.slug`; Lampiran B | Nama tampilan **diatur operator platform** (tanpa layar `/admin`); slug dijaga aplikasi + **trigger `BEFORE UPDATE OF slug`**; kata terlarang = konstanta + uji rute; peta source map = berkas privat per versi (tanpa kolom `app_release`); aksi online-only non-outbox memakai kolom **`channel`** di `idempotency_command`; ID error lokal `D-…` | SCHEMA perlu trigger slug dan kolom `channel`; DESIGN tidak menambah layar pengaturan nama |
| **RK-29** | Warna/tema tenant | Butir lama (sesi sebelumnya): manifest dinamis "nama dan warna" | **Tidak ada warna tenant di MVP**; manifest hanya nama tenant, `theme_color` = warna primer aplikasi | Menggantikan butir lama; tidak ada kolom tema di `tenant` |
| **RK-30** | `/<slug>` polos dan `/` | RK-17 sebelumnya: `/` 404 | `/` tetap 404; **`/<slug>` = halaman pemilih** "Terminal Kasir"/"Back-office"; slug tak dikenal 404 | DESIGN perlu satu layar sederhana |
| **RK-31** | QR pairing | §6.3 sebelumnya (alamat + kode) | QR = `<DOMAIN>/<slug>/pos` + `#pair=<kode>` (fragmen); sekali pakai, 15 menit; ketik manual cadangan | Kode tak masuk log proxy |

**Keputusan manajemen error (user, 2026-11-18) — selisih terhadap PRD/jawaban sebelumnya:**

| ID | Topik | Sumber | Keputusan (diikuti) | Alasan dan konsekuensi |
|---|---|---|---|---|
| **RK-23** | Pemantauan/notifikasi | PRD NFR-OBS-001/RSK-09: pemantauan di luar MVP; OQ-A12 (user): tidak, ikuti PRD | **Notifikasi Telegram** untuk error fatal, health check gagal (pemantau uptime eksternal), dan lonjakan error — **tanpa dashboard** | Menggantikan OQ-A12 sebagian: peringatan minimal **masuk MVP**; pemantauan sync-lag penuh tetap di luar. PRD (NFR-OBS-001) perlu diselaraskan |
| **RK-24** | Kode error | PRD BR-LOG-008: enam kode awal | Katalog kode domain-spesifik yang **stabil** + kalimat tindakan | Menambah kode; BR-LOG-008 perlu daftar baru dan aturan kestabilan |
| **RK-25** | ID saat offline | PRD BR-LOG-010: log device memuat "ID referensi lokal" tanpa format | Format `D-YYYYMMDD-HHmmss-xxxxx` (usulan) + field terdaftar `refLocal` | BR-LOG-005/006 perlu format dan field baru |
| **RK-26** | Source map dan penerjemah stack | PRD BR-LOG-013 (CLI mencari log), tak menyebut peta | Peta privat per rilis + penerjemah di `logs:find` (**masuk MVP**) | Mengubah paket rilis/deploy (§9.7.9) |
| **RK-27** | Tombol laporan | — | **Tidak ada** "Laporkan masalah"/paket diagnostik di MVP | DESIGN tidak boleh menambah tombol itu |

**Keputusan rate limit (user, 2026-11-18) — selisih terhadap referensi/usulan sebelumnya:**

| ID | Topik | Sumber | Keputusan (diikuti) | Alasan dan konsekuensi |
|---|---|---|---|---|
| **RK-33** | Pembatas laju di app | Referensi `financeDashboard`: `rate-limit.ts`/`login-limiter.ts` **buatan sendiri** (jendela geser di memori); usulan arsitektur awal mengikutinya | **Pustaka pihak ketiga** (kandidat `rate-limiter-flexible`) di balik lapisan tipis `lib/ratelimit/`; pembatas bawaan Better Auth **dimatikan**; buatan sendiri = cadangan | Jeda progresif, blokir berdurasi, store yang dapat diganti (Postgres/Redis) tersedia tanpa menulis ulang. Menambah dependensi baru (verifikasi `OQ-A26`); lapisan tipis menjaga bisa diganti |
| **RK-34** | `/platform` dibatasi IP | Butir sesi sebelumnya (§1.7/§9.4): `/platform` dibatasi tambahan di Nginx (mis. IP) | **Tanpa pembatasan IP**; akun platform terpisah + batas umum per IP | Membatalkan butir lama; risiko diterima (`RSK-A22`). PRD/SCHEMA tidak menyebut pembatasan IP sehingga tak ada selisih terhadapnya |
| **RK-35** | Kunci pembatasan API device | PRD NFR-SEC-005 (batas umum tanpa kunci terinci) | API terautentikasi dibatasi **per `device_id`**, bukan per IP; enroll/penebakan slug per IP + slug (enroll juga per slug) | Satu outlet = satu IP publik (NAT/seluler): batas per IP menghukum seluruh outlet; penambahan, tidak bertentangan |
| **RK-36** | Kunci utama login admin | Revisi sendiri 2026-11-18: jeda progresif per **akun + IP**, batas per IP 20–30 / 15 mnt (PRD NFR-SEC-005 tidak merinci kunci) | Revisi 2026-11-19: kunci utama = **slug + akun** (tanpa IP); **lalu** (identitas global, RK-38) kunci utama = **akun global** (`auth_user_id`/hash email, tanpa IP dan tanpa slug); IP hanya **jaring pengaman longgar** per IP + slug (±100/15 mnt); hitungan **per slug** (mode waspada); hitungan nama palsu dibatasi ukuran (user: "satu daerah bisa memakai IP yang sama") | Membatalkan kunci akun+IP agar satu IP bersama tak menghukum rekan dan agar penyerang yang memutar IP tak mendapat percobaan baru per IP. Kunci `slug + email` ditolak: melipatgandakan jatah tebakan per slug yang ditebak, padahal kata sandinya satu. **Harga:** pihak luar dapat menunda pemilik hingga 15 mnt **di semua tenant**-nya (G-RL1, §6.9.10) — **diterima tanpa mitigasi** (OQ-A27 terjawab opsi D). PRD NFR-SEC-005 diselaraskan |
| **RK-37** *(DICABUT 2026-11-19 oleh OQ-A29)* | Cookie sesi per tenant | Keputusan 2026-11-18 (AD-34/§6.2): cookie `Path=/<slug>` bernama per tenant; fetch kustom menulis ulang `/_serverFn/…`, `rewrite` Nginx + `X-Tenant-Slug`, pabrik instance Better Auth per slug (RSK-A18) | ~~Satu cookie sesi global~~ — **tidak berlaku**; sempat diusulkan di revisi identitas global (2026-11-19) lalu **digantikan** keputusan user: **cookie per slug dipertahankan** (RK-41) | Dipertahankan sebagai jejak keputusan; RSK-A18 kembali penuh; OQ-A02 butir (4) berlaku lagi |
| **RK-38** | Model identitas back-office | PRD BR-AUT-001 (satu orang = satu tenant); keputusan 2026-11-18 (RK-28): dua akun terpisah per tenant, alias `…@auth.solva.invalid` | **Identitas global + keanggotaan per tenant** (Better Auth *organization*): satu email = satu akun, satu kata sandi, peran per tenant (`app_user` dengan `auth_user_id` nullable); login hanya email; bukan anggota ⇒ pesan generik; staf kasir tanpa akses back-office tanpa akun global (PIN saja) | Keputusan user 2026-11-19 (pola Square/Shopify/Toast). **Menggantikan RK-28**; sejalan dengan SCHEMA OQ-S02/S30 awal (email unik se-sistem). PRD BR-AUT-001 dan SCHEMA perlu diselaraskan (§11.4) |
| **RK-39** | Tanpa email di MVP | PRD FR-AUT-007 (reset kata sandi/PIN) dan keputusan 2026-11-18 (halaman lupa kata sandi per tenant, `sendResetPassword`) | **Tanpa SMTP, verifikasi email, dan "Lupa kata sandi" mandiri**; undangan dan reset **manual lewat kode sekali pakai** (§6.2.1); aturan R1–R5 untuk reset lintas tenant; 2FA owner fase lanjut | Keputusan user 2026-11-19. Risiko pengambilalihan lintas tenant (RSK-A27), satu identitas banyak tenant (RSK-A28), pemulihan manual/squatting (RSK-A29). Alur dan aturan `PERLU KONFIRMASI` `OQ-A28` |
| **RK-40** *(DIGANTIKAN 2026-11-19 oleh RK-41)* | Tenant otoritatif di `/admin` | AD-33 (2026-11-18): tenant otoritatif = sesi; slug dicocokkan, beda ⇒ ditolak | ~~Tenant per permintaan dari keanggotaan~~ — **tidak berlaku** | Tenant otoritatif kembali = sesi terikat tenant (AD-33), ditambah pemeriksaan status keanggotaan tiap permintaan dan saat login |
| **RK-41** | Sesi per tenant, akun global | PRD BR-AUT-001/BR-AUT-008 (satu sesi per tenant), keputusan 2026-11-18 (cookie `Path=/<slug>`); revisi identitas global 2026-11-19 (sesi global, usulan saya) | **Akun global (satu email, satu kata sandi) tetapi sesi per tenant**: login terpisah per tenant, logout per tenant, keanggotaan diperiksa saat login dan tiap permintaan; ubah/reset kata sandi mencabut sesi di semua tenant (user 2026-11-19, OQ-A29) | Menggantikan usulan sesi global (RK-37/RK-40 dicabut). `getAuthContext`, CSRF, multi-tab ditulis ulang (§6.2); dampak: pengguna multi-tenant login ulang per tenant (kata sandi sama) |
| **RK-42** | Asumsi detail identitas (OQ-S37) | SCHEMA (peran Better Auth, email di `app_user`) | Peran Better Auth = cerminan kasar, izin dari tabel kita; **email tidak disalin ke `app_user`**; ganti email hanya pemilik akun/operator; `auth_user_id` dipertahankan pada anggota keluar (undang ulang = aktifkan kembali); kunci rate limit login = email lintas slug (user 2026-11-19) | SCHEMA diselaraskan (§11.4); `auth_account_membership_count` hanya `ACTIVE`; daftar pengguna `/admin` membaca email lewat fungsi sempit tenant-pemanggil |
| **RK-43** | Detail kode undangan/reset (OQ-S39) | Usulan §6.2.1 sebelumnya: kolom `attempts`, tabel `membership_invite`, dua cabang penukaran (kode dulu, lalu kata sandi) | **Tabel `member_code`** (`tenant_id` NOT NULL, RLS seragam; email terikat; hash; tanpa kolom percobaan — hitungan di memori); kode 10 karakter alfabet 32; **penukaran satu langkah** (email + kode + kata sandi) tanpa membuka keberadaan akun; hitungan keanggotaan menyertakan undangan aktif lintas tenant; retensi 7 hari + pembersih pekerja latar; reset operator memakai konteks satu tenant anggota; **pra-klaim email diterima** (user 2026-11-19) | Menggantikan alur dua langkah (yang membuka cabang akun-ada bagi pemegang kode) dan `attempts`; batas laju penukaran per email dan per slug (§6.9.3). SCHEMA diselaraskan (§11.4) |
| **RK-44** | Halaman penerima kode dan Undangan tertunda (DOQ-26) | Usulan sebelumnya: satu rute `/<slug>/admin/join` (dan `/reset` di bawah `admin`), pembatalan undangan sebagai butir kecil | **Dua halaman publik terpisah** `/<slug>/join` dan `/<slug>/reset` (di luar guard `/admin`); daftar **"Undangan tertunda"** di `/admin` dengan **Batalkan** dan **Terbitkan ulang** (kode lama otomatis tak berlaku); fungsi `listPendingInvites`/`cancelInvite`/`reissueInvite` (owner) | Keputusan user 2026-11-19. Efek: `member_code.revoked_at` + `revoke_reason` (`CANCELED`/`REPLACED`) — **tanpa `replaced_by`** (OQ-S40; tautan hanya di `audit_log`); batas penerbitan baru (§6.9.3); terbit ulang mereset penghitung penukaran `slug + email`; undangan aktif menahan reset owner tenant lain (diterima). Tidak masuk kata terlarang slug (bukan segmen slug) |
| **RK-45** | Pengalih tenant dan `list_memberships` | Usulan saya (revisi identitas global 2026-11-19): menu pengalih tenant + fungsi `list_memberships(auth_user_id)` | **Tidak ada pengalih tenant** (user 2026-11-19, selaras DESIGN DOQ-24); `list_memberships` **dihapus** (hanya dipakai pengalih); pengguna multi-tenant membuka `/<slug-lain>/admin` langsung dan login terpisah | Sesi per slug membuat pengalih tidak berguna (tetap harus login). Header hanya menampilkan nama tenant aktif (teks) |
| **RK-46** | Detail `member_code` (OQ-S40) | Usulan sebelumnya: satu kode aktif per `(tenant_id, email, kind)`, `CANCELLED`/`REISSUED`, `replaced_by`, `revoked_by`, audit `membership.*` | **Satu kode aktif per `(app_user_id, kind)`** (undangan membuat profil `PENDING`); `revoke_reason` `CANCELED`/`REPLACED`; **tanpa `replaced_by`/`revoked_by`** (penerbit di `issued_by` + `audit_log.actor`); batal undangan murni ikut soft-delete profil `PENDING`; kode dihapus 7 hari setelah kedaluwarsa/terpakai dan profil `PENDING` yatim di-soft-delete; audit `member.*`; hitungan keanggotaan = `auth_account_membership_count` (termasuk `PENDING`) | Mengikuti SCHEMA §4.1.19 |

### 11.4 Keselarasan dengan PRD / SCHEMA / DESIGN (status 2026-11-19)

PRD, SCHEMA, dan DESIGN direvisi paralel dan **sudah memuat** butir keselarasan yang sebelumnya didaftar di sini (versi terkini ketiganya di folder `docs/`, termasuk DOQ-24/26). Daftar lama **dihapus** karena sebagian bertentangan dengan keputusan yang berlaku (mis. "akun terpisah per tenant", `find_login_identity`, halaman lupa kata sandi per tenant, pengalih tenant, `replaced_by`). Yang tersisa: riwayat ringkas (bukan instruksi) dan butir yang **masih berlaku**.

**A. Riwayat — SELESAI / DIGANTIKAN (jejak keputusan; tidak berisi instruksi)**

| Topik | Status | Catatan |
|---|---|---|
| Manajemen error: 22 kode, ID offline `D-…`, notifikasi Telegram, source map, kunci idempoten non-outbox (`channel`, `used_attempt_key`), `finalize_id` | **SELESAI** | PRD (KEP-25, BR-ERR-*, OQ-32); SCHEMA (OQ-S31..S33). Rujukan teknis §9.7 |
| Tenant di URL: slug permanen, pemilih `/<slug>`, QR berfragmen, nama tampilan oleh operator, tanpa warna tenant | **SELESAI** | PRD (KEP-24, BR-TEN-*); SCHEMA (OQ-S27..S35). Rujukan §1.7 |
| Versioning/rilis: jendela N−1 30 hari, pembaruan keras di momen aman, versi protokol sync, feature flag per tenant | **SELESAI** | PRD (KEP-23, BR-VER-*, OQ-29); SCHEMA (OQ-S25/S26). Rujukan §9.6 |
| Rate limit dua lapisan, kunci per `device_id`/email lintas slug/IP+slug | **SELESAI** | PRD (KEP-26, BR-RLM-*); rujukan teknis §6.9 (AD-40) |
| Identitas global + keanggotaan per tenant, login email-only, tanpa email, sesi per slug, `member_code` (undangan 72 jam/reset 24 jam, penukaran satu langkah), aturan reset R1–R5, Undangan tertunda, halaman `/<slug>/join` dan `/<slug>/reset` | **SELESAI** | PRD (BR-AUT-001, FR-AUT-*); SCHEMA (§4.1.19, OQ-S37..S40); DESIGN (DOQ-24/26). Rujukan §6.2.1 (AD-39) |
| "Akun terpisah per tenant", alias `…@auth.solva.invalid`, `username` Better Auth, `find_login_identity`, email di `app_user`, halaman lupa/reset kata sandi per tenant, **pengalih tenant**, `list_memberships`, kolom `replaced_by`/`revoked_by`, ejaan `CANCELLED`/`REISSUED`, audit `membership.*` | **DIGANTIKAN** | Tidak boleh dipakai; lihat RK-28 (digantikan RK-38), RK-45, RK-46 |

**B. Butir yang masih berlaku (perlu dipastikan di dokumen sumber)**

| Dokumen | Butir |
|---|---|
| **SCHEMA.md** | §5.6 butir 5 (±baris 2422) masih menyebut sesi Better Auth **"global per origin"** dan isolasi oleh penjaga keanggotaan "bukan oleh pemisahan sesi" — harus **sesi per slug** (OQ-S37 terjawab; AD-34/AD-39 arsitektur) |
| **SCHEMA.md** | Pemeriksaan keanggotaan saat login: arsitektur memakai fungsi sempit `SECURITY DEFINER` (disebut `resolve_membership`) selain `auth_account_membership_count`; nama final fungsi login ditetapkan di SCHEMA |
| **DESIGN.md** | Tidak ada butir baru dari arsitektur: header `/admin` memuat nama tenant aktif (teks), **tanpa pengalih tenant** (sudah DOQ-24) |
| **PRD.md** | Tidak ada butir baru dari arsitektur pada revisi ini |

---

## 12. Risiko Arsitektur dan Mitigasi

Melengkapi PRD Bab 14 (RSK-01…13; tidak diulang). Prefiks `RSK-A` = risiko teknis arsitektur.

| ID | Risiko | Dampak | Mitigasi | Spike / fase |
|---|---|---|---|---|
| **RSK-A01** | Integrasi **TanStack Start + `vite-plugin-pwa`** (dua environment build) dan penyediaan **shell HTML `/pos` statis** untuk start dingin offline belum terbukti | Start dingin offline gagal / SW tak ter-precache lengkap | Spike F1 pertama; Opsi A (prerender shell) → Opsi B (`NetworkFirst` + fallback) → langkah build kustom yang menyuntikkan manifest ke `sw.ts`; uji Playwright start dingin | F1 (`OQ-A02`) |
| **RSK-A02** | Peramban **menghapus IndexedDB** (`persist` ditolak, tekanan storage) sebelum sync | Transaksi pending hilang, nomor bolong (RSK-02 PRD) | `persist()` + anjuran memasang PWA; banner pending permanen; sync agresif; ekspor; gap + pemulihan; pemantauan `storage_persist` per device di `/admin` | F1/F3 |
| **RSK-A03** | Durability `strict` memperlambat transaksi, atau `relaxed` kehilangan transaksi terakhir saat mati daya | Melampaui NFR-PERF-001 atau kehilangan satu transaksi | Ukur di perangkat uji; bila `strict` terlalu lambat: `relaxed` + paksa durability pada transaksi finalisasi saja (atau `flush` setelah commit) | F3 |
| **RSK-A04** | Penerapan atomik pull besar (±16–60 ribu baris) menahan pembacaan katalog dan memakai memori di tablet murah | Layar jual terasa macet saat apply | Apply saat idle; indikator non-blokir; ambang pecah per tabel untuk full resync; ukur apply 25 ribu baris di F2 | F2 |
| **RSK-A05** | **Ukuran bundle/precache** membengkak (`decimal.js`, WASM Argon2id/zxing, font, ikon) | Start dingin > 3 dtk; update lambat | Anggaran §9.3 + `size-limit`; code-splitting; WASM malas; ganti `decimal.js` → `big.js` bila perlu | F1–F3 |
| **RSK-A06** | Variasi printer: throughput BLE, profil GATT, dialek ESC/POS, WinUSB di Windows, kiosk-print tanpa laci | Cetak lambat/gagal pada model tertentu | Adapter + profil per model; logo NV; halaman uji; daftar printer yang direkomendasikan; matriks perangkat F3 (RSK-07 PRD) | F3 |
| **RSK-A07** | Perilaku izin persisten Web Bluetooth/USB berbeda antar versi Chrome/Edge | Printer minta dipasangkan ulang tiap sesi | Status `NEEDS_PAIRING` + antrean menunggu; panduan; uji pada versi target | F3 |
| **RSK-A08** | **Rollback bundle** `/pos` ke versi lebih lama menghasilkan `VersionError` Dexie | Aplikasi tak terbuka di perangkat yang sudah naik | Kebijakan roll-forward (AD-25); mode pemulihan + ekspor; rilis bertahap; uji migrasi | F1 (`OQ-A14`) |
| **RSK-A09** | Kontensi lock `tenant_sync`/`stock_balance` saat impor besar atau backlog serentak (RSK-13 PRD) | Antrean `RETRY`, latensi naik | Transaksi pendek; impor satu transaksi; `lock_timeout` ⇒ `RETRY`; urutan lock tetap; jitter reconnect | F2/F4 |
| **RSK-A10** | Server **satu instance** (SPOF): restart, SSE putus, penghitung rate-limit di memori hilang (diterima; Nginx menahan banjir kasar, kode pairing 32⁸/15 mnt/sekali pakai) | Gangguan singkat; sinkron tertunda; batas sempat longgar setelah restart | Offline-first membuat kasir tak terdampak; restart otomatis; `/health`; backup (disiapkan menjelang produksi, OQ-A09); jalur skala (`OQ-A17`), termasuk store pembatas bersama | F1 |
| **RSK-A11** | Perbedaan perhitungan `Intl`/zona antar runtime (peramban vs Node) untuk `business_date` | Selisih tanggal bisnis client vs server | Vektor V-22/V-23 dijalankan di **kedua** runtime (Vitest Node + Playwright peramban); ICU penuh di Node | F3 |
| **RSK-A12** | Pustaka baru/muda (Better Auth 1.x, `vite-plugin-pwa` 2.0, Dexie 4, `@tanstack/react-store`) | Perubahan API/bug | Versi di-pin; spike; lapisan tipis pembungkus; tes kontrak | F1 |
| **RSK-A13** | Argon2id WASM lambat/boros memori di tablet murah | Verifikasi PIN > 500 ms | Kalibrasi parameter; cadangan PBKDF2; hitung di Web Worker | F3 |
| **RSK-A14** | Tab primer **membeku** sambil memegang kunci instance | Kasir terkunci dari `/pos` sampai tab ditutup | Pesan jelas "Tab lain tidak merespons"; panduan; tanpa `steal` (keputusan user, OQ-A07) | F3 |
| **RSK-A15** | **Drift** perhitungan bila ada duplikasi logika di luar kernel (mis. di UI) | Struk ≠ catatan server (G-03) | Aturan lint (desimal hanya di kernel; UI tak menghitung uang), vektor di kedua sisi, `SELISIH_HITUNG` sebagai deteksi | F3 |
| **RSK-A16** | Uji Playwright offline/waktu rapuh (flaky) | Gerbang CI tak dipercaya | Jam virtual (`page.clock`), adapter printer/pemindai virtual, tanpa tidur nyata, retry terbatas | F1–F3 |
| **RSK-A17** *(diperluas 2026-11-18)* | **Satu origin untuk semua tenant, `/admin`, dan `/pos`**: XSS di halaman satu tenant → akses penyimpanan lokal dan credential device **tenant lain** pada browser yang sama; slug salah/tertukar dan cookie tenant bertabrakan | Pembocoran data/credential lintas tenant | CSP ketat, tanpa HTML mentah/`dangerouslySetInnerHTML`, validasi; penyimpanan, kunci, saluran, dan cookie dinamai per tenant (AD-34); pencocokan slug ↔ tenant sesi/token di server; satu origin diputuskan user (OQ-A10); subdomain/domain kustom per tenant = opsi pengerasan (`OQ-A22`) | F1 |
| **RSK-A19** | **Layar/halaman pemulihan tidak terlayani** saat shell rusak, atau SW "terakhir berfungsi" tak dapat dipakai karena Dexie sudah naik versi; "Reset aplikasi" menghapus cache bersama dan merusak shell offline tenant lain | Kasir terkunci dari `/pos` sampai ada hotfix; offline tenant lain terganggu | `recovery.html` statis mandiri (tanpa bundle), ekspor lewat API IndexedDB polos, reset hanya entri yang dirujuk pendaftaran ini, roll-forward hotfix; uji Playwright bundle rusak | F1/F3 |
| **RSK-A20** | **Notifikasi** membanjiri atau menjadi titik gagal; kebocoran data lewat isi pesan; token bot bocor | Gangguan operasional/kebocoran | Antrean asinkron + pemutus sirkuit + batas frekuensi + dedup; isi tanpa data pelanggan; token = rahasia env; pemantau uptime eksternal | F1 (`OQ-A25`) |
| **RSK-A21** | **Source map bocor ke publik** atau tidak cocok dengan `appVersion` | Kode sumber terbuka / stack tak dapat diterjemahkan | `hidden` + dipindah sebelum image; Nginx tolak `.map`; bundle-guard; peta per `appVersion` dipertahankan sesuai retensi | F1 |
| **RSK-A22** | **`/platform` tanpa pembatasan IP** (keputusan user): kebocoran kredensial operator memberi akses lintas tenant dari mana saja | Pengambilalihan platform | Akun platform terpisah, kata sandi kuat, pembatas login progresif + batas umum Nginx, audit semua tindakan platform, 2FA bila tersedia (`DIUSULKAN`, kelak), bisa ditambah `allow` IP tanpa perubahan kode | F1 |
| **RSK-A23** | **"Tetangga berisik"**: tanpa kuota per tenant (hanya per device), satu tenant dengan banyak device/laporan berat memakan kapasitas bersama | Latensi tenant lain naik | Batas per device, semafor push bersamaan, ±2 laporan bersamaan per tenant + `statement_timeout`; log pelanggaran; jalur naik: kuota per tenant di store Postgres/Redis (`OQ-A17`) | F2/F4 |
| **RSK-A24** | **Semua klien terbaca satu IP** (salah konfigurasi `X-Real-IP`/gateway Docker/IPv6) atau header `X-Forwarded-For` klien dipercaya | Satu penyerang/outlet memblokir semua pengguna, atau penyerang memalsukan IP | Nginx menimpa header; app membaca `X-Real-IP` hanya dari proxy tepercaya; API device berkunci `device_id`; uji konfigurasi Nginx di CI + uji asap deploy (§6.9.1, §6.9.9) | F1 |
| **RSK-A26** | **Penundaan pemilik akun oleh pihak luar** (login admin berkunci akun global/email lintas slug, tanpa IP): penyerang terus gagal ⇒ jeda hingga 15 mnt bagi pemilik sah; hitungan nama palsu dapat membengkak bila tak dibatasi | Back-office tertunda (kasir `/pos` tidak terdampak); memori | Tanpa penguncian permanen, reset otomatis 15 mnt, Nginx + batas per IP+slug, hitungan dibatasi ukuran; mitigasi opsional (penanda perangkat tepercaya, reset owner, jeda lebih pendek) **belum diputuskan** `OQ-A27` (§6.9.10) | F1 |
| **RSK-A25** | **Pustaka pembatas pihak ketiga**: kompatibilitas Node 22/bundle-guard, pemeliharaan, perilaku jeda progresif belum terbukti | Dependensi baru bermasalah | Verifikasi sebelum dikunci (`OQ-A26`), lapisan tipis `lib/ratelimit/` agar dapat diganti, cadangan buatan sendiri ala referensi | F1 |
| **RSK-A18** *(kembali penuh 2026-11-19: cookie per slug dipertahankan, OQ-A29)* | **Tenant di sub-path** membebani mekanisme yang diasumsikan global: nama cache precache Workbox per-scope dan pembersihan lintas pendaftaran SW; cookie `Path=/<slug>` vs URL server function `/_serverFn/…` dan endpoint Better Auth; cookie/nama statis Better Auth | Aset hilang di tenant yang SW-nya belum naik; sesi `/admin` tidak terkirim; build pecah | Cache aset bersama + pencatatan manifest per pendaftaran; `fetch` kustom + Nginx `rewrite` + `X-Tenant-Slug`; pabrik instance Better Auth per slug; cadangan `Path=/` + nama cookie per tenant; spike F1 | F1 (`OQ-A02`) |
| **RSK-A27** | **Pengambilalihan akun lintas tenant lewat reset manual**: owner tenant A mereset kata sandi akun yang juga owner tenant B (tanpa email, reset dilakukan manusia) | Pengambilalihan tenant B | Aturan R1–R5 (§6.2.1): owner hanya mereset akun yang keanggotaannya **hanya di tenantnya** (diperiksa saat penerbitan **dan** penukaran); akun multi-tenant/owner hanya operator platform atau pemiliknya; kode reset sekali pakai (penerbit tak menetapkan/melihat kata sandi); audit; pesan penolakan generik. `PERLU KONFIRMASI` `OQ-A28` | F1 |
| **RSK-A28** | **Satu identitas membuka banyak tenant** (akun global); tanpa 2FA di MVP (keputusan user): **kata sandi** owner yang bocor membuka semua tenantnya (sesi curian satu tenant **tidak**, karena sesi per tenant) | Kebocoran lintas tenant satu orang | Kebijakan kata sandi, pembatas login (§6.9), audit/log, sesi sliding terbatas, `/admin` online-only, ubah kata sandi mencabut semua sesi; **2FA owner = fase lanjut** | F1; fase lanjut |
| **RSK-A29** | **Tanpa email**: tak ada pemulihan mandiri; operator platform menjadi titik pemulihan (verifikasi identitas di luar sistem, **belum dirancang**); email tak terverifikasi (salah ketik). **Pra-klaim email (squatting) oleh pemegang kode undangan: `DITERIMA` di MVP** (user 2026-11-19, OQ-S39) | Pemilik terkunci menunggu operator; akun atas email orang lain | Owner hanya mereset akun yang hanya di tenantnya (hitungan menyertakan undangan aktif lintas tenant); **bergabung ke tenant lain butuh kode tenant itu + kata sandi akun**; audit; operator dapat mereset; penukaran satu langkah berespons seragam; SMTP/verifikasi email = fase lanjut | F1; fase lanjut |

---

## 13. Open Questions Arsitektur (`PERLU KONFIRMASI`)

> Tidak ada butir yang **memblokir** penulisan dokumen; semuanya punya **asumsi sementara** yang dipakai di Bab 1–10. Kolom "Dibutuhkan sebelum" menunjukkan kapan jawaban sebaiknya sudah ada. Jawaban yang mengubah asumsi cukup menyunting bagian yang disebut.

### 13.1 Ringkasan

| ID | Topik | Rekomendasi (asumsi sementara) | Dibutuhkan sebelum | Bagian terkait |
|---|---|---|---|---|
| OQ-A01 | Reverse proxy & TLS | **TERJAWAB 2026-11-18: Nginx + certbot** (berbeda dari asumsi awal Caddy) | — | §1.6 |
| OQ-A02 | Spike integrasi Start + PWA + shell `/pos` statis | **TETAP TERBUKA (keputusan user 2026-11-18: tunda sampai hasil spike)**; rencana kerja: Opsi A (prerender) → B → C; pilihan cadangan diputuskan user setelah ada data | Awal F1 (hasil spike) | §2.3 |
| OQ-A03 | Pustaka state keranjang | **TERJAWAB 2026-11-18: `zustand`** + persist Dexie sendiri | — | §2.1 |
| OQ-A04 | ~~Jalur cetak mana yang dipilih~~ **DIKOREKSI 2026-11-18**: jalur cetak ditentukan **perangkat keras klien** (USB, Bluetooth BLE, atau printer driver Windows) — bukan keputusan arsitektur. Ketiga adapter didukung, dipilih **per device** di SCR-P16 | Tidak ada keputusan tersisa; hanya **masukan**: daftar model printer klien untuk matriks sertifikasi F3 | Saat klien pertama diketahui (F3) | §7.2 |
| OQ-A05 | Pengerasan credential device | **TERJAWAB 2026-11-18: tidak di MVP** (token statis, dapat dicabut) | — | §6.6 |
| OQ-A06 | Skema hash PIN: algoritma dan tempat hitung | **TERJAWAB 2026-11-18: Argon2id, dihitung di server** saat set PIN (cadangan PBKDF2; parameter dikalibrasi F3) | — | §6.2, §6.4 |
| OQ-A07 | Pengambilalihan kunci instance (`steal`) | **TERJAWAB 2026-11-18: tidak ada**; tab lama ditutup | — | §3.7 |
| OQ-A08 | Snapshot header/footer/logo untuk cetak ulang identik | **TERJAWAB 2026-11-18: cukup bahasa yang sama** (tanpa perubahan SCHEMA) | — | §7.2 |
| OQ-A09 | Backup minimal sebelum go-live | **TERJAWAB 2026-11-18: ya**, `pg_dump` harian + salinan luar VPS + uji restore disiapkan menjelang produksi | — | §9.5 |
| OQ-A10 | Origin: satu (path) vs dua subdomain | **TERJAWAB 2026-11-18: satu origin** untuk semua tenant, `/admin`, dan `/pos` + CSP ketat (cakupan diperluas oleh AD-33/34: isolasi lintas tenant) | — | §1.7, §9.4, RSK-A17 |
| OQ-A22 | Domain kustom per tenant (dan subdomain) | **TERJAWAB 2026-11-18: ditunda**, tanpa pekerjaan di MVP; resolver disiapkan; TLS per domain via certbot saat itu | — | §1.7 |
| OQ-A23 | Normalisasi URL berhuruf kapital dan garis miring akhir | **TERJAWAB 2026-11-18 (default): 308 ke huruf kecil kanonis**, bukan open lagi | — | §1.7 |
| OQ-A24 | Daftar final kode error dan kalimat tindakan | **TERJAWAB 2026-11-18: 22 kode di §9.7.1 diterima** (PRD diselaraskan sesi PRD) | — | §9.7.1 |
| OQ-A25 | Ambang lonjakan error untuk notifikasi, dan retensi source map | **TERJAWAB 2026-11-18: ≥ 10 `INTERNAL_ERROR` dalam 5 menit; maksimal 1 pesan Telegram per 10 menit; peta disimpan selama versi masih dilaporkan perangkat + 90 hari** | — | §9.7.9, §9.7.10 |
| OQ-A11 | Platform CI | **TERJAWAB 2026-11-18: GitHub Actions** | — | §9.5 |
| OQ-A12 | Pemantauan minimal | **TERJAWAB 2026-11-18: tidak, ikuti PRD**; **kemudian disempurnakan (RK-23): notifikasi Telegram minimal (fatal, health check gagal, lonjakan error) masuk MVP, tanpa dashboard**; uptime check eksternal dipakai; ringkasan log berkala tetap opsional | — | §9.1, §9.7.10 |
| OQ-A13 | Peramban resmi di perangkat Android | **TERJAWAB 2026-11-18: Chrome saja** (Edge di Windows) | — | §2.3, §7.2 |
| OQ-A14 | Kebijakan rollback bundle `/pos` | **TERJAWAB 2026-11-18: roll-forward saja** | — | §3.2 |
| OQ-A15 | Satu paket vs npm workspaces | **TERJAWAB 2026-11-18: satu paket** (user menanyakan alasan paket terpisah; dijelaskan bahwa itu hanya opsi bila kode dipakai proyek lain, sehingga tidak diperlukan) | — | §8.3 |
| OQ-A16 | Katalog tenant jauh > 5.000 SKU | **TERJAWAB 2026-11-18:** default tetap unduh seluruh katalog (PRD OQ-27c); **hanya sebagai cadangan** untuk katalog sangat besar beralih ke "hanya item tersedia di outlet" (diputuskan per tenant setelah pengukuran F2) | — | §4.3.2 |
| OQ-A17 | Kesiapan multi-instance server | **TERJAWAB 2026-11-18: tidak, satu instance** (jalur `LISTEN/NOTIFY` dicatat) | — | §4.6, §9.5 |
| OQ-A18 | Versi Node.js | **TERJAWAB 2026-11-18: Node 22 LTS (≥ 22.12)** | — | §2.4 |
| OQ-A19 | Jendela dukungan kontrak lama (N−1) | **TERJAWAB 2026-11-18: 30 hari**; pembaruan keras **hanya saat shift tertutup** (tanpa keranjang aktif, antrean kosong) | — | §3.2, §9.6.4 |
| OQ-A20 | Ambang ukuran data untuk pindah ke PITR | **TERJAWAB 2026-11-19: ±10 GB, atau dump penuh + salinan keluar > ±15 menit** (asumsi disahkan user) | — | §9.6.5 |
| OQ-A21 | "Tanpa CI untuk rilis" vs gerbang tes GitHub Actions (OQ-A11) | **TERJAWAB 2026-11-18: tes otomatis sebagai gerbang di GitHub Actions; rilis dan deploy tetap manual dari komputer user** | — | §9.5, §9.6.2 |
| OQ-A26 | Pustaka pembatas laju final dan kalibrasi nilai batas | **TERJAWAB (arah) 2026-11-19: `rate-limiter-flexible`; dikunci final setelah verifikasi teknis awal F1** (Node 22, bundle-guard, jam palsu, jeda progresif; cadangan buatan sendiri). Kalibrasi nilai dari log tetap berjalan | Awal F1 (verifikasi); sebelum produksi (nilai) | §6.9.4, §6.9.8 |
| OQ-A27 | Mitigasi penundaan pemilik akun pada login admin | **TERJAWAB 2026-11-19: opsi (D) tanpa mitigasi, hanya log** (jeda maks. 15 mnt; kunci = akun global) | — | §6.9.10, RSK-A26 |
| OQ-A28 | Alur undangan dan reset kata sandi **tanpa email**, serta aturan keamanan reset lintas tenant (R1–R5) | **TERJAWAB 2026-11-19: opsi (a)** — kode sekali pakai terikat email (undangan 72 jam, reset 24 jam), penerbit tak menetapkan/melihat kata sandi, owner hanya mereset akun yang keanggotaannya hanya di tenantnya (dicek saat penerbitan dan penukaran), akun multi-tenant dan owner hanya operator platform atau pemiliknya, penolakan generik. **Prosedur operator (verifikasi identitas di luar sistem) belum dirancang** | — | §6.2.1, RSK-A27/A29 |
| OQ-A29 | Kebijakan sesi: satu sesi global vs sesi per tenant | **TERJAWAB 2026-11-19: cookie sesi PER SLUG, login terpisah per tenant; akun tetap global** (menggantikan asumsi "tenant per permintaan, satu sesi global"); setelah login server memeriksa keanggotaan; logout hanya sesi tenant itu | — | §6.2, RK-41 |

### 13.2 Rincian

**OQ-A01 — Reverse proxy & TLS — `TERJAWAB` (2026-11-18): Nginx + certbot** (berbeda dari asumsi awal; konfigurasi SSE disesuaikan di §1.6 dan §4.6, tidak ada dampak pada aplikasi). Teks opsi awal dipertahankan sebagai jejak keputusan. *Rekomendasi awal:* **Caddy 2** (sertifikat Let's Encrypt otomatis, HSTS, kompresi, konfigurasi beberapa baris, `flush_interval -1` untuk SSE). *Opsi:* (a) Nginx + certbot — sangat umum, lebih banyak konfigurasi/pembaruan sertifikat manual; (b) Traefik — dinamis, lebih berat untuk satu layanan. *Dampak:* kemudahan operasi solo developer; tidak mengubah aplikasi. *Asumsi:* Caddy.

**OQ-A02 — Spike integrasi TanStack Start + `vite-plugin-pwa` — `TETAP TERBUKA` (2026-11-18): user menunda pemilihan cadangan sampai hasil spike; hasil dan data dilaporkan lebih dulu, lalu user memilih.** `VERIFIKASI` bahwa (1) plugin PWA menghasilkan manifest precache untuk build klien Start; (2) shell `/pos` dapat dibuat statis (prerender) dan menjadi `navigateFallback`; (3) satu skrip `/sw.js` dapat didaftarkan per cakupan `/<slug>/pos/`, dengan satu cache aset bersama dan pembersihan yang aman lintas pendaftaran (RSK-A18); (4) cookie `Path=/<slug>` bekerja dengan URL server function berawalan slug dan endpoint Better Auth (§6.2) — **berlaku lagi** (user 2026-11-19, OQ-A29: sesi per slug; sempat gugur di revisi sesi global yang sama hari itu). *Opsi:* A prerender shell; B `NetworkFirst` + fallback cache; C langkah build kustom (skrip menyalin HTML shell + manifest Workbox). *Dampak:* kelayakan start dingin offline (NFR-PERF-004). *Asumsi:* A, dengan B/C sebagai cadangan.

**OQ-A03 — Pustaka state keranjang — `TERJAWAB` (2026-11-18): `zustand`.** Teks opsi awal dipertahankan sebagai jejak keputusan: *Opsi:* (a) **`zustand`** 5.x — stabil, kecil, mudah di-persist manual; (b) `@tanstack/react-store` 0.11 — satu ekosistem tetapi versi 0.x; (c) `useReducer` + context — nol dependensi, re-render lebih luas. *Dampak:* bentuk hook `use-cart`; tidak memengaruhi data/sync. *Asumsi:* (a).

**OQ-A04 — Printer — `DIKOREKSI` (2026-11-18).** Pertanyaan awal ("jalur cetak mana yang dipakai di Windows") **salah arah**: jalur cetak ditentukan oleh **perangkat keras yang dimiliki klien** (USB, Bluetooth BLE, atau printer berdriver Windows), bukan oleh keputusan arsitektur. Sesuai PRD (BR-PRN-001) dan §7.2, **ketiga adapter didukung** dan dipilih **per device** di SCR-P16 (`meta.printer`); tidak ada pilihan yang harus dikunci. Yang tersisa hanya **masukan** (bukan keputusan): daftar model printer klien (USB/BLE/driver Windows) untuk profil GATT BLE, ukuran chunk/jeda tulis, code page, dukungan potong/laci/NV logo, dan **matriks sertifikasi perangkat F3**. *Penyesuaian dokumen:* urutan *pengerjaan* adapter di F3 mengikuti printer klien pertama; encoder ESC/POS tetap buatan sendiri dengan profil generik 58/80 mm sampai model klien diketahui.

**OQ-A05 — Pengerasan credential device — `TERJAWAB` (2026-11-18): tidak di MVP.** Teks opsi awal dipertahankan sebagai jejak keputusan: *Opsi:* (H1) kunci non-extractable + tanda tangan per request; (H2) rotasi token pada pembaruan bergulir; (H3) enkripsi lapis-amplop IndexedDB; (H4) batasi `staff_pin` yang diunduh; (H5) WebAuthn (rinci §6.6). *Dampak:* keamanan tablet hilang/dicuri (RSK-05); kompleksitas dan kinerja. *Asumsi:* **tidak ada di MVP** (BR-AUT-011); dievaluasi sebelum produksi jangka panjang.

**OQ-A06 — Hash PIN — `TERJAWAB` (2026-11-18): Argon2id, dihitung di server saat PIN diatur/direset.** Cadangan PBKDF2 bila WASM gagal; parameter (memori/iterasi) tetap dikalibrasi pada perangkat uji F3. Teks opsi awal dipertahankan sebagai jejak keputusan: (1) **Algoritma:** Argon2id (WASM, memory-hard, lebih tahan GPU) vs PBKDF2-SHA256 (native, cepat, tanpa WASM, lebih lemah terhadap GPU untuk ruang PIN kecil). (2) **Tempat hitung `verifier`:** di server saat set/reset PIN (dapat menegakkan kebijakan PIN) vs di browser `/admin` (server tak pernah melihat PIN). *Dampak:* NFR-PERF-007, keamanan PIN, ukuran bundle. *Asumsi:* Argon2id (+ cadangan PBKDF2), hitung di server; parameter dikalibrasi di perangkat uji F3.

**OQ-A07 — `steal` kunci instance — `TERJAWAB` (2026-11-18): tidak ada; tab lama ditutup.** Teks opsi awal dipertahankan sebagai jejak keputusan: Bila tab primer beku, apakah boleh ada tombol "Gunakan tab ini" (`navigator.locks` `steal: true`)? *Risiko:* tab lama dapat mid-transaksi (IDB tetap atomik, tetapi UI/state kacau). *Asumsi:* tidak ada; pengguna menutup tab lama. *Dampak:* RSK-A14.

**OQ-A08 — Cetak ulang identik — `TERJAWAB` (2026-11-18): cukup bahasa struk yang sama (opsi A); tanpa perubahan SCHEMA.** Teks opsi awal dipertahankan sebagai jejak keputusan: PRD hanya mewajibkan **bahasa** struk yang sama (BR-I18N-007). Bila header/footer/logo outlet diubah, cetak ulang invoice lama memakai versi baru. *Opsi:* (A) terima (asumsi); (B) snapshot `receipt_header/footer/logo_sha256` ke `sale` (perubahan SCHEMA + ukuran). *Dampak:* kesesuaian audit atas salinan struk.

**OQ-A09 — Backup minimal — `TERJAWAB` (2026-11-18): ya, disiapkan menjelang produksi** (tetap di luar kriteria selesai MVP). Teks opsi awal dipertahankan sebagai jejak keputusan: PRD memasukkan backup off-site di luar MVP (RSK-09). *Rekomendasi:* tetap menyiapkan `pg_dump` harian ke volume lain + salinan keluar VPS dan **uji restore** sebelum go-live (biaya rendah, risiko kehilangan data tinggi bila diabaikan). *Opsi:* tidak sama sekali (sesuai PRD); WAL archiving/PITR (pasca-MVP). *Asumsi:* dump harian disiapkan menjelang produksi.

**OQ-A24 — Daftar final kode error — `TERJAWAB` (2026-11-18): 22 kode di §9.7.1 diterima.** Teks opsi awal dipertahankan sebagai jejak keputusan: Keputusan user: katalog domain-spesifik yang stabil; **daftar final belum**. Asumsi: daftar di §9.7.1 (6 kode umum + `PRINT_FAILED`, `PIN_LOCKED`, `DEVICE_REVOKED`, `UPDATE_REQUIRED`, `STORAGE_LOW`, `SYNC_HELD`, dll.). *Dampak:* kamus i18n `error.<KODE>.action`, uji snapshot registri; karena kode **tak boleh berubah arti**, daftar sebaiknya dikunci sebelum rilis pertama yang mengirim kode ke lapangan.

**OQ-A25 — Ambang notifikasi dan retensi source map — `TERJAWAB` (2026-11-18): ≥ 10 `INTERNAL_ERROR` dalam 5 menit; maksimal 1 pesan Telegram per 10 menit; retensi peta = selama versi masih dilaporkan perangkat + 90 hari.** Teks opsi awal dipertahankan sebagai jejak keputusan: *Ambang lonjakan:* asumsi ≥ 10 `INTERNAL_ERROR` dalam 5 menit; opsi ambang per jenis atau per persentase request. *Retensi peta:* asumsi selama versi masih dilaporkan perangkat + 90 hari; opsi 12 bulan tetap. *Dampak:* kebisingan notifikasi dan ruang disk volume `sourcemaps`.

**OQ-A22 — Domain kustom per tenant — `TERJAWAB` (2026-11-18): ditunda; tanpa pekerjaan di MVP, resolver disiapkan, TLS per domain via certbot saat itu.** Teks opsi awal dipertahankan sebagai jejak keputusan: Keputusan user: **belum diputuskan**; hanya resolver tenant yang disiapkan (§1.7). *Opsi:* (A) tetap sub-path `/<slug>` untuk semua (asumsi); (B) subdomain `<slug>.<DOMAIN>`; (C) domain kustom milik tenant. *Dampak:* **TLS** (certbot per domain via HTTP-01, atau wildcard via DNS-01), **domain staging**, aturan Nginx, cookie, dan — terpenting — **perubahan origin memutus IndexedDB/SW/izin perangkat**: device harus di-enroll ulang dan antrean harus tersinkron lebih dulu; juga memberi isolasi origin per tenant (mengurangi RSK-A17). *Asumsi:* sub-path saja.

**OQ-A23 — Normalisasi URL — `TERJAWAB` (2026-11-18, sebagai default): opsi A, 308 ke huruf kecil kanonis; bukan open lagi.** Teks opsi awal dipertahankan sebagai jejak keputusan: *Opsi:* (A) 308 ke bentuk kanonis huruf kecil tanpa garis miring ganda (asumsi); (B) perlakukan slug tak peka huruf tanpa pengalihan (lebih permisif; URL ganda untuk satu tenant, mempersulit scope SW/cookie); (C) 404 untuk huruf kapital. *Dampak:* kebenaran scope SW, `Path` cookie, dan registri slug. 

**OQ-A10 — Origin — `TERJAWAB` (2026-11-18): satu origin + CSP ketat** (opsi A; diperluas: satu origin untuk **semua tenant**, `/admin`, dan `/pos`, dengan isolasi dengan penamaan per tenant, §1.7/AD-34). Dua subdomain tetap dicatat sebagai opsi pengerasan bila risiko XSS dinilai perlu kelak. Teks opsi awal dipertahankan sebagai jejak keputusan: KEP-02 menetapkan satu app dengan `/admin` dan `/pos` (satu origin). *Isu:* XSS di `/admin` dapat membaca IndexedDB/credential `/pos` (G-8, RSK-A17). *Opsi:* (A) satu origin + CSP ketat (asumsi); (B) dua subdomain (`admin.` dan `pos.`) yang dilayani **instance yang sama** dengan routing berdasarkan `Host` — isolasi IndexedDB/cookie/SW, biaya: dua sertifikat dan pemisahan rute per host. *Dampak:* keamanan data device; konfigurasi proxy.

**OQ-A11 — Platform CI — `TERJAWAB` (2026-11-18): GitHub Actions.** Teks opsi awal dipertahankan sebagai jejak keputusan: Referensi tidak memakai CI; Solva memerlukan gerbang otomatis (batas modul, RLS, vektor, bundle). *Asumsi:* GitHub Actions dengan service container PostgreSQL 18. *Opsi:* GitLab CI, skrip lokal pra-push (lebih lemah).

**OQ-A12 — Pemantauan minimal — `TERJAWAB` (2026-11-18): tidak, ikuti PRD** (berbeda dari asumsi awal; uptime check dan baris ringkasan log tidak masuk MVP, RSK-09 tetap diterima). Teks opsi awal dipertahankan sebagai jejak keputusan: *Rekomendasi:* uptime check eksternal pada `/health` + notifikasi, dan baris ringkasan berkala di log (§9.1). *Dampak:* mengetahui server mati sebelum kasir melapor. *Asumsi:* uptime check dipasang menjelang produksi.

**OQ-A13 — Peramban Android — `TERJAWAB` (2026-11-18): Chrome saja di Android (Edge di Windows).** Teks opsi awal dipertahankan sebagai jejak keputusan: PRD: Chrome/Edge (Chromium). Beberapa tablet memakai browser bawaan (mis. Samsung Internet) dengan dukungan WebUSB/Web Bluetooth/`persist` berbeda `VERIFIKASI`. *Asumsi:* **Chrome** wajib di Android; Edge didukung di Windows. *Dampak:* panduan perangkat.

**OQ-A14 — Rollback bundle — `TERJAWAB` (2026-11-18): roll-forward saja.** Teks opsi awal dipertahankan sebagai jejak keputusan: Roll-forward only (§3.2, AD-25). *Opsi:* mendukung "downgrade" dengan versi Dexie tetap naik (bundle lama tak dapat dibuka) — tidak mungkin; atau menjaga dua generasi store. *Asumsi:* roll-forward; server boleh rollback hanya ke versi yang menerima `schema_version` lapangan.

**OQ-A15 — Satu paket vs workspaces — `TERJAWAB` (2026-11-18): satu paket.** User menanyakan mengapa paket terpisah diperlukan; jawabannya: **tidak diperlukan** — paket terpisah hanya berguna bila kode hitung dipakai proyek lain atau butuh isolasi dependensi yang dipaksa build; untuk satu aplikasi dan satu developer, folder biasa + lint sudah cukup (§8.3). Teks opsi awal dipertahankan sebagai jejak keputusan. *Asumsi:* satu `package.json`; paket bersama = folder `src/lib/*` dengan lint (§8.3). *Opsi:* npm workspaces (`packages/kernel`, …) bila kernel akan dipakai lintas proyek.

**OQ-A16 — Katalog besar — `TERJAWAB` (2026-11-18): default unduh seluruh katalog (PRD OQ-27c tetap berlaku); "hanya item tersedia di outlet" hanya sebagai cadangan untuk katalog sangat besar, diputuskan per tenant setelah pengukuran F2** (bila dipakai, BR-CAT-015 menjadi pesan generik untuk tenant itu). Teks opsi awal dipertahankan sebagai jejak keputusan: BR-CAT-014 mengunduh seluruh katalog tenant; batas 5.000 SKU berlaku pada yang efektif tersedia. Bila tenant memiliki katalog jauh lebih besar: waktu full resync, memori apply, ukuran Dexie meningkat. *Opsi:* (A) tetap unduh semua (asumsi; ukur di F2); (B) hanya yang tersedia di outlet (OQ-27c opsi B PRD: pesan scan menjadi generik). *Dampak:* RSK-A04, BR-CAT-015.

**OQ-A17 — Multi-instance — `TERJAWAB` (2026-11-18): tidak, satu instance.** Teks opsi awal dipertahankan sebagai jejak keputusan: MVP: satu instance (AS-06). Skala keluar menuntut `LISTEN/NOTIFY` untuk sinyal SSE, penyimpanan rate-limit bersama, dan pekerja latar ber-lock (sudah ber-*advisory lock*). *Asumsi:* tidak dilakukan.

**OQ-A19 — Jendela dukungan kontrak lama — `TERJAWAB` (2026-11-18): 30 hari; pembaruan keras hanya saat shift tertutup (tanpa keranjang aktif, antrean kosong).** Teks opsi awal dipertahankan sebagai jejak keputusan: Keputusan user: server mendukung N−1 **minimal 30 hari** setelah rilis baru (lebih lama dari lease offline 7 hari); angka 30 adalah **asumsi** (user tidak punya preferensi). *Opsi:* 14 hari (minimum PRD), 30 (asumsi), 60/90. *Dampak:* lama kompatibilitas yang harus dipelihara (upcaster tetap permanen apa pun pilihannya), kapan pembaruan keras berlaku, kapan migrasi destruktif boleh dijalankan (§9.6.5). *Asumsi:* 30 hari.

**OQ-A20 — Ambang ukuran data untuk PITR — `TERJAWAB` (2026-11-19): ±10 GB, atau dump penuh + salinan keluar > ±15 menit.** Teks opsi awal dipertahankan sebagai jejak keputusan. Dump penuh sebelum migrasi cukup selama data kecil; di atas suatu ambang pindah ke PITR (WAL archiving + restore point) bersamaan dengan masuknya backup off-site (§9.6.5; penjelasan PITR ada di sana). *Opsi:* ±5 GB, **±10 GB (asumsi)**, ±20 GB, atau berdasarkan durasi dump (> 15 menit). *Dampak:* kapan biaya/kompleksitas PITR mulai ditanggung; SCHEMA §6.5.2 memperkirakan 15–35 GB/tahun untuk 10 outlet campuran sehingga ambang bisa terlewati dalam tahun pertama. *Asumsi:* ±10 GB (**disahkan user**).

**OQ-A21 — "Tanpa CI untuk rilis" vs gerbang tes — `TERJAWAB` (2026-11-18): tes otomatis = gerbang di GitHub Actions; rilis dan deploy tetap manual dari komputer user (opsi A).** Teks opsi awal dipertahankan sebagai jejak keputusan: Dua jawaban user tampak bertabrakan: rilis/deploy tanpa CI (semi-manual dari komputer user) dan GitHub Actions sebagai platform CI (OQ-A11). Didamaikan di dokumen: **GitHub Actions hanya menjalankan tes/lint/cek bundle**, **tidak** membangun, menerbitkan, atau men-deploy; skrip rilis menjalankan uji kunci secara lokal sebelum menyusun image. *Opsi:* (A) seperti itu (asumsi); (B) tanpa GitHub Actions sama sekali (semua gerbang dijalankan lokal; batas modul/RLS/bundle tidak ditegakkan otomatis di tiap push). *Dampak:* AP-12/NFR-MNT-002 dan disiplin hotfix.

**OQ-A18 — Versi Node.js — `TERJAWAB` (2026-11-18): Node 22 LTS (≥ 22.12).** Teks opsi awal dipertahankan sebagai jejak keputusan. *Asumsi:* Node 22 LTS (≥ 22.12, sama dengan referensi). *Opsi:* Node 24 LTS (jendela dukungan lebih panjang) setelah kompatibilitas `pg`, `hash-wasm`, `pino`, Playwright dan image Docker diverifikasi di F1.

**OQ-A26 — Pustaka pembatas laju final dan kalibrasi nilai — `TERJAWAB` (arah, 2026-11-19): `rate-limiter-flexible`, dikunci final setelah verifikasi teknis awal F1** (sebelumnya: arah `DISEPAKATI` pustaka pihak ketiga, 2026-11-18). Teks opsi dipertahankan sebagai jejak keputusan. *Kandidat:* **`rate-limiter-flexible`** (registri 2026-11-18: 11.5.0, ISC, diperbarui 2026-11-15). *Verifikasi sebelum dikunci:* nama/versi/lisensi/pemeliharaan; kompatibilitas Node 22 (tidak ada `engines` di registri); kecocokan `server-only`/bundle-guard; uji jam palsu; pembentukan jeda progresif 30 dtk/1/2/5/15 mnt dari primitif pustaka (blokir berdurasi + penalti). *Opsi:* (a) `rate-limiter-flexible` (asumsi); (b) pustaka lain yang lolos verifikasi; (c) cadangan: pembatas buatan sendiri ala `rate-limit.ts` referensi di balik antarmuka tipis yang sama. *Nilai batas:* awal konservatif (§6.9.3), dikonfigurasi lewat `RL_*`, **dikalibrasi dari log** pelanggaran setelah pemakaian nyata. *Dampak:* satu dependensi server; tidak memengaruhi data/sync. *Asumsi:* (a).

**OQ-A27 — Mitigasi penundaan pemilik akun (login admin; kunci kini akun global) — `TERJAWAB` (2026-11-19): opsi (D) tanpa mitigasi, hanya log.** Teks opsi awal dipertahankan sebagai jejak keputusan. *Masalah:* tanpa IP di kunci, siapa pun dapat menunda login pemilik hingga 15 menit dengan terus gagal (§6.9.10, G-RL1). *Opsi:* (A) **penanda perangkat tepercaya** — cookie bertanda tangan per akun + browser, hitungan jeda terpisah per akun + penanda sehingga pemilik di browser biasa tak ikut tertunda; biaya: cookie fungsional baru, rahasia penanda, pencabutan saat reset sandi, tak menolong browser baru; (B) **reset oleh owner/manager** (operator platform untuk owner); (C) **jeda maksimum lebih pendek** (mis. 5 mnt); (D) **tanpa mitigasi** (log saja). *Dampak:* menambah/tidak menambah komponen cookie dan layar admin; tidak menyentuh kasir `/pos`. *Keputusan user:* (D); (A)+(B) menjadi jalur naik bila log menunjukkan gangguan.

**OQ-A28 — Undangan dan reset kata sandi tanpa email; aturan reset lintas tenant — `TERJAWAB` (2026-11-19): opsi (a) usulan §6.2.1.** Teks opsi dipertahankan sebagai jejak keputusan. *Masalah:* tanpa email, undangan dan reset dilakukan manusia; owner tenant A yang mereset akun Ani (juga owner tenant B) dapat mengambil alih B. *Opsi:* (a) **usulan §6.2.1** — kode sekali pakai terikat email (undangan 72 jam, reset 24 jam), penerbit tak pernah menetapkan/melihat kata sandi, owner hanya mereset akun yang keanggotaannya **hanya di tenantnya** (diperiksa saat penerbitan dan penukaran), akun multi-tenant dan owner hanya oleh operator platform atau pemiliknya, penolakan dengan pesan generik; (b) owner menetapkan kata sandi sementara (lebih sederhana, tetapi penerbit mengetahui kata sandi — **ditolak** untuk akun multi-tenant); (c) semua reset hanya operator platform (paling aman, operator menjadi hambatan). *Dampak:* skema (tabel undangan/kode reset), layar `/admin` dan halaman `join`/`reset`, prosedur operator (verifikasi identitas di luar sistem, belum dirancang). *Keputusan user:* (a). **Belum dirancang:** prosedur operator platform memverifikasi identitas di luar sistem sebelum mereset akun multi-tenant/owner (RSK-A29).

**OQ-A29 — Kebijakan sesi: satu sesi global vs sesi per tenant — `TERJAWAB` (2026-11-19): cookie sesi per slug, login terpisah per tenant; akun tetap global.** Teks opsi dipertahankan sebagai jejak keputusan. *Opsi yang dipertimbangkan:* (a) **satu sesi global, tenant per permintaan** (usulan saya; dicabut): sesi hanya menyatakan orang, tenant dari slug + pemeriksaan keanggotaan tiap permintaan; (b) tenant aktif tersimpan di sesi (`activeOrganizationId`) dengan pengalih eksplisit (**tidak dipilih; pengalih tenant juga ditiadakan**, RK-45); (c) **cookie per slug (`Path=/<slug>`, nama per tenant), akun global, login terpisah per tenant (DIPILIH user)**: setelah login server memeriksa keanggotaan; logout hanya mengakhiri sesi tenant itu; dua tenant di satu browser butuh login terpisah. *Dampak:* §6.2 (sesi, `getAuthContext`, CSRF, multi-tab) ditulis ulang; RSK-A18 dan penulisan ulang URL server function + `rewrite` Nginx **berlaku lagi**; RK-37/RK-40 dicabut. *Keputusan user:* (c).

---

## 14. Peta Komponen Arsitektur per Fase PRD

| Fase | Komponen arsitektur yang dibangun / divalidasi | Spike / ukuran yang dikunci |
|---|---|---|
| **F1 Fondasi** | Kerangka app (routes, lapisan, penjaga lint/dep-cruiser/bundle), `lib/kernel` awal (`ids`, `time`, `money`), `lib/contracts` kerangka, `server/db` (`withTenant`, `TenantTx`), RLS + FK komposit + peran DB, modul `identity`, `sync` (`tenant_sync`, feed registry, push pipeline dasar, idempotensi), `audit` (rantai), logging penuh, Better Auth, enrollment device, PWA (SW, UpdateManager kerangka, prompt update), Dexie `db/` + `meta`, instance lock, i18n infrastruktur, Compose + migrator + CI | OQ-A02 (Start + PWA), OQ-A26 (pustaka pembatas; uji konfigurasi Nginx + IP asli), uji identitas global (undangan/reset tanpa email; sesi per slug), OQ-A01, A10, A11, A13, A14, A15, A18; uji RLS & konkurensi `tenant_sync`; start dingin offline |
| **Lintas fase: versioning & rilis** (§9.6) | F1: konstanta `__APP_VERSION__`, `X-App-Version/X-Schema-Version/X-Sync-Protocol`, `/health` + `app_release`, `scripts/deploy` (susun image dari tag bersih) dan `scripts/ops` (urutan deploy, backup bersyarat, rollback otomatis), staging ber-DB sendiri, `lib/feature-flags` + tabel `tenant_feature_flag`; F3: migrator klien dan upcaster server pertama saat kontrak pertama naik | `OQ-A19` (30 hari), `OQ-A20` (ambang PITR), `OQ-A21` (CI vs rilis); uji skrip rilis dengan fake |
| **F2 Master + sync katalog** | Modul `catalog` (+ `domain/availability`), `FeedSource` semua entitas, pull (stage + apply atomik), full resync, impor massal satu versi, indeks Dexie (barcode/cari), snapshot logo | Benchmark apply 25 ribu baris (RSK-A04), k-way merge (RK-10), lookup ≤ 50/150 ms, OQ-A16 |
| **F3 POS retail offline** | `lib/sales-calc` lengkap + vektor, `modules/sales`/`shift`, use case klien, finalisasi atomik, outbox + push penuh + status/`command_updates`, gap/pemulihan, `printing/` (3 adapter), `scanner/`, kunci layar, lease/jam, retensi + ekspor, `device_log`, antrean sinkron | Durability `strict` (RSK-A03), Argon2id (OQ-A06), printer per jalur (OQ-A04), `getDevices` BLE (RSK-A07), BarcodeDetector Windows, NFR-PERF-001/002/004/007 |
| **F4 Stok & HPP** | `modules/inventory` (ledger, `costing`, GR, transfer, opname), snapshot stok + `acked_device_seq`, resep (definisi di katalog), kontensi lock | Uji paralel row lock & deadlock, V-12…V-17 |
| **F5 F&B** | `modules/fnb` (bill, event, lease, serah-terima, split/merge), `bill_snapshot`, sinyal SSE `bills`, register `WAITER` | Serah-terima race, EC-058…061, V-19/V-20 |

*— Akhir dokumen —*
