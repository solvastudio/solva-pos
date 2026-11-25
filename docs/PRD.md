# PRD & Business Rules — Solva POS

| Atribut | Nilai |
|---|---|
| Nama produk | Solva POS |
| Jenis dokumen | Product Requirements Document (PRD) + Business Rules + Spesifikasi Alur |
| Status dokumen | **Draft 1.09 — siap direview** (belum dikunci; lihat Bab 15 untuk butir `PERLU KONFIRMASI`) |
| Tanggal | 2026-11-19 |
| Revisi 1.09 | **Jawaban user 2026-11-19 atas DOQ-26 (halaman penerima kode dan pengelolaan undangan)**: (1) penerima kode memakai **dua halaman publik terpisah** — `<DOMAIN>/<slug>/join` (bergabung dengan kode undangan) dan `<DOMAIN>/<slug>/reset` (atur ulang kata sandi dengan kode reset) — **BR-IDN-014**, BR-TEN-001/004 diselaraskan (`join`/`reset` adalah segmen kedua sehingga tidak bentrok dengan slug dan **daftar kata terlarang tidak berubah**), FLOW-23/28/29; (2) di `/admin` tab **Pengguna** ada daftar **"Undangan tertunda"** dengan aksi **Batalkan** dan **Terbitkan ulang** (kode baru, kode lama otomatis tidak berlaku); Owner hanya mengelola undangan tenantnya; setiap aksi diaudit — **BR-IDN-015**, FR-IDN-012..014, EC-129..137, V-48 (contoh: undangan kedaluwarsa 72 jam diterbitkan ulang; undangan salah alamat dibatalkan) |
| Revisi 1.08 | **Jawaban user 2026-11-19 atas OQ-S39 (risiko pra-klaim email dan detail kode)**: (1) **risiko pra-klaim email** — tanpa verifikasi email, penerbit yang memegang kode dan email dapat menukarnya sendiri dan menetapkan password atas email orang lain — **DITERIMA di MVP dengan mitigasi** (hanya berlaku bagi akun yang hanya ada di tenantnya; bergabung ke tenant lain butuh kode tenant itu **dan** password akun; tercatat audit; operator dapat mereset; verifikasi email kelak) — **BR-IDN-013**, RSK-19, EC-125..128, V-47; (2) **detail kode**: kode undangan/reset **10 karakter** (alfabet 32 ≈ 1,1×10¹⁵ kemungkinan) tampil dalam kelompok (`K7Q2M-9XD4R`), terikat email, **baris dibersihkan 7 hari setelah kedaluwarsa atau terpakai**; **penukaran satu langkah** (email + kode + password; akun baru membuat password, akun lama memasukkan password saat ini) tanpa membuka bahwa akun sudah ada; **hitungan keanggotaan untuk aturan reset menyertakan undangan aktif lintas tenant** (akun dengan undangan aktif ke tenant lain dianggap multi-tenant sejak undangan terbit); **reset akun multi-tenant oleh operator memakai konteks salah satu tenant tempat akun menjadi anggota** (BR-IDN-004/005; FR-IDN-005/006/011; parameter; V-45) |
| Revisi 1.07 | **Jawaban user 2026-11-19 atas OQ-35, OQ-36, OQ-37 dan detail identitas (OQ-S37)**: **OQ-35** opsi A (Owner hanya mereset akun yang keanggotaannya hanya di tenantnya; akun multi-tenant hanya oleh operator platform atau pemiliknya; penolakan memakai pesan generik "hubungi operator platform" tanpa mengakui akun multi-tenant); **OQ-36** opsi A (kode undangan 72 jam dan kode reset 24 jam, sekali pakai, terikat email; **penerbit tidak pernah melihat atau menetapkan password**; kode dan respons sama untuk email yang sudah/belum punya akun; **tidak ada password sementara dan tidak ada penanda wajib ganti password**); **OQ-37** **cookie sesi PER SLUG** (`Path=/<slug>`, login terpisah per tenant; akun tetap global) — **menggantikan** asumsi "satu cookie sesi global"; logout hanya mengakhiri sesi tenant itu; **kunci rate limit login = email lintas slug** (kegagalan di satu tenant ikut menunda login email itu di tenant lain); peran Better Auth hanya cerminan kasar (izin dari tabel kita); email tidak disalin ke data anggota tenant; ganti email hanya oleh pemilik akun atau operator platform (bukan Owner); anggota yang dikeluarkan menyimpan penunjuk identitas untuk jejak audit (BR-IDN-001..012, BR-RLM-002/003, BR-TEN-003/006, FR-IDN, EC-117..124, FLOW-28/29, V-43..46) |
| Revisi 1.06 | **Perubahan besar model identitas back-office** (keputusan user 2026-11-19): dari "akun terpisah per tenant" menjadi **identitas global + keanggotaan per tenant** (plugin organization Better Auth) — satu email = satu akun global (email unik se-sistem), satu password, keanggotaan per tenant dengan peran; login **hanya dengan email** (tanpa username); staf non-email memakai PIN di POS; **tanpa email di MVP** (tanpa pengiriman/verifikasi email dan "Lupa kata sandi" mandiri; undangan dan reset password manual); risiko lintas tenant dirancang eksplisit (`PERLU KONFIRMASI`: reset password lintas tenant OQ-35, alur undangan OQ-36, sesi global OQ-37); 2FA owner di luar MVP. KEP-27, Bab 5.16, BR-IDN-001..010, FR-IDN-001..010, NFR-SEC-011, EC-111..120, FLOW-28/29, RSK-18. **Menggantikan** BR-TEN-003/EC-076/EC-094/EC-095 (rev. 1.03) dan username pada BR-AUT-001 (rev. 0.96); **BR-TEN-002/006, BR-RLM-002/003, NFR-SEC-009/010 disesuaikan** (kunci login = slug + email; jaring pengaman per email lintas slug). **Jawaban lain dicatat:** OQ-34 (tanpa mitigasi, hanya log); prefiks invoice BR-INV-003 (2–16 karakter, tanda hubung di dalam, segmen terakhir bukan `NK`, wajib hanya register `KASIR`, unik lintas riwayat, kode outlet/register terkunci) kini `DISEPAKATI`; feature flag per tenant = boolean + parameter opsional, berlaku setelah siklus pull (BR-VER-009); halaman Reset aplikasi menyediakan ekspor transaksi tertunda (BR-ERR-008); ambang evaluasi PITR (RSK-09); `rate-limiter-flexible` dipilih, final setelah verifikasi teknis awal F1 (BR-RLM-013); versi minimum klien = atribut pada rilis aplikasi terbaru (BR-VER-002); jeda PIN dari waktu tertinggi yang pernah dilihat aplikasi, laporan PIN ke server saat tingkat kunci berubah, waktu full resync terakhir di Dexie meta (BR-RLM-006/010) |
| Revisi 1.05 | **Rate limit dan anti-brute-force** ditambahkan atas keputusan user 2026-11-18/19 (KEP-26, Bab 5.15, BR-RLM-001..014, FR-RLM-001..010, EC-100..110, RSK-17, OQ-34; rujukan teknis `docs/ARCHITECTURE.md` §6.9/AD-40): dua lapisan (Nginx + aplikasi), kunci per `device_id` untuk API device dan **slug + akun** untuk login admin (IP hanya jaring pengaman longgar), tanpa penguncian akun permanen, pesan perkiraan menit yang generik, PIN di device (monotonik, jam tak dapat dimundurkan), banjir sync (429 + `Retry-After`, klien tidak menaikkan percobaan), batas full resync/SSE/laporan berat, pairing per IP dan per slug, tanpa kuota per tenant, `/platform` tanpa pembatasan IP; **NFR-SEC-005 diperluas; BR-AUT-005, BR-TEN-003, BR-SYN-024/030, BR-ERR-002, BR-LOG-006 disesuaikan** |
| Revisi 1.04 | **Jawaban user 2026-11-18 atas OQ-33, OQ-30, dan penegakan slug**: **nama tampilan tenant** (maks 40 karakter) diatur **operator platform** saat membuat tenant, perubahan lewat operator, **tanpa layar pengaturan nama di `/admin` untuk Owner di MVP** (BR-TEN-007/008, FLOW-23, EC-096..097, FR-TEN-010; OQ-33 terjawab); **domain kustom per tenant ditunda** — tanpa pekerjaan di MVP, resolver tenant disiapkan, penambahan kelak aditif dengan TLS per domain via certbot (BR-TEN-010; OQ-30 terjawab sebagai "ditunda"); **penegakan slug**: kata terlarang = **konstanta di kode + uji rute**, slug permanen dijaga juga oleh **trigger database** (lapis kedua) (BR-TEN-004, FR-TEN-004, EC-098..099) |
| Revisi 1.03 | **Jawaban user 2026-11-18 atas OQ-29, OQ-31, OQ-32** dan butir lain dicatat: **OQ-29** (jendela dukungan 30 hari dan pembaruan keras hanya saat shift tertutup, bukan asumsi lagi); **OQ-32** (daftar **22 kode error** menurut `docs/ARCHITECTURE.md` §9.7.1 menggantikan 19 kode awal; ambang lonjakan **≥ 10 `INTERNAL_ERROR` dalam 5 menit**, retensi source map = selama versi dilaporkan perangkat + 90 hari); **gerbang tes di CI (GitHub Actions), rilis/deploy manual** (BR-VER-010); **OQ-31** (`/<slug>` polos = halaman pemilih "Terminal Kasir"/"Back-office"; normalisasi 308 ke huruf kecil kanonis; **email boleh sama di tenant berbeda**, dua akun terpisah, reset password per tenant); **warna tenant dihapus dari MVP** (hanya nama; siapa yang mengatur nama tenant belum diputuskan, OQ-33); **QR pairing** memuat alamat + kode pairing di fragmen URL dengan ketik manual sebagai cadangan (BR-TEN-007, BR-AUT-002) |
| Revisi 1.02 | **Manajemen error** ditambahkan atas keputusan user 2026-11-18 (KEP-25, Bab 5.14, BR-ERR-001..015, FR-ERR-001..012, NFR-OBS-004/005, NFR-I18N-005, EC-083..092, FLOW-25..27, RSK-16, OQ-32): tiga tingkat error, katalog kode error stabil + kalimat tindakan kasir, pelaporan manual, ID lokal `D-…`, error boundary per area, pemulihan gagal start (Reset aplikasi tanpa menyentuh Dexie), gagal cetak, retry aksi online-only, source map privat, notifikasi Telegram. **BR-LOG-006/008/010/012/013 direvisi** (field `localId`/`area`, katalog kode, ID lokal, notifikasi fatal, pencarian `localId` + terjemahan stack) |
| Revisi 1.01 | **Identifikasi tenant lewat URL sub-path (slug)** ditambahkan atas keputusan user 2026-11-18 (KEP-24, Bab 5.13, BR-TEN-001..010, FR-TEN-001..011, NFR-SEC-009/010, EC-073..082, FLOW-23/24, RSK-15, OQ-30/31): `<DOMAIN>/<slug>/pos` dan `/<slug>/admin`, root `/` = 404, tenant selalu dari sesi/token (bukan URL), login di-scope slug dan **username/email unik per tenant** (menggantikan "satu orang = satu tenant" pada BR-AUT-001), slug permanen, tenant ditangguhkan, penyimpanan lokal dipisah per tenant, PWA per tenant, admin platform `/platform` (tenant tidak lagi dibuat self-service; AS-08, FR-TNT-001 diubah); domain kustom belum diputuskan (OQ-30) |
| Revisi 1.00 | **Versioning, rilis, dan kompatibilitas klien** ditambahkan atas keputusan user 2026-11-18 (KEP-23, Bab 5.12, BR-VER-001..012, FR-VER-001..008, NFR-REL-004/005, NFR-MNT-003, EC-064..072, FLOW-21/22, RSK-14, OQ-29): versi kontrak vs versi aplikasi, klien usang, server rollback, tampilan versi, jejak versi, feature flag per tenant, catatan rilis, migrasi aditif. **Jendela dukungan kontrak lama diubah dari 14 hari menjadi minimal 30 hari** (asumsi; `PERLU KONFIRMASI` ringan, OQ-29) — menggantikan jawaban 14 hari sebelumnya pada BR-SYN-003 |
| Revisi 0.99 | **Prefiks nomor invoice per register** (keputusan user 2026-11-18): format menjadi `{PREFIKS}-{MMYY}-{URUT6}` (nota kredit `{PREFIKS}-NK-{MMYY}-{URUT6}`); prefiks diatur **per register**, **wajib** (register `KASIR`) dan **unik di seluruh tenant**; opsi "cetak kode register pada nomor" dan awalan per outlet dihapus (BR-INV-003/010, BR-TNT-004, FR-TNT-003, FR-DEV-001, FR-POS-015, FLOW-01, Lampiran C/D V-29). Contoh nomor yang ada tetap berlaku dengan prefiks register `OUT01-POS02` |
| Revisi 0.98 | Jawaban OQ-S19..S23 (`docs/SCHEMA.md`) mengubah butir yang masih `DIUSULKAN` menjadi `DISEPAKATI`, tanpa mengubah isi aturan: **BR-FNB-010/012/013** (pemegang bill disimpan sebagai register dan device sekaligus, pemegang efektif = device aktif register; event serah-terima diberi urutan oleh server; daftar register tujuan = semua register outlet yang diunduh device; status "menunggu bayar"/serah-terima tersimpan sebagai kolom di `bill` + riwayat dari event; serah-terima tidak masuk audit log), **BR-AUT-015** (draf keranjang disimpan lokal dan tidak disinkron; permission `screen.unlock_override` untuk Supervisor/Manager/Owner; audit hanya override dan kunci PIN berulang), **FR-DEV-006** (jenis register tidak dapat diubah saat shift/bill `OPEN`) |
| Revisi 0.97 | Atas permintaan sesi DESIGN.md (keputusan user 2026-11-18, DOQ-09/14/18): **serah-terima bill waiter → kasir** (BR-FNB-012), **register jenis PELAYAN** (BR-FNB-011), **event `PREBILL_PRINTED`** (BR-FNB-005/010), **kunci layar otomatis 10 menit** (BR-AUT-015); KEP-22, FR-FNB-013..015, FR-DEV-006, FR-AUT-009/010, FR-SHF-007, EC-058..063, FLOW-19/20 |
| Revisi 0.96 | Jawaban **OQ-01 (sebagian: a, b, c-MVP, d, e, f)**, **OQ-02**, **OQ-10**, **OQ-12** dicatat; **BR-TAX-001 dipertegas** (hanya *tarif pajak* yang berlaku-mulai, di tabel riwayat `tax_rate_history`); login back-office boleh **username + password** (BR-AUT-001, FR-AUT-001); **satu device aktif per register** (BR-INV-001); format nomor dokumen GR/transfer/opname (BR-STK-020); disinkronkan dengan `docs/SCHEMA.md` (rancangan skema & kamus data; versi terkini di folder `docs/`) |
| Revisi 0.95 | **Manajemen log & observabilitas dasar** ditambahkan (KEP-21, Bab 5.11, BR-LOG-001..014, FR-LOG-001..008, NFR-OBS-002/003), mengacu pola logging proyek `financeDashboard` |
| Revisi 0.94 | **Arsitektur modular monolith** ditambahkan (KEP-20, Bab 5.10, BR-ARC-001..012, AP-12, NFR-MNT-002); aturan PWA update (BR-SYN-003) dan jawaban OQ lanjutan dicatat |
| Revisi 0.93 | Jawaban OQ-13, OQ-15, OQ-18, OQ-19 dicatat; **item open price (penanda) ditambahkan** (KEP-19, BR-PRC-007, FR-CAT-014, FR-POS-016, EC-054..057, OQ-28); kasir boleh melihat selisih kas setelah submit hitungan (BR-SHF-006) |
| Revisi 0.92 | **Ketersediaan item per outlet** ditambahkan (KEP-18, BR-CAT-009..022, FR-CAT-008..013, FR-SYN-017, FR-POS-012..014, FR-INV-011, FR-FNB-012, EC-039..053, OQ-24..27) — keputusan user, `DISEPAKATI` |
| Revisi | 0.91 (2026-11-17): **Multi-bahasa UI dipindah dari "di luar scope" ke MVP** (KEP-17, BR-I18N-*, FR-I18N-*, OQ-23); OQ-23 dijawab user: Indonesia + Inggris, library i18n ditambahkan ke stack, nama master satu bahasa, bahasa struk mengikuti kustomisasi struk outlet |
| Pemilik | Solo developer (Product Owner = Engineer) |
| Peran penyusun | Senior Product Manager + Systems Architect |
| Bahasa | Indonesia (istilah teknis dalam bahasa Inggris dipertahankan) |
| Cakupan | Spesifikasi perilaku produk. **Bukan** desain visual, **bukan** kode, **bukan** skema SQL. Referensi UI/UX menyusul dari dokumen terpisah. |

---

## 0. Cara Membaca Dokumen Ini

### 0.1 Tag Status

| Tag | Arti | Boleh diubah? |
|---|---|---|
| `DISEPAKATI` | Keputusan yang sudah diputuskan user pada sesi wawancara arsitektur. | Tidak. Tidak dibantah ulang dalam dokumen ini. |
| `DIUSULKAN` | Detail/nilai yang ditetapkan penyusun supaya spesifikasi tidak ambigu, konsisten dengan keputusan `DISEPAKATI`, dan **tidak memblokir** pengembangan. | Ya, bila user mau; dampak perubahan kecil. |
| `PERLU KONFIRMASI` | Aturan belum ditetapkan, punya beberapa opsi, atau menunggu pihak ketiga (akuntan, auditor). Berisi asumsi sementara + opsi + dampak di **Bab 15**. | Ya — menunggu jawaban. Asumsi sementara dipakai sampai ada jawaban. |

### 0.2 Konvensi ID

| Pola ID | Makna | Contoh |
|---|---|---|
| `KEP-xx` | Keputusan arsitektur/bisnis `DISEPAKATI` (Lampiran A) | KEP-07 |
| `AP-xx` | Prinsip arsitektur | AP-03 |
| `BR-<DOMAIN>-nnn` | Business Rule | BR-INV-001, BR-HPP-003 |
| `FR-<MODUL>-nnn` | Functional Requirement | FR-POS-012 |
| `NFR-<KATEGORI>-nnn` | Non-functional requirement | NFR-PERF-002 |
| `EC-nnn` | Edge case / kebijakan konflik | EC-014 |
| `RSK-nn` | Risiko | RSK-03 |
| `OQ-nn` | Open question (`PERLU KONFIRMASI`) | OQ-04 |
| `FLOW-nn` | Alur kerja end-to-end | FLOW-05 |

Kode domain BR: `TNT` tenant/hierarki · `SYN` sinkronisasi · `TIM` waktu · `INV` nomor invoice · `SHF` shift · `RTR` retur/nota kredit · `AUT` autentikasi & otorisasi · `CAT` katalog · `UOM` satuan · `PRC` harga · `MNY` uang & pembulatan · `TAX` pajak & biaya · `DSC` diskon · `PAY` pembayaran · `STK` stok · `HPP` biaya persediaan · `TRF` transfer · `RCP` resep/BOM · `FNB` open bill & meja · `SPL` split/merge · `PRN` cetak · `AUD` audit · `CUS` pelanggan · `I18N` bahasa & lokalisasi · `ARC` arsitektur modul · `LOG` manajemen log · `VER` versioning & rilis · `TEN` identifikasi tenant lewat URL · `ERR` manajemen error · `RLM` rate limit · `IDN` identitas global & keanggotaan.

Kode modul FR: `TNT`, `AUT`, `DEV` (device/register), `CAT`, `PRC`, `SYN`, `POS` (checkout), `SHF`, `RTR`, `PAY`, `PRN`, `INV` (inventori), `FNB`, `RPT` (laporan), `AUD`, `ADM` (back-office umum), `I18N` (bahasa & lokalisasi), `LOG` (manajemen log), `VER` (versioning & rilis), `TEN` (identifikasi tenant lewat URL), `ERR` (manajemen error), `RLM` (rate limit), `IDN` (identitas global & keanggotaan).

### 0.3 Prioritas dan Fase

| Prioritas | Arti |
|---|---|
| **P0** | Tanpa ini fase tidak dianggap selesai (blocker). |
| **P1** | Bagian MVP, wajib sebelum rilis MVP, boleh digeser di dalam fase. |
| **P2** | Diinginkan dalam MVP bila waktu ada; tidak memblokir rilis. |
| **LANJUT** | Ditunda ke setelah MVP. |

Fase: **F1** Fondasi · **F2** Master data online + sync katalog · **F3** POS retail offline end-to-end · **F4** Stok & HPP · **F5** F&B. Detail di Bab 13.

### 0.4 Konvensi Angka pada Contoh

- Format Indonesia: titik sebagai pemisah ribuan, koma sebagai desimal. `Rp1.234.567` = 1234567 rupiah; `0,5` = setengah.
- Semua contoh memakai tarif **contoh** (PPN 11%, PB1 10%, service charge 5%). Tarif di aplikasi **tidak di-hardcode** (BR-TAX-001); angka ini hanya ilustrasi.
- `R(x)` = pembulatan half-up ke bilangan bulat rupiah (BR-MNY-004). `LR` = largest remainder (BR-MNY-006).
- Nomor invoice contoh mengikuti format yang disepakati `{PREFIKS}-{MMYY}-{URUT6}` (OQ-04, BR-INV-003), mis. `OUT01-POS02-1126-000123` (prefiks register = `OUT01-POS02`). Pada contoh bertanggal 17 November 2026 periode `MMYY` = `1126`.

---

## 1. Ringkasan Eksekutif & Tujuan

### 1.1 Ringkasan

Solva POS adalah aplikasi Point of Sale berbasis web (PWA) yang **offline-first**, berjalan di HP/tablet Android dan PC/laptop Windows, untuk **dua sektor** (restoran/F&B dan toko retail), **multi-outlet**, dan **multi-tenant** (SaaS). Kasir tetap bisa berjualan, membuka/menutup shift, mencetak struk, dan melakukan retur tanpa internet selama berjam-jam hingga sehari. Server (PostgreSQL) adalah otoritas yang memutuskan hasil akhir; penjualan yang sudah terjadi di dunia nyata selalu diterima sebagai fakta.

### 1.2 Masalah yang Diselesaikan

1. Internet outlet tidak stabil; penjualan tidak boleh berhenti.
2. Pemilik butuh angka yang bisa dipercaya (penjualan, kas, stok, nilai persediaan) walaupun data masuk terlambat dan dari banyak perangkat.
3. Pemilik multi-outlet butuh kontrol terpusat (harga, pajak, hak akses) tanpa mengorbankan kecepatan kasir.
4. Auditor/akuntan butuh jejak: nomor invoice berurutan, void/retur yang terdokumentasi, audit log yang tidak bisa diubah.

### 1.3 Tujuan Produk

| ID | Tujuan | Ukuran keberhasilan (usulan, `DIUSULKAN`) |
|---|---|---|
| G-01 | Checkout tidak bergantung jaringan | 100% alur checkout, bayar, cetak, shift, retur (invoice lokal) berfungsi dengan jaringan mati |
| G-02 | Tidak ada penjualan hilang selama storage lokal utuh | 0 transaksi hilang pada uji sync otomatis (putus-nyambung, urutan acak) |
| G-03 | Struk offline = catatan server | Selisih rupiah antara hasil hitung client dan server = 0 pada seluruh uji properti |
| G-04 | Kecepatan kasir | Checkout & mulai cetak tidak menunggu jaringan (NFR-PERF-001/002) |
| G-05 | Jejak audit lengkap | Tiap void/diskon override/perubahan harga/perubahan hak akses/device tercatat tak dapat diubah |

### 1.4 Non-Tujuan (ringkas)

Integrasi payment gateway/EDC, faktur pajak/e-Faktur/Coretax, KDS/kitchen order, sync LAN antar device, loyalty/voucher/promo otomatis, multi-mata-uang, serial/batch/kedaluwarsa, iOS. Daftar lengkap di Bab 2.

---

## 2. Ruang Lingkup

### 2.1 MVP (Dalam Scope)

| Domain | Cakupan MVP | Status |
|---|---|---|
| Fondasi | Multi-tenant (RLS), entitas hukum, outlet, register, user/role, device enrollment, kerangka sync | `DISEPAKATI` |
| Auth | Better Auth (back-office), PIN offline di terminal, lease 7 hari, PIN supervisor | `DISEPAKATI` |
| Katalog | Kategori, sub-kategori, produk, varian (atribut), SKU, barcode, multi-UOM, harga per (SKU+UOM+outlet) — CRUD hanya online | `DISEPAKATI` |
| Serah-terima bill waiter → kasir | Waiter mencatat di HP (register `PELAYAN`), pemegang menyerahkan bill ke register kasir yang menerima; butuh internet; pra-bill dengan status meja "Menunggu bayar" | `DISEPAKATI` (rev. 0.96) |
| Kunci layar otomatis | Kunci `/pos` setelah 10 menit tanpa aktivitas; PIN staf lagi; state tidak hilang | `DISEPAKATI` (rev. 0.96) |
| Identitas global + keanggotaan per tenant | Satu email = satu akun global; keanggotaan berperan per tenant; login hanya email di-scope slug dengan **sesi per slug**; staf non-email PIN-only; tanpa email; undangan/reset lewat kode sekali pakai tanpa password sementara | `DISEPAKATI` (rev. 1.06/1.07; OQ-35/36/37 terjawab) |
| Rate limit & anti-brute-force | Dua lapisan (Nginx + aplikasi); kunci per device / email lintas slug (login); jeda progresif login admin tanpa penguncian permanen; batas pairing, API device, banjir sync, full resync, SSE, laporan berat; PIN di device anti-manipulasi jam | `DISEPAKATI` (rev. 1.05; angka batas = nilai awal konservatif, dikonfigurasi lewat lingkungan dan dikalibrasi dari log; mitigasi penundaan login pemilik akun `PERLU KONFIRMASI`, OQ-34) |
| Manajemen error | Tiga tingkat error, katalog kode error stabil + tindakan kasir (id/en), ID lokal offline, pemulihan crash/gagal start, notifikasi Telegram error fatal/health check/lonjakan | `DISEPAKATI` (rev. 1.02; daftar 22 kode, ambang lonjakan, dan retensi source map terjawab: OQ-32) |
| Identifikasi tenant lewat URL | Slug tenant pada URL, login di-scope slug, slug permanen, tenant ditangguhkan, penyimpanan lokal per tenant, PWA per tenant, admin platform `/platform` | `DISEPAKATI` (rev. 1.01; OQ-30/31/33 terjawab; domain kustom ditunda) |
| Versioning & kompatibilitas klien | Versi kontrak (N, N−1), klien usang, server rollback, tampilan versi, jejak versi, feature flag per tenant, catatan rilis, migrasi aditif | `DISEPAKATI` (rev. 1.00; jendela 30 hari dan pembaruan keras hanya saat shift tertutup: OQ-29 terjawab) |
| Item open price | Kolom penanda `is_open_price` pada produk; harga satuan diketik kasir saat transaksi dan disimpan sebagai snapshot dengan penanda pada baris penjualan | `DISEPAKATI` (rev. 0.93; OQ-18 dan OQ-28 terjawab) |
| Ketersediaan item per outlet | Flag eksplisit tersedia/tidak per (produk induk × outlet) dengan override per SKU; terpisah dari harga; default tersedia di semua outlet; dikelola online dan tersinkron lewat counter versi | `DISEPAKATI` (rev. 0.92; OQ-24..26 dan OQ-27a terjawab; OQ-27 seluruhnya terjawab) |
| POS retail | Scan barcode (keyboard-wedge + kamera), keranjang, diskon manual, pajak, pembayaran manual multi-metode, struk, retur/nota kredit | `DISEPAKATI` |
| Shift | Buka/tutup shift per register, modal awal, kas masuk/keluar, blind count, selisih kas — bisa offline | `DISEPAKATI` |
| Cetak | Printer thermal ESC/POS + cash drawer, antrean cetak asinkron, adapter WebUSB/BLE/`window.print` | `DISEPAKATI` |
| Inventori | Goods receipt, ledger stok, moving average per outlet, transfer antar outlet (in-transit), opname/penyesuaian | `DISEPAKATI` |
| Resep/BOM | Satu level (menu → bahan baku) + modifier mengubah bahan | `DISEPAKATI` |
| F&B | Meja, open bill (lease satu device), split/merge, modifier, service charge, PB1 | `DISEPAKATI` |
| Pelanggan | Nama/telepon opsional pada transaksi | `DISEPAKATI` |
| Struk | Kustomisasi per outlet (logo, header, footer) | `DISEPAKATI` |
| Laporan | Penjualan, stok & nilai persediaan, rekap shift & selisih kas (online) | `DISEPAKATI` |
| Kualitas | Uji sync otomatis (Playwright, test properti), audit log immutable | `DISEPAKATI` |
| Multi-bahasa UI | UI `/admin` dan `/pos` dapat berganti bahasa (offline-capable); bahasa struk per outlet; format angka/tanggal mengikuti locale. Bahasa: Indonesia (default) + Inggris; library i18n; bahasa struk mengikuti kustomisasi struk outlet (OQ-23 terjawab) | `DISEPAKATI` (masuk MVP sejak rev. 0.91; bahasa & library dijawab user 2026-11-17) |

### 2.2 Ditunda ke Fase Lanjut (`LANJUT`)

| Item | Catatan | Status |
|---|---|---|
| Email (SMTP/penyedia, verifikasi email, "Lupa kata sandi" mandiri) dan **2FA untuk Owner** | Di MVP undangan dan reset password dilakukan manual (BR-IDN-003/004/005); 2FA dicatat sebagai risiko (RSK-18) | `DISEPAKATI` |
| Local hub/LAN antar device | Model data dirancang agar bisa ditambahkan | `DISEPAKATI` |
| Kitchen Order / KDS (termasuk cetak tiket dapur) | Jaringan LAN outlet belum diketahui | `DISEPAKATI` |
| Promo otomatis (beli X gratis Y, jam tertentu), voucher/kupon, loyalty/poin | — | `DISEPAKATI` |
| Serial / batch / kedaluwarsa | — | `DISEPAKATI` |
| Faktor susut (yield/waste) & bahan setengah jadi/produksi | BOM tetap satu level | `DISEPAKATI` |
| Laporan laba kotor | HPP tetap dihitung & disimpan; laporan murah ditambah kemudian | `DISEPAKATI` |
| Monitoring sync lag, backup Postgres off-site + uji restore | Dicatat sebagai risiko operasional (RSK-09) yang sebaiknya segera menyusul | `DISEPAKATI` |
| Enkripsi IndexedDB | Dicatat sebagai risiko (RSK-05) | `DISEPAKATI` |
| Pembagian retensi data server (partisi per bulan) | Skema dirancang agar bisa dipartisi; untuk MVP **semua data disimpan tanpa penghapusan** (OQ-03 terjawab; ditinjau ulang bersama akuntan sebelum produksi jangka panjang) | `DISEPAKATI` |
| CRUD master di device POS secara offline | Ditolak: master hanya online | `DISEPAKATI` |
| Inventori (GR, transfer, opname) dioperasikan dari device POS secara offline | Di MVP dikerjakan di `/admin` (online) | `DISEPAKATI` (OQ-20) |

### 2.3 Di Luar Scope (Tidak Akan Dikerjakan pada MVP)

| Item | Status |
|---|---|
| Platform iOS | `DISEPAKATI` |
| Integrasi payment gateway / EDC / QRIS dinamis (QRIS hanya dicatat sebagai metode manual) | `DISEPAKATI` |
| Faktur pajak, e-Faktur, Coretax | `DISEPAKATI` |
| Multi-mata-uang (kode mata uang disimpan, hanya IDR beroperasi) | `DISEPAKATI` |
| Alternatif kuantitas integer berskala (dicatat sebagai opsi **ditolak**) | `DISEPAKATI` |
| Take-over / tutup paksa open bill | `DISEPAKATI` |
| Sync LAN, Background Sync API sebagai andalan | `DISEPAKATI` |
| Purchase order, hutang pemasok, retur pembelian, pajak masukan | `DIUSULKAN` (tidak disebut di keputusan; diasumsikan di luar MVP) |
| Billing/langganan SaaS (penagihan tenant) | `DIUSULKAN` (tidak dibahas; di luar MVP) |
| Uang muka/DP dan pembayaran bertahap lintas waktu untuk satu bill | `DIUSULKAN` |
| Reservasi meja, delivery/online-order | `DIUSULKAN` |

---

## 3. Persona & Peran

### 3.1 Persona

| Persona | Deskripsi | Perangkat utama | Kebutuhan inti |
|---|---|---|---|
| **Owner** | Pemilik tenant; mengatur entitas hukum, outlet, pajak, role, device | Laptop/HP (back-office) | Kontrol, laporan lintas outlet, keamanan |
| **Manager Outlet** | Mengelola satu/beberapa outlet; stok, transfer, opname, rekap shift | Laptop + tablet | Selisih kas, stok minus, antrean "perlu perhatian" |
| **Supervisor** | Pemberi persetujuan di lantai (void, diskon di atas batas, retur) | Tablet kasir | PIN override cepat, offline |
| **Kasir** | Operator checkout retail dan kasir F&B | Tablet/PC kasir | Cepat, scan barcode, cetak, tidak tersendat jaringan |
| **Waiter** (F&B) | Membuka meja, menambah item pada open bill | HP/tablet (terdaftar sebagai register) | Open bill, split/merge, modifier |
| **Staf Gudang** | Penerimaan barang, transfer, opname | Laptop/tablet (online) | GR, transfer in-transit, opname |
| **Akuntan/Auditor** (eksternal, read-only) | Memverifikasi penjualan, pajak, nomor invoice | Laptop | Laporan, audit log, daftar gap nomor |
| **Admin Platform (Solva)** | Pengelola SaaS; akun **terpisah** dari akun tenant | Laptop (`/platform`) | Membuat tenant, menangguhkan/mengaktifkan kembali tenant, mengatur versi minimum (BR-TEN-008); billing di luar MVP |

### 3.2 Role Default (`DISEPAKATI`: nilai usulan, OQ-05 terjawab)

Role dapat dikonfigurasi per tenant (KEP-05). Role bawaan yang disediakan saat tenant dibuat:

| Role | Cakupan | Batas diskon default (efektif % dari gross) | Dapat menyetujui |
|---|---|---|---|
| Owner | Semua outlet & pengaturan | 100% | Semua |
| Manager | Outlet yang ditugaskan | 50% | Void, retur, diskon ≤ 50%, override |
| Supervisor | Outlet yang ditugaskan | 20% | Void, retur, diskon ≤ 20% |
| Kasir | Register/outlet yang ditugaskan | 5% | — |
| Waiter | Open bill, tanpa pembayaran/shift | 0% | — |
| Staf Gudang | Modul inventori | 0% | — |
| Akuntan (read-only) | Laporan & audit log | 0% | — |

Matriks permission lengkap per role ada di BR-AUT-009. Nilai pada tabel ini disetujui user sebagai default (OQ-05 terjawab) dan tetap dapat diubah per tenant.

---

## 4. Glosarium

| Istilah | Definisi |
|---|---|
| **Tenant** | Pelanggan SaaS (satu bisnis). Batas isolasi data utama (`tenant_id` + Row Level Security). |
| **Entitas Hukum (Legal Entity)** | Badan usaha di bawah tenant; pemilik NPWP dan status PKP. |
| **Outlet** | Lokasi usaha fisik; punya zona waktu IANA, jam potong hari bisnis, tarif pajak daerah, konfigurasi harga inklusif/eksklusif. |
| **Register** | Device kasir terdaftar di satu outlet (tabel `cash_master`); punya prefix unik dan seri invoice sendiri. |
| **Device** | Perangkat fisik/browser yang diikat ke satu register lewat enrollment. |
| **Shift** | Sesi kerja kasir pada satu register (tabel `cash_cashier`: kasir × register × rentang waktu). |
| **Open bill** | Pesanan F&B yang belum dibayar, dimiliki satu device melalui lease. |
| **Lease (open bill)** | Kepemilikan tunggal sebuah bill oleh satu device; hanya pemegang yang boleh mengedit. Tidak berkedaluwarsa. |
| **Lease offline (device)** | Batas 7 hari device boleh beroperasi tanpa sync sukses; setelahnya terkunci. (Berbeda dari lease open bill.) |
| **Outbox** | Antrean perintah/event lokal (Dexie) yang menunggu dikirim ke server. |
| **Perintah atomik** | Satu perintah lengkap (mis. `FinalizeSale`) yang diproses idempoten dalam satu transaksi server. |
| **Idempotency key** | UUIDv7 buatan client yang membuat pengiriman ulang aman. |
| **Tombstone** | Penanda soft delete yang tetap ikut feed agar device lain ikut menghapus. |
| **Counter versi** | Penghitung per tenant yang dinaikkan di transaksi yang sama dengan perubahan master; urutan versi = urutan commit. |
| **Cursor** | Posisi terakhir yang sudah di-pull device (versi, id). |
| **Full resync** | Unduh ulang seluruh master data karena cursor terlalu tua/tombstone sudah dibersihkan. |
| **Business date** | Tanggal bisnis transaksi, dihitung saat transaksi dibuat dengan zona waktu & jam potong outlet, lalu disimpan. |
| **Base UOM** | Satuan dasar tempat stok selalu disimpan. |
| **Faktor konversi** | Berapa satuan dasar dalam 1 UOM turunan (konversi selalu perkalian). |
| **SKU** | Kombinasi varian yang dapat dijual/distok; punya barcode, UOM, harga per outlet, stok sendiri. |
| **Ledger stok** | `stock_movements`, append-only; sumber kebenaran stok dan HPP. |
| **Moving average** | Metode biaya persediaan: biaya rata-rata bergerak per (SKU, outlet). |
| **HPP** | Harga pokok penjualan (cost of goods sold). |
| **BOM / Resep** | Daftar bahan baku dan kuantitas untuk satu menu F&B. |
| **Modifier** | Opsi/add-on pada menu (mis. "Extra Telur", "Tanpa Kecap") yang bisa menambah harga dan mengubah bahan. |
| **Nota kredit** | Dokumen retur/refund terpisah, merujuk invoice asal, seri sendiri per register. |
| **Gap** | Nomor invoice/nota kredit dalam seri register yang tidak pernah diterima server. |
| **Blind count** | Kasir menghitung uang fisik tanpa melihat angka sistem. |
| **LR (largest remainder)** | Metode membagi sisa pembulatan: bagian terbesar dari sisa pecahan mendapat tambahan 1 satuan terkecil. |
| **Antrean "perlu perhatian"** | Daftar perintah yang gagal secara struktural/otorisasi dan perlu keputusan manager. |
| **PKP** | Pengusaha Kena Pajak. |
| **PB1** | Pajak Barang dan Jasa Tertentu atas makanan/minuman (pajak restoran daerah). |
| **Locale** | Kombinasi bahasa + wilayah (mis. `id-ID`, `en-US`) yang menentukan teks UI serta format angka/tanggal tampilan. Data tersimpan tetap kanonik (BR-I18N-006). |
| **Bahasa struk** | Locale yang dipakai mencetak struk pelanggan; ditetapkan per outlet, terpisah dari bahasa UI staf. |
| **Ketersediaan item (item availability)** | Status eksplisit `AVAILABLE`/`UNAVAILABLE` sebuah produk/SKU pada sebuah outlet; menentukan apakah item **muncul dan dapat dijual** di POS outlet itu. Terpisah dari harga dan dari status aktif global (`is_active`). |
| **Penugasan item–outlet** | Entitas `item_outlet_availability` yang menyimpan ketersediaan per (produk × outlet) dan, bila menyimpang, per (SKU × outlet). |
| **Override SKU** | Baris penugasan tingkat SKU yang menimpa status tingkat produk induk untuk satu outlet (mis. varian Merah dikecualikan di outlet B). Dihapus (tombstone) = kembali mengikuti induk. |
| **Opt-out** | Pengecualian outlet dari item yang secara bawaan tersedia di semua outlet. |
| **Modular monolith** | Satu aplikasi yang di-deploy utuh, tetapi kodenya dipecah menjadi modul domain berbatas jelas; modul hanya saling memanggil lewat antarmuka publik. |
| **Antarmuka publik modul** | Kumpulan fungsi/tipe yang sengaja dibuka sebuah modul untuk modul lain; selain itu bersifat internal. |
| **Log operasional** | Catatan diagnostik server dan device (error, kegagalan sync/cetak, performa) berformat JSON per baris, dibuang otomatis sesuai retensi. **Berbeda** dari audit log bisnis yang tak bisa diubah. |
| **ID referensi** | ID pendek (mis. `20261117-143551-k7q2m`) yang melekat pada tiap baris log sebuah request/job dan ditampilkan ke pengguna bersama kode error, sehingga laporan masalah dapat langsung dicari di log. |
| **Register PELAYAN** | Register (device) berjenis pelayan, mis. HP waiter: boleh membuat/mengubah open bill, pra-bill, dan menyerahkan bill; **tidak** membayar, tidak membuka shift, dan tidak mengelola kas. Lawannya register `KASIR`. |
| **Serah-terima bill** | Pemindahan kepemilikan (lease) open bill secara **sukarela** oleh pemegang ke register kasir, dan baru berlaku setelah kasir menerima. Bukan take-over paksa. |
| **Kunci layar (idle-lock)** | Layar `/pos` terkunci setelah 10 menit tanpa aktivitas dan meminta PIN staf; berbeda dari penguncian device akibat lease offline 7 hari (BR-AUT-008). |
| **Versi aplikasi** | Nomor SemVer `vMAJOR.MINOR.PATCH` (git tag sebagai sumber kebenaran; rc `vX.Y.Z-rc.N`) yang menandai build `/pos` dan `/admin`. |
| **Versi kontrak** | Bilangan bulat monoton (N) yang naik **hanya** bila format perintah/event berubah secara tidak kompatibel; yang dibawa tiap perintah outbox. Sama dengan "nomor versi skema" pada BR-SYN-022 dan atribut `schema_version`. |
| **Versi minimum yang didukung** | Versi kontrak terendah yang masih diterima server; klien di bawahnya tertahan dan harus diperbarui. |
| **Momen aman** | Saat pembaruan aplikasi boleh diterapkan tanpa mengganggu transaksi (BR-VER-004). |
| **Feature flag per tenant** | Saklar fitur yang disimpan sebagai master data tenant, dibaca POS secara baca-saja dan hanya diubah Owner. |
| **Slug tenant** | Pengenal tenant pada URL (`<DOMAIN>/<slug>/pos`, `/<slug>/admin`); permanen, huruf kecil, 3–30 karakter (BR-TEN-004). Hanya konteks tampilan/login; **bukan** penentu akses data. |
| **Admin Platform** | Akun operator Solva di `/platform` (di luar semua tenant) untuk membuat/menangguhkan tenant dan mengatur versi minimum. |
| **Kode error** | Pengenal stabil huruf besar (mis. `PRINT_FAILED`) untuk kesalahan sistem/kondisi perangkat yang diketahui; ditampilkan bersama ID sebagai `KODE#id` dan satu kalimat tindakan untuk kasir (BR-ERR-002). |
| **ID lokal** | ID referensi error yang lahir di device, berformat `D-YYYYMMDD-HHmmss-xxxxx`, dikirim bersama sync dan dapat dicari di log server (BR-ERR-006). |
| **Error boundary per area** | Pembatas kegagalan tampilan agar satu panel yang crash tidak mematikan seluruh layar kasir (BR-ERR-007). |
| **Jeda progresif** | Penundaan percobaan login yang membesar bertahap (30 dtk → 1 → 2 → 5 → 15 mnt) setelah kegagalan berulang, tanpa penguncian akun permanen (BR-RLM-003). |
| **`Retry-After`** | Petunjuk dari server berapa lama klien menunggu setelah respons `429` karena batas laju; klien mematuhinya tanpa menaikkan percobaan (BR-RLM-005). |
| **Akun global (account)** | Identitas back-office: satu email unik se-sistem dan satu password; dapat menjadi anggota di banyak tenant (BR-IDN-001). |
| **Keanggotaan tenant (membership)** | Hubungan akun dengan satu tenant beserta peran (dan penugasan outlet); dasar akses `/<slug>/admin` (BR-IDN-002). |
| **Anggota PIN-only** | Anggota tenant tanpa akun back-office (tanpa email); hanya memakai PIN di terminal POS (BR-IDN-001). |
| **Kode undangan / kode reset** | Kode sekali pakai terikat email (undangan 72 jam, reset 24 jam) yang dibagikan penerbit secara manual; penerbit tidak pernah melihat atau menetapkan password (BR-IDN-004/005). |
| **Kernel bersama** | Paket kecil tanpa logika bisnis spesifik modul (uang, kuantitas, pembulatan, ID, waktu) yang dipakai client dan server. |

---

## 5. Prinsip & Batasan Arsitektur Offline-First

### 5.1 Stack (konteks batasan teknis; `DISEPAKATI`)

| Lapisan | Pilihan |
|---|---|
| Gaya arsitektur | **Modular monolith**: satu deployable, satu PostgreSQL, modul berbatas jelas di dalam kode (Bab 5.10) |
| Framework | TanStack Start + React + TypeScript + TanStack Query |
| Styling | Tailwind |
| Database server | PostgreSQL (self-host di VPS dengan Docker) + Row Level Security |
| ORM | Drizzle ORM |
| Auth back-office | Better Auth, plugin *organization*: **identitas global (email + password) + keanggotaan per tenant** (BR-IDN); **tanpa username** dan **tanpa email di MVP** |
| Rate limit | Nginx `limit_req` + pustaka pembatas di aplikasi (kandidat `rate-limiter-flexible`, **dipilih**; final setelah verifikasi teknis awal F1; BR-RLM-013) |
| Auth terminal | Device enrollment + PIN kustom |
| Penyimpanan lokal | Dexie (IndexedDB) + outbox custom |
| PWA | Workbox via vite-plugin-pwa |
| Validasi | Zod |
| Lokalisasi (i18n) | **Library i18n** ditambahkan atas keputusan user; kandidat `i18next` + `react-i18next` (ICU untuk jamak/interpolasi), pilihan final saat implementasi (BR-I18N-011) |
| ID | UUIDv7 |
| Struktur folder | Mengikuti referensi `D:\React\Tanstack router\financeDashboard` — **dikerjakan nanti, tidak dibuat sekarang** |

### 5.2 Prinsip Arsitektur

| ID | Prinsip | Status |
|---|---|---|
| AP-01 | **Server adalah otoritas** yang memutuskan hasil akhir; device adalah pencatat fakta awal. | `DISEPAKATI` |
| AP-02 | **Fakta tidak ditolak**: penjualan yang sudah terjadi diterima walau stok minus, harga beda, produk nonaktif. | `DISEPAKATI` |
| AP-03 | Tiap device **mandiri** saat offline; tidak ada sync LAN antar device. | `DISEPAKATI` |
| AP-04 | **Master data satu arah turun** (server → device); **data transaksi satu arah naik** (device → server). | `DISEPAKATI` |
| AP-05 | **Uang = integer**, tidak pernah float; pecahan dibulatkan di titik terdefinisi, hasil disimpan, tidak dihitung ulang. | `DISEPAKATI` |
| AP-06 | **Satu package perhitungan bersama** client & server → struk offline = catatan server. | `DISEPAKATI` |
| AP-07 | **Snapshot di transaksi**: harga, tarif pajak, nama item disalin ke transaksi; perubahan master tidak mengubah masa lalu. | `DISEPAKATI` |
| AP-08 | **Jam device tidak dipercaya**; server adalah acuan urutan. | `DISEPAKATI` |
| AP-09 | **Append-only** untuk ledger stok, audit log, event open bill. | `DISEPAKATI` |
| AP-10 | **Cetak tidak menghalangi checkout**; kegagalan cetak tidak menggagalkan penjualan. | `DISEPAKATI` |
| AP-11 | **Model data siap diperluas** (hub LAN, KDS) tanpa migrasi destruktif. | `DISEPAKATI` |
| AP-12 | **Modular monolith**: satu deployable, batas modul eksplisit dan ditegakkan otomatis (lint dependensi di CI); transaksi bisnis lintas modul tetap satu transaksi database. | `DISEPAKATI` |

### 5.3 Struktur Aplikasi (KEP-02)

| Area | Rute | Perilaku |
|---|---|---|
| Back-office | `/<slug>/admin` | SSR, **online-only**. Tempat CRUD master, inventori, laporan, device, role. |
| POS | `/<slug>/pos` | SPA offline; app shell di-precache service worker; membaca master dari Dexie. |
| Admin platform | `/platform` | Akun terpisah dari tenant; membuat/menangguhkan tenant, mengatur versi minimum (BR-TEN-008). |
| Root | `/` | **404** (BR-TEN-001). |

Tulisan `/admin` dan `/pos` di bagian lain dokumen ini berarti `/<slug>/admin` dan `/<slug>/pos` untuk tenant yang bersangkutan (BR-TEN-001).

Aturan:
- **BR-SYN-001** (`DISEPAKATI`): CRUD data master (kategori, sub-kategori, produk, harga, UOM, varian, dll.) hanya dapat dilakukan online di back-office. Device POS menyimpan salinan **baca-saja**.
- **BR-SYN-002** (`DISEPAKATI`): Update PWA berbasis **prompt** ("Pembaruan tersedia — muat ulang?"); aplikasi tidak boleh berganti versi otomatis di tengah shift. Skema Dexie dan outbox **berversi**. Perilaku saat pengguna menolak update → BR-SYN-003; momen aman dan pembaruan keras → BR-VER-003/004.

- **BR-SYN-003 — Menolak/menunda update PWA (`DISEPAKATI`; detail `DIUSULKAN`).**
  1. **Menolak ("Nanti") sah.** Aplikasi tetap berjalan di versi lama; tidak ada data hilang selama versi device masih **N atau N−1** (BR-SYN-022).
  2. **Pengingat:** selama versi baru tersedia dan belum diterapkan, **banner pembaruan non-blokir tampil di semua halaman** (termasuk layar checkout) dan **dialog prompt muncul lagi setiap 2 jam**. Tombol "Perbarui" pada banner/dialog **hanya aktif pada momen aman** (BR-VER-004); dialog **tidak memotong** checkout/pembayaran yang sedang berlangsung (ditunda sampai selesai). Banner ini adalah banner **pembaruan**, bukan banner perbedaan versi (BR-VER-007).
  3. **Masa toleransi:** versi kontrak yang digantikan tetap diterima server **minimal 30 hari** sejak penggantinya dirilis (BR-VER-002; `DISEPAKATI`, OQ-29 terjawab; menggantikan angka 14 hari sebelumnya).
  4. **Rilis wajib:** rilis yang tidak kompatibel dengan versi lama ditandai **wajib** oleh server; prompt tanpa tombol "Nanti"; update **diterapkan otomatis hanya pada momen aman keras** (BR-VER-004: tanpa shift terbuka, tanpa keranjang/pembayaran/dialog, outbox kosong atau terkunci aman) agar aplikasi tidak berganti versi di tengah shift. Shift yang sedang terbuka boleh dilanjutkan dan ditutup; **shift baru tidak dapat dibuka** sebelum update diterapkan.
  5. **Device usang** (versi sudah melewati toleransi dan ditolak server): transaksi tetap tersimpan di device, perintah **ditahan di outbox** (tidak hilang, dapat diekspor, BR-SYN-052), banner "wajib update" tampil, dan **shift baru diblokir** sampai update.
  6. Update hanya dapat diunduh saat online; device yang lama offline tetap dibatasi lease 7 hari (BR-AUT-008). Versi aplikasi tiap device tampil di daftar device (FR-DEV-004).
  *Contoh:* v8 dirilis 1 Desember. Kasir menekan "Nanti" → banner tetap tampil di semua layar, dialog muncul lagi 2 jam kemudian (tidak saat pembayaran). Server menerima perintah v7 paling tidak sampai 31 Desember (30 hari). Device yang masih v7 pada 2 Januari: transaksi tetap tersimpan, 9 perintah pending ditahan, banner "wajib update", shift baru diblokir; setelah update (pada momen aman) dan sync, 9 perintah terkirim.

### 5.4 Pull Sync Master Data (counter versi per tenant)

#### BR-SYN-010 — Mekanisme (`DISEPAKATI`)

1. Setiap tenant punya **satu counter versi** (`tenant_sync`).
2. Setiap penulisan master dilakukan dalam transaksi database yang: (a) menaikkan counter dan mengambil nilai barunya secara atomik, (b) menulis perubahan data, (c) men-stamp kolom `version` setiap baris yang berubah dengan nilai tersebut — semuanya **dalam transaksi yang sama**.
3. Penaikan counter mengunci baris counter tenant (row lock) sampai commit. Penulis lain menunggu → **urutan versi = urutan commit, tanpa celah**.
4. Impor massal = **satu transaksi, satu kenaikan versi** (banyak baris berbagi versi yang sama).
5. Pull: device mengirim cursor `(versi, id)`; server mengembalikan baris dengan `version > cursor` diurutkan `version, id`, **termasuk tombstone** (soft delete tetap ikut feed). Pagination memakai pasangan `(version, id)` karena banyak baris bisa berbagi versi.
6. **Full resync** bila cursor device lebih lama dari batas pembersihan tombstone (default 30 hari, `DIUSULKAN`) atau versi skema tidak kompatibel.
7. Filter pull per device: baris tingkat tenant + baris dengan `outlet_id` outlet device itu. Counter tetap satu per tenant, sehingga cursor tetap satu.
8. **Stok per outlet di POS adalah snapshot terpisah** (bukan feed berversi): server mengembalikan saldo per SKU beserta waktu acuan server. Data bervolume tinggi (penjualan, ledger stok) **hanya mengalir ke atas**.

#### BR-SYN-011 — Alasan desain: dua cursor naif yang melewatkan baris (`DISEPAKATI`)

**Jebakan 1 — cursor `updated_at`.** Di PostgreSQL, `now()` = waktu **awal transaksi**, bukan waktu commit.

| Waktu | Transaksi A (ubah harga Kopi) | Transaksi B (ubah harga Susu) | Device |
|---|---|---|---|
| 10:00:00 | BEGIN → `updated_at` Kopi = 10:00:00 | | |
| 10:00:02 | | BEGIN → `updated_at` Susu = 10:00:02 | |
| 10:00:03 | | COMMIT | |
| 10:00:04 | | | Pull `updated_at > 09:59:00` → dapat Susu; cursor := 10:00:02 |
| 10:00:05 | COMMIT | | |
| 10:01:00 | | | Pull `updated_at > 10:00:02` → Kopi (10:00:00) **tidak pernah terpilih** |

**Jebakan 2 — cursor sequence (bigserial).** Nilai sequence diberikan saat *insert*, bukan saat *commit*. A mendapat 101, B mendapat 102; B commit lebih dulu; device pull, melihat 102, cursor := 102; A commit kemudian dengan 101 → `101 > 102` salah → **tidak pernah terambil**.

**Solusi counter versi:** A menaikkan counter → versi 41 dan menahan lock sampai commit. B yang mencoba menaikkan counter **menunggu**, baru mendapat 42 setelah A commit. Maka pada setiap saat, himpunan versi yang sudah committed selalu berupa **prefiks tanpa celah** (≤ N). Cursor = versi terbesar yang sudah diterima aman.

**Konsekuensi yang diterima:** penulis master per tenant diserialkan. Dapat diterima karena penulisan master jarang dan singkat; transaksi master **harus pendek** (BR-SYN-012).

- **BR-SYN-012** (`DIUSULKAN`): Transaksi penulisan master tidak boleh melakukan I/O eksternal atau komputasi berat sambil menahan lock counter; impor massal dipecah menjadi tahap *validasi di luar transaksi* lalu *penulisan singkat dalam satu transaksi*.
- **BR-SYN-013** (`DIUSULKAN`): Contoh angka — tenant berada di versi 120. Owner mengubah harga 3 SKU lewat satu form (satu transaksi) → ketiga baris `version = 121`. Device dengan cursor `(120, …)` mendapat 3 baris itu pada pull berikutnya. Impor 4.000 SKU = satu transaksi → semua `version = 122`; device menariknya berhalaman 500 baris per halaman dengan cursor `(122, id-terakhir)`.

### 5.5 Push Sync (Outbox Hibrida)

- **BR-SYN-020** (`DISEPAKATI`): **Finalisasi penjualan = SATU perintah atomik lengkap** (`FinalizeSale`) berisi item, harga snapshot, diskon, pajak, pembayaran, shift, register, nomor invoice. Server memprosesnya **idempoten** (key = UUIDv7 buatan client) dalam **satu transaksi**: pengiriman ulang dengan key sama mengembalikan hasil yang sama tanpa efek ganda.
- **BR-SYN-021** (`DISEPAKATI`): Perubahan open bill (item ditambah/void) = **event append-only** (`BillEvent`), bukan penimpaan status.
- **BR-SYN-022** (`DISEPAKATI`): Setiap perintah membawa **nomor versi skema**. Server menerima versi **N** dan **N−1**, sehingga update app di tengah antrean tidak merusak perintah tertunda; versi yang digantikan tetap diterima **minimal 30 hari** (BR-VER-002, BR-SYN-003). "Nomor versi skema" = **versi kontrak** (BR-VER-001). Saat app diperbarui, migrasi Dexie wajib juga **menaikkan versi payload outbox** yang tertunda.
- **BR-SYN-023** (`DIUSULKAN`): Urutan pengiriman: FIFO per register, kecuali perintah yang bergantung pada perintah lain (mis. event bill yang sama; nota kredit yang merujuk invoice yang belum terkirim) — perintah bergantung ditahan sampai perintah induknya sukses.
- **BR-SYN-024** (`DIUSULKAN`): Retry untuk kegagalan transien (jaringan/5xx) memakai backoff eksponensial: 5 dtk → 15 dtk → 1 mnt → 5 mnt (maksimum), tanpa batas jumlah percobaan. Respons **`429` + `Retry-After`** dari pembatas laju diperlakukan sebagai RETRY: klien menunggu `max(Retry-After, backoff)` dan **tidak menaikkan hitungan percobaan** (BR-RLM-005).

#### BR-SYN-030 — Kebijakan kegagalan push (`DISEPAKATI`)

| Jenis kegagalan | Perlakuan |
|---|---|
| Alasan **bisnis** (stok minus, harga beda dari harga terbaru, produk dinonaktifkan, pajak berubah) | **DITERIMA sebagai fakta.** Server menandai (flag) untuk laporan/manager; tidak menolak. |
| **Struktural** (payload rusak/gagal validasi Zod, referensi tidak dikenal) | Masuk antrean **"perlu perhatian"** yang terlihat manager. |
| **Otorisasi** (device dicabut, credential tidak valid) | Masuk antrean **"perlu perhatian"**. |
| Transien (jaringan, timeout, 5xx) | Retry (BR-SYN-024); bukan "perlu perhatian". |
| Dibatasi laju (`429` + `Retry-After`) | Transien/RETRY menurut `Retry-After`; **tidak** menaikkan percobaan, **bukan** "perlu perhatian", **bukan** kegagalan konektivitas (BR-RLM-005). |

Antrean lain tetap berjalan (tidak ada head-of-line blocking), kecuali perintah yang bergantung (BR-SYN-023).

### 5.6 Pemicu Sync & Realtime

- **BR-SYN-040** (`DISEPAKATI`): Sync (push lalu pull) dipicu oleh: (a) app aktif/dibuka/fokus, (b) event `online`, (c) interval berkala (default 60 detik saat online, `DIUSULKAN`), (d) setelah finalisasi penjualan (push segera). **Background Sync API tidak diandalkan.**
- **BR-SYN-041** (`DISEPAKATI`): Realtime (SSE/WebSocket) hanya mengirim **sinyal "ada perubahan, silakan pull"**; data tetap diambil lewat mekanisme pull. Kehilangan sinyal tidak menyebabkan kehilangan data (interval tetap berjalan).

### 5.7 Waktu & Hari Bisnis (KEP-01)

- **BR-TIM-001** (`DISEPAKATI`): Semua timestamp disimpan **UTC (`timestamptz`)**.
- **BR-TIM-002** (`DISEPAKATI`): Tiap outlet punya **ID zona waktu IANA**: `Asia/Jakarta` (WIB, UTC+7), `Asia/Makassar` (WITA, UTC+8), `Asia/Jayapura` (WIT, UTC+9).
- **BR-TIM-003** (`DISEPAKATI`): Tiap outlet punya **jam potong hari bisnis** yang dapat diatur (default `00:00`; mis. `04:00` untuk F&B malam).
- **BR-TIM-004** (`DISEPAKATI`): `business_date` dihitung **saat transaksi dibuat** (finalisasi) dan **disimpan**; laporan **tidak** menurunkannya ulang. Perubahan zona/jam potong outlet hanya berlaku untuk transaksi berikutnya.
- **BR-TIM-005** (`DISEPAKATI`): **Jam device tidak dipercaya.** Device mencatat waktu lokal + **clock offset** terhadap server dari sync terakhir; **server** adalah waktu acuan urutan. `business_date` di device dihitung memakai `waktu_device + offset`.
- **BR-TIM-006** (`DIUSULKAN`): Deteksi anomali: bila |offset| > 10 menit, tampilkan peringatan ke manager; bila jam device mundur melewati waktu tertinggi yang pernah dilihat (indikasi manipulasi), device dikunci sampai sync (lihat BR-AUT-013).

**Contoh (BR-TIM-003/004/005):** Outlet "OUT01" di `Asia/Jakarta`, jam potong `04:00`.

| Kejadian | Waktu lokal outlet | UTC | `business_date` |
|---|---|---|---|
| Penjualan malam | 2026-11-18 02:30 | 2026-11-17 19:30 | **2026-11-17** |
| Penjualan tepat jam potong | 2026-11-18 04:00:00 | 2026-11-17 21:00 | **2026-11-18** (batas awal inklusif) |
| Penjualan pagi | 2026-11-18 09:10 | 2026-11-18 02:10 | **2026-11-18** |

Jam device lebih cepat 7 menit (offset = −7 menit): device menampilkan 02:30 saat waktu sebenarnya 02:23 → `business_date` dihitung dari 02:23 → tetap 2026-11-17. Bila outlet di `Asia/Jayapura` (UTC+9) dengan jam potong 00:00, transaksi 2026-11-18 00:20 WIT = 2026-11-17 15:20 UTC → `business_date` = 2026-11-18.

### 5.8 Penyimpanan Lokal & Skala (KEP-01)

| Parameter | Nilai | Status |
|---|---|---|
| Durasi offline yang didukung | Jam sampai 1 hari | `DISEPAKATI` |
| Katalog di device | ≤ 5.000 produk (= ≤ 5.000 SKU aktif per outlet; OQ-22 terjawab) | `DISEPAKATI` |
| Transaksi per hari per outlet | ≤ 500 | `DISEPAKATI` |
| Retensi riwayat transaksi tersinkron di device | **3 bulan** (±45 ribu transaksi/device) | `DISEPAKATI` |
| Data yang belum sync | **Tidak pernah dibuang** | `DISEPAKATI` |

- **BR-SYN-050** (`DISEPAKATI`): App meminta `navigator.storage.persist()` saat pertama kali dijalankan dan mencatat hasilnya.
- **BR-SYN-051** (`DISEPAKATI`): Banner peringatan permanen bila ada transaksi pending: **"Ada N transaksi belum terkirim sejak X jam."**
- **BR-SYN-052** (`DISEPAKATI`): Tombol **ekspor transaksi pending ke file** (jaring pengaman); sync agresif (BR-SYN-040).
- **BR-SYN-053** (`DISEPAKATI`, risiko residual): Bila storage browser dibersihkan sebelum sync, transaksi pending hilang dan **nomor invoice bolong**. Risiko diterima (RSK-02).
- **BR-SYN-054** (`DIUSULKAN`): Pembersihan retensi lokal menghapus transaksi **yang sudah tersinkron** dengan `business_date` lebih tua dari 3 bulan kalender; dijalankan saat app idle. Estimasi ukuran: 45.000 transaksi × ±3 KB ≈ 135 MB + katalog ≈ 150 MB; peringatan bila kuota storage terpakai > 70%.

### 5.9 Batasan Perangkat & Peramban

| Batasan | Dampak |
|---|---|
| Target: Android (tablet/HP) dan Windows (PC/laptop); **iOS bukan target** | Boleh memakai API Chromium (WebUSB, Web Bluetooth, BarcodeDetector) |
| Peramban yang didukung: Chrome/Edge (Chromium) 2 versi mayor terakhir | Firefox/Safari tidak didukung untuk `/pos` (`DIUSULKAN`) |
| Konteks aman (HTTPS) wajib | Syarat PWA, WebUSB, Web Bluetooth |
| Web Bluetooth hanya **BLE**; Bluetooth klasik (SPP) **tidak didukung** | Printer SPP-only tidak bisa dipakai via jalur BLE (RSK-07) |
| USB di Windows sering dikunci driver bawaan | Perlu driver WinUSB, atau fallback `window.print` + `--kiosk-printing` (RSK-07) |

### 5.10 Arsitektur Modular Monolith (KEP-20)

> Gaya arsitektur internal aplikasi. Hanya aturan dan pemetaan modul; **struktur folder dan kode tidak ditulis di PRD** (menunggu referensi `financeDashboard`). Tidak mengubah satu pun aturan bisnis di Bab 7.

**BR-ARC-001 — Gaya arsitektur (`DISEPAKATI`).** Aplikasi berbentuk **modular monolith**: satu deployable (TanStack Start), satu PostgreSQL, dengan modul domain berbatas jelas di dalam kode. **Bukan** microservices. Alasan: transaksi atomik lintas domain (`FinalizeSale`, BR-SYN-020) tetap satu transaksi database; satu pipeline dan satu repo cocok untuk solo developer.

**BR-ARC-002 — Daftar modul (`DISEPAKATI`: pembagian kasar ±8–10 modul; Shift & Kas modul sendiri; definisi resep di Katalog).**

| Modul | Cakupan | Aturan rujukan |
|---|---|---|
| Identitas & Tenancy | tenant, entitas hukum, outlet, register, device, user, role, PIN, otorisasi | BR-TNT, BR-AUT |
| Katalog | kategori, produk, varian/SKU, UOM, barcode, harga, ketersediaan outlet, modifier, **definisi resep/BOM** | BR-CAT, BR-UOM, BR-PRC |
| Penjualan | sale, diskon, pajak, pembayaran, invoice & seri nomor, gap, retur/nota kredit | BR-MNY, BR-TAX, BR-DSC, BR-PAY, BR-INV, BR-RTR |
| Shift & Kas | shift, kas masuk/keluar, blind count, selisih, tutup darurat | BR-SHF |
| Inventori | ledger, saldo, HPP, GR, transfer, opname, **konsumsi resep** | BR-STK, BR-HPP, BR-TRF, BR-RCP |
| F&B | meja, open bill, lease, event bill, split/merge | BR-FNB, BR-SPL |
| Sync | counter versi, pull, push, idempotensi, antrean "perlu perhatian" | BR-SYN, BR-TIM |
| Audit | log append-only | BR-AUD |
| Laporan | pembaca-saja lintas modul | Bab 12 |
| *Kernel bersama* (bukan modul bisnis) | uang, kuantitas, pembulatan/LR, ID, waktu & `business_date` (AP-06) | BR-MNY, BR-TIM |

Di sisi client, modul **Cetak** dan **Lokalisasi** (BR-PRN, BR-I18N) berada di aplikasi `/pos`/`/admin` dan tidak memiliki tabel server.

**BR-ARC-003 — Kepemilikan data (`DISEPAKATI` prinsip; pemetaan `DIUSULKAN`).** Tiap modul **memiliki tabelnya sendiri**; modul lain **tidak boleh menulis atau join langsung**, hanya lewat antarmuka publik modul pemilik. Pemetaan entitas Bab 6.3:

| Modul | Entitas yang dimiliki |
|---|---|
| Identitas & Tenancy | `tenant`, `legal_entity`, `outlet`, `register`, `device`, `pairing_code`, `account`, `tenant_member`, `tenant_invitation`, `role`, `permission`, `user_outlet`, `staff_pin`, `tenant_feature_flag` |
| Katalog | `category`, `product`, atribut, `sku`, `uom`, `sku_uom`, `price_entry`, `item_outlet_availability`, `modifier_group`, `modifier`, `recipe_item` |
| Penjualan | `sale`, `sale_line`, `sale_payment`, `credit_note`(+baris), `invoice_gap`, **pencatatan seri nomor** (nomor tertinggi/gap per register & `MMYY`) |
| Shift & Kas | `shift`, `cash_movement` |
| Inventori | `stock_balance`, `stock_movement`, `goods_receipt`, `transfer`, `stocktake`, pemasok |
| F&B | `table`, `bill`, `bill_event` |
| Sync | `tenant_sync`, kunci idempotensi, `attention_item` |
| Audit | `audit_log` |

**BR-ARC-004 — Arah dependensi (`DIUSULKAN`).** Satu arah, **tanpa siklus**:

```
F&B ──> Penjualan ──> Shift & Kas ──> Identitas & Tenancy
                 ├──> Inventori ──> Katalog ──> Identitas & Tenancy
                 └──> Katalog
Laporan ──(baca saja)──> semua modul
Sync, Audit, Log, Kernel bersama: dipakai semua modul; tidak bergantung pada modul bisnis
```

Penjualan tidak mengetahui F&B (hanya menyimpan `bill_id` sebagai rujukan buta); F&B memanggil Penjualan saat membayar.

**BR-ARC-005 — Transaksi lintas modul (`DISEPAKATI` melalui BR-SYN-020; urutan panggilan `DIUSULKAN`).** Perintah atomik dijalankan **di dalam proses yang sama dan satu transaksi database**, diorkestrasi oleh modul Penjualan; tidak memakai event asinkron di dalam transaksi bisnis. *Contoh `FinalizeSale` untuk 2 Nasi Goreng:* (1) Sync memeriksa kunci idempotensi → baru; (2) Penjualan memvalidasi dan menyimpan `sale` + baris (invoice `OUT01-POS02-1126-000131`); (3) Shift & Kas mengikat ke shift terbuka dan mencatat kontribusi tunai; (4) Inventori mengonsumsi resep (4 bahan) dan **mengembalikan HPP 8.720**; (5) Penjualan menyimpan `cost_snapshot` 8.720 pada baris; (6) Audit menulis entri; (7) commit. Bila ada kegagalan struktural di tengah, **seluruh transaksi di-rollback** dan perintah masuk antrean "perlu perhatian" (tidak ada penjualan setengah jadi); sebaliknya, kondisi bisnis seperti stok minus **tidak pernah** menggagalkan langkah (AP-02).

**BR-ARC-006 — Penulisan master lewat satu pintu (`DISEPAKATI` melalui BR-SYN-010).** Modul pemilik data master (Identitas, Katalog, F&B untuk meja) menulis **hanya lewat fungsi milik modul Sync** yang menaikkan counter versi dan men-stamp `version` dalam transaksi yang sama. Penulisan master tanpa jalur itu dilarang dan diuji.

**BR-ARC-007 — Laporan baca-saja (`DIUSULKAN`).** Modul Laporan membaca tabel modul lain lewat view/read model terdaftar; tidak pernah menulis. RLS tenant tetap berlaku (BR-TNT-001).

**BR-ARC-008 — Tenant dan RLS di semua modul (`DISEPAKATI` melalui BR-TNT-001).** Seluruh modul memakai konteks tenant yang sama; tidak ada modul yang melewati RLS.

**BR-ARC-009 — Penegakan batas (`DISEPAKATI`).** Batas modul ditegakkan oleh **aturan lint dependensi di CI** (NFR-MNT-002): impor ke bagian internal modul lain, atau dependensi yang melawan arah BR-ARC-004, membuat build **gagal**. *Contoh:* modul Inventori mengimpor berkas internal Penjualan → build gagal; Inventori memanggil antarmuka publik Katalog → lolos.

**BR-ARC-010 — Sisi client (`DIUSULKAN`).** Pembagian modul client mengikuti server: salinan katalog, penjualan lokal, shift lokal, outbox (milik Sync), antrean cetak (modul Cetak). **Kernel bersama** (hitung uang/pembulatan) adalah satu paket untuk client dan server (AP-06) dan **tidak bergantung** pada modul bisnis mana pun.

**BR-ARC-011 — Kesiapan ekstraksi (`DIUSULKAN`).** Karena antarmuka publik eksplisit, modul dapat diekstrak kelak (mis. Laporan, gateway Sync, KDS/hub LAN — AP-11) tanpa mengubah aturan bisnis. Di MVP **tidak ada** ekstraksi.

**BR-ARC-012 — Urutan modul per fase (`DIUSULKAN`).** F1: Identitas & Tenancy, Sync, Audit, Kernel bersama. F2: Katalog. F3: Penjualan, Shift & Kas, Cetak (client), laporan penjualan/shift. F4: Inventori, laporan stok. F5: F&B (dan konsumsi resep oleh Inventori untuk menu). Detail fase di Bab 13.

### 5.11 Manajemen Log & Observabilitas Dasar (KEP-21)

> Mengacu pola logging proyek referensi `D:\React\Tanstack router\financeDashboard` (pino, satu objek JSON per baris, konteks request otomatis, field tertutup, redaksi data sensitif, file harian + retensi, pencarian lewat skrip). Hanya aturan perilaku; **tidak ada kode atau skrip yang dibuat di PRD**. Monitoring sync lag dan backup tetap di luar MVP (RSK-09); log ini fondasi yang membuat keduanya murah ditambahkan kelak.

**BR-LOG-001 — Log operasional ≠ audit log (`DISEPAKATI`).** Dua hal terpisah: **audit log** (BR-AUD: peristiwa bisnis, append-only, disimpan tanpa penghapusan, OQ-03) dan **log operasional** (diagnostik teknis, dibuang sesuai retensi). Keduanya tidak saling menggantikan. *Contoh:* void invoice → audit log; kegagalan push karena timeout 504 → log operasional.

**BR-LOG-002 — Format dan tujuan tulis (`DISEPAKATI`: ikuti referensi).** Satu objek JSON per baris, dibuat lewat **satu pembuat logger** (format seragam di seluruh modul). Level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` (default `info`, diatur lewat konfigurasi). Baris ditulis ke **stdout** (untuk log kontainer) **dan** ke **file harian** di volume persisten Docker, mis. `app.2026-11-17.1.log` (rotasi harian). Kegagalan file (disk/izin) **tidak menghentikan server**: log tetap ke stdout dan pembukaan file dicoba lagi tiap 60 detik. Logger tidak boleh memperlambat atau menggagalkan transaksi bisnis (NFR-OBS-003).

**BR-LOG-003 — Waktu log (`DIUSULKAN`).** Waktu tiap baris ditulis dalam **UTC** dengan akhiran `Z` (konsisten BR-TIM-001; berbeda dari referensi yang memakai zona waktu aplikasi tunggal, karena Solva POS punya outlet di tiga zona). File harian dipotong menurut tanggal UTC. Pencarian menerima rentang waktu dalam UTC.

**BR-LOG-004 — Konteks otomatis (`DISEPAKATI` prinsip; field `DIUSULKAN`).** Setiap baris yang ditulis selama sebuah request atau job otomatis membawa: `reqId`, `tenantId`, `userId` (staf/pengguna, bila diketahui), `deviceId` dan `registerId` (untuk request dari terminal), `commandId` (idempotency key perintah push yang sedang diproses), `jobId`/`parentReqId` (job latar belakang), serta `env`, `appVersion`, dan `schemaVersion`. Pemanggil **tidak** mengisinya manual; konteks dibawa secara otomatis sepanjang pemrosesan.

**BR-LOG-005 — ID referensi (`DISEPAKATI` prinsip; bentuk `DIUSULKAN`).** Tiap request mendapat ID `YYYYMMDD-HHmmss-xxxxx` (waktu UTC + 5 karakter acak dari alfabet tanpa huruf mirip `i`, `l`, `o`, `0`, `1` agar tidak salah ketik dari layar/foto); job latar belakang berawalan `job-`. ID dikembalikan di header `X-Request-Id`, ditulis di setiap baris request itu, dan ada **satu baris "access"** per request (metode, path tanpa data sensitif, status, durasi). `X-Request-Id` dari proxy hanya dipakai bila bentuknya aman (≤ 64 karakter, `A–Z a–z 0–9 . _ -`).

**BR-LOG-006 — Daftar field tertutup (`DISEPAKATI` prinsip; daftar `DIUSULKAN`).** Hanya field yang terdaftar yang boleh ditulis; menulis nama field baru mengharuskan mendaftarkannya lebih dulu (mencegah dua ejaan berbeda yang tidak ditemukan pencarian). Daftar awal: `err`, `reason`, `label`, `durationMs`, `fn`, `publicCode`, `method`, `path`, `status`, `ip`, `commandId`, `commandType`, `outcome` (`ACK`/`RETRY`/`ATTENTION`), `saleId`, `invoiceNo`, `outletId`, `cursorFrom`, `cursorTo`, `rowCount`, `schemaVersion`, `appVersion`, `origin`, `route`, `userAgent`, `componentStack`, `clientError`, `usernameHash`, `usernameLength`, **`localId`** (ID lokal error device, BR-ERR-006), **`area`** (area error boundary, mis. `keranjang`; BR-ERR-007), **`errorClass`** (kelas kegagalan, BR-SYN-030), dan **`limitKeyHash`** (hash pendek kunci pembatas laju; BR-RLM-013).

**BR-LOG-007 — Larangan konten sensitif (`DISEPAKATI`; detail `DIUSULKAN`).** Log **tidak pernah** memuat: PIN atau hash PIN, password, token/credential device, kode pairing, **nama dan telepon pelanggan** (BR-CUS), isi struk, dan **nilai parameter SQL**. Percobaan login/PIN gagal hanya mencatat **hash pendek 8 karakter dan panjang** teks yang diketik (orang kadang mengetik PIN di kolom nama). Galat melewati **serializer** yang membuang nilai data dari pesan galat database (SQL ditulis dengan placeholder saja; hanya baris `at …` pada stack yang disimpan). `invoiceNo` dan `saleId` boleh ditulis (bukan data pribadi).

**BR-LOG-008 — Kode error publik "KODE#id" (`DISEPAKATI`; daftar 22 kode terjawab, OQ-32).** Pengguna (client) tidak pernah menerima stack trace/SQL. Error dari server berbentuk **`KODE#ID-referensi`**, mis. **`TIMEOUT#20261117-143551-k7q2m`**; error mentah tetap di log dengan ID yang sama. Kode terdiri atas **6 kode umum** (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_FAILED`, `DB_UNAVAILABLE`, `TIMEOUT`, `INTERNAL_ERROR`) dan **kode spesifik domain** (mis. `PRINT_FAILED`, `PIN_LOCKED`, `DEVICE_REVOKED`, `UPDATE_REQUIRED`, `STORAGE_LOW`, `SYNC_HELD`), semuanya dalam **katalog kode error yang stabil** (BR-ERR-002/003). Hanya error **tingkat (c)** BR-ERR-001 yang menampilkan `KODE#id`. Layar menampilkan kode + ID + **satu kalimat tindakan** + tombol **Salin** (BR-ERR-004/005); kalimat tindakan mengikuti BR-I18N, **kode dan ID tidak diterjemahkan**.

**BR-LOG-009 — Log sync (`DIUSULKAN`).** Tiap perintah push yang diproses menulis satu baris: `commandId`, `commandType`, `schemaVersion`, `outcome` (`ACK`/`RETRY`/`ATTENTION`), `durationMs`; kegagalan struktural/otorisasi ditulis sebagai `error` memuat `commandId` yang sama dengan item di antrean "perlu perhatian" (BR-SYN-030), sehingga keduanya dapat dikorelasikan. Tiap pull menulis satu baris ringkas: `cursorFrom`, `cursorTo`, `rowCount`, `durationMs`. Kondisi bisnis yang diterima (stok minus, harga stale, item tidak tersedia, nomor konflik) **bukan** error log; cukup tercatat sebagai flag data (BR-SYN-030) dan, bila perlu, satu baris `info`.

**BR-LOG-010 — Log dari device (`DISEPAKATI`: antrean log di device, ikut sync).** Device mencatat log lokal untuk: error aplikasi (termasuk error render), kegagalan cetak, kegagalan sync, anomali jam, penolakan `storage.persist`, kuota storage tinggi, penerapan/penolakan update PWA, crash render per area, dan kegagalan start aplikasi (BR-ERR-007/008). Aturan:
1. Disimpan di Dexie sebagai **antrean berukuran terbatas** (usulan 500 entri); bila penuh, entri **tertua dibuang**. *Berbeda dari outbox transaksi yang tidak pernah dibuang* (BR-SYN-051): log bersifat diagnostik.
2. Dikirim **bersama sync** saat online dengan batas laju (usulan ≤ 100 entri per siklus sync dan ≤ 20 laporan per 10 menit per device, mengikuti pola referensi); kelebihan dibuang tanpa baris.
3. Tiap entri memuat: `deviceId`, `registerId`, `appVersion`, `schemaVersion`, waktu device terkoreksi offset (BR-TIM-005), kode error, `route`, stack ringkas (dipotong), dan **ID lokal** berformat `D-YYYYMMDD-HHmmss-xxxxx` (BR-ERR-006). **Tidak** memuat PIN, nama/telepon pelanggan, atau isi keranjang (BR-LOG-007).
4. Pengiriman log **tidak pernah** memblokir sync transaksi, dan kegagalan mengirim log **tidak** masuk "perlu perhatian".
5. Server menulisnya sebagai baris log dengan cakupan `device` dan field `localId`, sehingga dapat dicari bersama log server dengan ID lokal itu.
*Contoh:* tablet POS02 offline 3 jam; printer BLE gagal 4 kali → 4 entri lokal (kode `PRINT_FAILED`). Saat online, keempatnya terkirim pada siklus sync berikutnya dan dapat dicari berdasarkan `deviceId`.

**BR-LOG-011 — Retensi log (`DISEPAKATI`: 30 hari).** File log harian disimpan **30 hari** lalu dihapus otomatis; pembersihan dijalankan berkala (usulan tiap 6 jam) dan **hanya** menghapus file yang berpola nama log (file lain tidak pernah disentuh). Retensi dapat diatur lewat konfigurasi (1–3650 hari). Tidak berlaku untuk audit log (BR-LOG-001).

**BR-LOG-012 — Kegagalan proses (`DIUSULKAN`).** Pengecualian/penolakan yang lolos dari semua penanganan dicatat sebagai `fatal`, buffer ditulis ke file, lalu di produksi proses keluar agar didirikan ulang oleh kebijakan restart kontainer; di pengembangan hanya dicatat. Error fatal juga memicu **notifikasi Telegram** (BR-ERR-012).

**BR-LOG-013 — Pencarian log (`DISEPAKATI`: skrip CLI di server).** Pencarian memakai **skrip baris perintah di server** (bukan halaman `/admin`): filter menurut ID (`reqId`/`commandId`/`jobId`/`parentReqId`), level minimum, rentang waktu (UTC), `tenantId`, `userId`/`deviceId`, `localId`, dan awalan path; hanya membaca file harian yang relevan; menampilkan error beserta rantai penyebabnya; dan **menerjemahkan stack klien ke berkas dan baris sumber asli** memakai **source map privat** sesuai `appVersion` pada entri log (BR-ERR-011). *Contoh:* kasir melaporkan `TIMEOUT#20261117-143551-k7q2m` → pencarian dengan ID itu menampilkan baris access (`POST` push, status 504, `durationMs` 30012), baris sync (`commandType=FinalizeSale outcome=RETRY`), dan error dengan `err` lengkap.

**BR-LOG-014 — Lokasi dan operasional (`DIUSULKAN`).** File log berada di **volume persisten** (bukan di dalam image) agar bertahan saat kontainer dibuat ulang. Log tidak ikut backup (backup Postgres off-site di luar MVP, RSK-09). Disk penuh memicu perilaku BR-LOG-002 (stdout saja).

### 5.12 Versioning, Rilis, dan Kompatibilitas Klien (KEP-23)

> Keputusan user 2026-11-18 (`DISEPAKATI`); jendela dukungan 30 hari dan batas pembaruan keras (hanya saat shift tertutup) sudah dijawab user (OQ-29). Mengatur perilaku produk saat versi klien (device offline yang lama tidak diperbarui) dan versi server berbeda. Konsisten dengan lease offline 7 hari (BR-AUT-008), outbox N−1 (BR-SYN-022), dan kunci layar (BR-AUT-015).

**BR-VER-001 — Dua nomor versi (`DISEPAKATI`).**
- **Versi aplikasi:** SemVer `vMAJOR.MINOR.PATCH`; **git tag adalah sumber kebenaran** (rc: `vX.Y.Z-rc.N`).
- **Versi kontrak:** bilangan bulat monoton `N` yang naik **hanya** bila format perintah/event berubah **tidak kompatibel**. Penambahan field opsional tidak menaikkannya. PATCH **tidak boleh** menaikkan versi kontrak.
*Contoh:* app v1.4.2 = kontrak 7; v1.5.0 menambah field opsional → kontrak tetap 7; v1.6.0 mengubah bentuk payload `FinalizeSale` → **kontrak 8**.

**BR-VER-002 — Dukungan kontrak N−1 dan versi minimum (`DISEPAKATI`; 30 hari: OQ-29 terjawab).** Server mendukung kontrak **N dan N−1**. Kontrak lama (N−1) tetap diterima **minimal 30 hari** setelah rilis kontrak baru. Server menetapkan **versi kontrak minimum yang didukung** dan mengumumkan versi kontrak terkini + minimum pada setiap respons sync, sehingga klien dapat membandingkannya. Versi minimum bersifat **global** (satu nilai untuk seluruh tenant) dan diatur oleh **admin platform** (BR-TEN-008) dan **disimpan sebagai atribut pada baris rilis aplikasi terbaru** (`DISEPAKATI`, OQ-S25).
*Contoh:* kontrak 8 dirilis 1 Desember → kontrak 7 diterima sampai **paling cepat 31 Desember**; sesudahnya versi minimum boleh dinaikkan ke 8.

**BR-VER-003 — Klien usang (`DISEPAKATI`).** Tiga keadaan klien: **terkini** (kontrak = N); **didukung tapi lama** (kontrak = N−1 dalam jendela): banner pembaruan + dialog 2 jam (BR-SYN-003), perintah tetap diterima; **di bawah versi minimum**: banner pembaruan wajib, perintah **ditahan** di outbox (tidak hilang, dapat diekspor; BR-SYN-003 butir 5), shift baru diblokir, lalu **pembaruan keras** diterapkan setelah batas waktu — yaitu setelah versi minimum dinaikkan — **hanya pada momen aman keras** (BR-VER-004). Klien **tidak pernah** dipaksa diperbarui di tengah shift atau saat ada antrean sync yang tidak aman.

**BR-VER-004 — Momen aman (`DISEPAKATI`; pembaruan keras hanya saat shift tertutup: OQ-29 terjawab; rumusan kondisi lain `DIUSULKAN`).** Pembaruan aplikasi (service worker baru diaktifkan, aplikasi dimuat ulang) hanya diterapkan pada momen aman.

| Jenis | Kondisi |
|---|---|
| **Tombol "Perbarui" aktif** (atas inisiatif pengguna; banner/dialog BR-SYN-003) | Tidak ada pembayaran, dialog PIN supervisor, atau dialog serah-terima yang berlangsung; **tidak ada perintah outbox berstatus `SENDING`**; dan **salah satu**: tanpa keranjang aktif, **layar terkunci** (BR-AUT-015), atau shift tertutup / tidak ada shift terbuka |
| **Pembaruan keras otomatis** (klien di bawah versi minimum) | **Tanpa shift terbuka** (shift tertutup, atau register `PELAYAN` yang tidak memiliki shift); tanpa keranjang/pembayaran/dialog; dan **outbox kosong atau terkunci aman** |

Syarat antrean pada pembaruan keras adalah **antrean (outbox) kosong**. Satu-satunya pengecualian adalah *terkunci aman* — dibutuhkan agar klien di bawah versi minimum, yang perintahnya ditolak server dan karena itu tidak pernah kosong, tetap dapat diperbarui (tanpa pengecualian ini terjadi kebuntuan). *Terkunci aman* = tidak ada perintah `SENDING`, tidak ada perintah baru yang dapat masuk (shift tertutup/keranjang kosong), dan **setiap perintah `PENDING` punya migrasi ke kontrak baru yang teruji** (BR-SYN-022). Bila outbox belum aman dan device online, sync dipicu dulu dan pembaruan menunggu; bila offline atau tak kunjung aman, pembaruan **ditunda** (tidak pernah dipaksa). Setelah dimuat ulang, layar yang tadinya terkunci **tetap terkunci** dan shift/draf pulih (BR-AUT-015 butir 2).

**BR-VER-005 — Outbox dan migrasi saat pembaruan (`DISEPAKATI` melalui BR-SYN-022).** Pembaruan app menjalankan migrasi Dexie berversi yang juga **menaikkan payload perintah `PENDING`** ke kontrak baru; perintah kontrak lama tetap dapat dikirim bila masih dalam jendela dukungan. Pembaruan keras tidak dijalankan bila ada perintah yang tak dapat dimigrasi — perintah itu masuk "perlu perhatian" dengan opsi ekspor (EC-007).

**BR-VER-006 — Klien lebih baru daripada server (rollback server) (`DISEPAKATI`; perincian `DIUSULKAN`).** Bila server mengumumkan versi kontrak terkini **lebih rendah** daripada kontrak klien (mis. server di-rollback), klien **menahan perintah yang formatnya belum dikenal server** (kontrak lebih tinggi), menampilkan banner **"server sedang diperbarui"**, dan **terus menjual** — penjualan tetap tersimpan lokal dengan nomor invoice berurutan; **tidak ada data hilang**. Perintah berkontrak yang masih dikenal server tetap dikirim. Setelah versi server cocok kembali, **antrean terkirim otomatis** (urutan FIFO, BR-SYN-023). Penahanan ini **bukan** kegagalan struktural (tidak masuk "perlu perhatian") dan **tidak** dihitung sebagai kegagalan sync untuk lease 7 hari selama pull berhasil. Klien tidak menurunkan (downgrade) payload.

**BR-VER-007 — Tampilan versi (`DISEPAKATI`).** Versi aplikasi ditampilkan di **footer layar login** dan **pengaturan perangkat** (pengaturan perangkat juga menampilkan versi kontrak), mis. "Solva POS v1.6.0 · kontrak 8". **Tidak ada** banner perbedaan versi (yang ada hanya banner **pembaruan**, BR-SYN-003, dan banner **server sedang diperbarui**, BR-VER-006) dan versi **tidak** dicetak di struk pelanggan.

**BR-VER-008 — Jejak versi (`DISEPAKATI`).** Tiap **penjualan, nota kredit, perintah outbox, dan event bill** menyimpan **versi aplikasi** (`app_version`) dan **versi kontrak** (`contract_version`) saat dibuat. **Event bill append-only dibaca selamanya lintas kontrak**: pembaca event wajib mengenali semua kontrak historis (tidak ada event yang dibuang atau ditulis ulang karena kontrak berganti).
*Contoh:* event `ITEM_ADDED` bill M05-0003 dibuat oleh app v1.4.2 (kontrak 7) pada 20 November; dibaca oleh server v1.6.0 (kontrak 8) pada 5 Desember tanpa migrasi data; invoice `OUT01-POS02-1126-000131` menyimpan `app_version=1.4.2`, `contract_version=7`.

**BR-VER-009 — Feature flag per tenant (`DISEPAKATI`).** Flag fitur disimpan sebagai **master data tenant** (`tenant_feature_flag`) sehingga ikut **counter versi pull sync** (versi, tombstone, BR-SYN-010) dan **tersimpan di device**; saat **offline memakai nilai terakhir** yang diketahui. **Default tiap flag ditetapkan di kode**; baris master hanya menimpa default. **Hanya Owner** yang mengubah (di `/admin`, online); **POS bersifat baca-saja**. Nilai flag = **boolean dengan parameter opsional**, dan **berlaku di device setelah siklus pull selesai** (`DISEPAKATI`, OQ-S26). Perubahan flag tercatat di audit log (BR-AUD-001). Flag **tidak mengubah transaksi yang sudah terjadi**: penjualan yang dibuat saat flag aktif tetap diterima walau flag kemudian dinonaktifkan (AP-02).
*Contoh:* flag `fnb_serah_terima` default **nonaktif**; Owner mengaktifkannya pukul 10:00 (versi master 205). Tablet yang offline sejak 09:30 tetap memakai nilai nonaktif sampai pull berikutnya (mis. 11:15), lalu fitur muncul.

**BR-VER-010 — Catatan rilis dan proses rilis (`DISEPAKATI`; detail `DIUSULKAN`).**
1. Versi memakai **SemVer dengan git tag**; **staging dan production terpisah** (database, domain, kredensial, dan data).
2. Perubahan yang **memengaruhi angka** (pajak, pembulatan, HPP, nomor dokumen) **wajib** memiliki **catatan rilis tertulis** berisi bagian "Perubahan angka" dengan contoh sebelum/sesudah.
3. **Hotfix PATCH** memakai **jalur cepat** setelah **pengujian otomatis kunci lolos**: uji sync (FR-QA-001/002), vektor hitung bersama (FR-QA-003), migrasi outbox N−1 → N (FR-SYN-006), redaksi log (NFR-OBS-002), dan lint batas modul (NFR-MNT-002). MINOR/MAJOR memakai jalur penuh (build, staging, catatan rilis).
4. **Gerbang tes dijalankan di CI (GitHub Actions)**; **rilis dan deploy tetap manual dari komputer user** (CI tidak men-deploy; ini menyempurnakan pernyataan "tanpa CI" pada proses rilis sebelumnya).
*Contoh catatan rilis v1.6.1 (hotfix):* "Perubahan angka — pajak dihitung per bill, bukan per baris (BR-MNY-005): 3 baris @Rp1.050, PPN 11% eksklusif: sebelum **348** (3 × R(115,5) = 3 × 116), sesudah **347** (R(3.150 × 11%) = R(346,5))".

**BR-VER-011 — Migrasi database aditif (`DISEPAKATI`).** Migrasi skema bersifat **aditif saja** (tambah tabel/kolom ber-default atau boleh kosong) agar selaras dengan klien offline berkontrak N−1. Penghapusan atau penggantian nama/makna kolom dilakukan bertahap (tambah baru → isi → baca baru) dan baru boleh dihapus **setelah jendela dukungan kontrak lama berakhir**. **Backup dump penuh wajib sebelum migrasi yang menyentuh data lama** (backfill, ubah tipe, hapus); migrasi aditif murni tidak mewajibkan dump tetapi dianjurkan. (Backup otomatis off-site di luar MVP, RSK-09, sehingga dump dilakukan manual.)
*Contoh:* v1.5.0 menambah kolom `app_version` yang boleh kosong → aditif. v1.6.0 mengisi ulang `tax_alloc` untuk invoice lama → **dump penuh dulu**. Mengganti nama `schema_version` menjadi `contract_version` → tambah kolom baru, isi, dan kolom lama dihapus paling cepat 31 Desember (setelah jendela 30 hari berakhir).

**BR-VER-012 — Konsistensi lintas aturan (`DISEPAKATI`).** (a) Pembaruan butuh online; device terkunci karena lease 7 hari (BR-AUT-008) diperbarui saat sync berhasil dan **tidak** dianggap klien usang hanya karena lease. (b) **Layar terkunci** (BR-AUT-015) termasuk momen aman untuk tombol "Perbarui", tetapi **bukan** momen aman untuk pembaruan keras bila shift masih terbuka. (c) Perintah N−1 yang tertunda tidak rusak oleh pembaruan (BR-SYN-022).

*Contoh skenario lengkap (BR-VER-002/003/004/005):* 1 Desember v1.6.0 (kontrak 8) dirilis; server menerima kontrak 7 sampai 31 Desember. Tablet **TAB-01** (v1.5.0, kontrak 7) menampilkan banner sejak 1 Desember; 3 Desember 17:05 kasir Dewi menutup shift, tombol "Perbarui" aktif (shift tertutup, tanpa keranjang) → v1.6.0; 12 perintah `PENDING` dimigrasi ke kontrak 8 dan terkirim. Tablet **TAB-02** tidak pernah diperbarui. 31 Desember versi minimum dinaikkan ke 8; 2 Januari TAB-02 menampilkan banner wajib, 9 perintah kontrak 7 **ditahan**, shift baru diblokir; shift lama ditutup 22:00 → pada momen aman keras (shift tertutup, keranjang kosong, tanpa `SENDING`, 9 perintah termigrasi) pembaruan keras berjalan → 9 perintah terkirim; tidak ada data hilang.

### 5.13 Identifikasi Tenant lewat URL Sub-path (KEP-24)

> Keputusan user 2026-11-18 (`DISEPAKATI`). Mengubah asumsi lama "tanpa prefiks URL" dan aturan login BR-AUT-001; **bukan** pengganti isolasi multi-tenant lewat RLS (KEP-03, BR-TNT-001): slug hanya konteks, tenant tetap ditentukan dari sesi/token. Domain kustom per tenant **ditunda** (OQ-30 terjawab). Di bagian lain dokumen, `/admin` dan `/pos` berarti `/<slug>/admin` dan `/<slug>/pos`.

**BR-TEN-001 — Bentuk URL (`DISEPAKATI`).** Tiap tenant punya **slug**; halaman berada di **`<DOMAIN>/<slug>/pos`** dan **`<DOMAIN>/<slug>/admin`**. Halaman publik **penerima kode** berada di **`<DOMAIN>/<slug>/join`** (bergabung dengan kode undangan) dan **`<DOMAIN>/<slug>/reset`** (atur ulang kata sandi), tanpa sesi (BR-IDN-014). **Root `/` = 404** (kecuali rute teknis `/health` untuk health check, BR-ERR-012, yang tidak memuat data tenant). Admin platform di `/platform` (BR-TEN-008). Karena root 404, staf perlu mengetahui alamat lengkap (BR-TEN-007).
*Contoh:* tenant `acme` (Acme Coffee) → `<DOMAIN>/acme/pos` dan `<DOMAIN>/acme/admin`; tenant `beta` (Beta Mart) → `<DOMAIN>/beta/pos`; penerima kode undangan tenant `acme` membuka `<DOMAIN>/acme/join`, penerima kode reset membuka `<DOMAIN>/acme/reset`; `<DOMAIN>/` → 404.

**BR-TEN-002 — Tenant ditentukan dari identitas terverifikasi, bukan dari URL (`DISEPAKATI`; disesuaikan rev. 1.06).** Untuk **back-office**, slug URL hanya **menunjuk tenant yang diminta**; server mengizinkan akses **hanya bila akun sesi adalah anggota tenant itu** — keanggotaan **diperiksa pada setiap permintaan** (BR-IDN-002) dan konteks RLS diset dari keanggotaan terverifikasi tersebut, **bukan** dari slug. Untuk **device/POS**, tenant selalu dari **credential device**; slug yang tidak sama dengan tenant credential **ditolak**. Permintaan yang tidak lolos ditolak **tanpa data tenant mana pun** dan dicatat di log operasional (BR-LOG). RLS tetap berlaku (BR-TNT-001).

*Contoh:* akun `citra@example.id` yang hanya anggota `acme` login di `/acme/admin`, lalu membuka `/beta/admin` → **ditolak** (bukan anggota `beta`; pesan generik); tablet ber-credential `acme` menarik `/beta/pos`/sync → ditolak; tidak ada baris data `beta` yang dikirim.

**BR-TEN-003 — Login di-scope slug pada identitas global (`DISEPAKATI`; menggantikan model akun per tenant rev. 1.01/1.03; sesi per slug: OQ-37 terjawab).** Login `/admin` memakai **konteks tenant dari slug**, tetapi akunnya **global**: email unik se-sistem, satu password (BR-IDN-001). Alur: (1) email + password diautentikasi; (2) server memeriksa **keanggotaan** akun pada tenant slug itu; (3) **bukan anggota** → **pesan generik yang sama persis dengan kredensial salah** (anti-enumerasi; tidak membocorkan akun maupun tenant). **Sesi per slug**: cookie sesi dibatasi `Path=/<slug>`; logout hanya mengakhiri sesi tenant itu; dua tenant di satu browser membutuhkan **login terpisah** (BR-IDN-002). Halaman login **boleh menampilkan nama tenant**. Percobaan login gagal dibatasi **progresif per email lintas slug** (BR-RLM-003; NFR-SEC-005). Login PIN di `/pos` tetap berbasis credential device (BR-AUT-003), dan slug di URL harus sama dengan tenant credential itu (BR-TEN-002). **Tidak ada username** (hanya email).
*Contoh:* `ani@example.id` adalah **satu akun** dengan satu password, anggota `acme` (Kasir) dan `beta` (Owner). Login di `/beta/admin` → Owner `beta`; membuka `/acme/admin` di browser yang sama → **diminta login terpisah** (cookie `Path=/beta` tidak berlaku di `/acme`), dengan email dan password yang sama → Kasir `acme`; logout di `/beta/admin` tidak mengakhiri sesi `/acme/admin`. `citra@example.id` hanya anggota `acme`: login di `/beta/admin` dengan password benar → **pesan sama** dengan password salah. Email `xyz@example.id` yang tidak punya akun → pesan sama pula.

**BR-TEN-004 — Slug permanen dan formatnya (`DISEPAKATI`; penegakan slug: user 2026-11-18; daftar kata terlarang awal `DIUSULKAN`).** Slug **tidak dapat diubah**; mengganti slug berarti **membuat tenant baru**. *Alasan:* PWA terpasang terikat alamatnya, penyimpanan lokal di perangkat terikat alamat, dan enrollment device terikat tenant/alamat (BR-TEN-006/007). Format:
- 3–30 karakter, hanya huruf kecil `a–z`, angka `0–9`, dan tanda hubung; **tidak diawali/diakhiri** tanda hubung.
- **Unik tanpa membedakan huruf besar-kecil** (disimpan huruf kecil).
- **Kata terlarang** (tidak boleh jadi slug): `platform`, `admin`, `pos`, `api`, `health`, `assets`, `login`, `static`, `www`, dan serupa — daftar awal tambahan: `app`, `auth`, `docs`, `logout`, `public`, `register`, `root`, `signup`, `status`, `support`, `system`. **`join` dan `reset` bukan kata terlarang:** keduanya hanya muncul sebagai segmen kedua (`/<slug>/join`, `/<slug>/reset`), bukan di tingkat akar, sehingga tidak dapat bentrok dengan slug; **daftar kata terlarang tidak berubah** (DOQ-26). **Daftar kata terlarang berupa konstanta di kode** (bukan pengaturan yang dapat diubah admin platform; perubahan daftar = perubahan kode dan rilis) dan **diuji lewat uji rute** (tiap kata terlarang ditolak sebagai slug dan tidak dapat bentrok dengan rute aplikasi).
- **Penegakan permanen berlapis:** slug dijaga **dua lapis** — (1) aplikasi tidak menyediakan fungsi mengubah slug; (2) **trigger database** (lapis kedua) menolak perubahan slug yang sudah tersimpan, sehingga pengubahan langsung lewat SQL pun ditolak.
*Contoh valid:* `acme`, `toko-maju-7`, `beta`. *Ditolak:* `ab` (2 karakter), `-acme` / `acme-` (tanda hubung di tepi), `Acme_1` (garis bawah), `ACME` bila `acme` sudah ada (bentrok huruf besar-kecil), **`admin`**, `pos`, `platform` (kata terlarang), slug 31 karakter.

**BR-TEN-005 — Slug tak dikenal dan tenant ditangguhkan (`DISEPAKATI`).**
1. **Slug tak dikenal** → **404 generik** (bentuk sama dengan root; tidak mengungkap apa pun).
2. **Tenant ditangguhkan** (`SUSPENDED`) → halaman **"tidak tersedia"** tanpa data; sesi back-office aktif tidak lagi dilayani; sync/push ditolak dengan kode `TENANT_SUSPENDED` (kode error publik, BR-LOG-008).
3. **Perangkat offline** milik tenant ditangguhkan **berhenti sendiri saat lease 7 hari habis** (BR-AUT-008): selama lease belum habis dan device offline, ia tetap bekerja (pencabutan/penangguhan baru berlaku saat online, BR-AUT-010).
4. **Data tidak hilang:** transaksi yang sudah tersimpan di device tetap ada dan dapat diekspor (BR-SYN-052); perintah pending **ditahan** (bukan dibuang) dan terkirim setelah tenant diaktifkan kembali.
*Contoh:* `beta` ditangguhkan 1 Desember 09:00. Tablet TAB-09 offline sejak 08:30, sync sukses terakhir 30 Nov 20:00 → boleh bekerja sampai lease habis **7 Des 20:00**. Pukul 14:00 TAB-09 online: sync ditolak `TENANT_SUSPENDED`, halaman "tidak tersedia"; 12 transaksi pending tetap tersimpan/dapat diekspor. Tenant diaktifkan lagi 3 Des → 12 transaksi terkirim.

**BR-TEN-006 — Satu perangkat untuk banyak tenant; penyimpanan terpisah (`DISEPAKATI`).** Satu perangkat/browser boleh dipakai untuk **lebih dari satu tenant**. **Penyimpanan lokal dipisah total per tenant**: data tenant A **tidak pernah terlihat** di tenant B walau di perangkat yang sama; **sesi back-office per slug** (cookie `Path=/<slug>`; dua tenant di satu browser membutuhkan login terpisah, BR-IDN-002). Konsekuensi (`DIUSULKAN`): credential device, enrollment, register, counter invoice, antrean outbox, antrean log, retensi lokal, dan ekspor pending semuanya **per tenant**; perangkat yang sama menjadi **dua device logis** yang terdaftar terpisah. Membuka slug tenant yang belum di-enroll di perangkat itu menampilkan "perangkat belum terdaftar pada tenant ini" (enrollment butuh online, BR-AUT-002).
*Contoh:* tablet TAB-09 dipakai kios `acme` (pagi) dan `beta` (sore). `acme` punya 3 transaksi pending. Staf `beta` membuka `/beta/pos`: hanya katalog dan transaksi `beta` yang ada; 3 transaksi `acme` tidak terlihat dan tidak ikut ekspor `beta`; keluar dari `beta` tidak menghapus pending `acme`.

**BR-TEN-007 — PWA per tenant, nama tenant, dan QR pairing (`DISEPAKATI`; detail `DIUSULKAN`).** Aplikasi terpasang menampilkan **nama tenant** (ikon bersama untuk semua tenant); satu pemasangan per tenant, sehingga dua tenant di satu perangkat menjadi dua aplikasi terpasang terpisah. **Tidak ada fitur atau pengaturan warna tenant, validasi kontras warna tenant, maupun tema PWA per tenant selain nama di MVP** (keputusan user 2026-11-18). **Nama tampilan tenant** (maksimum **40 karakter**) **diatur operator platform saat membuat tenant** (BR-TEN-008); **perubahan hanya lewat operator platform** — **tidak ada layar pengaturan nama di `/admin` untuk Owner di MVP** (OQ-33 terjawab). Pembaruan aplikasi (BR-SYN-002/003, BR-VER) berlaku **per aplikasi terpasang**.
**QR pairing (`DISEPAKATI`):** karena root 404, **kode QR pairing** saat enrollment device memuat **alamat lengkap** `<DOMAIN>/<slug>/pos` **dan kode pairing pada fragmen URL (`#`)** — fragmen **tidak dikirim ke server saat URL dibuka**, sehingga kode tidak ikut ke log (BR-LOG-007). Kode bersifat **sekali pakai dan kedaluwarsa 15 menit** (BR-AUT-002). **Mengetik kode secara manual tetap tersedia sebagai cadangan** (mis. kamera tidak dapat memindai).
*Contoh:* QR memuat `<DOMAIN>/acme/pos#pair=K7Q2M9XD`; pemindaian membuka `acme` dan mengisi kode di sisi klien; app terpasang bernama "Acme Coffee". Kamera rusak → staf membuka `<DOMAIN>/acme/pos` dan mengetik `K7Q2M9XD` secara manual (sebelum 15 menit berlalu).

**BR-TEN-008 — Admin platform (`DISEPAKATI` fungsi; detail `DIUSULKAN`).** Rute **`/platform`** di domain yang sama (`platform` kata terlarang sebagai slug). **Akun admin platform terpisah** dari akun tenant (bukan anggota tenant mana pun). Fungsi MVP: **membuat tenant** (termasuk slug, **nama tampilan maks 40 karakter**, dan Owner pertama), **mengubah nama tampilan tenant**, **menangguhkan/mengaktifkan kembali** tenant, dan **mengatur versi kontrak minimum** (BR-VER-002, bersifat global). Admin platform **tidak** membaca data operasional tenant lewat `/platform` (hanya metadata tenant). Tenant **tidak** dibuat lewat pendaftaran mandiri. UI tidak diperinci di PRD.

**BR-TEN-009 — Normalisasi URL (`DISEPAKATI`: 308 ke huruf kecil kanonis; OQ-31 terjawab, mengikuti ARCHITECTURE OQ-A23).** URL berhuruf kapital dan variasi garis miring akhir **dialihkan dengan 308 ke bentuk huruf kecil kanonis** (satu bentuk garis miring akhir; tanpa garis miring ganda). *Contoh:* `/ACME/pos` → `/acme/pos`; `/acme/pos/` → `/acme/pos`.

**BR-TEN-012 — Halaman pemilih `/<slug>` (`DISEPAKATI`, OQ-31 terjawab).** `<DOMAIN>/<slug>` tanpa `/pos` atau `/admin` menampilkan **halaman pemilih sederhana**: pilihan **"Terminal Kasir"** (`/<slug>/pos`) atau **"Back-office"** (`/<slug>/admin`) dengan **nama tenant** — **tanpa membocorkan tenant lain** dan tanpa data lain. **Slug tak dikenal tetap 404 generik** (BR-TEN-005); tenant ditangguhkan menampilkan halaman "tidak tersedia".
*Contoh:* `<DOMAIN>/acme` → pemilih berjudul "Acme Coffee" dengan dua pilihan; `<DOMAIN>/xyz` → 404; `<DOMAIN>/` → 404.

**BR-TEN-010 — Domain kustom (`DISEPAKATI`: ditunda; OQ-30 terjawab).** Domain kustom per tenant **ditunda**: **tanpa pekerjaan di MVP**. **Resolver tenant sudah disiapkan** sehingga bila kelak ada tenant yang memintanya, domain kustom ditambahkan **secara aditif** (sertifikat TLS per domain via certbot saat itu). Di MVP seluruh tenant memakai satu `<DOMAIN>` dengan slug. Dampak kelak: alamat PWA terpasang, penyimpanan lokal (terikat alamat), enrollment device, dan slug permanen (BR-TEN-004).

**BR-TEN-011 — Konsistensi lintas aturan (`DISEPAKATI`).** (a) KEP-03/BR-TNT-001: tenant tetap dari sesi/token dan RLS; slug hanya konteks. (b) BR-VER: versi minimum global diatur admin platform; feature flag tetap per tenant (BR-VER-009). (c) Lease 7 hari (BR-AUT-008) tetap menjadi batas kerja offline, termasuk bagi tenant ditangguhkan. (d) Log: slug ikut tampil pada `path`; `tenantId` pada tiap baris tetap dari sesi/token (BR-LOG-004).

### 5.14 Manajemen Error (KEP-25)

> Keputusan user 2026-11-18 (`DISEPAKATI`), melengkapi Bab 5.11 (log) dengan pola referensi `financeDashboard` (`KODE#id`, error ke log dengan ID yang sama, laporan error browser dibatasi laju). **Daftar 22 kode error, ambang lonjakan, dan retensi source map sudah dijawab** (OQ-32). Dokumen katalog kode error sendiri **belum dibuat**; PRD hanya mengatur aturan dan prosesnya.

**BR-ERR-001 — Tiga tingkat error (`DISEPAKATI`).**

| Tingkat | Contoh | Perilaku ke pengguna | Log |
|---|---|---|---|
| **(a) Aturan bisnis/validasi** | PIN salah; diskon melebihi batas; kuantitas pecahan tidak sah | **Pesan jelas tanpa kode** (dan tanpa dialog teknis) | Tidak sebagai error (BR-LOG-009: kondisi bisnis bukan error log) |
| **(b) Gangguan sementara** | Jaringan putus; timeout transien; server sibuk (RETRY) | **Indikator status + percobaan ulang otomatis** (backoff BR-SYN-024), **tanpa dialog** | Ringkas (`outcome=RETRY`), bukan `error` |
| **(c) Kesalahan sistem tak terduga atau kondisi sistem/perangkat yang diketahui** | Crash tak terduga; printer gagal; PIN terkunci; perangkat dicabut | **Pesan + `KODE#id` + satu kalimat tindakan + tombol Salin** | `error`/`warn` dengan `publicCode` dan ID yang sama |

**Pesan login selalu generik** (anti-enumerasi): login `/admin` dan `/platform` tidak membedakan "email tidak terdaftar", "bukan anggota tenant", dan "password salah" (BR-TEN-003); percobaan gagal hanya meninggalkan hash pendek di log (BR-LOG-007).
*Contoh:* diskon Rp7.000 pada bill Rp130.500 (5,36%) bagi Kasir berbatas 5% → tingkat (a): "Diskon 5,36% melebihi batas Anda (5%). Minta persetujuan supervisor." — tanpa kode. Push timeout → tingkat (b): indikator "mengirim ulang" dan percobaan ulang pada 5 dtk → 15 dtk → 1 mnt, tanpa dialog. Galat tak terduga → tingkat (c): `INTERNAL_ERROR#20261118-103015-k7q2m` + kalimat tindakan + tombol Salin (menyalin teks `INTERNAL_ERROR#20261118-103015-k7q2m`).

**BR-ERR-002 — Katalog kode error (`DISEPAKATI`: 22 kode menurut ARCHITECTURE §9.7.1, OQ-32 terjawab).** Selain 6 kode umum ada kode **spesifik domain**; tiap kode punya **satu butir tindakan** untuk kasir (1–2 kalimat pendek, tabel di bawah menampilkan `id-ID` / `en-US`).

| Kode | Kelas | Tindakan kasir (`id-ID`) | Tindakan kasir (`en-US`) |
|---|---|---|---|
| `UNAUTHORIZED` | otorisasi | Sesi berakhir. Masuk kembali. | Your session has ended. Sign in again. |
| `FORBIDDEN` | otorisasi | Anda tidak punya izin untuk tindakan ini. Hubungi manager. | You do not have permission for this action. Contact your manager. |
| `VALIDATION_FAILED` | struktural | Data tidak valid. Periksa isian lalu coba lagi. | The data is invalid. Check your input and try again. |
| `DB_UNAVAILABLE` | transien | Layanan sedang sibuk. Coba lagi sebentar lagi. | The service is busy. Try again shortly. |
| `TIMEOUT` | transien | Permintaan terlalu lama. Periksa koneksi lalu coba lagi. | The request took too long. Check your connection and try again. |
| `INTERNAL_ERROR` | sistem | Terjadi kesalahan sistem. Salin kode ini dan hubungi pengembang. | A system error occurred. Copy this code and contact the developer. |
| `PRINT_FAILED` | transien | Struk belum tercetak. Periksa printer dan kertas, lalu ketuk Cetak ulang. | The receipt was not printed. Check the printer and paper, then tap Reprint. |
| `PIN_LOCKED` | otorisasi | PIN terkunci sementara. Tunggu {menit} menit atau minta manager mereset. | The PIN is temporarily locked. Wait {minutes} minutes or ask a manager to reset it. |
| `DEVICE_REVOKED` | otorisasi | Perangkat ini sudah dicabut. Ekspor transaksi tertunda, lalu hubungi manager. | This device has been revoked. Export pending transactions, then contact your manager. |
| `CREDENTIAL_EXPIRED` | otorisasi | Kredensial perangkat kedaluwarsa. Pasangkan ulang perangkat. | The device credential has expired. Pair the device again. |
| `LEASE_EXPIRED` | otorisasi | Perangkat terkunci karena 7 hari tanpa sinkron. Hubungkan ke internet. | The device is locked after 7 days without syncing. Connect to the internet. |
| `UPDATE_REQUIRED` | skema | Aplikasi perlu diperbarui. Selesaikan shift, lalu muat ulang saat diminta. | The app needs an update. Finish the shift, then reload when asked. |
| `SYNC_HELD` | skema | Sebagian transaksi ditahan menunggu pembaruan atau server. Tidak ada data yang hilang. (alasan di `reason_code`: `SCHEMA`, `SERVER_BEHIND`, `TENANT_SUSPENDED`) | Some transactions are on hold waiting for an update or the server. No data is lost. |
| `TENANT_SUSPENDED` | otorisasi | Layanan untuk tenant ini sedang tidak tersedia. Hubungi penyedia layanan. | Service for this tenant is currently unavailable. Contact the service provider. |
| `STORAGE_LOW` | transien | Penyimpanan perangkat hampir penuh. Sinkronkan dan bebaskan ruang; transaksi tertunda tidak dihapus. | Device storage is almost full. Sync and free up space; pending transactions are not deleted. |
| `STORAGE_FULL` | sistem | Penyimpanan penuh, transaksi tidak tersimpan. Ekspor transaksi tertunda lalu bebaskan ruang. | Storage is full and the transaction was not saved. Export pending transactions, then free up space. |
| `LOCAL_DB_FAILED` | sistem | Data lokal tidak dapat dibuka. Ekspor transaksi tertunda lalu hubungi pengembang. | Local data could not be opened. Export pending transactions, then contact the developer. |
| `APP_ERROR` | sistem | Layar ini mengalami masalah. Ketuk Coba lagi; draf Anda aman. | This screen had a problem. Tap Try again; your draft is safe. |
| `HANDOVER_NOT_PENDING` | bisnis | Bill sudah diterima atau dibatalkan. Muat ulang daftar bill. | The bill has already been accepted or canceled. Reload the bill list. |
| `EVENTS_PENDING` | bisnis | Masih ada perubahan bill yang belum terkirim. Tunggu sinkron selesai. | Some bill changes have not been sent yet. Wait for sync to finish. |
| `RATE_LIMITED` | otorisasi | Terlalu banyak percobaan. Tunggu beberapa menit. | Too many attempts. Wait a few minutes. |
| `FEATURE_DISABLED` | otorisasi | Fitur ini tidak aktif untuk tenant Anda. | This feature is not enabled for your tenant. |

Enam kode pertama = **kode umum** (BR-LOG-008). Daftar ini mengikuti `docs/ARCHITECTURE.md` §9.7.1 (kelas dan kalimat tindakan). **Kelas** mengikuti BR-SYN-030 (struktural/otorisasi/transien) ditambah `skema`, `sistem`, dan `bisnis`. Kode kelas **bisnis** (`HANDOVER_NOT_PENDING`, `EVENTS_PENDING`) adalah pengenal respons server; UI menampilkan **pesan aturan tanpa kode** (tingkat (a), BR-ERR-001), dan kode hanya tampil bila datang dari server secara tak terduga. Kode `reason_code` antrean "perlu perhatian" (mis. `SERIES_CONFLICT`) adalah kode **data**, bukan kode tampilan kasir. **`RATE_LIMITED`** adalah pengenal respons `429` dari pembatas laju; bagi pengguna ia hanya tampil pada **login dan enrollment** sebagai pesan perkiraan menit (tingkat (a), BR-RLM-003/009), sedangkan `429` pada sync adalah tingkat (b) tanpa dialog (BR-RLM-005). *Pemetaan kondisi:* crash render per area dan gagal start memakai `APP_ERROR` (atau `LOCAL_DB_FAILED` bila Dexie tak dapat dibuka); perangkat belum terdaftar dan jam perangkat tidak wajar ditampilkan sebagai pesan aturan/banner tanpa kode.

Kondisi bisnis biasa (mis. "shift belum dibuka") **bukan** kode: tingkat (a) tanpa kode.

**BR-ERR-003 — Kode stabil (`DISEPAKATI`).** Arti sebuah kode **tidak pernah diubah**; kode baru **hanya menambah**; kode yang dihentikan berstatus `DIHENTIKAN` dan **tetap dikenali** (tidak dihapus; tidak dipakai untuk kasus baru). Format kode: huruf besar, angka, dan garis bawah, maksimum 32 karakter. Klien lama yang menerima kode yang belum dikenal tetap menampilkan **`KODE#id`** dengan kalimat tindakan umum milik `INTERNAL_ERROR` (kompatibel dengan BR-VER).
*Contoh:* `SYNC_HELD` tidak boleh diberi arti baru; bila perlu membedakan penyebab, dipakai kolom `reason_code` (`SCHEMA`, `SERVER_BEHIND`, `TENANT_SUSPENDED`) tanpa mengubah arti kode; kasus yang benar-benar baru mendapat kode baru. Klien v1.5.0 menerima kode baru dari server v1.6.0 → menampilkan `KODE_BARU#id` dengan kalimat tindakan `INTERNAL_ERROR`.

**BR-ERR-004 — Kalimat tindakan dan bahasa (`DISEPAKATI`).** Tiap kode memiliki **tepat satu butir tindakan** (1–2 kalimat pendek, mengikuti ARCHITECTURE §9.7.1) untuk kasir pada **setiap bahasa UI MVP** (`id-ID`, `en-US`; BR-I18N-001), disimpan sebagai kunci terjemahan; kalimat berisi tindakan praktis (bukan istilah teknis). **Kode dan ID tidak diterjemahkan.** Kunci yang hilang memakai fallback `id-ID` (BR-I18N-003), dan CI gagal bila ada kode tanpa kalimat tindakan di salah satu bahasa (NFR-I18N-005).

**BR-ERR-005 — Pelaporan manual (`DISEPAKATI`).** Kasir/manager menyalin `KODE#id` (tombol **Salin**) dan mengirimnya **manual** (WhatsApp/telepon) ke admin/developer. **Tidak ada** tombol "Laporkan masalah" atau paket diagnostik otomatis di MVP. **Konsekuensi yang diterima:** (1) developer harus **menanyakan balik** konteks aktivitas kasir (apa yang dilakukan, jam, register); (2) error yang lahir di device hanya **dapat dilacak bila device sempat online** (log device terkirim bersama sync, BR-LOG-010).

**BR-ERR-006 — ID lokal untuk error yang lahir di device (`DISEPAKATI` untuk error offline; cakupan online `DIUSULKAN`).** Error yang terjadi **offline** memakai **ID lokal** berformat sama dengan awalan khusus perangkat: **`D-YYYYMMDD-HHmmss-xxxxx`** (waktu UTC **terkoreksi offset**, BR-TIM-005; 5 karakter acak dari alfabet tanpa huruf mirip, BR-LOG-005). ID lokal dipakai juga untuk error yang lahir di device saat online (mis. crash render); error yang merupakan **respons server** memakai ID server (BR-LOG-005). ID lokal disimpan di log device (BR-LOG-010), **dikirim bersama sync**, dan ditulis server dengan cakupan `device` dan field **`localId`** sehingga dapat dicari di skrip pencarian bersama log server (BR-LOG-013).
*Contoh:* 18 Nov 14:03:22 UTC printer gagal saat device offline → layar menampilkan `PRINT_FAILED#D-20261118-140322-m4k9q`; kasir mencatatnya. Saat online, entri terkirim; developer mencari `D-20261118-140322-m4k9q` dan menemukan baris dengan `deviceId`, `registerId`, `appVersion`, dan `publicCode=PRINT_FAILED`.

**BR-ERR-007 — Crash render fatal (`DISEPAKATI`).** Tampilan kasir memakai **error boundary per area**: satu panel yang crash **tidak mematikan seluruh layar**; area yang crash diganti pengganti kecil dengan `APP_ERROR#D-…` sementara area lain tetap berfungsi. **Draf keranjang dan bill tersimpan di Dexie**, sehingga setelah tombol **Muat ulang** kasir **melanjutkan di titik yang sama** (label tombol pada area yang crash mengikuti kalimat tindakan `APP_ERROR`, yaitu "Coba lagi"; layar pemulihan penuh memakai "Muat ulang"). Bila seluruh layar tidak dapat dipulihkan, **layar pemulihan** menampilkan **kode**, tombol **Muat ulang**, dan **ekspor transaksi pending** (BR-SYN-052). **Tidak ada muat ulang otomatis.** Transaksi yang sedang difinalisasi tetap atomik (BR-INV-004): tersimpan seluruhnya atau tidak sama sekali, tanpa nomor invoice hangus.
*Contoh:* keranjang 3 item (Rp112.476); panel diskon crash → panel itu diganti pengganti, kasir tetap dapat membayar. Panel bayar crash di tengah langkah konfirmasi → layar pemulihan `APP_ERROR#D-20261118-101502-p2x7e`; setelah Muat ulang keranjang 3 item utuh dan nomor invoice berikutnya masih `…-000131` (tidak ada yang hangus).

**BR-ERR-008 — Aplikasi gagal start (`DISEPAKATI`).** Layar putih, cache rusak, atau pembaruan gagal memicu **pemulihan bertingkat**: (1) **service worker kembali ke versi terakhir yang berfungsi** yang masih ada di cache dan **mencatat log** (log device, ID lokal); (2) bila tetap gagal, tampil layar **"Reset aplikasi"** yang membersihkan **cache aplikasi dan service worker** tetapi **tidak pernah menyentuh Dexie** (transaksi pending, credential device, counter invoice, dan antrean log tetap aman). Selaras **roll-forward only** dan update berbasis prompt (BR-SYN-002, BR-VER): fallback ke versi terakhir yang berfungsi adalah **pemulihan cache**, bukan rollback rilis. Kode: `APP_ERROR` (atau `LOCAL_DB_FAILED` bila Dexie tidak dapat dibuka). Halaman pemulihan bersifat minimal dan **tidak bergantung pada bundel aplikasi yang rusak** (`DIUSULKAN`). Karena reset menghapus app shell yang di-cache, **reset hanya boleh bila online** (aplikasi diunduh ulang); saat offline tombolnya nonaktif dengan alasan. **Halaman "Reset aplikasi" menyediakan ekspor transaksi tertunda** (`DISEPAKATI`, DOQ-23) sehingga pending dapat diamankan sebelum atau tanpa reset.
*Contoh:* setelah pembaruan v1.6.0, layar putih → service worker kembali ke v1.5.0 dari cache dan mencatat `APP_ERROR#D-20261118-081200-q7w3n`; bila v1.5.0 juga gagal, layar "Reset aplikasi" → cache dan SW dibersihkan, 12 transaksi pending tetap di Dexie, aplikasi diunduh ulang dan pending terkirim.

**BR-ERR-009 — Gagal cetak (`DISEPAKATI`).** Kegagalan cetak menampilkan **banner non-blocking** dengan tombol **"Cetak ulang"**; **penjualan tetap selesai** dan checkout berikutnya tidak terhalang (BR-PRN-002, AP-10). `PRINT_FAILED` tercatat di **log lokal** (BR-LOG-010) dan struk **dapat dicetak ulang dari riwayat** (FR-POS-009; ditandai "CETAK ULANG").
*Contoh:* invoice `OUT01-POS02-1126-000131` selesai; printer BLE putus → banner "Struk belum tercetak. Periksa printer dan kertas, lalu ketuk Cetak ulang" + kode `PRINT_FAILED#D-…`; kasir melayani pelanggan berikutnya, lalu menekan Cetak ulang dari banner atau riwayat.

**BR-ERR-010 — Retry aksi online-only (`DISEPAKATI`; angka `DIUSULKAN`).** Aksi **pembacaan** boleh dicoba ulang otomatis dengan batas (usulan 3 kali dengan backoff). Aksi yang **mengubah data** (simpan di `/admin`, enrollment device, serah-terima bill, posting GR) **tidak pernah diulang diam-diam**: ada tombol **"Coba lagi" manual**; klien mengirim **kunci idempoten** (UUIDv7 per aksi) sehingga pengulangan tidak menggandakan efek; dan **tombol dinonaktifkan selama aksi berjalan** (cegah klik ganda).
*Contoh:* Owner menyimpan harga Kopi Rp19.000 → `TIMEOUT#20261118-103015-k7q2m`. Server ternyata sudah memprosesnya; klik "Coba lagi" mengirim kunci idempoten yang sama dan menerima hasil lama — versi master naik **satu kali** (mis. 205 → 206), bukan dua.

**BR-ERR-011 — Source map privat (`DISEPAKATI`; retensi: OQ-32 terjawab).** Tiap rilis menyimpan **source map PRIVAT** di server: **tidak pernah dilayani publik**, disimpan **saat build** (tidak dapat dipulihkan belakangan), ukuran ±beberapa MB per rilis. Skrip pencarian log (BR-LOG-013) menerjemahkan **stack klien ke berkas dan baris asli** sesuai `appVersion` di entri log. Source map disimpan **selama versi aplikasi itu masih dilaporkan oleh perangkat dan 90 hari setelah tidak lagi dilaporkan** (dipangkas oleh skrip deploy); rilis yang tidak lagi dilaporkan dan sudah lewat 90 hari dipangkas.
*Contoh:* entri log `appVersion=1.6.0`, stack `app.3f2a1.js:1:48211` → skrip menampilkan `src/modules/penjualan/cart.tsx:128`; 20 rilis × ±5 MB ≈ 100 MB.

**BR-ERR-012 — Notifikasi (`DISEPAKATI`; ambang dan batas frekuensi terjawab, OQ-32).** Notifikasi dikirim lewat **Telegram** untuk: (a) **error fatal** (BR-LOG-012); (b) **health check gagal** — pemantau uptime **eksternal** memanggil `/health` (200 sehat, 503 bermasalah, tanpa data tenant); (c) **lonjakan error** (ambang: **≥ 10 `INTERNAL_ERROR` dalam 5 menit**). **Tanpa dashboard.** Isi pesan **tanpa data pelanggan**: hanya **kode, ID, jenis error, versi**, dan lingkungan; dengan **batas frekuensi**: **paling banyak 1 pesan Telegram per jenis per 10 menit** (sisanya digabung/diringkas; maksimum 20 pesan per jam, mengikuti ARCHITECTURE §9.7.10). Ini **bukan** monitoring sync lag dan **tidak** mengubah RSK-09.
*Contoh pesan:* `[prod] FATAL uncaughtException · INTERNAL_ERROR#20261118-103015-k7q2m · v1.6.0`; 12 `INTERNAL_ERROR` dalam 3 menit (≥ 10 dalam 5 menit) → 1 pesan "lonjakan error: 12 dalam 3 menit · v1.6.0", pesan lonjakan berikutnya paling cepat 10 menit kemudian; 9 `INTERNAL_ERROR` dalam 5 menit → tidak ada notifikasi.

**BR-ERR-013 — Tanpa diagnostik untuk tenant (`DISEPAKATI`).** Di MVP **tidak ada** layar diagnostik untuk tenant; investigasi hanya oleh developer lewat skrip pencarian (BR-LOG-013). **Antrean "perlu perhatian"** (SCR-A09, BR-SYN-030, FLOW-18) tetap menjadi alat manager untuk kegagalan struktural/otorisasi. Penahanan karena `SYNC_HELD` **tidak** masuk "perlu perhatian" (BR-VER-006).

**BR-ERR-014 — Katalog terdokumentasi dan proses (`DISEPAKATI`; dokumen katalog belum dibuat).** Setiap kode terdokumentasi di **katalog kode error** berisi: **kode, arti, penyebab umum, tindakan kasir (per bahasa), tindakan developer, status (`AKTIF`/`DIHENTIKAN`), dan sejak versi**. Proses: kode baru **wajib** punya entri katalog dan kalimat tindakan di semua bahasa **sebelum rilis** (gerbang CI, NFR-I18N-005; catatan rilis menyebut kode baru, BR-VER-010); kode tidak dihapus, hanya `DIHENTIKAN` (BR-ERR-003).

**BR-ERR-015 — Konsistensi lintas aturan (`DISEPAKATI`).** (a) BR-LOG-001..014: kode di log memakai field `publicCode`, ID lokal memakai `localId`; redaksi BR-LOG-007 berlaku pada seluruh entri. (b) BR-SYN-030: kondisi bisnis diterima bukan error; hanya struktural/otorisasi ke "perlu perhatian". (c) BR-VER: kode `UPDATE_REQUIRED`/`SYNC_HELD` mengikuti BR-VER-003/006 dan klien lama tetap menampilkan kode baru (BR-ERR-003). (d) BR-I18N: kalimat tindakan diterjemahkan, kode/ID tidak. (e) BR-PRN: gagal cetak tidak menggagalkan penjualan (BR-ERR-009). (f) BR-AUT-015: draf keranjang yang tersimpan lokal menjadi dasar pemulihan setelah crash/Muat ulang (BR-ERR-007), dan layar terkunci tetap terkunci setelah muat ulang.

### 5.15 Rate Limit dan Anti-Brute-Force (KEP-26)

> Keputusan user 2026-11-18/19 (`DISEPAKATI`); angka batas adalah **nilai awal konservatif** (`DIUSULKAN`), **dikonfigurasi lewat variabel lingkungan** dan **dikalibrasi dari log** setelah pemakaian nyata. Rujukan teknis (hanya baca): `docs/ARCHITECTURE.md` §6.9 (AD-40). Satu hal bertanda `PERLU KONFIRMASI`: mitigasi penundaan login pemilik akun (OQ-34). Tanpa kode di PRD.

**BR-RLM-001 — Dua lapisan dan IP klien (`DISEPAKATI`).** (1) **Nginx** (`limit_req`) membuang **banjir kasar** per IP/jalur sebelum menyentuh aplikasi; (2) **aplikasi** menegakkan aturan bermakna **per akun, device, slug, dan tenant** yang tak terlihat oleh Nginx. **IP klien dibaca hanya dari header yang dipasang Nginx (tepercaya)**; header klaim klien (mis. `X-Forwarded-For` dari luar) diabaikan, dan saat deploy diuji bahwa permintaan dari luar terbaca dengan IP-nya sendiri (bukan IP gateway/kontainer).

**BR-RLM-002 — Kunci pembatasan (`DISEPAKATI`).** IP **hanya dipakai di tempat yang belum ada pengguna teridentifikasi** (banjir/pemindaian pra-autentikasi); selebihnya kunci adalah identitas yang bermakna.

| Jenis | Kunci | Alasan |
|---|---|---|
| **API device terautentikasi** (`push`, `pull`, `ping`, sinyal, log device, serah-terima) | **`device_id`** — **bukan IP** | Satu outlet berbagi satu IP publik/NAT; batas per IP akan menghukum seluruh outlet |
| **Login admin** | **email** (akun global, **lintas slug**; utama, jeda progresif); jaring pengaman longgar **per IP + slug** | Satu password berlaku di semua tenant: kegagalan di satu tenant ikut menunda login email itu di tenant lain; IP untuk banjir/pemindaian saja |
| **Pairing (enrollment)** | **IP dan slug** | Penyerang terdistribusi tetap tertahan per slug |
| **Laporan berat di `/admin`** | **tenant** (bersamaan) | Satu tenant tidak menghabiskan kapasitas |
| **Endpoint publik** (slug tak dikenal, `/health`, `/platform`) | Hanya batas umum per IP di Nginx | Tanpa batas khusus (BR-RLM-008) |

**BR-RLM-003 — Login admin: jeda progresif tanpa penguncian permanen (`DISEPAKATI`; angka `DIUSULKAN`).** Kunci utama = **email** (akun global) **lintas slug** (keputusan user 2026-11-19): **percobaan gagal di satu tenant ikut menunda login email itu di tenant lain**. Kegagalan 1–3: tanpa jeda; ke-4: 30 detik; ke-5: 1 menit; ke-6: 2 menit; ke-7: 5 menit; ke-8 dan seterusnya: **15 menit (maksimum)**; hitungan direset setelah login sukses atau 15 menit tanpa kegagalan. **Tanpa penguncian akun permanen.** Pesan: **"Coba lagi dalam sekitar N menit"** (kunci terjemahan dengan `{menit}`), **sama persis** untuk akun yang ada, bukan anggota, maupun tidak terdaftar (anti-enumerasi; BR-ERR-001). Jaring pengaman per **IP + slug** sengaja **longgar** (usulan ±30 kegagalan/15 menit → jeda 15 menit) agar tidak menghukum pengguna sah di satu IP.
*Contoh:* `dewi@example.id` gagal 3× di `acme` → tanpa jeda; ke-4 → "Coba lagi dalam sekitar 1 menit" (30 dtk); ke-5 → 1 menit; ke-6 → 2; ke-7 → 5; ke-8 → 15. Karena kunci lintas slug, login `dewi@example.id` di `beta` **juga** tertunda selama jeda itu. Email `xyz@example.id` yang tidak terdaftar, atau akun yang **bukan anggota** `acme`, menampilkan **pesan yang sama**.
*Celah yang diterima:* penyerang yang terus gagal pada email korban dapat **menunda login pemilik akun hingga 15 menit di semua tenant**. **Keputusan user (OQ-34 terjawab): tanpa mitigasi, hanya dicatat di log.**

**BR-RLM-004 — API device per `device_id` (`DISEPAKATI` kunci; angka `DIUSULKAN`).** Batas awal per device: `push` ±60 permintaan/menit; `pull` ±30; `ping` ±30; serah-terima ±30; log device ≤ 20 laporan/10 menit (kelebihan **dibuang** tanpa baris, BR-LOG-010). Kelebihan dijawab `429` + `Retry-After` berjitter (kecuali log device). *Contoh:* 5 tablet satu outlet memakai **satu IP publik**; masing-masing memiliki jatah 60 `push`/menit sendiri, sehingga satu tablet yang ramai tidak menghambat empat lainnya.

**BR-RLM-005 — Banjir sync (`DISEPAKATI`).** Server membatasi **pemrosesan push bersamaan** (usulan ±8; satu permintaan aktif per device); kelebihan dijawab **`429` + `Retry-After` berjitter** (usulan ±2–10 detik). Klien **patuh**: menunggu `max(Retry-After, backoff BR-SYN-024)`, **tidak menaikkan hitungan percobaan**, **tidak** menjadikan perintah "perlu perhatian" (BR-SYN-030), dan **tidak** menganggapnya putus koneksi; ini **tingkat (b) tanpa dialog** (BR-ERR-001).
*Contoh:* 12 tablet melakukan push serentak pukul 08:00 → 8 diproses, 4 menerima `429` + `Retry-After` 2–10 dtk; keempatnya mengulang dan sukses dalam ±10 detik; `attempts` tetap 0; tidak ada banner atau dialog.

**BR-RLM-006 — Full resync dan SSE (`DISEPAKATI`).** **Full resync maksimal 1 per jam per device**: yang kedua dalam sejam dijawab `429` + `Retry-After` dan klien **tetap memakai katalog lama** (waktu full resync terakhir dicatat di penyimpanan meta lokal/Dexie untuk menegakkan batas ini di sisi klien) (device baru tanpa katalog tidak terkena karena permulaan pertamanya dihitung sekali; resync yang gagal di tengah **dilanjutkan**, bukan dihitung ulang). **Sinyal realtime (SSE): satu koneksi aktif per device**; koneksi baru menggantikan yang lama.
*Contoh:* TAB-03 cursor tua → full resync pukul 10:00 diterima; pukul 10:40 cursor dianggap tua lagi → `429` + `Retry-After` ±20 menit, katalog lama tetap dipakai; pukul 11:05 diizinkan.

**BR-RLM-007 — Laporan berat di `/admin` (`DISEPAKATI`; angka `DIUSULKAN`).** Dibatasi **bersamaan kecil per tenant** (usulan 2) ditambah **batas waktu kueri**; berlebih diminta menunggu ("Laporan lain sedang diproses, coba lagi sebentar" — pesan aturan tingkat (a)).
*Contoh:* tiga manager `acme` membuka laporan penjualan periodik bersamaan → 2 berjalan, 1 diminta menunggu; tenant `beta` tidak terpengaruh.

**BR-RLM-008 — Endpoint publik dan `/platform` (`DISEPAKATI`).** Slug tak dikenal, `/health`, dan `/platform` **tanpa batas khusus**, hanya **batas umum per IP** di Nginx. `/platform`: **akun platform terpisah** (BR-TEN-008) + batas umum, **tanpa pembatasan IP khusus** — membatalkan butir sebelumnya; **risiko yang diterima** (RSK-17).

**BR-RLM-009 — Pairing dibatasi per IP dan per slug (`DISEPAKATI`; angka `DIUSULKAN`).** `POST` enrollment: usulan **10 percobaan/5 menit per IP** **dan** **±30 percobaan/5 menit per slug**. Kode pairing 8 karakter dari alfabet 32 (32⁸ ≈ 1,1×10¹²), kedaluwarsa 15 menit, sekali pakai (BR-AUT-002). Pesan saat tertahan: perkiraan menit (BR-RLM-003).
*Contoh:* penyerang memakai 1.000 IP berbeda: per IP hanya 1 percobaan, tetapi per slug tetap ≤ 30/5 menit → dalam masa berlaku 15 menit paling banyak ±90 tebakan; peluang menebak satu kode yang sedang berlaku ≈ 90 / 1,1×10¹² ≈ 8×10⁻¹¹.

**BR-RLM-010 — PIN di device (`DISEPAKATI`; detail BR-AUT-005).** Hitungan percobaan **monotonik** (hanya naik sampai reset; dicatat **sebelum** verifikasi); jeda dihitung dari **waktu tertinggi yang pernah dilihat aplikasi** (tanpa kolom penyimpanan baru) sehingga tidak dapat dimundurkan lewat tanggal tablet (BR-AUT-013); **reset total** oleh supervisor/manager; status **dilaporkan ke server saat online, yaitu ketika tingkat kunci berubah** (5 → 15 → reset). **Penegasan jujur:** ini bukan perlindungan terhadap penyerang mahir yang memegang perangkat (data lokal dapat diubah lewat perangkat pengembang); serangan itu dilawan **hash lambat + HMAC per device** (BR-AUT-004/014).
*Contoh:* 5 PIN salah → jeda 5 menit; tanggal tablet dimundurkan 1 hari → jeda **tidak berkurang**; 15 salah total → terkunci sampai supervisor mereset; hasilnya dilaporkan ke server saat tablet online.

**BR-RLM-011 — Tanpa kuota per tenant (`DISEPAKATI`).** Di MVP **tidak ada kuota per tenant**; pembatasan hanya per device/akun/slug. Risiko **"tetangga berisik"** (satu tenant menghabiskan kapasitas bersama) **diterima** (RSK-17).

**BR-RLM-012 — Penghitung di memori (`DISEPAKATI`).** Penghitung batas disimpan di **memori proses** dan **hilang saat restart** — **diterima di MVP**: Nginx menahan banjir kasar, dan kode pairing (32⁸, 15 menit, sekali pakai) tahan terhadap reset penghitung.

**BR-RLM-013 — Pencatatan dan konfigurasi (`DISEPAKATI`).** Pelanggaran batas **hanya dicatat log** (`warn`; kunci ditulis sebagai **hash pendek**, bukan nilai asli, BR-LOG-007; field `ip`, `outcome`, `errorClass`, `limitKeyHash`, BR-LOG-006). **Telegram tetap hanya untuk lonjakan error** (BR-ERR-012), bukan untuk pelanggaran batas. Angka batas dikonfigurasi lewat **variabel lingkungan** dan **dikalibrasi dari log**. Pustaka pembatas: kandidat **`rate-limiter-flexible`** (**dipilih**; final setelah verifikasi teknis awal F1).

**BR-RLM-014 — Konsistensi lintas aturan (`DISEPAKATI`).** (a) BR-ERR: login/enrollment menampilkan pesan menit (tingkat (a)) dengan pengenal `RATE_LIMITED`; `429` sync = tingkat (b); pesan login selalu generik. (b) BR-SYN-024/030: `429` = RETRY tanpa menaikkan percobaan, bukan "perlu perhatian". (c) BR-LOG: pelanggaran `warn` dengan kunci ber-hash. (d) BR-TEN: konteks tenant dari slug; kunci login memuat slug; `/platform` terpisah (BR-TEN-008). (e) BR-AUT: PIN di device mengikuti BR-AUT-005/013/014.

### 5.16 Identitas Global dan Keanggotaan Tenant (KEP-27)

> Keputusan user 2026-11-19 (`DISEPAKATI`; OQ-35/36/37 dan detail identitas terjawab) — **perubahan besar model identitas back-office**, menggantikan "akun terpisah per tenant, password dan sesi terpisah" (rev. 1.01/1.03): **akun tetap global**, tetapi **sesi per slug** (login terpisah per tenant). Tanpa kode di PRD.

**BR-IDN-001 — Identitas global + keanggotaan per tenant (`DISEPAKATI`).** Plugin *organization* Better Auth: **satu email = satu akun global** (email **unik se-sistem**), **satu password**; **keanggotaan per tenant dengan peran** (dan penugasan outlet). Login back-office **hanya dengan email + password** (tanpa username). **Staf tanpa email memakai PIN di POS** dan **tidak memiliki akun back-office** (**anggota PIN-only**: keanggotaan tanpa tautan akun, BR-AUT-003). Anggota yang memiliki akun dapat login `/admin` sesuai perannya dan tetap dapat memakai PIN di POS. **Email tidak disalin ke data anggota tenant**: ia dibaca lewat identitas global dan **hanya tampil bagi anggota tenant itu** (BR-IDN-012).

**BR-IDN-002 — Login di-scope slug, keanggotaan diperiksa, sesi per slug (`DISEPAKATI`, OQ-37 terjawab).** (1) Autentikasi email + password; (2) server memeriksa **keanggotaan akun pada tenant slug** halaman itu; (3) **bukan anggota** → **pesan generik yang sama persis dengan kredensial salah** (anti-enumerasi; tidak membocorkan keberadaan akun maupun tenant). Keanggotaan **diperiksa pada setiap permintaan** `/<slug>/admin` (bukan hanya saat login) dan konteks RLS diset dari keanggotaan terverifikasi. **Cookie sesi per slug** (`Path=/<slug>`): **login terpisah per tenant**; **logout hanya mengakhiri sesi tenant itu**; dua tenant di satu browser membutuhkan dua login (email dan password sama). Ganti atau reset password **memaksa keluar semua sesi akun** (seluruh slug), karena akunnya global.
*Contoh:* `ani@example.id` (Kasir `acme`, Owner `beta`) login di `/beta/admin` → Owner `beta`; membuka `/acme/admin` → diminta login (cookie `Path=/beta` tidak terkirim ke `/acme`) → Kasir `acme`. Logout di `/beta/admin` → `/acme/admin` tetap login. `citra@example.id` (hanya `acme`) di `/beta/admin` → pesan sama dengan password salah.

**BR-IDN-003 — Tanpa email di MVP (`DISEPAKATI`).** Tidak ada pengiriman email (tanpa SMTP/penyedia email), tidak ada verifikasi email, dan tidak ada "Lupa kata sandi" mandiri. **Undangan anggota dan reset password dilakukan manual lewat kode sekali pakai** (BR-IDN-004/005): oleh **Owner** (untuk pengguna tenantnya) atau **operator platform** (untuk Owner). Email berfungsi sebagai **pengenal login**, bukan saluran komunikasi; ia tidak diverifikasi (tanggung jawab pengundang). Pengiriman email adalah fase lanjut.

**BR-IDN-004 — Undangan: kode sekali pakai terikat email (`DISEPAKATI`, OQ-36 opsi A; detail kode OQ-S39).**
1. Owner (atau operator platform untuk Owner pertama, FLOW-23) membuat undangan: **email + peran (+ outlet)**; sistem membuat **kode undangan sekali pakai, terikat email, kedaluwarsa 72 jam**. **Format kode: 10 karakter alfabet 32 (tanpa karakter yang mudah tertukar) = 32¹⁰ ≈ 1,1×10¹⁵ kemungkinan, ditampilkan dalam dua kelompok (`K7Q2M-9XD4R`)**; penukaran tidak peka huruf besar/kecil dan mengabaikan tanda hubung/spasi; disimpan sebagai hash. **Kode dan respons ke pengundang identik** apakah email sudah punya akun atau belum (**tidak membocorkan keberadaan akun**). Pengundang membagikan kode secara manual (WhatsApp/lisan).
2. **Penerbit tidak pernah melihat atau menetapkan password.** **Penukaran satu langkah:** penerima membuka halaman **`/<slug>/join`** (BR-IDN-014) dan mengisi **satu formulir: email + kode + password** — **akun belum ada** → password itu menjadi **password baru pilihannya sendiri**; **akun sudah ada** → password itu adalah **password akun saat ini** (membuktikan kepemilikan). Formulir, label, dan pesan **sama untuk kedua kasus** (petunjuk netral: "Jika sudah punya akun, isi password akun Anda; jika belum, buat password baru") sehingga **tidak membuka bahwa akun sudah ada**. **Keanggotaan dibuat saat penerimaan**, bukan saat undangan dibuat.
3. **Tidak ada password sementara dan tidak ada penanda "wajib ganti password".**
4. Kode salah/kedaluwarsa/terpakai, kombinasi email-kode tidak cocok, atau password akun lama salah → **pesan generik yang sama**; percobaan dibatasi seperti pairing (per IP dan per slug, BR-RLM-009); password akun lama yang salah juga dihitung ke batas login per email (BR-RLM-003).
5. Undangan yang belum diterima dapat dibatalkan Owner; keanggotaan tidak ada sebelum diterima.
6. **Retensi baris:** baris undangan **dibersihkan 7 hari setelah kedaluwarsa atau terpakai** (hash kode dan email tidak disimpan di tabel undangan lebih lama; jejak tetap ada di audit log, BR-AUD-001).
7. **Undangan aktif dihitung sebagai keanggotaan untuk aturan reset** (BR-IDN-005): akun yang punya undangan aktif ke tenant lain dianggap **multi-tenant sejak undangan diterbitkan**, bukan sejak diterima.
*Contoh:* Budi (Owner `acme`) mengundang `ani@example.id` sebagai Kasir → kode `K7Q2M-9XD4R`, kedaluwarsa 72 jam; respons sama untuk email yang sudah/belum punya akun. Ani (sudah punya akun karena Owner `beta`) mengisi email + kode + **password akunnya saat ini** → menjadi Kasir `acme`; satu akun, dua keanggotaan; Budi tidak pernah melihat atau menetapkan password Ani. Kode yang sama dengan Ani yang belum punya akun → formulir identik, password yang diisi menjadi password barunya. Peluang menebak kode selama 72 jam dengan batas 30 percobaan/5 menit/slug: 864 jendela × 30 = 25.920 tebakan ÷ 32¹⁰ ≈ **2,3×10⁻¹¹** (kode reset 24 jam: 8.640 ÷ 32¹⁰ ≈ 7,7×10⁻¹²).

**BR-IDN-005 — Reset password manual dan perlindungan lintas tenant (`DISEPAKATI`, OQ-35 opsi A + OQ-36).** *Risiko:* karena identitas dipakai lintas tenant, **Owner tenant A yang mereset password akun Ani — yang juga Owner tenant B — dapat mengambil alih tenant B.** Aturan:
1. Owner **hanya boleh menerbitkan kode reset** untuk akun yang keanggotaannya **HANYA di tenantnya**.
2. Akun dengan **keanggotaan di lebih dari satu tenant** hanya dapat direset oleh **operator platform** atau **pemiliknya sendiri** (mengganti password dari pengaturan akun saat sudah login). **Hitungan keanggotaan menyertakan undangan aktif lintas tenant**: akun yang punya **undangan aktif ke tenant lain** dianggap multi-tenant **sejak undangan terbit** (BR-IDN-004 butir 7), sehingga Owner tidak dapat mereset akun yang sedang diundang tenant lain. **Reset akun multi-tenant oleh operator memakai konteks salah satu tenant tempat akun itu menjadi anggota** (anggota sungguhan, bukan sekadar diundang); tindakan tercatat di audit tenant tersebut dan di log operator.
3. **Kode reset** sekali pakai, **terikat email**, **kedaluwarsa 24 jam**; penerima membuka halaman **`/<slug>/reset`** (BR-IDN-014) dan memasukkan **email + kode (10 karakter berkelompok, format sama dengan BR-IDN-004) + password baru pilihannya sendiri** dalam **satu langkah**. **Penerbit tidak pernah melihat atau menetapkan password**; **tidak ada password sementara** dan **tidak ada penanda wajib ganti**. Operator mereset Owner setelah verifikasi identitas di luar sistem.
4. Setiap penerbitan/pemakaian kode reset dan ganti password **diaudit** (aktor, akun, tenant) dan **memaksa keluar semua sesi** akun.
5. Penolakan kepada Owner memakai **pesan generik "hubungi operator platform"** yang **tidak mengakui** bahwa akun itu multi-tenant; pesan yang sama dipakai untuk email yang bukan anggota tenantnya.
*Contoh:* `ani@example.id` adalah Owner `beta` dan Kasir `acme`. Budi (Owner `acme`) mencoba menerbitkan kode reset untuk Ani → **ditolak** dengan pesan "hubungi operator platform". Tanpa aturan ini Budi akan menerima kode reset terikat email Ani, memakainya sendiri dengan password pilihannya, lalu membuka `/beta/admin` sebagai Owner `beta` (pengambilalihan). `citra@example.id` yang hanya anggota `acme` → Budi **boleh** menerbitkan kode reset (24 jam); Citra memasukkan email + kode + password baru sendiri. **Undangan aktif:** `rina@example.id` hanya anggota `acme`, lalu `beta` menerbitkan undangan untuknya → sejak itu Rina dianggap multi-tenant dan Budi **tidak lagi** dapat menerbitkan kode reset untuknya (pesan "hubungi operator platform"); bila operator mereset, ia memakai konteks `acme` (tempat Rina anggota), bukan `beta` (baru diundang).

**BR-IDN-006 — Mengeluarkan anggota (`DISEPAKATI`; detail `DIUSULKAN`).** Mengeluarkan anggota = **mengubah keanggotaan menjadi `KELUAR`** (bukan menghapus akun); **akun tetap** untuk tenant lain. **Baris keanggotaan tetap menyimpan penunjuk identitas** untuk jejak audit dan riwayat transaksi (`DISEPAKATI`); email anggota yang keluar **tidak lagi ditampilkan** ke Owner (BR-IDN-012). Sesi akun itu untuk tenant tersebut berakhir pada permintaan berikutnya (keanggotaan diperiksa tiap permintaan); akses PIN di device dicabut saat device online (BR-AUT-010). Setiap tenant **harus selalu memiliki minimal satu Owner**. Anggota PIN-only dinonaktifkan, bukan dihapus.

**BR-IDN-007 — Peran dan keanggotaan (`DISEPAKATI` prinsip; daftar peran `DIUSULKAN`).** **Peran Better Auth hanya cerminan kasar** (owner/member); **izin sebenarnya berasal dari tabel peran/izin milik kita** (BR-AUT-009/012). Peran melekat pada keanggotaan (Owner, Manager, Supervisor, Kasir, Waiter, Staf Gudang, Akuntan); keanggotaan unik per (akun, tenant). Perubahan peran, undangan, dan pengeluaran anggota dilakukan Owner dan teraudit (BR-AUD-001). Operator platform **bukan** anggota tenant mana pun (BR-TEN-008).

**BR-IDN-008 — 2FA dan risiko identitas lintas tenant (`DISEPAKATI`).** **2FA untuk Owner tidak ada di MVP**; dicatat sebagai risiko (satu identitas membuka beberapa tenant, RSK-18) dan fase lanjut. Kebijakan password minimum ditetapkan saat implementasi (usulan ≥ 10 karakter, `DIUSULKAN`).

**BR-IDN-009 — Dampak pada rate limit (`DISEPAKATI`).** Kunci login adalah **email lintas slug** (BR-RLM-003): **percobaan gagal di satu tenant ikut menunda login email itu di tenant lain**, karena satu password berlaku di semua tenant. Penundaan login pemilik akun oleh penyerang (maks 15 menit) karenanya berlaku **lintas tenant** — **diterima tanpa mitigasi, hanya log** (OQ-34 terjawab).

**BR-IDN-010 — Konsistensi lintas aturan (`DISEPAKATI`).** (a) BR-AUT-001/003: login back-office hanya email; staf non-email hanya PIN; PIN di device tetap per device (BR-AUT-004). (b) BR-TEN: slug memilih konteks, tenant diverifikasi lewat keanggotaan (BR-TEN-002/003); slug tak dikenal tetap 404; cookie sesi per slug (BR-TEN-006). (c) BR-RLM/BR-ERR: pesan login generik untuk akun ada, bukan anggota, dan tidak ada; field log `usernameHash`/`usernameLength` kini berarti hash dan panjang **email** yang diketik (BR-LOG-007). (d) BR-VER: tidak berubah. (e) Lease 7 hari dan pencabutan akses (BR-AUT-008/010) berlaku untuk keanggotaan/device.

**BR-IDN-011 — Ganti email (`DISEPAKATI`).** Email hanya dapat diganti oleh **pemilik akun** (dengan password) atau **operator platform** — **bukan oleh Owner tenant**. Email baru harus unik se-sistem dan tidak diverifikasi (BR-IDN-003); penggantian diaudit dan memaksa keluar sesi lain akun itu.
*Contoh:* Budi (Owner `acme`) tidak dapat mengubah email `citra@example.id`; Citra mengubahnya sendiri di pengaturan akun dengan password; operator dapat mengubahnya bila Citra kehilangan akses.

**BR-IDN-012 — Privasi email antar tenant (`DISEPAKATI`).** Email **tidak disalin** ke data anggota tenant: ia dibaca lewat identitas global dan **dibatasi hanya untuk anggota tenant itu** (Owner melihat email anggota tenantnya saja; tenant lain, dan anggota yang telah keluar, tidak). Respons undangan/reset/login tidak pernah menunjukkan apakah sebuah email punya akun atau keanggotaan di tenant lain.

**BR-IDN-013 — Risiko pra-klaim email: DITERIMA di MVP dengan mitigasi (`DISEPAKATI`, OQ-S39).** *Risiko:* karena email **tidak diverifikasi** (BR-IDN-003) dan penerima memasukkan sendiri email + kode + password, **penerbit yang memegang kode sekaligus mengetahui email dapat menukarnya sendiri dan menetapkan password atas email orang lain** (pra-klaim) selama akun email itu belum ada. *Keputusan:* risiko **diterima di MVP**; verifikasi email menyusul di fase lanjut. *Mitigasi:*
1. **Hanya berlaku bagi akun yang belum ada dan hanya ada di tenant penerbit.** Email yang sudah punya akun tidak dapat dipra-klaim: penukaran kode akun lama menuntut **password akun saat ini** (BR-IDN-004 butir 2).
2. **Bergabung ke tenant lain butuh kode tenant itu DAN password akun.** Akun hasil pra-klaim tidak memberi akses ke tenant lain: undangan tenant lain terikat email asli dan menuntut password akun, yang tidak diketahui pemilik email sebenarnya (dan kode tenant lain tidak diketahui penerbit pra-klaim).
3. **Tercatat di audit** (penerbit, email, tenant, waktu penerbitan dan penukaran; BR-AUD-001).
4. **Operator platform dapat mereset akun itu** setelah verifikasi identitas di luar sistem (BR-IDN-005; konteks salah satu tenant tempat akun menjadi anggota).
5. Dampak terbatas pada tenant penerbit sendiri: penerbit sudah berwenang atas tenantnya (Owner dapat menetapkan peran apa pun).
*Contoh:* Budi (Owner `acme`) mengundang `rina@example.id` (belum punya akun) sebagai Kasir, lalu **menukar sendiri** kode `K7Q2M-9XD4R` dengan password pilihannya → akun `rina@` ada dan hanya anggota `acme` (pra-klaim). Rina sungguhan kemudian diundang `beta`: kode `beta` + password akun yang tidak ia ketahui → penukaran **gagal dengan pesan generik**; ia melapor ke operator → operator mereset akun lewat konteks `acme`, Rina menetapkan password sendiri dengan kode reset, lalu menukar undangan `beta`. Budi tidak pernah mendapat akses ke `beta` (tidak punya kode `beta`; dan sejak undangan `beta` terbit akun dianggap multi-tenant sehingga Budi tidak dapat mereset). Audit `acme` mencatat penerbitan dan penukaran oleh Budi.

**BR-IDN-014 — Dua halaman publik untuk penerima kode (`DISEPAKATI`, DOQ-26).**
1. Penerima kode memakai **dua halaman terpisah**: **`<DOMAIN>/<slug>/join`** untuk **bergabung** (kode undangan; BR-IDN-004) dan **`<DOMAIN>/<slug>/reset`** untuk **mengatur ulang kata sandi** (kode reset; BR-IDN-005). Keduanya formulir satu langkah (email + kode + password); `/join` bertuliskan petunjuk netral ("Jika sudah punya akun, isi password akun Anda; jika belum, buat password baru"), `/reset` meminta **password baru**. Pemisahan membuat maksud penerima jelas dan teks tidak bercampur.
2. Halaman **publik tanpa sesi**; tenant ditentukan dari slug di URL. **Slug tak dikenal → 404 generik; tenant ditangguhkan mengikuti BR-TEN-005.** Halaman boleh menampilkan **nama tenant** (seperti halaman login, BR-TEN-003).
3. **Kode hanya sah di halaman yang sesuai dan di tenant penerbitnya** (`DIUSULKAN`): kode undangan di `/reset`, kode reset di `/join`, atau kode tenant lain di slug ini → **pesan generik yang sama** dengan kode salah (anti-enumerasi, BR-ERR-001). Kode reset yang diterbitkan operator terikat ke konteks tenant yang dipakainya (BR-IDN-005).
4. **Setelah berhasil:** `/join` membuat keanggotaan dan **sesi untuk slug itu** (cookie `Path=/<slug>`, BR-IDN-002), lalu mengarahkan ke `/<slug>/admin`; `/reset` mengganti password, **memaksa keluar semua sesi akun** dan **tidak login otomatis** — penerima diarahkan ke halaman login (`DIUSULKAN`).
5. Batas laju sama pada kedua halaman: per IP dan per slug (BR-RLM-009); password akun lama yang salah di `/join` dihitung ke batas login per email (BR-RLM-003).
6. Owner membagikan **alamat lengkap + kode** (UI admin menyediakan tombol salin untuk keduanya); **kode tidak ditaruh di path atau query** URL (menghindari log akses); tautan siap pakai, bila ada, membawa kode pada fragmen `#` seperti QR pairing (BR-TEN-007).
*Contoh:* Budi mengirim ke Ani lewat WhatsApp: "Buka `<DOMAIN>/acme/join`, kode `K7Q2M-9XD4R`". Ani mengisi email, kode, dan passwordnya → masuk ke `/acme/admin` sebagai Kasir. Citra lupa password: Budi menerbitkan kode reset `H3N9V-6TQ2B` dan mengirim "`<DOMAIN>/acme/reset`"; Citra memasukkan email, kode, dan password baru → semua sesinya berakhir dan ia login ulang. Kode `K7Q2M-9XD4R` yang diketik Citra di `/acme/reset` → pesan generik.

**BR-IDN-015 — Daftar "Undangan tertunda": Batalkan dan Terbitkan ulang (`DISEPAKATI`, DOQ-26; detail `DIUSULKAN`).**
1. Di `/<slug>/admin`, tab **Pengguna** memuat daftar **"Undangan tertunda"**: email, peran (+ outlet), diterbitkan oleh/pada, kedaluwarsa, dan status (**Aktif** / **Kedaluwarsa**). Isinya undangan yang **belum diterima**: yang aktif dan yang kedaluwarsa tetapi belum dibersihkan (≤ 7 hari, BR-IDN-004 butir 6); undangan yang sudah diterima atau dibatalkan tidak tampil. **Kode tidak pernah ditampilkan ulang** (hanya hash tersimpan); kode muncul **sekali** saat diterbitkan atau diterbitkan ulang.
2. Aksi **Batalkan**: undangan dihapus dari daftar dan **kodenya langsung tidak berlaku**; keanggotaan tetap tidak ada. Undangan yang dibatalkan **tidak lagi dihitung sebagai keanggotaan** untuk aturan reset (BR-IDN-004 butir 7).
3. Aksi **Terbitkan ulang**: membuat **kode baru** (10 karakter berkelompok) dengan **kedaluwarsa 72 jam dihitung dari saat diterbitkan ulang**; email, peran, dan outlet **sama**; **kode lama otomatis tidak berlaku** begitu kode baru terbit. Tersedia untuk undangan aktif maupun kedaluwarsa. **Email tidak dapat diubah** (kode terikat email): undangan **salah alamat** → **Batalkan** lalu buat undangan baru dengan email yang benar.
4. **Owner hanya mengelola undangan tenantnya**: undangan tenant lain tidak terlihat dan tidak dapat diakses (isolasi tenant, RLS), termasuk untuk email yang sama; daftar tidak membuka apakah email punya akun atau keanggotaan di tenant lain. Undangan **Owner pertama** dikelola operator platform di `/platform` dengan aksi yang sama (FLOW-23).
5. **Setiap Batalkan dan Terbitkan ulang diaudit** (aktor, email, peran, tenant, id undangan, waktu; kode tidak dicatat; BR-AUD-001).
6. Kode reset: menerbitkan kode reset baru untuk akun yang sama **menggugurkan kode reset sebelumnya** (`DIUSULKAN`).
*Contoh 1 — kedaluwarsa diterbitkan ulang:* Senin 2026-11-16 09:00 Budi mengundang `ani@example.id` (kode `K7Q2M-9XD4R`, kedaluwarsa Kamis 2026-11-19 09:00). Kamis 10:00 Ani belum menerima; daftar menampilkan statusnya **Kedaluwarsa** (baris baru dibersihkan 2026-11-26). Budi menekan **Terbitkan ulang** → kode baru `P4M8R-2WH6C` berlaku sampai Minggu 2026-11-22 10:00; `K7Q2M-9XD4R` tidak berlaku lagi (dipakai di `/acme/join` → pesan generik). Audit mencatat aksi Budi.
*Contoh 2 — salah alamat dibatalkan:* Budi tak sengaja mengundang `ani@exmple.id` (kode `T5C8J-1ZK7W`). Ia menekan **Batalkan** → undangan hilang dan kode langsung tidak berlaku; ia mengundang ulang `ani@example.id`. Tenant `beta` tidak dapat melihat ataupun membatalkan undangan itu.

---

## 6. Hierarki Entitas & Model Data Konseptual

> Konseptual: entitas, relasi, atribut kunci. **Tanpa SQL/skema/kode.** Nama entitas berbahasa Inggris agar konsisten dengan implementasi kelak.

### 6.1 Hierarki (`DISEPAKATI`, KEP-03)

```
Tenant
 └── Entitas Hukum (legal_entity)     ← NPWP, status PKP
      └── Outlet                       ← zona waktu, jam potong, tarif pajak daerah, harga inklusif/eksklusif
           └── Register (cash_master)  ← device kasir, prefix unik, seri invoice & nota kredit
                └── Shift (cash_cashier)  ← kasir × register × rentang waktu
```

- **BR-TNT-001** (`DISEPAKATI`): `tenant_id` ada di **semua** tabel; isolasi ditegakkan dengan Row Level Security PostgreSQL.
- **BR-TNT-002** (`DISEPAKATI`): **NPWP dan status PKP melekat pada entitas hukum**, bukan outlet. Satu tenant dapat memiliki beberapa entitas hukum; setiap outlet milik tepat satu entitas hukum.
- **BR-TNT-003** (`DISEPAKATI`): **Pajak daerah (tarif PB1) per outlet**, karena tarif dapat berbeda antar daerah.
- **BR-TNT-004** (`DIUSULKAN`): Kode outlet (mis. `OUT01`) unik per tenant; kode register (mis. `POS02`) unik per outlet; kode **tidak dapat diubah** setelah ada transaksi (dipertahankan sebagai kehati-hatian; kode tidak lagi membentuk nomor invoice, BR-INV-003); prefiks invoice register hanya berlaku mulai periode `MMYY` berikutnya (BR-INV-003).

### 6.2 Diagram Relasi Teks (inti)

```
Tenant 1─* LegalEntity 1─* Outlet 1─* Register 1─* Shift 1─* Sale 1─* SaleLine
                                  │         │                  │       │
                                  │         │                  │       └─* SaleLineModifier
                                  │         │                  ├─* SalePayment
                                  │         │                  └─* CreditNote 1─* CreditNoteLine
                                  │         └─* Device (credential)
                                  ├─* Table (F&B) 1─* Bill 1─* BillEvent
                                  ├─* StockBalance (per SKU)
                                  ├─* PriceEntry (per SKU+UOM)
                                  └─* ItemOutletAvailability (per produk; override per SKU)

Tenant 1─* Category 1─* Product 1─* Sku 1─* SkuUom (barcode, faktor konversi)
Product 1─* ProductAttribute (Ukuran, Warna…) ; Sku *─* AttributeValue
Sku 1─* StockMovement (ledger) ; GoodsReceipt/Transfer/Stocktake → StockMovement
Product(menu) 1─* RecipeItem *─1 Sku(bahan)
Tenant 1─* User *─* Role ; User 1─* StaffPin (per device)
Tenant 1─* AuditLog (append-only)
```

### 6.3 Katalog Entitas & Atribut Kunci

#### A. Organisasi & Akses

| Entitas | Atribut kunci | Aturan penting |
|---|---|---|
| `tenant` | id, nama, **slug** (permanen, unik tanpa beda huruf; BR-TEN-004), status (`ACTIVE`/`SUSPENDED`), nama tampilan (maks 40 karakter; diatur operator platform; untuk PWA; tanpa warna/tema tenant; BR-TEN-007) | Batas RLS; slug bukan penentu akses |
| `tenant_sync` | tenant_id, version | Counter versi (BR-SYN-010) |
| `legal_entity` | id, tenant_id, nama, NPWP, is_pkp | NPWP/PKP di sini |
| `outlet` | id, legal_entity_id, kode, nama, timezone (IANA), day_cutoff_time, price_tax_mode (INCLUSIVE/EXCLUSIVE), tax_profile (NONE/PPN/PB1; tarifnya di `tax_rate_history`), service_charge_enabled/rate (berlaku langsung), service_charge_taxable, cash_rounding_unit | Konfigurasi pajak/biaya **per outlet** |
| `tax_rate_history` | id, tenant_id, tax_code (PPN/PB1), outlet_id (kosong = default tenant), berlaku_mulai (tanggal bisnis), tarif (persen), `version`, `deleted_at` | Riwayat tarif pajak; hanya menambah baris; dipilih menurut `business_date` (BR-TAX-001) |
| `register` (`cash_master`) | id, outlet_id, kode, nama, status, prefiks invoice (wajib untuk `KASIR`, unik per tenant; riwayat berlaku-mulai; BR-INV-003), jenis (`KASIR`/`PELAYAN`; default `KASIR`; BR-FNB-011), (pencatatan nomor tertinggi dan gap per periode `MMYY` dimiliki modul Penjualan, bukan kolom register; BR-ARC-003) | Seri invoice & nota kredit per register |
| `device` | id, register_id, credential_hash, enrolled_at, last_sync_at, revoked_at | Dicabut → ditolak saat online berikutnya |
| `pairing_code` | code, register_id, expires_at, used_at | Sekali pakai, hanya online |
| `account` | id, email (**unik se-sistem**), password_hash, status | Identitas global back-office; tanpa username (BR-IDN-001) |
| `tenant_member` | id, tenant_id, account_id (**kosong = anggota PIN-only**; tetap tersimpan setelah anggota dikeluarkan sebagai penunjuk jejak audit), nama, role_id, status (termasuk `KELUAR`); **tanpa salinan email** | Keanggotaan per tenant; unik per (tenant, account); satu tenant minimal satu Owner (BR-IDN-006) |
| `tenant_invitation` | tenant_id, email, role_id, kode (hash), kedaluwarsa, dipakai_pada, dibuat_oleh | Undangan tanpa email, sekali pakai; **baris dibersihkan 7 hari setelah kedaluwarsa atau terpakai**; undangan aktif ikut dihitung sebagai keanggotaan untuk aturan reset (BR-IDN-004/005) |
| `role`, `permission`, `role_permission` | role bisa dikonfigurasi; batas diskon per role | BR-AUT-009 |
| `user_outlet` | member_id, outlet_id, role_id | Penugasan staf ke outlet |
| `staff_pin` | member_id, device_id, salt, pin_hash, kdf_params, failed_count, locked_until | Salt per device (BR-AUT-004) |
| `tenant_feature_flag` | tenant_id, flag_key, enabled, `version`, `deleted_at` | Master tersinkron; hanya Owner mengubah; default tiap flag ada di kode (BR-VER-009) |

#### B. Katalog & Harga

| Entitas | Atribut kunci |
|---|---|
| `category` | id, parent_id (sub-kategori), nama, urutan |
| `product` | id, category_id, nama, tipe (RETAIL/MENU_FNB), has_variants, base_uom_id, track_stock, taxable (default ya), is_active, is_open_price (penanda open price; default tidak; BR-PRC-007) |
| `product_attribute` / `attribute_value` | Atribut (Ukuran, Warna) dan nilainya |
| `sku` | id, product_id, kode_sku, kombinasi atribut, is_active |
| `uom` | id, kode (pcs, dus, kg, g…), allow_fraction |
| `sku_uom` | sku_id, uom_id, **faktor konversi ke base**, barcode (nullable, unik per tenant) |
| `price_entry` | sku_id, uom_id, outlet_id (nullable = default tenant), harga (integer rupiah), currency (IDR) |
| `item_outlet_availability` | tenant_id, outlet_id, product_id, sku_id (**kosong = baris tingkat produk; terisi = override SKU**), status (`AVAILABLE`/`UNAVAILABLE`), changed_at (waktu server), changed_by, `version`, `deleted_at`. Baris tingkat produk **dibuat eksplisit** untuk setiap (produk × outlet); override SKU **jarang** dan hanya ada bila menyimpang. Unik per (outlet, produk, sku). **Terpisah dari `price_entry`** (BR-CAT-009) |
| `modifier_group`, `modifier` | F&B: nama, selisih harga, perubahan bahan (tambah/ganti/kurangi) |
| `table` | outlet_id, kode, area, kapasitas |
| `recipe_item` | menu_sku_id, ingredient_sku_id, qty (dalam base UOM bahan) |

Setiap baris master membawa: `version`, `deleted_at` (tombstone), `created_at`, `updated_at`, `tenant_id`.

#### C. Transaksi

| Entitas | Atribut kunci |
|---|---|
| `shift` (`cash_cashier`) | id, register_id, cashier_id, opened_at, closed_at, opening_cash, counted_cash, expected_cash (server), variance, status (OPEN/CLOSED/FORCE_CLOSED) |
| `cash_movement` | shift_id, jenis (IN/OUT), nominal, alasan |
| `sale` | id (UUIDv7 = idempotency key), invoice_no, register_id, shift_id, business_date, created_at_device, clock_offset, received_at (server), status (PAID/VOID), subtotal, discount_total, service_charge, tax, rounding, grand_total, price_tax_mode & tarif snapshot, customer (opsional), bill_id (F&B, opsional), schema_version (= `contract_version`), app_version (BR-VER-008), catalog_cursor (versi master di device saat menjual; BR-CAT-013) |
| `sale_line` | sale_id, sku_id, uom_id, nama (snapshot), qty (decimal-string), harga satuan (snapshot), line_gross, line_discount, bill_discount_alloc, tax_alloc, service_alloc, cost_snapshot (HPP, diisi server), flag harga stale, is_open_price (snapshot penanda open price; BR-PRC-007) |
| `sale_payment` | sale_id, metode, nominal diterapkan, tunai diterima, kembalian, referensi |
| `credit_note` / `credit_note_line` | cn_no, sale_id asal, register_id, shift_id, alasan, approver_id, jumlah per komponen, disposisi stok (KEMBALI_STOK/BUANG), contract_version, app_version |
| `bill` | id, outlet_id, table_id, lease_holder_device_id, status (OPEN/SPLIT/PAID/CANCELED/MERGED), parent_bill_id |
| `bill_event` | bill_id, seq, jenis (ITEM_ADDED/ITEM_VOIDED/…), payload, staff_id, device_seq, contract_version, app_version |
| `invoice_gap` | register_id, seq_from, seq_to, status (OPEN/EXPLAINED), alasan |

#### D. Inventori

| Entitas | Atribut kunci |
|---|---|
| `stock_balance` | sku_id, outlet_id, qty (numeric), inventory_value (bigint), last_cost_reference |
| `stock_movement` | id, sku_id, outlet_id, jenis, qty_delta (base UOM), value_delta, sumber (sale/GR/transfer/opname/retur), source_id, occurred_at, processed_at |
| `goods_receipt` (+line) | outlet_id, supplier (opsional), status, line: sku, uom, qty, biaya |
| `transfer` (+line) | from_outlet, to_outlet, status (DRAFT/SENT/RECEIVED/CANCELED), qty_sent, qty_received, value_sent |
| `stocktake` (+line) | outlet, snapshot_qty, counted_qty, delta |

#### E. Operasional Klien

| Entitas | Lokasi | Atribut kunci |
|---|---|---|
| `outbox_command` | Dexie | id (UUIDv7), tipe, payload, schema_version (= `contract_version`), app_version, device_seq, status (PENDING/SENDING/ACKED/NEEDS_ATTENTION), dependency_key |
| `local_counter` | Dexie | seri invoice & nota kredit per (register, `MMYY`) |
| `print_job` | Dexie | id, sale_id/cn_id, status, jumlah percobaan |
| `attention_item` | Server | command id, alasan (STRUKTURAL/OTORISASI), device, status |
| `audit_log` | Server | id, tenant_id, aktor, penyetuju, aksi, objek, sebelum/sesudah, waktu device & server, hash berantai (BR-AUD-002) |

### 6.4 Kesiapan Perluasan (AP-11, `DISEPAKATI`)

- Setiap baris penjualan/bill menyimpan `register_id`/`device_id` asal, sehingga hub LAN kelak dapat mengidentifikasi sumber.
- Event bill (`bill_event`) sudah append-only dan berurutan per device → siap dipakai KDS/tiket dapur tanpa mengubah model.
- Tabel besar (penjualan, ledger) memakai kunci waktu (`business_date`/`occurred_at`) agar dapat dipartisi per bulan (OQ-03).

---

## 7. Business Rules per Domain

> Format tiap aturan: **ID — judul (status)** → ketentuan → rumus → **contoh berangka**. Seluruh contoh bersifat normatif untuk uji penerimaan: implementasi harus menghasilkan angka yang **persis sama**.

### 7.1 Uang, Kuantitas & Pembulatan (KEP-07)

**BR-MNY-001 — Uang adalah integer (`DISEPAKATI`).** Seluruh nilai uang disimpan sebagai bilangan bulat satuan terkecil mata uang (IDR: 1 rupiah, tipe `bigint`). **Tidak pernah float/double** — di database, di JS, maupun di JSON. Kode mata uang disimpan di data yang relevan (nilai `IDR`); multi-mata-uang tidak masuk MVP.

**BR-MNY-002 — Kuantitas adalah decimal berskala tetap (`DISEPAKATI`).** Di database: `numeric` dengan scale tetap **4** (`DISEPAKATI`, OQ-09 terjawab). Di JavaScript: **dilarang** operator float untuk kuantitas; wajib library desimal. Semua nilai kuantitas yang melewati batas sync (outbox, API) berupa **string/integer**, divalidasi Zod. *Alternatif "kuantitas integer berskala" dicatat sebagai opsi yang **ditolak**.*

**BR-MNY-003 — Pecahan hanya muncul di titik terdefinisi (`DISEPAKATI`).** Nilai pecahan hanya timbul pada: (1) `harga × kuantitas`, (2) diskon persen, (3) service charge, (4) pajak, (5) pembagian/split bill & alokasi, (6) HPP penjualan dari moving average, (7) konversi nilai persediaan. Di setiap titik itu hasil **dibulatkan ke integer rupiah, DISIMPAN, dan tidak pernah dihitung ulang** (struk, laporan, retur memakai angka yang disimpan).

**BR-MNY-004 — Aturan pembulatan: half-up (`DIUSULKAN`, konfirmasi akuntan bersama OQ-01/OQ-10).** `R(x)` membulatkan ke bilangan bulat terdekat; tepat `,5` dibulatkan **ke atas** (bukan banker's rounding). Semua perhitungan dilakukan pada besaran non-negatif; tanda diatur oleh jenis dokumen (invoice vs nota kredit).

| Ekspresi | Nilai eksak | R(x) |
|---|---|---|
| 0,333 kg × Rp12.500 | 4.162,5 | **4.163** |
| 0,35 kg × Rp47.500 | 16.625 | **16.625** |
| 1,5 × Rp9.999 | 14.998,5 | **14.999** |
| 5% × Rp117.450 | 5.872,5 | **5.873** |
| 10% × Rp123.323 | 12.332,3 | **12.332** |

**BR-MNY-005 — Per baris vs per bill (`DISEPAKATI`: pajak per bill, half-up; OQ-10 terjawab 2026-11-18).**

| Komponen | Dihitung pada | Dibulatkan |
|---|---|---|
| `line_gross` = harga satuan × kuantitas | per baris | 1× per baris |
| Diskon persen pada item | per baris | 1× per baris |
| Diskon persen pada bill | per bill (atas subtotal setelah diskon item) | 1× per bill |
| Service charge | per bill | 1× per bill |
| Pajak (PPN/PB1) | per bill (atas dasar pajak gabungan) | 1× per bill |
| Alokasi diskon-bill/SC/pajak ke baris | per baris, memakai **LR** | tidak ada pembulatan bebas; jumlah baris = total bill |

*Alasan:* pajak per bill meminimalkan selisih pembulatan akumulatif dan sesuai praktik struk; alokasi per baris tetap disimpan agar retur parsial dan laporan per item tidak menghitung ulang.

**BR-MNY-006 — Largest Remainder (LR) (`DISEPAKATI`).** Untuk membagi bilangan bulat `T` ke `n` bagian dengan bobot `w₁…wₙ` (atau bobot sama):
1. Bagian eksak `eᵢ = T × wᵢ / Σw`.
2. Ambil `bᵢ = floor(eᵢ)`.
3. Sisa `s = T − Σbᵢ` (bilangan bulat ≥ 0, < n).
4. Tambahkan 1 ke `s` bagian dengan pecahan `eᵢ − bᵢ` **terbesar**; bila seri, bagian dengan urutan lebih awal (nomor baris/bill anak lebih kecil) didahulukan.
5. Jumlah akhir **selalu tepat `T`**.

*Contoh 1 (bobot sama):* Rp100.000 ÷ 3 → eksak 33.333,33 → basis 33.333 ×3 = 99.999, sisa 1 → bagian pertama +1 → **33.334 + 33.333 + 33.333**.

*Contoh 2 (bobot):* diskon bill nominal Rp10.000 dialokasikan ke 3 baris bernilai Rp70.000 / Rp16.000 / Rp44.500 (Σ = 130.500).

| Baris | Eksak | Basis | Pecahan | +1? | Hasil |
|---|---|---|---|---|---|
| 1 (70.000) | 5.363,98 | 5.363 | ,98 | ya | **5.364** |
| 2 (16.000) | 1.226,05 | 1.226 | ,05 | tidak | **1.226** |
| 3 (44.500) | 3.409,96 | 3.409 | ,96 | ya | **3.410** |

Σ basis = 9.998 → sisa 2 → baris 1 dan 3 (pecahan terbesar). Σ hasil = 10.000 ✓.

**BR-MNY-007 — Satu package perhitungan (`DISEPAKATI`).** Fungsi hitung (line gross, diskon, SC, pajak, pembulatan tunai, LR, konversi UOM) berada di **satu package bersama** yang dipakai client dan server. Server **menghitung ulang** saat menerima `FinalizeSale` hanya untuk **verifikasi**; bila berbeda dari angka client, **angka client tetap disimpan sebagai fakta** dan selisih ditandai (flag) — konsisten dengan AP-02. Wajib ada **vektor uji bersama** (contoh-contoh di Bab 7) yang dijalankan di CI untuk client & server, plus test properti: *Σ hasil LR = total*, *hasil tidak bergantung urutan input yang setara*.

**BR-MNY-008 — Validasi (`DIUSULKAN`).** Uang: integer ≥ 0 pada dokumen; nominal pengurang (diskon) ≤ basisnya; kuantitas > 0 dan sesuai scale; string desimal divalidasi pola ketat sebelum diurai.

### 7.2 Katalog, UOM & Harga (KEP-06)

#### 7.2.1 Kategori, Produk, Varian

**BR-CAT-001 — Hierarki kategori (`DISEPAKATI`).** Dua tingkat: kategori dan sub-kategori. Produk terhubung ke satu kategori/sub-kategori.

**BR-CAT-002 — Varian (`DISEPAKATI`).** Produk induk + atribut (Ukuran, Warna, dll.). **SKU digenerate per kombinasi nilai atribut.** Tiap SKU punya barcode sendiri, UOM, harga per outlet, dan stok sendiri.

*Contoh:* Produk induk `KAOS01` "Kaos Polos"; atribut Ukuran {S, M, L} × Warna {Merah, Hitam} → **6 SKU**: `KAOS01-S-MRH`, `KAOS01-S-HTM`, `KAOS01-M-MRH`, `KAOS01-M-HTM`, `KAOS01-L-MRH`, `KAOS01-L-HTM`. Menambah ukuran XL → generate 2 SKU baru (XL-Merah, XL-Hitam). Menghapus warna Hitam → 3 SKU dinonaktifkan (bukan dihapus) bila pernah dijual.

**BR-CAT-003 — Produk tanpa varian (`DIUSULKAN`).** Dianggap memiliki **satu SKU implisit**; semua atribut SKU (barcode, harga, stok) berlaku sama.

**BR-CAT-004 — Nonaktif/hapus (`DIUSULKAN`).** Produk/SKU yang pernah muncul di transaksi **tidak boleh dihapus permanen**; hanya `is_active=false` (soft delete/tombstone ikut feed). Setelah device menerima tombstone, item hilang dari layar jual. **Penjualan offline atas item yang baru dinonaktifkan tetap diterima** (AP-02), ditandai "item nonaktif" di laporan. Nonaktif **global** ini berbeda dari ketersediaan **per outlet** (BR-CAT-009..016) dan mengalahkannya.

**BR-CAT-005 — Batas varian (`DIUSULKAN`).** Maksimum 3 atribut dan 100 kombinasi SKU per produk induk (parameter, Lampiran C).

**BR-CAT-006 — Barcode (`DISEPAKATI`; detail `DIUSULKAN`).** Barcode bisa **per UOM** (mis. barcode eceran ≠ barcode dus). Unik per tenant pada (SKU, UOM) aktif; menyimpan barcode ganda ditolak. Lookup lokal memakai indeks barcode di Dexie → hasil (SKU, UOM). Scan barcode yang tidak ditemukan: pesan "barcode tidak dikenal", tidak menambah item.

**BR-CAT-007 — Cara input barcode (`DISEPAKATI`).** (a) Scanner USB/Bluetooth berperilaku **keyboard** (deret karakter cepat diakhiri Enter; deteksi antar-karakter < 50 ms, parameter `DIUSULKAN`); (b) **kamera** memakai `BarcodeDetector` dengan polyfill WASM bila tidak tersedia.

**BR-CAT-008 — Skala katalog (`DISEPAKATI`).** ≤ 5.000 produk dimuat di device; pencarian nama/kode dan barcode dilakukan lokal (NFR-PERF-003).

#### 7.2.2 UOM & Konversi

**BR-UOM-001 — Stok selalu di base UOM (`DISEPAKATI`).** Setiap SKU punya satu satuan dasar. Semua ledger dan saldo stok dalam satuan dasar.

**BR-UOM-002 — Faktor konversi (`DISEPAKATI`).** Disimpan sebagai **"berapa satuan dasar dalam 1 UOM"**, sehingga konversi selalu **perkalian**: `qty_dasar = qty_UOM × faktor`. Konversi bersifat **datar** (setiap UOM langsung ke base; tidak ada rantai dus→pak→pcs, `DIUSULKAN`).

**BR-UOM-003 — Contoh (`DISEPAKATI`).** Susu UHT 1L: base `pcs`; `dus` faktor **12**.
- Jual **0,5 dus** → 0,5 × 12 = **6 pcs**.
- Jual 3 dus + 5 pcs (dua baris) → 3×12 + 5 = **41 pcs** keluar dari stok.
- Terima 5 dus dari pemasok → 5 × 12 = **60 pcs** masuk.

**BR-UOM-004 — UOM yang tidak boleh pecahan (`DIUSULKAN`).** Tiap UOM punya flag `allow_fraction`. Jika hasil konversi ke base melanggar flag base UOM, kuantitas ditolak saat input.
*Contoh:* 0,35 dus × 12 = 4,2 pcs; `pcs` tidak boleh pecahan → **ditolak** ("kuantitas harus menghasilkan pcs bulat"). 0,5 dus × 12 = 6 pcs → diterima. Untuk base `kg` (`allow_fraction=true`), 0,35 kg diterima.

**BR-UOM-005 — Presisi (`DISEPAKATI`: scale 4, OQ-09 terjawab).** Kuantitas dan faktor memakai `numeric` scale 4. Hasil konversi yang memerlukan lebih dari scale 4 ditolak saat input (tidak dibulatkan diam-diam).

**BR-UOM-006 — Perubahan faktor (`DIUSULKAN`).** Mengubah faktor hanya berlaku ke depan; baris penjualan menyimpan **qty dalam UOM jual + faktor snapshot + qty dasar**, sehingga transaksi lama tidak berubah.

#### 7.2.3 Harga Jual

**BR-PRC-001 — Harga eksplisit (`DISEPAKATI`).** Harga jual ditetapkan eksplisit per **(SKU + UOM + outlet)**, integer rupiah. 1 dus boleh lebih murah dari 12× eceran.
*Contoh (outlet OUT01):* Susu UHT 1L pcs = Rp11.500; dus = **Rp130.000** (bukan 12 × 11.500 = 138.000; hemat Rp8.000).

**BR-PRC-002 — Fallback bila harga belum diisi (`DISEPAKATI`: default tenant, lalu blokir; OQ-06 terjawab).** Ketersediaan item di outlet (BR-CAT-009) **tidak** ditentukan oleh ada/tidaknya harga; aturan ini hanya mengatur harga bagi item yang sudah tersedia. **Pengecualian:** item bertanda open price (BR-PRC-007) tidak memerlukan harga master. Aturan (berurutan):
1. Harga eksplisit (SKU, UOM, outlet) → pakai.
2. Jika tidak ada: harga **default tenant** (SKU, UOM, outlet kosong) bila ada → pakai.
3. Jika keduanya tidak ada: item **tidak dapat dijual** pada (UOM, outlet) itu — tampil "harga belum diatur" dan tidak masuk keranjang. **Tidak** diturunkan otomatis dari harga base × faktor (karena harga grosir bersifat sengaja).

**BR-PRC-003 — Harga stale = fakta (`DISEPAKATI`).** Harga yang terlihat di device saat dijual adalah **fakta**. Transaksi menyimpan **snapshot harga**; server menerima apa adanya dan **menandai selisih** terhadap harga terbaru pada saat server memproses, untuk laporan.
*Contoh:* Kopi Bubuk 200g harga Rp18.500. Pukul 13:00 owner menaikkan jadi **Rp19.000**. Device offline sejak 12:00 hingga 15:00 dan menjual 2 pcs pukul 14:00 @18.500 = 37.000. Server menerima 15:05: transaksi tetap Rp37.000 dan baris diberi flag `harga_stale` dengan selisih **−500 × 2 = −Rp1.000** (laporan "Penjualan dengan harga berbeda").

**BR-PRC-004 (`DIUSULKAN`).** Perubahan harga hanya berlaku ke depan dan tercatat di audit log (BR-AUD-001). **BR-PRC-005 (`DISEPAKATI`).** Interpretasi harga (sudah termasuk pajak atau belum) mengikuti mode outlet (BR-TAX-003); mode disalin sebagai snapshot ke transaksi. **BR-PRC-006 (`DIUSULKAN`).** Harga satuan baris F&B = harga menu + Σ selisih harga modifier terpilih; nilai akhir disimpan sebagai harga satuan snapshot.

**BR-PRC-007 — Item open price (`DISEPAKATI`: flag produk + snapshot baris, semua role checkout, tanpa kontrol tambahan; OQ-18 dan OQ-28 terjawab).** Master produk memiliki kolom penanda **`is_open_price`** (ya/tidak; default tidak). Item yang ditandai open price **harganya diketik kasir saat transaksi** dan tidak memerlukan harga master.
1. **Hanya** item bertanda open price yang harganya boleh diketik; harga item biasa tidak dapat diubah oleh kasir (perubahan harga tetap lewat master online, BR-PRC-004).
2. Saat item dimasukkan ke keranjang, kasir **wajib mengisi harga satuan** (bilangan bulat rupiah > 0). Harga master, bila ada, hanya nilai awal yang dapat diubah.
3. Harga yang diketik adalah **fakta**: disimpan sebagai snapshot harga satuan pada baris, dan baris penjualan diberi **penanda `is_open_price`** (snapshot, tetap benar walau penanda di master kemudian diubah). Baris open price **tidak** dikenai penandaan harga stale (BR-PRC-003).
4. Ketersediaan outlet (BR-CAT-009) tetap berlaku. Ketiadaan harga master **tidak** memblokir item open price (pengecualian atas BR-PRC-002).
5. Diskon, pajak, pembulatan, stok/HPP, retur, split/merge berlaku normal seperti item lain; retur memakai angka tersimpan pada baris.
6. Laporan dapat memfilter penjualan open price (R-04).

*Contoh:* "Jasa Pengiriman" bertanda open price. Keranjang di outlet PPN 11% eksklusif: Kopi 2 × 18.500 = 37.000 + Jasa Pengiriman, kasir mengetik **Rp12.500** × 1 = 12.500 (baris bertanda open price) → gross 49.500; PPN = R(49.500 × 11%) = **5.445**; total **54.945**; tunai terbulat: 549,45 → 549 → **54.900** (rounding **−45**); tunai diterima 60.000 → kembalian **5.100**.

#### 7.2.4 Ketersediaan Item per Outlet (KEP-18)

> Keputusan user (rev. 0.92), `DISEPAKATI`. OQ-24, OQ-25, OQ-26, dan OQ-27 (a, b, c) sudah dijawab user (2026-11-17); tidak ada butir ketersediaan yang masih terbuka.

**BR-CAT-009 — Mekanisme: flag eksplisit per outlet, terpisah dari harga (`DISEPAKATI`).** Ketersediaan disimpan sebagai **penugasan item–outlet** eksplisit (entitas `item_outlet_availability`, Bab 6.3.B) dengan status `AVAILABLE`/`UNAVAILABLE`. Ketersediaan **terpisah dari harga per outlet** (BR-PRC-001): **ketiadaan harga TIDAK berarti item tidak dijual**, dan ketiadaan penugasan tidak menggantikan harga. Dua dimensi itu berdiri sendiri:

| Ketersediaan di outlet | Harga di outlet | Perilaku di POS outlet itu |
|---|---|---|
| `AVAILABLE` | Ada | Tampil dan dapat dijual |
| `AVAILABLE` | Tidak ada (dan tidak ada harga default tenant) | Tampil dengan "harga belum diatur", tidak dapat masuk keranjang (BR-PRC-002, OQ-06) |
| `UNAVAILABLE` | Ada | **Tersembunyi**; harga tetap tersimpan |
| `UNAVAILABLE` | Tidak ada | Tersembunyi |

**BR-CAT-010 — Granularitas dan penyelesaian status efektif (`DISEPAKATI`; arah override dijawab user: override menang dua arah, OQ-27a).**
1. Status ditentukan di level **produk induk** (satu baris per produk × outlet).
2. **Override per SKU (varian)** pada outlet tertentu (satu baris per SKU × outlet, hanya bila menyimpang dari induk).
3. **UOM mengikuti SKU**: tidak ada pembatasan ketersediaan per UOM (SKU tersedia berarti semua UOM-nya tersedia).
4. Status efektif (SKU, outlet), berurutan: **(a)** produk/SKU `is_active=false` secara global (BR-CAT-004) → tidak tersedia di semua outlet (mengalahkan segalanya); **(b)** ada override SKU → status override; **(c)** selain itu → status baris produk; **(d)** baris belum diterima device → dianggap `AVAILABLE` (BR-CAT-011 default). Produk induk ditampilkan di POS bila **minimal satu SKU-nya** efektif tersedia.

**BR-CAT-011 — Nilai default (`DISEPAKATI` untuk item baru dan outlet baru; OQ-24 terjawab).**
- **Item baru:** tersedia di **SEMUA outlet**. Dalam transaksi pembuatan produk, baris produk dibuat `AVAILABLE` untuk setiap outlet yang ada; admin dapat **mengecualikan (opt-out)** outlet tertentu saat membuat atau sesudahnya.
- **SKU baru** (varian ditambahkan ke produk yang sudah ada): mengikuti status produk per outlet; **tidak** mewarisi override SKU lain (DIUSULKAN).
- **Outlet baru setelah item ada (`DISEPAKATI`, OQ-24):** default **tersedia** — semua produk aktif mendapat baris `AVAILABLE` untuk outlet baru dalam **satu transaksi, satu kenaikan versi** (BR-SYN-010); override SKU **tidak** disalin.

**BR-CAT-012 — Dampak bila item dinonaktifkan di sebuah outlet (`DISEPAKATI`).**
- **Disembunyikan dari POS outlet itu:** katalog/daftar, pencarian nama/kode, **dan lookup barcode** (tidak dapat ditambahkan ke keranjang).
- **Tetap utuh:** stok, saldo, ledger, nilai persediaan, HPP (termasuk in-transit).
- **Tetap diperbolehkan:** penerimaan barang (GR) dan transfer (kirim maupun terima) ke/dari outlet itu, opname/penyesuaian; harga per outlet tetap tersimpan dan dapat diubah. Retur atas invoice lama tetap diperbolehkan (BR-CAT-020, `DIUSULKAN`).
- **Hanya tampilan jual yang berubah**; tidak ada data historis yang diubah.

**BR-CAT-013 — Penjualan sebelum perubahan sampai ke device = fakta (`DISEPAKATI`; mekanisme penandaan `DIUSULKAN`).** Penjualan offline yang terjadi **sebelum device menerima perubahan** (atau sebelum penjualan itu tersinkron) **diterima** sebagai fakta (AP-02): invoice, stok, ledger, HPP diproses normal (stok minus diizinkan dan diberi flag, BR-STK-002). Hasilnya hanya **ditandai di laporan** (R-04), tidak ditolak. Mekanisme: tiap perintah `FinalizeSale` membawa `catalog_cursor` (versi master yang dimiliki device saat menjual). Server memberi flag **`item_tidak_tersedia`** bila baris ketersediaan efektif item itu berstatus `UNAVAILABLE` dengan `version` > `catalog_cursor` penjualan **dan** `occurred_at` (waktu terkoreksi) ≥ `changed_at` perubahan; penjualan yang terjadi **sebelum** perubahan itu di-commit dianggap sah dan **tidak** ditandai. `occurred_at` hanya dipakai sebagai label, tidak pernah untuk menolak (jam device tidak dipercaya, BR-TIM-005).

**BR-CAT-014 — Hanya online; sinkron lewat counter versi (`DISEPAKATI`; unduhan katalog `DIUSULKAN`).** Perubahan ketersediaan **hanya dibuat online di back-office** dan sampai ke POS lewat **pull sync berbasis counter versi** seperti master data lain (BR-SYN-010): baris penugasan membawa `version`, ikut **tombstone** (menghapus override SKU = kembali mengikuti induk), terfilter ke outlet device, dan perubahan massal (penugasan banyak produk, outlet baru, impor) = **satu transaksi, satu kenaikan versi**. Aturan tambahan `DIUSULKAN`:
- Layar jual **baru diperbarui setelah seluruh halaman satu siklus pull diterapkan** (agar tidak menampilkan produk baru sebelum baris ketersediaannya tiba di halaman berikutnya).
- Device menyimpan **seluruh katalog tenant** + penugasan outletnya; item `UNAVAILABLE` tetap ada di Dexie (tersembunyi) agar pesan scan spesifik (BR-CAT-015), riwayat/retur, dan reaktivasi tanpa unduh ulang dapat berjalan. Batas ≤ 5.000 SKU (BR-CAT-008) berlaku pada SKU yang **efektif tersedia**; pilihan mengunduh seluruh katalog adalah keputusan user (OQ-27c terjawab); bila katalog tenant jauh lebih besar dari batas, ukuran Dexie dan full resync menjadi pertimbangan yang perlu diukur pada F2.

**BR-CAT-015 — Scan/lookup item yang tidak tersedia di outlet (`DIUSULKAN`, OQ-27b).** Barcode yang dikenali pada katalog tenant tetapi efektif `UNAVAILABLE` di outlet ini **tidak** menambah item ke keranjang dan menampilkan pesan khusus — **"{nama item} tidak tersedia di outlet ini"** (`en-US`: "{item name} is not available at this outlet") — **berbeda** dari "barcode tidak dikenal" (barcode tidak ada di master sama sekali, BR-CAT-006). Pesan memakai kunci terjemahan (BR-I18N-001); tidak ada jalur override oleh kasir/supervisor di MVP. Pencarian nama/kode tidak menampilkan item itu.

**BR-CAT-016 — Produk induk dinonaktifkan vs override SKU (`DIUSULKAN`; arah override `DISEPAKATI`: override menang, OQ-27a).**

| `is_active` global | Produk @ outlet | Override SKU @ outlet | Efektif |
|---|---|---|---|
| tidak | apa pun | apa pun | **Tidak tersedia** di semua outlet; penugasan tetap tersimpan |
| ya | `AVAILABLE` | tidak ada | Tersedia |
| ya | `AVAILABLE` | `UNAVAILABLE` | **Tidak tersedia** (hanya SKU itu) |
| ya | `UNAVAILABLE` | tidak ada | Tidak tersedia |
| ya | `UNAVAILABLE` | `AVAILABLE` | **Tersedia** (hanya SKU itu; override menang) |

Mengubah status produk @ outlet **tidak menghapus** override SKU; override hanya hilang bila admin menghapusnya ("ikut induk"). Mengaktifkan kembali produk global mengembalikan ketersediaan sesuai penugasan terakhir (tidak ada data hilang).

**BR-CAT-017 — Stok, in-transit, dan stok minus pada item tidak tersedia (`DISEPAKATI` inti; detail `DIUSULKAN`).** Saldo qty/nilai tetap tercatat dan **ikut dalam nilai persediaan outlet**; tampil di laporan stok dengan penanda "tidak tersedia" (R-02). **Transfer** ke outlet itu boleh dikirim/diterima (in-transit tidak dipengaruhi). **Stok minus** yang timbul dari penjualan offline pasca-perubahan (BR-CAT-013) tetap diberi flag stok minus **dan** flag `item_tidak_tersedia`; diselesaikan lewat opname. Aktivasi stok per outlet (BR-STK-004) **tidak** bergantung pada ketersediaan.

**BR-CAT-018 — Item yang dipakai sebagai bahan resep/BOM (`DISEPAKATI`: tanpa validasi baru, OQ-25 terjawab).** *Invarian yang tidak bergantung jawaban:* ketersediaan hanya mengatur **dijual/tidak**; server **tidak pernah menolak** konsumsi resep karena status ketersediaan (AP-02, BR-STK-003), dan stok bahan/ledger/HPP tetap utuh. *Diputuskan (OQ-25):* **tanpa validasi baru** — resep boleh memakai bahan yang `UNAVAILABLE` di outlet itu, menu yang bahannya tidak tersedia **tetap dijual**, dan bahan baku non-jual **tidak memerlukan penugasan** ketersediaan.

**BR-CAT-019 — "Habis sementara/86" (`DISEPAKATI`: tidak ada di MVP, OQ-26 terjawab).** Ketersediaan di bagian ini bersifat **administratif/permanen** (master, online, berversi). Fitur "habis sementara" (86) untuk F&B yang terpisah **tidak ada di MVP** (ditunda); menu yang habis hari itu dinonaktifkan lewat back-office; ketersediaan per outlet **tidak boleh** dipakai sebagai pengganti 86 harian.

**BR-CAT-020 — Open bill dan retur (`DIUSULKAN`).** (a) Item yang **sudah ada** di open bill ketika menjadi tidak tersedia tetap dapat dibayar dan menjadi fakta; **menambah** item itu ke bill sesudah device menerima perubahan diblokir (pesan BR-CAT-015). (b) **Retur** atas invoice lama yang memuat item tidak tersedia tetap diperbolehkan (disposisi stok `KEMBALI_STOK`/`BUANG` berlaku normal). (c) Void invoice tidak terpengaruh.

**BR-CAT-021 — Hak akses & audit (`DIUSULKAN`).** Mengubah ketersediaan memerlukan permission "Kelola master & harga" (BR-AUT-009); Manager hanya pada outlet yang ditugaskan (OQ-05). Setiap perubahan dicatat di audit log (item, outlet, status lama/baru, aktor).

**BR-CAT-022 — Dampak pada laporan (`DIUSULKAN`).** Ketersediaan **tidak mengubah angka** penjualan (R-01). R-02 menampilkan kolom/filter ketersediaan; R-04 menambah "penjualan item tidak tersedia" (BR-CAT-013).

##### Contoh Kasus

**Contoh 1 — Kopi dijual di Outlet A dan B, tidak di C.** Tenant punya 3 outlet. Produk "Kopi Bubuk 200g" (barcode contoh `8999999000100`) dibuat → 3 baris `AVAILABLE`. Admin mengecualikan Outlet C → baris Kopi/C menjadi `UNAVAILABLE` dalam satu transaksi (versi master 140 → **141**). Device C menarik versi 141: Kopi **hilang dari katalog dan pencarian**; memindai `8999999000100` → pesan **"Kopi Bubuk 200g tidak tersedia di outlet ini"**. Stok C tidak berubah: **12 pcs / Rp96.000**. Gudang C menerima GR 24 pcs @ Rp8.500 (Rp204.000) → saldo **36 pcs / Rp300.000** (rata-rata 8.333,33) — penerimaan tetap diizinkan; R-02 menampilkan baris ini dengan penanda "tidak tersedia".

**Contoh 2 — Varian Merah dikecualikan di B.** Kaos Polos `KAOS01` (6 SKU: S/M/L × Merah/Hitam) tersedia di A, B, C. Admin membuat 3 override SKU `UNAVAILABLE` di B untuk `KAOS01-S-MRH`, `KAOS01-M-MRH`, `KAOS01-L-MRH`. SKU tampil: **A = 6, B = 3 (hanya Hitam), C = 6**. Menambah ukuran XL (2 SKU baru) mengikuti produk per outlet dan tidak mewarisi pengecualian Merah: **A = 8, B = 5** (XL-Merah **dan** XL-Hitam tampil, sehingga admin harus mengecualikan `KAOS01-XL-MRH` di B bila diinginkan), **C = 8**.

**Contoh 3 — Penjualan offline di B sebelum perubahan sampai ke device.** Pukul 13:00 Kaos `KAOS01-S-MRH` dinonaktifkan di B (versi **131**). Device B offline sejak 12:00 dengan `catalog_cursor` = **128**. Pukul 14:00 device B menjual 2 pcs @ Rp75.000 = **Rp150.000**. Server memproses 15:05: **diterima** (invoice normal); versi ketersediaan 131 > 128 dan 14:00 ≥ 13:00 → flag **`item_tidak_tersedia`** di R-04. Stok B sebelum jual 1 pcs / Rp40.000 → HPP = 40.000 (tertutup stok) + 1 × biaya referensi 40.000 = **80.000**; saldo **−1 pcs / −Rp40.000** dengan flag stok minus (BR-HPP-005). Penjualan 1 pcs pukul 12:30 (sebelum perubahan di-commit) bersifat sah dan **tidak ditandai**.

**Contoh 4 — Outlet baru.** OUT04 dibuat ketika ada 4.000 produk aktif. Asumsi sementara: 4.000 baris produk `AVAILABLE` dibuat dalam **satu transaksi, satu versi** (mis. 141 → 142); override SKU tidak disalin. Item yang belum punya harga di OUT04 tampil "harga belum diatur" (BR-CAT-009, BR-PRC-002).

**Contoh 5 — Induk tidak tersedia tetapi override SKU tersedia.** Kaos Polos `UNAVAILABLE` di C, dengan override `KAOS01-L-HTM` = `AVAILABLE` di C → C menjual **hanya 1 SKU** (`KAOS01-L-HTM`); induk tampil dengan satu varian.

### 7.3 Diskon (KEP-10)

**BR-DSC-001 — Cakupan MVP (`DISEPAKATI`).** Hanya **diskon manual** per item atau per bill, berbentuk **persen** atau **nominal**, dengan **batas maksimum per role**. Di atas batas → **PIN supervisor**. Promo otomatis, voucher/kupon, loyalty/poin ditunda.

**BR-DSC-002 — Urutan & jumlah (`DIUSULKAN`).** Diskon item diterapkan lebih dulu pada `line_gross`; diskon bill diterapkan pada subtotal setelah diskon item (S1). Maksimum **satu diskon per baris** dan **satu diskon per bill**.

**BR-DSC-003 — Batas dihitung sebagai persentase efektif (`DIUSULKAN`; nilai batas default `DISEPAKATI`, OQ-05).** Diskon nominal dikonversi ke persen efektif = diskon ÷ basis. Diperiksa dua tingkat: (a) tiap diskon terhadap basisnya (baris: `line_gross`; bill: S1); (b) **kumulatif bill** = (Σ diskon baris + diskon bill) ÷ Σ `line_gross`. Batas role dibandingkan dengan **yang terbesar** dari (a) dan (b). Jika melebihi batas role pengguna, wajib PIN dari pengguna ber-permission `discount.approve` yang batas rolenya ≥ persen yang diminta (diverifikasi lokal; dicatat audit: peminta, penyetuju, nilai, alasan).

**BR-DSC-004 — Nilai diskon tidak boleh membuat basis negatif (`DIUSULKAN`).** Diskon ≤ basis; hasil subtotal ≥ 0.

**BR-DSC-005 — Alokasi diskon bill ke baris (`DISEPAKATI` melalui BR-MNY-006).** Diskon bill dialokasikan ke baris proporsional terhadap `line_net` memakai LR dan **disimpan** (`bill_discount_alloc`).

*Contoh A (nominal → persen efektif; batas Kasir 5%):* Gross bill Rp130.500.
- Diskon nominal Rp6.000 → 6.000/130.500 = **4,598%** ≤ 5% → boleh tanpa PIN.
- Diskon nominal Rp7.000 → **5,364%** > 5% → minta PIN. Supervisor Budi (batas 20%) memasukkan PIN → diterima; audit: *"Kasir Dewi minta diskon Rp7.000 (5,36%), disetujui Supervisor Budi, alasan: pelanggan langganan, register OUT01-POS02"*.

*Contoh B (kumulatif):* Baris A (Nasi Goreng 70.000) diskon 5% = 3.500; baris B 16.000; baris C 44.500. S1 = 130.500 − 3.500 = 127.000. Diskon bill 3% = R(3.810) = **3.810**. Tiap diskon sendiri ≤ 5% (5% dan 3%), namun kumulatif = (3.500 + 3.810) ÷ 130.500 = **5,60%** > 5% → **butuh PIN supervisor**.

### 7.4 Pajak & Biaya (KEP-09)

> Aturan akhir **menunggu konfirmasi akuntan** (`PERLU KONFIRMASI`, OQ-01). Berikut asumsi sementara berupa **konfigurasi per outlet** sehingga perubahan keputusan tidak mengubah arsitektur.

**BR-TAX-001 — Tarif tidak di-hardcode (`DISEPAKATI`).** Tarif PPN/PB1/service charge adalah **data konfigurasi** (master, tersinkron). **Tarif pajak** (PPN/PB1) punya `berlaku_mulai` (tanggal bisnis) dan disimpan sebagai **riwayat tersendiri** (`tax_rate_history`: kode pajak, outlet opsional — kosong = default tenant, mis. PPN nasional —, tanggal mulai, tarif; baris lama tidak ditimpa) sehingga perubahan tarif otomatis berlaku pada tanggal itu walau device offline; device memilih tarif menurut `business_date` transaksi (baris khusus outlet lebih dulu, lalu default tenant), bukan waktu sinkron (`DISEPAKATI`, revisi 0.96). **Pengaturan lain** — tarif service charge, mode harga inklusif/eksklusif, profil pajak, service charge aktif dan kena pajak — **tidak dijadwalkan**: berlaku pada transaksi berikutnya setelah device menerima perubahan (EC-025); disarankan mengubahnya di luar jam operasional. Riwayat perubahan tarif SC tercatat di audit log. **Tiap transaksi menyimpan snapshot tarif** yang dipakai.

**BR-TAX-002 — Jenis biaya (`DISEPAKATI`).** PPN (retail, entitas PKP), pajak restoran daerah/PB1 (tarif per outlet), service charge, pembulatan total tunai (dicatat terpisah). Profil pajak outlet (`tax_profile`): `NONE` / `PPN` / `PB1` — **tidak aktif bersamaan** (`DIUSULKAN`, OQ-01). Outlet pada entitas non-PKP tidak boleh memilih `PPN`.

**BR-TAX-003 — Inklusif/eksklusif per outlet (`DISEPAKATI`).** `price_tax_mode` ∈ {`INCLUSIVE`, `EXCLUSIVE`} diatur **per outlet**.

**BR-TAX-004 — Urutan baku (`DISEPAKATI`).** **Subtotal → diskon → service charge → pajak.**

**BR-TAX-005 — Service charge ikut kena pajak? (`DISEPAKATI`: flag per outlet, default ya; OQ-01a terjawab 2026-11-18).** Tiap outlet punya flag `service_charge_taxable`; nilai awal **ya** (SC masuk dasar pajak). Perlakuan hukumnya dapat berbeda antar daerah, sehingga outlet yang aturannya berbeda cukup mengubah flag; konfirmasi akuntan tetap disarankan. Kedua cabang dicontohkan di bawah.

**BR-TAX-006 — Algoritma perhitungan bill (`DISEPAKATI` urutan; detail `DIUSULKAN`).**

| Langkah | Rumus | Pembulatan |
|---|---|---|
| 1. `line_gross` | `R(harga_satuan × qty)` | per baris |
| 2. Diskon baris | persen: `R(line_gross × p/100)`; nominal: `min(nominal, line_gross)` | per baris |
| 3. `line_net` | `line_gross − diskon_baris` | — |
| 4. S1 | `Σ line_net` | — |
| 5. Diskon bill D | persen: `R(S1 × p/100)`; nominal: `min(nominal, S1)` | 1× |
| 6. S2 | `S1 − D` (dialokasikan ke baris via LR) | — |
| 7. Service charge SC | `R(S2 × tarif_SC)` bila SC aktif | 1× |
| 8. Dasar pajak B | `S2 + (SC bila service_charge_taxable)` — hanya baris produk kena pajak (BR-TAX-008) | — |
| 9a. Pajak EKSKLUSIF | `R(B × r)` | 1× |
| 9b. Pajak INKLUSIF (diekstrak) | `R(B × r / (1 + r))` ; DPP = `B − pajak` | 1× |
| 10. Grand total G | EKSKLUSIF: `S2 + SC + pajak`; INKLUSIF: `S2 + SC` | — |
| 11. Pembulatan tunai | Bab 7.5 (BR-TAX-009) | — |
| 12. Alokasi | SC dan pajak dialokasikan ke baris via LR (bobot: `line_net` setelah diskon; untuk pajak, bobot ditambah porsi SC bila SC kena pajak) dan **disimpan** | LR |

**BR-TAX-007 — Mode inklusif (`DIUSULKAN`, OQ-01).** Pada mode inklusif total yang dibayar **tidak bertambah** karena pajak; pajak hanya diekstrak untuk pencatatan. Service charge ditambahkan **di atas** subtotal dan, bila `service_charge_taxable`, dianggap sudah mengandung pajak (ikut diekstrak). *Harga "nett"* (semuanya sudah termasuk, tanpa baris SC terpisah) dicapai dengan **mode inklusif + service charge nonaktif**; tidak diperlukan mode baru (OQ-01b terjawab 2026-11-18).

**BR-TAX-008 — Produk non-kena-pajak (`DIUSULKAN`).** `product.taxable=false` mengeluarkan baris dari dasar pajak (mis. barang bebas PPN). Contoh di bawah mengasumsikan semua baris kena pajak.

**BR-TAX-009 — Pembulatan total tunai (`DISEPAKATI`; OQ-13 terjawab: terdekat half-up, hanya tunai penyelesai).** Unit per outlet: tidak ada / Rp100 / Rp500 / Rp1.000 (default Rp100). Aturan: (1) berlaku **hanya** pada pembayaran **tunai yang menyelesaikan** sisa tagihan (pembayaran tunai terakhir yang membuat sisa = 0); porsi non-tunai dan pembayaran tunai parsial tidak dibulatkan; (2) pembulatan ke **kelipatan terdekat, half-up**; (3) selisih dicatat sebagai **`rounding` (bisa negatif)** terpisah dari pajak/SC dan **tidak mengubah dasar pajak**; (4) tagihan tunai = `G_sisa + rounding`. (5) **Hasil nol (`DISEPAKATI`, user 2026-11-25):** bila kelipatan unit terdekat adalah Rp0 sedangkan sisa tagihan > 0 (sisa < setengah unit), sisa **tidak dibulatkan**: tagihan tunai = sisa tepat dan `rounding` = 0, sehingga setiap baris pembayaran bernilai > 0 dan pelanggan tidak membayar lebih. *Contoh:* sisa Rp200 dengan unit Rp500 → tagihan tunai **Rp200** (bukan Rp0 dan bukan Rp500); sisa Rp250 → **Rp500** (+250, aturan half-up biasa).

**BR-TAX-010 (`DISEPAKATI`).** Faktur pajak/e-Faktur/Coretax di luar scope MVP; namun DPP, pajak, tarif snapshot, dan identitas entitas hukum (NPWP/PKP) tersimpan di transaksi sehingga fase lanjut dapat menurunkannya.

#### Contoh Hitungan Lengkap

**Contoh 1 — Retail, PPN 11%, EKSKLUSIF, entitas PKP, pembulatan tunai Rp100**

| # | Item | Qty | Harga | line_gross | Diskon | line_net |
|---|---|---|---|---|---|---|
| 1 | Kopi Bubuk 200g | 2 | 18.500 | 37.000 | — | 37.000 |
| 2 | Gula 1kg | 1 | 16.000 | 16.000 | — | 16.000 |
| 3 | Susu UHT 1L | 3 | 17.900 | 53.700 | 10% = 5.370 | 48.330 |

S1 = 101.330 · D = 0 · S2 = 101.330 · SC = 0 · Pajak = R(101.330 × 0,11) = R(11.146,30) = **11.146** · **G = 112.476**.
Pembayaran tunai penuh: pembulatan → 112.476 ÷ 100 = 1.124,76 → 1.125 → **Rp112.500, rounding = +24**. Tunai diterima 150.000 → **kembalian 37.500**.

**Contoh 2 — Retail yang sama, mode INKLUSIF** (harga sudah termasuk PPN)

S2 = 101.330 · Pajak diekstrak = R(101.330 × 11/111) = R(10.041,71) = **10.042** · DPP = 91.288 · **G = 101.330** (tidak bertambah).
Tunai: 101.330 → 1.013,3 → 1.013 → **Rp101.300, rounding = −30**. Tunai diterima 110.000 → **kembalian 8.700**.

**Contoh 3 — F&B, EKSKLUSIF, service charge 5%, PB1 10%**

| Item | Qty | Harga | line_gross |
|---|---|---|---|
| Nasi Goreng | 2 | 35.000 | 70.000 |
| Es Teh | 2 | 8.000 | 16.000 |
| Ayam Bakar + modifier "Extra Sambal" (+2.000) | 1 | 42.500 + 2.000 = 44.500 | 44.500 |

Σ gross = 130.500 · Diskon bill 10% = 13.050 → **S2 = 117.450**.
SC = R(117.450 × 5%) = R(5.872,5) = **5.873**.

| Skenario | Dasar pajak | PB1 10% | G | Tunai terbulat |
|---|---|---|---|---|
| **3a** SC **kena** pajak | 117.450 + 5.873 = 123.323 | R(12.332,3) = **12.332** | 117.450 + 5.873 + 12.332 = **135.655** | 135.700 (**+45**) |
| **3b** SC **tidak** kena pajak | 117.450 | **11.745** | 117.450 + 5.873 + 11.745 = **135.068** | 135.100 (**+32**) |

Selisih antar kedua aturan = Rp587 per bill ini → alasan butir ini menunggu akuntan (OQ-01).

**Contoh 4 — F&B INKLUSIF** (harga menu sudah termasuk PB1; SC di atas & kena pajak)

S2 = 117.450 · SC = 5.873 · B = 123.323 · PB1 diekstrak = R(123.323 × 10/110) = R(11.211,18) = **11.211** · **G = 123.323** · tunai: 1.233,23 → 1.233 → **Rp123.300, rounding = −23**.

**Contoh 5 — Alokasi pajak ke baris (untuk retur), dari Contoh 1.** Pajak 11.146 dialokasikan LR berbobot `line_net` (37.000 / 16.000 / 48.330; Σ 101.330):

| Baris | Eksak | Basis | Pecahan | Hasil |
|---|---|---|---|---|
| Kopi | 4.069,89 | 4.069 | ,89 | **4.070** (+1) |
| Gula | 1.759,95 | 1.759 | ,95 | **1.760** (+1) |
| Susu | 5.316,16 | 5.316 | ,16 | **5.316** |

Σ basis 11.144, sisa 2 → Gula (,95) dan Kopi (,89). Σ = 11.146 ✓. Nilai ini tersimpan di `tax_alloc` tiap baris.

### 7.5 Pembayaran (KEP-13)

**BR-PAY-001 — Metode (`DISEPAKATI`).** Tunai + metode manual **tanpa integrasi gateway** (transfer, kartu, QRIS) yang hanya dicatat. Daftar metode non-tunai dapat dikonfigurasi per tenant (nama tampilan, `DIUSULKAN`).

**BR-PAY-002 — Banyak metode per bill (`DISEPAKATI`).** Satu bill boleh dibayar dengan beberapa metode (mis. tunai + transfer). Σ nominal diterapkan = tagihan.

**BR-PAY-003 — Kembalian (`DISEPAKATI` konsep; detail `DIUSULKAN`).** `kembalian = tunai_diterima − tunai_diterapkan`, hanya untuk pembayaran **tunai**. Pembayaran non-tunai **tidak boleh melebihi** sisa tagihan (tidak ada kembalian dari non-tunai).

**BR-PAY-004 — Atomik (`DIUSULKAN`).** Bill menjadi `PAID` hanya bila Σ pembayaran diterapkan = tagihan (setelah pembulatan tunai bila ada). Tidak ada penjualan "setengah bayar" di MVP (DP/bayar bertahap di luar scope).

**BR-PAY-005 — Referensi non-tunai (`DIUSULKAN`).** Kolom referensi opsional (mis. 4 digit akhir kartu/kode approval/ID transfer), tidak divalidasi. Total non-tunai per metode muncul di rekap shift tetapi **tidak** masuk perhitungan kas laci.

**Contoh 1 (tunai penuh):** Tagihan 112.476 → pembulatan 112.500; tunai diterima 150.000; kembalian **37.500**.

**Contoh 2 (campuran, tunai menyelesaikan):** Tagihan G = 135.655. QRIS 100.000 (exact). Sisa 35.655 dibayar tunai → tunai penyelesai dibulatkan: 356,55 → 357 → **35.700 (rounding +45)**. Tunai diterima 50.000 → **kembalian 14.300**. Total tersimpan: pembayaran 100.000 + 35.700 = 135.700 = G + rounding.

**Contoh 3 (tunai parsial, non-tunai menyelesaikan):** G = 135.655. Tunai 20.000 (parsial, tidak dibulatkan) + QRIS 115.655 (exact). **Tanpa pembulatan**, rounding = 0.

### 7.6 Register & Nomor Invoice (KEP-04)

**BR-INV-001 — Register (`DISEPAKATI`).** Tabel `cash_master` = **register** (device kasir) per outlet. Didaftarkan lewat server saat **online** (device enrollment, BR-AUT-002). Tiap register punya **prefix unik** sehingga nomor antar register tidak bentrok. **Satu register hanya memiliki satu device aktif** (`DISEPAKATI`, revisi 0.96): satu device terikat ke satu register; mengganti device = cabut yang lama lalu enroll yang baru (FLOW-16), karena counter nomor dihitung lokal di device.

**BR-INV-002 — Seri per register tanpa celah (`DISEPAKATI`).** Nomor invoice adalah seri **per register**, **WAJIB berurutan tanpa celah**, urutan **dihitung lokal** di device (counter di Dexie).

**BR-INV-003 — Format nomor invoice (`DISEPAKATI`, jawaban OQ-04 dan revisi user 2026-11-18; aturan prefiks dikonfirmasi user 2026-11-19, OQ-S24).** Format: **`{PREFIKS}-{MMYY}-{URUT6}`**. Contoh: **`OUT01-POS02-1126-000123`** (invoice ke-123 register dengan prefiks `OUT01-POS02` pada periode November 2026). Tidak ada lagi bagian kode register atau awalan outlet yang terpisah: **identitas seri nomor sepenuhnya ada pada prefiks register**.
- **PREFIKS (per register, wajib, unik per tenant):** diatur **per register** (`cash_master`), **wajib diisi** pada register berjenis `KASIR` (register `PELAYAN` tidak menerbitkan invoice sehingga tidak wajib, BR-FNB-011). **Tidak boleh sama dengan prefiks register lain di tenant yang sama** (termasuk riwayat prefiks lama register lain); satu register boleh memakai kembali prefiksnya sendiri. Bentuk (`DISEPAKATI`, OQ-S24): huruf besar dan angka, **boleh tanda hubung di dalam** (tidak di awal/akhir dan tidak berurutan), 2–16 karakter, dan **segmen terakhir tidak boleh `NK`** (agar tidak rancu dengan nota kredit, BR-INV-010). Saran isian awal: `{KODE_OUTLET}-{KODE_REGISTER}` (mis. `OUT01-POS02`), tetapi bebas diubah (mis. `KSR1`). Dua register di satu outlet otomatis berbeda karena prefiks wajib unik.
- **MMYY:** bulan dan tahun (masing-masing 2 digit) dari **`business_date`** (zona waktu dan jam potong outlet, BR-TIM-004), **bukan** jam dinding. *Contoh:* jam potong 04:00 WIB — penjualan 2026-12-01 01:00 memiliki `business_date` 2026-11-30 → `1126`; penjualan 2026-12-01 04:05 → `1226`.
- **URUT6:** 6 digit, berurutan **per register per periode `MMYY`**, **reset ke `000001` setiap pergantian `MMYY`** (keputusan user); wajib tanpa celah dalam tiap (register, `MMYY`); bila melebihi 999999 dalam sebulan menjadi 7 digit.
- Unik per tenant (`tenant_id`, `invoice_no`). Counter lokal di Dexie berkunci pada (register, `MMYY`). Nomor dibaca **dari kanan**: `URUT`, lalu `MMYY` (4 digit), lalu (untuk nota kredit) `NK`; sisanya adalah prefiks.
- **Perubahan prefiks** register berlaku **mulai periode `MMYY` berikutnya** agar format seragam dalam satu seri bulanan (penerbitan baru dipilih menurut `business_date`); prefiks lama tetap tersimpan sebagai riwayat dan tidak dipakai register lain. Kode outlet/register tidak dapat diubah setelah dipakai (BR-TNT-004).
- *Contoh pergantian bulan:* invoice terakhir November register `POS02` = `OUT01-POS02-1126-000731`; invoice pertama Desember = **`OUT01-POS02-1226-000001`**. *Contoh ganti prefiks:* manajer mengubah prefiks `OUT01-POS02` menjadi `KSR2` pada 20 November → invoice 28 November tetap `OUT01-POS02-1126-000732`; invoice pertama Desember = `KSR2-1226-000001`; prefiks `OUT01-POS02` tidak dapat dipakai register lain. Device offline yang jamnya salah di sekitar batas bulan tetap menghasilkan nomor unik dan tanpa celah dalam seri yang dipakainya; hanya periode `MMYY`-nya bisa keliru (diterima).

**BR-INV-004 — Nomor dialokasikan saat finalisasi, atomik (`DIUSULKAN`).** Nomor **tidak** diberikan saat keranjang/open bill dibuat, melainkan saat bayar sukses. Dalam **satu transaksi IndexedDB** device menyimpan: kenaikan counter, `sale`, `sale_line`, `sale_payment`, perintah outbox, dan `print_job`. Jika proses gagal/crash di tengah, transaksi IndexedDB di-rollback → nomor **tidak terpakai** → tidak ada celah. Keranjang yang dibatalkan sebelum bayar **tidak** mengonsumsi nomor.

**BR-INV-005 — Void tidak menghapus nomor (`DISEPAKATI`).** Void mengubah status invoice menjadi **`VOID`**; nomor tetap terpakai dan **tidak pernah dihapus**. Syarat void (`DISEPAKATI`, OQ-11 terjawab): (1) **seluruh** invoice (void parsial dilarang, BR-RTR-005); (2) hanya selama **shift tempat invoice dibuat masih terbuka** di register yang sama; (3) PIN supervisor; (4) alasan wajib; (5) efek dibalik: pembayaran (kas), stok (movement balik **pada biaya snapshot** penjualan itu). Setelah shift ditutup, koreksi hanya melalui **retur/nota kredit**.

**BR-INV-006 — Pencatatan nomor tertinggi (`DISEPAKATI`).** Server mencatat **nomor tertinggi yang diterima per register per periode `MMYY`** (`last_invoice_seq_received`) dan himpunan nomor yang diterima.

**BR-INV-007 — Gap yang dapat diaudit (`DISEPAKATI`).** Nomor lebih kecil dari yang tertinggi (dalam seri register + periode `MMYY` yang sama) yang **tidak pernah diterima** dicatat sebagai **gap** (`invoice_gap`, status `OPEN`). Manager dapat memberi anotasi/penjelasan (`EXPLAINED`) dan tindakan tercatat di audit. **Gap akibat kehilangan device sebelum sync TIDAK dapat dieliminasi total** (risiko residual, RSK-02).

**BR-INV-008 — Pemulihan register (`DISEPAKATI` prinsip; detail `DIUSULKAN`).** Bila device diganti/storage hilang: owner/manager menjalankan "pulihkan register" di back-office → device lama dicabut → device baru dipasangkan ke register yang sama → counter pada periode `MMYY` yang berjalan dimulai dari **nomor tertinggi diterima + 1** pada periode itu (bila periode sudah berganti, seri baru mulai `000001`). Agar gap ujung dapat tercatat, manager **boleh** memasukkan "nomor terakhir pada struk fisik terakhir" bila diketahui; server mencatat gap untuk rentang `(tertinggi_diterima+1 … nomor_dinyatakan)` dengan alasan "kehilangan device" dan counter dilanjutkan dari `nomor_dinyatakan + 1`.

*Contoh (periode `1126`):* Register `OUT01-POS02` menerbitkan 000121–000127 di device lama. Server baru menerima 000121–000124 (125 dst. masih pending). Void terjadi pada 000123 (status `VOID`, nomor tetap). Tablet hilang. Manager memulihkan register: tertinggi diterima = 124; manager mengisi "struk fisik terakhir = 000127". Server membuat **gap 000125–000127** (`EXPLAINED`: kehilangan device). Device baru mulai di **000128**. Bila manager tidak tahu nomor terakhir, device baru mulai di **000125** dan gap ujung tidak terdeteksi (risiko residual).

**BR-INV-009 — Konflik nomor (`DIUSULKAN`).** Jika server menerima perintah dengan nomor yang sudah dipakai oleh penjualan **lain** (mis. device lama yang dicabut muncul kembali dengan antrean pending), penjualan tetap **diterima sebagai fakta** (AP-02) dengan flag `nomor_konflik`, diberi nomor tampilan akhiran `-D1`, `-D2`, dst., dan masuk antrean "perlu perhatian". Pengiriman ulang dengan **idempotency key sama** bukan konflik.

**BR-INV-010 — Nota kredit (`DISEPAKATI` seri sendiri; format `DIUSULKAN`).** Seri nota kredit **sendiri per register**, juga tanpa celah, format **`{PREFIKS}-NK-{MMYY}-{URUT6}`** (prefiks register yang sama dengan invoice, BR-INV-003), mis. `OUT01-POS02-NK-1126-000045`. Penanda **`NK` = Nota Kredit** memakai singkatan bahasa Indonesia dan bersifat tetap (tidak dilokalisasi mengikuti bahasa UI/struk). *Alasan penanda:* seri nota kredit terpisah dari seri invoice tetapi bentuk nomornya sama, sehingga tanpa penanda dua dokumen berbeda dapat bernomor identik (mis. invoice `OUT01-POS02-1126-000045` dan nota kredit `…-1126-000045`) dan membingungkan audit. Reset bulanan dan semua aturan BR-INV-004/006/007/008 berlaku sama.

**BR-INV-011 — Seri per register (`DISEPAKATI` opsi A, OQ-02 terjawab 2026-11-18; konfirmasi auditor tetap disarankan sebelum produksi).** Keputusan: seri **per register**. Belum diverifikasi apakah seri **per register** memenuhi kebutuhan auditor/akuntan. Catatan: yang wajib berurutan tanpa celah biasanya **faktur pajak**, bukan struk kasir; hal ini harus dikonfirmasi pihak berwenang. Faktur pajak di luar MVP.

### 7.7 Shift & Kas (KEP-04)

**BR-SHF-001 — Satu shift per register (`DISEPAKATI`).** Satu register hanya boleh memiliki **satu shift terbuka**. Satu outlet dengan 2 device bisa punya **2 shift paralel**. Entitas: `cash_cashier` (kasir × register × rentang waktu).

**BR-SHF-002 — Buka shift (`DISEPAKATI`).** Kasir login PIN → mengisi **modal awal** (integer rupiah) → shift `OPEN`. Dapat dilakukan **offline**.

**BR-SHF-003 — Pergantian kasir (`DISEPAKATI`).** Pergantian kasir di device yang sama = **tutup shift lalu buka shift baru**.

**BR-SHF-004 — Kas masuk/keluar (`DISEPAKATI`).** Dicatat dengan nominal dan alasan wajib; bisa offline; masuk ke audit log.

**BR-SHF-005 — Tutup shift & blind count (`DISEPAKATI`).** Saat tutup, kasir **menghitung uang fisik tanpa melihat angka sistem** (blind count). Selisih kas dicatat. Dapat dilakukan **offline**.
Rumus (server dan client sama):
`kas_diharapkan = modal_awal + Σ tunai_diterapkan_penjualan + Σ kas_masuk − Σ kas_keluar − Σ refund_tunai`
`selisih = kas_dihitung − kas_diharapkan` (negatif = kurang).
`tunai_diterapkan` = tunai diterima − kembalian, **sudah termasuk pembulatan tunai** (BR-TAX-009). Void pada shift yang sama membatalkan kontribusi invoicenya.

*Contoh:* Modal awal 500.000 · tunai penjualan diterapkan 1.250.000 · kas masuk 200.000 · kas keluar 150.000 (beli es batu) · refund tunai 17.900 (NK-1126-000001).
Kas diharapkan = 500.000 + 1.250.000 + 200.000 − 150.000 − 17.900 = **1.782.100**. Kasir menghitung **1.780.000** → **selisih = −2.100** (kurang). Pada rekap tercantum terpisah: QRIS 830.000 dan Transfer 300.000 (tidak masuk kas laci).

**BR-SHF-006 — Visibilitas selisih (`DISEPAKATI`, OQ-15 terjawab).** Selama menghitung, kasir **tidak** melihat kas diharapkan (blind count). **Setelah hitungan disubmit**, kasir **boleh melihat** kas diharapkan dan selisih shift yang baru ia tutup; hitungan **terkunci** setelah submit (tidak dapat diubah) agar blind count tetap bermakna. Laporan selisih shift lain/riwayat memerlukan permission `shift.view_variance` (Manager/Owner/Supervisor/Akuntan). *Contoh:* kasir Dewi menyimpan hitungan 1.780.000 → layar menampilkan diharapkan 1.782.100 dan selisih −2.100.

**BR-SHF-007 — Shift & open bill (`DIUSULKAN`).** Shift boleh ditutup walau ada open bill (peringatan ditampilkan). Open bill tetap dimiliki device (lease) dan dapat dibayar pada shift berikutnya di register yang sama. Pembayaran tercatat di shift **saat pembayaran terjadi**.

**BR-SHF-008 — Konsistensi server (`DIUSULKAN`).** Server menghitung ulang `kas_diharapkan` setelah semua perintah shift diterima. Selama masih ada perintah pending dari register itu, rekap shift berstatus **"belum lengkap"**.

**BR-SHF-009 — Tutup shift darurat (`DISEPAKATI`, OQ-15 terjawab).** Bila device hilang/rusak dan shift tidak pernah tertutup, manager (online) dapat **menutup shift darurat** (`FORCE_CLOSED`) dengan memasukkan hitungan kas manual + alasan; dicatat audit. Ini hanya untuk **shift**, tidak terkait larangan tutup paksa **open bill** (BR-FNB-004).

**BR-SHF-010 — Tanpa shift tidak ada transaksi (`DIUSULKAN`).** Checkout, pembuatan open bill, pembayaran, retur dengan refund tunai, dan kas masuk/keluar mensyaratkan shift terbuka pada register itu. **Pengecualian (`DISEPAKATI`, BR-FNB-011):** register berjenis **`PELAYAN`** tidak memerlukan shift untuk membuat/mengubah open bill, void item, pra-bill, dan serah-terima; register `PELAYAN` tidak memiliki shift, pembayaran, kas, maupun retur. Pembayaran bill yang diterima dari serah-terima tetap butuh shift terbuka di register kasir penerima.

### 7.8 Retur, Refund & Nota Kredit (KEP-04)

**BR-RTR-001 — Dokumen terpisah (`DISEPAKATI`).** Retur/refund **wajib merujuk invoice asal** dan menghasilkan dokumen **nota kredit** dengan seri sendiri per register (BR-INV-010). Invoice asal **tidak diubah**.

**BR-RTR-002 — Persetujuan (`DISEPAKATI`).** Wajib **PIN supervisor** (diverifikasi lokal, dicatat di audit: siapa yang menyetujui) dan alasan.

**BR-RTR-003 — Jendela retur (`DISEPAKATI`).** **3 bulan** (= retensi lokal). Dihitung sebagai 3 bulan **kalender** dari `business_date` invoice (`DIUSULKAN`); bila tanggal tidak ada di bulan tujuan dipakai hari terakhir bulan itu. *Contoh:* invoice `business_date` 2026-08-31 → batas retur **2026-11-30**; invoice 2026-08-15 → batas 2026-11-15.

**BR-RTR-004 — Offline vs online (`DISEPAKATI`).** Offline hanya untuk invoice yang **ada di device itu**. Invoice dari **register lain** di outlet yang sama, atau di luar retensi lokal, **butuh online** (device mengambil invoice dari server). Retur lintas outlet: tidak didukung MVP (`DIUSULKAN`).

**BR-RTR-005 — Void parsial dilarang (`DISEPAKATI`).** Void parsial yang mengubah invoice asal **DILARANG**; retur parsial hanya lewat nota kredit.

**BR-RTR-006 — Perhitungan nilai retur (`DIUSULKAN`).** Dari angka **tersimpan** pada baris invoice (tidak dihitung ulang): untuk retur `q` dari `Q` terjual, tiap komponen (neto setelah diskon & alokasi, alokasi SC, alokasi pajak) = `R(komponen_baris × q / Q)`. **Retur yang menghabiskan sisa kuantitas baris (retur terakhir) mengambil sisa komponen** (komponen asli − yang sudah diretur) agar total retur kumulatif = nilai asli.

*Contoh 1 (dari Bab 7.4 Contoh 1 & 5):* Invoice `OUT01-POS02-1126-000123` (total 112.476). Retur **1 dari 3 Susu UHT**: neto baris 48.330 → 48.330 × 1/3 = **16.110**; alokasi pajak 5.316 → 5.316 × 1/3 = **1.772**; refund = 17.882. Refund tunai dibulatkan ke kelipatan Rp100 outlet: **17.900** (rounding +18, dicatat terpisah). Nota kredit `OUT01-POS02-NK-1126-000001`.
*Contoh 2 (sisa pada retur terakhir):* baris 3 unit bernilai neto Rp10.000. Retur 1 unit = R(3.333,33) = 3.333; retur ke-2 = 3.333; retur ke-3 (terakhir) = 10.000 − 6.666 = **3.334**. Σ = 10.000.

**BR-RTR-007 — Metode & kas (`DISEPAKATI`: tunai atau sesuai metode asal; OQ-19 terjawab).** Refund dapat dibayarkan tunai (dari laci shift berjalan; mengurangi `kas_diharapkan`) atau mengikuti metode non-tunai asal yang dicatat manual. Mensyaratkan shift terbuka (BR-SHF-010).

**BR-RTR-008 — Dampak stok & HPP (`DISEPAKATI`: biaya snapshot penjualan; OQ-07 terjawab).** Per baris nota kredit dipilih **disposisi**: `KEMBALI_STOK` — barang masuk stok **pada biaya snapshot penjualan asal** (nilai = `R(HPP_baris × q/Q)`, retur terakhir mengambil sisa); atau `BUANG` — tidak ada stok masuk (barang rusak/dimusnahkan; nilai persediaan tidak berubah, kerugian tercatat). Default: **retail = `KEMBALI_STOK`**, **menu F&B ber-resep = `BUANG`** (bahan sudah terpakai).
*Contoh:* 7 pcs terjual, HPP baris tercatat server **57.458** (lihat Bab 7.11, baris 4). Retur 1 pcs `KEMBALI_STOK` → nilai masuk = R(57.458 × 1/7) = R(8.208,29) = **8.208**; qty +1. Retur seluruh 7 pcs bertahap: retur terakhir mengambil sisa nilai (57.458 − nilai yang sudah masuk). Efek pada saldo: lihat BR-HPP-007.

**BR-RTR-009 — Batasan (`DIUSULKAN`).** Retur kumulatif atas baris ≤ kuantitas terjual; invoice berstatus `VOID` tidak dapat diretur; nota kredit memakai `business_date` saat dibuat; laporan penjualan neto = penjualan − retur menurut `business_date` masing-masing dokumen.

### 7.9 Autentikasi, Otorisasi & Perangkat (KEP-05)

**BR-AUT-001 — Back-office (`DISEPAKATI`; model identitas global: user 2026-11-19, BR-IDN).** Better Auth dengan plugin *organization*: **satu email = satu akun global** (email **unik se-sistem**, satu password) dengan **keanggotaan per tenant** berperan; login **hanya dengan email + password** (tanpa username); login tetap **di-scope slug** dan setelah autentikasi server memeriksa keanggotaan akun pada tenant slug itu (BR-IDN-002). **Menggantikan** model "akun terpisah per tenant" (rev. 1.01/1.03) dan dukungan username (rev. 0.96). Staf tanpa email (mis. kasir) **tidak memiliki akun back-office**: mereka hanya memakai **PIN di terminal** (BR-AUT-003). Tanpa email di MVP: tanpa pengiriman/verifikasi email dan tanpa "Lupa kata sandi" mandiri (BR-IDN-003).

**BR-AUT-002 — Device enrollment (`DISEPAKATI`; parameter `DIUSULKAN`).** Owner/manager membuat register dan **kode pairing** di back-office (online). Kode: sekali pakai, 8 karakter, kedaluwarsa 15 menit; dapat dipindai dari **QR** (alamat `<DOMAIN>/<slug>/pos` + kode pada fragmen `#`, BR-TEN-007) **atau diketik manual**. Device memasukkan kode → server menerbitkan **device credential berumur panjang** (usulan 180 hari bergulir, diperbarui tiap sync sukses) yang **bisa dicabut**. Enrollment hanya bisa online.

**BR-AUT-003 — Login staf (`DISEPAKATI`).** Staf memilih namanya lalu memasukkan **PIN 4–6 digit** (`DIUSULKAN`: pemilihan nama, sehingga PIN tidak perlu unik antar staf).

**BR-AUT-004 — Penyimpanan PIN (`DISEPAKATI`).** Hash lambat (PBKDF2 / Argon2 WASM) dengan **salt per device**; hash + permission disinkron ke device. Target waktu verifikasi 250–500 ms di tablet kelas menengah (`DIUSULKAN`; parameter KDF dikalibrasi saat implementasi).

**BR-AUT-005 — Batas percobaan (`DISEPAKATI` keberadaan; angka `DIUSULKAN`; anti-manipulasi: user 2026-11-18/19, BR-RLM-010).** 5 kegagalan berturut-turut → terkunci 5 menit; 5 kegagalan berikutnya → 15 menit; total 15 kegagalan → terkunci sampai **reset oleh supervisor/manager** (yang berizin). Penghitung disimpan lokal dan ikut disinkron. **Hitungan percobaan bersifat monotonik** (hanya naik sampai di-reset, dicatat **sebelum** PIN diverifikasi); **jeda memakai jam monotonik** yang **tidak dapat dimundurkan lewat tanggal tablet** (BR-AUT-013); **reset total** hanya oleh supervisor/manager; status **dilaporkan ke server saat online**. Ini **bukan** perlindungan terhadap penyerang mahir yang memegang perangkat (BR-AUT-014): serangan itu dilawan hash lambat + HMAC per device, bukan penghitung.

**BR-AUT-006 — Aksi sensitif (`DISEPAKATI`).** Void, diskon di atas batas role, refund/retur, dan override lainnya butuh **PIN supervisor yang diverifikasi lokal** dan **dicatat di audit log, termasuk siapa penyetujunya**.

**BR-AUT-007 — Penyetuju ≠ peminta (`DIUSULKAN`).** Penyetuju harus pengguna **berbeda** dari peminta dan memiliki permission + batas yang memadai.

**BR-AUT-008 — Lease offline 7 hari (`DISEPAKATI`).** Setelah **7 hari** tanpa sync sukses, device **terkunci** (tidak ada login/transaksi baru) sampai sync berhasil. Peringatan muncul 24 jam sebelumnya (`DIUSULKAN`). Antrean pending tetap dapat diekspor saat terkunci. Satu "sync sukses" = push tanpa kegagalan transien + pull selesai.

**BR-AUT-009 — Matriks permission default (`DISEPAKATI` sebagai default, OQ-05 terjawab).** `Y` = boleh; `B` = boleh sampai batas diskon role; `—` = tidak.

| Permission | Owner | Manager | Supervisor | Kasir | Waiter | Gudang | Akuntan |
|---|---|---|---|---|---|---|---|
| Buat transaksi (retail) / bayar | Y | Y | Y | Y | — | — | — |
| Buat/ubah open bill, tambah item | Y | Y | Y | Y | Y | — | — |
| Serahkan bill ke kasir (di register `PELAYAN` atau `KASIR`) / terima bill (hanya di register `KASIR`), BR-FNB-012 | Y | Y | Y | Y (terima) | Y (serahkan) | — | — |
| `screen.unlock_override` (buka kunci layar oleh bukan staf yang sama, hanya untuk pergantian kasir; BR-AUT-015) | Y | Y | Y | — | — | — | — |
| Void item pada open bill (sebelum bayar, wajib alasan) | Y | Y | Y | Y | Y | — | — |
| Diskon manual | Y | B | B | B | — | — | — |
| `discount.approve` (setujui di atas batas) | Y | Y | Y | — | — | — | — |
| Void invoice | Y | Y | Y | — | — | — | — |
| Retur / nota kredit (`return.approve`) | Y | Y | Y | — | — | — | — |
| Buka/tutup shift sendiri | Y | Y | Y | Y | — | — | — |
| Kas masuk/keluar | Y | Y | Y | Y | — | — | — |
| `shift.view_variance` (laporan selisih shift lain/riwayat; kasir selalu melihat selisih shift miliknya setelah submit, BR-SHF-006) | Y | Y | Y | — | — | — | Y |
| Tutup shift darurat, anotasi gap | Y | Y | — | — | — | — | — |
| Kelola master & harga (online) | Y | Y | — | — | — | — | — |
| GR, transfer, opname (online) | Y | Y | — | — | — | Y | — |
| Kelola anggota (peran, penugasan outlet, nonaktifkan), reset PIN, device | Y | Y* | — | — | — | — | — |
| Undang anggota, kelola undangan tertunda (batalkan/terbitkan ulang), keluarkan anggota, terbitkan kode reset password akun tenant (BR-IDN-004/005/006/015) | Y | — | — | — | — | — | — |
| Lihat laporan | Y | Y | — | — | — | Y | Y |
| Lihat audit log | Y | Y | — | — | — | — | Y |

`Y*` Manager hanya untuk outlet yang ditugaskan. Void item pada open bill sebelum bayar **tanpa PIN supervisor, alasan wajib** (OQ-17 terjawab; BR-FNB-008).

**BR-AUT-010 — Pencabutan berlaku saat online (`DISEPAKATI`).** Pencabutan akses (staf keluar, device hilang) **baru berlaku saat device online lagi**; selama offline, device/staf yang dicabut masih bisa bekerja hingga batas lease 7 hari. Konsekuensi diterima (RSK-05); mitigasi: batas 7 hari + audit.

**BR-AUT-011 — Enkripsi IndexedDB (`DISEPAKATI`).** Tidak termasuk MVP; dicatat sebagai risiko tablet dicuri (RSK-05).

**BR-AUT-012 — Permission dapat dikonfigurasi (`DISEPAKATI`).** Role dan permission (termasuk batas diskon per role) dikonfigurasi per tenant; perubahan tercatat di audit dan disinkron ke device (efektif saat device sync).

**BR-AUT-013 — Deteksi jam mundur (`DIUSULKAN`).** Device menyimpan waktu tertinggi yang pernah teramati (`max_seen_time`). Bila jam device < `max_seen_time` − 5 menit, device dianggap dimanipulasi dan **dikunci sampai sync** (BR-TIM-006). Lease 7 hari diukur dengan waktu terkoreksi (server time terakhir + waktu berjalan monotonik).

**BR-AUT-014 — Risiko residual PIN (`DIUSULKAN`).** Ruang PIN 4–6 digit kecil; bila hash di IndexedDB diekstrak, dapat di-brute-force offline. Mitigasi hanya hash lambat + salt per device; diterima bersama RSK-05.

**BR-AUT-015 — Kunci layar otomatis (idle-lock) (`DISEPAKATI`: 10 menit; state tidak hilang; timer berhenti saat pembayaran/dialog PIN supervisor — keputusan user, DOQ-14; pembuka kunci, permission override, penyimpanan draf, dan audit: `DISEPAKATI`, OQ-S19..S23).**
1. **Kunci otomatis setelah 10 menit tanpa aktivitas** (sentuhan, tombol, atau scan) di `/pos`: layar kembali ke pilih staf + PIN (BR-AUT-003). **Kunci manual** juga tersedia pada menu pengguna. Berbeda dari penguncian device akibat lease offline (BR-AUT-008).
2. **Tidak ada yang hilang:** shift, keranjang, open bill, dan input yang sedang diisi tersimpan lokal; **draf keranjang disimpan lokal dan tidak disinkron ke server**; setelah PIN benar kerja dilanjutkan di titik yang sama.
3. **Pengatur waktu berhenti sementara** saat **pembayaran sedang berlangsung** atau **dialog PIN supervisor terbuka**, dan mulai lagi setelah selesai.
4. **Siapa yang boleh membuka kunci:** **staf yang sama** (yang sesinya aktif saat terkunci). Bila staf itu tidak ada, pengguna dengan permission **`screen.unlock_override`** (**Supervisor, Manager, Owner**) dapat membuka dengan PIN-nya **hanya untuk pergantian kasir (tutup shift)** — bukan untuk melanjutkan keranjang atau transaksi atas nama orang lain. Draf keranjang milik staf yang digantikan **dibuang** saat shift ditutup (belum bernomor, tanpa efek keuangan); open bill F&B tetap dimiliki device.
5. **Audit:** hanya **override supervisor** (pembukaan oleh bukan staf yang sama, termasuk draf yang dibuang) dan **penguncian karena PIN salah berulang** (BR-AUT-005) yang masuk audit log; kunci/buka biasa oleh staf yang sama **tidak** diaudit (hanya log operasional, BR-LOG).
6. Seluruhnya bekerja **offline** (PIN diverifikasi lokal); percobaan PIN salah memakai penghitung BR-AUT-005.
*Contoh:* kasir Dewi mengisi keranjang 3 item lalu idle 10 menit → layar PIN; PIN benar → keranjang utuh. Saat ia meminta diskon Rp7.000 dan dialog PIN supervisor terbuka, pengatur waktu berhenti. Lain waktu Dewi pulang dengan layar terkunci; Supervisor Budi membuka dengan PIN-nya: hanya "Tutup shift" tersedia; ia menghitung kas (blind) dan menutup shift Dewi; draf keranjang Dewi dibuang; audit mencatat "override buka kunci oleh Budi, shift Dewi ditutup, 1 draf dibuang".

### 7.10 Stok & Ledger (KEP-08)

**BR-STK-001 — Ledger append-only (`DISEPAKATI`).** Seluruh perubahan stok dicatat di ledger `stock_movements` (tidak pernah di-UPDATE/DELETE). **Saldo** (`qty`, `nilai persediaan`) per (SKU, outlet) diperbarui **dalam transaksi yang sama** dengan penulisan movement, memakai row lock pada baris saldo.

**BR-STK-002 — Stok minus diizinkan (`DISEPAKATI`).** Penjualan yang sudah terjadi di dunia nyata tidak dapat ditolak server. Saldo boleh negatif, diberi **flag/peringatan** untuk manager (laporan stok minus, penanda di dashboard), dan diselesaikan lewat **opname/penyesuaian**.
*Contoh:* saldo SKU Kopi di OUT01 = 3 pcs. Dua device offline masing-masing menjual 2 dan 3 pcs → saldo **−2** dan flag "stok minus". Manager melakukan opname, fisik 0 → penyesuaian +2.

**BR-STK-003 — Konsumsi saat bayar (`DISEPAKATI`).** Pengurangan stok (dan konsumsi resep) terjadi **saat bill dibayar** (finalisasi), **bukan saat dipesan**. Item yang di-void sebelum bayar **tidak** mempengaruhi stok.

**BR-STK-004 — Aktivasi per outlet (`DIUSULKAN`).** Pelacakan stok diaktifkan per outlet (`inventory_enabled_at`) dan per produk (`track_stock`). Penjualan sebelum aktivasi tidak membuat movement. Ini membuat Fase F3 (POS tanpa stok) dan F4 (stok & HPP) berjalan bertahap; saldo awal diisi via opname/GR.

**BR-STK-005 — Snapshot stok di POS (`DISEPAKATI`; tampilan `DIUSULKAN`).** Stok per outlet di POS berupa **snapshot terpisah** (bukan feed berversi) dengan waktu acuan server. Tampilan stok = *snapshot − penjualan lokal yang belum tercermin pada snapshot* (estimasi, informasional). Estimasi ≤ 0 menampilkan **peringatan non-blokir** (penjualan tetap boleh).
*Contoh:* snapshot 08:00 SKU Susu = 20 pcs. Hingga 10:00 device menjual 6 pcs → tampil estimasi **14 pcs**.

**BR-STK-006 — Waktu & urutan (`DIUSULKAN`).** Movement menyimpan `occurred_at` (waktu transaksi terkoreksi), `processed_at` (waktu server), `business_date`. Perhitungan biaya mengikuti **urutan proses server** per (SKU, outlet) di bawah row lock (BR-HPP-004).

**BR-STK-007 — Jenis movement (`DIUSULKAN`).** `SALE`, `SALE_VOID`, `RETURN_IN`, `GR_IN`, `GR_REVERSAL`, `TRANSFER_OUT`, `TRANSFER_IN`, `ADJUSTMENT` (opname), `RECIPE_CONSUMPTION`.

**BR-STK-008 — Satuan (`DISEPAKATI`).** Semua `qty_delta` dalam **base UOM** (BR-UOM-001).

### 7.11 HPP — Moving Average per Outlet (KEP-08)

**BR-HPP-001 — Metode & tempat hitung (`DISEPAKATI`).** Moving average **per outlet** (per SKU), dihitung **di server dari ledger**, bukan di device.

**BR-HPP-002 — Yang disimpan (`DISEPAKATI`).** `nilai_persediaan` (integer rupiah) dan `kuantitas` (decimal). **Biaya rata-rata = nilai ÷ kuantitas dihitung saat dibutuhkan, tidak disimpan sebagai angka otoritatif.**

**BR-HPP-003 — Rumus (`DISEPAKATI` prinsip).**
- Masuk (GR): `qty += q_in`; `nilai += nilai_in` (rata-rata bergeser).
- Keluar sejumlah `q_out` saat saldo `qty > 0`: `HPP = R(nilai × q_out / qty)`; `qty −= q_out`; `nilai −= HPP`.
- **Saat `qty` menjadi nol, nilai dipaksa nol:** bila `q_out = qty` maka `HPP = nilai` (seluruh sisa), sehingga tidak ada sisa pecahan menggantung.
- HPP penjualan **dibulatkan ke integer saat dicatat** dan disimpan di baris penjualan (`cost_snapshot`).

*Contoh berangka (SKU Susu, outlet OUT01):*

| # | Kejadian | qty | nilai | Rata-rata | HPP dicatat |
|---|---|---|---|---|---|
| 0 | Awal | 0 | 0 | — | — |
| 1 | GR 100 pcs @ Rp8.000 = 800.000 | 100 | 800.000 | 8.000 | — |
| 2 | Jual 30 pcs → R(800.000×30/100) | 70 | 560.000 | 8.000 | **240.000** |
| 3 | GR 50 pcs @ Rp8.500 = 425.000 | 120 | 985.000 | 8.208,33 | — |
| 4 | Jual 7 pcs → R(985.000×7/120) = R(57.458,33) | 113 | 927.542 | 8.208,34 | **57.458** |
| 5 | Jual 113 pcs (habis) → HPP = seluruh sisa nilai | 0 | **0** | — | **927.542** |

**BR-HPP-004 — Penjualan offline yang tiba telat (`DISEPAKATI`).** Biaya yang dipakai adalah biaya rata-rata pada saat **server memproses**, **bukan** saat dijual dan **bukan backdate**. Konsekuensi: HPP bisa berbeda dari yang "seharusnya" jika ada GR di antara waktu jual dan waktu proses.
*Contoh:* 14:00 device offline menjual 10 pcs; saat itu saldo server 70 pcs / 560.000 (rata-rata 8.000 → HPP semestinya 80.000). 15:00 GR 50 pcs @8.500 → 120 pcs / 985.000. 16:00 penjualan tiba: HPP = R(985.000×10/120) = R(82.083,33) = **82.083**, selisih **+2.083** dari 80.000. Saldo menjadi 110 pcs / 902.917. Selisih ini bersifat diterima dan terlihat konsisten di ledger (`occurred_at` 14:00, `processed_at` 16:00).

**BR-HPP-005 — Biaya saat stok tidak mencukupi (`DISEPAKATI`: biaya referensi; OQ-12 terjawab 2026-11-18, konfirmasi akuntan tetap disarankan).** Saldo menyimpan juga **biaya referensi** (biaya rata-rata terakhir saat saldo masih positif). Keluar `q_out` ketika `qty < q_out`: bagian yang tertutup stok memakai rumus BR-HPP-003 (habiskan nilai), bagian kekurangan dihargai `R(kekurangan × biaya_referensi)`; saldo menjadi negatif (qty dan nilai). Masuk non-pembelian (penyesuaian/retur) saat `qty ≤ 0` dihargai biaya referensi.
*Contoh:* saldo 3 pcs / 24.000 (referensi 8.000). Jual 5 pcs: 3 pcs menghabiskan nilai **24.000** + 2 pcs × 8.000 = **16.000** → HPP **40.000**; saldo **−2 pcs / −16.000**. GR 20 pcs @9.000 = 180.000 → saldo **18 pcs / 164.000** (rata-rata 9.111,11); kekurangan terbayar dengan biaya lama 8.000.

**BR-HPP-006 — Resep (`DISEPAKATI`).** HPP menu = Σ (qty bahan × biaya rata-rata bahan) saat terjual (BR-RCP-003).

**BR-HPP-007 — Retur (`DISEPAKATI`, OQ-07 terjawab).** Retur `KEMBALI_STOK` masuk pada **biaya snapshot** penjualan asal (BR-RTR-008).
*Contoh:* lanjutan baris 4 di atas — baris penjualan 7 pcs dengan HPP tercatat 57.458 diretur 1 pcs (`KEMBALI_STOK`): nilai masuk = R(57.458 × 1/7) = R(8.208,29) = **8.208**; saldo (113 pcs / 927.542) → **114 pcs / 935.750**. Rata-rata bergeser sangat kecil (8.208,34 → 8.208,33).

**BR-HPP-008 — Laba kotor (`DISEPAKATI`).** Laporan laba kotor **tidak** masuk MVP; HPP baris tetap disimpan sehingga laporan murah ditambahkan kelak.

### 7.12 Transfer Antar Outlet (KEP-08)

**BR-TRF-001 — Dua langkah in-transit (`DISEPAKATI`).** Status: `DRAFT` → `SENT` (in-transit) → `RECEIVED`; `CANCELED` hanya dari `DRAFT`.

**BR-TRF-002 — Pengiriman (`DISEPAKATI`).** Stok **keluar dari outlet asal** dengan **biaya rata-rata saat itu** (`TRANSFER_OUT`); nilai tersebut tercatat sebagai persediaan **dalam perjalanan** (qty & nilai), bukan bagian saldo outlet mana pun. Dokumen `SENT` tidak dapat diubah.

**BR-TRF-003 — Penerimaan (`DISEPAKATI`).** Stok **masuk di outlet tujuan dengan biaya per unit yang sama** (`TRANSFER_IN`). **Selisih kirim vs terima dicatat** sebagai `selisih_transfer` (qty dan nilai), bukan sebagai persediaan.
Rumus: `nilai_masuk = R(nilai_kirim × qty_terima / qty_kirim)`; `selisih_nilai = nilai_kirim − nilai_masuk`.

**BR-TRF-004 — Aturan lanjutan (`DISEPAKATI` untuk penerimaan satu kali & kelebihan lewat opname, OQ-14 terjawab; sisanya `DIUSULKAN`).** Satu kali penerimaan per transfer; `qty_terima ≤ qty_kirim` (kelebihan fisik diselesaikan lewat opname); transfer `SENT` yang barangnya tidak pernah tiba ditutup manager dengan `qty_terima = 0` + alasan; dilakukan online di `/admin`; pengirim dan penerima dicatat (audit).

*Contoh:* Outlet A: SKU Susu 120 pcs / 985.000. **Kirim 40 pcs ke B**: nilai_kirim = R(985.000 × 40/120) = R(328.333,33) = **328.333** → A: **80 pcs / 656.667**; in-transit 40 pcs / 328.333.
Outlet B sebelumnya 10 pcs / 90.000 (rata-rata 9.000). **B menerima 38 pcs** (2 rusak): nilai_masuk = R(328.333 × 38/40) = R(311.916,35) = **311.916** → B: **48 pcs / 401.916**. Selisih transfer: **2 pcs, Rp16.417** (= 328.333 − 311.916), dicatat sebagai selisih (terlihat manager).

### 7.13 Penerimaan Barang & Opname (KEP-08)

**BR-STK-020 — Goods receipt (`DISEPAKATI` sebagai sumber HPP; detail `DIUSULKAN`).** Dokumen `DRAFT` → `POSTED`. Baris: SKU, UOM, qty, biaya per UOM (atau total baris). `nilai_baris = R(qty × biaya_per_UOM)` bila diisi per UOM; `qty_dasar = qty × faktor`. Posting menaikkan saldo dan menggeser rata-rata. **Nomor dokumen** (GR, transfer, opname; `DISEPAKATI` revisi 0.96): `{JENIS}-{KODE_OUTLET}-{MMYY}-{URUT4}`, jenis `GR`/`TRF`/`OPN` (mis. `GR-OUT01-1126-0001`); `MMYY` dari `business_date` dokumen; urut per outlet per jenis per bulan, diberikan server; **tidak wajib tanpa celah**.
*Contoh:* Terima **5 dus** Susu (faktor 12) @ Rp96.000 → nilai 480.000, qty dasar **60 pcs** → biaya dasar 8.000/pcs. Saldo sebelumnya 0 → 60 pcs / 480.000.

**BR-STK-021 (`DIUSULKAN`).** Biaya GR dimasukkan sebagai **biaya persediaan bersih** (pajak masukan tidak dihitung di MVP). Pemasok bersifat referensi sederhana (nama, kontak); PO/hutang di luar scope.

**BR-STK-022 — Koreksi GR (`DIUSULKAN`).** GR `POSTED` tidak dapat diubah. Kesalahan dikoreksi dengan dokumen **koreksi (reversal)** oleh manager yang membuat movement berlawanan pada qty dan nilai GR asal (`GR_REVERSAL`); bila stok tidak cukup, saldo dapat negatif dan diberi flag.

**BR-STK-030 — Opname/penyesuaian (`DISEPAKATI`; detail `DIUSULKAN`).** Dokumen opname menyimpan `snapshot_qty` per SKU saat penghitungan dimulai; manager/gudang mengisi `counted_qty`. `delta = counted_qty − snapshot_qty`. Posting membuat movement `ADJUSTMENT` sebesar delta: delta negatif bernilai `R(nilai × |delta| / qty)` (bila `|delta| = qty`, seluruh nilai); delta positif bernilai `R(nilai × delta / qty)` (atau biaya referensi bila `qty ≤ 0`).

**BR-STK-031 — Penjualan selama opname tidak dibekukan (`DIUSULKAN`).** Karena memakai delta terhadap snapshot, penjualan yang terjadi sesudah penghitungan tidak hilang.
*Contoh:* snapshot 80, fisik 77 → delta **−3**. Sebelum posting terjual 5 pcs sehingga saldo 75. Setelah posting saldo = 75 − 3 = **72**.

**BR-STK-032 — Contoh nilai (`DIUSULKAN`).** Saldo A setelah transfer: 80 pcs / 656.667.
- Delta **−3**: nilai = R(656.667 × 3/80) = R(24.625,01) = **24.625** → 77 pcs / **632.042**.
- Delta **+5** (ditemukan lebih): nilai = R(656.667 × 5/80) = R(41.041,69) = **41.042** → 85 pcs / **697.709**.
- Saldo minus: −2 pcs / −16.000 (referensi 8.000). Fisik **0** → delta +2 → qty 0 → **nilai dipaksa 0** (movement bernilai +16.000). Fisik **5** → delta +7, nilai = 7 × 8.000 = 56.000 → **5 pcs / 40.000**.

**BR-STK-033 (`DIUSULKAN`).** GR, transfer, opname dilakukan online di `/admin`, tercatat audit; opname dan koreksi memerlukan permission khusus (BR-AUT-009).

### 7.14 Resep / BOM F&B (KEP-08)

**BR-RCP-001 — Satu level (`DISEPAKATI`).** Menu → bahan baku. Bahan setengah jadi/produksi dan faktor susut (yield/waste) **ditunda**.

**BR-RCP-002 (`DIUSULKAN`).** Kuantitas bahan per **1 porsi** menu dinyatakan dalam **base UOM bahan**.

**BR-RCP-003 — HPP menu (`DISEPAKATI`).** `HPP_baris = Σ_bahan R(nilai_bahan × qty_konsumsi / qty_saldo_bahan)` saat terjual (server), dihitung per bahan dengan aturan BR-HPP-003 lalu dijumlahkan. Urutan penerapan dalam satu transaksi: baris berurutan, bahan berurutan menurut ID (deterministik).

**BR-RCP-004 — Modifier (`DISEPAKATI`).** Modifier dapat **menambah** bahan, **mengganti** bahan, atau **mengurangi/menghapus** bahan. `konsumsi = (resep + Σ penyesuaian modifier) × qty_porsi`.

**BR-RCP-005 (`DISEPAKATI`).** Konsumsi resep terjadi **saat bill dibayar** (BR-STK-003) sebagai movement `RECIPE_CONSUMPTION` per bahan.

**BR-RCP-006 (`DIUSULKAN`).** Menu tanpa resep tidak menghasilkan konsumsi/HPP dan diberi flag "tanpa resep" di laporan. Perubahan resep berlaku ke depan; penjualan offline telat memakai resep yang berlaku saat server memproses.

*Contoh:* Resep 1 porsi **Nasi Goreng**: Beras 150 g · Telur 1 butir · Minyak 20 ml · Kecap 10 ml. Saldo: Beras 25.000 g / 350.000 (14/g) · Telur 120 / 228.000 (1.900/butir) · Minyak 8.000 ml / 112.000 (14/ml) · Kecap 5.000 ml / 40.000 (8/ml).
- **2 porsi:** Beras 300 g = R(350.000×300/25.000) = **4.200**; Telur 2 = R(228.000×2/120) = **3.800**; Minyak 40 ml = **560**; Kecap 20 ml = **160** → **HPP baris = 8.720** (4.360/porsi).
- **1 porsi + modifier "Extra Telur" (+Rp5.000, +1 butir) dan "Tanpa Kecap"** (saldo awal yang sama): Beras 150 g = **2.100**; Telur 2 butir = **3.800**; Minyak 20 ml = **280**; Kecap 0 → **HPP = 6.180**; harga baris 35.000 + 5.000 = 40.000.
Pembulatan dilakukan per movement; selisih antar jalur hitung maksimal Rp1 per movement.

### 7.15 F&B: Meja, Open Bill, Lease (KEP-12)

**BR-FNB-001 — Meja (`DISEPAKATI`).** Master meja (kode, area, kapasitas) dikelola online. Status meja **diturunkan**: **kosong** bila tidak ada bill `OPEN`; **terisi** bila ada ≥ 1 open bill; **menunggu bayar** bila seluruh bill `OPEN` pada meja itu telah dicetak/ditampilkan pra-billnya (BR-FNB-010) (berdasarkan data yang diketahui device/snapshot).

**BR-FNB-002 — Open bill & nomor bill (`DISEPAKATI`; nomor `DIUSULKAN`).** Pesanan dibuat sebagai **open bill** pada sebuah meja. Open bill **bukan dokumen akuntansi**: nomor tampilan (`bill_ref`, mis. `M05-0003`) hanya identitas operasional, tidak perlu tanpa celah, dan **tidak** mengonsumsi nomor invoice (BR-INV-004).

**BR-FNB-003 — Lease satu device (`DISEPAKATI`).** Open bill **dimiliki SATU device** (device pembuat) lewat lease; **hanya pemegang yang boleh mengedit**; device lain **read-only** (melihat lewat snapshot open bill per outlet — data bisa terlambat, ditandai waktu terakhir diperbarui). Kepemilikan terikat pada **device**, bukan staf: semua staf yang login di device itu dapat mengedit; event mencatat staf yang bertindak. Lease **tidak berkedaluwarsa** dan **hanya dapat berpindah lewat serah-terima sukarela oleh pemegang yang diterima register tujuan** (BR-FNB-012); tidak ada cara lain.

**BR-FNB-004 — Tanpa take-over, tanpa tutup paksa (`DISEPAKATI`).** Tidak ada mekanisme mengambil alih atau menutup paksa open bill milik device lain, dalam bentuk apa pun. **Serah-terima sukarela oleh pemegang (BR-FNB-012) bukan take-over:** inisiatif dan persetujuan ada pada pemegang, dan device lain tidak dapat mengambil bill tanpa itu. Jika device pemegang rusak/hilang, **bill menunggu pemegang kembali**.

> **Risiko yang diterima secara eksplisit (RSK-04).**
> *Skenario:* Waiter Rina memegang bill meja 5 di Tablet-1. Server sudah menerima 3 item; item ke-4 ditambahkan offline 20 menit lalu dan belum terkirim. Tablet-1 jatuh dan mati total.
> *Akibat:* (1) meja 5 tampil terisi oleh bill "tanpa pemegang aktif"; (2) Tablet-2 hanya bisa melihat 3 item dan **tidak bisa menambah/membayar**; (3) item ke-4 yang belum sync **hilang**; (4) bila Tablet-1 dicabut (device revoked), bill menjadi **yatim permanen**, tidak pernah menjadi penjualan dan tidak mempengaruhi stok.
> *Pekerjaan-ulang operasional (bukan fitur take-over):* staf membuat **bill baru** di Tablet-2 dengan memasukkan ulang pesanan dan menagih tamu; bill yatim tetap tercatat dan muncul di laporan "bill terbuka tanpa pemegang aktif" untuk manager.
> *Keputusan:* konsekuensi ini diterima oleh user (`DISEPAKATI`).

**BR-FNB-005 — Event bill (`DISEPAKATI`).** Perubahan bill = event append-only: `BILL_OPENED`, `ITEM_ADDED`, `ITEM_VOIDED` (alasan), `ITEM_QTY_CHANGED`, `MODIFIER_SET`, `CUSTOMER_SET`, `TABLE_SET`, `BILL_CANCELED`, **`PREBILL_PRINTED`** (BR-FNB-010), **`BILL_HANDED_OVER`**, **`BILL_ACCEPTED`**, **`BILL_HANDOVER_CANCELED`** (BR-FNB-012). Urut per bill dengan `bill_seq` + `device_seq`; dikirim ke server saat online (BR-SYN-021). Status bill diturunkan dari event.

**BR-FNB-006 — Pembayaran (`DIUSULKAN`).** Hanya pemegang yang dapat membayar, dan pemegang harus register berjenis `KASIR` (register `PELAYAN` tidak membayar; waiter menyerahkan bill, BR-FNB-012); pembayaran menghasilkan satu `FinalizeSale` (BR-SYN-020) yang menyertakan `bill_id`. Pembayaran memerlukan shift terbuka (BR-SHF-010).

**BR-FNB-007 — Banyak bill per meja (`DIUSULKAN`).** Satu meja boleh memiliki beberapa open bill. Jika dua device offline membuka bill di meja yang sama, keduanya sah (tidak ditolak); server menandai "bill ganda pada meja" untuk dilihat manager.

**BR-FNB-008 — Pembatalan bill (`DIUSULKAN`).** Pemegang dapat membatalkan bill **tanpa item aktif** (`CANCELED`). Bill dengan item aktif harus di-void per item (setiap void tercatat alasan; permission BR-AUT-009).

**BR-FNB-009 — Pengaruh pada stok (`DISEPAKATI`).** Open bill tidak mengubah stok; hanya saat dibayar (BR-STK-003).

**BR-FNB-010 — Pra-bill dan event `PREBILL_PRINTED` (`DISEPAKATI`: event ditambahkan atas keputusan user, DOQ-09; detail `DIUSULKAN`).** Menampilkan/mencetak **pra-bill** (tanpa nomor invoice, FR-FNB-010) oleh pemegang menulis event **`PREBILL_PRINTED`** (dicatat saat pemegang memicu pra-bill, tidak bergantung pada keberhasilan cetak). Event ini ikut push dan **snapshot open bill** (FR-SYN-016) sehingga status meja **"Menunggu bayar"** konsisten di semua device. Sebuah bill berstatus **menunggu bayar** bila `PREBILL_PRINTED` terbarunya lebih baru daripada event perubahan isi terakhir (`ITEM_ADDED`, `ITEM_VOIDED`, `ITEM_QTY_CHANGED`, `MODIFIER_SET`); menambah/mengubah item **sesudah** pra-bill mengembalikan status ke "Terisi". Pra-bill boleh dicetak berulang (tiap cetak = satu event). Status "menunggu bayar" **tersimpan sebagai kolom pada `bill`** dan riwayatnya diturunkan dari event (`DISEPAKATI`, OQ-S19..S23).
*Contoh:* bill M05-0003 (Nasi Goreng ×2 = 70.000; Es Teh ×2 = 16.000; gross 86.000; SC 5% = 4.300; PB1 10% atas 90.300 = 9.030) pra-billnya dicetak pukul 19:42 → meja 5 "Menunggu bayar" di semua device. Pukul 19:45 waiter menambah 1 Es Teh → meja kembali "Terisi"; pra-bill dicetak ulang 19:46 → "Menunggu bayar".

**BR-FNB-011 — Register `PELAYAN` dan syarat shift (`DISEPAKATI`: waiter mencatat di HP, bayar di kasir, DOQ-18; detail `DIUSULKAN`).** Register punya atribut **jenis**: `KASIR` (default) atau `PELAYAN` (mis. HP waiter; AS-02). Register `PELAYAN`: (1) **dikecualikan dari syarat shift** untuk membuat/mengubah open bill, void item, mencetak pra-bill, dan menyerahkan bill — pengecualian atas BR-SHF-010; (2) **tidak** menyediakan pembayaran, buka/tutup shift, kas masuk/keluar, maupun retur (tidak ada laci kas); (3) tidak menerbitkan invoice atau nota kredit (tidak memakai seri nomor, BR-INV-001). Pembayaran, kas, dan retur tetap mensyaratkan shift terbuka di **register `KASIR`** (BR-SHF-010). Staf dengan role apa pun yang login di register `PELAYAN` tetap tunduk pada pembatasan ini; role Waiter tetap tanpa izin bayar/shift (BR-AUT-009).

**BR-FNB-012 — Serah-terima sukarela bill ke kasir (`DISEPAKATI`: serah-terima sukarela, butuh internet, tujuan dipilih, pengirim dapat membatalkan; DOQ-18; pemegang efektif, urutan event, daftar tujuan, kolom status, dan tanpa audit log: OQ-S19..S23; detail lain `DIUSULKAN`).** Pemegang (mis. register `PELAYAN`) dapat **menyerahkan** bill `OPEN` miliknya ke satu register `KASIR` di outlet yang sama. Ini **bukan take-over** (BR-FNB-004).
1. **Pra-syarat:** bill berstatus `OPEN` (bukan `SPLIT`/`MERGED`/`PAID`/`CANCELED`); **seluruh event bill itu sudah terkirim dan diterima server** (antrean event bill bersih) — agar tidak ada item belum-sync yang hilang; **device online**.
2. **Langkah:** (a) pemegang memilih register `KASIR` tujuan → event **`BILL_HANDED_OVER`**; (b) bill berstatus **"menunggu diterima oleh {register}"**: **masih dimiliki pengirim**, dan **pengirim tidak dapat mengubah isinya** (read-only) selama menunggu; (c) di register tujuan bill tampil sebagai **"bill masuk"** (lewat snapshot open bill); (d) staf kasir menekan **Terima** → event **`BILL_ACCEPTED`**: **lease berpindah ke register penerima** dalam satu transaksi server; pengirim menjadi read-only.
3. **Pembatalan:** pengirim dapat membatalkan selama **belum diterima** → event **`BILL_HANDOVER_CANCELED`**; bill kembali dapat diedit pengirim dan boleh diserahkan ke register lain. Bila penerimaan dan pembatalan terjadi bersamaan, **server memutuskan menurut urutan commit** dan menolak yang kalah dengan pesan jelas.
4. **Hanya online:** serah-terima, penerimaan, dan pembatalan dilakukan **hanya online** (tidak ada sync LAN, AP-03): server yang menetapkan pemegang. **Offline:** tombol "Serahkan"/"Terima"/"Batal" **nonaktif** dengan alasan "serah-terima membutuhkan internet"; bill tetap dimiliki pemegang dan masih dapat diedit/dicetak pra-billnya; bila device pemegang rusak sebelum serah-terima, berlaku BR-FNB-004 (bill yatim).
5. **Validasi server:** penerimaan ditolak bila register tujuan bukan `KASIR`, bukan di outlet yang sama, device pengirim sudah dicabut, atau bill sudah tidak menunggu (dibatalkan/diterima/diubah).
6. **Jejak:** event mencatat staf penyerah, staf penerima, register asal dan tujuan, serta waktu server; **tidak masuk audit log** (`DISEPAKATI`).
7. **Penegasan (`DISEPAKATI`, OQ-S19..S23):** (a) pemegang bill disimpan sebagai **register dan device sekaligus**; **pemegang efektif adalah device aktif pada register itu** (satu device aktif per register, BR-INV-001); (b) event serah-terima (`BILL_HANDED_OVER`, `BILL_ACCEPTED`, `BILL_HANDOVER_CANCELED`) **diberi nomor urut oleh server** (`last_event_seq + 1`); (c) daftar register tujuan adalah **semua register outlet yang sudah diunduh device** (disaring ke jenis `KASIR`, butir 5); (d) status "menunggu diterima" **tersimpan sebagai kolom pada `bill`**, dengan riwayat dari event.
*Contoh:* waiter Rina (HP-02, register `PELAYAN`) menyerahkan bill M05-0003 (tagihan 99.630) ke `POS01`: seluruh 6 event bill sudah `ACK` → `BILL_HANDED_OVER`. Kasir Dewi di `POS01` (shift terbuka) menekan Terima → `BILL_ACCEPTED`; lease pindah ke `POS01`; Dewi membayar tunai (terbulat 99.600, rounding −30). Rina offline pada saat itu: tombol Serahkan nonaktif; ia tetap bisa menambah item sampai online dan seluruh event terkirim.

**BR-FNB-013 — Dampak serah-terima pada pembayaran, split, dan merge (`DISEPAKATI` untuk pemegang efektif = device aktif register, OQ-S19..S23; detail lain `DIUSULKAN`).** Setelah diterima, **pemegang baru** (device aktif pada register penerima) menjadi acuan seluruh aturan: hanya ia yang dapat membayar (butuh shift terbuka di register itu, BR-SHF-010), memisah (BR-SPL-001), dan menggabung (BR-SPL-020: kedua bill harus dipegang register yang sama). Bill berstatus "menunggu diterima" tidak dapat dipisah, digabung, dibayar, atau diubah. Pembayaran dicatat pada shift register penerima.

### 7.16 Split Bill & Merge Bill (KEP-12)

**BR-SPL-001 — Split menjadi bill anak (`DISEPAKATI`).** Bill dipecah menjadi **bill anak**. Bill induk berstatus `SPLIT` dan **tidak pernah** mendapat invoice. Anak mewarisi meja, pemegang lease (device yang sama), dan pelanggan.

**BR-SPL-002 — Dokumen sendiri (`DISEPAKATI`).** **Tiap bill anak punya invoice sendiri** (nomor seri register), pembayaran sendiri, pajak sendiri, service charge sendiri. Bill induk ditutup otomatis (`CLOSED_BY_SPLIT`) bila seluruh anak `PAID`/`CANCELED`.

**BR-SPL-003 — Mode split (`DIUSULKAN`).** (a) **Per item**: baris dipindahkan ke anak; (b) **Per kuantitas baris**: baris berkuantitas `Q` dipecah menjadi beberapa baris dengan Σ kuantitas = `Q` (mis. 3 porsi → 1 + 2); (c) **Bagi rata** `N` bagian — representasi sebagai satu baris "Bagian k/N" (`DISEPAKATI`, OQ-16 terjawab; BR-SPL-007).

**BR-SPL-004 — Perhitungan anak (`DISEPAKATI` melalui BR-MNY; detail `DIUSULKAN`).** Mode (a)(b): tiap anak dihitung **dari baris miliknya sendiri** dengan algoritma BR-TAX-006. Diskon bill induk: **persen** diterapkan ke tiap anak (dibulatkan sendiri); **nominal** dialokasikan ke anak dengan LR berbobot gross anak. Karena bill induk tidak pernah difinalisasi, selisih pembulatan terhadap "induk hipotetis" tidak menimbulkan ketidakkonsistenan; yang tersimpan adalah angka anak.

*Contoh 1 — split per item* (Contoh 3 Bab 7.4; diskon bill **nominal Rp10.000**; SC 5% kena pajak; PB1 10%; eksklusif):
Anak A: Nasi Goreng 2 (70.000) + Es Teh 1 (8.000) = **78.000**. Anak B: Es Teh 1 (8.000) + Ayam Bakar+Extra Sambal (44.500) = **52.500**.
Diskon LR berbobot 78.000 : 52.500 → A 5.977,01 → 5.977; B 4.022,99 → 4.022 (+1 sisa) → **4.023**.

| | A | B | Σ anak | Induk hipotetis |
|---|---|---|---|---|
| Gross | 78.000 | 52.500 | 130.500 | 130.500 |
| Diskon | 5.977 | 4.023 | 10.000 | 10.000 |
| S2 | 72.023 | 48.477 | 120.500 | 120.500 |
| SC 5% | R(3.601,15) = 3.601 | R(2.423,85) = 2.424 | 6.025 | 6.025 |
| Dasar pajak | 75.624 | 50.901 | 126.525 | 126.525 |
| PB1 10% | R(7.562,4) = 7.562 | R(5.090,1) = 5.090 | 12.652 | R(12.652,5) = 12.653 |
| **Total** | **83.186** | **55.991** | **139.177** | 139.178 |

Selisih **−Rp1** terhadap induk hipotetis diterima; tiap anak tetap mendapat invoice sendiri (mis. `OUT01-POS02-1126-000130` dan `-000131`).

*Contoh 2 — bagi rata 3 bagian* (Contoh 3a: G = 135.655; gross 130.500; diskon 13.050; SC 5.873; PB1 12.332). Prosedur: (1) **total** dialokasikan LR: 135.655/3 = 45.218,33 → **45.219 / 45.218 / 45.218**; (2) gross & diskon dibagi LR (sama rata 43.500 dan 4.350, neto 39.150 tiap bagian); (3) **SC** LR: 5.873/3 → **1.958 / 1.958 / 1.957**; (4) **pajak = total − neto − SC**: 45.219−39.150−1.958 = **4.111**; 45.218−39.150−1.958 = **4.110**; 45.218−39.150−1.957 = **4.111**.
Σ total = 135.655 ✓ · Σ SC = 5.873 ✓ · Σ PB1 = 12.332 ✓. Bila tiap bagian dibayar tunai, pembulatan Rp100 per bagian: 45.219 → **45.200 (−19)**; 45.218 → **45.200 (−18)**.

**BR-SPL-005 — Konsumsi stok anak (`DIUSULKAN`).** Untuk split per item/kuantitas, stok/resep dikonsumsi saat **anak itu dibayar**, berdasarkan baris milik anak tersebut. Untuk bagi rata, konsumsi mengikuti BR-SPL-007.

**BR-SPL-006 — Un-split (`DIUSULKAN`).** Anak yang **belum dibayar** semuanya dapat digabung kembali (merge) ke satu bill; anak yang sudah dibayar tidak dapat diubah.

**BR-SPL-007 — Bagi rata sebagai baris "Bagian k/N" (`DISEPAKATI`, OQ-16 terjawab; detail `DIUSULKAN`).** Bagi rata membagi **pembayaran**, bukan memecah item:
1. Bill induk tetap memegang seluruh item. Dibuat `N` bill anak ("bagian"); **tiap anak berisi satu baris sintetis "Bagian k/N — {bill_ref}"** (mis. "Bagian 1/3 — M05-0003"), bukan salinan item.
2. Komponen tiap anak (gross, diskon, service charge, pajak, total) dihitung dengan prosedur BR-SPL contoh 2 (total LR dahulu, SC LR, pajak = sisa) dan **disimpan**; tiap anak mendapat invoice sendiri (nomor seri register), pembayaran sendiri, pajak dan service charge sendiri sesuai BR-SPL-002.
3. **Stok/resep dikonsumsi SEKALI untuk seluruh item induk, saat bagian PERTAMA dibayar**: perintah `FinalizeSale` anak pertama yang lunas membawa daftar item induk sebagai dasar konsumsi (tidak dicetak; hanya untuk stok/HPP); HPP total tercatat pada anak itu. Bila sisa bagian tak pernah dibayar, stok tetap sudah terkonsumsi (barang telah disajikan).
4. Karena item tidak dipecah, retur atas invoice "Bagian k/N" bersifat **nilai uang saja** (tanpa disposisi stok); keterbatasan: laporan per-item (di luar MVP) tidak membagi penjualan per bagian.
5. Pembagian dapat dibatalkan (kembali ke satu bill) selama **belum ada** bagian yang dibayar.
*Contoh:* Bill M05-0003 total 135.655 dibagi 3 → tiga invoice: **45.219 / 45.218 / 45.218** (SC 1.958 / 1.958 / 1.957; PB1 4.111 / 4.110 / 4.111). Bagian 1 dibayar lebih dulu → seluruh bahan pesanan dikonsumsi saat itu (mis. 2 Nasi Goreng → HPP 8.720 pada anak 1, BR-RCP-003); bagian 2 dan 3 dibayar kemudian tanpa konsumsi stok lagi.

#### Merge Bill (`DISEPAKATI`: item sejenis digabung jadi satu baris; OQ-08 terjawab)

**BR-SPL-020 — Syarat.** Kedua bill `OPEN`, satu outlet, dan **dipegang device yang sama** (karena tidak ada take-over, BR-FNB-004). Bill yang dipegang device berbeda **tidak dapat digabung**. "Dipegang" mengikuti **pemegang saat ini**: setelah serah-terima diterima (BR-FNB-012) pemegangnya adalah register penerima; bill yang masih "menunggu diterima" tidak dapat digabung.

**BR-SPL-021 — Hasil.** Satu bill **target** (default yang lebih lama dibuka; dapat dipilih). Bill **sumber** berstatus `MERGED` dengan rujukan ke target; **tidak ada invoice/nomor** yang terpakai (nomor invoice baru ada saat bayar).

**BR-SPL-022 — Item (`DISEPAKATI`: item sejenis digabung jadi satu baris).** Seluruh item **aktif** sumber dipindahkan ke target dan **item sejenis digabung menjadi satu baris** (kuantitas dijumlahkan). Item **sejenis** = SKU, UOM, kumpulan modifier, harga satuan snapshot, diskon baris, dan catatan **sama persis**; yang berbeda satu saja tetap sebagai baris terpisah. Penggabungan dicatat sebagai event ber-`origin_bill_id` beserta daftar event asal; **jejak per-event (waktu, staf) tetap ada di log event bill**, hanya tampilan/penagihan yang menyatu. Riwayat item void tetap di sumber. Diskon baris ikut baris; **diskon bill sumber dibuang** (diterapkan ulang bila perlu; asumsi yang tidak diubah jawaban OQ-08). Pelanggan: target dipertahankan; bila kosong, diambil dari sumber.

**BR-SPL-023 — Meja.** Bill target tetap di mejanya; meja sumber dianggap kosong bila tidak ada open bill lain di meja itu.

**BR-SPL-024 — Tidak dapat dibatalkan**; pemisahan ulang lewat split. MVP menggabungkan **bill**, bukan "menggabungkan meja fisik" sebagai entitas.

*Contoh:* Bill `M05-0003` (Nasi Goreng ×2 = 70.000; Es Teh ×2 = 16.000) dan `M06-0001` (Ayam Bakar ×1 = 42.500; Es Teh ×1 = 8.000) dipegang Tablet-1. Merge `M06-0001` → `M05-0003`: target berisi Nasi Goreng ×2 (70.000), **Es Teh ×3 (16.000 + 8.000 = 24.000, digabung karena sejenis)**, Ayam Bakar ×1 (42.500). Bila Es Teh sumber ber-modifier berbeda (mis. "Less Sugar"), barisnya tetap terpisah. `M06-0001` = `MERGED`; meja 6 kosong. Total gross target = 70.000 + 16.000 + 42.500 + 8.000 = **136.500**.

### 7.17 Cetak Struk & Cash Drawer (KEP-13)

**BR-PRN-001 — Satu antarmuka, banyak adapter (`DISEPAKATI`).** Satu antarmuka printer dengan adapter per jalur: **WebUSB**, **Web Bluetooth (BLE)**, dan `window.print` + `--kiosk-printing` sebagai **fallback Windows**.

**BR-PRN-002 — Asinkron (`DISEPAKATI`).** Penjualan **disimpan ke Dexie dulu**; pekerjaan cetak masuk antrean (`print_job`). Cetak **tidak menghalangi checkout**; **kegagalan cetak tidak menggagalkan penjualan**; **cetak ulang selalu tersedia** (cetak ulang diberi penanda "CETAK ULANG", `DIUSULKAN`).

**BR-PRN-003 — Format (`DISEPAKATI`).** Struk dibuat sebagai **teks ESC/POS** (bukan HTML→gambar); logo di-cache sebagai **bitmap**. Kecepatan cetak adalah **prioritas user**.

**BR-PRN-004 — Batasan (`DISEPAKATI`).** Web Bluetooth hanya BLE (SPP klasik tidak didukung); USB di Windows sering terkunci driver bawaan → perlu driver WinUSB atau fallback kiosk-printing (RSK-07).

**BR-PRN-005 — Kustomisasi per outlet (`DISEPAKATI`).** Logo, header, footer. Lebar kertas 58/80 mm dikonfigurasi per register (`DIUSULKAN`). Bahasa struk ditetapkan per outlet (BR-I18N-007).

**BR-PRN-006 — Cash drawer (`DIUSULKAN`).** Dibuka lewat perintah pulsa printer saat pembayaran tunai; pembukaan manual tanpa transaksi butuh permission dan dicatat audit.

**BR-PRN-007 — Isi struk (`DIUSULKAN`).** Nomor invoice, waktu **zona outlet**, kasir, register, baris (nama & harga snapshot, qty+UOM, diskon), subtotal, diskon bill, service charge, pajak (label inklusif/eksklusif), pembulatan, total, pembayaran, kembalian, pelanggan (opsional), header/footer. *Ilustrasi isi (bukan desain visual), 32 kolom, dari Contoh 1 Bab 7.4:*

```
        TOKO SOLVA JAYA
      Jl. Mawar No. 5 (contoh)
--------------------------------
No : OUT01-POS02-1126-000123
Tgl: 17/11/2026 14:05 Kasir: Dewi
--------------------------------
Kopi Bubuk 200g
 2 x 18.500             37.000
Gula 1kg
 1 x 16.000             16.000
Susu UHT 1L
 3 x 17.900             53.700
 Diskon 10%             -5.370
--------------------------------
Subtotal               101.330
PPN 11%                 11.146
Pembulatan                  24
TOTAL                  112.500
Tunai                  150.000
Kembali                 37.500
--------------------------------
        Terima kasih
```

### 7.18 Audit Log (KEP-15)

**BR-AUD-001 — Peristiwa wajib dicatat (`DISEPAKATI` untuk inti; daftar `DIUSULKAN`).** Void invoice, persetujuan diskon/override supervisor, perubahan harga, perubahan ketersediaan item per outlet, retur/nota kredit, perubahan role/permission/reset PIN, enroll/cabut/pulihkan device & register, posting/koreksi GR, kirim/terima transfer, posting opname, selisih kas & tutup shift darurat, kas masuk/keluar, anotasi gap invoice, perubahan konfigurasi pajak/outlet, perubahan feature flag tenant, ekspor transaksi pending, pembukaan laci tanpa transaksi, penguncian PIN, penyelesaian item "perlu perhatian".

**BR-AUD-002 — Tidak dapat diubah (`DISEPAKATI`).** Audit log **append-only**: aplikasi tidak memiliki hak UPDATE/DELETE pada tabelnya. Tamper-evidence dengan **hash berantai per tenant** (tiap entri memuat hash entri sebelumnya) diusulkan (`DIUSULKAN`, P1).

**BR-AUD-003 (`DIUSULKAN`).** Setiap entri memuat: aktor, penyetuju (bila ada), aksi, objek, nilai sebelum/sesudah, `device_id`, waktu device (terkoreksi offset) dan waktu server, alasan. Entri yang dibuat offline dikirim bersama outbox dan **tidak hilang** walau perintah terkaitnya masuk "perlu perhatian". Retensi audit: disimpan tanpa penghapusan (OQ-03 terjawab).

### 7.19 Data Pelanggan Opsional (KEP-13)

**BR-CUS-001 (`DISEPAKATI`).** Nama dan/atau telepon pelanggan **opsional** pada transaksi; disimpan sebagai snapshot di `sale`. **BR-CUS-002 (`DISEPAKATI`, OQ-21 terjawab).** Tidak ada master pelanggan/loyalitas di MVP; nomor telepon dimasker pada laporan untuk role tanpa permission khusus. Tanpa penanda persetujuan dan tanpa enkripsi kolom (OQ-21 terjawab); retensi data pelanggan mengikuti kebijakan retensi data server (OQ-03).

### 7.20 Multi-Bahasa & Lokalisasi (KEP-17)

> Multi-bahasa UI **masuk MVP** (keputusan user, rev. 0.91). Bahasa yang didukung (jawaban user atas OQ-23): **`id-ID` (default) dan `en-US`**. Seluruh aturan di bawah tidak bergantung pada jumlah bahasa.

**BR-I18N-001 — Katalog bahasa & kunci terjemahan (`DISEPAKATI`: masuk MVP; bahasa = `id-ID` + `en-US`).** Aplikasi mendukung lebih dari satu locale UI untuk `/admin` dan `/pos`. Tidak ada teks UI yang ditulis langsung di komponen; semua teks (label, pesan, tombol, error, banner) melalui **kunci terjemahan**. Menambah bahasa baru = menambah satu kamus, tanpa perubahan alur/aturan bisnis.

**BR-I18N-002 — Pemilihan bahasa (`DIUSULKAN`).** Urutan prioritas: (1) preferensi **pengguna** (staf maupun back-office), disimpan di profil dan ikut tersinkron; (2) bahasa bawaan **register** (dipakai pada layar pilih-staf/PIN sebelum pengguna dikenal); (3) bahasa bawaan **tenant**; (4) `id-ID`. Mengganti bahasa berlaku seketika tanpa memuat ulang aplikasi dan tanpa mengubah shift/keranjang yang sedang berjalan.

**BR-I18N-003 — Berfungsi offline (`DIUSULKAN`).** Kamus seluruh locale yang aktif di-**precache bersama app shell**; berganti bahasa tidak membutuhkan jaringan. Versi kamus mengikuti versi aplikasi (update berbasis prompt, BR-SYN-002). Kunci yang belum diterjemahkan **jatuh ke `id-ID`** (bukan menampilkan kunci mentah) dan dilaporkan sebagai peringatan pada build/CI.

**BR-I18N-004 — Data bisnis tidak dilokalisasi (`DIUSULKAN`).** Status dokumen (`PAID`, `VOID`, `OPEN`…), kode alasan, kode error server, entri audit, dan payload outbox/event menyimpan **kode/enum**, bukan teks terjemahan. Teks ditampilkan oleh client menurut locale **pembaca**. Dengan begitu audit lintas bahasa konsisten dan pesan tetap benar saat dibuat offline.

**BR-I18N-005 — Data master buatan tenant (`DISEPAKATI`, jawaban OQ-23c).** Nama kategori/produk/menu/modifier/meja, alasan bebas (teks yang diketik pengguna), dan header/footer struk adalah **satu bahasa sebagaimana diinput**; terjemahan per bahasa untuk data master **tidak** masuk MVP.

**BR-I18N-006 — Format tampilan vs penyimpanan kanonik (`DIUSULKAN`).** Tampilan angka/tanggal mengikuti locale; **penyimpanan dan sync tetap kanonik**: uang integer rupiah, kuantitas string desimal bertitik, waktu UTC (BR-MNY-001/002, BR-TIM-001). Input kuantitas **diurai menurut locale pada batas UI**, dikonversi ke string kanonik, lalu divalidasi Zod sebelum perhitungan; hasil urai ditampilkan sebelum dikonfirmasi agar tidak ambigu. Simbol mata uang tetap **`Rp`** di semua locale; mata uang tunggal IDR. Waktu selalu dalam zona waktu **outlet** (BR-TIM-002), hanya format yang berbeda.

| Nilai kanonik | `id-ID` | `en-US` |
|---|---|---|
| 112476 (rupiah) | Rp112.476 | Rp112,476 |
| "0.5" (kuantitas) | 0,5 | 0.5 |
| "1500" (kuantitas) | 1.500 | 1,500 |
| 2026-11-17 14:05 (WIB) | 17/11/2026 14.05 | 11/17/2026 2:05 PM |

*Contoh jebakan:* ketikan `1.500` bermakna **1500** pada `id-ID` tetapi **1,5** pada `en-US`; keypad numerik POS hanya menampilkan pemisah desimal milik locale aktif dan antarmuka menampilkan hasil urai ("1.500 pcs" / "1.5 pcs") sebelum menambahkan ke keranjang. Barcode dan SKU **tidak** dipengaruhi locale.

**BR-I18N-007 — Bahasa struk per outlet (`DISEPAKATI`, jawaban OQ-23d; detail snapshot `DIUSULKAN`).** Bahasa struk adalah **salah satu pengaturan kustomisasi struk outlet** (bersama logo, header, footer; BR-PRN-005): struk pelanggan mengikuti yang dikustomisasi, terpisah dari bahasa UI staf (struk dibaca pelanggan). Locale struk disalin sebagai snapshot ke transaksi (`receipt_locale`) sehingga **cetak ulang identik** dengan cetakan pertama walau pengaturan outlet berubah. Label bawaan (Subtotal, Diskon, Service Charge, PPN/PB1, Pembulatan, Total, Tunai, Kembali, "CETAK ULANG") berasal dari kamus; header/footer adalah teks bebas (BR-I18N-005).

**BR-I18N-008 — Batas cetak ESC/POS (`DIUSULKAN`, OQ-23).** Struk berupa teks ESC/POS (BR-PRN-003) sehingga karakter terbatas pada code page printer. MVP mendukung aksara Latin (`id`, `en`). Karakter di luar jangkauan (diakritik, emoji, aksara non-Latin) pada nama produk **ditransliterasi ke ASCII** (bila tidak mungkin: diganti `?`) saat cetak; data tersimpan tidak berubah. Bahasa beraksara non-Latin membutuhkan jalur cetak bitmap dan menjadi keputusan terpisah bila ditambahkan.

**BR-I18N-009 — Mutu terjemahan (`DIUSULKAN`).** (a) Pesan memakai **interpolasi bernama dan aturan jamak** agar benar di tiap bahasa; (b) CI memeriksa bahwa **setiap kunci ada di semua locale aktif** dan tidak ada kunci yatim; (c) kunci baru wajib memiliki `id-ID` dan `en-US` sebelum rilis.
*Contoh (banner BR-SYN-051):* `id-ID` → "Ada 3 transaksi belum terkirim sejak 2 jam." · `en-US` → "3 transactions haven't been sent for 2 hours." (satu transaksi: "1 transaction hasn't been sent for 1 hour.").

**BR-I18N-010 — Dampak pada aturan lain (`DIUSULKAN`).** Perhitungan uang/pajak/stok, nomor invoice (`OUT01-POS02-1126-000123`), `business_date`, dan laporan **tidak berubah** karena bahasa; laporan di `/admin` menampilkan label sesuai locale pengguna tetapi nilai identik.

**BR-I18N-011 — Library i18n (`DISEPAKATI` penambahan library; pilihan produk `DIUSULKAN`).** Lokalisasi memakai **library i18n** (ditambahkan ke stack, Bab 5.1) — bukan implementasi buatan sendiri. Kandidat: `i18next` + `react-i18next` (dengan dukungan ICU). Kriteria pemilihan final saat implementasi: (1) berjalan di SSR `/admin` (TanStack Start) **dan** di SPA `/pos`; (2) kamus dapat di-bundle dan di-precache service worker untuk offline; (3) dukungan interpolasi bernama dan aturan jamak (BR-I18N-009); (4) kunci terjemahan bertipe aman di TypeScript; (5) ukuran bundle kecil. Penerjemah kamus: tidak ditetapkan user; asumsi developer (kamus `id-ID` dan `en-US`).

---

## 8. Alur Kerja End-to-End

> Alur ditulis sebagai langkah bernomor. Ini requirement **perilaku**, bukan desain layar. Aktor: **K** = kasir, **S** = supervisor, **M** = manager, **D** = device (aplikasi), **SV** = server.

### FLOW-01 — Registrasi Outlet, Register & Enrollment Device (online)

1. M/Owner (di `/admin`) membuat outlet: kode `OUT01`, entitas hukum, zona waktu `Asia/Jakarta`, jam potong `04:00`, profil pajak, mode harga inklusif/eksklusif, service charge.
2. M membuat register: kode `POS02`, nama "Kasir 2", **prefiks invoice** `OUT01-POS02` (wajib, unik per tenant). SV menyimpan `cash_master` dan prefiks awal (berlaku mulai bulan bisnis berjalan) dan inisialisasi `last_invoice_seq_received = 0`.
3. M menekan "Buat kode pairing" → SV menerbitkan kode sekali pakai (8 karakter, kedaluwarsa 15 menit) terikat ke register.
4. Di perangkat kasir, pengguna membuka `/pos` (online) dan memasukkan kode.
5. SV memvalidasi kode, menandai terpakai, menerbitkan **device credential** dan mengirim: konfigurasi outlet/register, daftar staf outlet beserta hash PIN + permission (salt per device), dan memicu **full pull** master data.
6. D menyimpan credential di IndexedDB, menjalankan `storage.persist()`, men-cache app shell (service worker), mengunduh logo struk sebagai bitmap, dan mencatat clock offset.
7. D siap bekerja offline. Audit: "device di-enroll oleh M ke register OUT01-POS02".

### FLOW-02 — Login Staf (termasuk offline)

1. D memeriksa **lease offline**: `waktu_terkoreksi − sync_sukses_terakhir ≤ 7 hari`; bila tidak → layar "Sambungkan ke internet" (BR-AUT-008). D juga memeriksa jam mundur (BR-AUT-013).
2. Staf memilih namanya dan memasukkan PIN.
3. D menghitung hash lambat (salt device) dan membandingkannya dengan hash lokal. Cocok → sesi lokal dibuka dengan permission staf. Gagal → penghitung gagal +1; mencapai ambang → kunci (BR-AUT-005).
4. Bila online, D membuka sinkronisasi (FLOW-14/15) di latar belakang.
5. Pencabutan staf yang terjadi di server **belum terlihat** sampai D sync berikutnya (BR-AUT-010).

### FLOW-03 — Buka Shift

1. K login (FLOW-02). D memeriksa tidak ada shift `OPEN` pada register ini.
2. K memasukkan **modal awal** (mis. Rp500.000).
3. D membuat `shift` (UUIDv7, `opened_at` terkoreksi, kasir, register) dan perintah outbox `OpenShift`.
4. Shift `OPEN`. Seluruh transaksi berikutnya mengacu ke shift ini.

### FLOW-04 — Checkout Retail (offline-capable)

1. **Prasyarat:** login, shift `OPEN`, lease valid (BR-SHF-010).
2. K memindai barcode (scanner/kamera). D melakukan lookup lokal barcode → (SKU, UOM). Pemindaian barcode sama berulang menaikkan qty baris yang ada.
3. D menentukan harga per BR-PRC-002; tidak ada harga → item ditolak masuk keranjang. Harga disalin sebagai **snapshot**.
4. (Opsional) K memberi diskon item/bill. Bila melebihi batas role → D meminta **PIN supervisor** (verifikasi lokal; peminta ≠ penyetuju); audit entry dibuat.
5. (Opsional) K mengisi nama/telepon pelanggan.
6. D menghitung total dengan **package bersama** (BR-TAX-006) dan menampilkan subtotal, diskon, pajak, pembulatan, total.
7. K memilih metode bayar; mengisi nominal; D menghitung pembulatan tunai (hanya pembayaran tunai penyelesai) dan kembalian (BR-PAY-003). Mendukung banyak metode.
8. K menekan "Selesai". D menjalankan **satu transaksi IndexedDB**: alokasikan `invoice_no` (counter+1), simpan `sale`, `sale_line` (termasuk alokasi LR), `sale_payment`, `outbox_command(FinalizeSale, UUIDv7)`, `print_job`, entri audit. Bila gagal → rollback; **tidak ada nomor terpakai** (BR-INV-004).
9. UI menampilkan sukses; **cetak berjalan asinkron** + laci dibuka (BR-PRN-002/006).
10. Bila online, push `FinalizeSale` segera (FLOW-14).

*Contoh:* Kasus Contoh 1 Bab 7.4 → invoice `OUT01-POS02-1126-000123`, total tagihan tunai **112.500** (rounding +24), tunai 150.000, kembalian **37.500**. Seluruh langkah selesai di perangkat tanpa jaringan.

### FLOW-05 — F&B: Buka Meja, Open Bill, Bayar

1. Waiter/K memilih meja (status dari snapshot/lokal). D membuat `bill` (UUIDv7) dengan **lease = device ini** dan event `BILL_OPENED` + `bill_ref` (mis. `M05-0003`).
2. Item menu ditambah dengan modifier; tiap aksi = event `ITEM_ADDED`/`MODIFIER_SET`. Harga menu + selisih modifier disalin sebagai snapshot (BR-PRC-006). Item boleh di-void sebelum bayar (event `ITEM_VOIDED` + alasan).
3. Event dikirim ke SV saat online (urut per bill). Device lain melihat bill tersebut **read-only** lewat snapshot open bill outlet.
4. Tamu meminta bill: D menghitung tampilan bill (service charge + PB1) untuk pra-cetak (bukan invoice, tidak ada nomor).
5. Bayar (hanya pemegang): sama seperti FLOW-04 langkah 6–10 dengan `bill_id` pada `FinalizeSale`; stok/resep dikonsumsi **oleh server saat memproses** perintah ini.
6. Bill menjadi `PAID`; meja kosong bila tidak ada bill `OPEN` lain.

### FLOW-06 — Split Bill

1. Pemegang memilih "Pisah bill" pada bill `OPEN` dan memilih mode (per item / per kuantitas / bagi rata N).
2. D membuat bill anak (mewarisi meja, pemegang, pelanggan); bill induk menjadi `SPLIT` (event `BILL_SPLIT` + referensi anak).
3. D menghitung tiap anak sesuai BR-SPL-004 (contoh angka di Bab 7.16).
4. Tiap anak dibayar sendiri → invoice sendiri (nomor berurutan register), pajak dan SC sendiri.
5. Induk tertutup otomatis bila semua anak `PAID`/`CANCELED`.

### FLOW-07 — Merge Bill

1. Pemegang memilih bill sumber dan target (keduanya `OPEN`, dipegang device yang sama; kalau tidak, aksi ditolak dengan alasan "dipegang device lain").
2. D memindahkan item aktif sumber ke target, **menggabungkan item sejenis menjadi satu baris** (BR-SPL-022; event ber-`origin_bill_id`), menandai sumber `MERGED`, membebaskan meja sumber bila tidak ada bill lain.
3. Diskon bill sumber dibuang; pelanggan mengikuti target (BR-SPL-022). Tidak ada nomor invoice terpakai.

### FLOW-08 — Retur / Nota Kredit

1. K membuka riwayat transaksi (lokal, ≤ 3 bulan) dan memilih invoice asal. Bila tidak ada di device (register lain / di luar retensi lokal) → **butuh online**; D mengunduh invoice dari SV.
2. D memeriksa jendela retur 3 bulan kalender dari `business_date` invoice (BR-RTR-003) dan status bukan `VOID`.
3. K memilih baris dan kuantitas retur (≤ sisa belum diretur), alasan, dan disposisi stok per baris (`KEMBALI_STOK`/`BUANG`).
4. D menghitung nilai retur dari angka tersimpan (BR-RTR-006) dan menampilkan refund.
5. **Supervisor** memasukkan PIN (verifikasi lokal; audit mencatat penyetuju).
6. K memilih metode refund; untuk tunai, shift harus `OPEN` (mengurangi kas).
7. D menjalankan transaksi IndexedDB: counter nota kredit +1 (`OUT01-POS02-NK-1126-000001`), simpan nota kredit + baris, outbox `FinalizeCreditNote`, print job, audit.
8. SV saat memproses: membuat movement `RETURN_IN` (bila `KEMBALI_STOK`) pada biaya snapshot; memperbarui laporan neto.

*Contoh:* Retur 1 dari 3 Susu pada `OUT01-POS02-1126-000123` → refund 16.110 + 1.772 = 17.882 → tunai **17.900** (rounding +18); nota kredit `OUT01-POS02-NK-1126-000001`; stok Susu +1 pada biaya snapshot.

### FLOW-09 — Void Invoice

1. K membuka invoice terakhir/di shift berjalan; D memeriksa bahwa invoice dibuat pada **shift yang masih terbuka** di register ini (BR-INV-005). Selain itu → arahkan ke FLOW-08.
2. Supervisor memasukkan PIN + alasan.
3. D mengubah status invoice menjadi `VOID` (nomor tetap), membalik pembayaran pada shift, mengirim perintah `VoidSale`, dan mencatat audit.
4. SV membuat `SALE_VOID` movement balik pada **biaya snapshot** penjualan itu.

### FLOW-10 — Tutup Shift

1. K memilih "Tutup shift". D memperingatkan bila ada open bill (BR-SHF-007) dan bila ada transaksi pending.
2. K memasukkan **uang fisik terhitung** (blind count): D **tidak** menampilkan kas diharapkan.
3. K menyubmit hitungan → hitungan **terkunci**. D menghitung `kas_diharapkan` dan `selisih` (BR-SHF-005), menyimpan, lalu **menampilkan kas diharapkan dan selisih kepada kasir** (BR-SHF-006).
4. D membuat `CloseShift` ke outbox; shift `CLOSED`; mencetak rekap (opsional).
5. SV menghitung ulang setelah seluruh perintah register diterima (BR-SHF-008). Rekap shift & selisih muncul di laporan.

*Contoh:* Modal 500.000; tunai penjualan 1.250.000; kas masuk 200.000; kas keluar 150.000; refund tunai 17.900 → diharapkan 1.782.100; dihitung 1.780.000 → **selisih −2.100**.

### FLOW-11 — Goods Receipt (online, `/admin`)

1. Gudang membuat GR `DRAFT` untuk outlet OUT01 (pemasok opsional).
2. Menambah baris: SKU Susu, UOM `dus`, qty 5, biaya Rp96.000/dus → nilai 480.000, qty dasar 60 pcs.
3. Posting → SV (satu transaksi): movement `GR_IN` +60 pcs, saldo & nilai diperbarui (BR-HPP-003), audit.
4. Perubahan saldo tampil di snapshot stok device pada sync berikutnya.

### FLOW-12 — Transfer Antar Outlet (online)

1. Gudang outlet A membuat transfer `DRAFT` → memilih tujuan B dan SKU/qty (mis. 40 pcs Susu).
2. **Kirim:** SV membuat `TRANSFER_OUT` pada biaya rata-rata saat itu (nilai 328.333); status `SENT`; in-transit tercatat (BR-TRF-002).
3. B melihat transfer masuk. **Terima:** mengisi qty diterima (38). SV membuat `TRANSFER_IN` (nilai 311.916) dan mencatat selisih 2 pcs / Rp16.417; status `RECEIVED` (BR-TRF-003).
4. Transfer yang barangnya tidak tiba: manager menutup dengan `qty_terima = 0` + alasan (BR-TRF-004).

### FLOW-13 — Stock Opname (online)

1. Manager membuat opname untuk outlet (seluruh/subset SKU); SV menyimpan `snapshot_qty` per SKU.
2. Tim menghitung fisik; manager mengisi `counted_qty`.
3. Review selisih: tampil delta dan perkiraan nilai (BR-STK-030/032).
4. Posting: SV membuat movement `ADJUSTMENT` per SKU; saldo minus yang dikoreksi dilepas dari flag; audit.

### FLOW-14 — Sync Push (Outbox)

```
Pemicu (aktif / online / interval / selesai jual)
        │
        ▼
D: ambil perintah PENDING terurut (FIFO per register; lewati yang tertahan dependensi)
        │  kirim {id=UUIDv7, tipe, schema_version, payload}
        ▼
SV: auth device ─ gagal → NEEDS_ATTENTION (otorisasi)
        │
        ├─ schema_version ∈ {N, N−1}? tidak → minta update app (perintah ditahan)
        ├─ validasi Zod ─ gagal → NEEDS_ATTENTION (struktural)
        ├─ idempotency key sudah ada? ya → kembalikan hasil lama (tanpa efek ganda)
        └─ satu transaksi: simpan fakta → hitung biaya/stok (row lock) → flag (stok minus, harga stale,
           produk nonaktif, selisih hitung, nomor konflik) → catat nomor tertinggi/gap → commit
        ▼
D: tandai ACKED, simpan hasil server (waktu terima, flag, HPP bila relevan)
   gagal transien → backoff 5s/15s/1m/5m, tetap PENDING
```

Aturan tambahan: banner pending (BR-SYN-051) tampil selama ada perintah non-ACKED; ekspor file tersedia kapan pun (BR-SYN-052).

### FLOW-15 — Sync Pull (Master Data) & Full Resync

1. D mengirim cursor `(versi, id)` miliknya.
2. SV memeriksa apakah cursor ≥ batas pembersihan tombstone. **Tidak** → balas `FULL_RESYNC_REQUIRED`.
3. SV mengembalikan baris `version > cursor` urut `(version, id)`, berhalaman, **termasuk tombstone**, terfilter tenant + outlet device.
4. D meng-upsert/menandai hapus di Dexie dalam satu transaksi per halaman, memajukan cursor **setelah** halaman tersimpan.
5. D mengambil snapshot stok & (F&B) snapshot open bill outlet.
6. **Full resync:** D mencatat `snapshot_version` dari SV, mengosongkan **tabel master lokal** (bukan outbox), mengunduh seluruh master berhalaman, lalu melanjutkan pull inkremental dari `snapshot_version` (upsert idempoten sehingga tumpang tindih aman).

*Contoh:* Tenant di versi 122. Device offline 2 jam dengan cursor `(120, …)` → pull mengembalikan baris versi 121 (3 harga) dan 122 (impor 4.000 SKU, 8 halaman × 500). Device offline 45 hari dengan cursor `(60, …)` dan batas pembersihan versi 100 → full resync.

### FLOW-16 — Pemulihan Device/Register

1. Device rusak/hilang. M mencabut device di `/admin` (berlaku saat device itu online; device hilang yang tak pernah online akan terkunci oleh lease 7 hari).
2. M menjalankan "pulihkan register" (BR-INV-008): memasukkan nomor struk fisik terakhir bila diketahui; SV mencatat gap dan menentukan nomor mulai.
3. M menutup shift lama yang menggantung (`FORCE_CLOSED`, BR-SHF-009).
4. Device baru di-enroll (FLOW-01) ke register yang sama; counter diinisialisasi dari SV; full resync.
5. Bill yang dipegang device lama **tidak dapat dipulihkan** (BR-FNB-004); muncul sebagai bill tanpa pemegang aktif.
6. Bila device lama kembali hidup dan mengirim perintah pending: ditolak otorisasi → antrean "perlu perhatian" → M dapat menerima penjualan itu secara manual dengan penyelesaian konflik nomor (BR-INV-009). Alternatif: M mengimpor **file ekspor** transaksi pending dari device lama.

### FLOW-17 — Update Aplikasi (PWA)

1. SW mendeteksi versi baru; D menampilkan banner di semua halaman + prompt "Pembaruan tersedia" **tanpa** memuat ulang otomatis (BR-SYN-002). Bila pengguna menolak, prompt muncul lagi tiap 2 jam; klien di bawah versi minimum diperbarui paksa **hanya pada momen aman keras** (BR-VER-003/004).
2. Pengguna menerima pada **momen aman** (BR-VER-004): tombol "Perbarui" baru aktif saat momen aman tercapai.
3. App baru menjalankan migrasi Dexie berversi, termasuk migrasi payload outbox ke versi skema terbaru; SV tetap menerima N dan N−1 (BR-SYN-022).

### FLOW-18 — Alur Antrean "Perlu Perhatian"

1. SV menandai perintah gagal struktural/otorisasi → `attention_item` terlihat M di `/admin` (alasan, device, payload ringkas).
2. M memilih: **terima manual** (koreksi/impor), **abaikan dengan alasan** (tercatat audit), atau **eskalasi ke developer**.
3. Perintah yang bergantung (mis. nota kredit untuk invoice yang gagal) dilepas setelah induknya selesai.

### FLOW-19 — Serah-terima Bill Waiter → Kasir (online)

1. Waiter (register `PELAYAN`) mencatat pesanan di HP; event bill dikirim ke server saat online. Pra-bill dicetak/ditampilkan → `PREBILL_PRINTED`; meja "Menunggu bayar" (BR-FNB-010).
2. Waiter menekan **Serahkan ke kasir**. D memeriksa: device online, bill `OPEN`, seluruh event bill sudah `ACK`. Bila tidak, tombol nonaktif dengan alasannya.
3. Waiter memilih register `KASIR` tujuan → event `BILL_HANDED_OVER`; bill di HP waiter menjadi read-only "menunggu diterima oleh {register}".
4. Di register kasir, bill tampil sebagai **bill masuk**; staf kasir menekan **Terima** → server menjalankan `BILL_ACCEPTED` dan memindahkan lease dalam satu transaksi.
5. Kasir (shift terbuka) kini dapat membayar, memisah, atau menggabung bill itu (BR-FNB-013); pembayaran mengikuti FLOW-04 langkah 6–10.
6. **Pembatalan:** sebelum diterima, waiter menekan **Batalkan serah-terima** → `BILL_HANDOVER_CANCELED`; bill kembali dapat diedit.
7. **Offline:** langkah 2–6 tidak tersedia; tombol nonaktif; kerja di HP tetap berjalan (EC-058).

### FLOW-20 — Kunci Layar Otomatis

1. Pengatur waktu 10 menit berjalan sejak aktivitas terakhir (sentuh/tombol/scan); berhenti selama pembayaran atau dialog PIN supervisor.
2. Waktu habis atau kunci manual → layar pilih staf + PIN; state (shift, keranjang, bill, input) tersimpan.
3. Staf yang sama memasukkan PIN benar → kembali ke titik yang sama. PIN salah → penghitung BR-AUT-005.
4. Bila staf tidak hadir: Supervisor/Manager/Owner membuka dengan PIN-nya → hanya pergantian kasir (tutup shift); draf keranjang dibuang; audit override (BR-AUT-015).

### FLOW-21 — Pembaruan Aplikasi dan Kompatibilitas Kontrak

1. Rilis baru (mis. v1.6.0, kontrak 8): server mengumumkan kontrak terkini = 8 dan versi minimum (BR-VER-002) pada tiap respons sync.
2. Klien membandingkan: kontrak 7 (< terkini, ≥ minimum) → banner pembaruan + dialog 2 jam; tombol "Perbarui" aktif **hanya di momen aman** (BR-VER-004).
3. Pengguna menekan "Perbarui" di momen aman → service worker baru aktif, Dexie bermigrasi, payload `PENDING` dinaikkan ke kontrak 8 (BR-VER-005), aplikasi dimuat ulang; layar tetap terkunci bila sebelumnya terkunci.
4. Sync berikutnya mengirim perintah dengan `app_version` dan `contract_version` baru (BR-VER-008).
5. Bila versi minimum dinaikkan dan klien tertinggal: perintah ditahan, banner wajib, shift baru diblokir; pembaruan keras berjalan pada momen aman keras (EC-064/065).

### FLOW-22 — Server Di-rollback (Klien Lebih Baru daripada Server)

1. Server kembali ke kontrak 7 padahal klien berkontrak 8: respons sync mengumumkan kontrak terkini 7.
2. Klien menahan perintah kontrak 8, menampilkan banner "server sedang diperbarui"; kasir **tetap menjual** (invoice bernomor berurutan, tersimpan lokal; BR-VER-006).
3. Pull dan sinkron master tetap berjalan selama server menjawab; penahanan tidak dihitung sebagai kegagalan lease.
4. Server maju lagi ke kontrak 8 → klien mengirim antrean otomatis (FIFO); banner hilang.

### FLOW-23 — Pembuatan Tenant dan Enrollment Pertama

1. Admin platform di `/platform` membuat tenant: **nama tampilan** (maks 40 karakter), **slug** (divalidasi BR-TEN-004), dan Owner pertama; tenant berstatus `ACTIVE`.
2. Operator membuat **undangan Owner** (email + kode undangan, BR-IDN-004) dan memberikan alamat `<DOMAIN>/<slug>/admin` serta kode secara manual (alamat penerimaan `<DOMAIN>/<slug>/join`; operator dapat membatalkan/menerbitkan ulang undangan Owner di `/platform`, BR-IDN-015); Owner menerima undangan di `<DOMAIN>/<slug>/join` (membuat akun global atau memakai akun yang ada) lalu login dalam konteks tenant dari slug (BR-TEN-003, BR-IDN-002).
3. Owner mengatur entitas hukum, outlet, dan register (FLOW-01); nama tampilan tenant sudah diisi operator (tidak ada layar nama di `/admin` untuk Owner).
4. Owner membuat kode pairing (sekali pakai, 15 menit); QR memuat alamat `<DOMAIN>/<slug>/pos` + kode pada fragmen `#` (BR-TEN-007).
5. Perangkat memindai QR → `/<slug>/pos` terbuka dan kode pairing diambil dari fragmen URL (atau diketik manual bila kamera tak dapat memindai) → enrollment (BR-AUT-002) → credential terikat tenant; aplikasi dapat dipasang sebagai PWA bernama tenant.

### FLOW-24 — Tenant Ditangguhkan dan Diaktifkan Kembali

1. Admin platform menangguhkan tenant → status `SUSPENDED`.
2. Sesi back-office aktif dihentikan; halaman tenant menampilkan "tidak tersedia"; sync/push ditolak `TENANT_SUSPENDED`.
3. Perangkat yang sedang offline tetap bekerja sampai lease 7 hari habis, lalu terkunci; transaksi tersimpan dan dapat diekspor.
4. Admin platform mengaktifkan kembali → perangkat sync, perintah pending terkirim (BR-TEN-005).

### FLOW-25 — Penanganan Error Berjenjang dan Pelaporan

1. Sistem mengklasifikasikan kejadian: aturan bisnis (a), gangguan sementara (b), atau kesalahan sistem/kondisi diketahui (c) (BR-ERR-001).
2. (a) → pesan jelas tanpa kode. (b) → indikator + percobaan ulang otomatis tanpa dialog. (c) → pesan + `KODE#id` + satu kalimat tindakan + tombol Salin; log `error` dengan ID yang sama (server: ID server; device: ID lokal `D-…`).
3. Kasir menyalin `KODE#id` dan mengirim manual (WhatsApp/telepon) ke admin/developer (BR-ERR-005).
4. Developer menjalankan skrip pencarian dengan ID itu (atau `localId`) → baris access/sync/error beserta stack yang diterjemahkan ke berkas sumber lewat source map (BR-ERR-011). Bila error lahir di device offline, pencarian baru berhasil setelah device sync.
5. Developer menanyakan balik konteks aktivitas kasir bila log belum cukup (konsekuensi BR-ERR-005).

### FLOW-26 — Pemulihan Crash Render dan Gagal Start

1. Crash render di satu area → boundary menampilkan pengganti kecil `APP_ERROR#D-…`; area lain berfungsi; draf keranjang/bill sudah tersimpan di Dexie.
2. Kasir menekan **Muat ulang** (tidak ada muat ulang otomatis) → kembali ke titik yang sama; layar yang terkunci tetap terkunci.
3. Bila seluruh layar tidak pulih → layar pemulihan: kode, **Muat ulang**, **ekspor transaksi pending**.
4. Aplikasi gagal start → service worker kembali ke versi terakhir yang berfungsi dan mencatat log → bila tetap gagal, layar **"Reset aplikasi"** (online): cache aplikasi dan service worker dibersihkan; **Dexie tidak disentuh**; aplikasi diunduh ulang dan antrean pending terkirim.

### FLOW-27 — Notifikasi Operasional

1. Error fatal ditulis ke log (BR-LOG-012) → notifikasi Telegram (kode, ID, jenis, versi).
2. Pemantau uptime eksternal memanggil `/health`; gagal (503/tak merespons) → notifikasi.
3. Penghitung `INTERNAL_ERROR` mencapai ambang (≥ 10 dalam 5 menit) → satu notifikasi ringkas.
4. Batas frekuensi: 1 pesan per jenis per 10 menit; isi tanpa data pelanggan.

### FLOW-28 — Undangan Anggota: Kode Sekali Pakai (OQ-36 terjawab)

1. Owner membuat undangan di `/<slug>/admin`: email + peran (+ outlet) → sistem menampilkan **kode undangan** (sekali pakai, terikat email, 72 jam); respons sama untuk email yang sudah/belum punya akun.
2. Owner membagikan kode (10 karakter berkelompok, mis. `K7Q2M-9XD4R`) secara manual (mis. WhatsApp/lisan). **Owner tidak pernah melihat atau menetapkan password.**
3. Penerima membuka **`/<slug>/join`** dan mengisi **satu formulir**: email + kode + password (**password baru** bila belum punya akun, **password akun saat ini** bila sudah punya; formulir dan pesan sama untuk keduanya).
4. Bila valid → keanggotaan dibuat dan penerima masuk (sesi untuk slug itu); bila tidak → pesan generik (dibatasi per IP dan slug).
5. Owner mengelola undangan yang belum diterima di tab **Pengguna → Undangan tertunda**: **Batalkan**, atau **Terbitkan ulang** (kode baru, kode lama tidak berlaku; mis. undangan kedaluwarsa 72 jam); setiap aksi diaudit (BR-IDN-015).

### FLOW-29 — Reset Password: Kode Sekali Pakai (OQ-35/36 terjawab)

1. Owner memilih anggota tenantnya → sistem memeriksa keanggotaan akun itu.
2. Akun **hanya di tenant ini dan tanpa undangan aktif dari tenant lain** → sistem menampilkan **kode reset** (sekali pakai, terikat email, 24 jam); Owner membagikannya manual; **Owner tidak pernah melihat atau menetapkan password**. Owner mengirim alamat `<DOMAIN>/<slug>/reset` + kode; penerima memasukkan email + kode + password baru pilihannya sendiri di halaman itu; semua sesi akun dipaksa keluar (tanpa login otomatis); audit dicatat (BR-IDN-014).
3. Akun **multi-tenant** (termasuk yang punya **undangan aktif ke tenant lain**) atau bukan anggota tenant ini → ditolak dengan pesan generik **"hubungi operator platform"** (tidak mengakui bahwa akun itu multi-tenant); jalur: operator platform atau pemilik akun mengganti passwordnya sendiri.
4. Owner lupa password, atau akun multi-tenant → operator platform menerbitkan kode reset setelah verifikasi identitas di luar sistem, **memakai konteks salah satu tenant tempat akun menjadi anggota**; sesi dipaksa keluar; audit.

### 8.19 Perbedaan Alur Retail vs F&B

| Aspek | Retail | F&B |
|---|---|---|
| Unit kerja | Keranjang → langsung dibayar | **Open bill** per meja → dibayar belakangan |
| Pembuatan item | Scan barcode / pilih SKU | Pilih menu + **modifier** |
| Meja | Tidak ada | Master meja; status turunan; banyak bill per meja boleh |
| Kepemilikan | Transaksi milik register | Bill dimiliki **satu device (lease)**; device lain read-only; tanpa take-over; pemegang dapat **menyerahkan secara sukarela** ke register kasir (BR-FNB-012) |
| Nomor invoice | Saat bayar | Saat bayar (tiap **bill anak** punya nomor); open bill hanya punya `bill_ref` |
| Split / merge | Tidak ada | Split (item/kuantitas/bagi rata) dan merge (syarat satu pemegang) |
| Pembayaran | Satu atau banyak metode, langsung | Satu atau banyak metode **per bill/anak** |
| Stok | Mengurangi stok SKU saat bayar | Mengonsumsi **bahan resep** saat bayar (BR-RCP-005); menu tanpa resep tidak mengurangi stok |
| HPP | Rata-rata SKU saat server memproses | Σ rata-rata bahan menurut resep + modifier |
| Pajak | PPN (entitas PKP), umumnya **inklusif/eksklusif per outlet** | PB1 (tarif per outlet) + **service charge** (kena pajak/tidak per outlet) |
| Diskon | Item/bill, batas role | Sama; diskon bill dialokasikan ke anak saat split |
| Barcode | Inti alur (scanner/kamera) | Opsional (menu umumnya dipilih dari layar) |
| UOM/Varian | Multi-UOM, varian (ukuran/warna) | Tidak utama (porsi) |
| Struk | Invoice satu dokumen | Pra-bill (tanpa nomor) + invoice per bill anak |
| Retur | Nota kredit, default `KEMBALI_STOK` | Nota kredit, default `BUANG` untuk menu ber-resep |
| Shift | Sama; shift saat bayar, shift tertutup bisa menyisakan bill terbuka | Shift tertutup boleh meninggalkan open bill (dibayar di shift berikutnya, register sama) |
| Kegagalan device | Penjualan final sudah aman begitu terkirim | Open bill menunggu pemegang (risiko diterima, RSK-04) |
| Fase | F3 | F5 |

---

## 9. Edge Cases & Kebijakan Konflik

Prinsip umum: **fakta yang sudah terjadi diterima (AP-02)**; hanya masalah **struktural/otorisasi** yang masuk antrean "perlu perhatian". Server memutuskan hasil akhir (AP-01).

| ID | Situasi | Kebijakan | Contoh |
|---|---|---|---|
| EC-001 | Produk dinonaktifkan/dihapus saat device offline masih menjualnya | Penjualan **diterima**; baris diberi flag "item nonaktif" | Kopi dinonaktifkan 13:00; device offline menjual 14:00 → diterima, tampil di laporan penyimpangan |
| EC-002 | Harga berubah saat offline | Snapshot harga lama dipakai; server menandai selisih (BR-PRC-003) | Rp18.500 vs Rp19.000 × 2 → selisih −1.000 |
| EC-003 | Stok minus | Diterima + flag; diselesaikan opname (BR-STK-002) | 3 pcs terjual 5 → −2 |
| EC-004 | Perintah terkirim dua kali (timeout/retry) | Idempotency key sama → hasil lama dikembalikan, tanpa efek ganda | Sale `0192…` dikirim 2× → satu invoice, satu movement |
| EC-005 | Tarif pajak berubah | Konfigurasi ber-`berlaku_mulai`; device memilih tarif menurut `business_date`; tarif disalin ke transaksi (BR-TAX-001) | PPN berubah berlaku 1 Jan; sale 2 Jan offline memakai tarif baru bila konfigurasi sudah tersinkron; bila belum, tarif lama tersimpan sebagai fakta + flag "tarif berbeda" |
| EC-006 | Update app di tengah antrean | Server menerima skema N dan N−1; migrasi payload outbox (BR-SYN-022) | 12 perintah v7 pending, app jadi v8 → tetap diterima |
| EC-007 | Skema perintah terlalu lama (di luar jendela dukungan minimal 30 hari) dan tidak termigrasi | Perintah ditahan; device diminta update; shift baru diblokir (BR-SYN-003); bila payload tidak dapat dimigrasi → `NEEDS_ATTENTION` + ekspor file tersedia | — |
| EC-008 | Storage browser dibersihkan sebelum sync | Transaksi pending **hilang**; nomor invoice **bolong** (risiko residual diterima, RSK-02); pemulihan register + gap (BR-INV-008) | Nomor 000125–000127 hilang → gap tercatat bila manager mengisi nomor struk fisik |
| EC-009 | Kuota storage hampir penuh | Peringatan >70% (BR-SYN-054); bersihkan transaksi tersinkron tertua >3 bulan; **pending tidak pernah dibuang** | — |
| EC-010 | Jam device salah | `business_date` memakai waktu terkoreksi offset; |offset|>10 mnt → peringatan; jam mundur → kunci (BR-TIM-006, BR-AUT-013) | Jam cepat 7 menit → dikoreksi |
| EC-011 | Device dicabut saat masih ada pending | Perintah ditolak otorisasi → "perlu perhatian"; manager dapat menerima manual / impor file ekspor (FLOW-16) | — |
| EC-012 | Akses staf dicabut tetapi device offline | Tetap bisa login hingga device online lagi atau lease 7 hari habis (BR-AUT-010) | Staf dicabut Senin 09:00; device offline sampai Selasa → masih bisa login |
| EC-013 | Lease 7 hari habis di tengah shift | Device terkunci sampai sync; pending tetap bisa diekspor; setelah sync, kerja dilanjutkan | — |
| EC-014 | Dua device offline membuka bill di meja yang sama | Dua bill sah; flag "bill ganda pada meja" (BR-FNB-007) | Meja 5: bill T1 dan bill T2 |
| EC-015 | Bill yatim | Tanpa pemulihan (BR-FNB-004); laporan "tanpa pemegang aktif" | Skenario BR-FNB-004 |
| EC-016 | Retur invoice register lain tanpa jaringan | Ditolak, butuh online (BR-RTR-004) | Invoice dari POS01, retur di POS02 offline → tidak bisa |
| EC-017 | Retur di luar jendela 3 bulan | Ditolak (tidak dapat dibuat nota kredit) | Invoice 2026-08-15, hari ini 2026-11-16 → ditolak |
| EC-018 | Void setelah shift ditutup | Tidak boleh; gunakan retur/nota kredit (BR-INV-005) | — |
| EC-019 | Printer gagal/tidak terhubung | Penjualan tetap tersimpan; `print_job` ditandai gagal; cetak ulang tersedia (AP-10) | Kertas habis → struk dicetak ulang kemudian |
| EC-020 | Aplikasi tertutup/crash saat konfirmasi bayar | Transaksi IndexedDB atomik: terjadi seluruhnya atau tidak sama sekali; tidak ada nomor hangus | Crash di langkah 8 FLOW-04 → keranjang masih ada, nomor tidak terpakai |
| EC-021 | Dua tab/instance `/pos` pada device yang sama | **Hanya satu instance aktif** (Web Locks, `DIUSULKAN`); instance kedua read-only/ditolak, mencegah balapan counter invoice | — |
| EC-022 | Cursor terlalu tua / tombstone dibersihkan | Full resync (BR-SYN-010 poin 6); outbox tidak disentuh | FLOW-15 |
| EC-023 | Master dihapus tetapi transaksi lama merujuknya | Soft delete; transaksi memegang snapshot nama/harga | — |
| EC-024 | Faktor konversi UOM diubah | Berlaku ke depan; baris lama punya faktor snapshot (BR-UOM-006) | 1 dus 12 → 10 pcs: invoice lama tetap 12 |
| EC-025 | Mode inklusif/eksklusif outlet diubah | Hanya untuk transaksi berikutnya; snapshot mode tersimpan pada transaksi lama | — |
| EC-026 | Jam potong atau zona waktu outlet diubah | Hanya berlaku ke depan; `business_date` lama tidak diturunkan ulang (BR-TIM-004) | — |
| EC-027 | Perintah gagal struktural menahan perintah dependen | Hanya yang bergantung yang ditahan; sisanya berjalan (BR-SYN-023/030) | Invoice X gagal → nota kredit untuk X ditahan, penjualan lain tetap jalan |
| EC-028 | Kuantitas hasil konversi tidak sah | Ditolak saat input (BR-UOM-004/005) | 0,35 dus → 4,2 pcs untuk pcs bulat → ditolak |
| EC-029 | Hitungan server berbeda dari client | Angka client tetap disimpan; selisih ditandai (BR-MNY-007) | Selisih Rp1 → flag "selisih hitung", masuk uji |
| EC-030 | Transfer `SENT` tak pernah diterima | Manager menutup dengan `qty_terima=0`; selisih dicatat (BR-TRF-004) | 40 pcs / Rp328.333 → selisih seluruhnya |
| EC-031 | Opname bersamaan dengan penjualan | Delta terhadap snapshot (BR-STK-031) | 80 → fisik 77, terjual 5 → 72 |
| EC-032 | Barcode ganda saat input master | Ditolak simpan (BR-CAT-006) | — |
| EC-033 | Tutup shift saat masih ada transaksi pending | Diizinkan; rekap server "belum lengkap" hingga semua perintah masuk (BR-SHF-008) | — |
| EC-034 | Device lama yang sudah dipulihkan muncul lagi dengan antrean | Ditolak otorisasi; konflik nomor ditangani manual (BR-INV-009) | Nomor 000125 dipakai device baru dan device lama |
| EC-035 | Pembayaran non-tunai melebihi sisa | Ditolak; hanya tunai yang menghasilkan kembalian (BR-PAY-003) | QRIS 150.000 untuk tagihan 135.655 → tidak boleh |
| EC-036 | Perubahan hak akses/role tersinkron saat staf sedang bekerja | Berlaku pada sinkronisasi berikutnya; sesi berjalan tidak dipaksa keluar kecuali dicabut (`DIUSULKAN`) | — |
| EC-037 | Selisih kas besar | Hanya dicatat; tidak memblokir penutupan; terlihat di laporan (BR-SHF-005) | −2.100 |
| EC-038 | Harga produk tidak ada di outlet | Tidak dapat dijual (BR-PRC-002); **bukan** berarti item tidak tersedia (BR-CAT-009) | "harga belum diatur" |
| EC-039 | Produk dinonaktifkan **global** padahal tersedia di beberapa outlet | Nonaktif global menang; baris penugasan tetap tersimpan; reaktivasi mengembalikan status penugasan terakhir (BR-CAT-016) | Kaos `is_active=false` → hilang di A, B, C; aktif lagi → A 8, B 5, C 8 seperti sebelumnya |
| EC-040 | Produk `UNAVAILABLE` di outlet tetapi ada override SKU `AVAILABLE` | Override menang; hanya SKU itu yang tampil (BR-CAT-016, OQ-27a terjawab) | Kaos @C: hanya `KAOS01-L-HTM` |
| EC-041 | Produk diubah `UNAVAILABLE` → `AVAILABLE` saat override SKU `UNAVAILABLE` masih ada | Override tetap berlaku sampai dihapus; tidak otomatis ikut induk | Kaos @B kembali tersedia tetapi 3 SKU Merah tetap tersembunyi |
| EC-042 | SKU baru ditambahkan pada produk yang memiliki pengecualian per SKU | Mengikuti status produk per outlet; tidak mewarisi override SKU lain (BR-CAT-011) | XL-Merah tampil di B walau S/M/L-Merah dikecualikan |
| EC-043 | Penjualan offline setelah item dinonaktifkan tetapi sebelum device menerima perubahan | **Diterima** sebagai fakta; flag `item_tidak_tersedia` di R-04 (BR-CAT-013) | Contoh 3: 2 pcs Rp150.000 diterima, saldo −1/−40.000 |
| EC-044 | Penjualan offline **sebelum** perubahan di-commit | Sah; tidak ditandai | Penjualan 12:30 vs perubahan 13:00 |
| EC-045 | Item dipakai sebagai bahan resep/BOM di outlet yang tidak menjualnya | Konsumsi resep tidak pernah ditolak (invarian BR-CAT-018); tanpa validasi konfigurasi tambahan (OQ-25 terjawab) | Beras `UNAVAILABLE` di OUT-D; 2 Nasi Goreng tetap mengonsumsi 300 g (HPP 4.200 untuk beras) |
| EC-046 | Stok minus / in-transit pada item yang tidak tersedia | Saldo utuh; transfer masuk/keluar tetap boleh; stok minus diberi flag ganda; selesai lewat opname (BR-CAT-017) | Transfer 40 pcs ke outlet yang menyembunyikan item itu tetap dapat diterima |
| EC-047 | Memindai barcode item yang tidak tersedia di outlet | Tidak masuk keranjang; pesan "{nama} tidak tersedia di outlet ini"; beda dari "barcode tidak dikenal" (BR-CAT-015, OQ-27b terjawab) | Scan `8999999000100` di C |
| EC-048 | Outlet baru dibuat setelah item ada | Default tersedia, satu transaksi satu versi (BR-CAT-011, OQ-24) | OUT04: 4.000 baris `AVAILABLE` |
| EC-049 | Dua admin mengubah ketersediaan item/outlet yang sama bersamaan | Penulis master diserialkan oleh counter versi; commit terakhir menang; keduanya tercatat di audit (BR-SYN-010) | Versi 131 lalu 132 |
| EC-050 | Device belum memiliki baris penugasan (pull belum selesai / sebelum full resync tuntas) | Dianggap `AVAILABLE`; layar jual baru diperbarui setelah seluruh siklus pull diterapkan (BR-CAT-014) | — |
| EC-051 | Retur atas invoice lama yang memuat item yang kini tidak tersedia | Diperbolehkan; disposisi stok normal (BR-CAT-020) | Retur 1 dari 3 Kopi di C |
| EC-052 | Open bill berisi item yang kemudian dinonaktifkan di outlet | Item yang sudah ada tetap dibayar; penambahan baru diblokir setelah device menerima perubahan (BR-CAT-020) | — |
| EC-053 | Item tidak tersedia tetapi masih memiliki harga/tidak | Dua dimensi independen; harga tidak dihapus (BR-CAT-009) | harga Kopi@C Rp18.500 tetap tersimpan walau tersembunyi |
| EC-054 | Item open price dijual tanpa harga master | Diizinkan; kasir wajib mengetik harga (BR-PRC-007); pengecualian atas BR-PRC-002 | "Jasa Pengiriman" Rp12.500 |
| EC-055 | Kasir mengetik harga 0 atau kosong pada item open price | Ditolak (harus bilangan bulat > 0); untuk gratis gunakan diskon | Input 0 → "harga wajib diisi" |
| EC-056 | Penanda open price di master diubah setelah ada penjualan | Baris lama tetap memakai snapshot penanda dan harga; tidak diubah (BR-PRC-007) | Jasa Pengiriman tidak lagi open price → invoice lama tetap bertanda open price |
| EC-057 | Retur atas baris open price | Memakai angka tersimpan pada baris (harga diketik, diskon, alokasi pajak) seperti baris lain (BR-RTR-006) | Retur 1 × Jasa Pengiriman = 12.500 + alokasi pajak tersimpan |
| EC-058 | Waiter ingin menyerahkan bill saat offline | Tombol nonaktif "serah-terima membutuhkan internet"; bill tetap milik pemegang dan boleh diedit (BR-FNB-012) | Rina offline → tetap tambah item; serahkan setelah online |
| EC-059 | Ada event bill yang belum terkirim saat serah-terima | Serah-terima tidak dapat dimulai sampai seluruh event bill diterima server (BR-FNB-012 butir 1) | 2 item pending → serahkan setelah `ACK` |
| EC-060 | Register kasir tujuan offline/rusak/tidak merespons | Bill tetap menunggu dan tetap milik pengirim; pengirim membatalkan lalu memilih tujuan lain (BR-FNB-012 butir 3) | POS01 mati → batalkan, serahkan ke POS02 |
| EC-061 | Kasir menerima dan pengirim membatalkan bersamaan | Server memutuskan menurut urutan commit; yang kalah ditolak dengan pesan jelas | `BILL_ACCEPTED` commit lebih dulu → pembatalan ditolak |
| EC-062 | Idle-lock aktif saat pembayaran atau dialog PIN supervisor | Pengatur waktu berhenti; layar tidak terkunci di tengah pembayaran (BR-AUT-015) | Dialog PIN supervisor terbuka 12 menit → tidak terkunci |
| EC-063 | Staf yang mengunci tidak hadir, kasir lain perlu masuk | Hanya supervisor+ yang dapat membuka untuk pergantian kasir (tutup shift); draf dibuang; audit override (BR-AUT-015) | Budi menutup shift Dewi |
| EC-064 | Klien kontrak 7 tidak diperbarui sampai di luar jendela 30 hari | Banner wajib; perintah kontrak 7 ditahan (tidak hilang); shift baru diblokir; pembaruan keras hanya pada momen aman keras (BR-VER-003/004) | TAB-02 pada 2 Januari: 9 perintah ditahan, terkirim setelah update |
| EC-065 | Pembaruan keras jatuh tempo saat shift masih terbuka | **Tidak dipaksa**; menunggu shift ditutup; selama menunggu perintah tetap ditahan bila di bawah minimum (BR-VER-004) | Shift Dewi dibuka 08:00 hingga 22:00 → update 22:00 |
| EC-066 | Outbox belum kosong saat momen aman | Pembaruan menunggu; sync dipicu bila online; bila offline/tak aman → ditunda; pembaruan keras hanya bila outbox kosong atau terkunci aman (BR-VER-004/005) | 3 perintah `PENDING` termigrasi dan tanpa `SENDING` → boleh |
| EC-067 | Server di-rollback sehingga klien lebih baru dari server | Perintah kontrak yang tak dikenal ditahan; banner "server sedang diperbarui"; penjualan tetap tersimpan lokal; terkirim otomatis setelah server cocok (BR-VER-006) | Server kontrak 7 pada 10 Des; 3 invoice `…-1226-000012..14` (kontrak 8) tersimpan, terkirim 11 Des |
| EC-068 | Perintah baru dibuat klien kontrak 8 saat server kontrak 7 | Tersimpan dengan `contract_version=8`, ditahan; tidak diturunkan format (BR-VER-006) | — |
| EC-069 | Flag fitur diubah Owner saat device offline | Memakai nilai terakhir; berlaku setelah pull; penjualan yang sah tetap diterima (BR-VER-009) | `fnb_serah_terima` aktif 10:00, tablet offline sampai 11:15 |
| EC-070 | Perubahan skema non-aditif dibutuhkan | Tahap bertahap (tambah → isi → baca baru); hapus setelah jendela dukungan berakhir; dump penuh bila menyentuh data lama (BR-VER-011) | Ganti nama `schema_version` → paling cepat 31 Desember |
| EC-071 | Hotfix PATCH mengubah angka | Jalur cepat setelah tes otomatis kunci lolos; **tetap wajib** catatan rilis "Perubahan angka"; PATCH tidak menaikkan kontrak (BR-VER-001/010) | v1.6.1: pajak per bill, 348 → 347 |
| EC-072 | Layar terkunci dengan shift terbuka dan pembaruan tersedia | Tombol "Perbarui" aktif di layar kunci (inisiatif pengguna); **tidak** ada pembaruan paksa; setelah reload tetap terkunci (BR-VER-004/012) | Dewi menekan "Perbarui" di layar PIN, shift tetap terbuka |
| EC-073 | Akun bukan anggota tenant B membuka URL slug tenant B | Ditolak tanpa data tenant mana pun; pesan generik; dicatat di log (BR-TEN-002, BR-IDN-002) | `citra@example.id` (hanya `acme`) → `/beta/admin` ditolak |
| EC-074 | Slug dengan huruf kapital atau garis miring akhir | **308 ke huruf kecil kanonis** satu bentuk garis miring akhir (BR-TEN-009) | `/ACME/pos` dan `/acme/pos/` → `/acme/pos` |
| EC-075 | Pembuatan tenant dengan slug terlarang atau tidak valid | Ditolak (BR-TEN-004) | `admin`, `pos`, `platform`, `ab`, `-acme` ditolak; `acme` diterima |
| EC-076 | Satu email menjadi anggota dua tenant | Satu akun global dengan dua keanggotaan; satu password; **login terpisah per tenant** (cookie sesi per slug) (BR-IDN-001/002) | `ani@example.id` Kasir `acme` + Owner `beta` |
| EC-077 | Slug tidak dikenal atau root `/` | 404 generik, bentuk sama (BR-TEN-005) | `/xyz/pos` dan `/` → 404 |
| EC-078 | Tenant ditangguhkan saat device offline | Device bekerja sampai lease 7 hari habis; saat online sync ditolak `TENANT_SUSPENDED`; transaksi pending tetap, terkirim setelah aktif lagi (BR-TEN-005) | `beta` ditangguhkan 1 Des; TAB-09 sampai 7 Des 20:00 |
| EC-079 | Satu tablet dipakai dua tenant | Penyimpanan lokal terpisah total; data tidak terlihat lintas tenant; sesi back-office global tetapi akses per keanggotaan (BR-TEN-006) | TAB-09: pending `acme` tak terlihat di `beta` |
| EC-080 | Membuka slug tenant yang belum di-enroll di perangkat itu | "Perangkat belum terdaftar pada tenant ini"; enrollment butuh online (BR-TEN-006) | TAB-10 membuka `/beta/pos` tanpa enrollment |
| EC-081 | Staf salah mengetik slug saat membuka POS | 404 generik atau halaman tenant lain; tidak ada data yang terbuka karena login/credential tenant harus cocok (BR-TEN-002/003) | `/acmee/pos` → 404 |
| EC-082 | Slug perlu diganti (mis. rebranding) | Tidak bisa; buat tenant baru (BR-TEN-004); migrasi data antar-tenant di luar MVP | `acme` → `acme-coffee` = tenant baru |
| EC-093 | Membuka `/<slug>` tanpa `/pos` atau `/admin` | Halaman pemilih "Terminal Kasir"/"Back-office" dengan nama tenant; tidak membocorkan tenant lain (BR-TEN-012) | `/acme` → pemilih "Acme Coffee" |
| EC-094 | Email sudah punya akun global lalu diundang ke tenant lain | Tidak dibuat akun kedua; keanggotaan baru dibuat setelah penerimaan (BR-IDN-004); respons ke pengundang tidak membocorkan keberadaan akun | `ani@example.id` diundang `acme` setelah punya akun di `beta` |
| EC-095 | Owner tenant A menerbitkan kode reset untuk akun multi-tenant | **Ditolak** dengan pesan generik "hubungi operator platform" yang tidak mengakui akun multi-tenant; hanya operator platform atau pemilik akun (BR-IDN-005, OQ-35 terjawab) | Budi (Owner `acme`) → `ani@example.id` (juga Owner `beta`) ditolak |
| EC-096 | Perubahan nama tampilan tenant | Hanya lewat operator platform; tidak ada layar nama di `/admin` untuk Owner; maksimum 40 karakter (BR-TEN-007/008) | "Acme Coffee" → "Acme Coffee Roasters" oleh operator |
| EC-097 | Nama tampilan tenant lebih dari 40 karakter | Ditolak saat pembuatan/perubahan oleh operator (BR-TEN-007/008) | Nama 41 karakter → ditolak; 40 karakter → diterima |
| EC-098 | Kata terlarang dicoba sebagai slug | Ditolak oleh konstanta daftar terlarang; diuji lewat uji rute (BR-TEN-004) | `admin`, `pos`, `platform`, `health` ditolak |
| EC-099 | Slug yang sudah tersimpan dicoba diubah (aplikasi atau SQL langsung) | Ditolak: aplikasi tidak punya fungsi ubah slug dan **trigger database** menolak perubahan (BR-TEN-004) | `UPDATE` slug `acme` → `acme-coffee` ditolak |
| EC-100 | Satu outlet dengan banyak tablet di satu IP publik/NAT | Batas API per `device_id`, bukan IP; satu tablet ramai tidak menghambat lainnya (BR-RLM-002/004) | 5 tablet, masing-masing 60 `push`/menit |
| EC-101 | Login admin gagal berulang (akun ada, bukan anggota, atau tidak ada) | Jeda progresif per email lintas slug; pesan "Coba lagi dalam sekitar N menit" **sama** untuk ketiganya; tanpa penguncian permanen (BR-RLM-003) | `dewi@example.id` ke-8 gagal di `acme` → 15 menit; email tak terdaftar → pesan sama |
| EC-102 | Penyerang terus gagal pada email korban | Pemilik akun tertunda maksimal 15 menit **di semua tenant** (celah yang **diterima tanpa mitigasi**, hanya log; OQ-34) (BR-RLM-003) | Penyerang menunda `dewi@example.id` di `acme` dan `beta` |
| EC-103 | Banjir push serentak | `429` + `Retry-After` berjitter; klien menunggu, tidak menaikkan percobaan, tidak "perlu perhatian", tanpa dialog (BR-RLM-005) | 12 tablet 08:00 → 4 menerima `429`, semua sukses ±10 dtk |
| EC-104 | Full resync kedua dalam satu jam | `429` + `Retry-After`; klien tetap memakai katalog lama; device baru tanpa katalog tidak terkena (BR-RLM-006) | TAB-03: 10:00 diterima, 10:40 ditolak, 11:05 diizinkan |
| EC-105 | Tebakan kode pairing terdistribusi | Tertahan per slug (±30/5 menit); kode 32⁸, 15 menit, sekali pakai (BR-RLM-009) | 1.000 IP → ≤ ±90 tebakan/15 menit |
| EC-106 | Server restart menghapus penghitung | Diterima; Nginx menahan banjir kasar; kode pairing tahan (BR-RLM-012) | Restart 14:00 → penghitung 0 |
| EC-107 | Laporan berat ketiga di satu tenant | Diminta menunggu; tenant lain tidak terpengaruh (BR-RLM-007) | 3 manager `acme` → 1 menunggu |
| EC-108 | Tanggal tablet dimundurkan saat PIN dijeda | Jeda memakai jam monotonik; tidak berkurang (BR-RLM-010, BR-AUT-013) | Mundur 1 hari → jeda 5 menit tetap |
| EC-109 | Header `X-Forwarded-For` palsu dari luar | Diabaikan; IP dibaca dari header Nginx tepercaya (BR-RLM-001) | Header palsu tidak mengubah IP terbaca |
| EC-110 | Percobaan login `/platform` berulang | Akun platform terpisah + batas umum per IP; tanpa pembatasan IP khusus (risiko diterima, BR-RLM-008) | — |
| EC-111 | Akun global dikeluarkan dari satu tenant | Keanggotaan dihapus; akun tetap untuk tenant lain; sesi untuk tenant itu berakhir pada permintaan berikutnya (BR-IDN-006) | Ani dikeluarkan dari `acme`, tetap Owner `beta` |
| EC-112 | Mengeluarkan atau menurunkan Owner terakhir | Ditolak: tenant minimal satu Owner (BR-IDN-006) | Owner tunggal `acme` tidak dapat dikeluarkan |
| EC-113 | Kode undangan salah, kedaluwarsa, atau terpakai | Pesan generik yang sama; dibatasi per IP dan per slug (BR-IDN-004) | Kode `K7Q2M-9XD4R` setelah 72 jam → pesan generik |
| EC-114 | Penerima undangan memasukkan password salah untuk akun yang sudah ada | Pesan generik sama; keanggotaan tidak dibuat; dihitung ke batas login (BR-IDN-004) | Ani salah password → tidak menjadi Kasir `acme` |
| EC-115 | Staf non-email (PIN-only) mencoba login `/admin` | Tidak memiliki akun; hanya PIN di terminal (BR-IDN-001) | Kasir tanpa email hanya masuk di POS |
| EC-116 | Pengundang membandingkan respons untuk email yang sudah/belum punya akun | Respons identik; tidak membocorkan keberadaan akun (BR-IDN-004) | `ani@` dan `baru@` → respons sama |
| EC-117 | Owner menerbitkan kode reset untuk akun satu-tenant | Diizinkan: kode reset sekali pakai, terikat email, 24 jam; penerima menetapkan password sendiri; tanpa password sementara; diaudit; semua sesi akun dipaksa keluar (BR-IDN-005) | Budi → `citra@example.id` (hanya `acme`) |
| EC-118 | Akun multi-tenant mengganti passwordnya sendiri | Berlaku untuk semua tenant; sesi lain dipaksa keluar (BR-IDN-005) | Ani ganti password → `acme` dan `beta` memakai yang baru |
| EC-119 | Dua tenant di satu browser dan logout | Cookie sesi per slug: login terpisah per tenant; logout hanya mengakhiri sesi tenant itu (BR-IDN-002, OQ-37) | Logout di `/beta/admin` → `/acme/admin` tetap login |
| EC-120 | Email salah ketik pada undangan (tanpa verifikasi email) | Tanggung jawab pengundang; undangan dapat dibatalkan dan dibuat ulang; akun dibuat atas email yang diketik penerima saat menerima (BR-IDN-003/004) | `ani@exmple.id` → batalkan dan undang ulang |
| EC-121 | Owner mencoba mengganti email anggota | Ditolak: ganti email hanya oleh pemilik akun (dengan password) atau operator platform (BR-IDN-011) | Budi tidak dapat mengubah email Citra |
| EC-122 | Kegagalan login di satu tenant memengaruhi tenant lain | Kunci rate limit = email lintas slug; jeda berlaku di semua tenant (BR-RLM-003, BR-IDN-009) | 8 gagal di `acme` → `beta` juga 15 menit |
| EC-123 | Anggota dikeluarkan lalu jejak audit dibuka | Penunjuk identitas tetap tersimpan; nama tampil, email tidak ditampilkan lagi (BR-IDN-006/012) | Ani keluar dari `acme`; audit lama masih menunjuk Ani |
| EC-124 | Ganti atau reset password akun multi-tenant | Berlaku untuk semua tenant; semua sesi di semua slug dipaksa keluar (BR-IDN-002/005) | Ani ganti password → login ulang di `/acme` dan `/beta` |
| EC-125 | Penerbit menukar sendiri kode undangan untuk email yang belum punya akun (pra-klaim) | **Risiko diterima di MVP**: akun terbentuk hanya di tenant penerbit; tercatat audit; operator dapat mereset (BR-IDN-013, RSK-19) | Budi menukar kode `rina@example.id` dengan password pilihannya |
| EC-126 | Pemilik email sebenarnya diundang tenant lain setelah dipra-klaim | Penukaran menuntut password akun yang tidak ia ketahui → pesan generik; ia melapor operator; operator mereset lewat konteks tenant tempat akun menjadi anggota (BR-IDN-013/005) | Rina diundang `beta` → gagal → operator mereset via `acme` |
| EC-127 | Owner mencoba mereset akun yang punya undangan aktif ke tenant lain | Ditolak (akun dianggap multi-tenant sejak undangan terbit): pesan generik "hubungi operator platform" (BR-IDN-005) | `rina@` hanya di `acme`, lalu diundang `beta` → Budi ditolak |
| EC-128 | Baris undangan/kode lama setelah kedaluwarsa atau terpakai | Dibersihkan 7 hari setelah kedaluwarsa atau terpakai; kode lama tetap tidak dapat dipakai (BR-IDN-004 butir 6) | Kode kedaluwarsa 2026-11-12 → baris dihapus 2026-11-19 |
| EC-129 | Undangan kedaluwarsa 72 jam diterbitkan ulang | Kode baru berlaku 72 jam dari penerbitan ulang; email/peran/outlet sama; kode lama tidak berlaku; diaudit (BR-IDN-015) | `ani@` kedaluwarsa Kamis 09:00 → Terbitkan ulang Kamis 10:00 → berlaku sampai Minggu 10:00 |
| EC-130 | Terbitkan ulang saat penerima baru saja memakai kode lama | Kode lama gugur seketika; penukaran dengan kode lama → pesan generik; penerima memakai kode baru (BR-IDN-015 butir 3) | Ani menukar `K7Q2M-9XD4R` setelah kode baru terbit → pesan generik |
| EC-131 | Undangan salah alamat | Owner **Batalkan** → kode tidak berlaku, undangan hilang dari daftar, tidak dihitung sebagai keanggotaan; email tidak dapat diedit, buat undangan baru dengan email benar (BR-IDN-015) | `ani@exmple.id` dibatalkan → undang `ani@example.id` |
| EC-132 | Kode undangan dipakai di `/reset`, atau kode reset di `/join` | Pesan generik yang sama dengan kode salah; tidak ada petunjuk jenis kode (BR-IDN-014) | Citra mengetik kode undangan di `/acme/reset` → pesan generik |
| EC-133 | Kode tenant A dipakai di halaman tenant B | Pesan generik; kode terikat tenant penerbit dan email (BR-IDN-014) | Kode `acme` di `/beta/join` → pesan generik |
| EC-134 | Owner mencoba membatalkan atau menerbitkan ulang undangan tenant lain (mis. memalsukan id) | Ditolak/tidak ditemukan oleh isolasi tenant (RLS); respons generik tanpa membocorkan keberadaan (BR-IDN-015 butir 4) | Budi (`acme`) → id undangan `beta` → tidak ditemukan |
| EC-135 | Undangan sudah diterima atau barisnya sudah dibersihkan, lalu Owner mencari di daftar | Tidak tampil di "Undangan tertunda"; untuk anggota yang sudah bergabung tidak perlu undangan, bila perlu buat undangan baru (BR-IDN-015 butir 1) | `ani@` sudah menjadi Kasir → tidak ada di daftar |
| EC-136 | `/join` atau `/reset` pada slug tak dikenal atau tenant ditangguhkan | 404 generik untuk slug tak dikenal; tenant ditangguhkan mengikuti BR-TEN-005 (BR-IDN-014) | `<DOMAIN>/zzz/join` → 404 |
| EC-137 | Reset sukses lalu penerima membuka `/admin` | Semua sesi sudah berakhir dan tidak ada login otomatis; harus login dengan password baru (BR-IDN-014 butir 4) | Citra selesai di `/acme/reset` → diarahkan ke login |
| EC-083 | Klien lama menerima kode error yang belum dikenal | Menampilkan `KODE#id` dengan kalimat tindakan `INTERNAL_ERROR`; tidak crash (BR-ERR-003) | v1.5.0 menerima `KODE_BARU#…` |
| EC-084 | Kode error dihentikan | Tetap dikenali pada log dan klien lama; tidak dipakai kasus baru (BR-ERR-003) | `OLD_CODE` berstatus `DIHENTIKAN` |
| EC-085 | Kunci terjemahan kalimat tindakan hilang di satu bahasa | CI gagal; saat runtime fallback `id-ID` (BR-ERR-004, NFR-I18N-005) | `PRINT_FAILED` tanpa `en-US` → build gagal |
| EC-086 | Error terjadi offline dan dilaporkan kasir sebelum sync | Kasir menyebut `KODE#D-…`; developer baru dapat mencarinya setelah device online dan log terkirim (BR-ERR-005/006) | `PRINT_FAILED#D-20261118-140322-m4k9q` |
| EC-087 | Satu panel crash saat layar lain berfungsi | Boundary per area; area lain tetap jalan; keranjang/bill utuh setelah Muat ulang (BR-ERR-007) | Panel diskon crash, pembayaran tetap bisa |
| EC-088 | Crash saat finalisasi penjualan | Transaksi atomik: tersimpan lengkap atau tidak sama sekali; nomor invoice tidak hangus; tidak ada muat ulang otomatis (BR-ERR-007, BR-INV-004) | Nomor berikutnya tetap `…-000131` |
| EC-089 | Aplikasi gagal start setelah pembaruan | Kembali ke versi terakhir yang berfungsi di cache + log; bila gagal → layar "Reset aplikasi" tanpa menyentuh Dexie; reset hanya online (BR-ERR-008) | 12 pending tetap setelah reset |
| EC-090 | Reset aplikasi saat offline | Tombol nonaktif dengan alasan; ekspor transaksi pending tetap tersedia (BR-ERR-008) | Tanpa internet → tidak bisa reset |
| EC-091 | Klik ganda atau pengulangan aksi pengubah data setelah timeout | Tombol nonaktif saat berjalan; "Coba lagi" manual memakai kunci idempoten sehingga efek tidak ganda (BR-ERR-010) | Harga Kopi 19.000: versi master 205 → 206 sekali |
| EC-092 | Lonjakan error memicu banyak notifikasi | Dibatasi 1 pesan per jenis per 10 menit; pesan tanpa data pelanggan (BR-ERR-012) | 12 `INTERNAL_ERROR`/3 mnt → 1 pesan ringkasan; 9 → tidak ada |

---

## 10. Requirement Fungsional (per Modul)

> Prioritas P0/P1/P2 dan Fase F1–F5 mengacu Bab 0.3. Kriteria penerimaan (KP) ditulis dalam bentuk *Diberikan–Ketika–Maka* yang diringkas. Seluruh KP berangka harus lolos **persis**.

### 10.1 Tenant, Entitas & Outlet (FR-TNT)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-TNT-001 | **Admin platform** membuat tenant (organization Better Auth) lengkap dengan slug dan Owner pertama (bukan self-service) | P0 | F1 | Pembuatan tenant `acme` → ada 1 tenant, 1 Owner, slug tersimpan, dan seluruh tabel bertenant memiliki `tenant_id` | BR-TNT-001, BR-TEN-008 |
| FR-TNT-002 | CRUD entitas hukum (nama, NPWP, status PKP) | P0 | F1 | Outlet hanya dapat dibuat di bawah entitas hukum; outlet non-PKP tidak dapat memilih profil `PPN` | BR-TNT-002, BR-TAX-002 |
| FR-TNT-003 | CRUD outlet: kode, zona waktu IANA (3 pilihan), jam potong, profil pajak, tarif pajak daerah, mode harga inklusif/eksklusif, service charge (+kena pajak), unit pembulatan tunai | P0 | F1 | Ketika zona/jam potong diubah, transaksi lama tidak berubah `business_date`-nya | BR-TIM-002..004, BR-TAX-* |
| FR-TNT-004 | Isolasi data antar tenant dengan RLS | P0 | F1 | Diberikan kueri sebagai tenant A, maka 0 baris tenant B terbaca/tertulis (uji otomatis) | BR-TNT-001 |
| FR-TNT-005 | Konfigurasi tarif berlaku-mulai (tanggal bisnis) | P1 | F3 | Tarif PPN baru berlaku 1 Jan; sale `business_date` 2026-01-02 memakai tarif baru | BR-TAX-001, EC-005 |

### 10.2 Autentikasi & Otorisasi (FR-AUT)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-AUT-001 | Login back-office **hanya email** + password (Better Auth, identitas global + keanggotaan; tanpa username) | P0 | F1 | Kredensial salah → ditolak; sesi SSR hanya dapat mengakses tenant tempat akun menjadi anggota; email unik se-sistem (BR-TEN-003, BR-IDN-001) | BR-AUT-001 |
| FR-AUT-002 | Kelola anggota, role, permission, batas diskon per role, penugasan outlet | P0 | F1 | Perubahan batas diskon tersinkron ke device pada sync berikutnya dan tercatat di audit | BR-AUT-009/012 |
| FR-AUT-003 | Login PIN 4–6 digit di terminal (offline) | P0 | F3 | PIN benar → sesi terbuka tanpa jaringan; salah 5× berturut → terkunci 5 menit | BR-AUT-003..005 |
| FR-AUT-004 | Hash PIN lambat + salt per device; hash & permission disinkron | P0 | F3 | Hash PIN yang sama menghasilkan nilai berbeda di dua device | BR-AUT-004 |
| FR-AUT-005 | Persetujuan PIN supervisor (diverifikasi lokal) untuk void, diskon > batas, retur | P0 | F3 | Diskon Rp7.000 pada bill 130.500 (Kasir 5%) memicu PIN; audit memuat peminta & penyetuju; peminta ≠ penyetuju | BR-DSC-003, BR-AUT-006/007 |
| FR-AUT-006 | Lease offline 7 hari + deteksi jam mundur | P0 | F3 | Hari ke-8 tanpa sync → device terkunci; jam mundur >5 menit → terkunci | BR-AUT-008/013 |
| FR-AUT-007 | Reset PIN & buka kunci oleh supervisor/manager | P1 | F3 | Reset tercatat audit; PIN lama tidak berlaku setelah sync | BR-AUT-005 |
| FR-AUT-008 | Pencabutan staf/device efektif saat device online | P0 | F3 | Setelah staf dinonaktifkan dan device sync → login staf itu ditolak | BR-AUT-010 |
| FR-AUT-009 | Kunci layar otomatis 10 menit tanpa aktivitas + kunci manual; state tidak hilang (draf keranjang disimpan lokal, tidak disinkron); pengatur waktu berhenti saat pembayaran/dialog PIN supervisor | P0 | F3 | Keranjang 3 item, idle 10 menit → layar PIN; PIN benar → keranjang utuh; dialog PIN supervisor terbuka 12 menit → tidak terkunci | BR-AUT-015 |
| FR-AUT-010 | Pembukaan kunci oleh staf yang sama; override dengan permission `screen.unlock_override` (Supervisor, Manager, Owner) hanya untuk pergantian kasir (tutup shift), draf dibuang; audit override dan PIN salah berulang saja | P0 | F3 | Budi (Supervisor) membuka layar Dewi → hanya "Tutup shift"; audit "override buka kunci"; kunci/buka biasa tidak tercatat di audit | BR-AUT-015 |

### 10.3 Device & Register (FR-DEV)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-DEV-001 | Buat register (kode unik per outlet, **prefiks invoice wajib dan unik per tenant** untuk jenis `KASIR`) dan kode pairing sekali pakai (15 menit) | P0 | F1 | Kode kedaluwarsa/dipakai ulang → ditolak; prefiks yang sudah dipakai register lain → ditolak | BR-INV-001, BR-AUT-002 |
| FR-DEV-002 | Enrollment device → credential berumur panjang; pencabutan | P0 | F1 | Device dicabut → ditolak otorisasi pada kontak berikutnya | BR-AUT-002/010 |
| FR-DEV-003 | Pemulihan register: nomor mulai = tertinggi diterima + 1; input nomor struk fisik terakhir → gap | P1 | F3 | Contoh BR-INV-008: gap 000125–000127, nomor berikut 000128 | BR-INV-007/008 |
| FR-DEV-004 | Daftar device: status, sync terakhir, jumlah pending, offset jam, hasil `storage.persist`, versi aplikasi | P1 | F3 | Manager melihat device dengan pending > 0 dan umur pending | BR-SYN-051 |
| FR-DEV-005 | Minta `navigator.storage.persist()` saat pertama; catat hasil | P0 | F1 | Hasil `granted/denied` tersimpan dan tampil di daftar device | BR-SYN-050 |
| FR-DEV-006 | Atribut jenis register (`KASIR`/`PELAYAN`) saat membuat/mengubah register | P0 | F1 | Register `PELAYAN` tidak muncul sebagai tujuan serah-terima; jenis tidak dapat diubah saat ada shift terbuka atau bill `OPEN` di register itu (`DISEPAKATI`, OQ-S19..S23) | BR-FNB-011 |

### 10.4 Katalog (FR-CAT)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-CAT-001 | CRUD kategori & sub-kategori (online) | P0 | F2 | Hanya 2 tingkat; tombstone ikut feed | BR-CAT-001 |
| FR-CAT-002 | CRUD produk induk, atribut, generate SKU per kombinasi | P0 | F2 | Ukuran {S,M,L} × Warna {Merah,Hitam} → 6 SKU; tambah XL → +2 SKU | BR-CAT-002 |
| FR-CAT-003 | UOM, base UOM, faktor konversi, barcode per UOM, `allow_fraction` | P0 | F2 | Barcode dus & pcs berbeda; faktor dus = 12 | BR-UOM-*, BR-CAT-006 |
| FR-CAT-004 | Validasi barcode unik per tenant | P0 | F2 | Menyimpan barcode ganda ditolak | BR-CAT-006 |
| FR-CAT-005 | Nonaktifkan (soft delete) tanpa hard delete untuk item yang pernah dijual | P0 | F2 | Item hilang dari POS setelah sync; transaksi lama utuh | BR-CAT-004 |
| FR-CAT-006 | Impor massal CSV dalam satu transaksi (satu kenaikan versi) | P1 | F2 | Impor 4.000 SKU → semua baris `version` sama (mis. 122) | BR-SYN-010 |
| FR-CAT-007 | Batas varian (3 atribut / 100 kombinasi) | P2 | F2 | Kombinasi ke-101 ditolak | BR-CAT-005 |
| FR-CAT-008 | Penugasan ketersediaan produk × outlet (flag eksplisit); default semua outlet; opt-out saat membuat produk dan sesudahnya (online) | P0 | F2 | Diberikan 3 outlet, produk baru tanpa opt-out → 3 baris `AVAILABLE`; mengecualikan Outlet C → baris C `UNAVAILABLE`, versi master naik **1** dalam satu transaksi | BR-CAT-009/011 |
| FR-CAT-009 | Override ketersediaan per SKU pada outlet tertentu; hapus override = ikut induk | P0 | F2 | Kaos: 3 SKU Merah dikecualikan di B → efektif B = 3 SKU; hapus override → B = 6 | BR-CAT-010/016 |
| FR-CAT-010 | Outlet baru otomatis mendapat penugasan default untuk semua produk aktif dalam satu transaksi (sesuai keputusan OQ-24) | P0 | F2 | 4.000 produk aktif → 4.000 baris dalam **satu** versi; override SKU tidak disalin | BR-CAT-011 |
| FR-CAT-011 | Layar kelola ketersediaan: matriks produk × outlet, filter, pengaturan massal, tampil status efektif (perilaku layar, bukan desain visual) | P1 | F2 | Admin melihat SKU efektif per outlet (mis. A 6 / B 3 / C 6) | BR-CAT-010 |
| FR-CAT-012 | Impor massal ketersediaan (CSV) dalam satu transaksi | P2 | F2 | Impor 500 penugasan → satu kenaikan versi | BR-CAT-014 |
| FR-CAT-013 | Audit perubahan ketersediaan; hak akses sesuai outlet | P0 | F2 | Entri audit memuat item, outlet, status lama/baru, aktor; Manager di luar outletnya ditolak | BR-CAT-021 |
| FR-CAT-014 | Kolom penanda open price (`is_open_price`) pada produk di back-office; default tidak | P0 | F2 | Produk "Jasa Pengiriman" ditandai open price → tersinkron ke device; produk biasa tidak menampilkan input harga manual | BR-PRC-007 |

### 10.5 Harga (FR-PRC)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-PRC-001 | Harga per (SKU + UOM + outlet), integer rupiah | P0 | F2 | Dus Rp130.000 dan pcs Rp11.500 berdiri sendiri | BR-PRC-001 |
| FR-PRC-002 | Aturan fallback harga | P0 | F2 | Harga eksplisit outlet → default tenant → bila keduanya tidak ada, item tampil "harga belum diatur" dan tidak bisa masuk keranjang; tidak diturunkan dari harga base × faktor | BR-PRC-002 |
| FR-PRC-003 | Snapshot harga & penandaan harga stale oleh server | P0 | F3 | Kasus Kopi 18.500 vs 19.000 → flag −Rp1.000 | BR-PRC-003 |
| FR-PRC-004 | Audit perubahan harga | P0 | F2 | Entri audit memuat harga lama/baru, aktor | BR-AUD-001 |

### 10.6 Sinkronisasi (FR-SYN)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-SYN-001 | Counter versi per tenant, stamping `version` dalam transaksi penulisan master | P0 | F1 | Dua transaksi paralel menghasilkan versi berurutan = urutan commit, tanpa celah (uji konkurensi) | BR-SYN-010/011 |
| FR-SYN-002 | Pull berhalaman `(version,id)` termasuk tombstone, terfilter tenant+outlet | P0 | F2 | Device yang mati-hidup di tengah halaman melanjutkan tanpa kehilangan baris | BR-SYN-010 |
| FR-SYN-003 | Full resync bila cursor terlalu tua | P0 | F2 | Cursor < batas tombstone → `FULL_RESYNC_REQUIRED`; outbox tidak tersentuh | FLOW-15 |
| FR-SYN-004 | Outbox + push idempoten; satu perintah atomik `FinalizeSale` | P0 | F3 | Kirim 2× key sama → 1 invoice, 1 set movement | BR-SYN-020 |
| FR-SYN-005 | Event bill append-only | P0 | F5 | Urutan event per bill terjaga walau tiba acak | BR-SYN-021 |
| FR-SYN-006 | Versi skema perintah N & N−1; migrasi outbox saat update | P0 | F3 | Perintah v(N−1) diterima server v(N) | BR-SYN-022 |
| FR-SYN-007 | Klasifikasi kegagalan: bisnis diterima, struktural/otorisasi → "perlu perhatian", transien → retry | P0 | F3 | Penjualan dengan stok minus **diterima**; payload rusak → antrean | BR-SYN-030 |
| FR-SYN-008 | Pemicu sync: app aktif, `online`, interval (60 dtk), setelah jual | P0 | F3 | Event `online` memicu push dalam ≤ 5 dtk | BR-SYN-040 |
| FR-SYN-009 | Sinyal realtime "ada perubahan" (SSE/WS) | P1 | F3 | Hilangnya sinyal tidak menghilangkan data | BR-SYN-041 |
| FR-SYN-010 | Banner "N transaksi belum terkirim sejak X jam" + ekspor pending ke file | P0 | F3 | Banner muncul bila pending ada; file berisi seluruh perintah non-ACKED | BR-SYN-051/052 |
| FR-SYN-011 | Clock offset terhadap server per sync; peringatan >10 mnt | P0 | F1 | Offset tersimpan dan dipakai menghitung `business_date` | BR-TIM-005/006 |
| FR-SYN-012 | Pembersihan retensi lokal 3 bulan hanya untuk yang tersinkron | P1 | F3 | Pending tidak pernah terhapus | BR-SYN-054 |
| FR-SYN-013 | Prompt pembaruan PWA (tanpa reload otomatis); banner di semua halaman; pengingat tiap 2 jam bila ditolak | P0 | F1 | Update tersedia → banner + prompt; "Nanti" → prompt muncul lagi 2 jam kemudian (bukan saat pembayaran); tidak ganti versi di tengah transaksi/shift | BR-SYN-002/003 |
| FR-SYN-018 | Rilis wajib: diterapkan otomatis saat tidak ada checkout dan tidak ada shift terbuka; shift baru diblokir sebelum update; device usang menahan perintah & memblokir shift baru | P0 | F3 | Rilis wajib saat shift terbuka → shift boleh selesai; setelah tutup shift update diterapkan; v7 pada hari ke-16 → perintah ditahan, shift baru diblokir, setelah update 9 perintah terkirim | BR-SYN-003 |
| FR-SYN-014 | Satu instance `/pos` aktif per device (Web Locks) | P1 | F3 | Tab kedua tidak dapat mengalokasikan nomor invoice | EC-021 |
| FR-SYN-015 | Snapshot stok per outlet dan estimasi lokal | P0 | F4 | 20 − 6 terjual = tampil 14 | BR-STK-005 |
| FR-SYN-016 | Snapshot open bill outlet (read-only device lain) | P0 | F5 | Bill device lain tampil dengan "terakhir diperbarui" | BR-FNB-003 |
| FR-SYN-017 | Baris ketersediaan ikut feed pull (versi, tombstone, terfilter outlet); layar jual diperbarui setelah seluruh siklus pull diterapkan | P0 | F2 | Device offline 2 jam: setelah online, item yang dinonaktifkan hilang dari katalog dalam ≤ 1 siklus sync; tidak ada tampilan setengah-diterapkan | BR-CAT-014 |

### 10.7 Checkout POS (FR-POS)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-POS-001 | Scan barcode keyboard-wedge → lookup lokal (SKU,UOM) | P0 | F3 | Scan barcode dus menambah 1 dus (=12 pcs); tidak dikenal → pesan | BR-CAT-006/007 |
| FR-POS-002 | Scan kamera (BarcodeDetector + polyfill WASM) | P1 | F3 | Berfungsi di Chrome Android tanpa API native | BR-CAT-007 |
| FR-POS-003 | Pencarian produk lokal (nama/kode) | P0 | F3 | Hasil ≤ 150 ms p95 untuk 5.000 SKU | NFR-PERF-003 |
| FR-POS-004 | Keranjang: qty (decimal), ganti UOM, hapus baris | P0 | F3 | 0,5 dus × 130.000 = 65.000; 0,35 dus untuk pcs bulat ditolak | BR-UOM-003/004 |
| FR-POS-005 | Diskon item/bill (persen/nominal) dengan batas role | P0 | F3 | Contoh BR-DSC-003 A & B tepat | BR-DSC-* |
| FR-POS-006 | Perhitungan total memakai package bersama | P0 | F3 | Contoh 1–4 Bab 7.4 menghasilkan angka identik di client & server | BR-TAX-006 |
| FR-POS-007 | Finalisasi atomik + nomor invoice seri register | P0 | F3 | Crash di tengah → tidak ada nomor hangus; dua penjualan → nomor berurutan | BR-INV-004 |
| FR-POS-008 | Data pelanggan opsional | P1 | F3 | Tanpa nama/telepon transaksi tetap valid | BR-CUS-001 |
| FR-POS-009 | Riwayat transaksi lokal 3 bulan, pencarian per nomor, cetak ulang | P0 | F3 | Invoice 000123 ditemukan offline | BR-RTR-004 |
| FR-POS-010 | Void invoice (shift berjalan, PIN supervisor, alasan) | P0 | F3 | Status `VOID`; nomor tetap terpakai; kas dibalik | BR-INV-005 |
| FR-POS-011 | Peringatan stok estimasi ≤ 0 (non-blokir) | P1 | F4 | Penjualan tetap lolos | BR-STK-005 |
| FR-POS-012 | Item efektif `UNAVAILABLE` di outlet disembunyikan dari katalog, pencarian, dan lookup barcode | P0 | F3 | Kopi `UNAVAILABLE` di C: tidak muncul di grid maupun pencarian "kopi" | BR-CAT-012 |
| FR-POS-013 | Scan item tidak tersedia: tidak masuk keranjang, pesan khusus (terjemahan i18n), berbeda dari "barcode tidak dikenal" | P0 | F3 | Scan `8999999000100` di C → "Kopi Bubuk 200g tidak tersedia di outlet ini"; barcode sembarang → "barcode tidak dikenal" | BR-CAT-015 |
| FR-POS-014 | `FinalizeSale` membawa `catalog_cursor`; server menerima penjualan item yang sudah tidak tersedia dan menandainya | P0 | F3 | Contoh 3: Rp150.000 diterima, flag `item_tidak_tersedia`; penjualan sebelum perubahan tidak ditandai | BR-CAT-013 |
| FR-POS-015 | Nomor invoice berformat `{PREFIKS}-{MMYY}-{URUT6}` (prefiks per register, wajib, unik per tenant), reset `000001` tiap pergantian `MMYY` (dari `business_date`), unik dan tanpa celah per (register, `MMYY`); pengaturan prefiks menolak prefiks yang sudah dipakai register lain | P0 | F3 | Invoice terakhir November `OUT01-POS02-1126-000731` → pertama Desember `OUT01-POS02-1226-000001`; penjualan 2026-12-01 01:00 (jam potong 04:00) bernomor `…-1126-…`; mengisi prefiks register kedua dengan prefiks register pertama ditolak | BR-INV-003 |
| FR-POS-016 | Item open price: kasir wajib mengetik harga satuan (integer > 0); baris menyimpan snapshot harga dan penanda `is_open_price`; tanpa harga master pun dapat dijual | P0 | F3 | Contoh BR-PRC-007: harga 12.500 + Kopi 2 × 18.500 → total 54.945, tunai terbulat 54.900 (−45), kembalian 5.100; item biasa tidak dapat diubah harganya oleh kasir | BR-PRC-007 |

### 10.8 Shift & Kas (FR-SHF)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-SHF-001 | Buka shift (modal awal) offline; satu shift terbuka per register | P0 | F3 | Buka kedua pada register sama ditolak; register lain boleh | BR-SHF-001/002 |
| FR-SHF-002 | Kas masuk/keluar dengan alasan | P0 | F3 | Tercatat dan mempengaruhi `kas_diharapkan` | BR-SHF-004 |
| FR-SHF-003 | Tutup shift dengan blind count | P0 | F3 | Kas diharapkan tidak tampil selama kasir menghitung; setelah submit hitungan terkunci dan kasir melihat diharapkan 1.782.100 dan selisih −2.100 | BR-SHF-005/006 |
| FR-SHF-004 | Peringatan open bill/pending saat tutup | P1 | F3 | Peringatan muncul; penutupan tetap bisa | BR-SHF-007 |
| FR-SHF-005 | Tutup shift darurat oleh manager | P1 | F3 | Status `FORCE_CLOSED` + alasan + audit | BR-SHF-009 |
| FR-SHF-006 | Pergantian kasir = tutup lalu buka | P0 | F3 | Tidak ada dua shift terbuka | BR-SHF-003 |
| FR-SHF-007 | Pengecualian shift untuk register `PELAYAN` (open bill, pra-bill, void item, serah-terima); pembayaran/kas/retur tetap butuh shift di register `KASIR` | P0 | F5 | HP waiter tanpa shift dapat membuat open bill; pembayaran bill yang diterima di POS01 tanpa shift terbuka ditolak | BR-SHF-010, BR-FNB-011 |

### 10.9 Retur (FR-RTR)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-RTR-001 | Nota kredit merujuk invoice asal; seri sendiri tanpa celah | P0 | F3 | `OUT01-POS02-NK-1126-000001` berurutan; invoice asal tidak berubah | BR-RTR-001, BR-INV-010 |
| FR-RTR-002 | PIN supervisor + alasan | P0 | F3 | Tanpa PIN tidak bisa disimpan | BR-RTR-002 |
| FR-RTR-003 | Jendela 3 bulan kalender | P0 | F3 | Invoice 2026-08-31 dapat diretur sampai 2026-11-30 | BR-RTR-003 |
| FR-RTR-004 | Offline hanya untuk invoice di device; lainnya butuh online | P0 | F3 | Invoice register lain offline → ditolak dengan alasan | BR-RTR-004 |
| FR-RTR-005 | Perhitungan nilai dari angka tersimpan, retur terakhir mengambil sisa | P0 | F3 | 3 unit @10.000 → 3.333 + 3.333 + 3.334 | BR-RTR-006 |
| FR-RTR-006 | Disposisi stok per baris (`KEMBALI_STOK`/`BUANG`) dan dampak HPP | P1 | F4 | Retur 1 dari 7 → +1 pcs senilai 8.208 | BR-RTR-008 |
| FR-RTR-007 | Larang void parsial & retur melebihi kuantitas | P0 | F3 | Retur ke-4 atas baris 3 unit ditolak | BR-RTR-005/009 |

### 10.10 Pembayaran (FR-PAY)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-PAY-001 | Tunai + kembalian | P0 | F3 | 150.000 untuk 112.500 → kembalian 37.500 | BR-PAY-003 |
| FR-PAY-002 | Metode manual (transfer, kartu, QRIS) tanpa gateway; daftar metode dikonfigurasi | P0 | F3 | Metode dengan referensi opsional tersimpan | BR-PAY-001/005 |
| FR-PAY-003 | Banyak metode per bill | P0 | F3 | QRIS 100.000 + tunai → kembalian 14.300 | BR-PAY-002 |
| FR-PAY-004 | Pembulatan tunai per outlet, dicatat terpisah | P0 | F3 | 112.476 → 112.500 (+24); 101.330 → 101.300 (−30) | BR-TAX-009 |
| FR-PAY-005 | Non-tunai tidak boleh melebihi sisa | P0 | F3 | QRIS 150.000 untuk 135.655 ditolak | BR-PAY-003 |

### 10.11 Cetak (FR-PRN)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-PRN-001 | Satu antarmuka printer + adapter WebUSB, BLE, `window.print`/kiosk | P0 | F3 | Ganti adapter tanpa mengubah alur checkout | BR-PRN-001 |
| FR-PRN-002 | Antrean cetak asinkron; checkout tidak menunggu | P0 | F3 | Printer dicabut → penjualan tersimpan, job gagal | BR-PRN-002 |
| FR-PRN-003 | Struk ESC/POS teks + logo bitmap ter-cache | P0 | F3 | Tidak ada rasterisasi HTML | BR-PRN-003 |
| FR-PRN-004 | Cetak ulang (ditandai "CETAK ULANG") | P0 | F3 | Tersedia untuk invoice di riwayat lokal | BR-PRN-002 |
| FR-PRN-005 | Cash drawer via printer; buka manual teraudit | P1 | F3 | Pembayaran tunai membuka laci | BR-PRN-006 |
| FR-PRN-006 | Kustomisasi struk per outlet (logo, header, footer, lebar) | P0 | F3 | Perubahan tersinkron dan dipakai struk berikutnya | BR-PRN-005 |
| FR-PRN-007 | Halaman uji printer & status koneksi | P1 | F3 | Cetak uji sukses/gagal tampil | RSK-07 |

### 10.12 Inventori & HPP (FR-INV)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-INV-001 | Goods receipt (draft → posted) dengan UOM & biaya | P0 | F4 | 5 dus @96.000 → +60 pcs, nilai 480.000 | BR-STK-020 |
| FR-INV-002 | Ledger append-only + saldo (qty, nilai) dalam transaksi yang sama | P0 | F4 | Dua penjualan paralel pada SKU sama → hasil seri (row lock) | BR-STK-001 |
| FR-INV-003 | Moving average per outlet di server | P0 | F4 | Tabel contoh BR-HPP-003 baris 1–5 persis | BR-HPP-003 |
| FR-INV-004 | Biaya penjualan telat memakai biaya saat server memproses | P0 | F4 | Contoh BR-HPP-004 → 82.083 | BR-HPP-004 |
| FR-INV-005 | Stok minus diizinkan + flag; biaya referensi | P0 | F4 | Contoh BR-HPP-005 → HPP 40.000, saldo −2/−16.000 | BR-STK-002, BR-HPP-005 |
| FR-INV-006 | Transfer 2 langkah dengan in-transit & selisih | P0 | F4 | Contoh BR-TRF → 328.333 / 311.916 / selisih 16.417 | BR-TRF-* |
| FR-INV-007 | Opname dengan delta terhadap snapshot | P0 | F4 | 80→77, terjual 5 → 72 | BR-STK-030/031 |
| FR-INV-008 | Koreksi GR (reversal) | P1 | F4 | GR asli tidak berubah; movement berlawanan tercatat | BR-STK-022 |
| FR-INV-009 | Aktivasi stok per outlet/produk | P0 | F4 | Penjualan sebelum aktivasi tidak membuat movement | BR-STK-004 |
| FR-INV-010 | Penjualan/void/retur menghasilkan movement & `cost_snapshot` oleh server | P0 | F4 | `cost_snapshot` terisi setelah diproses | BR-HPP-004 |
| FR-INV-011 | GR, transfer (kirim/terima), dan opname tetap diizinkan untuk item yang tidak tersedia di outlet; saldo & nilai tetap tampil di R-02 dengan penanda | P0 | F4 | Kopi @C `UNAVAILABLE`: GR 24 pcs → saldo 36 pcs / Rp300.000; R-02 menampilkan "tidak tersedia" | BR-CAT-012/017 |

### 10.13 F&B (FR-FNB)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-FNB-001 | Master meja & status turunan | P0 | F5 | Meja terisi bila ada ≥ 1 bill `OPEN` | BR-FNB-001 |
| FR-FNB-002 | Open bill dengan lease device; device lain read-only | P0 | F5 | Edit dari device non-pemegang ditolak | BR-FNB-003 |
| FR-FNB-003 | Tidak ada take-over/tutup paksa | P0 | F5 | Tidak ada aksi UI/API untuk itu selain serah-terima sukarela oleh pemegang (FR-FNB-013) | BR-FNB-004 |
| FR-FNB-004 | Event bill (tambah/void item, modifier) dengan alasan void | P0 | F5 | Void tercatat sebagai event, bukan penghapusan | BR-FNB-005 |
| FR-FNB-005 | Modifier (harga & bahan) | P0 | F5 | "Extra Sambal" +2.000 membentuk harga baris 44.500 | BR-PRC-006 |
| FR-FNB-006 | Service charge & PB1 per outlet (kena pajak atau tidak) | P0 | F5 | Contoh 3a = 135.655; 3b = 135.068 | BR-TAX-* |
| FR-FNB-007 | Split bill (item/kuantitas/bagi rata), invoice per anak | P0 | F5 | Contoh 1: 83.186 + 55.991; contoh 2: 45.219/45.218/45.218 | BR-SPL-* |
| FR-FNB-008 | Merge bill (satu pemegang) | P0 | F5 | Bill beda pemegang ditolak; total gross target 136.500 pada contoh | BR-SPL-020..024 |
| FR-FNB-009 | Resep/BOM satu level; konsumsi saat bayar | P0 | F5 | 2 Nasi Goreng → HPP 8.720 | BR-RCP-* |
| FR-FNB-010 | Pra-bill (tanpa nomor invoice) | P1 | F5 | Tidak mengonsumsi seri invoice | BR-FNB-002 |
| FR-FNB-011 | Penanda "bill ganda pada meja" dan laporan bill tanpa pemegang aktif | P1 | F5 | Muncul di `/admin` | BR-FNB-007, EC-015 |
| FR-FNB-012 | Open bill dengan item yang menjadi tidak tersedia: tetap dapat dibayar; menambah item itu diblokir setelah device menerima perubahan | P1 | F5 | Bill berisi 2 item; item A dinonaktifkan → bill tetap dibayar normal; menambah item A ditolak dengan pesan BR-CAT-015 | BR-CAT-020 |
| FR-FNB-013 | Serah-terima sukarela bill ke register kasir: `BILL_HANDED_OVER` → `BILL_ACCEPTED` (lease pindah), pembatalan `BILL_HANDOVER_CANCELED`; hanya online; pra-syarat event bill bersih; bill menunggu bersifat read-only | P0 | F5 | Bill M05-0003 (6 event `ACK`) diserahkan ke POS01 → lease pindah setelah Terima; offline → tombol nonaktif; 2 event pending → serah-terima ditolak; accept dan cancel bersamaan → satu pemenang menurut commit | BR-FNB-012/013, FLOW-19 |
| FR-FNB-014 | Event `PREBILL_PRINTED` dan status meja "Menunggu bayar" diturunkan dari snapshot open bill (kembali "Terisi" bila isi berubah sesudahnya) | P1 | F5 | Pra-bill 19:42 → "Menunggu bayar" di semua device; tambah 1 Es Teh 19:45 → "Terisi"; cetak ulang 19:46 → "Menunggu bayar" | BR-FNB-010 |
| FR-FNB-015 | Register `PELAYAN` tidak menyediakan pembayaran, shift, kas, retur; open bill dan pra-bill tanpa shift | P0 | F5 | Di HP waiter tidak ada aksi Bayar/Shift/Kas; membuat open bill tanpa shift berhasil; tidak ada invoice terbit dari register itu | BR-FNB-011, BR-SHF-010 |

### 10.14 Laporan (FR-RPT) — rinci di Bab 12

| ID | Requirement | Pri | Fase | Rujukan |
|---|---|---|---|---|
| FR-RPT-001 | Laporan penjualan harian/periodik per outlet | P0 | F3 | R-01 |
| FR-RPT-002 | Laporan rekap shift & selisih kas | P0 | F3 | R-03 |
| FR-RPT-003 | Laporan stok & nilai persediaan (termasuk stok minus & in-transit) | P0 | F4 | R-02 |
| FR-RPT-004 | Laporan operasional pendukung (harga stale, selisih hitung, gap invoice, antrean "perlu perhatian", bill yatim/ganda, selisih transfer, penjualan item tidak tersedia di outlet, penjualan open price) | P1 | F3–F5 | R-04 |

### 10.15 Audit, Admin & Kualitas (FR-AUD, FR-ADM, FR-QA)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-AUD-001 | Audit log append-only (tanpa UPDATE/DELETE) | P0 | F1 | Upaya UPDATE/DELETE gagal di level hak akses | BR-AUD-002 |
| FR-AUD-002 | Entri audit offline ikut outbox | P0 | F3 | Persetujuan PIN di mode pesawat muncul di server setelah sync | BR-AUD-003 |
| FR-AUD-003 | Penampil audit (filter aktor/aksi/tanggal) | P1 | F3 | Akuntan dapat melihat, tidak dapat mengubah | BR-AUD-001 |
| FR-AUD-004 | Hash berantai per tenant | P1 | F3 | Pengubahan satu entri terdeteksi oleh verifikasi | BR-AUD-002 |
| FR-ADM-001 | Layar "perlu perhatian": terima manual / abaikan+alasan / eskalasi | P0 | F3 | Item terlihat manager; tindakan teraudit | FLOW-18 |
| FR-ADM-002 | Penampil gap invoice + anotasi | P1 | F3 | Gap `OPEN` → `EXPLAINED` | BR-INV-007 |
| FR-ADM-003 | Pengaturan metode bayar, struk, role | P0 | F3 | Tersinkron ke device | — |
| FR-QA-001 | Uji sync otomatis Playwright: emulasi offline, putus-nyambung, urutan acak | P0 | F1→F3 | Seluruh skenario Bab 9 prioritas tinggi hijau di CI | NFR-TEST-001 |
| FR-QA-002 | Test properti: idempotensi & konvergensi | P0 | F3 | Kirim ulang N kali dan urutan acak → state akhir identik | NFR-TEST-002 |
| FR-QA-003 | Vektor uji hitung bersama client & server | P0 | F3 | Seluruh contoh Bab 7 identik | BR-MNY-007 |

### 10.16 Bahasa & Lokalisasi (FR-I18N)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-I18N-001 | Infrastruktur kunci terjemahan untuk `/admin` dan `/pos`; tidak ada string UI literal | P0 | F1 | Lint/CI menolak string UI literal; satu layar contoh tampil di 2 locale | BR-I18N-001 |
| FR-I18N-002 | Pemilihan bahasa per pengguna, bawaan per register dan per tenant, prioritas sesuai BR-I18N-002 | P0 | F1 | Pengguna memilih `en-US`; login berikutnya (offline) langsung `en-US`; layar PIN memakai bahasa register | BR-I18N-002 |
| FR-I18N-003 | Kamus ter-precache; ganti bahasa tanpa reload dan tanpa jaringan; fallback ke `id-ID` | P0 | F1 | Mode pesawat: ganti bahasa ≤ 200 ms; kunci hilang → teks `id-ID` | BR-I18N-003, NFR-I18N-002 |
| FR-I18N-004 | Format angka/tanggal per locale dengan penyimpanan kanonik; urai input kuantitas per locale | P0 | F3 | 112476 → "Rp112.476"/"Rp112,476"; input "1.500" → 1500 (id) / 1,5 (en) dan hasil urai ditampilkan; nilai tersimpan sama | BR-I18N-006 |
| FR-I18N-005 | Bahasa struk per outlet, snapshot `receipt_locale`, cetak ulang identik | P0 | F3 | Ubah bahasa struk outlet → cetak ulang invoice lama tetap bahasa semula | BR-I18N-007 |
| FR-I18N-006 | Transliterasi karakter tak terdukung pada cetak ESC/POS | P1 | F3 | "Café Crème" tercetak "Cafe Creme"; data tersimpan tidak berubah | BR-I18N-008 |
| FR-I18N-007 | Data bisnis, audit, outbox, dan kode error menyimpan kode, bukan teks terjemahan | P0 | F1 | Entri audit dibuat dalam `en-US` terbaca benar dalam `id-ID` | BR-I18N-004 |
| FR-I18N-008 | CI memeriksa kelengkapan kunci semua locale aktif; pluralisasi/interpolasi benar | P1 | F1 | Kunci hilang di satu locale → build gagal; banner pending benar untuk 1 dan 3 transaksi | BR-I18N-009 |

### 10.17 Manajemen Log (FR-LOG)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-LOG-001 | Satu pembuat logger: JSON per baris, level dari konfigurasi, tulis ke stdout + file harian di volume; kegagalan file jatuh ke stdout | P0 | F1 | Mematikan akses tulis ke folder log → server tetap hidup, log di stdout, file dibuka lagi ≤ 60 dtk setelah pulih | BR-LOG-002 |
| FR-LOG-002 | Konteks otomatis per request/job (`reqId`, `tenantId`, `userId`, `deviceId`, `commandId`) dan ID referensi + header `X-Request-Id` + baris access | P0 | F1 | Dua request paralel → semua baris tiap request hanya membawa ID miliknya; header sama dengan ID di log | BR-LOG-004/005 |
| FR-LOG-003 | Daftar field tertutup; nama field tak terdaftar gagal di pemeriksaan tipe/CI | P1 | F1 | Menulis `user_id` → build gagal | BR-LOG-006 |
| FR-LOG-004 | Redaksi: serializer galat, hash pendek untuk login/PIN gagal, tanpa data pelanggan/PIN/token | P0 | F1 | Galat database dengan nilai parameter → log hanya SQL ber-placeholder; PIN gagal → hash 8 karakter + panjang | BR-LOG-007, NFR-OBS-002 |
| FR-LOG-005 | Kode error publik `KODE#id` ke client; error mentah hanya di log | P0 | F1 | Respons error tidak memuat stack/SQL; kode+ID tampil dan ID itu ada di log | BR-LOG-008 |
| FR-LOG-006 | Log sync per perintah dan per pull; `commandId` sama dengan item "perlu perhatian" | P0 | F3 | Perintah gagal struktural → satu baris `error` berisi `commandId` yang sama dengan item antrean | BR-LOG-009 |
| FR-LOG-007 | Antrean log device (≤ 500 entri, buang tertua), dikirim bersama sync dengan batas laju, tanpa data sensitif | P0 | F3 | Printer gagal 4× offline → 4 entri; saat online terkirim dan tercari berdasarkan `deviceId`; antrean penuh membuang yang tertua | BR-LOG-010 |
| FR-LOG-008 | Retensi 30 hari + pembersihan berkala; skrip pencarian CLI (ID, level, waktu UTC, tenant, user/device, path) | P1 | F1 (retensi) / F3 (pencarian lengkap) | File berumur > 30 hari terhapus, file non-log tidak disentuh; mencari `20261117-143551-k7q2m` menampilkan seluruh baris request itu beserta galat | BR-LOG-011/013 |

### 10.18 Versioning & Rilis (FR-VER)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-VER-001 | Server mengumumkan versi kontrak terkini dan minimum pada setiap respons sync; klien membandingkannya | P0 | F1 | Respons memuat kontrak terkini 8 dan minimum 7; klien kontrak 7 berstatus "didukung tapi lama" | BR-VER-002 |
| FR-VER-002 | Versi aplikasi tampil di footer layar login dan pengaturan perangkat (+ versi kontrak di pengaturan); tidak ada banner perbedaan versi; tidak di struk | P1 | F1 | Footer "Solva POS v1.6.0 · kontrak 8" (kontrak di pengaturan perangkat); struk tidak memuat versi | BR-VER-007 |
| FR-VER-003 | Banner pembaruan; tombol "Perbarui" aktif hanya di momen aman; service worker baru diaktifkan hanya di momen aman | P0 | F3 | Keranjang berisi + shift terbuka → tombol nonaktif; layar terkunci → aktif; pembayaran berlangsung → nonaktif | BR-VER-004, BR-SYN-003 |
| FR-VER-004 | Pembaruan keras otomatis untuk klien di bawah versi minimum, hanya di momen aman keras (tanpa shift terbuka, outbox kosong/terkunci aman) | P0 | F3 | TAB-02: shift ditutup 22:00 → update berjalan; shift terbuka 08:00–22:00 → tidak dipaksa | BR-VER-003/004 |
| FR-VER-005 | Klien lebih baru dari server: tahan perintah kontrak tak dikenal, banner "server sedang diperbarui", terus menjual, kirim otomatis setelah cocok | P0 | F3 | Server kontrak 7, 3 invoice kontrak 8 → tersimpan, ditahan; server kontrak 8 → 3 invoice terkirim tanpa kehilangan nomor | BR-VER-006 |
| FR-VER-006 | Tiap penjualan, nota kredit, perintah outbox, dan event bill menyimpan `app_version` dan `contract_version`; pembaca event mendukung semua kontrak historis | P0 | F1 | Event kontrak 7 terbaca oleh server kontrak 8; invoice menyimpan `1.4.2`/`7` | BR-VER-008 |
| FR-VER-007 | Feature flag per tenant: master tersinkron, tersimpan di device, offline memakai nilai terakhir, default di kode, hanya Owner mengubah, POS baca-saja, teraudit | P1 | F2 | Flag `fnb_serah_terima` diaktifkan Owner (versi 205) → tablet offline memakai nilai lama sampai pull; kasir tidak dapat mengubah flag | BR-VER-009 |
| FR-VER-008 | Gerbang rilis: catatan rilis "Perubahan angka" untuk perubahan pajak/pembulatan/HPP/nomor; hotfix PATCH hanya setelah tes otomatis kunci lolos; staging dan production terpisah | P0 | F3 | Rilis yang mengubah pembulatan tanpa catatan "Perubahan angka" gagal gerbang di CI (GitHub Actions); PATCH tidak menaikkan kontrak; deploy dijalankan manual setelah gerbang lolos | BR-VER-010 |

### 10.19 Identifikasi Tenant lewat URL (FR-TEN)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-TEN-001 | Routing `<DOMAIN>/<slug>/pos`, `/<slug>/admin`, serta halaman publik `/<slug>/join` dan `/<slug>/reset`; root `/` = 404; `/platform` untuk admin platform | P0 | F1 | `/acme/pos` dan `/acme/admin` terbuka untuk tenant `acme`; `/` → 404 | BR-TEN-001 |
| FR-TEN-002 | Tenant untuk akses data dari keanggotaan terverifikasi (back-office) atau credential device (POS); slug yang tak sesuai/bukan anggota ditolak tanpa data | P0 | F1 | Akun hanya-anggota-`acme` ke `/beta/admin` → ditolak; credential device `acme` ke endpoint `beta` → ditolak; uji otomatis | BR-TEN-002, NFR-SEC-009 |
| FR-TEN-003 | Login di-scope slug pada identitas global: email + password, lalu pemeriksaan keanggotaan; bukan anggota → pesan generik sama dengan kredensial salah; halaman login boleh memuat nama tenant; tanpa username | P0 | F1 | `ani@example.id` (anggota `acme` dan `beta`) login sekali dan membuka kedua tenant; `citra@example.id` (hanya `acme`) di `/beta/admin` → pesan sama dengan password salah; email tak terdaftar → pesan sama | BR-TEN-003, BR-IDN-002 |
| FR-TEN-004 | Validasi slug: 3–30, `a–z 0–9 -`, tidak diawali/diakhiri `-`, unik tanpa beda huruf, daftar kata terlarang (konstanta di kode + uji rute); slug tidak dapat diubah (aplikasi **dan** trigger database) | P0 | F1 | `admin`, `pos`, `platform`, `ab`, `-acme`, `Acme_1` ditolak; `toko-maju-7` diterima; ubah slug tenant ditolak | BR-TEN-004 |
| FR-TEN-005 | Normalisasi URL: huruf kapital dan garis miring akhir dialihkan 308 ke huruf kecil kanonis | P1 | F1 | `/ACME/pos` → `/acme/pos` (308); `/acme/pos/` → `/acme/pos` (308) | BR-TEN-009 |
| FR-TEN-006 | Slug tak dikenal → 404 generik; tenant ditangguhkan → halaman "tidak tersedia", sync ditolak `TENANT_SUSPENDED`; data pending aman | P0 | F1 (halaman) / F3 (perilaku device) | `/xyz/pos` → 404; `beta` ditangguhkan → TAB-09 offline sampai 7 Des 20:00, lalu terkunci; 12 transaksi pending tetap | BR-TEN-005 |
| FR-TEN-007 | Penyimpanan lokal dipisah total per tenant pada perangkat yang sama; cookie sesi back-office per slug (login terpisah per tenant) | P0 | F1 | TAB-09: pending `acme` tak terlihat di `beta`; login di `/beta/admin` tidak membuka `/acme/admin`; logout `/beta` tidak mengakhiri sesi `/acme` | BR-TEN-006, NFR-SEC-010 |
| FR-TEN-008 | PWA per tenant: nama tenant pada aplikasi terpasang (tanpa warna/tema tenant); pembaruan per aplikasi terpasang | P1 | F3 | Dua tenant di satu perangkat → dua aplikasi terpasang bernama "Acme Coffee" dan "Beta Mart" | BR-TEN-007 |
| FR-TEN-009 | QR pairing memuat alamat lengkap + kode pairing pada fragmen `#` (tidak sampai ke server/log); kode sekali pakai, kedaluwarsa 15 menit; ketik manual tetap tersedia sebagai cadangan | P1 | F1 | QR `<DOMAIN>/acme/pos#pair=…` membuka enrollment; kode tidak muncul di log akses; kode kedaluwarsa setelah 15 menit; mengetik kode manual berhasil bila kamera tidak dapat memindai | BR-TEN-007, BR-LOG-007 |
| FR-TEN-010 | Admin platform (`/platform`, akun terpisah): buat tenant (slug dan nama tampilan maks 40 karakter), ubah nama tampilan tenant, tangguhkan/aktifkan, atur versi kontrak minimum global; tidak ada layar nama di `/admin` untuk Owner | P0 | F1 | Tenant dibuat dengan slug, nama (≤ 40 karakter), dan Owner; nama 41 karakter ditolak; Owner tidak punya layar ubah nama; ditangguhkan → `SUSPENDED`; versi minimum 8 dipublikasikan di respons sync | BR-TEN-008, BR-VER-002 |
| FR-TEN-011 | Perangkat belum terdaftar pada tenant yang dibuka menampilkan "belum terdaftar" dan mengarahkan ke enrollment online | P1 | F1 | TAB-10 membuka `/beta/pos` tanpa enrollment → pesan; enrollment butuh online | BR-TEN-006 |
| FR-TEN-012 | Halaman pemilih `/<slug>`: "Terminal Kasir" atau "Back-office" dengan nama tenant; slug tak dikenal 404; tidak membocorkan tenant lain | P1 | F1 | `/acme` → pemilih "Acme Coffee" dengan dua pilihan; `/xyz` → 404; halaman tidak memuat nama tenant lain | BR-TEN-012 |

### 10.20 Manajemen Error (FR-ERR)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-ERR-001 | Klasifikasi tiga tingkat: (a) pesan jelas tanpa kode, (b) indikator + retry otomatis tanpa dialog, (c) pesan + `KODE#id` + tindakan + Salin; pesan login selalu generik | P0 | F1 | Diskon 5,36% > 5% → pesan tanpa kode; push timeout → indikator + retry; galat tak terduga → `KODE#id` + Salin; login salah tidak membedakan email tak terdaftar, bukan anggota, dan password salah | BR-ERR-001 |
| FR-ERR-002 | Katalog kode error (6 umum + kode domain), kode stabil, kode dihentikan tetap dikenali; klien menampilkan kode yang tak dikenal dengan tindakan umum | P0 | F1 | Kode baru dari server tampil `KODE#id` di klien lama; kode `DIHENTIKAN` tetap tampil benar | BR-ERR-002/003 |
| FR-ERR-003 | Satu kalimat tindakan per kode per bahasa UI MVP; kode dan ID tidak diterjemahkan; CI gagal bila kalimat hilang | P0 | F1 | `PRINT_FAILED` tampil "Struk belum tercetak. Periksa printer dan kertas, lalu ketuk Cetak ulang." (id) / "The receipt was not printed. Check the printer and paper, then tap Reprint." (en); kode/ID identik di kedua bahasa | BR-ERR-004, NFR-I18N-005 |
| FR-ERR-004 | Tombol Salin menyalin `KODE#id`; tidak ada tombol "Laporkan masalah" atau paket diagnostik otomatis | P0 | F1 | Salin menghasilkan teks `INTERNAL_ERROR#20261118-103015-k7q2m`; tidak ada pengiriman otomatis | BR-ERR-005 |
| FR-ERR-005 | ID lokal `D-YYYYMMDD-HHmmss-xxxxx` untuk error yang lahir di device; disimpan di log device, dikirim bersama sync, ditulis server dengan `localId` | P0 | F3 | Printer gagal offline → `PRINT_FAILED#D-20261118-140322-m4k9q`; setelah sync, pencarian `localId` menemukannya | BR-ERR-006, BR-LOG-006/010 |
| FR-ERR-006 | Error boundary per area; draf keranjang/bill di Dexie; layar pemulihan dengan kode, Muat ulang, ekspor pending; tanpa muat ulang otomatis | P0 | F3 | Panel diskon crash → panel lain jalan; Muat ulang → keranjang 3 item utuh; nomor invoice tidak hangus | BR-ERR-007 |
| FR-ERR-007 | Pemulihan gagal start: kembali ke versi terakhir yang berfungsi + log; layar "Reset aplikasi" (hanya online) yang tidak menyentuh Dexie | P0 | F3 | Setelah reset, 12 transaksi pending tetap di Dexie dan terkirim; offline → reset nonaktif; halaman Reset aplikasi menyediakan ekspor transaksi tertunda | BR-ERR-008 |
| FR-ERR-008 | Gagal cetak: banner non-blocking + "Cetak ulang"; penjualan tetap selesai; log `PRINT_FAILED`; cetak ulang dari riwayat | P0 | F3 | Printer putus → invoice tetap tersimpan; banner; Cetak ulang berhasil dengan penanda "CETAK ULANG" | BR-ERR-009, BR-PRN-002 |
| FR-ERR-009 | Retry aksi online-only: baca boleh ulang otomatis (batas); aksi pengubah data hanya "Coba lagi" manual + kunci idempoten + tombol nonaktif saat berjalan | P0 | F2 | Simpan harga timeout → Coba lagi tidak menggandakan; versi master naik sekali; klik ganda tidak terkirim dua kali | BR-ERR-010 |
| FR-ERR-010 | Source map privat per rilis (tidak dilayani publik); skrip pencarian menerjemahkan stack klien menurut `appVersion` | P1 | F1 | Mengakses source map dari luar → ditolak; stack `app.3f2a1.js:1:48211` → `cart.tsx:128` | BR-ERR-011, NFR-OBS-005 |
| FR-ERR-011 | Notifikasi Telegram: error fatal, health check `/health` gagal (pemantau eksternal), lonjakan error; tanpa data pelanggan; dibatasi frekuensi | P1 | F1 | Fatal → 1 pesan berisi kode/ID/jenis/versi; 12 `INTERNAL_ERROR`/3 mnt → 1 pesan ringkasan (9 → tidak ada); pesan tanpa nama/telepon | BR-ERR-012, NFR-OBS-004 |
| FR-ERR-012 | Katalog kode error terdokumentasi dan gerbang rilis: kode baru wajib entri katalog + kalimat tindakan semua bahasa; tidak ada diagnostik untuk tenant di MVP | P1 | F1 | Rilis dengan kode tanpa entri gagal gerbang; layar diagnostik tenant tidak ada; antrean "perlu perhatian" tetap | BR-ERR-013/014 |

### 10.21 Rate Limit (FR-RLM)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-RLM-001 | Dua lapisan: Nginx membuang banjir kasar; aplikasi menegakkan batas per akun/device/slug/tenant; IP dibaca hanya dari header Nginx tepercaya | P0 | F1 | Header `X-Forwarded-For` palsu dari luar tidak mengubah IP terbaca; uji asap deploy: IP luar terbaca benar | BR-RLM-001 |
| FR-RLM-002 | Login admin: jeda progresif per email lintas slug (30 dtk/1/2/5/15 mnt), tanpa penguncian permanen, pesan "Coba lagi dalam sekitar N menit" generik (akun ada, bukan anggota, atau tak ada); jaring pengaman longgar per IP + slug | P0 | F1 | `dewi@example.id` ke-8 gagal di `acme` → 15 menit **juga di `beta`**; email tak terdaftar/bukan anggota menampilkan pesan sama; reset setelah login sukses | BR-RLM-003 |
| FR-RLM-003 | Pairing dibatasi per IP dan per slug; pesan perkiraan menit | P0 | F1 | 11 percobaan dari satu IP dalam 5 menit → tertahan; 31 percobaan dari IP berbeda untuk satu slug → tertahan | BR-RLM-009 |
| FR-RLM-004 | API device dibatasi per `device_id` (bukan IP): push/pull/ping/serah-terima; log device ≤ 20 laporan/10 menit | P0 | F3 | 5 tablet satu IP: tiap tablet punya jatah sendiri; kelebihan → `429` + `Retry-After` | BR-RLM-002/004 |
| FR-RLM-005 | Banjir sync: batas push bersamaan; `429` + `Retry-After` berjitter; klien patuh, tidak menaikkan percobaan, tidak "perlu perhatian" | P0 | F3 | 12 push serentak → 4 mendapat `429`; semua sukses ±10 dtk; `attempts` 0; tanpa dialog | BR-RLM-005, BR-SYN-024/030 |
| FR-RLM-006 | Full resync maks 1/jam/device; SSE satu koneksi aktif per device | P1 | F3 | Resync kedua dalam sejam → `429`, katalog lama tetap; koneksi SSE kedua menggantikan yang pertama | BR-RLM-006 |
| FR-RLM-007 | Laporan berat `/admin`: ±2 bersamaan per tenant + batas waktu kueri; pesan tunggu | P1 | F3 | Laporan ke-3 `acme` diminta menunggu; `beta` tak terpengaruh | BR-RLM-007 |
| FR-RLM-008 | PIN di device: hitungan monotonik, jam monotonik, reset total oleh supervisor/manager, laporan ke server saat online | P0 | F3 | Mundurkan tanggal tablet → jeda tidak berkurang; 15 salah → terkunci sampai reset; status terlapor saat online | BR-RLM-010, BR-AUT-005 |
| FR-RLM-009 | Pelanggaran hanya dicatat `warn` dengan kunci ber-hash; tanpa Telegram; angka batas lewat variabel lingkungan | P1 | F1 | Pelanggaran login menulis baris `warn` dengan `limitKeyHash`, tanpa nilai akun asli; tidak ada notifikasi Telegram | BR-RLM-013 |
| FR-RLM-010 | `/platform` dan endpoint publik tanpa batas khusus (hanya batas umum per IP); tidak ada kuota per tenant | P1 | F1 | `/platform` memakai akun terpisah + batas umum; tidak ada pembatasan IP khusus; tidak ada kuota tenant | BR-RLM-008/011 |

### 10.22 Identitas Global dan Keanggotaan (FR-IDN)

| ID | Requirement | Pri | Fase | Kriteria Penerimaan | Rujukan |
|---|---|---|---|---|---|
| FR-IDN-001 | Identitas global (email unik se-sistem, satu password) + keanggotaan per tenant berperan; login hanya email; anggota PIN-only tanpa akun | P0 | F1 | `ani@example.id` satu akun dengan dua keanggotaan; membuat akun kedua dengan email sama ditolak; kasir tanpa email tidak punya akun `/admin` | BR-IDN-001, BR-AUT-001 |
| FR-IDN-002 | Login di-scope slug: autentikasi → pemeriksaan keanggotaan; bukan anggota → pesan sama dengan kredensial salah; keanggotaan diperiksa tiap permintaan | P0 | F1 | `citra@example.id` di `/beta/admin` → pesan sama dengan password salah; keanggotaan dihapus → permintaan berikutnya ditolak | BR-IDN-002, BR-TEN-003 |
| FR-IDN-003 | Cookie sesi per slug (`Path=/<slug>`): login terpisah per tenant; logout hanya mengakhiri sesi tenant itu; ganti/reset password mengakhiri semua sesi akun | P0 | F1 | Login `/beta/admin` lalu `/acme/admin` meminta login terpisah (email dan password sama); logout `/beta` tidak memengaruhi `/acme`; ganti password → kedua sesi berakhir | BR-IDN-002 |
| FR-IDN-004 | Tanpa email: tidak ada pengiriman/verifikasi email dan tidak ada "Lupa kata sandi" mandiri; undangan dan reset manual | P0 | F1 | Tidak ada tautan "Lupa kata sandi" dan tidak ada integrasi email; undangan menghasilkan kode manual | BR-IDN-003 |
| FR-IDN-005 | Undangan: kode 10 karakter berkelompok (alfabet 32), sekali pakai, terikat email (72 jam), penukaran satu langkah (email + kode + password), baris dibersihkan 7 hari setelah kedaluwarsa/terpakai; penerbit tidak melihat/menetapkan password; kode dan respons identik untuk akun ada/tidak; penerima memasukkan email + kode + password sendiri (baru) atau password akun yang ada; tanpa password sementara; dibatasi per IP dan slug | P0 | F1 | Respons pengundang sama untuk `ani@` dan `baru@`; kode salah/kedaluwarsa → pesan generik; keanggotaan baru ada setelah diterima; tidak ada layar password sementara/wajib ganti | BR-IDN-004 |
| FR-IDN-006 | Reset password: Owner hanya menerbitkan kode reset (24 jam, sekali pakai, terikat email) untuk akun yang keanggotaannya hanya di tenantnya (**undangan aktif lintas tenant dihitung sebagai keanggotaan**); akun multi-tenant hanya operator (memakai konteks salah satu tenant tempat akun menjadi anggota)/pemiliknya; penolakan pesan generik "hubungi operator platform"; tanpa password sementara; diaudit; memaksa keluar semua sesi | P0 | F1 | Budi → kode reset untuk `citra@` (satu tenant) berhasil; untuk `ani@` (multi-tenant) → pesan generik tanpa menyebut multi-tenant; audit mencatat aktor/akun/tenant | BR-IDN-005 |
| FR-IDN-007 | Mengeluarkan anggota = hapus keanggotaan (akun tetap); minimal satu Owner per tenant; akses PIN dicabut saat device online | P0 | F1 | Ani dikeluarkan dari `acme`, tetap Owner `beta`; Owner terakhir tidak dapat dikeluarkan | BR-IDN-006 |
| FR-IDN-008 | Peran pada keanggotaan (peran Better Auth hanya cerminan kasar; izin dari tabel kita); perubahan peran/undangan/pengeluaran oleh Owner dan teraudit; ganti email hanya oleh pemilik akun/operator; email tidak disalin ke data anggota | P1 | F1 | Perubahan peran Ani di `acme` tercatat di audit; Owner tidak dapat mengganti email Citra; tabel anggota tidak memuat kolom email | BR-IDN-007/011/012 |
| FR-IDN-009 | 2FA Owner tidak ada di MVP; risiko dicatat | P2 | LANJUT | Tidak ada fitur 2FA di MVP; RSK-18 tercatat | BR-IDN-008 |
| FR-IDN-010 | Kunci rate limit login = email lintas slug (+ jaring per IP + slug); pesan generik untuk akun ada/bukan anggota/tak ada | P0 | F1 | 8 gagal `dewi@` di `acme` → 15 menit di `acme` dan `beta`; email tak terdaftar → pesan sama | BR-IDN-009, BR-RLM-003 |
| FR-IDN-011 | Risiko pra-klaim email diterima dengan mitigasi: penerbitan dan penukaran kode undangan/reset tercatat di audit (penerbit, email, tenant, waktu); akun hasil pra-klaim hanya ada di tenant penerbit; operator dapat mereset | P0 | F1 | Budi menukar sendiri kode `rina@` → audit `acme` mencatat penerbitan dan penukaran; undangan `beta` untuk `rina@` tanpa password akun gagal generik; operator reset berhasil | BR-IDN-013 |
| FR-IDN-012 | Dua halaman publik terpisah untuk penerima kode: `/<slug>/join` (undangan) dan `/<slug>/reset` (reset password); tanpa sesi; slug tak dikenal → 404 generik; kode hanya sah di halaman dan tenant yang sesuai (pesan generik); setelah `/join` masuk sesi slug itu, setelah `/reset` semua sesi akun berakhir tanpa login otomatis; kode tidak di path/query | P0 | F1 | Kode undangan di `/acme/reset` → pesan generik; kode `acme` di `/beta/join` → pesan generik; `/join` sukses → `/acme/admin`; `/reset` sukses → halaman login; `/zzz/join` → 404 | BR-IDN-014, BR-TEN-001 |
| FR-IDN-013 | Daftar "Undangan tertunda" di tab Pengguna (email, peran/outlet, diterbitkan oleh/pada, kedaluwarsa, status Aktif/Kedaluwarsa) dengan aksi **Batalkan** (kode langsung tidak berlaku) dan **Terbitkan ulang** (kode baru 72 jam, email/peran/outlet sama, kode lama otomatis tidak berlaku); email tidak dapat diubah; kode tidak ditampilkan ulang | P0 | F1 | Undangan `ani@` kedaluwarsa → Terbitkan ulang → kode baru berlaku 72 jam, kode lama → pesan generik; salah alamat → Batalkan lalu undang ulang | BR-IDN-015 |
| FR-IDN-014 | Pengelolaan undangan terisolasi per tenant (Owner hanya undangan tenantnya; RLS; daftar tidak membuka akun/keanggotaan lain) dan setiap Batalkan/Terbitkan ulang diaudit (aktor, email, peran, tenant, id undangan, waktu; kode tidak dicatat); undangan dibatalkan tidak dihitung sebagai keanggotaan untuk aturan reset | P0 | F1 | Owner `beta` tidak melihat undangan `acme`; audit `acme` mencatat Terbitkan ulang oleh Budi; undangan `rina@` dibatalkan → Budi kembali boleh mereset `rina@` bila hanya di `acme` | BR-IDN-015, BR-IDN-005 |

---

## 11. Requirement Non-Fungsional

> Angka target adalah `DIUSULKAN` dan divalidasi lewat benchmark pada perangkat Android kelas menengah dan PC Windows biasa pada awal Fase F3.

### 11.1 Performa

| ID | Requirement | Target |
|---|---|---|
| NFR-PERF-001 | Waktu dari tekan "Selesai" sampai penjualan tersimpan (transaksi IndexedDB) | p95 ≤ 300 ms (5.000 SKU, 45.000 transaksi lokal), tanpa menunggu jaringan |
| NFR-PERF-002 | Cetak: mulai mengirim byte ke printer setelah penjualan tersimpan | ≤ 1 detik untuk struk ≤ 40 baris; UI tidak terblokir selama cetak. **Kecepatan cetak = prioritas user.** |
| NFR-PERF-003 | Lookup barcode lokal / pencarian nama | ≤ 50 ms / ≤ 150 ms (p95) |
| NFR-PERF-004 | Start dingin `/pos` offline sampai layar login | ≤ 3 detik |
| NFR-PERF-005 | Server memproses `FinalizeSale` (termasuk movement & HPP) | p95 ≤ 500 ms per perintah |
| NFR-PERF-006 | Pull inkremental 500 baris | ≤ 1 detik (jaringan 4G) |
| NFR-PERF-007 | Verifikasi PIN (hash lambat) | 250–500 ms |

### 11.2 Penyimpanan & Ketahanan Offline

| ID | Requirement |
|---|---|
| NFR-STOR-001 | Operasi penuh offline selama jam sampai 1 hari; ≤ 500 transaksi/hari/outlet |
| NFR-STOR-002 | Retensi lokal 3 bulan (±45.000 transaksi/device ≈ 150 MB bersama katalog); peringatan >70% kuota |
| NFR-STOR-003 | Transaksi pending **tidak pernah dibuang** otomatis |
| NFR-STOR-004 | `storage.persist()` diminta; ekspor pending ke file tersedia |
| NFR-REL-001 | Idempotensi: kirim ulang berapa pun kali menghasilkan satu efek |
| NFR-REL-002 | Konvergensi: urutan/putus-nyambung acak menghasilkan state server identik |
| NFR-REL-003 | Atomisitas penjualan: satu transaksi IndexedDB (client) dan satu transaksi DB (server) |
| NFR-REL-004 | Gerbang rilis: perubahan angka wajib catatan rilis; hotfix PATCH hanya setelah tes otomatis kunci lolos; staging dan production terpisah; gerbang tes di CI (GitHub Actions), rilis dan deploy manual (BR-VER-010) |
| NFR-REL-005 | Backup dump penuh sebelum migrasi yang menyentuh data lama (BR-VER-011) |

### 11.3 Keamanan

| ID | Requirement |
|---|---|
| NFR-SEC-001 | Seluruh lalu lintas HTTPS/TLS (juga prasyarat WebUSB/Web Bluetooth/PWA) |
| NFR-SEC-002 | Isolasi tenant dengan RLS; user DB aplikasi tidak memiliki hak melewati RLS |
| NFR-SEC-003 | PIN: hash lambat + salt per device; batas percobaan; tidak pernah disimpan polos |
| NFR-SEC-004 | Credential device berumur panjang, dapat dicabut; kode pairing sekali pakai |
| NFR-SEC-005 | Rate limit berlapis dan proteksi brute-force (BR-RLM-001..014): Nginx untuk banjir kasar + aplikasi untuk aturan per akun/device/slug; API device per `device_id` (bukan IP); login admin per email lintas slug (rev. 1.07; jeda progresif, tanpa penguncian permanen) dengan IP hanya jaring pengaman longgar; pairing per IP dan per slug; banjir sync, full resync, SSE, dan laporan berat dibatasi; `/platform` akun terpisah + batas umum; pelanggaran hanya dicatat log; angka batas dikonfigurasi lewat lingkungan dan dikalibrasi dari log |
| NFR-SEC-009 | Slug pada URL **bukan otoritas akses**: tenant ditentukan dari keanggotaan terverifikasi (back-office) atau credential device; permintaan dengan slug ≠ tenant sesi/token ditolak dan diuji otomatis (BR-TEN-002) |
| NFR-SEC-011 | Identitas global (BR-IDN): keanggotaan diperiksa pada **setiap** permintaan; pesan bukan-anggota identik dengan kredensial salah; kode undangan/reset sekali pakai terikat email tanpa password sementara; reset lintas tenant dibatasi (BR-IDN-005); semua perubahan keanggotaan/reset/ganti email teraudit dan memaksa keluar sesi terkait; diuji otomatis |
| NFR-SEC-010 | Penyimpanan lokal dipisah total per tenant pada perangkat yang sama dan cookie sesi back-office per slug (`Path=/<slug>`); uji otomatis membuktikan data tenant A tidak terbaca dari konteks tenant B dan sesi satu slug tidak berlaku di slug lain (BR-TEN-006) |
| NFR-SEC-006 | Enkripsi IndexedDB **tidak termasuk MVP** (risiko RSK-05 diterima) |
| NFR-SEC-007 | Tidak ada rahasia server di bundle client; validasi Zod di semua batas sync |
| NFR-SEC-008 | Hak akses DB: audit log tanpa UPDATE/DELETE |

### 11.4 Audit, Observabilitas, Kompatibilitas

| ID | Requirement |
|---|---|
| NFR-AUD-001 | Audit log tak dapat diubah; mencatat penyetuju; mencakup aksi offline |
| NFR-OBS-001 | MVP: log operasional terstruktur sesuai BR-LOG (server + device) + penghitung kegagalan sync yang dapat dilihat manager (antrean "perlu perhatian"). **Monitoring sync lag dan backup off-site/uji restore TIDAK masuk MVP** (RSK-09) |
| NFR-OBS-002 | Redaksi data sensitif (BR-LOG-007) diuji otomatis: PIN, hash, token, nama/telepon pelanggan, dan nilai parameter SQL tidak pernah muncul di baris log |
| NFR-OBS-003 | Penulisan log tidak menambah latensi checkout yang terukur (NFR-PERF-001) dan kegagalan log tidak pernah menggagalkan transaksi bisnis |
| NFR-OBS-004 | Notifikasi operasional (Telegram) tidak memuat data pelanggan, dibatasi frekuensi (1 pesan per jenis per 10 menit), dan tidak memerlukan dashboard (BR-ERR-012) |
| NFR-OBS-005 | Source map privat: tidak pernah dilayani publik (diuji), tersimpan saat build untuk setiap rilis (BR-ERR-011) |
| NFR-COMP-001 | `/pos` pada Chrome/Edge (Chromium) 2 versi mayor terakhir; Android (tablet/HP) dan Windows 10/11; **iOS bukan target** |
| NFR-COMP-002 | Responsif HP, tablet, desktop (perilaku layar, bukan desain visual) |
| NFR-COMP-003 | Scanner USB/Bluetooth mode keyboard; printer ESC/POS 58/80 mm (USB, BLE); Bluetooth klasik tidak didukung |
| NFR-I18N-001 | UI **multi-bahasa** (`id-ID` default + `en-US`; OQ-23 terjawab); mata uang IDR; zona Asia/Jakarta, Asia/Makassar, Asia/Jayapura |
| NFR-I18N-002 | Ganti bahasa UI ≤ 200 ms, tanpa reload dan tanpa jaringan; seluruh kamus aktif ter-precache |
| NFR-I18N-003 | CI gagal bila ada kunci terjemahan yang hilang pada locale aktif; tidak ada string UI literal di komponen |
| NFR-I18N-004 | Penambahan satu bahasa tidak mengubah logika bisnis, skema perintah/outbox, maupun perhitungan |
| NFR-I18N-005 | CI gagal bila ada kode error tanpa kalimat tindakan di salah satu bahasa aktif; kode dan ID tidak diterjemahkan (BR-ERR-004) |
| NFR-TEST-001 | Uji sync otomatis: Playwright emulasi offline, putus-nyambung, urutan acak |
| NFR-TEST-002 | Test properti idempotensi & konvergensi; vektor uji hitung (BR-MNY-007) |
| NFR-MNT-001 | Skema Dexie, outbox, dan perintah berversi; migrasi satu arah teruji |
| NFR-MNT-003 | Migrasi database aditif saja; penghapusan/penggantian nama kolom bertahap dan baru setelah jendela dukungan kontrak lama berakhir (BR-VER-011) |
| NFR-MNT-002 | Batas modul ditegakkan lint dependensi di CI: impor lintas modul di luar antarmuka publik atau melawan arah dependensi (BR-ARC-004) membuat build gagal |
| NFR-DATA-001 | Skema tabel besar dirancang agar dapat dipartisi per bulan; retensi server: simpan semua tanpa penghapusan untuk MVP (OQ-03 terjawab) |

---

## 12. Laporan MVP (dihitung di server, hanya online)

Aturan umum (**BR-RPT-001**, `DISEPAKATI`): laporan dihitung server, hanya tersedia online, memakai **`business_date` yang tersimpan** (tidak diturunkan ulang), filter **outlet** (sesuai hak akses) dan **rentang tanggal**. Transaksi `VOID` dikecualikan dari penjualan dan dihitung terpisah; nota kredit dihitung pada `business_date`-nya sendiri.

### R-01 Penjualan Harian/Periodik per Outlet

| Elemen | Definisi |
|---|---|
| Filter | Outlet (satu/beberapa), rentang `business_date` |
| Pengelompokan | Per hari, per outlet; rincian per metode bayar; per kasir (opsional) |
| Kolom | Jumlah transaksi, gross, diskon, subtotal bersih (S2), service charge, pajak, pembulatan, total diterima, retur (nota kredit), penjualan neto, jumlah VOID |
| Rumus neto | `neto = total diterima − Σ refund nota kredit` |

*Contoh (OUT01, 2026-11-17, mode eksklusif PPN 11%):* Invoice 000123 (gross 106.700; diskon 5.370; S2 101.330; pajak 11.146; rounding +24; total 112.500, tunai) · 000124 (gross 50.000; pajak 5.500; total 55.500, QRIS) · 000125 (gross 20.000; diskon 2.000; S2 18.000; pajak 1.980; rounding +20; total 20.000, tunai) · 000126 `VOID` (30.000, tidak dihitung) · Nota kredit `NK-1126-000001` refund 17.900 (neto 16.110 + pajak 1.772 + rounding +18).

| Metrik | Nilai |
|---|---|
| Jumlah transaksi (PAID) | **3** (VOID: 1) |
| Gross | 106.700 + 50.000 + 20.000 = **176.700** |
| Diskon | 5.370 + 0 + 2.000 = **7.370** |
| Subtotal bersih (S2) | 101.330 + 50.000 + 18.000 = **169.330** |
| Pajak | 11.146 + 5.500 + 1.980 = **18.626** |
| Pembulatan | +24 + 0 + 20 = **+44** |
| Total diterima | 112.500 + 55.500 + 20.000 = **188.000** (= 169.330 + 18.626 + 44) |
| Per metode | Tunai **132.500**; QRIS **55.500** |
| Retur (refund) | **17.900** |
| **Penjualan neto** | 188.000 − 17.900 = **170.100** (neto sebelum pajak 153.220; pajak neto 16.854; pembulatan neto +26) |

### R-02 Stok & Nilai Persediaan

| Elemen | Definisi |
|---|---|
| Filter | Outlet, kategori, hanya stok minus, hanya in-transit, ketersediaan (semua / hanya tersedia / hanya tidak tersedia) |
| Kolom | SKU, outlet, qty (base UOM), nilai persediaan, biaya rata-rata (= nilai ÷ qty, tampilan), flag stok minus, in-transit (qty & nilai), **status ketersediaan di outlet** (tersedia/tidak tersedia) |
| Catatan | In-transit **bukan** bagian saldo outlet; ditampilkan terpisah. Stok minus ditandai. Item **tidak tersedia** tetap tampil dan nilainya **tetap masuk** total nilai persediaan outlet (BR-CAT-017) |

*Contoh:* Susu UHT: OUT-A **80 pcs / Rp656.667** (rata-rata 8.208,34); OUT-B 10 pcs / Rp90.000 (rata-rata 9.000); **in-transit A→B** 40 pcs / Rp328.333 (sebelum diterima). Setelah B menerima 38 pcs: OUT-B 48 pcs / Rp401.916; selisih transfer 2 pcs / Rp16.417 muncul di R-04.

### R-03 Rekap Shift & Selisih Kas

| Elemen | Definisi |
|---|---|
| Filter | Outlet, register, kasir, rentang tanggal |
| Kolom | Register, kasir, buka/tutup, modal awal, tunai penjualan, kas masuk, kas keluar, refund tunai, kas diharapkan, kas dihitung, selisih, total non-tunai per metode, status (lengkap/belum lengkap/`FORCE_CLOSED`) |

*Contoh:* OUT01-POS02, kasir Dewi: modal 500.000 · tunai 1.250.000 · masuk 200.000 · keluar 150.000 · refund tunai 17.900 · **diharapkan 1.782.100** · dihitung 1.780.000 · **selisih −2.100** · QRIS 830.000, Transfer 300.000 · status lengkap.

### R-04 Laporan Operasional Pendukung (`DIUSULKAN`, P1)

Penjualan dengan harga berbeda dari harga terbaru (BR-PRC-003) · penjualan dengan item nonaktif/tarif berbeda · selisih hitung client-vs-server · gap invoice/nota kredit (BR-INV-007) · antrean "perlu perhatian" · stok minus · selisih transfer · penjualan item yang tidak tersedia di outlet saat dijual (BR-CAT-013; contoh: 2 pcs Rp150.000 di Contoh 3 BR-CAT) · penjualan item open price (BR-PRC-007) · bill terbuka tanpa pemegang aktif dan bill ganda pada meja (F5).

**Tidak termasuk MVP:** laporan laba kotor (HPP tersimpan sehingga murah ditambahkan, `DISEPAKATI`).

---

## 13. Fase & Roadmap

> Solo developer, **tanpa tenggat tetap**; fase tidak diberi tanggal, hanya urutan, ukuran relatif (S/M/L/XL), dan **kriteria selesai**. Scope MVP besar: urutan fase dirancang agar tiap fase menghasilkan perangkat lunak yang dapat diuji sendiri. `DIUSULKAN` — user menyatakan urutan ini sebagai usulan awal.

| Fase | Nama | Ukuran |
|---|---|---|
| F1 | Fondasi | L |
| F2 | Master data online + sync katalog | L |
| F3 | POS retail offline end-to-end | XL |
| F4 | Stok & HPP | XL |
| F5 | F&B | XL |

### F1 — Fondasi

**Cakupan:** tenancy + RLS (FR-TNT-*), Better Auth, hierarki entitas/outlet/register, device enrollment & credential, kerangka PIN & lease, kerangka sync (counter versi, pull, outbox, push idempoten dasar, clock offset), audit log append-only, app shell PWA + prompt update, `storage.persist`, kerangka uji sync Playwright, **infrastruktur multi-bahasa (FR-I18N-001/002/003/007/008)**.
**Kriteria selesai:**
1. Uji RLS lintas tenant hijau.
2. Dua transaksi master paralel menghasilkan versi berurutan tanpa celah (uji konkurensi) dan pull tidak melewatkan baris.
3. Device dapat di-enroll lewat kode pairing, bekerja offline (shell termuat), dan dicabut.
4. Outbox menerima perintah uji dan server memprosesnya idempoten.
5. Audit log tidak dapat di-UPDATE/DELETE oleh user aplikasi.
6. Bahasa UI dapat diganti offline tanpa reload; CI menolak string UI literal dan kunci terjemahan yang hilang (FR-I18N-001..003).
7. Logging server berfungsi: JSON per baris, ID referensi di header dan tiap baris, redaksi teruji, retensi 30 hari (FR-LOG-001..005, FR-LOG-008 bagian retensi).
8. Server mengumumkan versi kontrak terkini/minimum, versi aplikasi tampil di footer login dan pengaturan perangkat, dan semua penjualan/perintah/event menyimpan versi aplikasi dan kontrak (FR-VER-001/002/006).
9. Identifikasi tenant lewat URL berfungsi: routing slug, root 404, tenant dari sesi/token (slug ≠ tenant ditolak), login di-scope slug, validasi slug, tenant ditangguhkan, penyimpanan lokal terpisah per tenant, dan admin platform (FR-TEN-001..007, 009..011).
10. Manajemen error dasar berfungsi: tiga tingkat, katalog kode + kalimat tindakan (id/en) dengan gerbang CI, tombol Salin, source map privat, dan notifikasi Telegram untuk fatal/health check (FR-ERR-001..004, 010..012).
11. Rate limit dasar berfungsi: dua lapisan, IP dari header Nginx tepercaya, login admin jeda progresif per email lintas slug, pairing per IP dan per slug, pelanggaran hanya di log (FR-RLM-001..003, 009, 010).
12. Identitas global + keanggotaan berfungsi: login hanya email, pemeriksaan keanggotaan tiap permintaan dengan pesan generik, tanpa email, undangan dengan kode, reset password sesuai aturan lintas tenant, pengeluaran anggota (FR-IDN-001..008, 010..014).

### F2 — Master Data Online + Sync Katalog

**Cakupan:** kategori, produk, varian/SKU, UOM, barcode, harga per outlet, impor massal, tombstone, full resync, layar `/admin` terkait.
**Kriteria selesai:**
1. Katalog 5.000 SKU tersinkron ke Dexie dan pencarian/barcode memenuhi NFR-PERF-003.
2. Impor 4.000 SKU = 1 transaksi, 1 kenaikan versi.
3. Device offline 2 jam mendapatkan seluruh perubahan; cursor tua memicu full resync.
4. Aturan fallback harga terimplementasi: eksplisit outlet → default tenant → blokir (BR-PRC-002).
5. Ketersediaan item per outlet berfungsi di back-office dan tersinkron: contoh Bab 7.2.4 (Kopi A/B/C; Kaos 6/3/6; versi 141) tereproduksi persis, dan device menerapkan perubahan hanya setelah siklus pull lengkap (FR-CAT-008..013, FR-SYN-017).
6. Feature flag per tenant berfungsi: master tersinkron, offline memakai nilai terakhir, POS baca-saja, perubahan teraudit (FR-VER-007).

### F3 — POS Retail Offline End-to-End

**Cakupan:** scan, keranjang, diskon, pajak (profil PPN), pembayaran manual, invoice seri register, shift & blind count, cetak (3 adapter) + cash drawer + kustomisasi struk, retur/nota kredit, void, riwayat lokal, push penuh, gap & pemulihan register, antrean "perlu perhatian", laporan R-01 R-03 R-04, uji sync lengkap.
**Kriteria selesai:**
1. Skenario penuh (login PIN → buka shift → jual → cetak → retur → tutup shift) berhasil dengan jaringan mati dan seluruh data tiba di server saat online.
2. Seluruh contoh Bab 7.1–7.8 lolos di client dan server (vektor uji).
3. Test properti idempotensi & konvergensi hijau; nomor invoice tanpa celah dalam kondisi normal.
4. Cetak struk memenuhi NFR-PERF-002 pada minimal satu printer per jalur yang dipilih.
5. Gap dan pemulihan register berjalan sesuai contoh BR-INV-008.
6. Format angka/tanggal per locale dan bahasa struk per outlet berfungsi (FR-I18N-004/005); seluruh layar F3 hanya memakai kunci terjemahan pada semua locale aktif.
7. Item tidak tersedia tersembunyi dari katalog/pencarian/barcode, pesan scan khusus tampil, dan penjualan offline pasca-perubahan diterima serta ditandai (FR-POS-012..014; Contoh 3 BR-CAT-013).
8. Log sync dan antrean log device berfungsi: perintah gagal dapat ditelusuri dari `commandId` dan log perangkat offline terkirim saat online (FR-LOG-006/007).
9. Kunci layar otomatis 10 menit berfungsi (state utuh, timer berhenti saat pembayaran/dialog PIN supervisor, override supervisor teraudit) (FR-AUT-009/010).
10. Pembaruan hanya di momen aman, pembaruan keras untuk klien di bawah versi minimum, penanganan server rollback, dan gerbang rilis berfungsi (FR-VER-003/004/005/008; skenario TAB-01/TAB-02 BR-VER-012).
11. Pemulihan error di kasir berfungsi: ID lokal `D-…` sampai ke log server, error boundary per area, Reset aplikasi tanpa menyentuh Dexie, banner gagal cetak, dan retry aksi online-only teridempoten (FR-ERR-005..009).
12. Rate limit sync dan device berfungsi: batas per `device_id`, banjir sync (`429` + `Retry-After`, klien tidak menaikkan percobaan), full resync/SSE, laporan berat, dan PIN di device anti-manipulasi jam (FR-RLM-004..008).

### F4 — Stok & HPP

**Cakupan:** GR, ledger, saldo, moving average per outlet, snapshot stok di POS, transfer in-transit, opname, laporan R-02, dampak retur & void ke stok, flag stok minus.
**Kriteria selesai:**
1. Tabel contoh BR-HPP-003 reproduksi persis; contoh BR-HPP-004/005, BR-TRF, BR-STK-032 lolos.
2. Penjualan offline yang tiba telat memakai biaya saat server memproses.
3. Penjualan paralel pada SKU yang sama tidak merusak saldo (row lock).
4. Laporan stok sesuai ledger; stok minus dan in-transit tampil.

### F5 — F&B

**Cakupan:** meja, open bill + lease + event, snapshot open bill, modifier, service charge + PB1, split/merge, resep/BOM & konsumsi, pra-bill, laporan bill yatim/ganda.
**Kriteria selesai:**
1. Contoh 3a/3b/4 Bab 7.4 dan contoh split/merge Bab 7.16 lolos.
2. Tidak ada jalur take-over/tutup paksa (hanya serah-terima sukarela BR-FNB-012); skenario risiko BR-FNB-004 terdokumentasi dan teruji perilakunya.
3. HPP menu sesuai resep + modifier (contoh 8.720 dan 6.180).
4. Alur F&B berjalan offline dengan sync event tanpa kehilangan item yang sudah terkirim.
5. Serah-terima bill waiter → kasir berfungsi (contoh M05-0003: lease pindah ke POS01 setelah Terima; offline ditolak dengan alasan), register `PELAYAN` tanpa pembayaran/shift, dan status meja "Menunggu bayar" konsisten lewat `PREBILL_PRINTED` (FR-FNB-013..015).

### Setelah MVP (`LANJUT`)

Monitoring sync lag; backup Postgres off-site + uji restore (**disarankan menyusul sebelum go-live produksi pertama**, RSK-09); enkripsi IndexedDB; laporan laba kotor; promo/voucher/loyalty; KDS & kitchen order; hub LAN; faktur pajak/e-Faktur; serial/batch; produksi/yield; kebijakan retensi/partisi data.

---

## 14. Risiko & Asumsi

### 14.1 Risiko

| ID | Risiko | Dampak | Penanganan | Status |
|---|---|---|---|---|
| RSK-01 | **Scope vs tim solo**: MVP sangat luas | Proyek tak selesai / kualitas turun | Fase berurut dan dapat diuji sendiri; F3 sebagai irisan bernilai pertama; tidak menambah scope tanpa menggeser | Dimitigasi |
| RSK-02 | **Seri tanpa celah tidak dapat dijamin 100%** bila device hilang/storage dibersihkan sebelum sync | Celah nomor tak terhindarkan | Sync agresif, banner, ekspor file, gap terdeteksi & dapat dianotasi, input nomor struk fisik saat pemulihan; konfirmasi auditor (OQ-02) | **Diterima (residual)** |
| RSK-03 | **Jebakan change feed Postgres** (updated_at/sequence naif melewatkan baris) | Master data tidak konsisten di device | Counter versi per tenant dengan row lock (BR-SYN-010/011); uji konkurensi | Dimitigasi; residual: serialisasi penulis master |
| RSK-04 | **Lease open bill**: waiter berganti device terhambat; **bill yatim** tanpa jalur pemulihan; item belum-sync hilang | Meja tak dapat ditutup; kehilangan pendapatan bill itu | Diterima eksplisit (BR-FNB-004): bill ulang manual, laporan bill yatim; serah-terima sukarela (BR-FNB-012) hanya menolong bila pemegang masih hidup dan online | **Diterima** |
| RSK-05 | **Tablet dicuri; IndexedDB tidak terenkripsi**; pencabutan akses baru berlaku saat online; PIN 4–6 digit rentan brute-force offline | Kebocoran data transaksi/katalog/hash PIN; penyalahgunaan hingga 7 hari | Hash lambat + salt per device, lease 7 hari, pencabutan saat online, audit; enkripsi di fase lanjut | **Diterima** |
| RSK-06 | **Aturan pajak belum dikonfirmasi** (SC kena pajak? inklusif? PB1/PPN) | Salah hitung pajak; perbedaan contoh 3a vs 3b = Rp587/bill | Semua aturan sebagai konfigurasi per outlet; snapshot tarif; konfirmasi akuntan (OQ-01) | Terbuka |
| RSK-07 | **Printer**: Bluetooth klasik (SPP) tidak didukung Web Bluetooth; USB di Windows terkunci driver | Printer tertentu tak dapat dipakai | Adapter BLE/WebUSB + fallback `window.print`/kiosk; daftar printer yang direkomendasikan; halaman uji | Dimitigasi |
| RSK-08 | **Penjualan offline telat** → HPP memakai biaya saat server memproses | HPP bisa berbeda dari "seharusnya" (contoh +Rp2.083) | Diterima (BR-HPP-004); ledger menyimpan `occurred_at` & `processed_at` | **Diterima** |
| RSK-09 | **Tanpa monitoring sync lag dan tanpa backup Postgres off-site + uji restore** (self-host VPS Docker) | Kehilangan data bila disk/VPS rusak; masalah sync tidak terdeteksi | Tidak di MVP; **sebaiknya segera menyusul sebelum go-live produksi**; sementara: dump manual berkala. **Ambang evaluasi PITR** (OQ-A20): ukuran DB ±10 GB, **atau** dump penuh + salinan keluar memakan > ±15 menit | Terbuka (diterima sementara) |
| RSK-10 | Kompleksitas pengujian sync & migrasi skema outbox | Bug langka yang merusak data transaksi | FR-QA-001..003 (Playwright, test properti, vektor hitung) | Dimitigasi |
| RSK-11 | Ketergantungan API Chromium (WebUSB, Web Bluetooth, BarcodeDetector) dan kebijakan peramban | Fitur cetak/scan berubah di versi baru | Adapter terisolasi; polyfill WASM barcode; fallback kiosk-printing | Dimitigasi |
| RSK-12 | Data server disimpan semua tanpa penghapusan (OQ-03) | Pertumbuhan DB dan biaya storage seiring waktu | Skema siap partisi bulanan; tinjau arsip/retensi bersama akuntan sebelum produksi jangka panjang | Diterima sementara |
| RSK-19 | **Pra-klaim email** (email tidak diverifikasi): penerbit yang memegang kode dan email dapat menukarnya sendiri dan menetapkan password atas email orang lain yang belum punya akun | Pemilik email sebenarnya tidak dapat bergabung ke tenant lain sebelum operator mereset; penerbit memegang akun atas nama orang lain di tenantnya sendiri | Hanya akun yang belum ada dan hanya di tenant penerbit; bergabung ke tenant lain butuh kode tenant itu **dan** password akun; audit; operator dapat mereset; verifikasi email di fase lanjut (BR-IDN-013) | **Diterima** |
| RSK-18 | **Identitas global lintas tenant tanpa 2FA dan tanpa email**: satu akun membuka beberapa tenant (satu password); email tidak diverifikasi (salah ketik pada undangan); undangan/kode reset manual bergantung pada kehati-hatian Owner; kegagalan login di satu tenant menunda login email itu di semua tenant | Kebocoran/pengambilalihan akses banyak tenant dari satu password; penundaan login lintas tenant | Kode sekali pakai terikat email tanpa password sementara; reset lintas tenant dibatasi (BR-IDN-005); sesi per slug; pesan generik; audit; batas laju; 2FA Owner fase lanjut | **Diterima** |
| RSK-17 | **Celah rate limit yang diterima**: penyerang dapat menunda login pemilik akun (jeda maks 15 menit; kini lintas tenant karena kunci login = email lintas slug; **diterima tanpa mitigasi**, hanya log, OQ-34) selama terus gagal; **tetangga berisik** (tanpa kuota per tenant); penghitung memori hilang saat restart; `/platform` tanpa pembatasan IP khusus; PIN di device bukan perlindungan terhadap penyerang mahir | Gangguan layanan sementara bagi pemilik akun/tenant lain; brute force `/platform` hanya dibatasi batas umum | Jeda progresif tanpa penguncian permanen; batas per device/slug; Nginx menahan banjir kasar; kode pairing 32⁸ sekali pakai; hash lambat + HMAC; kalibrasi dari log; mitigasi penanda perangkat tepercaya `PERLU KONFIRMASI` (OQ-34) | **Diterima** |
| RSK-16 | **Pelaporan error manual dan error offline** (tanpa tombol lapor/paket diagnostik): konteks aktivitas kasir hilang; error offline hanya terlihat setelah device sync; error di device yang tak pernah online tak terlacak | Investigasi lambat dan bergantung ingatan kasir | Kode+ID+kalimat tindakan, ID lokal `D-…`, log device ikut sync, source map, notifikasi fatal/health; developer menanyakan balik konteks (BR-ERR-005) | **Diterima** |
| RSK-15 | **Slug permanen; domain kustom ditunda**: slug salah/tidak sesuai merek tidak dapat diubah; keberadaan slug dapat ditebak (404 vs halaman login); domain kustom kelak mengubah alamat PWA/penyimpanan lokal | Tenant harus dibuat ulang bila slug salah; pembaruan alamat memutus aplikasi terpasang | Validasi/pratinjau slug saat pembuatan tenant oleh admin platform; 404 generik; tidak ada data selain nama tenant di halaman login; slug dijaga trigger database + konstanta kata terlarang; domain kustom ditunda dengan resolver tenant yang siap (OQ-30) | Diterima |
| RSK-14 | **Ketidakselarasan versi klien–server**: klien offline lama tidak diperbarui melewati jendela dukungan; atau server di-rollback sehingga klien lebih baru | Perintah tertahan lama, antrean menumpuk, risiko transaksi tertunda terlalu lama dari server | Versi kontrak N/N−1 dengan jendela ≥ 30 hari; banner + pembaruan keras di momen aman; penahanan tanpa kehilangan data; migrasi aditif; gerbang rilis (BR-VER) | Dimitigasi |
| RSK-13 | Kontensi lock counter versi saat penulisan master/impor besar | Penulis lain menunggu | Transaksi master pendek; validasi di luar transaksi (BR-SYN-012) | Dimitigasi |

### 14.2 Asumsi

| ID | Asumsi | Status |
|---|---|---|
| AS-01 | "≤ 5.000 produk" = ≤ 5.000 **SKU aktif per outlet** (OQ-22 terjawab) | `DISEPAKATI` |
| AS-02 | Setiap device kasir, termasuk HP waiter, terdaftar sebagai **register** sendiri; HP waiter berjenis **`PELAYAN`** (tanpa pembayaran/shift/kas; BR-FNB-011) | `DISEPAKATI` (rev. 0.96) |
| AS-03 | Tiap device terhubung internet minimal sekali per beberapa hari (batas lease 7 hari) | `DISEPAKATI` melalui BR-AUT-008 |
| AS-04 | Perangkat kasir Android kelas menengah (RAM ≥ 3 GB) atau PC Windows biasa | `DIUSULKAN` |
| AS-05 | Hanya IDR; tarif pada contoh adalah ilustrasi | `DISEPAKATI` / `DIUSULKAN` |
| AS-06 | Satu server PostgreSQL tunggal (VPS Docker); tidak ada multi-region | `DISEPAKATI` melalui stack |
| AS-07 | Printer ESC/POS standar 58/80 mm | `DIUSULKAN` |
| AS-08 | Tenant **dibuat oleh admin platform** (bukan self-service; revisi 1.01, BR-TEN-008); Owner pertama diberi akses oleh admin platform; billing di luar MVP | `DISEPAKATI` |
| AS-09 | Hanya satu profil pajak aktif per outlet (`NONE`/`PPN`/`PB1`); **outlet campuran** (menu F&B dan barang retail dalam satu struk) belum didukung di MVP — upgrade kelak berupa kode pajak per produk + baris pajak per transaksi tanpa migrasi destruktif | `PERLU KONFIRMASI` (OQ-01c; akuntan) |
| AS-10 | Inventori (GR/transfer/opname) dilakukan online di `/admin` (OQ-20 terjawab) | `DISEPAKATI` |
| AS-11 | Bahasa UI MVP = `id-ID` (default) + `en-US`; data master tidak diterjemahkan; aksara non-Latin tidak didukung pada cetak; memakai library i18n (OQ-23 terjawab) | `DISEPAKATI` |
| AS-12 | Device menyimpan seluruh katalog tenant + penugasan outletnya; ≤ 5.000 SKU dibaca sebagai SKU yang efektif tersedia (OQ-27c terjawab; arti angka 5.000 = SKU aktif per outlet, OQ-22 terjawab) | `DISEPAKATI` |

---

## 15. Daftar Open Questions (`PERLU KONFIRMASI`)

> Setiap butir memuat opsi + dampak dan **asumsi sementara** yang sudah dipakai di dokumen. Tidak ada butir yang memblokir penulisan dokumen; kolom "Dibutuhkan sebelum" menunjukkan kapan jawaban sebaiknya sudah ada. Jawaban yang mengubah asumsi cukup menyunting aturan BR terkait.

### 15.1 Ringkasan

| ID | Topik | Penentu | Dibutuhkan sebelum | Aturan terkait |
|---|---|---|---|---|
| OQ-01 | Aturan detail pajak (SC kena pajak? inklusif? profil pajak) — **SEBAGIAN TERJAWAB 2026-11-18** (a, b, d, e, f dan (c) untuk MVP); **sisa: (c) outlet campuran + konfirmasi akuntan atas perlakuan hukum** | Akuntan | F3 (PPN) / F5 (PB1) | BR-TAX-* |
| OQ-02 | ~~Seri invoice per register~~ **TERJAWAB 2026-11-18** (opsi A, seri per register; konfirmasi auditor tetap disarankan sebelum produksi) | User | Produksi pertama | BR-INV-011 |
| OQ-03 | ~~Kebijakan retensi data server~~ **TERJAWAB 2026-11-17** (simpan semua tanpa penghapusan, untuk MVP) | User | Produksi pertama | NFR-DATA-001 |
| OQ-04 | ~~Format final nomor invoice/nota kredit~~ **TERJAWAB 2026-11-17**, **direvisi 2026-11-18**: `{PREFIKS}-{MMYY}-{URUT6}` dengan prefiks per register (wajib, unik per tenant), reset bulanan; nota kredit `NK` | User | F3 | BR-INV-003 |
| OQ-05 | ~~Role default & batas diskon~~ **TERJAWAB 2026-11-17** (nilai usulan) | User | F1 (seed role) / F3 | BR-AUT-009, BR-DSC-003 |
| OQ-06 | ~~Aturan fallback harga~~ **TERJAWAB 2026-11-17** (default tenant, lalu blokir) | User | F2 | BR-PRC-002 |
| OQ-07 | ~~Dampak retur ke stok & HPP~~ **TERJAWAB 2026-11-17** (biaya snapshot penjualan) | User | F4 | BR-RTR-008, BR-HPP-007 |
| OQ-08 | ~~Detail aturan merge bill~~ **TERJAWAB 2026-11-17** (item sejenis digabung jadi satu baris) | User | F5 | BR-SPL-020..024 |
| OQ-09 | ~~Skala numeric kuantitas & faktor~~ **TERJAWAB 2026-11-17** (scale 4) | User/engineer | F1 (skema) | BR-MNY-002, BR-UOM-005 |
| OQ-10 | ~~Titik pembulatan pajak (per bill vs per baris) & half-up~~ **TERJAWAB 2026-11-18** (per bill, half-up) | User | F3 | BR-MNY-004/005 |
| OQ-11 | ~~Batas waktu & syarat void invoice~~ **TERJAWAB 2026-11-17** (hanya di shift yang sama) | User | F3 | BR-INV-005 |
| OQ-12 | ~~Biaya saat stok minus/nol~~ **TERJAWAB 2026-11-18** (biaya referensi) | User | F4 | BR-HPP-005 |
| OQ-13 | ~~Aturan pembulatan tunai (arah, pembayaran campuran)~~ **TERJAWAB 2026-11-17** (terdekat half-up, tunai penyelesai) | User | F3 | BR-TAX-009 |
| OQ-14 | ~~Detail transfer antar outlet~~ **TERJAWAB 2026-11-17** (penerimaan satu kali; kelebihan lewat opname) | User | F4 | BR-TRF-004 |
| OQ-15 | ~~Visibilitas selisih kas & tutup shift darurat~~ **TERJAWAB 2026-11-17** (kasir boleh lihat selisih setelah submit; ada tutup shift darurat) | User | F3 | BR-SHF-006/009 |
| OQ-16 | ~~Representasi split "bagi rata"~~ **TERJAWAB 2026-11-17** (satu baris "Bagian k/N"; stok dikonsumsi sekali saat bagian pertama dibayar) | User | F5 | BR-SPL-003 |
| OQ-17 | ~~Void item pada open bill sebelum bayar~~ **TERJAWAB 2026-11-17** (tanpa PIN, alasan wajib) | User | F5 | BR-AUT-009, BR-FNB-008 |
| OQ-18 | ~~Harga manual/open price~~ **TERJAWAB 2026-11-17** (kolom penanda open price per item; BR-PRC-007) | User | F3 | BR-PRC-002 |
| OQ-19 | ~~Metode refund~~ **TERJAWAB 2026-11-17** (tunai atau sesuai metode asal) | User | F3 | BR-RTR-007 |
| OQ-20 | ~~Inventori (GR/opname) dari device secara offline~~ **TERJAWAB 2026-11-17** (online-only di `/admin`) | User | F4 | AS-10 |
| OQ-21 | ~~Data pelanggan (nama/telepon): persetujuan & retensi~~ **TERJAWAB 2026-11-17** (simpan + masking) | User | F3 | BR-CUS-002 |
| OQ-22 | ~~Arti "≤ 5.000 produk" (SKU vs produk induk)~~ **TERJAWAB 2026-11-17** (5.000 SKU aktif per outlet) | User | F2 | BR-CAT-008, AS-01 |
| OQ-23 | ~~Daftar bahasa UI MVP, bahasa struk, terjemahan data master~~ **TERJAWAB 2026-11-17** | User | F1 (infrastruktur) / F3 (struk) | BR-I18N-001/005/007/008, AS-11 |
| OQ-24 | ~~Default ketersediaan untuk **outlet baru**~~ **TERJAWAB 2026-11-17** (semua tersedia) | User | F2 | BR-CAT-011 |
| OQ-25 | ~~Item yang tidak tersedia di outlet sebagai **bahan resep/BOM**~~ **TERJAWAB 2026-11-17** (tanpa validasi baru) | User | F5 | BR-CAT-018 |
| OQ-26 | ~~Fitur "habis sementara/86" untuk F&B~~ **TERJAWAB 2026-11-17** (tidak ada di MVP) | User | F5 | BR-CAT-019 |
| OQ-27 | ~~Detail ketersediaan (arah override SKU, pesan scan, unduhan katalog)~~ **TERJAWAB 2026-11-17** (override menang; pesan khusus; unduh seluruh katalog) | User | F2/F3 | BR-CAT-010/014/015/016 |
| OQ-34 | ~~Mitigasi penundaan login pemilik akun oleh penyerang~~ **TERJAWAB 2026-11-19** (tanpa mitigasi; hanya log; jeda maks 15 menit) | User | — | BR-RLM-003 |
| OQ-35 | ~~Reset password lintas tenant~~ **TERJAWAB 2026-11-19** (opsi A; penolakan generik "hubungi operator platform") | User | F1 | BR-IDN-005 |
| OQ-36 | ~~Alur undangan tanpa email~~ **TERJAWAB 2026-11-19** (opsi A; kode sekali pakai terikat email, undangan 72 jam, reset 24 jam; tanpa password sementara) | User | F1 | BR-IDN-004/005 |
| OQ-37 | ~~Sesi back-office: global atau per slug~~ **TERJAWAB 2026-11-19** (cookie sesi **per slug**, login terpisah per tenant; akun tetap global) | User | F1 | BR-IDN-002 |
| OQ-32 | ~~Daftar final kode error (awal 19 kode) dan ambang lonjakan error~~ **TERJAWAB 2026-11-18** (22 kode ARCHITECTURE §9.7.1; ≥ 10 `INTERNAL_ERROR`/5 menit; 1 pesan per jenis per 10 menit; source map = versi dilaporkan + 90 hari) | User | F1 | BR-ERR-002/011/012, BR-LOG-008 |
| OQ-30 | ~~Domain kustom per tenant~~ **TERJAWAB 2026-11-18 — DITUNDA** (tanpa pekerjaan di MVP; ditambahkan aditif kelak bila diminta; bukan open) | User | Setelah MVP | BR-TEN-010 |
| OQ-31 | ~~Detail ringan URL/akun: pengalihan huruf kapital, `/<slug>` polos, email antar tenant~~ **TERJAWAB 2026-11-18** (308 ke huruf kecil kanonis; pemilih "Terminal Kasir"/"Back-office"; email boleh sama di tenant berbeda) | User | F1 | BR-TEN-003/009/012 |
| OQ-33 | ~~Siapa yang mengatur nama tenant~~ **TERJAWAB 2026-11-18** (operator platform saat membuat tenant, maks 40 karakter; perubahan lewat operator; tanpa layar nama di `/admin`) | User | F1 | BR-TEN-007/008 |
| OQ-29 | ~~Jendela dukungan kontrak lama dan batas pembaruan keras~~ **TERJAWAB 2026-11-18** (30 hari; pembaruan keras hanya saat shift tertutup) | User | Sebelum rilis pertama | BR-VER-002/004 |
| OQ-28 | ~~Item open price: hak akses, batas nilai, catatan wajib, tampil di struk~~ **TERJAWAB 2026-11-17** (semua role checkout; tanpa kontrol tambahan) | User | F3 | BR-PRC-007 |

### 15.2 Rincian

**OQ-01 — Aturan pajak (service charge, inklusif/eksklusif, profil pajak) — `SEBAGIAN TERJAWAB` (2026-11-18): (a) Opsi C, default ya; (b) aturan BR-TAX-007 dipertahankan, harga "nett" = inklusif + SC nonaktif; (c) satu profil per outlet untuk MVP — outlet campuran F&B + retail tetap `PERLU KONFIRMASI` (akuntan); (d)(e)(f) asumsi dikonfirmasi.** *Penentu:* akuntan. Sub-pertanyaan: (a) apakah service charge kena PB1/PPN; (b) pada mode inklusif, dasar SC dan ekstraksi pajaknya; (c) boleh PPN dan PB1 aktif bersamaan; (d) perlakuan outlet non-PKP; (e) barang bebas PPN; (f) dasar pengenaan khusus.
- **Opsi A — SC kena pajak** (Contoh 3a: PB1 12.332, total 135.655).
- **Opsi B — SC tidak kena pajak** (Contoh 3b: PB1 11.745, total 135.068; selisih Rp587/bill).
- **Opsi C — dikonfigurasi per outlet** (flag `service_charge_taxable`) → fleksibel, tidak mengubah arsitektur; butuh pengujian dua cabang.
*Dampak:* angka pajak/total, laporan pajak, kepatuhan. *Asumsi sementara:* Opsi C dengan default kena pajak = **ya**; profil pajak satu dari `NONE`/`PPN`/`PB1`; flag `taxable` per produk.

**OQ-02 — Seri invoice per register — `TERJAWAB` (2026-11-18): opsi A, seri per register** (konfirmasi auditor tetap disarankan sebelum produksi pertama). *Penentu awal:* akuntan/auditor/otoritas.
- **A — seri per register** (asumsi; bekerja offline, kolisi mustahil).
- **B — seri per outlet** (butuh koordinasi lintas device → tidak mungkin offline tanpa blok-alokasi).
- **C — seri per register + penomoran resmi (faktur pajak) dibuat server di fase lanjut.**
*Dampak:* A konsisten dengan KEP-04 tetapi bisa ditolak auditor; B mengubah arsitektur offline. Catatan: yang wajib berurutan tanpa celah umumnya faktur pajak, bukan struk kasir — **harus dikonfirmasi pihak berwenang**. *Asumsi:* A.

**OQ-03 — Retensi data server — `TERJAWAB` (2026-11-17): simpan semua dulu, tanpa penghapusan (opsi A); skema siap partisi bulanan.** User menyebut "dulu" → ditinjau ulang bersama akuntan sebelum produksi jangka panjang. *Penentu awal:* user + akuntan (ketentuan penyimpanan pembukuan).
- **A — simpan semua**; partisi bulanan untuk performa.
- **B — retensi N tahun**, partisi lama dipindah ke arsip dingin.
- **C — purge setelah N tahun** (risiko kepatuhan).
*Dampak:* biaya storage, performa, kepatuhan. *Asumsi:* A; skema siap partisi bulanan.

**OQ-04 — Format nomor invoice — `TERJAWAB` (2026-11-17; direvisi 2026-11-18: `{PREFIKS}-{MMYY}-{URUT6}`, prefiks per register wajib dan unik per tenant; jawaban awal di bawah dipertahankan sebagai jejak keputusan).** Jawaban user: format kustom **`<kode custom>-<kode register (opsional)>-<mmyy>-<urut 6 digit>`**, ditegaskan: urut **reset tiap bulan**; kode custom diatur **per outlet** (default kode outlet); penanda nota kredit dipertanyakan user ("kenapa CN?") dan diganti menjadi **`NK`** (Nota Kredit) — lihat BR-INV-003 dan BR-INV-010. Opsi awal (A `OUT01-POS02-000123`, B memuat tahun, C tanpa kode outlet) dipertahankan sebagai jejak keputusan; user memilih bentuk kustom di luar ketiganya.

**OQ-05 — Role default & batas diskon — `TERJAWAB` (2026-11-17): opsi A, nilai usulan.** Nilai di BR-AUT-009 (Kasir 5%, Supervisor 20%, Manager 50%, Owner 100%).
- **A** nilai usulan; **B** batas nominal absolut per role selain persen; **C** nilai lain dari user. *Dampak:* kontrol kebocoran vs kecepatan layanan. *Asumsi:* A.

**OQ-06 — Fallback harga — `TERJAWAB` (2026-11-17): opsi A, default tenant lalu blokir.**
- **A — default tenant → blokir** (asumsi).
- **B — turunkan dari harga base × faktor** bila harga UOM tidak ada (mempermudah entri, tetapi menimbulkan harga grosir tak disengaja).
- **C — hanya harga eksplisit per outlet** (tanpa default tenant).
- **D — izinkan harga manual** (lihat OQ-18; tidak dipilih — user memilih penanda open price per item, BR-PRC-007).
*Dampak:* kelengkapan data harga, risiko jual tanpa harga/harga salah. *Asumsi:* A.

**OQ-07 — Retur → stok & HPP — `TERJAWAB` (2026-11-17): opsi A, biaya snapshot penjualan asal** (menu F&B ber-resep default `BUANG`).
- **A — kembali pada biaya snapshot penjualan** (asumsi untuk retail).
- **B — kembali pada biaya rata-rata saat retur** (rata-rata bergeser).
- **C — tidak pernah kembali ke stok** (selalu dibuang).
Menu F&B ber-resep: default `BUANG`. *Dampak:* akurasi nilai persediaan & HPP; A menjaga laba kotor transaksi asal. *Asumsi:* A (retail) + `BUANG` (menu ber-resep).

**OQ-08 — Detail merge bill — `TERJAWAB` (2026-11-17): item sejenis digabung jadi satu baris** (diskon bill sumber tetap dibuang; beda pemegang tetap tidak boleh). Sub-pertanyaan & opsi awal:
- Beda pemegang: **A tidak boleh** (asumsi, selaras tanpa take-over) / B boleh bila pemegang sumber merelakan (butuh mekanisme serah-terima yang saat ini tidak ada).
- Diskon bill sumber: **A dibuang** (asumsi) / B dipindah ke target / C dijumlahkan.
- Item sejenis: **A dipertahankan sebagai baris terpisah** (asumsi) / B digabung jadi satu baris.
- Merge bill anak yang sudah dibayar: **dilarang** (asumsi).
*Dampak:* kasir F&B sehari-hari; konsistensi dengan BR-FNB-004.

**OQ-09 — Skala numeric — `TERJAWAB` (2026-11-17): opsi B, scale 4.** Kuantitas dan faktor konversi.
- **A — scale 3** (gram/mililiter cukup bila base unit kecil; ruang kecil).
- **B — scale 4** (asumsi; 1/3 porsi pada split bagi rata = 0,3333).
- **C — scale 6** (lebih halus; biaya storage/perbandingan, lebih banyak peluang pecahan tak terduga).
*Dampak:* presisi konversi, ukuran Dexie, perilaku penolakan input. Perlu diputuskan sebelum skema dibuat. *Asumsi:* B.

**OQ-10 — Titik pembulatan pajak — `TERJAWAB` (2026-11-18): opsi A, pajak per bill, half-up.**
- **A — pajak per bill, half-up** (asumsi).
- **B — pajak per baris lalu dijumlahkan.**
*Contoh selisih:* 3 baris @1.050, PPN 11% eksklusif: per bill R(3.150×0,11) = R(346,5) = **347**; per baris 3 × R(115,5) = 3 × 116 = **348** (selisih Rp1). *Dampak:* konsistensi dengan akuntan/faktur pajak kelak. *Asumsi:* A.

**OQ-11 — Void invoice — `TERJAWAB` (2026-11-17): opsi A, hanya selama shift pembuatnya masih terbuka + PIN supervisor.**
- **A — hanya selama shift tempat invoice dibuat masih terbuka + PIN supervisor** (asumsi).
- **B — sampai akhir `business_date`**.
- **C — tanpa batas** (bertentangan dengan rekap shift yang sudah ditutup).
*Dampak:* integritas rekap kas & laporan. *Asumsi:* A.

**OQ-12 — Biaya saat stok minus/nol — `TERJAWAB` (2026-11-18): opsi A, biaya referensi** (sejalan praktik umum sistem persediaan: biaya terakhir yang diketahui; konfirmasi akuntan tetap disarankan).
- **A — biaya referensi (biaya rata-rata terakhir saat saldo positif)** (asumsi).
- **B — HPP 0 lalu direvaluasi saat GR berikut** (rumit; mengubah HPP masa lalu).
- **C — biaya GR terakhir.**
*Dampak:* akurasi HPP, kompleksitas ledger. *Asumsi:* A.

**OQ-13 — Pembulatan tunai — `TERJAWAB` (2026-11-17): (a) terdekat half-up; (b) hanya tunai penyelesai; (c) unit per outlet (default Rp100).**
- (a) Arah: **A terdekat half-up** (asumsi) / B selalu ke atas / C selalu ke bawah.
- (b) Pembayaran campuran: **A hanya tunai penyelesai** (asumsi) / B hanya bila seluruhnya tunai / C bulatkan total apa pun metodenya.
- (c) Unit: tidak ada / 100 / 500 / 1.000 (per outlet; default 100).
*Dampak:* selisih rupiah kecil di kas & laporan; kepatuhan perlindungan konsumen. *Asumsi:* A/A/100.

**OQ-14 — Transfer antar outlet — `TERJAWAB` (2026-11-17): penerimaan satu kali; kelebihan lewat opname; transfer tetap online-only.**
- Penerimaan: **A satu kali** (asumsi) / B parsial berkali-kali.
- Kelebihan terima: **A dilarang → opname** (asumsi) / B diizinkan dengan biaya sama.
- Transfer lewat device offline: **A tidak** (asumsi) / B ya.
*Dampak:* kompleksitas dokumen & stok in-transit.

**OQ-15 — Kas — `TERJAWAB` (2026-11-17): (a) opsi B, kasir boleh melihat selisih setelah submit hitungan; (b) opsi A, ada tutup shift darurat oleh manager; (c) opsi A, tanpa ambang PIN saat tutup.**
- (a) Kasir melihat selisih setelah submit: **A tidak** (asumsi; hanya `shift.view_variance`) / B ya.
- (b) Tutup shift darurat oleh manager: **A ya** (asumsi) / B tidak ada (register tak dapat dipulihkan bila shift menggantung).
- (c) Ambang selisih yang memerlukan PIN supervisor saat tutup: **A tidak ada** (asumsi) / B ada (mis. > Rp50.000).
*Dampak:* pengendalian internal vs kelancaran pergantian shift.

**OQ-16 — Bagi rata — `TERJAWAB` (2026-11-17): opsi B, satu baris "Bagian k/N"** (dipilih setelah penjelasan ulang; BR-SPL-007). Teks opsi awal dipertahankan sebagai jejak keputusan.
- **A — baris pecahan dialokasikan LR per baris** (asumsi): stok/resep akurat, tetapi struk anak memuat baris kuantitas pecahan (mis. 0,3334 porsi).
- **B — satu baris sintetis "Bagian k/N"**; konsumsi stok dibebankan pada anak pertama: sederhana, tetapi stok/HPP per anak tidak proporsional.
- **C — tidak ada bagi rata** (hanya per item/kuantitas): paling sederhana; membatasi kasus patungan.
*Dampak:* akurasi stok & kompleksitas model data/struk.

**OQ-17 — Void item pra-bayar — `TERJAWAB` (2026-11-17): opsi A, tanpa PIN, alasan wajib.** **A — tanpa PIN, alasan wajib** (dipilih) / **B — selalu PIN supervisor.** Tanpa KDS tidak ada penanda "sudah masuk dapur", sehingga A rawan kebocoran, B memperlambat layanan.

**OQ-18 — Harga manual/open price — `TERJAWAB` (2026-11-17):** user memilih jalur sendiri — **tambahkan kolom penanda bila item adalah open price**; setelah dikonfirmasi ulang: **flag di master produk + snapshot di baris penjualan**, harga master boleh ada sebagai nilai awal yang dapat diubah kasir (`is_open_price` pada produk dan snapshot pada baris penjualan; BR-PRC-007). Opsi awal: **A — tidak ada** (asumsi) / B ya dengan permission + audit / C hanya untuk kategori tertentu. *Dampak:* fleksibilitas kasir vs kontrol harga.

**OQ-19 — Metode refund — `TERJAWAB` (2026-11-17): opsi A, tunai atau sesuai metode asal.** **A — tunai atau sesuai metode asal** (dipilih) / B hanya tunai / C hanya sesuai asal. *Dampak:* kas laci dan rekonsiliasi non-tunai.

**OQ-20 — Inventori dari device offline — `TERJAWAB` (2026-11-17): opsi A, online-only di `/admin`.** **A — online-only di `/admin`** (dipilih) / B GR & penghitungan opname dapat dilakukan di device (perintah outbox) / C hanya penghitungan opname offline. *Dampak:* kompleksitas sync, UX gudang di area tanpa sinyal.

**OQ-21 — Data pelanggan — `TERJAWAB` (2026-11-17): opsi A, simpan + masking di laporan.** **A — simpan nama/telepon + masking di laporan** (dipilih) / B tambahkan penanda persetujuan pelanggan / C enkripsi kolom. Retensi & hak penghapusan data pribadi perlu ditinjau (regulasi perlindungan data pribadi). *Dampak:* kepatuhan, kompleksitas.

**OQ-22 — Arti "≤ 5.000 produk" — `TERJAWAB` (2026-11-17): opsi A, 5.000 SKU aktif per outlet.** **A — ≤ 5.000 SKU aktif per outlet** (asumsi) / B ≤ 5.000 produk induk (jumlah SKU bisa jauh lebih banyak). *Dampak:* ukuran Dexie, waktu full resync, performa pencarian.

**OQ-23 — Bahasa UI MVP — `TERJAWAB` (2026-11-17).** Jawaban user: (a) **Indonesia + Inggris**; (b) **tambahkan library i18n** (tidak menyebut penerjemah → asumsi developer; BR-I18N-011); (c) **nama master satu bahasa**; (d) bahasa struk pelanggan **sesuai yang dikustomisasi** pada kustomisasi struk outlet. Butir ini tidak lagi terbuka; teks pertanyaan awal dipertahankan sebagai jejak keputusan. Sub-pertanyaan awal:
- (a) Daftar bahasa: **A — Indonesia + Inggris** (asumsi) / B — A + bahasa daerah (mis. Jawa, Sunda) / C — A + bahasa beraksara non-Latin (mis. Mandarin, Arab).
- (b) Siapa yang menerjemahkan dan menjaga kamus (developer sendiri, penerjemah eksternal, atau mesin lalu ditinjau)?
- (c) Terjemahan data master (nama produk/menu): **A — tidak ada, satu bahasa** (asumsi) / B — terjemahan opsional per produk (menambah kolom master dan ukuran sinkron).
- (d) Bahasa struk: **A — satu bahasa per outlet** (asumsi) / B — dipilih per transaksi / C — dwibahasa pada struk yang sama.
*Dampak:* opsi (a)-C **tidak dapat dicetak** lewat teks ESC/POS standar (BR-I18N-008) → butuh jalur bitmap yang lebih lambat (bertentangan dengan prioritas kecepatan cetak, NFR-PERF-002); (a)-B menambah beban terjemahan; (c)-B menambah model data master dan beban sync; (d)-C memperpanjang struk 58 mm. *Asumsi sementara:* (a)-A, (c)-A, (d)-A; penerjemah = developer.

**OQ-24 — Default ketersediaan untuk outlet baru — `TERJAWAB` (2026-11-17): opsi A, semua item tersedia.** Item **baru** sudah diputuskan tersedia di semua outlet; yang belum diputuskan adalah outlet yang dibuat **setelah** item ada.
- **A — semua item tersedia** (asumsi sementara; satu transaksi, satu versi): outlet baru siap jual segera, tetapi menampilkan item yang mungkin tidak dimaksudkan dijual di sana (yang belum punya harga tampil "harga belum diatur").
- **B — semua item tidak tersedia sampai ditugaskan:** aman dari salah jual, tetapi admin harus menugaskan ribuan item (butuh pengaturan massal/impor) sebelum outlet dapat berjualan.
- **C — salin dari outlet acuan:** admin memilih outlet yang ditiru (termasuk override SKU); cepat untuk waralaba seragam, menambah satu langkah saat membuat outlet.
*Dampak:* kecepatan onboarding outlet vs risiko menjual item yang tidak seharusnya; ukuran transaksi pembuatan outlet (≈ jumlah produk aktif baris). *Asumsi:* A.

**OQ-25 — Item tidak tersedia sebagai bahan resep/BOM — `TERJAWAB` (2026-11-17): tanpa validasi baru (a-A, b-A, c-A).** *Invarian yang sudah pasti:* server tidak pernah menolak konsumsi resep karena ketersediaan (BR-CAT-018). Yang belum diputuskan:
- (a) Validasi saat konfigurasi resep: **A — bahan yang `UNAVAILABLE` di outlet tetap boleh** dipakai resep / **B — ditolak atau diperingatkan** saat resep dikonfigurasi untuk outlet itu.
- (b) Menu yang bahannya tidak tersedia: **A — tetap dijual** / **B — ikut tersembunyi di outlet itu**.
- (c) Bahan baku yang memang tidak dijual: **A — tidak memerlukan penugasan sama sekali** (hanya item jual yang diatur) / **B — tetap bertanda per outlet** seperti item lain.
*Dampak:* A menjaga alur resep sederhana; B mencegah resep tak terpenuhi tetapi menambah ketergantungan antar-entitas dan aturan validasi lintas master. *Asumsi:* tidak ada validasi baru; hanya invarian di BR-CAT-018.

**OQ-26 — "Habis sementara/86" untuk F&B — `TERJAWAB` (2026-11-17): opsi A, tidak ada di MVP** (modifier tetap tanpa status per outlet). Ketersediaan yang diputuskan bersifat permanen/administratif dan online. Apakah perlu mekanisme **terpisah** untuk menandai menu/modifier habis sementara (mis. harian)?
- **A — tidak ada di MVP** (ketersediaan permanen saja).
- **B — flag sementara yang dapat diubah dari POS (offline)**, dikirim sebagai event dan diteruskan ke device lain: cepat bagi kasir, tetapi melanggar prinsip "master hanya online", butuh aturan konflik antar device, dan tanpa sync LAN device lain baru tahu saat sync.
- **C — flag sementara diubah dari back-office (online)** dengan reset otomatis per `business_date`: konsisten dengan master online, tidak responsif bagi kasir saat offline.
Sub-pertanyaan: apakah **modifier/add-on** juga memerlukan status tersedia/habis per outlet (ketersediaan MVP hanya mencakup produk/SKU). *Dampak:* kompleksitas sync F&B dan pengalaman kasir. *Asumsi:* A; modifier tidak memiliki status per outlet.

**OQ-27 — Detail ketersediaan — sebagian `TERJAWAB` (2026-11-17): (a) opsi A, override menang dua arah; (b) opsi A, pesan khusus; (c) opsi A, device mengunduh seluruh katalog tenant.**
- (a) **Arah override SKU:** **A — override menang dua arah** (SKU dapat `AVAILABLE` walau induk `UNAVAILABLE` di outlet itu; asumsi sementara, BR-CAT-016) / **B — override hanya dapat membatasi** (induk `UNAVAILABLE` ⇒ semua SKU tidak tersedia). A memberi fleksibilitas "hanya varian L-Hitam di C"; B lebih mudah dipahami dan mengurangi kasus pinggir.
- (b) **Pesan saat scan item tidak tersedia:** **A — "{nama} tidak tersedia di outlet ini"** (asumsi; membutuhkan item tetap ada di Dexie) / **B — pesan generik "barcode tidak dikenal"** (tidak membuka informasi katalog lintas outlet, tetapi kasir tidak bisa membedakan salah scan dan item tidak dijual) / **C — pesan khusus + izin supervisor untuk melanjutkan** (menambah jalur override; bertentangan dengan keputusan item disembunyikan).
- (c) **Unduhan katalog:** **A — device mengunduh seluruh katalog tenant** dan menyembunyikan yang tidak tersedia (asumsi; mendukung pesan spesifik dan reaktivasi tanpa unduh ulang, namun ukuran Dexie mengikuti katalog tenant sehingga batas ≤ 5.000 SKU perlu dibaca sebagai efektif tersedia — OQ-22) / **B — device hanya mengunduh item yang tersedia di outletnya** (hemat storage dan full resync lebih kecil, tetapi pengaktifan kembali menuntut penyegaran baris produk dan pesan scan menjadi generik).
*Dampak:* konsistensi aturan, ukuran storage, pengalaman kasir. *Asumsi:* (a)-A, (b)-A, (c)-A.

**OQ-28 — Item open price: hak akses dan batas — `TERJAWAB` (2026-11-17): (a) A, semua role yang boleh checkout; (b) A, hanya bilangan bulat > 0; (c) A, catatan opsional; (d) A, tidak ditampilkan di struk (user memilih "tidak ada kontrol tambahan").** Penanda open price sudah diputuskan (BR-PRC-007); sub-pertanyaan awal:
- (a) **Siapa boleh menjual item open price:** **A — semua role yang boleh checkout** (asumsi) / B — hanya Supervisor ke atas / C — semua role tetapi nominal di atas ambang memerlukan PIN supervisor.
- (b) **Batas nilai harga yang diketik:** **A — hanya bilangan bulat > 0** (asumsi) / B — ada batas atas per tenant (mis. Rp10.000.000) / C — batas per produk.
- (c) **Catatan/alasan wajib per baris open price:** **A — opsional** (asumsi) / B — wajib.
- (d) **Penanda open price di struk pelanggan:** **A — tidak ditampilkan** (asumsi) / B — ditampilkan.
*Dampak:* kontrol terhadap salah ketik/penyalahgunaan harga (terutama C/B) vs kecepatan kasir. *Asumsi:* (a)-A, (b)-A, (c)-A, (d)-A.

**OQ-29 — Jendela dukungan kontrak lama dan batas pembaruan keras — `TERJAWAB` (2026-11-18): (a) 30 hari; (b) opsi A, pembaruan keras hanya saat shift tertutup (tanpa keranjang aktif, antrean kosong).** Tidak lagi asumsi. Teks pertanyaan awal dipertahankan sebagai jejak keputusan: (a) Jendela: opsi **14 hari** (jawaban user sebelumnya untuk BR-SYN-003; beban pemeliharaan dua kontrak lebih ringan, device yang jarang online lebih mudah tertinggal), **30 hari** (dipilih), **60 hari** (paling longgar, dua kontrak hidup lebih lama). (b) Pembaruan keras saat layar terkunci dengan shift terbuka: **A — tidak boleh; hanya shift tertutup** (dipilih) / B — boleh saat layar terkunci. *Dampak:* lama kontrak lama dipelihara vs risiko klien tertinggal. Catatan penerapan: "antrean kosong" memiliki pengecualian *terkunci aman* (BR-VER-004) agar klien di bawah versi minimum tidak buntu.

**OQ-30 — Domain kustom per tenant — `TERJAWAB` (2026-11-18) sebagai "ditunda" (bukan open): tanpa pekerjaan di MVP; resolver tenant sudah disiapkan; bila ada tenant yang meminta, ditambahkan aditif kelak (TLS per domain via certbot saat itu).** Teks opsi awal dipertahankan sebagai jejak keputusan: **A — tidak ada di MVP** (satu `<DOMAIN>` dengan slug; dipilih untuk MVP) / **B — subdomain per tenant** (mis. `acme.<DOMAIN>`): memerlukan sertifikat wildcard dan mengubah alamat aplikasi/penyimpanan lokal / **C — domain kustom milik tenant** (mis. `pos.acme.co.id`): memerlukan verifikasi domain dan sertifikat per domain. *Dampak:* alamat PWA terpasang, penyimpanan lokal (terikat alamat), enrollment device, TLS, dan slug permanen (BR-TEN-004).

**OQ-31 — Detail ringan URL/akun — `TERJAWAB` (2026-11-18): (a) 308 ke huruf kecil kanonis (mengikuti ARCHITECTURE OQ-A23); (b) `/<slug>` polos = halaman pemilih "Terminal Kasir"/"Back-office" dengan nama tenant; (c) email boleh sama di tenant berbeda (dua akun terpisah, reset password per tenant).** Teks pertanyaan awal dipertahankan sebagai jejak keputusan: (a) pengalihan huruf kapital — A hanya segmen slug dan area, permanen untuk GET/HEAD (asumsi awal) / B seluruh path dinormalkan / C tidak dialihkan; (b) `/<slug>` polos — A halaman login tenant (asumsi awal) / B 404 / C otomatis ke `/<slug>/pos`; (c) email — A unik per tenant / B unik global. *Catatan:* jawaban (c) mengubah keputusan lama "satu orang = satu tenant" dan unik se-sistem pada BR-AUT-001/BR-TEN-003. **Digantikan rev. 1.06 (2026-11-19):** model identitas global + keanggotaan per tenant, email unik se-sistem, satu password (KEP-27, BR-IDN).

**OQ-32 — Daftar final kode error dan ambang lonjakan — `TERJAWAB` (2026-11-18).** Jawaban user: (a) **terima daftar 22 kode** di `docs/ARCHITECTURE.md` §9.7.1 (menggantikan "awal 19 kode"); (b) ambang lonjakan **≥ 10 `INTERNAL_ERROR` dalam 5 menit**; (c) **paling banyak 1 pesan Telegram per jenis per 10 menit** (penggabungan/ringkasan; mengikuti ARCHITECTURE §9.7.10); (d) retensi source map: **selama versi masih dilaporkan perangkat + 90 hari**. Teks pertanyaan awal dipertahankan sebagai jejak keputusan: (a) daftar awal 19 kode (6 umum + 13 domain termasuk `DEVICE_NOT_ENROLLED`, `STORAGE_UNAVAILABLE`, `CLOCK_INVALID`, `RENDER_CRASH`, `APP_START_FAILED`) / B — tambah/kurangi kode; (b) ambang awal ≥ 20 baris `error` dalam 5 menit / lebih rendah (10) / lebih tinggi (50); (c) 1 pesan per jenis per 10 menit / 1 per jam. *Perubahan dari 19 ke 22 kode:* kode `DEVICE_NOT_ENROLLED`, `STORAGE_UNAVAILABLE`, `CLOCK_INVALID`, `RENDER_CRASH`, `APP_START_FAILED` tidak dipakai (digantikan `APP_ERROR`/`LOCAL_DB_FAILED`/`STORAGE_FULL` atau pesan tanpa kode); ditambah `CREDENTIAL_EXPIRED`, `STORAGE_FULL`, `LOCAL_DB_FAILED`, `APP_ERROR`, `HANDOVER_NOT_PENDING`, `EVENTS_PENDING`, `RATE_LIMITED`, `FEATURE_DISABLED`. Karena kode stabil (BR-ERR-003), daftar dikunci **sebelum rilis pertama** yang mengirim kode ke lapangan.

**OQ-33 — Siapa yang mengatur nama tenant — `TERJAWAB` (2026-11-18): nama tampilan (maks 40 karakter) diatur operator platform saat membuat tenant; perubahan lewat operator; tanpa layar pengaturan nama di `/admin` untuk Owner di MVP.** Teks opsi awal dipertahankan sebagai jejak keputusan: user memutuskan **tidak ada warna/tema tenant di MVP** (hanya nama tampil). Opsi: **A — nama awal oleh admin platform, perubahan oleh Owner di `/admin`** (asumsi sementara sebelumnya; tidak dipilih) / **B — hanya admin platform** (**dipilih**; konsisten dengan slug yang tidak dapat diubah, setiap perubahan nama lewat operator) / **C — hanya Owner**. *Dampak:* hak akses pengaturan tenant, nama pada PWA terpasang dan halaman login/pemilih, beban operasional admin platform.

**OQ-34 — Mitigasi penundaan login pemilik akun — `TERJAWAB` (2026-11-19): TANPA mitigasi, hanya dicatat di log (jeda maksimum 15 menit).** Teks opsi awal dipertahankan sebagai jejak keputusan: **A — tidak ada mitigasi di MVP** (dipilih) / B — penanda perangkat tepercaya / C — verifikasi tambahan lewat email (tidak tersedia: tanpa email di MVP, BR-IDN-003). *Catatan:* dengan akun global, celah ini berlaku lintas tenant karena kunci login adalah email lintas slug (BR-RLM-003; rev. 1.07).

**OQ-35 — Reset password lintas tenant — `TERJAWAB` (2026-11-19): opsi A; penolakan kepada Owner memakai pesan generik "hubungi operator platform" (tidak mengakui akun multi-tenant).** Teks opsi awal dipertahankan sebagai jejak keputusan: karena identitas dipakai lintas tenant, owner tenant A yang mereset password akun Ani (yang juga Owner tenant B) dapat mengambil alih tenant B. **A — owner hanya boleh mereset akun yang keanggotaannya HANYA di tenantnya; akun multi-tenant hanya direset operator platform atau pemiliknya sendiri** (**dipilih**) / B — owner boleh mereset siapa pun (celah pengambilalihan; ditolak) / C — semua reset lewat operator platform. Sub-pertanyaan awal (pesan penolakan mengakui akun multi-tenant atau generik) dijawab: **generik**.

**OQ-36 — Alur undangan tanpa email — `TERJAWAB` (2026-11-19): opsi A.** Kode undangan/reset **sekali pakai terikat email** (undangan 72 jam, reset 24 jam); **penerbit tidak pernah melihat atau menetapkan password**; kode dan respons sama baik email sudah punya akun maupun belum; penerima memasukkan email + kode + password sendiri (akun baru) atau password akun yang ada; **tidak ada password sementara dan tidak ada penanda wajib ganti password**. Teks opsi awal dipertahankan sebagai jejak keputusan: **A — kode undangan sekali pakai** (**dipilih**) / B — owner membuat password sementara untuk akun baru dan keanggotaan langsung ditambahkan bila akun sudah ada (membocorkan keberadaan akun; ditolak) / C — keanggotaan langsung ditambahkan tanpa penerimaan (ditolak).

**OQ-37 — Sesi back-office — `TERJAWAB` (2026-11-19): cookie sesi PER SLUG (`Path=/<slug>`), login terpisah per tenant; akun tetap global.** Ini **menggantikan** asumsi "satu cookie sesi global" dan **mempertahankan** keputusan "cookie sesi per tenant" (rev. 1.01). Setelah login di tenant, server memeriksa keanggotaan; logout hanya mengakhiri sesi tenant itu; dua tenant di satu browser membutuhkan login terpisah. Teks opsi awal dipertahankan sebagai jejak keputusan: A — satu cookie sesi global untuk seluruh origin (usulan; tidak dipilih) / **B — cookie sesi per slug** (**dipilih**).

---

## 16. Lampiran

### Lampiran A — Matriks Keputusan (`DISEPAKATI`)

| KEP | Keputusan inti | Status | Aturan terkait |
|---|---|---|---|
| KEP-01 | Offline-first: Dexie + outbox custom; server otoritas; skala (jam–1 hari, ≤5.000 produk, ≤500 trx/hari/outlet, retensi 3 bulan); device mandiri; hub LAN & KDS ditunda; pull dengan counter versi per tenant (+tombstone, full resync, alasan desain); stok = snapshot; push hibrida (perintah atomik idempoten + event bill; skema N/N−1); penjualan diterima sebagai fakta, hanya struktural/otorisasi → "perlu perhatian"; pemicu sync & realtime sebagai sinyal; waktu UTC + IANA + jam potong + `business_date` tersimpan + jam device tak dipercaya; `storage.persist`, banner, ekspor, risiko residual | `DISEPAKATI` | BR-SYN-*, BR-TIM-* |
| KEP-02 | Satu app TanStack Start: `/admin` SSR online-only, `/pos` SPA offline; update PWA prompt; master hanya online | `DISEPAKATI` | BR-SYN-001/002 |
| KEP-03 | Tenant → Entitas Hukum (NPWP/PKP) → Outlet (pajak daerah) → Register; `tenant_id` + RLS | `DISEPAKATI` | BR-TNT-* |
| KEP-04 | Register `cash_master`; invoice seri per register tanpa celah; void = status; gap & pemulihan; shift `cash_cashier` (satu per register, blind count, offline); nota kredit + supervisor + jendela 3 bulan; void parsial dilarang | `DISEPAKATI` (format dan batas void terjawab: OQ-04, OQ-11; penerimaan auditor `PERLU KONFIRMASI`, OQ-02) | BR-INV-*, BR-SHF-*, BR-RTR-* |
| KEP-05 | Better Auth + device enrollment + PIN; hash lambat, salt per device; PIN supervisor; lease offline 7 hari; pencabutan saat online; tanpa enkripsi IndexedDB; role dikonfigurasi | `DISEPAKATI` (role default terjawab: OQ-05) | BR-AUT-* |
| KEP-06 | Kategori/sub, produk, varian→SKU, multi-UOM (stok di base, faktor perkalian), harga per (SKU+UOM+outlet), harga stale = fakta, barcode scanner + kamera | `DISEPAKATI` (fallback harga dan skala numeric terjawab: OQ-06, OQ-09) | BR-CAT-*, BR-UOM-*, BR-PRC-* |
| KEP-07 | Uang = integer; kuantitas decimal berskala tetap; pecahan di titik terdefinisi & disimpan; LR; package bersama; alternatif integer berskala ditolak | `DISEPAKATI` (half-up/per bill `DIUSULKAN`) | BR-MNY-* |
| KEP-08 | Ledger append-only + saldo; stok minus diizinkan; moving average per outlet di server; penjualan telat = biaya saat server memproses; transfer in-transit; resep 1 level + modifier; konsumsi saat bayar; retur (usulan) | `DISEPAKATI` (retur `PERLU KONFIRMASI`) | BR-STK-*, BR-HPP-*, BR-TRF-*, BR-RCP-* |
| KEP-09 | PPN/PB1/SC/pembulatan tunai; tarif tak di-hardcode + snapshot; inklusif/eksklusif per outlet; urutan baku; flag SC kena pajak per outlet; e-Faktur di luar scope | `DISEPAKATI` (aturan akhir `PERLU KONFIRMASI`) | BR-TAX-* |
| KEP-10 | Diskon manual per item/bill, persen/nominal, batas per role, PIN supervisor; promo/voucher/loyalty ditunda | `DISEPAKATI` | BR-DSC-* |
| KEP-11 | Retail: varian, barcode, multi-UOM, harga per outlet; serial/batch/kedaluwarsa ditunda | `DISEPAKATI` | BR-CAT-*, BR-UOM-* |
| KEP-12 | F&B: meja, open bill lease satu device, tanpa take-over/tutup paksa (risiko diterima), split/merge, modifier, SC; KDS ditunda | `DISEPAKATI` (detail merge `PERLU KONFIRMASI`) | BR-FNB-*, BR-SPL-* |
| KEP-13 | Pembayaran tunai + manual; printer thermal + cash drawer; adapter per jalur; cetak asinkron; ESC/POS teks; kustomisasi struk; data pelanggan opsional | `DISEPAKATI` | BR-PAY-*, BR-PRN-*, BR-CUS-* |
| KEP-14 | Laporan MVP: penjualan, stok & nilai persediaan, rekap shift (server, online); laba kotor ditunda | `DISEPAKATI` | Bab 12 |
| KEP-15 | Uji sync otomatis + audit log immutable di MVP; monitoring & backup di luar MVP (risiko); retensi server belum diputuskan | `DISEPAKATI` | FR-QA-*, BR-AUD-* |
| KEP-16 | Fase: Fondasi → Master data → POS retail → Stok & HPP → F&B | `DISEPAKATI` (usulan awal) | Bab 13 |
| KEP-17 | **Multi-bahasa UI masuk MVP** (revisi 0.91; sebelumnya diasumsikan di luar scope): UI berganti bahasa, bahasa struk per outlet, format locale | `DISEPAKATI` (bahasa, library, struk per kustomisasi: OQ-23 terjawab) | BR-I18N-*, FR-I18N-*, NFR-I18N-* |
| KEP-27 | **Identitas global + keanggotaan per tenant** (rev. 1.06/1.07, keputusan user 2026-11-19; plugin organization Better Auth): satu email = satu akun global (unik se-sistem), satu password, keanggotaan berperan per tenant; login hanya email, di-scope slug dengan pemeriksaan keanggotaan dan pesan generik; **cookie sesi per slug, login terpisah per tenant**; staf non-email PIN-only; tanpa email di MVP: **kode undangan (72 jam) dan kode reset (24 jam) sekali pakai terikat email, tanpa password sementara, penerbit tidak melihat/menetapkan password**; reset lintas tenant dibatasi (penolakan generik "hubungi operator platform"); ganti email hanya pemilik akun/operator; email tidak disalin ke data tenant; anggota keluar menyimpan penunjuk identitas; 2FA Owner di luar MVP; **kunci rate limit login = email lintas slug**; OQ-34 tanpa mitigasi; **rev. 1.08 (OQ-S39): kode 10 karakter berkelompok, penukaran satu langkah, retensi baris 7 hari, undangan aktif dihitung sebagai keanggotaan untuk reset, operator mereset lewat konteks salah satu tenant anggota, risiko pra-klaim email diterima dengan mitigasi (BR-IDN-013, RSK-19)**; **rev. 1.09 (DOQ-26): halaman publik terpisah `/<slug>/join` dan `/<slug>/reset`; daftar "Undangan tertunda" dengan Batalkan dan Terbitkan ulang, kelola per tenant, diaudit (BR-IDN-014/015)** | `DISEPAKATI` (OQ-35/36/37 terjawab; OQ-S39; DOQ-26) | BR-IDN-001..012, FR-IDN-001..010, NFR-SEC-011 |
| KEP-26 | **Rate limit dan anti-brute-force** (rev. 1.05, keputusan user 2026-11-18/19; ARCHITECTURE §6.9/AD-40): dua lapisan (Nginx + aplikasi); API device per `device_id`, bukan IP; login admin per email lintas slug (rev. 1.07; jeda progresif, tanpa penguncian permanen, pesan menit generik) dengan IP hanya jaring pengaman longgar; PIN di device (monotonik, jam tak dapat dimundurkan); banjir sync `429` + `Retry-After` tanpa menaikkan percobaan; full resync maks 1/jam/device, SSE satu koneksi/device; laporan berat per tenant; pairing per IP dan slug; tanpa kuota per tenant; `/platform` tanpa pembatasan IP; pelanggaran hanya di log | `DISEPAKATI` (angka awal konservatif; mitigasi penundaan login `PERLU KONFIRMASI`, OQ-34) | BR-RLM-001..014, FR-RLM-001..010, NFR-SEC-005 |
| KEP-25 | **Manajemen error** (rev. 1.02, keputusan user 2026-11-18): tiga tingkat error; katalog **22 kode error** stabil (6 umum + domain; ARCHITECTURE §9.7.1) dengan satu butir tindakan kasir per bahasa; pelaporan manual `KODE#id` (tanpa tombol lapor); ID lokal `D-…` untuk error device yang ikut sync; error boundary per area + draf tersimpan; pemulihan gagal start (Reset aplikasi tanpa menyentuh Dexie); gagal cetak non-blocking; retry aksi online-only dengan kunci idempoten; source map privat; notifikasi Telegram (fatal, health check, lonjakan); tanpa diagnostik tenant | `DISEPAKATI` (daftar 22 kode, ambang, dan retensi source map terjawab: OQ-32) | BR-ERR-001..015, BR-LOG-006/008/010/012/013, FR-ERR-001..012, NFR-OBS-004/005, NFR-I18N-005 |
| KEP-24 | **Identifikasi tenant lewat URL sub-path** (rev. 1.01, keputusan user 2026-11-18): `<DOMAIN>/<slug>/pos` dan `/admin`, root 404; tenant selalu dari sesi/token (slug ≠ tenant ditolak); login di-scope slug, email unik se-sistem (identitas global, rev. 1.06); slug permanen (3–30, `a–z 0–9 -`, kata terlarang); `/<slug>` polos = pemilih "Terminal Kasir"/"Back-office"; normalisasi 308 ke huruf kecil kanonis; ~~email boleh sama di tenant berbeda (dua akun terpisah)~~ **digantikan rev. 1.06: identitas global, email unik se-sistem (KEP-27)**; **tanpa warna/tema tenant**; slug tak dikenal 404, tenant ditangguhkan = "tidak tersedia"; penyimpanan lokal dan sesi terpisah per tenant; PWA per tenant, QR pairing memuat alamat; admin platform `/platform` (buat/tangguhkan tenant, versi minimum); domain kustom ditunda (OQ-30); nama tampilan maks 40 karakter diatur operator platform (OQ-33); kata terlarang slug = konstanta di kode + uji rute, slug permanen juga dijaga trigger database | `DISEPAKATI` (OQ-30/31/33 terjawab) | BR-TEN-001..012, FR-TEN-001..012, NFR-SEC-009/010 |
| KEP-23 | **Versioning, rilis, kompatibilitas klien** (rev. 1.00, keputusan user 2026-11-18): versi aplikasi SemVer + versi kontrak monoton; server mendukung N/N−1 dengan jendela minimal 30 hari dan versi minimum (OQ-29 terjawab); klien usang: banner lalu pembaruan keras hanya di momen aman; server rollback: klien menahan perintah, terus menjual, kirim otomatis; versi tampil di footer login dan pengaturan perangkat (tanpa banner perbedaan versi, tanpa di struk); jejak versi di penjualan/nota kredit/perintah/event; feature flag per tenant (Owner, POS baca-saja); catatan rilis perubahan angka, staging/production terpisah, hotfix PATCH jalur cepat; migrasi aditif + dump penuh sebelum migrasi data lama | `DISEPAKATI` (jendela 30 hari dan pembaruan keras hanya saat shift tertutup: OQ-29 terjawab) | BR-VER-001..012, FR-VER-001..008, NFR-REL-004/005, NFR-MNT-003 |
| KEP-22 | **Serah-terima bill, register PELAYAN, PREBILL_PRINTED, kunci layar** (rev. 0.96, keputusan user via sesi DESIGN.md, DOQ-09/14/18): waiter mencatat di HP dan bayar di kasir lewat serah-terima **sukarela** (bukan take-over; lease pindah setelah kasir menerima; hanya online; tujuan dipilih; pengirim dapat membatalkan); register `PELAYAN` dikecualikan dari syarat shift untuk open bill; event `PREBILL_PRINTED`; kunci layar otomatis 10 menit (pembuka: staf yang sama, override supervisor+ hanya untuk tutup shift; audit hanya override dan PIN salah berulang) | `DISEPAKATI` | BR-FNB-010..013, BR-SHF-010, BR-AUT-015, FR-FNB-013..015, FR-DEV-006, FR-SHF-007, FR-AUT-009/010 |
| KEP-21 | **Manajemen log** (rev. 0.95), mengacu pola `financeDashboard`: log operasional JSON per baris (stdout + file harian di volume), retensi 30 hari, ID referensi + kode error `KODE#id`, field tertutup, redaksi data sensitif, antrean log device ikut sync, pencarian lewat skrip CLI di server; dipisah dari audit log | `DISEPAKATI` (waktu UTC, daftar field/kode `DIUSULKAN`) | BR-LOG-001..014, FR-LOG-001..008, NFR-OBS-001..003 |
| KEP-20 | **Arsitektur modular monolith** (rev. 0.94): satu deployable + satu PostgreSQL; ±9 modul kasar (Identitas & Tenancy, Katalog, Penjualan, Shift & Kas, Inventori, F&B, Sync, Audit, Laporan) + kernel bersama; resep di Katalog (konsumsi di Inventori); batas ditegakkan lint dependensi di CI; transaksi lintas modul tetap satu transaksi DB | `DISEPAKATI` | BR-ARC-001..012, AP-12, NFR-MNT-002 |
| KEP-18 | **Ketersediaan item per outlet** (rev. 0.92): flag eksplisit per outlet (penugasan item–outlet) terpisah dari harga; ketiadaan harga ≠ tidak dijual; granularitas produk induk + override per SKU, UOM mengikuti SKU; default item baru tersedia di semua outlet (opt-out); nonaktif di outlet = tersembunyi (katalog, pencarian, barcode), stok/ledger/HPP utuh, GR & transfer tetap boleh, penjualan offline sebelum sync diterima sebagai fakta dan ditandai; dibuat online, tersinkron lewat counter versi | `DISEPAKATI` (OQ-24..27 seluruhnya terjawab) | BR-CAT-009..022, FR-CAT-008..013, FR-SYN-017, FR-POS-012..014, FR-INV-011, FR-FNB-012 |
| KEP-19 | **Item open price** (rev. 0.93): kolom penanda `is_open_price` pada produk; harga diketik kasir saat transaksi; baris penjualan menyimpan snapshot harga dan penanda; tanpa harga master pun dapat dijual | `DISEPAKATI` (OQ-18 dan OQ-28 terjawab) | BR-PRC-007, FR-CAT-014, FR-POS-016 |

### Lampiran B — Tabel Traceability

| Kapabilitas | Keputusan | Business Rule | Requirement | Fase | Verifikasi |
|---|---|---|---|---|---|
| Isolasi tenant | KEP-03 | BR-TNT-001 | FR-TNT-004 | F1 | Uji RLS |
| Hierarki PKP/pajak daerah | KEP-03 | BR-TNT-002/003 | FR-TNT-002/003 | F1 | Uji aturan |
| Sinkron master tanpa celah | KEP-01 | BR-SYN-010/011 | FR-SYN-001/002/003 | F1–F2 | Uji konkurensi |
| Push idempoten & atomik | KEP-01 | BR-SYN-020/030 | FR-SYN-004/007 | F3 | Test properti |
| Skema N/N−1 | KEP-01 | BR-SYN-022 | FR-SYN-006 | F3 | Uji migrasi |
| Waktu & hari bisnis | KEP-01 | BR-TIM-* | FR-SYN-011, FR-TNT-003 | F1/F3 | Vektor waktu (5.7) |
| Penyimpanan lokal & pending | KEP-01 | BR-SYN-050..054 | FR-DEV-005, FR-SYN-010/012 | F1/F3 | Uji manual + Playwright |
| Invoice tanpa celah | KEP-04 | BR-INV-002/004 | FR-POS-007 | F3 | Uji crash/atomik |
| Gap & pemulihan | KEP-04 | BR-INV-006..009 | FR-DEV-003, FR-ADM-002 | F3 | Contoh BR-INV-008 |
| Shift & blind count | KEP-04 | BR-SHF-* | FR-SHF-* | F3 | Contoh −2.100 |
| Retur/nota kredit | KEP-04 | BR-RTR-* | FR-RTR-* | F3/F4 | Contoh 17.882 |
| PIN & lease | KEP-05 | BR-AUT-* | FR-AUT-003..008 | F3 | Uji kunci/lease |
| Varian & UOM | KEP-06 | BR-CAT-*, BR-UOM-* | FR-CAT-002/003 | F2 | Contoh 6 SKU, 0,5 dus |
| Harga per outlet & stale | KEP-06 | BR-PRC-* | FR-PRC-* | F2/F3 | Contoh −1.000 |
| Uang & pembulatan | KEP-07 | BR-MNY-* | FR-QA-003 | F3 | Vektor hitung |
| Pajak & biaya | KEP-09 | BR-TAX-* | FR-POS-006, FR-FNB-006 | F3/F5 | Contoh 1–5 |
| Diskon & override | KEP-10 | BR-DSC-* | FR-POS-005, FR-AUT-005 | F3 | Contoh 7.000 |
| Pembayaran | KEP-13 | BR-PAY-* | FR-PAY-* | F3 | Contoh kembalian |
| Cetak | KEP-13 | BR-PRN-* | FR-PRN-* | F3 | Uji per adapter |
| Stok & ledger | KEP-08 | BR-STK-* | FR-INV-002/009/010 | F4 | Uji paralel |
| HPP moving average | KEP-08 | BR-HPP-* | FR-INV-003..005 | F4 | Tabel BR-HPP-003 |
| Transfer | KEP-08 | BR-TRF-* | FR-INV-006 | F4 | Contoh 328.333 |
| Resep/BOM | KEP-08 | BR-RCP-* | FR-FNB-009 | F5 | Contoh 8.720 |
| Open bill & lease | KEP-12 | BR-FNB-* | FR-FNB-001..004 | F5 | Skenario RSK-04 |
| Split/merge | KEP-12 | BR-SPL-* | FR-FNB-007/008 | F5 | Contoh 83.186/55.991 |
| Laporan | KEP-14 | BR-RPT-001 | FR-RPT-* | F3–F5 | Contoh R-01..R-03 |
| Audit immutable | KEP-15 | BR-AUD-* | FR-AUD-* | F1/F3 | Uji hak akses |
| Uji sync | KEP-15 | — | FR-QA-001..003 | F1–F3 | CI |
| Multi-bahasa UI & lokalisasi | KEP-17 | BR-I18N-001..011 | FR-I18N-001..008 | F1/F3 | CI kunci terjemahan; vektor V-26 |
| Ketersediaan item per outlet | KEP-18 | BR-CAT-009..022 | FR-CAT-008..013, FR-SYN-017, FR-POS-012..014, FR-INV-011, FR-FNB-012 | F2/F3/F4/F5 | Contoh BR-CAT (Kopi A/B/C, Kaos 6/3/6, Contoh 3); vektor V-27 |
| Identitas global + keanggotaan | KEP-27 | BR-IDN-001..015, BR-AUT-001, BR-TEN-001/002/003 | FR-IDN-001..014, NFR-SEC-011 | F1 | Contoh `ani@`/`citra@`/`budi@`/`rina@`; EC-111..137; V-43..48 |
| Rate limit & anti-brute-force | KEP-26 | BR-RLM-001..014, BR-AUT-005 | FR-RLM-001..010, NFR-SEC-005 | F1/F3 | Contoh `dewi` 8 gagal → 15 menit; 12 push serentak; pairing 8×10⁻¹¹; EC-100..110 |
| Manajemen error | KEP-25 | BR-ERR-001..015 | FR-ERR-001..012, NFR-OBS-004/005, NFR-I18N-005 | F1/F2/F3 | Contoh `PRINT_FAILED#D-…`, `INTERNAL_ERROR#…`; EC-083..092 |
| Identifikasi tenant lewat URL | KEP-24 | BR-TEN-001..012 | FR-TEN-001..012, NFR-SEC-009/010 | F1/F3 | Contoh `acme`/`beta`; uji penolakan slug ≠ tenant; EC-073..082 |
| Versioning, rilis, kompatibilitas klien | KEP-23 | BR-VER-001..012 | FR-VER-001..008, NFR-REL-004/005, NFR-MNT-003 | F1/F2/F3 | Skenario TAB-01/TAB-02, rollback; EC-064..072 |
| Serah-terima bill & register PELAYAN | KEP-22 | BR-FNB-010..013, BR-SHF-010 | FR-FNB-013..015, FR-DEV-006, FR-SHF-007 | F1/F5 | Contoh M05-0003; EC-058..061 |
| Kunci layar otomatis | KEP-22 | BR-AUT-015 | FR-AUT-009/010 | F3 | Contoh Dewi/Budi; EC-062/063 |
| Manajemen log | KEP-21 | BR-LOG-001..014 | FR-LOG-001..008 | F1/F3 | Uji redaksi; uji korelasi ID; uji kegagalan file |
| Arsitektur modular monolith | KEP-20 | BR-ARC-001..012 | NFR-MNT-002 | F1–F5 | Lint dependensi di CI; uji atomik FinalizeSale |
| Item open price | KEP-19 | BR-PRC-007 | FR-CAT-014, FR-POS-016 | F2/F3 | Contoh BR-PRC-007; vektor V-30 |

### Lampiran C — Parameter Konfigurasi & Nilai Default Usulan

| Parameter | Default | Cakupan | Status |
|---|---|---|---|
| Batas lease offline | 7 hari | Global | `DISEPAKATI` |
| Peringatan sebelum lease habis | 24 jam | Global | `DIUSULKAN` |
| Retensi transaksi tersinkron di device | 3 bulan kalender | Global | `DISEPAKATI` |
| Retensi tombstone di server (batas full resync) | 30 hari | Global | `DISEPAKATI` (contoh angka) |
| Interval sync berkala | 60 detik (online) | Global | `DIUSULKAN` |
| Backoff retry | 5 dtk → 15 dtk → 1 mnt → 5 mnt | Global | `DIUSULKAN` |
| Peringatan offset jam | > 10 menit | Global | `DIUSULKAN` |
| Pengingat update PWA | Banner di semua halaman + dialog tiap 2 jam | Global | `DISEPAKATI` (BR-SYN-003) |
| Toleransi versi sebelumnya (N−1) | Minimal 30 hari sejak penggantinya dirilis (menggantikan 14 hari) | Global | `DISEPAKATI` (OQ-29, BR-VER-002) |
| Deteksi jam mundur | > 5 menit | Global | `DIUSULKAN` |
| Panjang PIN | 4–6 digit | Global | `DISEPAKATI` |
| Kunci PIN | 5× → 5 mnt; 5× → 15 mnt; 15× → reset manager | Global | `DIUSULKAN` |
| Kode pairing | 8 karakter, 15 menit, sekali pakai | Global | `DIUSULKAN` |
| Umur credential device | 180 hari bergulir | Global | `DIUSULKAN` |
| Skala kuantitas / faktor | 4 | Global | `DISEPAKATI` (OQ-09) |
| Unit pembulatan tunai | Rp100 | Outlet | `DISEPAKATI` (OQ-13 terjawab) |
| Zona waktu | `Asia/Jakarta` | Outlet | `DISEPAKATI` (3 pilihan) |
| Jam potong hari bisnis | 00:00 | Outlet | `DISEPAKATI` |
| Mode harga | `EXCLUSIVE`/`INCLUSIVE` | Outlet | `DISEPAKATI` |
| Service charge kena pajak | Ya | Outlet | `DISEPAKATI` (OQ-01a; konfirmasi akuntan disarankan) |
| Batas varian | 3 atribut / 100 SKU | Per produk | `DIUSULKAN` |
| Batas diskon role | Kasir 5%, Supervisor 20%, Manager 50%, Owner 100% | Per role | `DISEPAKATI` (OQ-05) |
| Peringatan kuota storage | 70% | Device | `DIUSULKAN` |
| Lebar kertas struk | 58/80 mm | Register | `DIUSULKAN` |
| Interval deteksi scanner keyboard | < 50 ms antar karakter | Device | `DIUSULKAN` |
| Bahasa UI aktif | `id-ID` (default), `en-US` | Global | `DISEPAKATI` (OQ-23) |
| Bahasa bawaan | tenant → register → preferensi pengguna | Tenant/Register/User | `DIUSULKAN` |
| Bahasa struk | `id-ID` | Outlet | `DIUSULKAN` |
| Format nomor invoice | `{PREFIKS}-{MMYY}-{URUT6}`; urut reset tiap bulan | Register | `DISEPAKATI` (OQ-04, rev. 2026-11-18) |
| Prefiks nomor invoice | wajib (register `KASIR`), unik per tenant; saran awal `{KODE_OUTLET}-{KODE_REGISTER}`; 2–16 karakter, huruf besar/angka/tanda hubung dalam | Register | `DISEPAKATI` (bentuk `DIUSULKAN`) |
| Cetak kode register pada nomor | **dihapus** (prefiks register menggantikannya) | — | rev. 0.98 |
| Penanda nota kredit | `NK` | Global | `DIUSULKAN` |
| Level log default | `info` | Global | `DISEPAKATI` (ikuti referensi) |
| Retensi file log | 30 hari (1–3650 dapat diatur) | Global | `DISEPAKATI` |
| Interval pembersihan log | 6 jam | Global | `DIUSULKAN` |
| Kunci layar otomatis (idle-lock) | 10 menit tanpa aktivitas; kunci manual tersedia | Global | `DISEPAKATI` (BR-AUT-015) |
| Jenis register | `KASIR` (default) / `PELAYAN` | Register | `DISEPAKATI` (BR-FNB-011) |
| Login admin: jadwal jeda progresif | 3 gagal tanpa jeda; ke-4 30 dtk; 1 mnt; 2 mnt; 5 mnt; ke-8+ 15 mnt (maks); reset setelah login sukses/15 mnt tanpa gagal | Per email (lintas slug) | `DIUSULKAN` (BR-RLM-003; dikonfigurasi lewat lingkungan) |
| Kode reset password | 10 karakter alfabet 32 (≈ 1,1×10¹⁵), berkelompok, sekali pakai, terikat email, kedaluwarsa 24 jam, baris dibersihkan 7 hari setelah kedaluwarsa/terpakai | Global | `DISEPAKATI` (OQ-36/S39, BR-IDN-005) |
| Kode undangan | 10 karakter alfabet 32 (≈ 1,1×10¹⁵), berkelompok, sekali pakai, terikat email, kedaluwarsa 72 jam, baris dibersihkan 7 hari setelah kedaluwarsa/terpakai | Tenant | `DISEPAKATI` (OQ-36/S39, BR-IDN-004) |
| Kebijakan password minimum | ≥ 10 karakter | Global | `DIUSULKAN` (BR-IDN-008) |
| Login admin: jaring pengaman per IP + slug | ±30 kegagalan / 15 menit → jeda 15 menit | Per IP + slug | `DIUSULKAN` (BR-RLM-003) |
| Pairing | 10 / 5 menit per IP dan ±30 / 5 menit per slug | Per IP, per slug | `DIUSULKAN` (BR-RLM-009) |
| API device | push ±60/mnt; pull ±30/mnt; ping ±30/mnt; serah-terima ±30/mnt; log device ≤ 20/10 mnt | Per `device_id` | `DIUSULKAN` (BR-RLM-004) |
| Push bersamaan di server | ±8; `Retry-After` berjitter ±2–10 dtk | Global | `DIUSULKAN` (BR-RLM-005) |
| Full resync dan SSE | Maks 1 resync/jam/device; 1 koneksi SSE aktif/device | Per device | `DISEPAKATI` (BR-RLM-006) |
| Laporan berat `/admin` | ±2 bersamaan per tenant + batas waktu kueri | Per tenant | `DIUSULKAN` (BR-RLM-007) |
| Kuota per tenant | Tidak ada di MVP | Tenant | `DISEPAKATI` (BR-RLM-011) |
| Retry baca otomatis | Maks 3 kali dengan backoff | Klien | `DIUSULKAN` (BR-ERR-010) |
| Notifikasi: batas frekuensi | 1 pesan per jenis per 10 menit (maks. 20/jam) | Global | `DISEPAKATI` (OQ-32) |
| Notifikasi: ambang lonjakan error | ≥ 10 `INTERNAL_ERROR` dalam 5 menit | Global | `DISEPAKATI` (OQ-32) |
| Retensi source map | Selama versi masih dilaporkan perangkat + 90 hari | Server | `DISEPAKATI` (OQ-32, BR-ERR-011) |
| Format ID lokal error device | `D-YYYYMMDD-HHmmss-xxxxx` (UTC terkoreksi offset) | Device | `DIUSULKAN` (BR-ERR-006) |
| Format slug tenant | 3–30 karakter, `a–z 0–9 -`, tanpa tanda hubung di tepi, unik tanpa beda huruf | Tenant | `DISEPAKATI` (BR-TEN-004) |
| Kata terlarang slug | `platform`, `admin`, `pos`, `api`, `health`, `assets`, `login`, `static`, `www`, + tambahan; **konstanta di kode** + uji rute | Global | `DISEPAKATI` (penegakan; BR-TEN-004) |
| Nama tampilan tenant | Maksimum 40 karakter; diatur operator platform | Tenant | `DISEPAKATI` (OQ-33, BR-TEN-007) |
| Jendela dukungan kontrak lama (N−1) | Minimal 30 hari sejak rilis kontrak baru | Global | `DISEPAKATI` (OQ-29) |
| Pembaruan keras | Hanya momen aman keras (tanpa shift terbuka, outbox kosong/terkunci aman) | Global | `DISEPAKATI` (BR-VER-004) |
| Antrean log device | ≤ 500 entri; ≤ 100 entri per sync; ≤ 20 laporan / 10 menit / device | Device | `DIUSULKAN` |

### Lampiran D — Vektor Uji Kanonik (acuan CI client & server)

| ID | Masukan | Keluaran yang wajib |
|---|---|---|
| V-01 | R(0,333 × 12.500); R(1,5 × 9.999); R(5.872,5) | 4.163; 14.999; 5.873 |
| V-02 | LR 100.000 ÷ 3 | 33.334 / 33.333 / 33.333 |
| V-03 | LR 10.000 berbobot 70.000/16.000/44.500 | 5.364 / 1.226 / 3.410 |
| V-04 | Retail eksklusif PPN 11% (Contoh 1) | Pajak 11.146; G 112.476; tunai 112.500 (+24); kembalian 37.500 |
| V-05 | Retail inklusif (Contoh 2) | Pajak 10.042; DPP 91.288; G 101.330; tunai 101.300 (−30) |
| V-06 | F&B eksklusif SC 5% kena pajak (3a) | SC 5.873; PB1 12.332; G 135.655; tunai 135.700 (+45) |
| V-07 | F&B SC tidak kena pajak (3b) | PB1 11.745; G 135.068; tunai 135.100 (+32) |
| V-08 | F&B inklusif (Contoh 4) | PB1 11.211; G 123.323; tunai 123.300 (−23) |
| V-09 | Alokasi pajak ke baris (Contoh 5) | 4.070 / 1.760 / 5.316 |
| V-10 | Diskon: 7.000 pada 130.500 (Kasir 5%); kumulatif 3.500+3.810 | 5,364% → PIN; 5,60% → PIN |
| V-11 | Pembayaran campuran 135.655 (QRIS 100.000 + tunai 50.000) | Tunai terapan 35.700 (+45); kembalian 14.300 |
| V-12 | HPP moving average (tabel BR-HPP-003) | 240.000; 57.458; 927.542 (habis); saldo akhir 0/0 |
| V-13 | HPP telat (BR-HPP-004) | 82.083 (bukan 80.000); saldo 110 / 902.917 |
| V-14 | Stok minus (BR-HPP-005) | HPP 40.000; saldo −2 / −16.000; setelah GR 18 / 164.000 |
| V-15 | Transfer (BR-TRF) | Kirim 328.333; A 80/656.667; terima 38 → 311.916; B 48/401.916; selisih 16.417 |
| V-16 | Opname (BR-STK-032) | −3 → 24.625 (77/632.042); +5 → 41.042 (85/697.709) |
| V-17 | Resep Nasi Goreng (BR-RCP) | 2 porsi 8.720; 1 porsi + Extra Telur − Kecap 6.180 |
| V-18 | Retur 1 dari 3 Susu (invoice 000123) | 16.110 + 1.772 = 17.882 → tunai 17.900 (+18); 3 unit@10.000 → 3.333/3.333/3.334 |
| V-19 | Split per item (BR-SPL contoh 1) | A 83.186; B 55.991 (Σ 139.177 vs induk 139.178) |
| V-20 | Split bagi rata 3 (BR-SPL contoh 2) | Total 45.219/45.218/45.218; SC 1.958/1.958/1.957; PB1 4.111/4.110/4.111 |
| V-21 | Kas shift (BR-SHF-005) | Diharapkan 1.782.100; selisih −2.100 |
| V-22 | Hari bisnis jam potong 04:00 WIB (5.7) | 02:30 → 17 Nov; 04:00 → 18 Nov |
| V-23 | Retur jendela 3 bulan | Invoice 2026-08-31 → batas 2026-11-30 |
| V-24 | Konversi UOM | 0,5 dus ×12 = 6 pcs; 0,35 dus → ditolak (pcs bulat) |
| V-25 | Pelaporan R-01 (Bab 12) | Gross 176.700; pajak 18.626; total 188.000; neto 170.100 |
| V-26 | Format & urai locale (BR-I18N-006) | 112476 → "Rp112.476" (id) / "Rp112,476" (en); input "1.500" → 1500 (id) / 1,5 (en); kanonik tersimpan identik |
| V-27 | Ketersediaan efektif (BR-CAT-010/011/016) — Kaos 6 SKU; override Merah di B; lalu tambah XL | SKU tampil A/B/C = **6/3/6**; setelah XL: **8/5/8**; produk `UNAVAILABLE` di C + override `L-HTM` `AVAILABLE` → C = **1** SKU; produk global nonaktif → **0** di semua outlet |
| V-28 | Penandaan penjualan item tidak tersedia (BR-CAT-013) | Perubahan versi 131 @13:00; penjualan `catalog_cursor` 128 @14:00 → flag `item_tidak_tersedia`; penjualan @12:30 → tanpa flag; HPP 40.000 + 40.000 = 80.000, saldo −1 / −40.000 |
| V-29 | Format nomor (BR-INV-003/010): register dengan prefiks `OUT01-POS02`, jam potong 04:00 | Invoice 2026-11-17 14:05 → `OUT01-POS02-1126-000123`; 2026-12-01 01:00 → seri `1126`; 2026-12-01 04:05 → `OUT01-POS02-1226-000001`; nota kredit → `OUT01-POS02-NK-1126-000001`; prefiks `KSR2` → `KSR2-1126-000123`; prefiks yang sudah dipakai register lain ditolak |
| V-31 | Jendela dukungan kontrak (BR-VER-002): kontrak 8 dirilis 1 Des; jendela 30 hari | Kontrak 7 diterima sampai paling cepat **31 Des**; versi minimum boleh naik ke 8 sesudahnya |
| V-32 | Tampil versi & jejak (BR-VER-007/008) | Footer "Solva POS v1.6.0 · kontrak 8" (kontrak di pengaturan perangkat); invoice dari app v1.4.2 menyimpan `app_version=1.4.2`, `contract_version=7`; struk tanpa versi |
| V-33 | Validasi slug (BR-TEN-004) | `acme`, `toko-maju-7`, `beta` diterima; `ab`, `-acme`, `acme-`, `Acme_1`, `admin`, `pos`, `platform`, slug 31 karakter ditolak; `ACME` ditolak bila `acme` ada |
| V-34 | Isolasi slug (BR-TEN-002/006) | Akun hanya-anggota-`acme` → `/beta/admin` ditolak tanpa data; TAB-09: 3 pending `acme` tidak terlihat/terekspor di `beta` |
| V-35 | Tenant ditangguhkan (BR-TEN-005) | `beta` ditangguhkan 1 Des 09:00; sync terakhir 30 Nov 20:00 → device offline bekerja sampai **7 Des 20:00**; online 1 Des 14:00 → `TENANT_SUSPENDED`; 12 pending tersimpan, terkirim setelah aktif lagi |
| V-38 | URL dan akun (BR-TEN-003/009/012) | `/ACME/pos` dan `/acme/pos/` → 308 `/acme/pos`; `/acme` → pemilih "Acme Coffee"; `/xyz` dan `/` → 404; `ani@example.id` = satu akun global dengan dua keanggotaan (`acme`, `beta`) |
| V-43 | Akun global dan sesi per slug (BR-IDN-001/002) | `ani@example.id` satu akun, dua keanggotaan (Kasir `acme`, Owner `beta`); login terpisah per slug (cookie `Path=/<slug>`); logout `/beta` tidak mengakhiri `/acme`; `citra@example.id` di `/beta/admin` → pesan sama dengan password salah; email tak terdaftar → pesan sama |
| V-44 | Reset password lintas tenant (BR-IDN-005) | Budi (Owner `acme`) kode reset untuk `citra@` (satu tenant) → boleh (24 jam); untuk `ani@` (multi-tenant) → ditolak dengan pesan "hubungi operator platform"; tanpa password sementara |
| V-45 | Kode undangan/reset (BR-IDN-004/005) | 10 karakter/32 alfabet = 32¹⁰ ≈ 1,1×10¹⁵; 72 jam, ≤ 30 percobaan/5 menit/slug → 25.920 tebakan maks; peluang ≈ 2,3×10⁻¹¹ (reset 24 jam: 8.640 → ≈ 7,7×10⁻¹²); tampil `K7Q2M-9XD4R`, penukaran tak peka huruf/tanda hubung; formulir dan respons identik untuk akun ada/tidak; penerbit tidak melihat password; baris dibersihkan 7 hari setelah kedaluwarsa/terpakai |
| V-46 | Rate limit login lintas slug (BR-RLM-003) | 8 gagal `dewi@example.id` di `acme` → jeda 15 menit di `acme` dan `beta`; email tak terdaftar → pesan sama |
| V-47 | Pra-klaim email dan undangan aktif lintas tenant (BR-IDN-013/005) | Budi menukar sendiri kode `rina@` → akun hanya di `acme`; `beta` mengundang `rina@` → Rina (tanpa password akun) gagal generik; Budi ditolak mereset `rina@` (undangan aktif → multi-tenant); operator mereset via konteks `acme`; audit mencatat semua langkah |
| V-48 | Halaman penerima kode dan undangan tertunda (BR-IDN-014/015) | Senin 2026-11-16 09:00 undangan `ani@` (kedaluwarsa Kamis 09:00) → Kamis 10:00 Terbitkan ulang → berlaku sampai Minggu 2026-11-22 10:00, kode lama → pesan generik; `ani@exmple.id` dibatalkan → kode tidak berlaku; kode undangan di `/acme/reset` dan kode `acme` di `/beta/join` → pesan generik; `/join` sukses → sesi `Path=/acme`; `/reset` sukses → semua sesi berakhir tanpa login otomatis; Owner `beta` tidak melihat undangan `acme` |
| V-49 | Pembulatan tunai tidak menghasilkan Rp0 (BR-TAX-009 butir 5) | Sisa 200 unit 500 → tunai terapan 200, rounding 0 (tunai 500 → kembalian 300); sisa 250 unit 500 → 500 (+250); sisa 40 unit 100 setelah QRIS 10.000 → tunai terapan 40, rounding 0 |
| V-40 | Jadwal jeda login (BR-RLM-003) | Gagal ke-1..3 → 0; ke-4 → 30 dtk; ke-5 → 1 mnt; ke-6 → 2 mnt; ke-7 → 5 mnt; ke-8+ → 15 mnt; akun tidak ada = pesan sama |
| V-41 | Pairing terdistribusi (BR-RLM-009) | ≤ 30/5 menit per slug → ≤ ±90 tebakan/15 menit; peluang ≈ 90 / 32⁸ ≈ 8×10⁻¹¹ |
| V-42 | Banjir push (BR-RLM-005) | 12 push serentak, batas 8 → 4 menerima `429` + `Retry-After` 2–10 dtk; semua sukses ±10 dtk; `attempts` tetap 0 |
| V-39 | Nama tenant dan penegakan slug (BR-TEN-004/007/008) | Nama 40 karakter diterima, 41 ditolak; Owner tidak dapat mengubah nama; `UPDATE` slug langsung ditolak trigger; `admin`/`pos`/`platform`/`health` ditolak sebagai slug |
| V-36 | Tiga tingkat error dan ID (BR-ERR-001/006) | Diskon 5,36% > 5% → pesan tanpa kode; push timeout → retry 5 dtk/15 dtk/1 mnt tanpa dialog; galat tak terduga → `INTERNAL_ERROR#20261118-103015-k7q2m`; printer gagal offline → `PRINT_FAILED#D-20261118-140322-m4k9q` |
| V-37 | Idempotensi retry (BR-ERR-010) | Simpan harga Kopi 19.000, timeout, Coba lagi → versi master 205 → 206 sekali (bukan 207) |
| V-30 | Item open price (BR-PRC-007): Kopi 2 × 18.500 + open price Rp12.500 × 1; PPN 11% eksklusif; tunai 60.000 | Gross 49.500; PPN 5.445; total 54.945; tunai terbulat 54.900 (−45); kembalian 5.100; baris open price bertanda `is_open_price` |

### Lampiran E — Indeks Prefiks ID

| Prefiks | Bagian |
|---|---|
| BR-SYN, BR-TIM | 5.3–5.8 |
| BR-TNT | 6.1 |
| BR-MNY | 7.1 |
| BR-CAT, BR-UOM, BR-PRC | 7.2 |
| BR-DSC | 7.3 |
| BR-TAX | 7.4 |
| BR-PAY | 7.5 |
| BR-INV | 7.6 |
| BR-SHF | 7.7 |
| BR-RTR | 7.8 |
| BR-AUT | 7.9 |
| BR-STK | 7.10 dan 7.13 |
| BR-HPP | 7.11 |
| BR-TRF | 7.12 |
| BR-RCP | 7.14 |
| BR-FNB | 7.15 |
| BR-SPL | 7.16 |
| BR-PRN | 7.17 |
| BR-AUD | 7.18 |
| BR-CUS | 7.19 |
| BR-I18N | 7.20 |
| BR-ARC | 5.10 |
| BR-LOG | 5.11 |
| BR-VER | 5.12 |
| BR-TEN | 5.13 |
| BR-ERR | 5.14 |
| BR-RLM | 5.15 |
| BR-IDN | 5.16 |
| BR-RPT | Bab 12 |

*— Akhir dokumen —*

