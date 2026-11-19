# Spesifikasi UI/UX & Design Token — Solva POS

| Atribut | Nilai |
|---|---|
| Nama produk | Solva POS |
| Jenis dokumen | Spesifikasi UI/UX + Design Token + Pola Layar (bukan kode, bukan file konfigurasi) |
| Status dokumen | **Draft 0.8 — siap direview** (seluruh open question desain DOQ-01…26 sudah dijawab user; Bab 9.1) |
| Riwayat revisi | **0.8** (2026-11-19): DOQ-26 dijawab (halaman `/join` dan `/reset` terpisah; daftar Undangan tertunda dengan Batalkan/Terbitkan ulang, kedaluwarsa tampil 7 hari) · **0.7**: identitas global + keanggotaan per tenant, **kode sekali pakai** (undangan 72 jam, atur ulang 24 jam), cookie sesi per slug, SCR-S06/S07/A11, tanpa kata sandi sementara · **0.6**: rate limit (perkiraan menit, PIN tanpa jam dinding, `server_busy`, laporan berat) · **0.5**: warna tenant dihapus, pemilih `/<slug>` (SCR-S05), QR pairing dengan kode di fragmen, 22 kode error ARCHITECTURE §9.7.1 · **0.4**: error management tiga tingkat (CMP-36/37, SCR-P17, SCR-S04) · **0.3**: tenant via URL sub-path (SCR-S01..S03, CMP-35) · **0.2**: sinkron dengan PRD (serah-terima bill, `PREBILL_PRINTED`, idle-lock) dan jawaban DOQ-01…18 · **0.1** (2026-11-18): draf awal |
| Tanggal | 2026-11-19 (revisi terakhir; draf awal 2026-11-18) |
| Pemilik | Solo developer (Product Owner = Engineer) |
| Peran penyusun | Senior Product Designer + Design Systems Engineer |
| Bahasa | Indonesia (istilah teknis dalam bahasa Inggris dipertahankan) |
| Sumber utama | Gambar referensi `docs/reference/ui-reference.jpg` (4 layar tema "Zero Health"; sumber **utama** design token) |
| Sumber perilaku | `docs/PRD.md` (versi terkini di folder `docs/`; ID `BR-*`, `FR-*`, `FLOW-*`, `NFR-*`, `EC-*`, `KEP-*`), `docs/SCHEMA.md` (versi terkini di folder `docs/`; nama entitas/status; hanya dirujuk bila perlu), `docs/ARCHITECTURE.md` (rujukan teknis: katalog kode error §9.7.1, rate limit §6.9, ketahanan crash §9.7.5–9.7.6) |
| Konsumen dokumen | AI coding agent dan developer yang akan mengimplementasikan UI dengan **Tailwind CSS** (TanStack Start + React) |

> **Dokumen ini tidak berisi kode aplikasi.** Nilai token, tabel pemetaan Tailwind, dan wireframe teks adalah **spesifikasi**. File `tailwind`/CSS/komponen React yang sesungguhnya dibuat nanti oleh implementasi, mengikuti dokumen ini.

### Daftar Isi

1. Tujuan, Prinsip Desain, dan Cakupan
2. Design Token (Warna · Tipografi · Spasi & Sentuh · Radius/Bayangan · Z-index · Animasi · Ikon · Grid & Layout · Mode Gelap)
3. Komponen (CMP-01 … CMP-37)
4. Pola Layar dan Wireframe Teks (SCR-P01 … P17, SCR-A01 … A11, SCR-S01 … S07)
5. Pola Interaksi dan Keadaan Sistem (termasuk §5.5 Manajemen Error di UI)
6. Konten dan Mikrocopy
7. Aksesibilitas
8. Pemetaan Token ke Implementasi (Tailwind)
9. Open Questions Desain (`DOQ-01…23`) dan Traceability
10. Lampiran (A: ekstraksi dari gambar · B: tabel kontras · C: ringkasan token)

**Ringkasan keputusan inti (agar tidak ambigu):**
- Warna aksi = **`primary-700` `#46780D`** (putih di atasnya 5,31 : 1). Hijau referensi `primary-500` `#76B617` (`ESTIMASI DARI GAMBAR`) hanya identitas/dekoratif karena putih di atasnya hanya 2,48 : 1 (`DOQ-02`).
- Target sentuh minimum **44 px**, default `/pos` **48 px**, aksi utama **56 px**; teks minimum **12 px**; angka uang **tabular**.
- Radius: kontrol 10, kartu 16, modal 20 (`ESTIMASI DARI GAMBAR`). Layout: sidebar 240, rail 72, header 64.
- **Error management (keputusan user 2026-11-18):** tiga tingkat presentasi — T1 aturan/validasi (pesan jelas **tanpa kode**), T2 gangguan sementara (indikator + coba ulang otomatis, **tanpa dialog**), T3 kesalahan sistem tak terduga (pesan ramah + **`KODE#id` + tombol Salin**); login generik; error boundary per area; layar pemulihan dan layar reset aplikasi; **tanpa** tombol "Laporkan masalah" dan **tanpa** halaman "Kesehatan Perangkat" di MVP (§5.5).
- **Tenant via URL** `<DOMAIN>/<slug>/pos` dan `/<slug>/admin` (keputusan user 2026-11-18): layar login/pairing/kunci memuat **nama tenant**; **tidak ada fitur/warna tenant** di MVP — penanda tenant = avatar inisial `primary-700` + nama; aksen login dan tema PWA memakai warna primer aplikasi. `/<slug>` polos = pemilih "Terminal Kasir" atau "Back-office" (SCR-S05); root `/` dan slug tak dikenal = 404 generik; tenant ditangguhkan = halaman "tidak tersedia" (§4.3a). Satu perangkat boleh melayani lebih dari satu tenant (penyimpanan lokal terpisah total). **Identitas back-office global + keanggotaan per tenant** (login hanya email + kata sandi; **cookie sesi per slug**, login terpisah per tenant; tanpa email/lupa kata sandi mandiri di MVP — undangan dan atur ulang lewat **kode sekali pakai** terikat email (undangan 72 jam, atur ulang 24 jam) yang diterbitkan Owner/Operator dan disampaikan manual; tanpa kata sandi sementara; SCR-A01, SCR-A08, SCR-A11, SCR-S06/S07).
- Status selalu **warna + ikon + teks**; palet grafik tervalidasi buta warna dengan pembeda non-warna wajib.
- **Jawaban user (2026-11-18, seluruh DOQ):** warna aksi `#46780D` (DOQ-02) · font **Plus Jakarta Sans** (DOQ-01; angka tabular harus diverifikasi) · latar aplikasi **putih** (DOQ-04) · denah meja **kisi per area** (DOQ-08) · dark mode **pasca-MVP** (DOQ-03) · mode padat tidak (DOQ-05) · set perangkat uji standar (DOQ-06) · hitung per pecahan opsional (DOQ-07) · tanpa bunyi/getar (DOQ-10) · ikon Lucide (DOQ-11) · logo placeholder (DOQ-12) · tanpa gambar produk di MVP (DOQ-13) · tanpa SSO (DOQ-15) · pintasan usulan (DOQ-16) · Tailwind v4 (DOQ-17). **Sudah masuk PRD dan disinkronkan di sini:** event `PREBILL_PRINTED` (DOQ-09, BR-FNB-010) · auto-lock 10 menit (DOQ-14, BR-AUT-015) · waiter mencatat di HP register `PELAYAN`, bayar di kasir lewat serah-terima bill (DOQ-18, BR-FNB-011/012/013).

---

## 0. Cara Membaca Dokumen Ini

### 0.1 Tag yang Dipakai

| Tag | Arti |
|---|---|
| `ESTIMASI DARI GAMBAR` | Nilai diukur/ditaksir dari gambar referensi (sampel piksel dan pengukuran visual, Lampiran A). Boleh disetel ulang bila perlu, tetapi harus diubah **di satu tempat** (token). |
| `DITETAPKAN` | Keputusan desain penyusun yang konkret agar tidak ambigu (sering berupa **penyesuaian** nilai referensi demi kontras/sentuh/POS). Tidak memblokir pengembangan. |
| `PERLU KONFIRMASI` | Tidak dapat ditentukan dari gambar/PRD, atau punya beberapa opsi. Berisi rekomendasi + opsi + dampak di **Bab 9.1** (`DOQ-nn`). Rekomendasi dipakai sementara. |

### 0.2 Konvensi ID

| Pola | Makna | Contoh |
|---|---|---|
| `DP-nn` | Prinsip desain | DP-03 |
| `DOQ-nn` | Open question desain (`PERLU KONFIRMASI`) | DOQ-01 |
| `SCR-Pnn` / `SCR-Ann` | Layar terminal kasir `/pos` / back-office `/admin` | SCR-P04 |
| `CMP-nn` | Komponen | CMP-07 |
| `BR-…`, `FR-…`, `FLOW-…`, `NFR-…`, `EC-…` | ID PRD (tidak dibuat ulang di sini) | FR-POS-012 |

### 0.3 Cara Mengukur Kontras (berlaku untuk seluruh dokumen)

- Rumus WCAG 2.x: `L = 0,2126·R + 0,7152·G + 0,0722·B` (kanal sRGB di-linear-kan), `rasio = (L_terang + 0,05) / (L_gelap + 0,05)`. Semua angka rasio dalam dokumen ini **dihitung** dengan rumus tersebut pada nilai hex yang tertulis (bukan ditaksir), dibulatkan 2 desimal.
- Target: teks normal **≥ 4,5 : 1** (AA); teks besar (≥ 24 px, atau ≥ 18,66 px tebal) **≥ 3 : 1**; ikon/komponen UI/batas kontrol interaktif/grafik yang membawa makna **≥ 3 : 1** (WCAG 1.4.11).
- Tabel lengkap di **Lampiran B**.

---

## 1. Tujuan, Prinsip Desain, dan Cakupan

### 1.1 Tujuan

1. Menetapkan **satu bahasa visual** (token + komponen + pola layar) untuk `/pos` (terminal kasir offline) dan `/admin` (back-office SSR online-only) agar AI coding agent dapat mengimplementasikannya langsung ke Tailwind tanpa menebak.
2. Menurunkan token dari gambar referensi "Zero Health" (hijau segar, kartu putih berradius besar, tab, status chip, progress bar bersegmen) **tanpa** menyalin isi/konten kesehatan, logo, atau mereknya.
3. Menyelaraskan UI dengan alur dan aturan bisnis POS di PRD: checkout cepat, cetak cepat, status koneksi/sinkron selalu terlihat, ketahanan offline, F&B (meja, open bill, split/merge, lease) dan retail (barcode, varian, multi-UOM).

### 1.2 Apa yang Diambil, Disesuaikan, dan Dibuang dari Gambar Referensi

Gambar referensi adalah dashboard aplikasi **kesehatan**, bukan POS. Hanya **bahasa visualnya** yang diambil.

| Aspek | Terlihat di referensi | Keputusan Solva POS | Alasan |
|---|---|---|---|
| Warna primer | Hijau segar ≈ `#76B617` (sampel: `#74B614`–`#7CBA17`) pada tombol, tab aktif, batang aktif, kartu hero | **Diambil** sebagai identitas (`primary-500`). Untuk **teks dan tombol berteks putih** dipakai varian lebih gelap `primary-700` `#46780D` | Putih di atas `#76B617` hanya 2,48 : 1 (gagal AA). Putih di atas `#46780D` = 5,31 : 1 |
| Latar | Latar luar abu kebiruan `#DEDFE3`; area aplikasi putih; kartu putih ber-border sangat tipis `#F3F3F3` | Latar luar `canvas` dipakai hanya di layar penuh tak berkartu (login/pairing di layar lebar). Latar aplikasi **putih** (`DOQ-04` dijawab user, sama seperti referensi); karena kartu putih di atas latar putih, **border kartu dinaikkan** dari `#F3F3F3` ke `line` `#DEDFE3` | Border `#F3F3F3` (1,1 : 1) terlalu samar untuk lingkungan toko |
| Kartu | Putih, radius besar ≈ 16 px, bayangan sangat lembut | **Diambil** (radius 16, bayangan lembut + border `line`) | — |
| Tab pill | Aktif: hijau terisi, teks putih. Tidak aktif: abu muda `#EDEDED`, teks gelap. Radius ≈ 10 px (persegi bulat, **bukan** kapsul penuh) | **Diambil**; aktif memakai `primary-700` | Kontras |
| Sidebar | Putih, ikon garis + label, item aktif = pill putih berbayang dengan ikon/teks hijau, profil pengguna di bawah | **Diambil dan diadaptasi**; item aktif: pill lembut `action-soft` + bar penanda kiri 3 px `action` + teks/ikon `ink-brand` (referensi: pill putih berbayang berikon hijau; penanda tidak hanya warna, DP-04) | Aksesibilitas |
| Status chip | Oranye = berjalan, hijau (outline) = selesai, merah = bermasalah; chip bergaris + latar tint | **Diambil** dan diperluas menjadi keluarga semantik + status operasional POS; **selalu** ikon + teks | Tidak mengandalkan warna |
| Grafik | Donut gradien merah muda–oranye–hijau; area chart merah muda dengan garis hijau; batang abu muda dengan batang aktif hijau | Batang abu + aktif hijau **diambil**. Gradien merah muda–oranye hanya **dekoratif**; data memakai palet kategorikal tervalidasi (§2.1.7) | Gradien tidak aman buta warna dan tidak bisa dibaca per nilai |
| Progress bar | Segmen vertikal tipis hijau (isi) dan abu (kosong) | **Diambil** sebagai varian "bersegmen" untuk progres diskrit; progres kontinu memakai bar penuh | — |
| Tipografi | Sans-serif humanis bersih, judul halaman ≈ 20–24 px, judul kartu ≈ 16 px, teks navigasi ≈ 14 px, banyak teks sangat kecil (≈ 10–11 px) | **Diambil** gayanya; **ukuran minimum 12 px** (tidak ada teks 10–11 px), angka wajib tabular | Keterbacaan |
| Layout | Sidebar kiri ≈ 240 px, header (judul kiri; ikon notifikasi + avatar kanan), grid kartu 3 kolom, jarak kartu ≈ 16 px | **Diambil** untuk `/admin`; `/pos` memakai varian padat dan besar sentuh | Perangkat sentuh |
| Isi | Biomarker, kesehatan, "Zero Health", foto stetoskop, logo | **Dibuang seluruhnya.** Tidak ada logo/merek dari referensi. Logo Solva belum ada → **placeholder teks "Solva POS"** (`DOQ-12`) | Instruksi sesi + hak merek |

### 1.3 Prinsip Desain

| ID | Prinsip | Konsekuensi konkret |
|---|---|---|
| DP-01 | **Checkout dulu.** Jalur produk → bayar → selesai paling pendek dan selalu terlihat. | Dari layar kasir, "Bayar" selalu terlihat (tombol 56 px); tidak lebih dari **3 ketukan** dari item terakhir sampai pembayaran tunai selesai (nominal cepat); tidak ada dialog konfirmasi pada jalur sukses (G-04, NFR-PERF-001). |
| DP-02 | **Padat informasi, besar target sentuh.** | Tipografi 14–16 px, baris daftar 56 px, **target sentuh ≥ 44 px (default `/pos` 48 px)**, jarak antar target ≥ 8 px. |
| DP-03 | **Status koneksi/sinkron selalu terlihat; offline bukan error.** | Indikator di header/top bar di semua layar `/pos`; banner non-blokir bila ada transaksi pending (BR-SYN-051). Offline memakai warna **amber**, bukan merah (G-01, AP-03). |
| DP-04 | **Tidak mengandalkan warna saja.** | Setiap status = warna + ikon + teks (atau pola/bentuk). Diuji dengan simulasi buta warna (§2.1.7, §7). |
| DP-05 | **Terbaca di bawah cahaya outlet.** | Kontras teks ≥ 4,5 : 1; tidak memakai abu terang untuk teks bermakna; angka tabular; layar cerah tidak bergantung pada bayangan halus. |
| DP-06 | **Fakta tidak ditolak.** | Kondisi bisnis (stok estimasi ≤ 0, harga beda, item dinonaktifkan setelah dimasukkan) menghasilkan **peringatan non-blokir**, bukan pemblokiran penjualan (AP-02, FR-POS-011). Pemblokiran hanya untuk aturan keras (mis. item tidak tersedia di outlet saat **ditambahkan**, FR-POS-012/013). |
| DP-07 | **Aksi sensitif dilindungi, aksi umum tidak.** | PIN supervisor (BR-AUT-006) hanya untuk void, diskon di atas batas, retur, override. Void item pada open bill: tanpa PIN, alasan wajib (BR-AUT-009 catatan; OQ-17). |
| DP-08 | **Simpan dan cetak tidak saling menunggu.** | UI sukses tampil begitu IndexedDB commit; cetak berjalan asinkron; kegagalan cetak tidak mengubah status penjualan (AP-10, BR-PRN-002). |
| DP-09 | **Satu bahasa visual, dua kerapatan.** | `/pos`: besar sentuh, kontras tinggi, minim kartu bersarang. `/admin`: lebih rapat (mouse + keyboard), tabel data, boleh `control-sm` 36 px hanya saat `pointer: fine`. |
| DP-10 | **Token dulu, jangan hardcode.** | Warna/ukuran/radius/bayangan **hanya** dari token (Bab 8). Nilai literal di komponen dianggap cacat. |
| DP-11 | **Siap multi-bahasa.** | Teks bisa tumbuh ±40% (id ↔ en); tidak ada lebar tetap untuk label; angka/tanggal mengikuti locale (BR-I18N-006); tidak ada string literal di komponen (BR-I18N-001). |
| DP-12 | **Offline-ready aset.** | Font, ikon, ilustrasi di-precache bersama app shell; tidak ada CDN eksternal saat runtime (BR-I18N-003, NFR-PERF-004). |
| DP-13 | **Galat tidak menghentikan kasir.** | Tiga tingkat presentasi (§5.5): aturan = pesan jelas tanpa kode; gangguan sementara = indikator + coba ulang otomatis tanpa dialog; kesalahan sistem = pesan ramah + `KODE#id` + Salin. Kegagalan satu panel tidak menutup layar (error boundary per area). Gagal cetak tidak memblokir checkout berikutnya. |

### 1.4 Cakupan

**Termasuk:** token, komponen, pola layar `/pos` dan `/admin`, pola interaksi/keadaan sistem, mikrocopy, aksesibilitas, pemetaan token ke Tailwind, open questions desain, ekstraksi dari gambar.

**Tidak termasuk:** kode/komponen/konfigurasi aktual; logo dan identitas merek final; ilustrasi final; desain struk **termal** (struk berbentuk teks ESC/POS, BR-PRN-003; hanya **pratinjau layar** didefinisikan di CMP-27); kampanye pemasaran; aplikasi iOS (bukan target, NFR-COMP-001); halaman diagnostik "Kesehatan Perangkat" dan tombol "Laporkan masalah" (tidak ada di MVP, §5.5).

---

## 2. Design Token

> Semua token memiliki empat atribut: **nama**, **nilai**, **penggunaan**, **padanan tema Tailwind**. Penamaan Tailwind memakai konvensi variabel tema `--color-*`, `--radius-*`, dst. (Tailwind v4 `@theme`); untuk Tailwind v3 padanannya `theme.extend.colors.primary.500` dan seterusnya — nama utilitasnya sama. Lihat Bab 8 untuk aturan penamaan.

### 2.1 Warna

Warna dibangun dua lapis:
1. **Primitif**: skala mentah (`primary-*`, `neutral-*`, keluarga semantik). Boleh dipakai langsung hanya di definisi token dan untuk komponen yang secara eksplisit disebut.
2. **Peran (semantic role)**: `app`, `surface`, `ink`, `line`, `action`, dst. **Komponen memakai token peran**, bukan primitif (Bab 8), agar dark mode dan penyetelan ulang tidak menyentuh komponen.

#### 2.1.1 Skala Primer (hijau)

Identitas = `primary-500`. Hijau terang tidak lolos AA dengan teks putih; karena itu **`primary-700` adalah warna aksi** (tombol, tab aktif, tautan, fokus).

| Token | Hex | Asal | Penggunaan | Tailwind |
|---|---|---|---|---|
| `primary-50` | `#F5FAEA` | `DITETAPKAN` | Latar item terpilih/aktif lembut, baris terpilih tabel, meja "terisi" | `bg-primary-50` |
| `primary-100` | `#E8F3CF` | `DITETAPKAN` | Hover item lembut, chip "selesai/aktif" (latar), sel heatmap level 1 | `bg-primary-100` |
| `primary-200` | `#D2E8A3` | `DITETAPKAN` | Border item terpilih ringan, ilustrasi | `border-primary-200` |
| `primary-300` | `#B4D96C` | `DITETAPKAN` | Sel heatmap level 2, aksen pada latar gelap | `bg-primary-300` |
| `primary-400` | `#94C73C` | `DITETAPKAN` | Aksen dekoratif, tautan/aksi pada **dark mode** | `text-primary-400` |
| **`primary-500`** | **`#76B617`** | **`ESTIMASI DARI GAMBAR`** (sampel tombol login `#7BB717`, tab aktif `#74B614`, batang aktif `#7CBA17`/`#78B615`, kartu hero `#74B712`) | **Identitas/brand**: logo placeholder, ilustrasi, latar dekoratif. (Status "online" memakai keluarga `success`, bukan hijau brand, §2.1.5.) **Bukan** untuk teks, bukan untuk tombol berteks putih | `bg-primary-500` |
| `primary-600` | `#5E9A10` | `DITETAPKAN` | **Grafik/ikon** yang membawa makna (3,44 : 1 vs putih), isi progress bar, batang aktif grafik berlabel, ikon nav aktif besar | `bg-primary-600` |
| **`primary-700`** | **`#46780D`** | `DITETAPKAN` (turunan lebih gelap dari 500; hue dipertahankan) | **Warna aksi**: tombol primer (teks putih 5,31 : 1), tab pill aktif, teks tautan, teks/ikon nav aktif, ring fokus | `bg-primary-700` |
| `primary-800` | `#3D660F` | `DITETAPKAN` | Hover tombol primer; teks di atas `primary-50/100` (6,36 / 5,84) | `bg-primary-800` |
| `primary-900` | `#32530F` | `DITETAPKAN` | Active/pressed tombol primer; teks tebal di atas `primary-100` (7,63) | `bg-primary-900` |
| `primary-950` | `#172A04` | `DITETAPKAN` | Latar sangat gelap beraksen hijau (dark mode), teks di atas `primary-500` bila dipilih opsi B (DOQ-02) | `bg-primary-950` |

**Aturan pemakaian hijau (wajib):**

| Situasi | Pakai | Dilarang |
|---|---|---|
| Teks berwarna hijau di atas putih/`surface-hover` | `ink-brand` (= `primary-700`) | `primary-500/600` untuk teks |
| Tombol/tab/chip berteks putih | `primary-700` (hover 800, active 900) | `primary-500` + teks putih |
| Isi grafik/progress/ikon bermakna | `primary-600` (≥ 3 : 1) atau `primary-800` (seri 1 grafik) | `primary-400` ke bawah |
| Elemen dekoratif tanpa makna | `primary-500` boleh | — |
| Teks di atas `primary-500` (mis. kartu hero) | `neutral-900` (6,81 : 1) atau `primary-950` (6,19 : 1) — **bukan putih** | Putih (2,48 : 1) |

#### 2.1.2 Skala Netral

Netral ber-tint abu sangat tipis (mendekati netral murni seperti referensi: sampel `#191919`, `#5C5E5D`, `#7E7E7E`, `#EDEDED`, `#F3F3F3`, latar luar `#DEDFE3`).

| Token | Hex | Asal | Rasio vs putih | Tailwind |
|---|---|---|---|---|
| `neutral-0` | `#FFFFFF` | `ESTIMASI DARI GAMBAR` (kartu/sidebar) | 1,00 | `bg-neutral-0` |
| `neutral-25` | `#FAFAFB` | `DITETAPKAN` | 1,04 | `bg-neutral-25` |
| `neutral-50` | `#F4F5F6` | `DITETAPKAN` (≈ sampel `#F3F3F3`/`#F4F4F4`) | 1,09 | `bg-neutral-50` |
| `neutral-100` | `#ECEDEF` | `ESTIMASI DARI GAMBAR` (tab non-aktif `#EAEAEA`–`#EDEDED`, track batang `#EFEFF1`) | 1,17 | `bg-neutral-100` |
| `neutral-200` | `#DEDFE3` | `ESTIMASI DARI GAMBAR` (latar luar `#DEDFE3`) | 1,33 | `bg-neutral-200` |
| `neutral-300` | `#C9CBD1` | `DITETAPKAN` | 1,62 | `bg-neutral-300` |
| `neutral-400` | `#8E929C` | `DITETAPKAN` | 3,11 | `bg-neutral-400` |
| `neutral-500` | `#6B7079` | `DITETAPKAN` (≈ sampel `#7E7E7E`, dipertebal demi kontras) | 4,98 | `bg-neutral-500` |
| `neutral-600` | `#52565F` | `DITETAPKAN` (≈ `#5C5E5D`) | 7,36 | `bg-neutral-600` |
| `neutral-700` | `#3F434B` | `DITETAPKAN` (≈ segmen gelap `#404040`) | 9,93 | `bg-neutral-700` |
| `neutral-800` | `#2A2D33` | `DITETAPKAN` | 13,80 | `bg-neutral-800` |
| `neutral-900` | `#1B1D21` | `DITETAPKAN` (≈ judul `#191919`) | 16,88 | `bg-neutral-900` |
| `neutral-950` | `#0F1012` | `DITETAPKAN` | 19,04 | `bg-neutral-950` |

#### 2.1.3 Token Peran: Permukaan, Teks, Garis, Aksi

Inilah token yang dipakai komponen. Nilai = rujukan ke primitif (mode terang).

**Permukaan**

| Token peran | → Primitif (hex) | Penggunaan | Tailwind |
|---|---|---|---|
| `canvas` | `neutral-200` `#DEDFE3` | Latar luar (login/pairing di layar ≥ lg; mengelilingi kartu tengah). Tidak dipakai di dalam aplikasi | `bg-canvas` |
| `app` | `neutral-0` `#FFFFFF` | Latar halaman/konten `/pos` dan `/admin` (`DOQ-04`: putih seperti referensi; kartu dipisah border `line`, §1.2) | `bg-app` |
| `surface-hover` | `neutral-50` `#F4F5F6` | Hover baris/item nav, baris terpilih netral, area `readonly` | `bg-surface-hover` |
| `surface` | `neutral-0` `#FFFFFF` | Kartu, sidebar, header, modal, input, dropdown | `bg-surface` |
| `surface-subtle` | `neutral-25` `#FAFAFB` | Header tabel, baris zebra, area bersarang di dalam kartu | `bg-surface-subtle` |
| `surface-sunken` | `neutral-100` `#ECEDEF` | Tab non-aktif, input disabled, track progress/batang, dasar skeleton, segmented control (track) | `bg-surface-sunken` |
| `surface-inverse` | `neutral-900` `#1B1D21` | Toast/snackbar, tooltip | `bg-surface-inverse` |
| `scrim` | `neutral-950` @ 50% | Latar belakang modal/bottom sheet | `bg-scrim` |

**Teks (ink)**

| Token peran | → Primitif | Kontras (vs `surface`/`app` putih / `surface-hover`) | Penggunaan | Tailwind |
|---|---|---|---|---|
| `ink` | `neutral-900` `#1B1D21` | 16,88 / 15,46 | Teks utama, angka, judul | `text-ink` |
| `ink-soft` | `neutral-600` `#52565F` | 7,36 / 6,74 | Teks sekunder, label | `text-ink-soft` |
| `ink-muted` | `neutral-500` `#6B7079` | 4,98 / 4,56 | Teks bantu, placeholder, metadata. **Hanya** di atas `surface`/`app`, `surface-subtle`, `surface-hover` (di atas `surface-sunken` hanya 4,25 → pakai `ink-soft`) | `text-ink-muted` |
| `ink-disabled` | `neutral-400` `#8E929C` | 3,11 / 2,85 | Teks/ikon nonaktif (komponen nonaktif dikecualikan dari persyaratan kontras WCAG; tetap dijaga ≥ 3 : 1 di atas putih) | `text-ink-disabled` |
| `ink-inverse` | `neutral-0` `#FFFFFF` | di atas `surface-inverse` 16,88 | Teks di atas toast/tooltip/tombol berisi | `text-ink-inverse` |
| `ink-brand` | `primary-700` `#46780D` | 5,31 / 4,87 | Tautan, teks nav aktif, teks aksen hijau | `text-ink-brand` |

**Garis**

| Token peran | → Primitif | Kontras vs putih | Penggunaan | Tailwind |
|---|---|---|---|---|
| `line-subtle` | `neutral-100` `#ECEDEF` | 1,17 | Pemisah baris/bagian di dalam kartu dan kartu bersarang (setara `#F3F3F3` referensi) | `border-line-subtle` |
| `line` | `neutral-200` `#DEDFE3` | 1,33 | **Border kartu**, pemisah bagian, border sidebar/header | `border-line` |
| `line-strong` | `neutral-300` `#C9CBD1` | 1,62 | Border tombol sekunder, kartu meja kosong | `border-line-strong` |
| `line-input` | `neutral-400` `#8E929C` | **3,11** | **Border kontrol interaktif** (input, select, checkbox, radio) — memenuhi WCAG 1.4.11 | `border-line-input` |

**Aksi**

| Token peran | → Primitif | Penggunaan | Tailwind |
|---|---|---|---|
| `action` | `primary-700` `#46780D` | Latar tombol primer, tab aktif, switch aktif, ring fokus | `bg-action` |
| `action-hover` | `primary-800` `#3D660F` | Hover | `bg-action-hover` |
| `action-active` | `primary-900` `#32530F` | Pressed | `bg-action-active` |
| `action-soft` | `primary-50` `#F5FAEA` | Latar item aktif/terpilih lembut, tombol "tonal" | `bg-action-soft` |
| `action-soft-hover` | `primary-100` `#E8F3CF` | Hover tonal | `bg-action-soft-hover` |
| `on-action` | `neutral-0` `#FFFFFF` | Teks/ikon di atas `action*` | `text-on-action` |
| `on-action-soft` | `primary-800` `#3D660F` | Teks di atas `action-soft` (6,36) / `action-soft-hover` (5,84) | `text-on-action-soft` |
| `brand` | `primary-500` `#76B617` | Dekoratif/identitas saja | `bg-brand` |
| `focus-ring` | `primary-700` `#46780D` | Cincin fokus keyboard (3 : 1 terhadap putih terpenuhi: 5,31) | `ring-focus-ring` |

**Tombol nonaktif:** `surface-sunken` + `ink-disabled` + ikon/label tetap; kursor `not-allowed`; **tidak memakai opacity** untuk menghindari warna campur tak terukur.

#### 2.1.4 Warna Semantik

Enam keluarga; tiap keluarga punya **4 token**: `solid` (latar berisi, teks putih), `soft` (latar chip/banner), `line` (garis chip), `ink` (teks/ikon di atas putih dan di atas `soft`).

| Keluarga | `solid` | `soft` | `line` | `ink` | Dipakai untuk |
|---|---|---|---|---|---|
| `success` | `#1A7F46` | `#E7F6EC` | `#8FD0A9` | `#17703D` | Berhasil, tersinkron, online, "selesai/lunas" (hue **zamrud**, sengaja beda dari hijau brand-lime agar tidak tertukar dengan identitas) |
| `warning` | `#9A5200` | `#FFF3E0` | `#F0A64B` | `#8A4A00` | Offline, pending, peringatan non-blokir, "berjalan/menunggu" (oranye di referensi) |
| `danger` | `#C0281C` | `#FDECEC` | `#E58B90` | `#B42318` | Galat, perlu perhatian, void/hapus, stok minus, "bermasalah" (merah di referensi) |
| `info` | `#1F6FBA` | `#E8F1FB` | `#8FB8E6` | `#195E9E` | Informasi, sedang sinkron, pembaruan tersedia, open price |
| `violet` | `#6444B8` | `#F1ECFB` | `#BCA9E8` | `#563AA0` | Dipegang/dikunci device lain (lease), read-only |
| `teal` | `#0F766E` | `#E2F5F3` | `#85CFC8` | `#0D625C` | In-transit (transfer) |

Ukuran kontras (dihitung; detail Lampiran B):

| Keluarga | `solid` + putih | `ink` vs putih | `ink` vs `soft` | `line` vs putih |
|---|---|---|---|---|
| success | 5,04 | 6,14 | 5,49 | 1,79 |
| warning | 5,86 | 6,86 | 6,26 | 2,05 |
| danger | 5,90 | 6,57 | 5,76 | 2,49 |
| info | 5,20 | 6,70 | 5,87 | 2,07 |
| violet | 6,86 | 8,37 | 7,23 | 2,10 |
| teal | 5,47 | 7,19 | 6,37 | 1,79 |

> `line` hanya dekoratif pada chip **non-interaktif** (label teks dan ikon sudah membawa makna). Chip **interaktif** (filter, dapat diklik) memakai `line-input` sebagai border (≥ 3 : 1).

Tailwind: `bg-success-solid`, `bg-success-soft`, `border-success-line`, `text-success-ink` (pola sama untuk 6 keluarga; variabel `--color-success-solid`, dst.).

#### 2.1.5 Warna Status Operasional

Satu tabel pemetaan **status → keluarga → ikon → teks**. Komponen status (CMP-08, CMP-17) hanya menerima nama status ini; tidak boleh memilih warna sendiri. Ikon = nama di set Lucide (§2.7). Teks = **kunci** terjemahan (contoh `id-ID`; BR-I18N-004: kode status disimpan sebagai enum, teks ditampilkan oleh client).

| Status (enum UI) | Keluarga | Ikon | Teks contoh (`id-ID`) | Catatan perilaku | Rujukan |
|---|---|---|---|---|---|
| `online` | success | `wifi` | Online | Titik solid + teks | BR-SYN-040 |
| `offline` | **warning** | `wifi-off` | Offline | Bukan danger: offline adalah mode kerja normal; banner non-blokir | G-01, AP-03 |
| `syncing` | info | `refresh-cw` (berputar; statis bila reduced-motion) | Menyinkronkan… | Tidak memblokir | FLOW-14/15 |
| `server_busy` | info | `hourglass` | Server sibuk — mencoba lagi | `429` + `Retry-After` dari pembatas laju saat sync: **tanpa dialog/toast**, retry otomatis mematuhi `Retry-After`, **bukan** offline dan **bukan** "perlu perhatian", `attempts` tidak naik | ARCHITECTURE §6.9.7 |
| `synced` | success | `check` | Tersinkron 14.05 | Waktu sync terakhir | BR-AUT-008 |
| `pending` | warning | `upload` + angka | N belum terkirim | Tampil permanen selama ada perintah non-ACKED | BR-SYN-051 |
| `sync_error` / `needs_attention` | **danger** | `triangle-alert` | Perlu perhatian | Hanya untuk gagal struktural/otorisasi, bukan transien (transien = `pending`) | BR-SYN-030 |
| `lease_warning` | warning | `clock-alert` | Sambungkan internet dalam N jam | 24 jam sebelum lease 7 hari habis | BR-AUT-008 |
| `device_locked` | danger (solid) | `lock` | Perangkat terkunci | Layar penuh | BR-AUT-008/013 |
| `update_available` | info | `download` | Pembaruan tersedia | Banner non-blokir semua halaman | BR-SYN-003 |
| `update_required` | warning (solid) | `download` | Pembaruan wajib | Shift baru diblokir | BR-SYN-003 |
| `stock_negative` | danger | `circle-minus` | Stok minus (−3) | Penanda di laporan/stok; **bukan** pemblokir | BR-STK-002 |
| `stock_estimate_low` | warning | `triangle-alert` | Stok estimasi ≤ 0 | Peringatan non-blokir di POS | BR-STK-005, FR-POS-011 |
| `void` | netral (`ink` + `surface-sunken`) | `ban` | VOID | Nomor/angka **tidak dicoret** (tetap terbaca); ditambah teks "VOID" + latar netral | BR-INV-005 |
| `in_transit` | teal | `truck` | Dalam perjalanan | Transfer SENT | BR-TRF-002 |
| `lease_other` | violet | `lock` | Dipegang device lain | Bill read-only | BR-FNB-003 |
| `handover_pending` | violet | `send` | Menunggu diterima oleh {register} | Di pengirim: bill read-only, masih milik pengirim; ada **Batalkan serah-terima** | BR-FNB-012 |
| `handover_incoming` | info | `inbox` | Bill masuk | Di register kasir tujuan; tombol **Terima** | BR-FNB-012 |
| `screen_locked` | netral | `lock-keyhole` | Layar terkunci | Idle-lock 10 menit atau kunci manual | BR-AUT-015 |
| `item_unavailable` | netral (`ink-soft` + `surface-sunken`) | `eye-off` | Tidak tersedia | Hanya di `/admin` dan pesan scan; di katalog POS item disembunyikan | BR-CAT-012/015 |
| `open_price` | info | `pencil-line` | Harga bebas | Penanda baris | BR-PRC-007 |
| `reprint` | netral | `printer` | CETAK ULANG | Pada pratinjau/struk | BR-PRN-002 |
| `print_failed` | danger | `printer` + `x` | Cetak gagal | Dengan aksi "Cetak ulang" | EC-019 |
| `shift_open` / `shift_closed` | success / netral | `circle-play` / `circle-stop` | Shift terbuka / Ditutup | — | BR-SHF-001 |
| `force_closed` | warning | `shield-alert` | Ditutup darurat | Laporan R-03 | BR-SHF-009 |
| `gap_open` / `gap_explained` | danger / netral | `unlink` | Celah nomor / Dijelaskan | `/admin` | BR-INV-007 |

#### 2.1.6 Warna Status Meja F&B

Status meja bersifat **eksklusif** (satu per meja). Perbedaan memakai **warna + bentuk garis + ikon + teks** (tidak hanya warna). Meja dapat membawa **penanda tambahan** (lencana) yang tidak mengganti status.

| Status (enum UI) | Latar | Garis | Teks | Ikon | Teks label (`id-ID`) | Arti & aksi ketuk |
|---|---|---|---|---|---|---|
| `table_free` | `surface` | `line-strong` 1px solid | `ink` (9,93+) | `circle` (garis) | Kosong | Tidak ada bill `OPEN` (BR-FNB-001). Ketuk = buka bill baru |
| `table_occupied` | `primary-50` | `primary-600` 2px solid | `primary-800` (6,36) | `utensils` | Terisi | ≥ 1 bill `OPEN` **dipegang device ini**. Ketuk = buka bill |
| `table_awaiting_payment` | `warning-soft` | `warning-line` 2px solid | `warning-ink` (6,26) | `receipt-text` | Menunggu bayar | **Seluruh** bill `OPEN` pada meja sedang menunggu bayar: event `PREBILL_PRINTED` terbaru lebih baru daripada perubahan isi terakhir (BR-FNB-010, FR-FNB-014). Terlihat di semua device lewat snapshot open bill; menambah item sesudahnya mengembalikan meja ke "Terisi" |
| `table_locked_other` | `violet-soft` | `violet-line` 2px **putus-putus** | `violet-ink` (7,23) | `lock` | Dipegang device lain | ≥ 1 bill `OPEN` dipegang **device lain**; hanya lihat (read-only), ada "diperbarui HH.mm" (BR-FNB-003, FR-SYN-016) |
| `table_orphan` *(hanya tampilan manager)* | `danger-soft` | `danger-line` 2px putus-putus | `danger-ink` (5,76) | `triangle-alert` | Tanpa pemegang aktif | Bill yatim (BR-FNB-004; laporan FR-FNB-011) |

**Penanda tambahan (lencana di pojok kartu meja):** `N bill` (≥ 2 bill pada meja, BR-FNB-007), `diperbarui HH.mm` (untuk `table_locked_other`), jumlah tamu/kapasitas dari master meja. "Bill terbuka" sebagai **filter** denah = gabungan `table_occupied` + `table_awaiting_payment` + `table_locked_other` (semua meja yang memiliki bill `OPEN`).

#### 2.1.7 Palet Grafik

> Grafik hanya muncul di `/admin` (laporan R-01..R-04) dan kartu ringkasan. Pola dari referensi: batang abu muda (track) dengan batang aktif hijau; area chart berisi tint; donut.

**Kategorikal (maksimum 5 seri; lebih dari itu → kelompokkan sebagai "Lainnya")**

| Token | Hex | Kontras vs putih | Tailwind |
|---|---|---|---|
| `chart-1` | `#3D660F` (= `primary-800`) | 6,76 | `bg-chart-1` / `fill-chart-1` |
| `chart-2` | `#1F6FBA` | 5,20 | `bg-chart-2` |
| `chart-3` | `#CF7B0E` | 3,23 | `bg-chart-3` |
| `chart-4` | `#C2417A` | 4,85 | `bg-chart-4` |
| `chart-5` | `#8E929C` (= `neutral-400`; "Lainnya") | 3,11 | `bg-chart-5` |

**Validasi (dihitung; ΔE76 di CIELAB; simulasi CVD Machado 2009 keparahan penuh)**

| Skenario | Pasangan paling berdekatan (ΔE) |
|---|---|
| Penglihatan normal | chart-2 ↔ chart-5 = 43,0 |
| Protanopia | chart-1 ↔ chart-3 = 19,9; chart-4 ↔ chart-5 = 21,6 |
| Deuteranopia | **chart-4 ↔ chart-5 = 12,0** (terendah); chart-1 ↔ chart-3 = 35,4 |
| Tritanopia | chart-3 ↔ chart-4 = 18,4; chart-1 ↔ chart-2 = 21,8 |

**Aturan (karena ΔE < 20 pada beberapa pasangan): warna tidak boleh menjadi satu-satunya pembeda.**
1. Setiap seri punya **label langsung** (pada batang/garis/irisan) atau legenda dengan **penanda bentuk** berbeda (●, ■, ▲, ◆, ○).
2. Garis memakai **pola** berbeda (solid, putus-putus, titik) bila ≥ 3 seri pada satu grafik; area/batang tumpuk memakai **garis pemisah putih 2 px** antar segmen.
3. Setiap grafik menyediakan **tabel data** setara (tombol "Lihat sebagai tabel").
4. `chart-3` (3,23) dan `chart-5` (3,11) hanya untuk isi grafik (≥ 3 : 1); **teks angka** di dalam/di dekatnya memakai `ink`.
5. Gradien merah muda–oranye–hijau dari referensi (donut `#FE7CAC` → `#FEAF77`, area `#FEF0F0`) **tidak dipakai untuk data**; boleh sebagai ilustrasi dekoratif tanpa makna.

**Sekuensial (heatmap, kepadatan, matriks ketersediaan):** `seq-1 #E8F3CF` · `seq-2 #B4D96C` · `seq-3 #76B617` · `seq-4 #46780D` · `seq-5 #32530F` (= `primary-100/300/500/700/900`). Luminans menurun monoton. Teks di atas `seq-1..3` = `ink` (≥ 6,81); di atas `seq-4..5` = putih (5,31 / 8,82). Selalu tampilkan angka di sel.

**Divergen (selisih kas, delta stok, variansi):** `div-neg-2 #1F6FBA` · `div-neg-1 #8FB8E6` · `div-0 #ECEDEF` · `div-pos-1 #F0B777` · `div-pos-2 #CF7B0E`. **Sengaja biru ↔ jingga, bukan merah ↔ hijau** (aman buta warna). Arah (negatif/positif) selalu juga ditulis dengan tanda (−/+) dan ikon panah.

**Batang aktif (pola referensi):** track `surface-sunken`, batang biasa `neutral-300`, batang aktif/terpilih `primary-600` + label nilai di atasnya (bukan hanya warna).

**Progress bersegmen (pola referensi):** segmen vertikal lebar 4 px, tinggi 14 px, jarak 2 px, radius 2 px; isi `primary-600`, kosong `surface-sunken`; menyertakan teks "x/N" (`ESTIMASI DARI GAMBAR` untuk dimensi segmen; bentuk berasal dari referensi).


#### 2.1.8 Identitas Tenant (tanpa warna tenant di MVP)

Keputusan user (2026-11-18): tenant dikenali lewat URL sub-path `<DOMAIN>/<slug>/pos` dan `<DOMAIN>/<slug>/admin`. Tenant **tidak punya logo dan tidak punya warna**: **tidak ada** fitur atau pengaturan warna tenant di MVP. Identitas tenant di UI hanya **nama tenant** dan **avatar inisial** (CMP-35) yang memakai **satu warna token tetap**:

| Elemen | Nilai tetap | Kontras | Catatan |
|---|---|---|---|
| Avatar tenant | latar `primary-700` `#46780D`, inisial `on-action` putih | 5,31 : 1 | Sama untuk semua tenant |
| Aksen layar login/pairing/halaman sistem | `primary-700` / `action` (panel login memakai `primary-700` + teks `on-action`) | 5,31 : 1 | Warna primer aplikasi |
| `theme_color` PWA | `primary-700` `#46780D` | — | Karena 5,31 : 1 dengan putih, ikon status bar terang tetap terbaca |
| `background_color` PWA | `#FFFFFF` | — | Netral |

Tidak ada token warna tenant: komponen memakai token peran yang sudah ada (§2.1.3). **Tema PWA terpasang (`/pos`; spesifikasi konseptual, bukan file):**

| Properti PWA | Nilai | Catatan |
|---|---|---|
| Nama | **Nama tenant** (apa adanya; BR-I18N-005) | Nama singkat = nama dipotong ±12 karakter |
| `start_url` / `scope` | `/<slug>/pos` / `/<slug>/` | Satu pemasangan per tenant; satu perangkat boleh memasang beberapa tenant |
| Ikon | **Ikon Solva bersama** (placeholder, DOQ-12); tanpa ikon per tenant | Pembeda antar tenant di perangkat = **nama** |
| `/admin` | Tidak diprioritaskan sebagai PWA (online-only); boleh dibuka di browser | — |

Catatan implementasi (untuk ARCHITECTURE): manifest perlu **dinamis per slug**; perubahan nama tenant dapat **tidak langsung** tercermin pada PWA yang sudah terpasang. Nama tenant disalin ke penyimpanan lokal saat pairing/sync agar penanda tenant tampil **tanpa jaringan**. Nama tenant (maks. 40 karakter) **diatur oleh Operator Platform** saat membuat tenant dan diubah lewat operator (`DOQ-22`, dijawab user); **tidak ada layar pengaturan nama untuk Owner di `/admin`** pada MVP, dan **tidak ada pengaturan domain kustom** (ditunda).


### 2.2 Tipografi

#### 2.2.1 Keluarga Font — **Plus Jakarta Sans** (jawaban user, DOQ-01; syarat verifikasi angka tabular)

Font pada referensi **tidak dapat diidentifikasi pasti** dari gambar; yang terlihat hanya kesan visualnya: sans-serif **humanis** yang bersih dengan bukaan huruf lebar. Dokumen ini **tidak menyebut nama font referensi**; berikut rekomendasi dan opsi.

| Opsi | Keluarga | Lisensi | Alasan | Catatan |
|---|---|---|---|---|
| A — Cadangan | **Inter** (variabel, subset Latin + Latin-Ext) | SIL OFL 1.1 | Angka tabular dan keterbacaan layar sangat baik; mendukung `tnum`/`zero`; mudah di-self-host; metrik konsisten id/en | Bobot dipakai: 400, 500, 600, 700. ±100–150 KB woff2 (variabel). Tampilan sedikit lebih "dingin" dari referensi; cadangan angka tabular |
| **B — DIPILIH user** | **Plus Jakarta Sans** (variabel) | SIL OFL 1.1 | Lebih hangat/humanis, lebih dekat ke kesan referensi | **Syarat:** sebelum implementasi, verifikasi bahwa file font yang di-self-host mendukung angka tabular (`tnum`) untuk bobot 400–700 dan glyph Latin-Ext. **Bila tidak mendukung, angka uang/kuantitas/total memakai Inter (cadangan A) lewat `font-feature` terpisah** — jangan menurunkan aturan tabular (T-06) |
| C | Hanya font sistem | — | Tanpa unduhan, start tercepat | Tampilan berbeda per OS (Segoe UI di Windows, Roboto di Android); metrik angka bisa beda antar perangkat |

**Aturan bagi semua opsi:**
1. **Self-host** file woff2; di-precache service worker bersama app shell (DP-12); `font-display: swap` agar teks tampil dengan fallback saat offline pertama kali.
2. Fallback wajib agar tetap tampil tanpa jaringan: `system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
3. Mono (nomor invoice, kode, pratinjau struk teks): **font sistem** `ui-monospace, "Cascadia Mono", Consolas, "Roboto Mono", monospace` (tanpa unduhan tambahan).
4. Seluruh angka uang/kuantitas/total/nomor memakai **angka tabular** (`tabular-nums`) — wajib, tanpa kecuali (§2.2.3).

| Token | Nilai | Tailwind |
|---|---|---|
| `font-sans` | Plus Jakarta Sans (opsi B), lalu fallback di atas | `font-sans` |
| `font-num` (hanya bila `tnum` tidak tersedia) | Inter, lalu fallback di atas | `font-num` |
| `font-mono` | `ui-monospace, "Cascadia Mono", Consolas, "Roboto Mono", monospace` | `font-mono` |

#### 2.2.2 Skala Ukuran

Satuan `rem` (basis 16 px). Dua konteks: **`/pos`** memakai `body-lg` 16 px sebagai teks dasar (sentuh/jarak pandang); **`/admin`** memakai `body` 14 px (mouse, tabel padat). **Tidak ada teks di bawah 12 px** (referensi memakai 10–11 px → tidak diadopsi). 12 px hanya untuk metadata/keterangan, **tidak pernah** untuk harga, kuantitas, total, status utama.

| Token | Ukuran / tinggi baris | Bobot | Penggunaan | Tailwind |
|---|---|---|---|---|
| `total-xl` | 40 px / 48 px | 700 | Total tagihan di layar bayar (tablet/desktop) | `text-total-xl` |
| `total-lg` | 32 px / 40 px | 700 | Total tagihan di HP; total pada panel keranjang tablet | `text-total-lg` |
| `display` | 32 px / 40 px | 600 | Angka KPI hero dashboard | `text-display` |
| `h1` | 24 px / 32 px | 600 | Judul halaman (header). HP: gunakan `h2` | `text-h1` |
| `h2` | 20 px / 28 px | 600 | Judul bagian/dialog | `text-h2` |
| `h3` | 18 px / 24 px | 600 | Judul kartu besar, sub-bagian | `text-h3` |
| `title` | 16 px / 24 px | 600 | Judul kartu (setara "Health Snapshot" di referensi), nama item keranjang | `text-title` |
| `body-lg` | 16 px / 24 px | 400 | Teks dasar `/pos` | `text-body-lg` |
| `body` | 14 px / 20 px | 400 | Teks dasar `/admin`, sel tabel | `text-body` |
| `body-sm` | 13 px / 18 px | 400 | Teks bantu padat | `text-body-sm` |
| `caption` | 12 px / 16 px | 400 | Metadata, "diperbarui HH.mm", sumbu grafik | `text-caption` |
| `label` | 14 px / 20 px | 500 | Label form, item navigasi, tab | `text-label` |
| `label-sm` | 12 px / 16 px | 500 | Teks chip/badge, kepala kolom tabel | `text-label-sm` |
| `button-lg` | 16 px / 24 px | 600 | Tombol 48/56 px | `text-button-lg` |
| `button` | 14 px / 20 px | 600 | Tombol 36/44 px | `text-button` |
| `num-xl` | 28 px / 36 px | 700 | Angka KPI kartu | `text-num-xl` |
| `num-lg` | 20 px / 28 px | 600 | Subtotal/nilai penting di panel | `text-num-lg` |
| `num-md` | 16 px / 24 px | 600 | Harga/subtotal baris keranjang | `text-num-md` |
| `num-sm` | 14 px / 20 px | 500 | Angka sel tabel | `text-num-sm` |
| `mono` | 13 px / 18 px | 400 | Nomor invoice, kode, pratinjau struk | `font-mono text-body-sm` |
| `code-id` | 20 px / 28 px | 600 | **Kode galat dan ID referensi** (CMP-36): `font-mono`, `tabular-nums`, jarak huruf `0.04em`, tidak pernah dipotong/dibungkus di tengah kelompok | `font-mono text-code-id` |

Bobot: 400 (regular), 500 (medium), 600 (semibold), 700 (bold) → `font-normal/medium/semibold/bold`. Jarak huruf: normal; hanya `label-sm` huruf kapital (jika dipakai) `0.02em`. Skala responsif `h1`: 20 px (< md), 24 px (≥ md) — satu-satunya token berukuran responsif; sisanya tetap.

Estimasi dari gambar: judul halaman ≈ 22–24 px, judul kartu ≈ 16 px, nav ≈ 14 px, kaption ≈ 11–12 px. Semua `ESTIMASI DARI GAMBAR` karena skala gambar tidak diketahui pasti (asumsi skala: lihat Lampiran A).

#### 2.2.3 Aturan Angka

| Aturan | Nilai |
|---|---|
| `font-variant-numeric` | **`tabular-nums` wajib** pada: harga, kuantitas, subtotal, total, kembalian, nominal bayar, nomor invoice/nota kredit, kolom angka tabel, KPI, numpad. Tailwind: `tabular-nums` |
| Rata | Kolom angka **rata kanan**; angka bernilai uang diawali `Rp` tanpa spasi (`Rp112.476`, BR-I18N-006) |
| Negatif | Tanda minus Unicode `−` (U+2212), bukan tanda hubung; di grafik/tabel selisih disertai warna + ikon (DP-04) |
| Kuantitas pecahan | Tampil sesuai locale dengan hasil urai ditampilkan sebelum konfirmasi (BR-I18N-006: "1.500 pcs" / "1.5 pcs") |
| Nomor invoice | `font-mono`, tidak dipotong; boleh `break-all` di HP (contoh `OUT01-POS02-1126-000123`) |
| Nol bergaris | Opsional (`zero`) untuk nomor/kode agar tidak tertukar dengan huruf O; hanya bila font mendukung |

#### 2.2.4 Penanganan Teks Panjang

| Konteks | Perilaku |
|---|---|
| Nama produk di grid | Maks. 2 baris lalu elipsis (`line-clamp-2`); nama lengkap di detail |
| Nama item di baris keranjang | Maks. 2 baris; modifier/catatan di baris kedua kecil (`body-sm`, `ink-soft`) |
| Label tombol | Satu baris; tombol **tumbuh melebar** mengikuti isi (tidak lebar tetap); di HP boleh ikon + teks pendek |
| Teks i18n | Rancang ruang ±40% lebih panjang (id ↔ en); jangan potong label status; gunakan `min-w` bukan `w` |
| Tabel | Kolom teks `truncate` + tooltip/ekspansi baris; kolom angka tidak pernah dipotong |

### 2.3 Spasi, Ukuran Kontrol, dan Target Sentuh

#### 2.3.1 Skala Spasi

Basis **4 px** (default Tailwind: `--spacing: 0.25rem`; utilitas `p-1 = 4 px`). Hanya nilai skala ini yang dipakai.

| Langkah | px | Tailwind | Peran umum |
|---|---|---|---|
| 0.5 | 2 | `p-0.5` | Celah ikon-teks sangat rapat (hindari) |
| 1 | 4 | `p-1` | Jarak internal chip vertikal, celah item nav |
| 2 | 8 | `p-2` | **Jarak minimum antar target sentuh**, celah dalam grup tombol |
| 3 | 12 | `p-3` | Celah grid produk (`/pos`), padding internal input kecil |
| 4 | 16 | `p-4` | Padding kartu `/pos`, gutter HP, celah grid kartu |
| 5 | 20 | `p-5` | Padding kartu `/admin`, gutter tablet |
| 6 | 24 | `p-6` | Gutter desktop, celah antar bagian |
| 8 | 32 | `p-8` | Jarak antar bagian besar |
| 10 | 40 | `p-10` | Padding modal besar |
| 12 | 48 | `p-12` | Area kosong (empty state) |
| 16 | 64 | `p-16` | — |

**Token spasi peran (`ESTIMASI DARI GAMBAR` untuk padding kartu ≈ 16 px dan celah kartu ≈ 16 px; asumsi skala di Lampiran A):**

| Token | HP (< 640) | Tablet (640–1023) | Desktop (≥ 1024) | Tailwind |
|---|---|---|---|---|
| `gutter` (tepi halaman) | 16 | 20 | 24 | `px-4 sm:px-5 lg:px-6` |
| `card-pad` | 16 | 16 (`/pos`) / 20 (`/admin`) | 16 (`/pos`) / 20 (`/admin`) | `p-4` / `p-5` |
| `grid-gap` (kartu) | 12 | 16 | 16 | `gap-3 sm:gap-4` |
| `stack-gap` (isi kartu) | 12 | 12 | 16 | `space-y-3 lg:space-y-4` |
| `section-gap` | 24 | 24 | 32 | `space-y-6 lg:space-y-8` |

#### 2.3.2 Ukuran Kontrol dan Target Sentuh

Standar: WCAG 2.5.5 (44 × 44 CSS px). **Minimum mutlak 44 px** untuk semua kontrol sentuh; **default `/pos` 48 px**; aksi utama kasir 56 px.

| Token tinggi | px | Dipakai untuk | Boleh di `/pos`? | Tailwind |
|---|---|---|---|---|
| `control-sm` | 36 | Tombol/input/tab/select di `/admin` **hanya saat `pointer: fine`** (mouse); chip filter di tabel | **Tidak** (kecuali perangkat `pointer: fine` di Windows dan pengaturan "mode padat" aktif, `DOQ-05`) | `h-control-sm` |
| `control-md` | 44 | **Minimum sentuh**: ikon tombol, item nav, baris daftar, checkbox area | Ya (minimum) | `h-control-md` |
| `control-lg` | 48 | **Default `/pos`**: tombol, input, select, tab, kartu produk (tinggi minimum) | Ya (default) | `h-control-lg` |
| `control-xl` | 56 | **Aksi utama**: "Bayar", "Selesai", "Buka shift", "Tutup shift", tombol nominal cepat | Ya | `h-control-xl` |
| `key` | 64 (≥ md) / 56 (< md) | Tombol numpad | Ya | `size-key` |

**Tinggi elemen non-interaktif (bukan target sentuh):** `chip-md` 28 px (chip status standar, mengikuti referensi ±25–28 px gambar), `chip-sm` 24 px (padat di tabel). Padanan Tailwind: `h-chip-md`, `h-chip-sm` (`--spacing-chip-md: 1.75rem`, `--spacing-chip-sm: 1.5rem`). Chip yang dapat diketuk (filter) memakai `control-md`/`control-sm` sesuai konteks (CMP-08).

Aturan:
1. Area sentuh minimum 44 × 44 px **termasuk padding tak terlihat** (ikon 20 px dengan area 44 px).
2. Jarak antar dua target sentuh **≥ 8 px**; jarak antar target destruktif dan non-destruktif **≥ 12 px**.
3. Di `/admin`, variabel kerapatan: `pointer: coarse` (sentuh) otomatis memakai `control-md`; `pointer: fine` memakai `control-sm` (Tailwind: varian `pointer-coarse:` / media query `(pointer: coarse)`).
4. Tinggi baris tabel `/admin`: 44 px (nyaman) atau 36 px (padat, hanya `pointer: fine`). Baris daftar `/pos`: **56 px** minimum (nama + harga).

### 2.4 Radius, Border, Bayangan, Opasitas

#### 2.4.1 Radius — `ESTIMASI DARI GAMBAR` (skala: Lampiran A)

| Token | px | Dipakai untuk | Tailwind |
|---|---|---|---|
| `radius-xs` | 4 | Segmen progress, checkbox | `rounded-xs` |
| `radius-sm` | 6 | Chip/badge kecil, tag | `rounded-sm` |
| `radius-md` | 8 | Chip status (ref ≈ 6–8), tooltip | `rounded-md` |
| **`radius-control`** | **10** | **Tombol, input, select, tab pill, segmented control** (ref ≈ 8–10; tab **bukan** kapsul penuh) | `rounded-control` |
| `radius-lg` | 12 | Item navigasi aktif (pill sidebar), kartu produk, kartu bersarang | `rounded-lg` |
| **`radius-card`** | **16** | **Kartu utama** (ref ≈ 14 px gambar ≈ 16 px) | `rounded-card` |
| `radius-modal` | 20 | Modal/dialog, bottom sheet (sudut atas), popover besar | `rounded-modal` |
| `radius-full` | 9999 | Avatar, titik status, lencana angka, switch | `rounded-full` |

#### 2.4.2 Border

| Token | Nilai | Penggunaan |
|---|---|---|
| `border-hairline` | 1 px, warna `line` (kartu) / `line-subtle` (pemisah dalam kartu) | Kartu, pemisah baris |
| `border-default` | 1 px, warna `line` / `line-strong` / `line-input` sesuai peran §2.1.3 | Header, sidebar, tombol sekunder, kontrol |
| `border-emphasis` | 2 px | Item terpilih, status meja, fokus (ring), kartu aktif |
| Gaya `dashed` | 2 px putus-putus | `table_locked_other`, `table_orphan`, area drop/impor |

Tailwind: `border` (1 px), `border-2` (2 px), `border-dashed`.

#### 2.4.3 Bayangan/Elevasi

Referensi memakai bayangan **sangat lembut** (hampir tak terlihat) + border tipis. Di POS dengan cahaya terang, **batas dibuat oleh border**, bayangan hanya bonus. Warna bayangan = `neutral-900` (`27,29,33`).

| Token | Nilai CSS | Penggunaan | Tailwind |
|---|---|---|---|
| `shadow-none` | `none` | Default `/pos` kartu bersarang | `shadow-none` |
| `shadow-card` | `0 1px 2px rgb(27 29 33 / 0.04), 0 2px 8px rgb(27 29 33 / 0.04)` | Kartu (`ESTIMASI DARI GAMBAR`: sangat lembut) | `shadow-card` |
| `shadow-pill` | `0 1px 3px rgb(27 29 33 / 0.08)` | Item nav aktif (pill putih), tab terpilih pada segmented control | `shadow-pill` |
| `shadow-popover` | `0 8px 24px rgb(27 29 33 / 0.12)` | Dropdown, combobox, tooltip besar | `shadow-popover` |
| `shadow-modal` | `0 16px 48px rgb(27 29 33 / 0.20)` | Modal, bottom sheet, dialog PIN | `shadow-modal` |

#### 2.4.4 Opasitas

| Token | Nilai | Penggunaan |
|---|---|---|
| `opacity-scrim` | 50% (`neutral-950`) | Latar belakang modal (token `scrim`) |
| `opacity-hover-tint` | 4% (`neutral-900`) | Hover pada baris/ikon tombol transparan |
| `opacity-pressed-tint` | 8% (`neutral-900`) | Pressed pada elemen transparan |
| `opacity-skeleton` | 100% (warna `surface-sunken`, animasi pulse) | Skeleton |

**Dilarang** memakai opasitas untuk menandai nonaktif pada teks/tombol (pakai `ink-disabled` + `surface-sunken`, §2.1.3).

### 2.5 Z-index

| Token | Nilai | Lapisan |
|---|---|---|
| `z-base` | 0 | Konten |
| `z-sticky` | 10 | Header tabel lengket, panel total lengket |
| `z-nav` | 20 | Sidebar, bottom navigation |
| `z-header` | 30 | Header/top bar |
| `z-banner` | 35 | Banner offline/pending/update (di bawah header, di atas konten) |
| `z-dropdown` | 40 | Dropdown, combobox, popover |
| `z-modal-backdrop` | 50 | Scrim |
| `z-modal` | 60 | Dialog, bottom sheet |
| `z-toast` | 70 | Toast/snackbar |
| `z-pin` | 80 | Dialog PIN supervisor (di atas modal pemanggil) |
| `z-system` | 90 | Layar sistem penuh: perangkat terkunci, update wajib, instance ganda |

Tailwind: `z-sticky`, `z-nav`, … (`--z-index-*` tidak standar di Tailwind; implementasi memakai utilitas arbitrer terdefinisi dari token yang sama; Bab 8).

### 2.6 Animasi

| Token | Nilai | Penggunaan |
|---|---|---|
| `duration-instant` | 0 ms | Umpan balik sukses checkout (tidak boleh menahan alur) |
| `duration-fast` | 100 ms | Hover, press, perubahan warna |
| `duration-base` | 160 ms | Tab, chip, toggle, fade-in toast |
| `duration-slow` | 240 ms | Dropdown, popover |
| `duration-sheet` | 280 ms | Bottom sheet, drawer, modal |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Umum |
| `ease-decelerate` | `cubic-bezier(0, 0, 0.2, 1)` | Elemen masuk |
| `ease-accelerate` | `cubic-bezier(0.4, 0, 1, 1)` | Elemen keluar |

Aturan:
1. **Tidak ada animasi yang menunda alur kasir.** Setelah transaksi tersimpan (NFR-PERF-001) layar sukses muncul seketika; transisi dekoratif ≤ 160 ms dan tidak memblokir input.
2. **`prefers-reduced-motion: reduce`**: semua transisi jadi `0.01 ms`/dihapus; spinner diganti ikon statis + teks "Menyinkronkan…"; skeleton tidak berdenyut (warna statis); tidak ada gerak parallax/slide besar.
3. Satu-satunya animasi tak bergantung pengguna: indikator "syncing" berputar (diganti statis bila reduced-motion). Tidak ada animasi berkedip (flashing) > 3 kali/detik.
4. Tailwind: `duration-fast`, `ease-standard`, `motion-reduce:transition-none`.

### 2.7 Ikonografi

| Atribut | Nilai |
|---|---|
| Set ikon | **Lucide** (lisensi ISC, outline, konsisten dengan ikon garis tipis di referensi) — `DITETAPKAN`; pustaka final `PERLU KONFIRMASI` (DOQ-11) |
| Cara muat | Impor **per ikon** (tree-shaking) atau sprite SVG lokal; di-precache; **tidak** memakai CDN ikon eksternal (DP-12) |
| Gaya | Outline, `stroke-width` 1,75 (referensi tampak tipis ±1,5), sudut membulat, warna `currentColor` |
| Ukuran | `icon-sm` 16 (inline teks, chip), **`icon-md` 20 (tombol, nav, input — default)**, `icon-lg` 24 (tombol ikon sentuh, header), `icon-xl` 32 (empty state kecil), `icon-2xl` 48 (empty state/ilustrasi) |
| Tailwind | `size-4`, `size-5`, `size-6`, `size-8`, `size-12`; warna via `text-*` |
| Ikon + teks | Ikon dekoratif `aria-hidden`; ikon tunggal wajib `aria-label` (§7) |
| Ikon tombol sentuh | Ikon 20–24 px di dalam area 44–48 px (§2.3.2) |
| Ikon nav (sidebar) | 20 px, garis `ink-soft`; aktif `ink-brand` + bar penanda |

Ikon yang dipakai (nama Lucide; agar konsisten): beranda `house`, produk `package`, kategori `layers`, harga `tag`, stok `boxes`, laporan `chart-column`, pengguna `users`, perangkat `tablet-smartphone`, outlet `store`, pengaturan `settings`, cari `search`, scan `scan-barcode`, keranjang `shopping-cart`, bayar `banknote`, kartu `credit-card`, QRIS `qr-code`, transfer `landmark`, diskon `percent`, catatan `message-square-text`, hapus `trash-2`, tambah `plus`, kurang `minus`, tutup `x`, cetak `printer`, laci `archive`, waktu `clock`, meja `layout-grid`, bill `receipt-text`, split `split`, gabung `merge`, retur `undo-2`, PIN `key-round`, bahasa `languages`, notifikasi `bell`, profil `circle-user`, lainnya `ellipsis-vertical`.

### 2.8 Grid, Breakpoint, dan Dimensi Layout

#### 2.8.1 Breakpoint

Memakai default Tailwind (tidak diubah), dipetakan ke kelas perangkat PRD (HP/tablet/desktop, Android & Windows; NFR-COMP-002):

| Token | Lebar min | Kelas perangkat | Orientasi umum | Pola navigasi |
|---|---|---|---|---|
| (default) | 0 | **HP portrait** | portrait | Bottom navigation + drawer |
| `sm` | 640 | **HP landscape / HP besar** | landscape | Bottom nav (HP landscape tetap bottom nav; tinggi 64 px) |
| `md` | 768 | **Tablet portrait** | portrait | Rail ikon 72 px (+ drawer label) |
| `lg` | 1024 | **Tablet landscape / laptop kecil** | landscape | Sidebar 240 px (`/admin`), rail 72 px (`/pos`) |
| `xl` | 1280 | **Desktop (PC/laptop Windows)** | landscape | Sidebar 240 px penuh |
| `2xl` | 1536 | Desktop lebar | landscape | Konten dibatasi lebar maks. |

Varian orientasi: `portrait:` / `landscape:` (media `(orientation: …)`) dipakai khusus untuk layar kasir tablet (Bab 4). Rancangan awal harus lolos pada: **360×800** (HP), **412×915** (HP besar), **800×1280** (tablet portrait), **1280×800** (tablet landscape), **1366×768** dan **1920×1080** (Windows). Zoom 200% harus tetap layak (§7).

#### 2.8.2 Dimensi Layout (`ESTIMASI DARI GAMBAR` untuk sidebar dan header)

| Token | Nilai | Catatan | Tailwind |
|---|---|---|---|
| `sidebar-w` | 240 px | Referensi: ±213 px gambar ≈ 240 px (Lampiran A) | `w-sidebar` |
| `rail-w` | 72 px | Sidebar ringkas (ikon + label di bawah ikon, ≥ md `/pos`) | `w-rail` |
| `header-h` | 64 px (≥ md) / 56 px (< md) | Referensi: tinggi header ±59 px gambar ≈ 64–66 px | `h-header` |
| `topbar-pos-h` | 56 px | Top bar `/pos` (status koneksi, shift, kasir, bahasa) | `h-topbar` |
| `bottomnav-h` | 64 px + `env(safe-area-inset-bottom)` | HP | `h-bottomnav` |
| `cart-panel-w` | 400 px (`lg`) / 440 px (`xl`) | Panel keranjang tablet landscape/desktop | `w-cart` |
| `content-max` | 1440 px | Lebar maks. konten `/admin` (≥ 2xl dipusatkan) | `max-w-content` |
| `form-max` | 720 px | Form tunggal | `max-w-form` |
| `dialog-w` | sm 400 · md 520 · lg 720 · xl 960 | Lebar modal; di HP selalu **bottom sheet/penuh** | `max-w-dialog-md` |

**Grid kolom:** HP 4 kolom (gutter 16), tablet 8 kolom (gutter 16–20), desktop 12 kolom (gutter 24). Kartu dashboard `/admin` mengikuti pola referensi: 3 kartu per baris ≥ `lg` (≥ 1024), 2 per baris `md`, 1 per baris < `md`.

### 2.9 Mode Gelap — keputusan user: pasca-MVP (DOQ-03)

**Rekomendasi:** **tidak masuk MVP**; token sudah dirancang berlapis sehingga dark mode dapat ditambah tanpa mengubah komponen. Alasan: referensi hanya mode terang; scope MVP sudah XL (RSK-01); POS outlet umumnya terang; pengujian kontras dua mode melipatgandakan QA. **Opsi:** (A) tidak ada (rekomendasi); (B) otomatis mengikuti `prefers-color-scheme` pasca-MVP; (C) pilihan manual per pengguna (disimpan di profil, ikut tersinkron seperti bahasa, BR-I18N-002). Dampak bila masuk MVP: +token, +pengujian kontras, +risiko regresi visual pada setiap komponen.

Pemetaan token peran (mode gelap) bila diaktifkan nanti — nilai **sudah dihitung kontrasnya**:

| Token peran | Mode terang | Mode gelap | Kontras gelap (dihitung) |
|---|---|---|---|
| `app` | `neutral-0` `#FFFFFF` | `neutral-950` `#0F1012` | — |
| `surface-hover` | `neutral-50` `#F4F5F6` | `neutral-800` `#2A2D33` | — |
| `surface` | `#FFFFFF` | `neutral-900` `#1B1D21` | — |
| `surface-subtle` / `surface-sunken` | `neutral-25` / `neutral-100` | `neutral-800` `#2A2D33` / `neutral-800` | — |
| `ink` | `#1B1D21` | `neutral-50` `#F4F5F6` | 15,46 pada `surface`; 12,64 pada `neutral-800` |
| `ink-soft` | `#52565F` | `#B9BCC4` | 8,88 |
| `ink-muted` | `#6B7079` | `#9A9EA8` | 6,29 (`surface`); 5,15 (`neutral-800`) |
| `ink-brand` / teks hijau | `primary-700` | `primary-300` `#B4D96C` | 10,51 |
| `action` (tombol) | `primary-700` + teks putih | `primary-500` `#76B617` + teks `neutral-950` | 7,68 |
| `action-hover` | `primary-800` | `primary-400` `#94C73C` (teks `neutral-950`) | 9,51 |
| `focus-ring` | `primary-700` | `primary-400` | 8,43 |
| `line-subtle`/`line` | `#ECEDEF` / `#DEDFE3` | `#2A2D33` / `#3F434B` | dekoratif |
| `line-input` | `#8E929C` | `#80848E` | 4,51 |
| `success-ink` | `#17703D` | `#5FD08A` | 8,74 |
| `warning-ink` | `#8A4A00` | `#FFB454` | 9,57 |
| `danger-ink` | `#B42318` | `#FF8A80` | 7,39 |
| `info-ink` | `#195E9E` | `#6FB0F0` | 7,35 |
| `violet-ink` | `#563AA0` | `#B7A0F5` | 7,52 |
| `teal-ink` | `#0D625C` | `#4FD1C5` | 9,05 |
| `soft` semantik | tint pastel | warna keluarga @ ±16% di atas `surface` | **dihitung ulang saat implementasi** |
| Grafik | `chart-1..5` | naikkan 1–2 langkah luminans; wajib diuji ulang CVD | **belum divalidasi** |

Bayangan di mode gelap dihapus (diganti border `line`); `canvas` tidak dipakai.


---

## 3. Komponen

> Setiap komponen dispesifikasikan dengan: **anatomi**, **varian**, **ukuran**, **state**, **perilaku responsif**, **aksesibilitas**, **token**. State umum didefinisikan sekali di §3.0; tiap komponen hanya mencatat **penyimpangan/tambahan**.

### 3.0 Aturan Umum Seluruh Komponen

#### 3.0.1 Matriks State Umum (kontrol interaktif)

| State | Aturan | Token |
|---|---|---|
| `default` | Sesuai varian | — |
| `hover` | **Hanya** bila `(hover: hover)` (mouse/trackpad). Tidak ada hover pada sentuh. Tombol berisi: `action-hover`; tombol transparan: tint `opacity-hover-tint`; kartu interaktif: border naik satu tingkat (`line` → `line-strong`) | `action-hover`, `opacity-hover-tint` |
| `focus-visible` | Cincin **2 px** `focus-ring` dengan offset **2 px** (warna offset = latar induk). **Tidak pernah dihapus** (`outline: none` tanpa pengganti dilarang). Hanya muncul untuk keyboard/scanner-keyboard (`:focus-visible`) | `ring-2 ring-focus-ring ring-offset-2` |
| `active` (pressed) | Tombol berisi: `action-active`; transparan: tint `opacity-pressed-tint`; **tanpa** skala/animasi besar (≤ 100 ms) | `action-active` |
| `disabled` | `surface-sunken` + `ink-disabled`, tanpa bayangan; `aria-disabled="true"` (tetap dapat difokus bila perlu menampilkan alasan); alasan nonaktif ditampilkan sebagai teks bantu bila bukan jelas (mis. "Pilih metode pembayaran") | `surface-sunken`, `ink-disabled` |
| `loading` | Lebar tombol **tetap**; label diganti "Menyimpan…" (kunci terjemahan) + spinner 20 px; `aria-busy="true"`; klik diabaikan (cegah ganda). **Spinner hanya muncul bila operasi > 150 ms** | `animate-spin` (reduced-motion: statis) |
| `error` | Border kontrol `danger-solid` 2 px, ikon `circle-alert` 16 px, pesan di bawah dengan `danger-ink` (`aria-describedby`); **pesan selalu teks**, bukan hanya warna | `border-danger-solid`, `text-danger-ink` |
| `selected` | Border 2 px `action` + latar `action-soft` + ikon centang bila dalam daftar | `border-action bg-action-soft` |

#### 3.0.2 Ukuran dan Kerapatan Dasar

Tombol/input/tab/select: `control-sm` 36 · `control-md` 44 · `control-lg` 48 · `control-xl` 56 (§2.3.2). `/pos` default `control-lg`; `/admin` default `control-md` (sentuh) / `control-sm` (mouse).

#### 3.0.3 Daftar Komponen

| ID | Komponen | Dipakai di (contoh) |
|---|---|---|
| CMP-01 | Button | semua |
| CMP-02 | Icon button | header, baris keranjang |
| CMP-03 | Input (teks / angka / uang / PIN) | login, bayar, form |
| CMP-04 | Search + scan barcode | SCR-P04, SCR-P06, SCR-P10 |
| CMP-05 | Select / combobox | form, filter |
| CMP-06 | Tab pill | kategori, filter, halaman |
| CMP-07 | Segmented control | persen/nominal, UOM, periode |
| CMP-08 | Chip / badge status | semua |
| CMP-09 | Kartu (Card) | dashboard, `/admin` |
| CMP-10 | Tabel data (`/admin`) | master, laporan |
| CMP-11 | Daftar padat (`/pos`) | riwayat, antrean, pilih staf |
| CMP-12 | Sidebar / rail (desktop-tablet) | `/admin`, `/pos` |
| CMP-13 | Bottom navigation / drawer (HP) | `/admin`, `/pos` |
| CMP-14 | Header / top bar | semua layar |
| CMP-15 | Modal / dialog / bottom sheet | konfirmasi, form cepat |
| CMP-16 | Toast / snackbar | umpan balik singkat |
| CMP-17 | Banner offline & indikator sinkron | top bar, semua halaman |
| CMP-18 | Progress bar | sinkron, KPI, langkah |
| CMP-19 | Empty state | daftar/tabel kosong |
| CMP-20 | Skeleton | `/admin` memuat |
| CMP-21 | Numpad kasir | bayar, kuantitas, PIN |
| CMP-22 | Kartu produk / grid produk | SCR-P04, SCR-P06 |
| CMP-23 | Panel keranjang / bill | SCR-P04, SCR-P06 |
| CMP-24 | Baris item keranjang | CMP-23 |
| CMP-25 | Kartu meja F&B | SCR-P05 |
| CMP-26 | Dialog PIN supervisor | void, diskon, retur |
| CMP-27 | Pratinjau struk | SCR-P09, SCR-P10 |
| CMP-28 | Form (validasi, error) | `/admin`, dialog |
| CMP-29 | Pagination / daftar panjang | tabel, riwayat |
| CMP-30 | Checkbox / radio / switch | form |
| CMP-31 | Pemilih metode bayar + nominal cepat | SCR-P08 |
| CMP-32 | KPI card & kartu grafik | SCR-A02 |
| CMP-33 | Avatar / chip pengguna | header, pilih staf |
| CMP-34 | Tooltip | `/admin` (mouse) |
| CMP-35 | Penanda tenant | login, pairing, header/sidebar, layar kunci, halaman sistem |
| CMP-36 | Blok kode galat (KODE#id + Salin) | galat sistem T3, layar pemulihan, layar sistem |
| CMP-37 | Batas panel galat (error boundary per area) | `/pos`, `/admin` |

---

### CMP-01 Button

| Aspek | Spesifikasi |
|---|---|
| Anatomi | [ikon 20 px opsional] + label (`button`/`button-lg`) + [ikon kanan opsional]; celah ikon-label 8 px; padding-x 12/16/20/24 (sm/md/lg/xl); radius `radius-control` |
| Varian | **primary** (`action`, teks `on-action`) · **secondary** (`surface`, border `line-strong`, teks `ink`; hover `surface-hover`) · **tonal** (`action-soft`, teks `on-action-soft`) · **ghost** (transparan, teks `ink-soft`; hover tint) · **danger** (`danger-solid`, teks putih 5,90) · **danger-outline** (border `danger-solid`, teks `danger-ink`) · **link** (teks `ink-brand`, garis bawah saat hover/fokus) |
| Ukuran | sm 36 · md 44 · lg 48 (default `/pos`) · xl 56 (aksi utama: Bayar, Selesai, Buka/Tutup shift) |
| State | §3.0.1. Disabled primary: `surface-sunken` + `ink-disabled` |
| Responsif | Di footer dialog/bottom sheet HP: **lebar penuh**, ditumpuk vertikal (primer di atas, jarak 8 px). Di tablet/desktop: rata kanan, primer paling kanan. Tombol "Bayar" panel keranjang: lebar penuh panel |
| Aksesibilitas | Elemen `<button type="button">`; tombol ikon-saja wajib `aria-label`; tidak memakai `div` klik. Label menjelaskan hasil ("Bayar Rp112.500", bukan "OK") |
| Aturan bisnis UI | Satu tombol primer per area keputusan. Tombol destruktif tidak pernah berdampingan rapat dengan primer (jarak ≥ 12 px) |

### CMP-02 Icon Button

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Ikon 20 atau 24 px di area **44 × 44** (md) atau **48 × 48** (lg); radius `radius-control` (persegi) atau `radius-full` (avatar/aksi bulat) |
| Varian | ghost (default) · tonal · filled (primary) · danger-ghost |
| Lencana | Titik/angka di pojok kanan atas (pill `radius-full`, min 20 px, `danger-solid`/`warning-solid` + teks putih `label-sm`); angka > 99 → "99+" |
| State | §3.0.1. Toggle: `aria-pressed` + latar `action-soft` bila aktif |
| Aksesibilitas | `aria-label` wajib (kunci terjemahan); tooltip hanya tambahan di mouse |

### CMP-03 Input (Teks / Angka / Uang / PIN)

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Label di atas (`label`, `ink`) · field (`surface`, border 1 px `line-input`, `radius-control`, tinggi 48 `/pos` / 44 / 36) · ikon/prefix kiri · suffix/tombol hapus kanan · teks bantu (`caption`, `ink-muted`) · pesan error (`danger-ink`) |
| Placeholder | `ink-muted` (4,98) — **bukan pengganti label** |
| Fokus | Border 2 px `focus-ring` (tanpa offset tambahan) |
| Error | Border 2 px `danger-solid` + ikon + pesan; `aria-invalid="true"` |
| Disabled/readonly | Disabled: `surface-sunken`; readonly: `surface-subtle` + `ink-soft` dan tetap dapat difokus |
| **Uang** | Prefix `Rp` tetap; `inputmode="numeric"`; angka tabular **rata kanan** `num-lg`; pemisah ribuan otomatis per locale saat mengetik; hanya integer rupiah (BR-MNY-001) |
| **Kuantitas** | `inputmode="decimal"`; menerima pecahan hanya bila `allow_fraction` UOM; **hasil urai ditampilkan sebelum konfirmasi** ("1.500 pcs" / "1.5 pcs") (BR-I18N-006, EC-028); pesan bila tak sah: "Kuantitas 0,35 dus tidak valid untuk satuan pcs" |
| **PIN** | `inputmode="numeric"`, `type="password"`, `autocomplete="off"`, 4–6 digit; ditampilkan sebagai titik; tidak ada "lihat PIN"; tidak disimpan di riwayat/penyimpan sandi (BR-AUT-004); biasanya diisi lewat numpad (CMP-21) |
| Responsif | HP: lebar penuh, label di atas. Tablet/desktop: grid form 2 kolom (CMP-28) |
| Aksesibilitas | `<label for>` selalu; wajib diisi: teks "(wajib)" + `aria-required`; error via `aria-describedby`; jangan menonaktifkan zoom (`font-size ≥ 16 px` pada input HP agar tidak memicu zoom otomatis) |

### CMP-04 Pencarian + Scan Barcode

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Input pencarian (ikon `search` kiri) + tombol **scan** (`scan-barcode`, 44–48 px) kanan + tombol hapus. Tinggi 48 (HP/tablet), 44 (desktop) |
| Scanner USB/Bluetooth (mode keyboard) | Perilaku **global** di `/pos`: rentetan karakter cepat diakhiri Enter = **scan** → lookup lokal (FR-POS-001), tanpa perlu fokus ke input. Fokus dikembalikan ke area kerja setelah scan. Indikator kecil "Scanner siap" (ikon `scan-barcode` + titik hijau) terlihat di atas hasil |
| Scan kamera | Tombol scan membuka overlay kamera (bottom sheet penuh di HP; panel di tablet); tombol "Tutup"; pencahayaan: tombol senter bila didukung (FR-POS-002, P1) |
| Hasil pencarian | ≤ 150 ms (p95; NFR-PERF-003). Muncul sebagai grid produk (CMP-22) yang terfilter, bukan dropdown. Debounce 100 ms. Pencocokan nama/kode/SKU |
| Umpan balik scan | **Sukses**: baris keranjang naik/ditambah, sorotan hijau 400 ms (`primary-100`) + teks sebentar "Kopi Bubuk 200g +1". **Barcode tidak dikenal**: toast `danger` "Barcode tidak dikenal" (FR-POS-001). **Item tidak tersedia di outlet**: toast **berbeda** "{Nama} tidak tersedia di outlet ini" (FR-POS-013, BR-CAT-015). **Harga belum diatur**: toast `warning` "Harga untuk {Nama} belum diatur" (FR-PRC-002). **Tanpa bunyi/getar** (DOQ-10 dijawab user: umpan balik hanya visual) |
| Aksesibilitas | `role="search"`; hasil diumumkan ("12 produk") via `aria-live="polite"`; scan hasil diumumkan |

### CMP-05 Select / Combobox

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Seperti input; ikon `chevron-down` kanan; menu: `surface`, `radius-lg`, `shadow-popover`, maks. tinggi 320 px, opsi tinggi 44/48 |
| Perilaku | Daftar ≤ 7 opsi → select biasa; > 7 atau butuh cari (outlet, produk, pelanggan) → **combobox** dengan filter ketik. HP: menu dibuka sebagai **bottom sheet** |
| Keyboard | Panah naik/turun, Enter memilih, Esc menutup, ketik untuk cari (typeahead), Home/End |
| Opsi terpilih | Ikon centang + `action-soft` |
| Kosong | "Tidak ditemukan" + (bila relevan) aksi "Tambah baru" |
| Aksesibilitas | Pola ARIA combobox (`role="combobox"`, `aria-expanded`, `aria-activedescendant`); native `<select>` dipertahankan di HP bila memadai |

### CMP-06 Tab Pill (pola dari referensi)

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Deretan tab horizontal, celah 8 px; tiap tab: label (`label`) [+ lencana jumlah] |
| Bentuk | `radius-control` (**persegi bulat**, bukan kapsul penuh — sesuai referensi) |
| Tidak aktif | `surface-sunken` + teks `ink` (kontras 14,41) ; hover `neutral-200` |
| **Aktif** | **`action` terisi + teks `on-action`** (5,31) |
| Ukuran | Tinggi **48** (`/pos` default, `control-lg`) atau **44** (minimum, `control-md`); `/admin` sentuh 44, `/admin` mouse (`pointer: fine`) 36 (`control-sm`); padding-x 16 |
| Responsif | Baris **dapat di-scroll horizontal** (tidak membungkus), tepi kanan diberi fade; tab aktif otomatis digulirkan ke tampilan. `/admin` ≥ lg: boleh membungkus bila ≤ 6 tab |
| Aksesibilitas | `role="tablist"`/`tab`/`tabpanel`; `aria-selected`; roving tabindex; panah kiri/kanan berpindah, Home/End; bila tab hanya menyaring daftar, boleh `role="radiogroup"` |
| Pemakaian | Kategori produk, filter denah meja (area), filter laporan; jangan untuk navigasi utama |

### CMP-07 Segmented Control

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Track `surface-sunken`, `radius-control`, padding 4; 2–4 segmen sama lebar; terpilih: `surface` + `shadow-pill` + teks `ink` bobot 600 |
| Ukuran | `/pos` dan `/admin` sentuh: segmen setinggi **44** (`control-md`), track 52 (segmen + padding 4 × 2). `/admin` mouse: segmen 36 (`control-sm`), track 44 |
| Pemakaian | Diskon **Persen / Nominal** (BR-DSC-001), pilih UOM (pcs / dus), periode (Hari / Minggu / Bulan), Tampilan Grafik/Tabel |
| Aksesibilitas | `role="radiogroup"`/`radio`; panah berpindah; label teks selalu ada |

### CMP-08 Chip / Badge Status

| Aspek | Spesifikasi |
|---|---|
| Anatomi | [ikon 16 px] + teks `label-sm`; tinggi **28** (md) / **24** (sm); padding-x 10; `radius-md` (8, sesuai chip referensi ±6–8); celah ikon-teks 4 |
| Non-interaktif (status) | Latar `{family}-soft`, border 1 px `{family}-line`, teks+ikon `{family}-ink`. **Selalu ada ikon dan teks** (DP-04). Pasangan status→keluarga: §2.1.5 |
| "Berjalan/selesai/bermasalah" (referensi) | `warning` / `success` / `danger` (referensi: oranye terisi lembut, hijau outline, merah) |
| Interaktif (filter) | Border 1 px `line-input`, latar `surface`; terpilih: latar `action-soft`, border 2 px `action`, centang di kiri; tinggi 36/44 |
| Lencana angka | Pill `radius-full`, min-width 20, tinggi 20, latar `{family}-solid`, teks putih `label-sm` tabular |
| Titik status | Titik 8 px **hanya** bersama teks di sebelahnya |
| Responsif | Teks tidak dipotong; bila sempit, chip membungkus ke baris baru |
| Aksesibilitas | Status penting diumumkan `role="status"` hanya saat berubah; ikon dekoratif `aria-hidden` |

### CMP-09 Kartu (Card)

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Header (judul `title` + aksi opsional kanan, mis. `ellipsis-vertical` 44 px) · isi · footer opsional (aksi). Kartu bersarang: `radius-lg` (12), border `line-subtle`, **tanpa bayangan** |
| Dasar | `surface`, `radius-card` (16), border 1 px `line`, `shadow-card` (`/admin`) / `shadow-none` (`/pos`), padding `card-pad` |
| Varian | **default** · **interaktif** (seluruh kartu dapat diklik: fokus ring, hover border `line-strong`; elemen `<a>`/`<button>`) · **selected** (border 2 px `action`, `action-soft`) · **hero** (`primary-700` terisi + teks putih, hanya untuk 1 angka kunci per halaman; mengikuti kartu hijau di referensi, tetapi **bukan** `primary-500`) · **status** (latar `{family}-soft` + border `{family}-line`, untuk meja & banner) |
| Responsif | 3 kolom ≥ lg, 2 kolom md, 1 kolom < md; kartu `/pos` tidak bersarang lebih dari 2 tingkat |
| Aksesibilitas | Judul kartu = heading (`h2`/`h3`); kartu interaktif tidak memuat tombol di dalam (hindari interaktif bersarang) |

### CMP-10 Tabel Data (`/admin`)

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Bar alat (pencarian + filter chip + rentang tanggal + aksi massal) · tabel · footer (jumlah baris, pagination CMP-29) |
| Header | `surface-subtle`, `label-sm` `ink-soft`, lengket (`z-sticky`); kolom dapat diurut (ikon `arrow-up-down`, `aria-sort`) |
| Baris | Tinggi 44 (sentuh) / 36 (padat, `pointer: fine`); pemisah `line-subtle`; hover `surface-hover`; terpilih `action-soft`; **tanpa zebra** |
| Sel | Teks `body`; angka `num-sm` rata kanan tabular; status memakai CMP-08; teks panjang `truncate` + tooltip/ekspansi; kolom angka tidak pernah dipotong |
| Aksi baris | Tombol ikon di kolom terakhir (selalu terlihat pada sentuh; pada mouse boleh muncul saat hover **dan** fokus) |
| Baris total | Tebal (`num-sm` 600), garis atas `line-strong` |
| Responsif | `lg`+: tabel penuh dengan scroll horizontal + **kolom pertama lengket**. `< md`: tiap baris berubah menjadi **kartu daftar** (nama + 2–3 field kunci + status + tombol "Detail"); filter dalam bottom sheet |
| State | Memuat: skeleton 8 baris (CMP-20). Kosong: CMP-19. Galat: CMP-19 varian galat + `KODE#id` (FR-LOG-005) |
| Aksesibilitas | `<table>` semantik (`<th scope>`), `caption` tersembunyi visual; urutan fokus logis; keyboard: panah tidak wajib, Tab ke kontrol baris |

### CMP-11 Daftar Padat (`/pos`)

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Baris tinggi minimal **56 px**, padding 12 × 16; kiri: avatar/ikon/thumbnail 40; tengah: judul `title`/`label` + sub `caption` `ink-soft`; kanan: angka `num-md` + chip status + `chevron-right` |
| Pemisah | `line-subtle`; tanpa kartu per baris (hemat ruang) |
| Aksi | Selalu **terlihat** (tombol ikon 44 px) — **tidak bergantung swipe** (swipe boleh sebagai tambahan) |
| Pemakaian | Riwayat transaksi, antrean sinkron, daftar pilih staf, bill di meja, metode bayar terpakai |
| Virtualisasi | Daftar > 100 baris divirtualisasi (45.000 transaksi lokal, NFR-STOR-002); posisi scroll dipulihkan saat kembali |
| Aksesibilitas | `<ul role="list">`; seluruh baris interaktif = `<button>`/`<a>` penuh; fokus terlihat |

### CMP-12 Sidebar / Rail (≥ md)

| Aspek | Spesifikasi |
|---|---|
| Sidebar (`/admin` ≥ lg) | Lebar `sidebar-w` 240; `surface`, border kanan `line`; atas: placeholder logo "Solva POS" (teks `h3`, `DOQ-12`) + pemilih outlet; tengah: daftar nav; bawah: profil pengguna (avatar 40 + nama + peran + menu ⋮) — mengikuti pola referensi |
| Item nav | Tinggi 44 (mouse 40), padding-x 12, `radius-lg`, ikon 20 + label `label`, celah 12; tidak aktif: `ink-soft`; hover: `surface-hover`; **aktif**: `action-soft` + teks/ikon `ink-brand` + **bar penanda kiri 3 px `action`** (tidak hanya warna); lencana hitungan di kanan (mis. "Perlu perhatian" `danger`) |
| Kelompok | Judul kelompok `label-sm` `ink-muted` (Penjualan, Katalog, Stok, Laporan, Pengaturan); jarak antar kelompok 16 |
| Rail (`md`; `/pos` ≥ md) | Lebar 72; item 64 × 64: ikon 24 di atas label `caption` (12, **tidak disembunyikan**); aktif sama dengan sidebar; tooltip tidak diperlukan karena label tampil |
| Perilaku | `/admin` ≥ xl: sidebar terbuka; `lg`: sidebar terbuka dapat diciutkan ke rail; `md`: rail + drawer penuh; `< md`: CMP-13. Pilihan ciut disimpan per pengguna |
| Aksesibilitas | `<nav aria-label>`; `aria-current="page"` pada item aktif; urutan fokus: logo → nav → profil; skip-link "Lewati ke konten" |

### CMP-13 Bottom Navigation / Drawer (HP)

| Aspek | Spesifikasi |
|---|---|
| Bottom nav | Tinggi 64 + safe-area; maks. **5 item termasuk "Lainnya"** (daftar di bawah memakai 4); item min-lebar 64, ikon 24 + label `caption` 12 (selalu tampil); aktif: `ink-brand` + latar `action-soft` pil 56 × 32 di belakang ikon; `z-nav` |
| `/pos` retail | Jual · Riwayat · Shift · Lainnya |
| `/pos` F&B | Meja · Bill · Riwayat · Lainnya (tab "Jual" tidak ada; menu dibuka dari bill). Register `PELAYAN`: **Meja · Bill · Lainnya** (tanpa Riwayat/Shift) |
| `/admin` HP | Beranda · Laporan · Stok · Lainnya |
| "Lainnya" | Membuka **drawer** (kiri, lebar 85% maks. 320, `radius-modal` sisi kanan, scrim, fokus terkunci) berisi seluruh menu sidebar + profil + bahasa |
| Aksesibilitas | `<nav>`; item aktif `aria-current`; drawer `role="dialog"` modal; Esc menutup |

### CMP-14 Header / Top Bar

| Aspek | Spesifikasi |
|---|---|
| `/admin` header | Tinggi `header-h` (64; HP 56); `surface`, border bawah `line`. Kiri: judul halaman `h1` (HP `h2`) + breadcrumb opsional; kanan: bahasa (ikon `languages` + kode `ID`/`EN`), lonceng notifikasi (icon button 44 + lencana `danger` = jumlah "perlu perhatian"), avatar menu (40) — mengikuti referensi (judul kiri; notifikasi + avatar kanan); **isi menu avatar**: **Akun saya** (SCR-A11), Bahasa, **Keluar** (hanya sesi tenant ini; cookie sesi per slug; **tanpa pengalih tenant**, `DOQ-24`). **Konteks tenant:** nama tenant tampil di sidebar (`lg+`, CMP-35 `bar`) atau di drawer dan header HP |
| `/pos` top bar | Tinggi `topbar-pos-h` 56; `surface`. Kiri: **penanda tenant** (CMP-35 `bar`; HP: dua baris — nama tenant `caption` di atas, `OUT01 · POS02` di bawah) + label `OUT01 · POS02` + chip shift (`shift_open`); tengah (≥ md): nama kasir; kanan: **indikator koneksi/sinkron (CMP-17)**, lencana `pending`, **ikon status printer** (`printer` 44 px; keadaan: siap · tidak terhubung `printer`+`x` · ada cetak gagal dengan lencana angka `danger`; ketuk → SCR-P16 bagian printer dan daftar cetak gagal), menu pengguna (bahasa, kunci layar, tes printer, tutup shift). **Tidak ada logo besar** |
| Lengket | `z-header`, selalu terlihat (kecuali layar bayar penuh di HP, tempat top bar diganti tombol "Kembali" + indikator koneksi tetap terlihat) |
| Aksesibilitas | `<header>`; satu `h1` per halaman; menu pengguna pola menu-button ARIA |

### CMP-15 Modal / Dialog / Bottom Sheet

| Aspek | Spesifikasi |
|---|---|
| Dialog (≥ md) | Dipusatkan; `surface`, `radius-modal` 20, `shadow-modal`, padding 24; judul `h2`; isi; footer tombol rata kanan (primer paling kanan); lebar `dialog-w` sm 400 / md 520 / lg 720 / xl 960; maks. tinggi 90dvh, isi dapat di-scroll, header/footer tetap |
| **Bottom sheet (< md)** | Menempel bawah, sudut atas 20, maks. 90dvh; pegangan 36 × 4 (dekoratif, bukan satu-satunya cara menutup); footer lengket dengan tombol lebar penuh + safe-area; keyboard virtual tidak menutupi input aktif (scroll ke input) |
| Jenis | **Konfirmasi** (judul + 1–2 kalimat + 2 tombol); **Form** (CMP-28); **Destruktif** (tombol `danger`, menyebut objek: "Void invoice OUT01-POS02-1126-000123?", wajib alasan bila aturan menuntut); **Pilihan** (varian/UOM/modifier) |
| Penutupan | Esc, tombol "Batal"/"Tutup". Klik scrim menutup **hanya** dialog non-destruktif tanpa input yang belum disimpan. Dialog PIN/kritis: tidak bisa ditutup scrim |
| Fokus | Fokus pindah ke elemen pertama berguna (judul atau input) dan **terkunci** dalam dialog; setelah ditutup kembali ke pemicu |
| Aksesibilitas | `role="dialog"` (`alertdialog` untuk destruktif), `aria-modal="true"`, `aria-labelledby`/`describedby`; latar belakang `inert` |
| Z-index | `z-modal`; PIN `z-pin`; sistem `z-system` |

### CMP-16 Toast / Snackbar

| Aspek | Spesifikasi |
|---|---|
| Posisi | Bawah-tengah. HP: **di atas bottom nav + 8 px**; tablet/desktop: 16 px dari bawah; tidak menutupi tombol "Bayar"/total (digeser ke atas bila perlu) |
| Rupa | `surface-inverse`, teks `ink-inverse`, `radius-lg`, lebar maks. 480, padding 12 × 16; ikon tipe di kiri (sukses `#5FD08A`, info `#6FB0F0`, peringatan `#FFB454`, galat `#FF8A80`; semuanya ≥ 7,35 : 1 di atas `surface-inverse`); aksi teks (mis. "Urungkan", "Cetak ulang") min. 44 px |
| Durasi | Sukses 3 dtk · informasi 5 dtk · peringatan 6 dtk · galat 8 dtk atau sampai ditutup; **hover/fokus menjeda** timer; maks. 3 bertumpuk |
| Perilaku | Tidak dipakai untuk sukses finalisasi penjualan (itu layar SCR-P09). Tidak dipakai untuk hal yang harus dibaca (pakai dialog/banner). Galat yang butuh tindakan → banner/dialog |
| Aksesibilitas | `role="status"` (`aria-live="polite"`); galat `role="alert"`; tidak menghilang bila fokus di dalamnya |

### CMP-17 Banner Offline & Indikator Sinkron

**Bagian A — Indikator ringkas (di top bar semua layar `/pos`; di header `/admin` hanya `online/offline` bila sesi dapat memeriksanya).**

| Aspek | Spesifikasi |
|---|---|
| Isi | Ikon status (§2.1.5) + teks (`online`/`offline`/`Menyinkronkan…`/`Server sibuk — mencoba lagi`/`Perlu perhatian`) + lencana `pending` (angka). Satu elemen yang dapat diketuk (≥ 44 px) membuka **SCR-P14** (antrean sinkron) |
| Responsif | `< sm`: ikon + lencana (teks tersedia via `aria-label` dan muncul di SCR-P14); `≥ sm`: ikon + teks + lencana |
| Pembaruan | Berubah seketika saat event `online/offline`; `syncing` hanya selama operasi > 400 ms (hindari kedip) |
| Waktu sync terakhir | "Tersinkron 14.05" di SCR-P14 dan tooltip/aria; tidak di top bar |

**Bagian B — Banner (di bawah header, `z-banner`, non-blokir).**

| Banner | Keluarga | Teks contoh (`id-ID`) | Aksi | Dapat ditutup? | Rujukan |
|---|---|---|---|---|---|
| Offline | warning | "Offline. Penjualan tetap tersimpan di perangkat ini." | — | Tidak (selama offline) | G-01 |
| Pending | warning | "Ada 3 transaksi belum terkirim sejak 2 jam." | **Ekspor**, **Lihat** | **Tidak** (permanen selama ada pending) | BR-SYN-051/052 |
| Offline + pending | warning | Digabung: "Offline — Ada 3 transaksi belum terkirim sejak 2 jam." | Ekspor, Lihat | Tidak | — |
| Lease hampir habis | warning | "Sambungkan ke internet dalam 18 jam agar perangkat tidak terkunci." | Lihat | Tidak | BR-AUT-008 |
| Pembaruan tersedia | info | "Pembaruan tersedia." | **Muat ulang**, Nanti | Banner tidak; dialog "Nanti" 2 jam | BR-SYN-003 |
| Pembaruan wajib | warning (solid) | "Pembaruan wajib. Shift baru tidak dapat dibuka sebelum diperbarui." | Perbarui | Tidak | BR-SYN-003 |
| Jam perangkat salah | warning | "Jam perangkat berbeda lebih dari 10 menit dari server." | Detail | Tidak | BR-TIM-006 |
| Cetak gagal | danger | "Struk {nomor} belum tercetak." / "{n} struk belum tercetak." | **Cetak ulang** (jamak: **Cetak ulang semua**), Tutup | **Ya** (Tutup; job tetap `FAILED` dan dapat dicetak ulang dari Riwayat) | AP-10, EC-019, BR-PRN-002 |

| Aspek | Spesifikasi |
|---|---|
| Rupa | Tinggi min. 44, padding 8 × 16; latar `{family}-soft`, border bawah `{family}-line`; ikon 20 + teks `body`/`body-lg` `{family}-ink`; tombol aksi kecil `button` (tonal) di kanan |
| Prioritas/tumpukan | Maks. **2** banner terlihat; urutan: pembaruan wajib > lease hampir habis > offline+pending > **cetak gagal** > pembaruan tersedia > jam salah. Sisanya diringkas "+N lagi" yang membuka SCR-P14 |
| Perilaku | Tampil di **semua halaman** termasuk layar kasir dan bayar (BR-SYN-003 butir 2); **tidak memotong** input/numpad; tidak menutup tombol "Bayar" |
| Aksesibilitas | `role="status"`; perubahan penting (online ↔ offline) diumumkan `aria-live="polite"`; bukan `alert` (tidak menginterupsi kasir) |

### CMP-18 Progress Bar

| Aspek | Spesifikasi |
|---|---|
| Linear (kontinu) | Track `surface-sunken` tinggi 8, `radius-full`; isi `primary-600`; teks "x%" atau "x dari N" di samping (`num-sm`) |
| **Bersegmen** (pola referensi) | Segmen 4 × 14 px, celah 2, radius 2; isi `primary-600`, kosong `surface-sunken`; hanya untuk progres **diskrit** (mis. 3/10 langkah, 24/40 item opname) dengan teks "x/N" |
| Dua bagian | Pola referensi "Sleep": isi `primary-600` + sisa `neutral-700` (mis. rasio tunai vs non-tunai) dengan legenda dan angka |
| Indeterminate | Hanya untuk sinkron/unduh; reduced-motion: bar statis separuh + teks |
| Aksesibilitas | `role="progressbar"` + `aria-valuenow/min/max` atau `aria-busy`; teks angka selalu ada |

### CMP-19 Empty State

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Ikon `icon-2xl` (48) `ink-muted` dalam lingkaran 96 `surface-sunken` · judul `h3` · deskripsi `body` `ink-soft` (maks. 2 kalimat) · aksi primer (opsional) + sekunder |
| Varian | `kosong` ("Belum ada produk" + "Tambah produk") · `pencarian-kosong` ("Tidak ada hasil untuk 'kopi'" + "Hapus filter") · `galat` (+ kode `KODE#id`, tombol "Coba lagi") · `butuh-online` ("Fitur ini membutuhkan internet" — mis. retur invoice register lain, BR-RTR-004) · `tanpa-akses` · `keranjang-kosong` |
| Penempatan | Di tengah kartu/area; di tabel menggantikan isi, header tetap |
| Aksesibilitas | Judul heading; tidak memakai gambar bermakna tanpa teks |

### CMP-20 Skeleton

| Aspek | Spesifikasi |
|---|---|
| Rupa | Blok `surface-sunken` berradius sama dengan elemen aslinya; pulse 1,2 dtk (`motion-safe` saja) |
| Aturan | **Muncul hanya setelah 150 ms** (hindari kedip). `/admin`: wajib saat tabel/kartu memuat. **`/pos`: jangan dipakai untuk data lokal** (Dexie ≤ 50–150 ms); gunakan skeleton hanya untuk riwayat besar/unduhan dari server (retur online) |
| Aksesibilitas | Wadah `aria-busy="true"`; teks sembunyi "Memuat…" untuk pembaca layar |

### CMP-21 Numpad Kasir

| Aspek | Spesifikasi |
|---|---|
| Tata letak | Grid 3 kolom × 4 baris: `7 8 9 / 4 5 6 / 1 2 3 / [000 \| , \| .] 0 ⌫` + kolom kanan opsional: **OK/Terapkan** (tinggi 2 baris, `action`, `control-xl`) |
| Ukuran | Tombol **64 px** (≥ md) / **56 px** (< md); celah 8; `radius-control`; `surface`, border `line-strong`, teks `num-lg` tabular |
| Varian | **uang**: tombol `000`; **kuantitas**: tombol pemisah desimal **milik locale aktif** (`,` untuk `id-ID`, `.` untuk `en-US`) dan hanya aktif bila `allow_fraction`; **PIN**: tanpa `000`/desimal, menampilkan titik; ⌫ tahan lama = hapus semua |
| Umpan balik | Pressed: `surface-sunken` 100 ms; tanpa getar/bunyi (DOQ-10) |
| Keyboard fisik | Di Windows: angka 0–9, `Backspace`, `Enter` = OK, `Esc` = batal bekerja sama dengan numpad layar. Scanner tidak boleh menyusup ke input numpad (barcode bursts diabaikan saat numpad fokus) |
| Nominal cepat (uang) | Baris tombol di atas numpad (48–56 px): **"Uang pas"** + 2–3 saran kelipatan terdekat di atas total (mis. Rp50.000, Rp100.000) — hanya UI, tidak menyimpan apa pun; dihitung dari total yang tampil |
| Aksesibilitas | Tombol = `<button>` dengan `aria-label` ("Tujuh", "Hapus satu digit", "Tiga nol"); nilai berjalan di wilayah `aria-live="polite"` |

### CMP-22 Kartu Produk / Grid Produk

| Aspek | Spesifikasi |
|---|---|
| Anatomi | `surface`, border `line`, `radius-lg` (12); **tanpa gambar produk** (skema/PRD belum memiliki bidang gambar; `DOQ-13`) · nama (`label` 14/20, maks. 2 baris) · harga (`num-md`) · UOM (chip kecil `pcs`/`dus`) · penanda: stok estimasi ≤ 0 (`stock_estimate_low`), harga bebas (`open_price`), varian (ikon `layers` + "3 varian"). Pembeda visual antar kartu: **inisial/ikon kategori** pada pojok kiri atas (lingkaran 32 `primary-100` + inisial `primary-800`) |
| Ukuran | Tinggi min. **96**; area sentuh seluruh kartu (≥ 48) |
| Grid | `repeat(auto-fill, minmax(140px, 1fr))`; hasil: HP 2 kolom, `sm` 3, `md` 3–4 (tergantung panel), `lg` 4, `xl` 5; celah 12 |
| Aksi | Ketuk = tambah **1** pada UOM default; produk bervarian/ber-modifier wajib → **bottom sheet/dialog pilihan** (atribut sebagai chip interaktif); produk **open price** → dialog numpad uang "Harga satuan" (FR-POS-016); UOM lain via tombol ⋮ kecil (44) atau dari baris keranjang |
| State | `hover` (mouse), `pressed`, `focus`; **harga belum diatur**: kartu `surface-sunken`, label "Harga belum diatur", tidak dapat ditambahkan (FR-PRC-002); **item tidak tersedia di outlet: tidak ditampilkan** (FR-POS-012) |
| Daftar produk | Retail: baris kategori (CMP-06) + CMP-04 di atas grid. F&B: menu per kategori; item dengan modifier wajib menampilkan "Pilih opsi" |
| Virtualisasi | Grid divirtualisasi (≤ 5.000 SKU) |
| Aksesibilitas | Setiap kartu `<button>` dengan nama aksesibel "{nama}, {harga}"; penanda bermakna memiliki teks |

### CMP-23 Panel Keranjang / Bill

| Aspek | Spesifikasi |
|---|---|
| Anatomi | **Header** ("Keranjang"/"Bill M05-0003", jumlah item, tombol "Kosongkan"/menu ⋮) → **chip pelanggan** opsional (FR-POS-008) → **daftar baris** (CMP-24; scroll) → **ringkasan lengket** → **aksi** |
| Ringkasan | Baris: Subtotal · Diskon (bila ada; teks `ink` dengan tanda −, bukan warna khusus) · Service charge (F&B) · Pajak (label **inklusif/eksklusif** + tarif) · Pembulatan · **TOTAL** (`total-lg` / `total-xl`). **UI hanya menampilkan angka dari package hitung bersama** (AP-06, BR-TAX-006); tidak menghitung uang sendiri |
| Aksi | Tombol sekunder: "Diskon", "Pelanggan", "Catatan" (ikon + teks); **tombol primer "Bayar Rp112.500"** `control-xl` lebar penuh panel |
| Tablet landscape/desktop | Panel kanan tetap `cart-panel-w` (400/440), tinggi penuh, ringkasan dan tombol Bayar menempel bawah |
| Tablet portrait | Panel keranjang berada di **bagian bawah** layar (±40% tinggi, dapat ditarik naik ke 85%); header panel = **bilah total lengket** (jumlah item + total + tombol "Bayar") yang selalu terlihat saat panel diciutkan. Alasan: lebar 768–834 px tidak cukup untuk grid produk + panel samping 360–400 px |
| HP | Keranjang = **bottom sheet** yang dibuka dari **bilah total lengket** ("3 item · Rp112.500 · Lihat keranjang") tepat di atas bottom nav; tombol "Bayar" ada di bilah dan di sheet |
| Kosong | Empty state `keranjang-kosong`: "Keranjang kosong. Scan barcode atau pilih produk." |
| F&B tambahan | Bill menampilkan `bill_ref`, meja, tombol **Pra-bill**, **Pisah**, **Gabung**, **Pindah meja** (bila ada), **Serahkan ke kasir** (hanya register `PELAYAN`; SCR-P06), lencana kepemilikan (`lease_other` → panel **read-only**: semua aksi ubah dinonaktifkan dengan banner "Dipegang device lain — hanya lihat. Diperbarui 14.05") |
| Aksesibilitas | Panel = `<aside aria-label="Keranjang">`; total di `aria-live="polite"` (diumumkan saat berubah, dibatasi) |

### CMP-24 Baris Item Keranjang

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Tinggi min. **72**. Kiri: **stepper kuantitas** (`−` 44, angka `num-md` ketuk = buka numpad kuantitas, `+` 44). Tengah: nama (`title`, maks. 2 baris); baris kedua: **chip UOM** (pcs ▾; ketuk → ganti UOM, BR-UOM), **modifier** (teks `body-sm` `ink-soft`), **chip diskon** (`−10%`; netral `surface-sunken` + ikon `percent`), **penanda harga bebas**, **peringatan stok** bila relevan. Kanan: **total baris** `num-md` + "2 × Rp18.500" (`caption`, `ink-muted`) |
| Aksi | Ketuk baris = **sheet edit** (kuantitas, UOM, diskon item persen/nominal, catatan). Tombol hapus (ikon `trash-2`, 44, ghost) di sheet atau di baris pada lebar ≥ md |
| Hapus (retail) | Seketika + toast **"Urungkan"** (5 dtk) — tanpa dialog (DP-01) |
| Void item pada open bill (F&B) | Dialog **alasan wajib**, **tanpa PIN** (BR-AUT-009 catatan; BR-FNB-005) → event `ITEM_VOIDED`; baris yang di-void tampil dicoret dengan alasan dalam daftar "Item di-void" yang dapat dilipat (jejak tetap terlihat) |
| Diskon > batas role | Membuka CMP-26 (PIN supervisor) sebelum diterapkan (BR-AUT-006) |
| Baris disalin dari merge | Item sejenis sudah digabung (BR-SPL-022); chip kecil `merge` + "dari M06-0001" (opsional) |
| Aksesibilitas | Stepper = grup dengan `aria-label` "Kuantitas {nama}"; tombol `−/+` berlabel; perubahan diumumkan |

### CMP-25 Kartu Meja F&B

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Kode meja (`title` 700) · area (`caption`) · kapasitas (`users` + angka) · **status** (ikon + teks `label-sm`) · bila ada bill: `bill_ref` + total ringkas (`num-sm`) · lencana `N bill` · bila `table_locked_other`: "diperbarui 14.05" |
| Rupa per status | §2.1.6 (latar, garis, ikon, teks) |
| Ukuran | Min. 140 × 112; grid `auto-fill minmax(140px, 1fr)`; HP 2 kolom |
| Interaksi | Ketuk: `table_free` → buka bill baru (pilihan jumlah tamu opsional); `table_occupied` → buka bill (bila > 1 bill: daftar pilih bill); `table_locked_other` → buka **tampilan read-only**; `table_orphan` (manager) → detail bill yatim |
| Pengelompokan | Per **area** (tab pill CMP-06: Semua · Indoor · Teras …) + filter status (chip) + pencarian kode meja |
| Denah | MVP = **kisi per area** (master meja hanya kode/area/kapasitas, BR-FNB-001). Denah posisi bebas/seret-letak belum ada (`DOQ-08`) |
| Aksesibilitas | `<button>` dengan nama "Meja 5, Terisi, 2 bill, Rp135.655"; status bukan hanya warna |

### CMP-26 Dialog PIN Supervisor

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Modal `z-pin` (HP: bottom sheet) · judul "Persetujuan supervisor" · **ringkasan aksi** (kartu `surface-subtle`: apa yang disetujui, mis. "Diskon Rp7.000 pada bill Rp130.500" / "Void invoice OUT01-POS02-1126-000123" / "Retur 1 × Susu UHT 1L") · **pilih penyetuju** (daftar staf yang memenuhi syarat: permission cukup dan **bukan peminta**, BR-AUT-007; satu staf → otomatis; ≥ 2 → CMP-11 pilih nama) · **titik PIN** + numpad (CMP-21 varian PIN) · **alasan** (wajib untuk void/retur: chip alasan umum + teks bebas; BR-AUD-003) · tombol **Setujui** (primer) / **Batal** |
| Verifikasi | Lokal; target 250–500 ms (NFR-PERF-007); tombol `loading` selama verifikasi; tak bisa dikirim ganda |
| Kesalahan | "PIN salah. Sisa percobaan: 3." (BR-AUT-005: 5 gagal → kunci 5 menit; 5 berikutnya → 15 menit; 15 total → terkunci sampai direset manager). Saat terkunci: ikon `lock` + `PIN_LOCKED` "PIN terkunci sementara. Tunggu sekitar {menit} menit atau minta manager mereset." — **perkiraan menit, tanpa jam dinding** (tidak menampilkan "sampai pukul …" dan tidak bergantung tanggal/jam tablet) + numpad nonaktif. Keadaan terkunci memakai hitungan percobaan **monotonik** dan jeda yang tidak dapat dimundurkan lewat jam tablet (ARCHITECTURE §6.9.6); mengubah jam, memulai ulang aplikasi, atau menutup dialog **tidak** mengurangi jeda atau mengembalikan percobaan; **reset total hanya oleh supervisor/manager**. Terkunci permanen (15 total): "PIN terkunci. Minta manager mereset." (tanpa menit) |
| Hasil | Sukses → dialog menutup, aksi dijalankan, toast "Disetujui oleh {nama}" (audit mencatat penyetuju, BR-AUT-006) |
| Offline | Bekerja penuh offline (verifikasi lokal) |
| Aksesibilitas | Fokus awal di pilihan penyetuju/PIN; digit tidak diumumkan; kegagalan `role="alert"`; tidak dapat ditutup lewat scrim |

### CMP-27 Pratinjau Struk

| Aspek | Spesifikasi |
|---|---|
| Rupa | Kertas putih (`surface`) dengan `shadow-card`, lebar = **jumlah kolom × lebar karakter**: 32 kolom (58 mm) atau 48 kolom (80 mm; default per register, BR-PRN-005), `font-mono` 13/18, tepi atas/bawah bergerigi opsional; logo sebagai **bitmap hitam-putih** hasil cache |
| Isi | Persis isi teks ESC/POS (BR-PRN-007), dalam **`receipt_locale` snapshot** (BR-I18N-007); cetak ulang diberi label **"CETAK ULANG"** (`reprint`) |
| Aksi | **Cetak** (primer), **Cetak ulang** (bila sudah), **Transaksi baru** / **Selesai**; pada kegagalan: chip `print_failed` + tombol "Cetak ulang" (EC-019) |
| Catatan | Ini **pratinjau layar** dari teks; struk fisik tidak dibuat dari HTML (BR-PRN-003). Karakter non-Latin ditransliterasi (BR-I18N-008), pratinjau menampilkan hasil transliterasi |
| Responsif | HP: lebar penuh, scroll vertikal; tablet/desktop: kolom di tengah atau panel kanan |
| Aksesibilitas | Wadah `role="document"` berlabel "Pratinjau struk"; teks dapat dipilih |

### CMP-28 Form (Validasi dan Error)

| Aspek | Spesifikasi |
|---|---|
| Tata letak | Satu kolom ≤ 720 px; ≥ lg boleh 2 kolom untuk form padat; kelompok bidang dengan judul `h3`; jarak antar bidang 16; label di atas |
| Validasi | Zod; pesan melalui kunci i18n (tidak ada literal). **Saat blur** untuk bidang tunggal, **saat submit** untuk seluruh form; bidang dengan error pertama difokuskan |
| Ringkasan error | Bila submit gagal: blok `danger-soft` di atas form (`role="alert"`) berisi daftar tautan ke bidang bermasalah |
| Error server (T3) | Pesan ramah + **CMP-36** (kode, ID, tombol Salin besar) di ringkasan error; **data formulir tidak hilang**. Galat aturan/validasi (T1) tampil per bidang **tanpa kode**; gangguan sementara (T2) pada aksi online-only: lihat §5.5.3 (tombol **Coba lagi** manual) |
| Aksi | Bilah aksi: Simpan (primer, `loading`), Batal; HP: bilah lengket bawah. Tombol Simpan **tidak** dinonaktifkan karena form belum valid (supaya pesan error bisa muncul); dinonaktifkan hanya saat `loading` |
| Perubahan belum disimpan | Dialog konfirmasi saat berpindah halaman |
| Aksesibilitas | Label eksplisit; `aria-required`; `aria-invalid`; `autocomplete` sesuai |

### CMP-29 Pagination / Daftar Panjang

| Aspek | Spesifikasi |
|---|---|
| `/admin` tabel | **Paginasi sisi server**: ukuran halaman 25/50/100; teks "1–25 dari 4.000"; tombol Sebelumnya/Berikutnya (44) + loncat halaman (≥ md) |
| `/admin` HP | Tombol **"Muat lagi"** (bukan scroll tak terbatas otomatis) |
| `/pos` (lokal) | Daftar **dijendelakan (virtual)**; tanpa paginasi; pencarian + filter tanggal; posisi dipertahankan saat kembali dari detail |
| Aksesibilitas | `<nav aria-label="Paginasi">`; halaman saat ini `aria-current="page"`; jumlah hasil diumumkan |

### CMP-30 Checkbox / Radio / Switch

| Aspek | Spesifikasi |
|---|---|
| Ukuran | Visual 24 px di dalam area sentuh **44 × 44** (termasuk label sebagai area klik) |
| Rupa | Tidak dipilih: `surface` + border 2 px `line-input`; dipilih: `action` + ikon centang putih (5,31); radio: lingkaran + titik dalam; **switch**: 48 × 28, off = `surface-sunken` + border `line-input`, on = `action`; knob putih |
| Aturan | Switch untuk pengaturan yang berlaku seketika; checkbox untuk daftar/konfirmasi; status selalu ditampilkan juga sebagai teks ("Aktif"/"Nonaktif") di dekat switch |
| Aksesibilitas | Elemen native atau `role="checkbox"/"radio"/"switch"` + `aria-checked`; label terhubung |

### CMP-31 Pemilih Metode Bayar + Nominal Cepat

| Aspek | Spesifikasi |
|---|---|
| Metode | Ubin 2 kolom (HP) / 3–4 kolom (tablet+), tinggi **56**, ikon + nama: Tunai (`banknote`), QRIS (`qr-code`), Transfer (`landmark`), Kartu (`credit-card`) + metode tambahan konfigurasi tenant (BR-PAY-001). Terpilih: border 2 px `action` + `action-soft` + centang |
| Daftar pembayaran diterapkan | Baris: metode · nominal (`num-md`) · referensi opsional (BR-PAY-005; chip "Referensi") · hapus (44). Banyak metode diperbolehkan (BR-PAY-002) |
| Ringkasan | **Tagihan** · **Sudah dibayar** · **Sisa** (menonjol `num-lg`). Pembulatan tunai ditampilkan sebagai baris terpisah ("Pembulatan +24") (BR-TAX-009) |
| Tunai | Input uang (CMP-03) + numpad + nominal cepat; **Kembalian** ditampilkan besar (`total-lg`, `success-ink` di atas `success-soft`) |
| Validasi | Non-tunai > sisa → error "Pembayaran non-tunai tidak boleh melebihi sisa tagihan" (FR-PAY-005, BR-PAY-003); tombol **Selesai** aktif hanya bila Σ diterapkan = tagihan (BR-PAY-004) |
| Aksesibilitas | `role="radiogroup"` untuk metode; sisa/kembalian di `aria-live="polite"` |

### CMP-32 KPI Card dan Kartu Grafik (`/admin`)

| Aspek | Spesifikasi |
|---|---|
| KPI | Kartu (CMP-09): label `body-sm` `ink-soft` · angka `num-xl` · **delta** (chip: panah ↑/↓ + tanda + %, warna `success`/`danger` **hanya** untuk metrik berpolaritas jelas, mis. penjualan naik = baik; selisih kas negatif = buruk; metrik tanpa polaritas memakai netral) · sparkline opsional |
| Kartu grafik | Judul · kontrol periode (CMP-07) · grafik (palet §2.1.7) · legenda dengan penanda bentuk · tombol "Lihat sebagai tabel" · sumbu/teks `caption` ≥ 12 px |
| Grafik batang | Pola referensi: track `surface-sunken`, batang `neutral-300`, aktif `primary-600` + label nilai; sumbu hari (Sen–Min) |
| Donut | Maks. 5 irisan + label langsung + persentase; pusat berisi total |
| Responsif | Grafik menyesuaikan lebar; HP: kartu penuh, legenda di bawah, label dipersingkat |
| Aksesibilitas | `role="img"` + ringkasan teks; tabel data setara (§2.1.7 aturan 3); warna bukan satu-satunya pembeda |

### CMP-33 Avatar / Chip Pengguna

| Aspek | Spesifikasi |
|---|---|
| Rupa | Lingkaran 32/40/48; **inisial** (2 huruf) `primary-800` di atas `primary-100` (5,84) — foto profil tidak ada di PRD, default inisial |
| Chip pengguna | Avatar + nama + peran (`caption`); dipakai di sidebar bawah, header, daftar pilih staf (CMP-11) |
| Aksesibilitas | Gambar `alt=""` bila nama terlihat; bila tombol → `aria-label` |

### CMP-34 Tooltip

| Aspek | Spesifikasi |
|---|---|
| Rupa | `surface-inverse`, `ink-inverse`, `body-sm`, `radius-md`, padding 6 × 10 |
| Perilaku | Hanya `(hover: hover)` dan fokus keyboard; tunda 400 ms; **tidak pernah satu-satunya** pembawa informasi; tidak dipakai di `/pos` sentuh |
| Aksesibilitas | `role="tooltip"` + `aria-describedby`; dapat ditutup dengan Esc |


### CMP-35 Penanda Tenant (Tenant Badge)

Memperlihatkan **tenant aktif**, karena satu perangkat dapat dipakai untuk lebih dari satu tenant (`DOQ-19`) dan alamat berisi slug. Tenant **tidak punya logo dan tidak punya warna** (§2.1.8): yang tampil adalah **avatar inisial** + **nama**.

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Avatar inisial (1–2 huruf pertama nama; lingkaran `radius-full`; latar **`primary-700`**, inisial `on-action`) + nama tenant + [slug dalam `font-mono` `caption` `ink-muted`, hanya pada varian `hero`] |
| Varian | **`hero`** (login, pairing, SCR-S05, SCR-S03): avatar 56, nama `h2`, slug `caption` mono. **`bar`** (top bar `/pos`, sidebar `/admin`, layar PIN/kunci): avatar 32, nama `label` 600, satu baris. **`compact`** (HP sempit): avatar 32 saja + nama di baris atas top bar (`caption`) |
| Teks | Nama apa adanya (tidak diterjemahkan, BR-I18N-005); satu baris `truncate` pada `bar`/`compact`, maks. 2 baris pada `hero`; nama lengkap via `title`/`aria-label`; batas **40 karakter** (ditetapkan Operator Platform, `DOQ-22`); nama tidak dapat diubah dari UI tenant |
| Warna | **Satu warna tetap** (`primary-700` + `on-action`); tidak ada warna per tenant |
| Fallback | Tanpa nama: avatar inisial "S" dan teks "Solva POS" |
| Tempat | `/pos` top bar (kiri) · `/admin` sidebar (atas, menggantikan placeholder logo) · SCR-P01/P02/A01/S03/S05 · layar kunci (idle-lock) · tidak ditampilkan di SCR-S01/S02 (tanpa nama, §4.3a) |
| Interaksi | Tidak interaktif (bukan pengalih tenant). Tidak ada daftar tenant di mana pun (tidak membocorkan tenant lain) |
| Aksesibilitas | `aria-label` "Tenant: {nama}"; avatar `aria-hidden`; kontras avatar 5,31 : 1 |

### CMP-36 Blok Kode Galat (`KODE#id` + Salin)

Satu-satunya cara galat sistem tak terduga (tingkat T3, §5.5) dilaporkan: **kasir menyalin kode dan mengirimkannya sendiri** (manual, mis. lewat chat atau telepon). **Tidak ada tombol "Laporkan masalah"** di MVP.

| Aspek | Spesifikasi |
|---|---|
| Anatomi | Pesan ramah (`body-lg`) · kartu kode (`surface-subtle`, border `line`, `radius-lg`, padding 16) berisi baris **Kode** (`label` `ink-soft` + nilai `code-id` UPPER, mis. `INTERNAL_ERROR`) dan baris **ID** (`label` + nilai `code-id`, mis. `20261117-143551-k7q2m`) · tombol **Salin kode** |
| ID lokal (offline) | Bila galat terjadi di perangkat tanpa ID server (offline atau galat sisi client): ID berawalan **`D-`** dengan format **`D-YYYYMMDD-HHmmss-xxxxx`** (waktu UTC; mis. `APP_ERROR` + `D-20261117-143551-k7q2m`); keterangan kecil "ID dibuat di perangkat ini" (`caption`) |
| Keterbacaan (dibacakan lewat telepon) | `font-mono` **20/28** (`code-id`), `tabular-nums`, kontras `ink` di atas `surface-subtle` ≥ 15 : 1. Kelompok dipisah tanda hubung dan **tidak pernah dibungkus di tengah kelompok** (HP sempit: Kode dan ID tampil **masing-masing di baris sendiri**). Lima karakter acak terakhir memakai **alfabet tanpa huruf/angka mirip** (`i l o 0 1` tidak dipakai; BR-LOG-005), dua kelompok pertama (tanggal dan jam) hanya angka — sehingga dapat dibacakan per kelompok tanpa ambigu. Tidak ada kapitalisasi otomatis (kode UPPER, ID huruf kecil sebagaimana dibuat). Kode dan ID **tidak diterjemahkan** (BR-I18N-004) |
| Tombol Salin | **Besar dan mudah**: `control-xl` 56 px, varian tonal atau primer, ikon `copy` + label "Salin kode"; HP: **lebar penuh**; tablet/desktop: min. lebar 200 px. Menyalin satu string **`KODE#ID`** (mis. `INTERNAL_ERROR#20261117-143551-k7q2m`) |
| Umpan balik | Label berubah "Disalin" + ikon `check` 2 dtk dan diumumkan `aria-live="polite"` (tanpa bunyi, DOQ-10). Bila Clipboard API gagal/ditolak: teks kode **terpilih otomatis** dan tampil petunjuk "Tekan lama pada kode lalu pilih Salin" |
| Perilaku | Dibuat **sekali per kejadian**; tidak berubah saat ditampilkan ulang; tidak dikirim otomatis (pengiriman log device berjalan terpisah di latar, BR-LOG-010). Tidak ada data sensitif di dalamnya |
| Aksesibilitas | Wadah `role="group"` `aria-label="Kode galat"`; nilai dapat dipilih/disalin; tombol `<button>`; tidak mengandalkan warna |
| Token | `surface-subtle`, `line`, `ink`, `ink-soft`, `radius-lg`, `code-id`, `control-xl`, `action`/`on-action` (tidak ada token baru selain `code-id`) |

### CMP-37 Batas Panel Galat (Error Boundary per Area)

Satu area yang gagal **dirender** tidak boleh menutup seluruh layar kasir (selaras ARCHITECTURE §9.7.5).

| Aspek | Spesifikasi |
|---|---|
| Cakupan area | `/pos`: **kasir/keranjang · pembayaran · riwayat/retur · shift · bill/meja · antrean sinkron · pengaturan perangkat**; `/admin`: isi halaman (header dan sidebar tetap). **Ditambah satu batas akar** (AppShell) → SCR-P17. Area lain tetap hidup (mis. banner pending, tombol ekspor) |
| Tampilan lokal | Menggantikan **hanya** isi area itu, mempertahankan bingkai kartu: ikon `triangle-alert` 32 di lingkaran `danger-soft`/`danger-ink`, judul **"Panel ini bermasalah"** (`title`), kalimat tindakan `APP_ERROR` ("Layar ini mengalami masalah. Ketuk Coba lagi; draf Anda aman."), **blok kode ringkas** `APP_ERROR#D-…` + **Salin** (CMP-36), tombol **Coba lagi** (`control-lg`, primer) dan **Kembali ke beranda** (sekunder) |
| Coba lagi | Merender ulang **area itu saja** (tanpa memuat ulang halaman); store keranjang/bill dibangun ulang dari draf lokal (`cart_draft`, event bill lokal). Gagal **2× berturut-turut** → saran "Muat ulang layar" (manual). **Tanpa muat ulang otomatis** (mencegah putaran crash) |
| Penjualan ganda | Draf membawa `finalize_id`; setelah pemulihan bila `sale` ber-id itu sudah tersimpan → tampil "Transaksi sudah tersimpan" dan menuju SCR-P09 (bukan menjual lagi) |
| Top bar gagal | Diganti pita minimal 56 px: "Status tidak tersedia" + **Coba lagi**; layar kerja tidak ikut tertutup |
| Dialog gagal | Dialog ditutup, fokus kembali ke pemicu, toast T1 "Tidak dapat menampilkan jendela ini"; kerja di belakang dialog utuh |
| Pencatatan | `device_log` `APP_ERROR` (`route`, `componentStack` dipotong, `appVersion`, ID `D-…`); **tanpa** isi keranjang/PIN/pelanggan; **tidak** masuk "perlu perhatian" (BR-LOG-007/010) |
| Aksesibilitas | Area pengganti `role="alert"` sekali saat muncul; fokus pindah ke **Coba lagi** hanya bila area itu sedang aktif |
| Batas akar gagal | → **SCR-P17**. **Dua crash akar dalam 60 dtk setelah boot** → langsung mode aman (SCR-S04) |


---

## 4. Pola Layar dan Wireframe Teks

> Wireframe adalah **struktur dan prioritas**, bukan desain piksel. Notasi: `[ ]` tombol/input, `( )` chip/ikon/indikator, `<...>` komponen CMP, `...` area yang di-scroll. Tidak ada emoji; ikon ditulis dalam kurung. Angka contoh berasal dari PRD (Bab 7). Tiap layar menyebut rujukan PRD.

### 4.0 Kerangka Aplikasi (App Shell)

| Area | `/pos` (terminal kasir, offline) | `/admin` (back-office, SSR online-only) |
|---|---|---|
| Header | Top bar 56 px (CMP-14): register, shift, kasir, **indikator koneksi/sinkron (CMP-17)** | Header 64 px: judul, bahasa, notifikasi, avatar |
| Navigasi | HP: bottom nav (CMP-13). Tablet/desktop: **rail 72 px** (CMP-12) | HP: bottom nav + drawer. `md`: rail. `lg+`: sidebar 240 |
| Slot banner | Di bawah top bar, di atas konten (CMP-17B) | Di bawah header (hanya galat/izin; `/admin` online-only) |
| Konten | Kerja utama; kartu minim; kerapatan tinggi | Kartu/tabel; lebar maks. 1440 |
| Dialog | Dialog/bottom sheet; PIN `z-pin` | Dialog/drawer detail |
| Bahasa | `id-ID`/`en-US` (CMP-14 menu pengguna); berganti seketika (BR-I18N-002) | Sama |
| URL & konteks tenant | `<DOMAIN>/<slug>/pos`; **penanda tenant** (CMP-35) selalu terlihat di top bar, layar PIN, dan layar kunci | `<DOMAIN>/<slug>/admin`; penanda tenant di sidebar (atas) |

**Aturan lintas layar:** (1) indikator koneksi/sinkron **selalu** terlihat di semua layar `/pos` (DP-03); (2) satu instance `/pos` per device — tab kedua menampilkan SCR-P15 varian "instance ganda" (EC-021, FR-SYN-014); (3) tidak ada layar `/pos` yang membutuhkan jaringan kecuali yang diberi label **butuh online** (retur invoice register lain, BR-RTR-004); (4) seluruh teks lewat kunci terjemahan; (5) **root `/` dan slug tak dikenal = halaman 404 generik** (SCR-S02) — tidak ada beranda, tidak ada daftar tenant; login back-office memakai email + kata sandi (identitas global + keanggotaan per tenant) dan selalu **di-scope slug** pada URL.

### 4.1 Daftar Layar

| ID | Layar | Area | Fase PRD |
|---|---|---|---|
| SCR-P01 | Pairing device (enrollment) | `/pos` | F1 |
| SCR-P02 | Pilih staf & PIN | `/pos` | F3 |
| SCR-P03 | Buka shift | `/pos` | F3 |
| SCR-P04 | Kasir retail (katalog + keranjang) | `/pos` | F3 |
| SCR-P05 | Denah/kisi meja F&B | `/pos` | F5 |
| SCR-P06 | Open bill F&B (menu + bill) | `/pos` | F5 |
| SCR-P07 | Split & merge bill | `/pos` | F5 |
| SCR-P08 | Pembayaran multi-metode | `/pos` | F3/F5 |
| SCR-P09 | Selesai & cetak | `/pos` | F3 |
| SCR-P10 | Riwayat transaksi, cetak ulang, void | `/pos` | F3 |
| SCR-P11 | Retur / nota kredit | `/pos` | F3 |
| SCR-P12 | Kas masuk / kas keluar | `/pos` | F3 |
| SCR-P13 | Tutup shift (blind count) | `/pos` | F3 |
| SCR-P14 | Antrean sinkron & perlu perhatian (sisi device) | `/pos` | F3 |
| SCR-P15 | Layar sistem: terkunci / lease habis / update wajib / instance ganda | `/pos` | F1–F3 |
| SCR-P16 | Pengaturan perangkat (bahasa, printer, scanner, penyimpanan) | `/pos` | F3 |
| SCR-P17 | Layar pemulihan (kegagalan render seluruh layar) | `/pos`, `/admin` | F1–F3 |
| SCR-A01 | Login back-office | `/admin` | F1 |
| SCR-A02 | Dashboard laporan (R-01..R-04) | `/admin` | F3 |
| SCR-A03 | Master produk / varian / UOM / barcode | `/admin` | F2 |
| SCR-A04 | Harga per outlet | `/admin` | F2 |
| SCR-A05 | Ketersediaan item per outlet (matriks) | `/admin` | F2 |
| SCR-A06 | Stok: saldo, penerimaan barang, transfer, opname | `/admin` | F4 |
| SCR-A07 | Pengaturan outlet, pajak, struk, metode bayar | `/admin` | F1–F3 |
| SCR-A08 | Pengguna, role, register (termasuk prefiks nomor invoice) & device | `/admin` | F1–F3 |
| SCR-A09 | Perlu perhatian, gap invoice, audit log | `/admin` | F3 |
| SCR-A10 | Master meja & laporan bill F&B | `/admin` | F5 |
| SCR-A11 | Akun saya (ubah kata sandi) | `/admin` | F1 |
| SCR-S01 | Layanan tidak tersedia (tenant ditangguhkan) | publik | F1 |
| SCR-S02 | Halaman tidak ditemukan (404 generik) | publik | F1 |
| SCR-S03 | Sesi tidak cocok dengan alamat | `/admin` | F1 |
| SCR-S05 | Pemilih aplikasi (`/<slug>` polos) | publik | F1 |
| SCR-S06 | Gabung dengan kode undangan (`/<slug>/join`) | publik | F1 |
| SCR-S07 | Atur ulang kata sandi dengan kode (`/<slug>/reset`) | publik | F1 |
| SCR-S04 | Reset aplikasi (aplikasi gagal start) | statis, tanpa bundle | F1 |

---

### 4.2 Terminal Kasir `/pos`

#### SCR-P01 — Pairing Device (FLOW-01; FR-DEV-001/002/005; BR-AUT-002)

Satu-satunya layar `/pos` yang butuh online. Tampil sekali saat device belum terdaftar **pada tenant di URL ini** (`<DOMAIN>/<slug>/pos`). Tenant sudah **diketahui dari slug**, sehingga layar memuat **penanda tenant** (CMP-35 `hero`). Satu perangkat boleh dipasangkan ke **beberapa tenant** (alamat tenant lain membuka pairing/login-nya sendiri; penyimpanan lokal terpisah total, `DOQ-19`).

```
HP (< md)                      Tablet/Desktop (>= md): kartu di tengah <canvas>
+---------------------------+   +------------------------------------------+
| (AB) Nama Tenant          |   |   +----------------------------------+   |
|      /nama-tenant         |   |   | (AB)  Nama Tenant                |   |
|                           |   |   |       /nama-tenant   <mono>      |   |
| Pasangkan perangkat       |   |   | Pasangkan perangkat              |   |
| Pindai QR dari            |   |   | Pindai QR dari back-office, atau |   |
| back-office, atau ketik   |   |   | ketik kode 8 karakter            |   |
| kode.                     |   |   | (berlaku 15 menit).              |   |
| [      Pindai QR      ]   |   |   |  [        Pindai QR        ]     |   |
| [ _ _ _ _ _ _ _ _ ]      |   |   |  [ _ _ _ _ _ _ _ _ ]            |   |
| [      Pasangkan      ]   |   |   |  [        Pasangkan        ]     |   |
| (i) Perlu internet sekali |   |   | (i) Perlu internet hanya sekali. |   |
+---------------------------+   +------------------------------------------+
```
- **Penanda tenant** di atas kartu: avatar inisial `primary-700` + nama tenant + alamat (`/slug`, mono). Judul: "Pasangkan perangkat ke {Nama tenant}". Tidak ada warna tenant (§2.1.8).
- **QR pairing** (DOQ-20, dijawab user): QR yang dibuat di `/admin` (SCR-A08) memuat **alamat lengkap `<DOMAIN>/<slug>/pos` + kode pairing di fragmen URL** (`…/pos#<kode>`; fragmen **tidak dikirim ke server**). **Kode sekali pakai, kedaluwarsa 15 menit.** Dua cara memakainya: (a) **kamera bawaan perangkat** memindai QR → membuka `/<slug>/pos#<kode>` → layar ini **mengisi kolom kode otomatis**, menghapus fragmen dari bilah alamat, dan menunggu pengguna menekan **Pasangkan** (tidak pairing otomatis); (b) **Pindai QR** di dalam layar ini (kamera, sama dengan CMP-04) mengisi kolom kode. **Mengetik kode manual tetap tersedia sebagai cadangan.**
- QR yang alamatnya **berbeda** dengan alamat yang sedang dibuka → pesan "QR ini bukan untuk alamat ini. Buka alamat yang tertera pada QR." (tanpa menyebut atau mencari tenant lain). Kode kedaluwarsa/terpakai → "Kode tidak valid atau sudah kedaluwarsa".
- **Pairing terkena batas laju** (per IP dan per slug): pesan **yang sama untuk semua pengguna sah** — "Terlalu banyak percobaan. Tunggu beberapa menit." (`RATE_LIMITED`) — **tanpa menyebut slug, penyebab, atau sisa waktu presisi**; kolom kode dan tombol Pasangkan nonaktif sebentar lalu aktif lagi. Pesan ini tidak berbeda dari pesan untuk kode salah yang berulang, agar tidak membocorkan keadaan kode atau slug.
- **Perangkat yang sudah dipasangkan ke tenant lain**: tampil info "Perangkat ini juga dipakai untuk tenant lain" (hanya bila ada data tenant lain di browser yang sama); pairing tetap **per tenant**, tanpa pengalih tenant di dalam aplikasi.
- Setelah sukses: progres bersegmen (CMP-18) "Mengunduh data 3/8" (full pull + logo struk + app shell + **nama tenant** untuk penanda offline), lalu menuju SCR-P02. Kegagalan: pesan jelas + "Coba lagi" (§5.5).
- Permintaan `storage.persist()` dijalankan di sini; hasil ditampilkan sebagai chip (`granted`/`denied`) di SCR-P16.

#### SCR-P02 — Pilih Staf & PIN (FLOW-02; FR-AUT-003/004/006; BR-AUT-003/005/008)

```
HP                              Tablet landscape / Desktop
+---------------------------+   +---------------------+--------------------+
| OUT01·POS02  (Online)     |   | OUT01 · POS02       |  Halo, Dewi        |
|---------------------------|   | (Online)(ID)        |  Masukkan PIN      |
| Siapa yang bertugas?      |   |---------------------|   o o o o _ _      |
| (Dewi)  (Andi)  (Rina) .. |   | (Dewi)  Kasir       |  +---+---+---+     |
| ---- setelah pilih ----   |   | (Andi)  Kasir       |  | 1 | 2 | 3 |     |
| Halo, Dewi                |   | (Rina)  Waiter      |  | 4 | 5 | 6 |     |
|  o o o o _ _              |   | (Budi)  Supervisor  |  | 7 | 8 | 9 |     |
|  +---+---+---+            |   |                     |  | <x| 0 |OK |     |
|  | 1 | 2 | 3 |  numpad    |   | Bahasa: [ID | EN]   |  +---+---+---+     |
|  ...      [   Masuk   ]   |   | Lease: sisa 5 hari  |  Ganti staf        |
+---------------------------+   +---------------------+--------------------+
```
- Daftar staf = daftar nama (avatar inisial + peran) outlet itu; PIN **tidak perlu unik** karena memilih nama dulu (BR-AUT-003).
- Bahasa bawaan layar ini = bahasa register (BR-I18N-002).
- Header layar memuat **penanda tenant** (CMP-35 `bar`: avatar + nama tenant) di samping `OUT01 · POS02`; nama tenant juga tampil di layar kunci idle-lock, agar staf selalu tahu tenant aktif pada perangkat yang dipakai bersama (`DOQ-19`). Nama pada daftar staf bukan nama pengguna lintas tenant: **hanya staf tenant ini** yang tampil.
- **Kegagalan PIN**: "PIN salah. Sisa percobaan: N." (hitungan monotonik, dicatat **sebelum** verifikasi). Setelah 5×: `PIN_LOCKED` "PIN terkunci sementara. Tunggu sekitar {menit} menit atau minta manager mereset." (numpad nonaktif; **tanpa jam dinding**, tanpa hitung mundur detik; perkiraan menit diperbarui per menit). Jeda tidak berubah bila jam tablet diubah atau aplikasi dimulai ulang; **reset total hanya oleh supervisor/manager** (BR-AUT-005, FR-AUT-007).
- **Lease** hampir habis (24 jam): banner warning (CMP-17); **habis/jam mundur** → SCR-P15 (tidak ada login).
- **Layar terkunci (idle-lock; BR-AUT-015, FLOW-20):** setelah 10 menit tanpa sentuh/tombol/scan, atau kunci manual dari menu pengguna, layar ini tampil dalam varian "Layar terkunci" (ikon `lock`, nama staf aktif di atas). **Staf yang sama** memasukkan PIN → kembali ke titik semula (shift, keranjang, bill, input utuh). Staf tidak hadir: **Supervisor/Manager/Owner** dapat membuka dengan PIN-nya **hanya untuk Tutup shift** (SCR-P13); sebelum itu tampil peringatan "Draf keranjang akan dibuang" + konfirmasi (L2), dan override tercatat audit. Timer berhenti saat pembayaran atau dialog PIN supervisor berlangsung.
- Responsif: HP bertahap (pilih staf → PIN); tablet+: dua kolom; numpad 56/64 px.

#### SCR-P03 — Buka Shift (FLOW-03; FR-SHF-001; BR-SHF-001/002/010)

```
+------------------------------------------------+
| Buka shift — OUT01 · POS02 · Dewi              |
|                                                 |
|  Modal awal (kas di laci)                       |
|  [ Rp  500.000                      ]  <input uang rata kanan>
|  [Rp100.000][Rp200.000][Rp500.000]  (nominal cepat)
|  +---+---+---+  numpad                          |
|  | 7 | 8 | 9 |                                  |
|  ...                                            |
|  [          Buka shift          ] (xl)          |
+------------------------------------------------+
```
- Dapat dilakukan **offline** (tidak ada penghalang jaringan). Bila shift register ini sudah terbuka (mis. kasir lain) → pesan "Shift sudah terbuka oleh {nama}. Tutup shift itu dulu." (BR-SHF-001/003).
- Rilis wajib belum diterapkan → tombol nonaktif + alasan "Pembaruan wajib" (BR-SYN-003 butir 4).
- Responsif: HP: input + numpad penuh; tablet landscape: input kiri, numpad kanan.

#### SCR-P04 — Kasir Retail (FLOW-04; FR-POS-001..016, FR-PRC-002, FR-SYN-015; BR-CAT-012/015, BR-PRC-007)

Layar paling sering dipakai. Jalur utama: **scan/pilih → keranjang → Bayar**.

**Tablet landscape (≥ lg) dan Desktop (≥ xl)** — tiga zona: rail 72 · katalog (fleksibel) · keranjang tetap 400/440:

```
+---------------------------------------------------------------------------------+
| OUT01 · POS02  (Shift terbuka)           Dewi   (Offline)(^3 belum) (ID) (:)    |
+---------------------------------------------------------------------------------+
| (!) Offline — Ada 3 transaksi belum terkirim sejak 2 jam.   [Ekspor] [Lihat]    |
+------+------------------------------------------------+-------------------------+
| Jual | [ Cari nama / kode / scan ........ ] [scan]    | Keranjang (3)      (:)  |
| Rwyt | [Semua][Minuman][Makanan][Rumah Tangga] ->     | [+ Tambah pelanggan]    |
| Shft |  +---------+ +---------+ +---------+ +--------+|-------------------------|
| Lain |  |Kopi     | |Gula 1kg | |Susu UHT | |Teh Cel.||Kopi Bubuk 200g          |
|      |  |Bubuk    | |         | |1L  (dus)| |        ||[-] 2 [+] (pcs v)        |
|      |  |Rp18.500 | |Rp16.000 | |Rp17.900 | |Rp5.500 ||   2 x 18.500   37.000   |
|      |  +---------+ +---------+ +---------+ +--------+|Gula 1kg                 |
|      |  | ...     | | ...     | | ...     | | ...    ||[-] 1 [+] (pcs v) 16.000 |
|      |  +---------+ +---------+ +---------+ +--------+|Susu UHT 1L  (-10%)      |
|      |   (scanner siap)                                ||[-] 3 [+] (pcs v) 48.330 |
|      |                                                 ||-------------------------|
|      |                                                 || Subtotal       101.330  |
|      |                                                 || PPN 11% (eksklusif)     |
|      |                                                 ||                 11.146  |
|      |                                                 || Pembulatan          24  |
|      |                                                 || TOTAL      Rp112.500    |
|      |                                                 || [Diskon] [Pelanggan]    |
|      |                                                 || [  Bayar Rp112.500  ]   |
+------+------------------------------------------------+-------------------------+
```
**Tablet portrait (md–lg, mis. 800 × 1280)** — rail 72 · katalog penuh · **panel keranjang bawah** (±40% tinggi, dapat ditarik):

```
+------+------------------------------------+
| rail | OUT01·POS02 (Dewi) (Online)(^0)(:) |
|      | [ Cari ....................][scan]  |
|      | [Semua][Minuman][Makanan] ->        |
|      | +-------+ +-------+ +-------+      |
|      | | Kopi  | | Gula  | | Susu  | ...  |  grid 3 kolom
|      | +-------+ +-------+ +-------+      |
|      |                                     |
|      +------------------------------------+
|      | ==== (tarik)  3 item  Rp112.500    |  <- bilah total lengket
|      | Kopi Bubuk 200g  [-] 2 [+]  37.000 |
|      | Gula 1kg         [-] 1 [+]  16.000 |
|      | [Diskon][Pelanggan] [Bayar Rp112.500]|
+------+------------------------------------+
```
**HP (< md)** — katalog penuh · **bilah total lengket** di atas bottom nav · keranjang = bottom sheet:

```
+---------------------------+       +---------------------------+
| OUT01·POS02  (Online)(^0) |       | Keranjang (3)        [x]  |   <- bottom sheet (ditarik)
| (!) Offline — 3 belum ... |       | Kopi Bubuk 200g           |
| [ Cari / scan ....][scan] |       | [-] 2 [+] pcs v   37.000  |
| [Semua][Minuman][Mak.. -> |       | Gula 1kg                  |
| +--------+ +--------+     |       | [-] 1 [+] pcs v   16.000  |
| |Kopi Bub| |Gula 1kg|     |       | Subtotal         101.330  |
| |Rp18.500| |Rp16.000|     |       | PPN 11%           11.146  |
| +--------+ +--------+     |       | Pembulatan            24  |
| ...grid 2 kolom           |       | TOTAL         Rp112.500   |
+---------------------------+       | [Diskon] [Pelanggan]      |
| 3 item  Rp112.500 [Bayar] |       | [   Bayar Rp112.500   ]   |
+---------------------------+       +---------------------------+
| Jual |Riwayat|Shift|Lain  |
+---------------------------+
```
**Perilaku (semua ukuran):**
- Pemindaian barcode sama berulang menaikkan kuantitas baris yang ada (FLOW-04 langkah 2); baris yang berubah disorot sebentar dan digulirkan ke tampilan.
- Item **tidak tersedia di outlet** tidak ditampilkan; scan-nya menghasilkan pesan khusus (FR-POS-012/013). Item **tanpa harga** tampil abu "Harga belum diatur" dan tidak dapat ditambahkan (FR-PRC-002).
- **Stok estimasi ≤ 0**: chip peringatan pada kartu/baris; **tidak memblokir** (FR-POS-011, DP-06).
- **Open price**: ketuk → dialog "Harga satuan" (numpad uang, harus > 0); baris menampilkan chip `Harga bebas` (FR-POS-016).
- **Multi-UOM**: chip UOM pada baris (`pcs ▾`) membuka daftar UOM; scan barcode `dus` menambah 1 dus (= 12 pcs) (FR-POS-001/004).
- **Diskon**: dialog persen/nominal (CMP-07); bila melebihi batas role → CMP-26 (FR-POS-005, BR-DSC-003).
- Total dan rincian dari package hitung bersama; **tidak ada spinner** pada perhitungan (lokal, instan).
- Tombol **Bayar** nonaktif saat keranjang kosong dengan alasan terlihat. **Tanpa shift terbuka**: katalog tetap terlihat, tetapi menambah item dinonaktifkan dan tombol Bayar diganti **"Buka shift"** (menuju SCR-P03) dengan banner `info` (BR-SHF-010; §5.2 #27).
- UI mengikuti **permission peran** (BR-AUT-009): aksi di luar izin **disembunyikan** (bukan dinonaktifkan) kecuali bila perlu penjelasan; aksi yang membutuhkan persetujuan menampilkan CMP-26.

#### SCR-P05 — Kisi Meja F&B (FLOW-05; FR-FNB-001/002/003, FR-SYN-016; BR-FNB-001/003/007)

```
Tablet landscape / Desktop
+---------------------------------------------------------------------------+
| OUT01 · POS03 (Shift terbuka)          Rina    (Online)(^0) (ID) (:)      |
+------+--------------------------------------------------------------------+
| Meja | [Semua][Indoor][Teras][Lantai 2]     [Cari meja...] [Bill terbuka v]|
| Bill |                                                                    |
| Rwyt |  +--------------+ +--------------+ +--------------+ +--------------+
| Shft |  | M01   4 kursi| | M02   4 kursi| | M03   2 kursi| | M04   6 kursi|
| Lain |  | (o) Kosong   | | (u) Terisi   | | (r) Menunggu | | (L) Dipegang |
|      |  |              | | M02-0001     | |     bayar    | |  device lain |
|      |  |              | | Rp58.000     | | M03-0002     | | diperbarui   |
|      |  |              | |              | | Rp86.500     | | 14.05        |
|      |  +--------------+ +--------------+ +--------------+ +--------------+
|      |  (grid dilanjutkan; meja dengan 2 bill: lencana "2 bill")           |
|      |                                                                    |
|      |  Legenda: (o) Kosong  (u) Terisi  (r) Menunggu bayar               |
|      |           (L) Dipegang device lain (hanya lihat)                   |
+------+--------------------------------------------------------------------+
HP: grid 2 kolom, tab area bergulir, filter di bottom sheet.
```
- Status dan tampilan per §2.1.6. Meja dengan ≥ 2 bill menampilkan lencana "2 bill" dan ketukan membuka **daftar bill** meja itu (BR-FNB-007).
- Meja `table_locked_other`: ketuk → bill **hanya lihat**; tidak ada tombol ubah/bayar; teks "Dipegang device lain — hanya lihat. Diperbarui 14.05" (BR-FNB-003, FR-FNB-002, **tidak ada** "ambil alih"/"tutup paksa", FR-FNB-003).
- Data meja milik device lain berasal dari snapshot (bisa terlambat) — selalu menampilkan waktu "diperbarui" (FR-SYN-016).
- Tab **Bill** (nav) = daftar semua bill `OPEN` (CMP-11) dengan filter "Milik device ini" / "Device lain" dan, di device kasir, bagian **"Bill masuk"** (serah-terima dari waiter, SCR-P06). Register `PELAYAN`: navigasi hanya **Meja · Bill · Lainnya** (tanpa Riwayat/Shift).

#### SCR-P06 — Open Bill F&B (FLOW-05; FR-FNB-004/005/010; FR-POS-004; BR-FNB-005/008, BR-PRC-006)

```
Tablet landscape / Desktop
+---------------------------------------------------------------------------+
| < Meja   M05 · M05-0003            Rina   (Online)(^0) (:)                |
+------+--------------------------------------+-----------------------------+
| rail | [Cari menu ...........]              | Bill M05-0003   Meja 5   (:)|
|      | [Semua][Makanan][Minuman][Snack] ->  | [+ Pelanggan]  2 tamu       |
|      |  +--------+ +--------+ +--------+    |-----------------------------|
|      |  |Nasi    | |Ayam    | |Es Teh  |    | Nasi Goreng                 |
|      |  |Goreng  | |Bakar   | |        |    | [-] 2 [+]          70.000   |
|      |  |Rp35.000| |Rp42.500| |Rp8.000 |    | Ayam Bakar                  |
|      |  +--------+ +--------+ +--------+    |  + Extra Sambal (+2.000)    |
|      |  | ...                          |    | [-] 1 [+]          44.500   |
|      |                                      | Es Teh                      |
|      |                                      | [-] 2 [+]          16.000   |
|      |                                      | > Item di-void (1)          |
|      |                                      |-----------------------------|
|      |                                      | Subtotal          130.500   |
|      |                                      | Service 5%          6.525   |
|      |                                      | PB1 10%            ...      |
|      |                                      | TOTAL        Rp135.655      |
|      |                                      | [Pra-bill][Pisah][Gabung]   |
|      |                                      | [  Bayar Rp135.655  ]       |
+------+--------------------------------------+-----------------------------+
HP: dua tampilan — Menu (grid 2 kolom) dan Bill (daftar); bilah total lengket "3 item Rp135.655 [Bill]"
    membuka Bill sebagai layar penuh; [Pra-bill][Pisah][Gabung] di menu ⋮ + tombol sekunder.
```
- Menambah menu ber-modifier → sheet pilihan modifier (chip multi-pilih; harga selisih ditampilkan: "Extra Sambal +Rp2.000"); harga baris dihitung = harga menu + Σ modifier (BR-PRC-006).
- **Tidak ada penghalang jaringan** (event lokal, BR-SYN-021). Kirim event ke server di latar belakang (indikator pending bila belum).
- Item sudah ada yang **menjadi tidak tersedia** → tetap dapat dibayar; menambah item itu dicegah dengan pesan (BR-CAT-020/FR-FNB-012).
- **Void item** = dialog alasan (tanpa PIN); baris pindah ke "Item di-void" (jejak terlihat) (BR-FNB-005, BR-AUT-009).
- Bill tanpa item aktif dapat **dibatalkan** (BR-FNB-008); bill dengan item aktif harus di-void per item.
- Tutup layar tanpa membayar → bill tetap `OPEN` dan meja tetap terisi.
- **Pra-bill**: tampilan/cetak bill tanpa nomor invoice (CMP-27 varian "Pra-bill"; FR-FNB-010); setiap tampil/cetak menulis event `PREBILL_PRINTED` (tidak bergantung keberhasilan cetak; cetak ulang = satu event lagi); meja menjadi `table_awaiting_payment` bila seluruh bill `OPEN` di meja itu menunggu bayar, dan kembali "Terisi" bila ada item ditambah/diubah sesudahnya (BR-FNB-010, FR-FNB-014).
- **Read-only** (bila `lease_other`): seluruh tombol ubah nonaktif dengan banner violet di atas panel bill (CMP-23).
- **Register `PELAYAN`** (HP waiter; BR-FNB-011, FR-FNB-015, FR-SHF-007): tidak ada Bayar, Shift, kas, retur, dan riwayat invoice; open bill, pra-bill, void item, dan serah-terima dilakukan **tanpa shift**. Tombol primer panel bill = **"Serahkan ke kasir"** (`control-xl`). Role Waiter tanpa izin bayar/shift (BR-AUT-009).
- **Serah-terima bill ke kasir** (BR-FNB-012/013, FR-FNB-013, FLOW-19; **hanya online**): (1) **Serahkan ke kasir** aktif bila bill `OPEN` dan **seluruh event bill sudah terkirim (ACK)**; bila belum → tombol nonaktif + alasan "Tunggu seluruh pesanan terkirim ke server" (EC-059); offline → nonaktif "Serah-terima membutuhkan internet" (EC-058). (2) Pemegang memilih **register KASIR** tujuan di outlet yang sama (daftar CMP-11 hanya register `KASIR`) → konfirmasi L2 → event `BILL_HANDED_OVER`. (3) Di pengirim bill menjadi **"Menunggu diterima oleh {register}"** (violet, `handover_pending`): **masih milik pengirim tetapi read-only**, dengan tombol **Batalkan serah-terima** (`BILL_HANDOVER_CANCELED`; bill kembali dapat diedit dan boleh diserahkan ke register lain, mis. bila kasir tujuan offline/rusak, EC-060). (4) Di register kasir tujuan, tab **Bill** menampilkan **"Bill masuk"** (`handover_incoming`) dengan tombol **Terima** → `BILL_ACCEPTED`: **lease pindah** ke kasir; pengirim menjadi read-only. (5) Terima dan batal bersamaan: **server memutuskan menurut urutan commit**; yang kalah menerima pesan "Serah-terima sudah diterima/dibatalkan oleh pihak lain" (EC-061). (6) Setelah diterima hanya kasir dengan **shift terbuka di register itu** yang dapat membayar, memisah, atau menggabung (BR-FNB-013); bill yang menunggu diterima tidak dapat dipisah, digabung, dibayar, atau diubah.

#### SCR-P07 — Split & Merge Bill (FLOW-06/07; FR-FNB-007/008; BR-SPL-001..007, BR-SPL-020..024)

```
Pisah bill — M05-0003        (dialog lg / halaman penuh di HP)
Mode: [ Per item | Per kuantitas | Bagi rata ]   <CMP-07>

Per item / Per kuantitas:
+---------------------+---------------------+---------------------+
| Bill asal (M05-0003)|  Bill A             |  Bill B             |
| Nasi Goreng x2   [>>|  Nasi Goreng x2     |  Es Teh x1          |
| Ayam Bakar x1    [>>|  Es Teh x1          |  Ayam Bakar x1      |
| Es Teh x2        [>>|                     |  (+Extra Sambal)    |
|                     |  Total Rp83.186     |  Total Rp55.991     |
+---------------------+---------------------+---------------------+
  [+ Tambah bill anak]                     [Batal]  [Pisah bill]

Bagi rata:
  Dibagi menjadi  [ - ]  3  [ + ]  bagian
  Bagian 1/3  Rp45.219    Bagian 2/3  Rp45.218    Bagian 3/3  Rp45.218
  (i) Setiap bagian mendapat invoice sendiri. Stok dikonsumsi sekali saat bagian pertama dibayar.
```
- Setiap total anak = hasil package hitung bersama (BR-SPL-004); contoh angka dari PRD: 83.186 / 55.991 dan 45.219 / 45.218 / 45.218.
- Pada **per kuantitas**, tombol `>>` memindahkan 1 unit; stepper kuantitas pada bill anak.
- Bill anak mewarisi meja dan pemegang (device yang sama); bill induk berstatus `SPLIT` dan tidak mendapat invoice (BR-SPL-001/002).
- **Merge:** pilih bill sumber dan target (dua bill `OPEN`, satu outlet, **dipegang device yang sama**). Jika syarat tak terpenuhi: tombol nonaktif + alasan terlihat "Dipegang device lain — tidak dapat digabung" (BR-SPL-020, FLOW-07). Pratinjau hasil menunjukkan baris sejenis yang **digabung menjadi satu baris** (mis. "Es Teh ×3") dan diskon bill sumber yang **dibuang** (peringatan terlihat) (BR-SPL-022). Aksi **tidak dapat dibatalkan** (BR-SPL-024) → dialog konfirmasi.
- Un-split hanya selama belum ada anak yang dibayar (BR-SPL-006/007 butir 5).

#### SCR-P08 — Pembayaran Multi-Metode (FLOW-04 lang. 7–8; FR-PAY-001..005, FR-POS-006/007; BR-PAY-001..005, BR-TAX-009)

```
Tablet landscape / Desktop
+---------------------------------------------------------------------------+
| < Kembali    Pembayaran              (Offline)(^3)                        |
+-------------------------------------+-------------------------------------+
| TAGIHAN                             | Metode                              |
|   Rp112.500        <total-xl>       | [Tunai][QRIS][Transfer][Kartu]      |
|   Rincian v                         |                                     |
|   Subtotal  101.330  PPN 11.146     | Diterima   [ Rp 150.000       ]     |
|   Pembulatan +24                    | [Uang pas][Rp50.000][Rp100.000]     |
|-------------------------------------|  +----+----+----+                    |
| Pembayaran diterapkan               |  | 7  | 8  | 9  |                    |
|   Tunai           Rp112.500  [x]    |  | 4  | 5  | 6  |                    |
| Sisa                    Rp0         |  | 1  | 2  | 3  |                    |
| KEMBALIAN        Rp37.500 (hijau)   |  |000 | 0  | <x |                    |
|                                     |  [ + Tambah metode lain ]           |
|                                     |  [         SELESAI         ] (xl)   |
+-------------------------------------+-------------------------------------+
HP: satu kolom: Tagihan (besar) -> Metode (ubin 2 kol) -> Diterima + nominal cepat -> Numpad (bawah) -> [Selesai]
    Rincian dan daftar pembayaran = bagian yang dapat dilipat; bilah Tagihan/Sisa/Kembalian lengket di atas.
```
- **Multi-metode**: setelah menambah satu pembayaran, **Sisa** menjadi fokus; metode berikutnya diisi dengan nominal sisa (usulan) yang dapat diubah. Contoh PRD: QRIS Rp100.000 + sisa tunai (pembulatan) → kembalian 14.300 (FR-PAY-003).
- **Pembulatan tunai** hanya pada pembayaran tunai penyelesai; ditampilkan sebagai baris "Pembulatan +24" (BR-TAX-009, FR-PAY-004).
- **Non-tunai** > sisa → ditolak dengan pesan (FR-PAY-005). Referensi non-tunai opsional (BR-PAY-005).
- **Kembalian** ditampilkan paling besar saat tunai (`total-lg`, hijau + teks "Kembalian").
- Tombol **Selesai** aktif hanya bila Σ diterapkan = tagihan (BR-PAY-004); `control-xl`; setelah ditekan → transaksi IndexedDB atomik (≤ 300 ms, NFR-PERF-001) → SCR-P09. Tidak ada dialog konfirmasi (DP-01).
- Tombol cadangan keyboard (Windows): `Enter` = Selesai (bila valid), `Esc` = kembali.

#### SCR-P09 — Selesai & Cetak (FLOW-04 lang. 8–10; FR-PRN-002/004; BR-PRN-002, BR-INV-004, AP-10)

```
+--------------------------------------------------+
|              (check)  Pembayaran berhasil         |
|   Invoice  OUT01-POS02-1126-000123     <mono>     |
|   Total  Rp112.500   Tunai  Rp150.000             |
|   KEMBALIAN   Rp37.500                            |
|   (Tersimpan di perangkat)  (^ Menunggu kirim)    |
|   Cetak:  (Mencetak...) -> (Tercetak) / (Cetak gagal)[Cetak ulang]
|   (Laci kas dibuka)                               |
|   [   Transaksi baru   ] (xl, fokus default)      |
|   [Lihat struk] [Cetak ulang]                     |
+--------------------------------------------------+
```
- Layar sukses tampil **segera setelah IndexedDB commit**, tidak menunggu printer atau server (DP-08). Status cetak berubah di tempat (chip); kegagalan **tidak** mengubah status penjualan (EC-019): tombol "Cetak ulang" muncul + toast.
- "Transaksi baru" memiliki fokus default agar `Enter` langsung memulai transaksi berikutnya (kecepatan).
- **Gagal cetak (non-blokir; BR-PRN-002, AP-10, EC-019):** penjualan tetap selesai. Muncul **banner non-blokir** (CMP-17B) "Struk {nomor} belum tercetak." + tombol **Cetak ulang**, **ikon status printer** di top bar berlencana, dan chip `print_failed` pada layar ini. **Tidak ada dialog** yang menghalangi "Transaksi baru" atau checkout berikutnya; banner dapat ditutup (job tetap `FAILED` sampai dicetak ulang). Cetak ulang juga tersedia dari **Riwayat** (SCR-P10), banner, dan daftar cetak gagal di SCR-P16; beberapa kegagalan digabung "{n} struk belum tercetak" + **Cetak ulang semua**.
- Chip `pending` ("Menunggu kirim") bila belum tersinkron; berubah "Tersinkron" ketika ACK.
- F&B: bill → `PAID`, meja kembali ke "Kosong" bila tidak ada bill lain (FLOW-05 lang. 6); tombol "Kembali ke meja".
- Responsif: HP: kolom tunggal, tombol penuh; tablet/desktop: kartu di tengah (≤ 520).

#### SCR-P10 — Riwayat, Cetak Ulang, Void (FLOW-09; FR-POS-009/010; FR-PRN-004; BR-INV-005, BR-RTR-004)

```
Tablet landscape / Desktop
+---------------------------------+------------------------------------------+
| Riwayat   [ Cari no. invoice ] | OUT01-POS02-1126-000123      (Lunas)      |
| [Hari ini][Kemarin][Tanggal v]  | 17/11/2026 14.05 · Kasir Dewi            |
| ------------------------------- | <CMP-27 pratinjau struk>                 |
| 000124  QRIS    Rp55.500 (Lunas)| ...                                      |
| 000123  Tunai  Rp112.500 (Lunas)| [Cetak ulang] [Retur] [Void]             |
| 000122  Tunai   Rp30.000 (VOID) |  Void: hanya selama shift invoice ini    |
| ...virtual list                 |  masih terbuka -> butuh PIN supervisor   |
+---------------------------------+------------------------------------------+
HP: daftar penuh; ketuk -> detail layar penuh dengan tombol aksi di bilah bawah.
```
- Riwayat lokal 3 bulan; pencarian per nomor (FR-POS-009). Invoice register lain / di luar retensi lokal → hasil dengan label **butuh online** (empty state `butuh-online`; BR-RTR-004).
- **Void**: hanya tampil aktif bila invoice dibuat pada shift yang masih terbuka di register ini; selain itu tombol nonaktif dengan alasan "Shift sudah ditutup — gunakan Retur" (BR-INV-005, EC-018). Alur: dialog destruktif → CMP-26 (PIN + alasan) → status `VOID` (nomor tetap).
- **Cetak ulang** selalu tersedia; hasil berlabel "CETAK ULANG"; bahasa mengikuti `receipt_locale` snapshot (BR-I18N-007).
- Invoice `VOID` ditandai chip `void` dan tidak dapat diretur (BR-RTR-009).

#### SCR-P11 — Retur / Nota Kredit (FLOW-08; FR-RTR-001..007; BR-RTR-001..009)

```
Langkah:  (1 Pilih invoice) -> (2 Pilih item) -> (3 Ringkasan & refund) -> (4 Persetujuan)

Langkah 2 (tablet / desktop)
+------------------------------------------------------------------+
| Invoice OUT01-POS02-1126-000123 · batas retur 30/11/2026         |
| Item              Terjual  Diretur   Retur sekarang   Disposisi   |
| Susu UHT 1L          3        0       [-] 1 [+]     (Kembali stok|Buang)
| Kopi Bubuk 200g      2        0       [-] 0 [+]     (Kembali stok|Buang)
| Alasan [ pilih/ketik ............................ ] (wajib)     |
|                                      [Lanjut]                     |
+------------------------------------------------------------------+
Langkah 3
|  Nilai retur: neto Rp16.110 + pajak Rp1.772 = Rp17.882            |
|  Pembulatan tunai +18   ->  Refund Rp17.900                        |
|  Metode refund: [Tunai] [Sesuai metode asal]                       |
|  (!) Refund tunai mengurangi kas laci shift ini.                   |
|  [Minta persetujuan supervisor]                                    |
```
- Disposisi default: retail = `Kembali stok`, menu F&B ber-resep = `Buang` (BR-RTR-008); stok disposisi ditampilkan sebagai segmented (CMP-07).
- Nilai retur dihitung dari angka tersimpan; retur terakhir mengambil sisa (BR-RTR-006). UI hanya menampilkan.
- Validasi: retur kumulatif ≤ terjual (FR-RTR-007); di luar 3 bulan kalender → pesan "Di luar batas retur (hingga 30/11/2026)" (EC-017).
- Langkah 4 = CMP-26. Sukses → layar seperti SCR-P09 dengan nomor `OUT01-POS02-NK-1126-000001` dan cetak nota kredit.
- Retur invoice register lain → butuh online (unduh invoice dari server; skeleton) (EC-016).
- Responsif: HP: langkah satu per layar; tabel item berubah menjadi daftar kartu.

#### SCR-P12 — Kas Masuk / Kas Keluar (FR-SHF-002; BR-SHF-004)

Dialog (bottom sheet di HP): segmented **Kas masuk | Kas keluar**, input uang (numpad), **alasan wajib** (chip alasan umum + teks bebas), tombol "Simpan". Tercatat audit; berfungsi offline. Contoh PRD: kas keluar Rp150.000 "beli es batu"; kas masuk Rp200.000.

#### SCR-P13 — Tutup Shift, Blind Count (FLOW-10; FR-SHF-003/004; BR-SHF-005/006/007)

```
Langkah 1: Hitung kas (kas diharapkan TIDAK ditampilkan)
+--------------------------------------------------------------+
| Tutup shift — OUT01 · POS02 · Dewi                           |
| (!) Ada 2 bill terbuka. Bill dapat dibayar pada shift berikutnya.
| (!) Ada 3 transaksi belum terkirim.                          |
| Hitung uang di laci:                                         |
|   [Hitung per pecahan v]  100.000 x [ 5]   50.000 x [ 9] ... |
|   Total terhitung   [ Rp 1.780.000        ]                  |
|   [Kirim hitungan]  (hitungan terkunci setelah dikirim)      |
+--------------------------------------------------------------+
Langkah 2: Hasil (setelah submit)
+--------------------------------------------------------------+
| Kas diharapkan   Rp1.782.100                                 |
| Kas dihitung     Rp1.780.000                                 |
| SELISIH          -Rp2.100   (v) Kurang    <num-xl, danger>   |
| (Hitungan terkunci)                                          |
| [Cetak rekap]  [Selesai & keluar]                            |
+--------------------------------------------------------------+
```
- Langkah 1 **tidak boleh** memuat angka yang membocorkan kas diharapkan (tidak menampilkan "tunai penjualan", "kas masuk/keluar" jumlah, dsb.) (BR-SHF-005). Rekap non-tunai per metode boleh pada struk rekap **setelah** submit.
- Setelah submit: kasir melihat diharapkan & selisih shift miliknya (BR-SHF-006); selisih ditampilkan dengan **warna + ikon + kata** (Pas / Kurang / Lebih), contoh PRD: −Rp2.100 → "Kurang".
- "Hitung per pecahan" = bantuan hitung opsional (`DOQ-07`).
- Peringatan open bill/pending: non-blokir (FR-SHF-004).
- Offline berfungsi penuh (BR-SHF-005).

#### SCR-P14 — Antrean Sinkron & Perlu Perhatian (sisi device) (FLOW-14/18; FR-SYN-010; BR-SYN-024/030/051/052)

```
+-------------------------------------------------------------------+
| Sinkronisasi                                                       |
| (Offline)  Tersinkron terakhir: 11.02   Lease: sisa 5 hari         |
| Belum terkirim: 3 transaksi · terlama 2 jam                        |
| [ Sinkronkan sekarang ]   [ Ekspor ke file ]                       |
|--------------------------------------------------------------------|
| Perlu perhatian (1)                                                |
|  (!) Nota kredit ...NK-1126-000002  Data tidak valid  KODE#...     |
|      Hubungi manager. Transaksi lain tetap berjalan.               |
| Menunggu (3)                                                       |
|  ...000123  Penjualan   Rp112.500   (Menunggu)                     |
|  ...000124  Penjualan   Rp55.500    (Mencoba lagi 1 mnt)           |
|  ...        Tutup shift             (Menunggu)                     |
| Terkirim hari ini (47)  >                                          |
+-------------------------------------------------------------------+
```
- Satu daftar perintah (CMP-11) dengan chip status: **Menunggu**, **Mencoba lagi {waktu}** (backoff, BR-SYN-024), **Perlu perhatian** (struktural/otorisasi, BR-SYN-030), **Terkirim**, dan **Ditahan** (`SYNC_HELD`: menunggu pembaruan atau server; tidak ada data hilang). Transien tidak pernah tampil sebagai "perlu perhatian".
- **Server sibuk (`429`)**: ringkasan di atas daftar menampilkan chip `server_busy` "Server sibuk — mencoba lagi"; baris perintah tetap **Menunggu**/**Mencoba lagi**; tidak ada dialog, tidak masuk "Perlu perhatian", dan bukan tanda offline (server terjangkau).
- "Ekspor ke file" selalu tersedia, juga saat terkunci (BR-SYN-052, BR-AUT-008).
- Sisi device **tidak** menyelesaikan item perlu perhatian (diselesaikan manager di SCR-A09, FLOW-18); layar ini hanya menampilkan dan menyertakan kode referensi.

#### SCR-P15 — Layar Sistem (Terkunci, Update Wajib, Instance Ganda)

```
+------------------------------------------------+
|                 (lock)                          |
|         Perangkat terkunci                      |
|  Sudah 7 hari tanpa sinkronisasi.               |
|  Sambungkan ke internet untuk membuka kunci.    |
|  [Coba sinkronkan]   [Ekspor transaksi pending] |
|  Kode: ERR_...#20261117-143551-k7q2m  [Salin]   |
+------------------------------------------------+
```
Varian (satu komponen, ikon/teks berbeda; `z-system`, tanpa navigasi lain):
| Varian | Pemicu | Aksi |
|---|---|---|
| Lease habis | 7 hari tanpa sync (BR-AUT-008) | Coba sinkronkan, Ekspor |
| Jam mundur | jam < `max_seen_time` − 5 mnt (BR-AUT-013) | Sinkronkan, Ekspor |
| Update wajib | rilis wajib/versi usang (BR-SYN-003) | Perbarui; Ekspor |
| Instance ganda | tab kedua `/pos` (EC-021) | "Gunakan tab ini" tidak disediakan; pesan "Aplikasi sudah terbuka di tab/jendela lain" |
| Device dicabut | otorisasi gagal (FLOW-16) | Pasangkan ulang (SCR-P01), Ekspor |
| Kredensial kedaluwarsa | `CREDENTIAL_EXPIRED` | Kalimat tindakan katalog §5.5.2 + `KODE#id`; **Pasangkan ulang** (SCR-P01) dan **Ekspor pending** |
| Tenant ditangguhkan (sisi device) | Server menandai tenant ditangguhkan saat sync | Pesan seperti SCR-S01 (tanpa nama tenant) **plus** "Ekspor transaksi pending" — data pending tidak boleh tidak dapat diselamatkan. Perilaku server terhadap perintah pending tenant ditangguhkan: **perlu diselaraskan di PRD** |
| Gagal memperbarui data lokal | `Dexie.open()` versi baru gagal (kuota penuh/bug migrasi); data **tidak dihapus** | **Ekspor pending** (dibaca tanpa skema baru), **Coba lagi**, `KODE#id` (CMP-36); **tidak ada** tombol "reset data" tanpa ekspor lebih dulu |
Tidak ada login/transaksi baru pada layar ini.

#### SCR-P16 — Pengaturan Perangkat (FR-PRN-007, FR-DEV-004/005, FR-I18N-002)

Daftar bagian (kartu): **Bahasa** (segmented ID/EN; berlaku seketika) · **Printer** (status koneksi, jalur adapter: USB/BLE/Cetak browser, **Cetak uji**, lebar kertas 58/80 mm per register) · **Pemindai** (kolom uji "Pindai barcode di sini"; tes kamera) · **Penyimpanan** (hasil `storage.persist()` chip, pemakaian kuota % dengan progress, peringatan > 70%) · **Perangkat** (register, outlet, versi aplikasi, offset jam, sinkron terakhir). Responsif: kolom tunggal (HP), dua kolom (≥ lg). **Tidak ada halaman "Kesehatan Perangkat"** di MVP (keputusan user); diagnostik tenant hanya lewat antrean "perlu perhatian" (SCR-P14, SCR-A09). Daftar **cetak gagal** (dengan Cetak ulang) ada di bagian Printer.

#### SCR-P17 — Layar Pemulihan (kegagalan render seluruh layar)

Dipakai bila **batas akar** (seluruh layar) gagal dirender. Bundle aplikasi masih termuat; data lokal utuh.

```
+------------------------------------------+
|             (triangle-alert)              |
|         Layar ini bermasalah              |
|  Keranjang dan bill Anda tersimpan di     |
|  perangkat ini.                           |
|  +--------------------------------------+ |
|  | Kode  APP_ERROR                      | |
|  | ID    D-20261117-143551-k7q2m        | |
|  | [        Salin kode        ] (xl)    | |
|  +--------------------------------------+ |
|  [          Muat ulang          ] (xl)    |
|  [   Ekspor transaksi pending   ]         |
|  Buka halaman pemulihan (mode aman)       |
+------------------------------------------+
```
- **Tanpa muat ulang otomatis**: pengguna yang memutuskan. Dua crash akar dalam 60 dtk setelah boot → langsung ke **mode aman** (SCR-S04).
- Urutan fokus: judul → keterangan → **Salin kode** → **Muat ulang** → **Ekspor** → tautan mode aman. "Muat ulang" primer; "Ekspor transaksi pending" sekunder dan **hanya di `/pos`** (membaca antrean tanpa bergantung pada layar yang gagal, BR-SYN-052). Keterangan "tersimpan di perangkat" (draf keranjang/bill aman di Dexie) **hanya di `/pos`**; di `/admin` diganti "Perubahan yang belum Anda simpan mungkin hilang."
- Kode memakai CMP-36 (`APP_ERROR` dan ID `D-…` karena dibuat di perangkat); kejadian masuk log device (BR-LOG-010). Tidak ada "Laporkan masalah".
- Layout: konten terpusat maks. 480 px di atas `app`; ikon di lingkaran `danger-soft`/`danger-ink`; tombol penuh lebar di HP.

---

### 4.3 Back-Office `/admin`

> `/admin` berjalan online dan SSR. Kerapatan: `control-md` (sentuh) / `control-sm` (mouse). Pola umum halaman daftar: **Header halaman** (judul + aksi primer) → **bar alat** (cari + filter + tanggal) → **tabel** (CMP-10) → **pagination** (CMP-29).

#### SCR-A01 — Login Back-Office (FR-AUT-001; BR-AUT-001; NFR-SEC-005)

URL `<DOMAIN>/<slug>/admin`. **Model identitas (keputusan user 2026-11-19): identitas global + keanggotaan per tenant** — satu email = satu akun; **keanggotaan dan peran ditentukan per tenant**. Login **hanya dengan email + kata sandi** (tanpa username), **di-scope slug**: berhasil bila kredensial benar **dan** akun memiliki keanggotaan di tenant pada alamat ini. **Cookie sesi per slug**: login **terpisah per tenant** (login di tenant lain butuh login lagi; **Keluar hanya mengakhiri sesi tenant ini**). Layar memuat konteks tenant (nama + alamat). Email hanya pengenal: **tidak ada verifikasi email dan tidak ada email yang dikirim** di MVP.

```
Desktop (>= lg)                                  HP / Tablet portrait
+--------------------+-----------------------+   +-----------------------+
| (latar primary-700)| (AB) Nama Tenant      |   | (AB) Nama Tenant      |
| (AB) Nama Tenant   |      /nama-tenant     |   |      /nama-tenant     |
| (avatar invers)    | Masuk ke Nama Tenant  |   | Masuk ke Nama Tenant  |
| Solva POS          |  Email                |   | Email                 |
| (teks putih; tanpa |  [__________________] |   | [__________________]  |
|  foto/logo)        |  Kata sandi           |   | Kata sandi            |
|                    |  [______________ (mata)]|  | [______________(mata)]|
|                    |  [      Masuk       ] |   | [      Masuk       ]  |
|                    |  Punya kode undangan? |   | Punya kode undangan?  |
|                    |  Punya kode atur ulang?|  | Punya kode atur ulang?|
|                    |  Bukan Nama Tenant?   |   | Bukan Nama Tenant?    |
|                    |  Periksa alamat.      |   | Periksa alamat.       |
+--------------------+-----------------------+   +-----------------------+
```
- Panel kiri (≥ lg) memakai **`primary-700`** + teks `on-action` (5,31 : 1) dan avatar berbalik (lingkaran putih, inisial `primary-700`); di HP/tablet portrait panel ditiadakan. **Tidak ada foto/ilustrasi referensi, logo tenant, warna tenant, SSO, "Remember me"** (`DOQ-15`).
- Judul: "Masuk ke {Nama tenant}"; alamat (`/slug`, mono). "Bukan {Nama tenant}? Periksa alamat." hanya mengingatkan memeriksa alamat — **tidak** ada daftar atau pencarian tenant.
- **Tidak ada layar "Lupa kata sandi" mandiri** (tanpa email di MVP). Dua **tautan teks**: **"Punya kode undangan?"** → SCR-S06 (`/<slug>/join`) dan **"Punya kode atur ulang?"** → SCR-S07 (`/<slug>/reset`); ditambah teks bantuan statis: "Lupa kata sandi? Minta kode atur ulang dari Owner bisnis Anda. Bila akun Anda dipakai di beberapa bisnis, hubungi dukungan Solva."
- **Galat generik (anti-enumerasi):** satu pesan yang **sama** — "Email atau kata sandi salah" — untuk **kredensial salah**, **akun tanpa keanggotaan di tenant pada slug ini**, dan **akun tidak ada**. **Batas percobaan** (jeda progresif, ARCHITECTURE §6.9; kunci slug + email tidak mengubah teks): "Terlalu banyak percobaan. Coba lagi dalam sekitar {menit} menit." — tanpa hitung mundur detik presisi, sama untuk akun ada maupun tidak, tanpa penguncian akun permanen; selama jeda tombol Masuk nonaktif.
- **Sesi per slug:** bila sesi untuk slug ini masih berlaku → langsung ke dashboard; sesi di slug lain **tidak** terbawa. Sesi yang tidak cocok dengan alamat (token milik slug lain/rusak) → SCR-S03.
- **Tidak ada kata sandi sementara dan tidak ada layar "wajib ganti kata sandi"**: penerima memilih kata sandinya sendiri lewat kode sekali pakai (SCR-S06/S07).

#### SCR-A02 — Dashboard Laporan (FR-RPT-001..004; R-01..R-04)

```
Desktop (>= xl)
+---------+----------------------------------------------------------------+
| Sidebar | Dashboard                          (ID)  (bell 2)  (avatar)    |
| 240     |----------------------------------------------------------------|
|         | [Outlet: Semua v] [17/11/2026 - 17/11/2026 v] [Hari|Minggu|Bulan]
|         | +-----------+ +-----------+ +-----------+ +-----------+        |
|         | |Penjualan  | |Transaksi  | |Rata-rata  | |Retur      |        |
|         | |neto       | |           | |per transaksi |         |        |
|         | |Rp170.100  | |3 (1 VOID) | |Rp56.700   | |Rp17.900   |        |
|         | +-----------+ +-----------+ +-----------+ +-----------+        |
|         | +------------------------------+ +---------------------------+ |
|         | | Penjualan per hari  (batang) | | Perlu perhatian (3)       | |
|         | | Sen Sel Rab Kam [Jum*] Sab   | |  Penjualan stok minus  (!)| |
|         | |  ... batang aktif hijau      | |  Gap invoice 2         (!)| |
|         | |  [Lihat sebagai tabel]       | |  Perintah gagal 1     (!!)| |
|         | +------------------------------+ | [Lihat semua]            | |
|         | +--------------+ +-------------+ +---------------------------+ |
|         | |Metode bayar  | |Rekap shift  | Tabel R-03: kasir, selisih ... |
|         | |(donut+label) | |& selisih kas|                                |
|         | +--------------+ +-------------+                                |
+---------+----------------------------------------------------------------+
```
- Pola kartu mengikuti referensi (judul kartu + isi; batang abu dengan batang aktif hijau; progres bersegmen untuk penyelesaian antrean). Konten diganti sepenuhnya dengan metrik POS (R-01: transaksi, gross, diskon, pajak, pembulatan, retur, neto; R-02: stok minus/nilai persediaan; R-03: selisih kas).
- **Selisih kas** memakai palet divergen biru–jingga + tanda/ikon (§2.1.7), bukan merah–hijau.
- Responsif: `xl`: 4 KPI + 2–3 kartu per baris. `lg`: 2 KPI per baris, kartu 2 kolom. `md`: 2 kolom. HP: kolom tunggal; kartu "Perlu perhatian" paling atas; grafik menjadi daftar angka dengan tombol "Lihat grafik"; filter di bottom sheet.
- Seluruh angka dari server (online); `/admin` tidak menghitung ulang uang (BR-RPT-001). Bila offline: banner "Back-office membutuhkan koneksi internet."
- **Laporan terlalu banyak bersamaan** (batas ±2 per tenant): kartu laporan menampilkan "Laporan lain sedang diproses. Coba lagi sebentar lagi." (tanpa kode); tombol dinonaktifkan sambil menunggu, lalu **Coba lagi**; kartu lain tidak terpengaruh.

#### SCR-A03 — Master Produk, Varian, UOM, Barcode (FR-CAT-001..007, FR-CAT-014)

Daftar: tabel (CMP-10) kolom **Nama · Kategori · Tipe (Retail/Menu F&B) · Jumlah SKU · Harga (rentang) · Ketersediaan (mis. 3/3 outlet) · Status**; tombol "Impor CSV" dan "+ Produk".

```
Form produk (desktop; tab pill di atas)
[Info][Varian & SKU][Satuan & Barcode][Harga][Ketersediaan outlet]
+--------------------------------------------+-----------------------------+
| Nama produk   [__________________________]| Pratinjau di kasir          |
| Kategori      [Minuman v] Sub [Kopi v]     |  +--------+                 |
| Tipe          (Retail | Menu F&B)           |  |Nama    |                 |
| [ ] Lacak stok     [ ] Harga bebas (open price)  |Rp..    |                 |
| Satuan dasar  [pcs v]                       |  +--------+                 |
+--------------------------------------------+-----------------------------+
| Varian & SKU: atribut Ukuran {S,M,L} x Warna {Merah,Hitam} -> 6 SKU (tabel)|
| Satuan: pcs (dasar) · dus = 12 pcs · barcode per satuan · [ ] boleh pecahan |
+----------------------------------------------------------------------------+
| [Batal]                                          [Simpan]                  |
+----------------------------------------------------------------------------+
```
- Validasi barcode unik per tenant (FR-CAT-004), batas varian 3 atribut/100 kombinasi (FR-CAT-007; pesan saat terlampaui).
- Menonaktifkan produk yang pernah dijual = **nonaktifkan, bukan hapus** (FR-CAT-005); dialog menjelaskan "Transaksi lama tetap utuh."
- Penyimpanan master = **satu transaksi, satu kenaikan versi** (BR-SYN-010); UI tidak perlu menampilkan versi kecuali di halaman Impor ("Impor 4.000 SKU → 1 versi").
- Responsif: tabel → kartu daftar di HP; form 1 kolom; tab pill menjadi bergulir.

#### SCR-A04 — Harga per Outlet (FR-PRC-001..004; BR-PRC-001/002/004)

Matriks **SKU + UOM** (baris) × **Outlet** (kolom) dengan kolom awal "Harga default tenant". Sel = input uang; sel kosong yang tidak memiliki harga default ditandai chip `warning` "Belum diatur" (item tidak dapat masuk keranjang, FR-PRC-002). Bar alat: pencarian, filter kategori, "Hanya yang belum diatur". Aksi massal: "Salin dari outlet…", "Naikkan %". Footer lengket: "N perubahan belum disimpan — [Simpan semua]". Catatan terlihat: "Perubahan harga berlaku ke depan dan tercatat di audit (BR-PRC-004)." HP: pilih satu outlet dulu (segmented/select), daftar SKU dengan input harga.

#### SCR-A05 — Ketersediaan Item per Outlet (FR-CAT-008..013; BR-CAT-009..022)

```
Matriks (desktop)
[Cari produk] [Kategori v] [Hanya yang ada pengecualian]      [Atur massal v]
+-----------------+-----------+-----------+-----------+
| Produk          | Outlet A  | Outlet B  | Outlet C  |
+-----------------+-----------+-----------+-----------+
| Kopi Bubuk 200g | (v) Ada   | (v) Ada   | (x) Tidak |
| Kaos Polos      | (v) 6/6   | (~) 3/6   | (v) 6/6   |
|  v Merah (3 SKU)|  (v)      |  (x)      |  (v)      |   <- baris SKU (override)
+-----------------+-----------+-----------+-----------+
Legenda:  (v) Tersedia   (x) Tidak tersedia   (~) Sebagian (override SKU)
[ ] pilih baris -> [Tandai tersedia] [Tandai tidak tersedia] [Hapus override]
```
- Setiap sel: **ikon + teks** (bukan hanya warna). Sel `(~)` menunjukkan "efektif 3/6 SKU" (FR-CAT-009/011).
- Perubahan = satu transaksi, satu versi (FR-CAT-008). Konfirmasi dampak ("Kopi Bubuk 200g akan disembunyikan di Outlet C setelah perangkat sinkron; bill terbuka tetap dapat dibayar", BR-CAT-012/020).
- Manager hanya melihat/mengubah **outletnya** (FR-CAT-013); sel di luar hak = nonaktif + `lock`.
- HP: pilih produk → daftar outlet dengan **switch** (CMP-30) + teks status; SKU override dalam panel yang dapat dilipat.

#### SCR-A06 — Stok: Saldo, Penerimaan, Transfer, Opname (FR-INV-001..011; FLOW-11/12/13; R-02)

Tab pill: **Saldo** (R-02) · **Penerimaan barang** · **Transfer** · **Opname**.

```
Penerimaan barang (GR) — form (desktop)
Outlet [OUT01 v]  Pemasok [(opsional) v]  Tanggal [17/11/2026]     (Draft)
+--------------+------+------+---------------+-------------+-----------+
| SKU          | Satuan| Qty  | Biaya/satuan  | Nilai       | Qty dasar |
| Susu UHT 1L  | dus  |  5   | Rp96.000      | Rp480.000   | 60 pcs    |
| [+ Tambah baris]                                                      |
+--------------+------+------+---------------+-------------+-----------+
Total nilai Rp480.000                       [Simpan draft]  [Posting]
```
- **Saldo**: kolom qty (satuan dasar), nilai persediaan, biaya rata-rata, **stok minus** (chip `stock_negative` + `−`), **in-transit** (chip `in_transit`, terpisah dari saldo), status ketersediaan di outlet (item tidak tersedia **tetap tampil** dengan chip, FR-INV-011).
- **Transfer**: stepper status DRAFT → SENT (`in_transit`) → RECEIVED; saat menerima: input qty diterima; **selisih** (mis. 40 dikirim, 38 diterima → "Selisih 2 pcs · Rp16.417") tampil dengan ikon + teks (BR-TRF; FLOW-12).
- **Opname**: tabel SKU · qty snapshot · input terhitung · **delta** (divergen biru–jingga + tanda); progres bersegmen "24/40 dihitung"; "Posting" menampilkan ringkasan dampak nilai (FLOW-13).
- Posting dialog konfirmasi (tidak dapat diubah; koreksi via reversal, FR-INV-008).
- Responsif: tabel baris → kartu; form baris GR di HP berupa daftar kartu dengan "Tambah baris" sheet.

#### SCR-A07 — Pengaturan Outlet, Pajak, Struk, Metode Bayar (FR-TNT-003, FR-PRN-006, FR-ADM-003, FR-PAY-002; BR-TAX-*, BR-PRN-005, BR-I18N-007)

Tab pill: **Umum** (kode, entitas hukum, zona waktu, jam potong) · **Pajak & Biaya** (profil `NONE/PPN/PB1`, tarif, mode harga inklusif/eksklusif, service charge + kena pajak, unit pembulatan tunai) · **Struk** · **Metode Bayar**. *(Prefiks nomor invoice **tidak lagi** di sini: diatur **per register** di SCR-A08, PRD 0.99 BR-INV-003.)*

```
Tab Struk (desktop)
+-----------------------------------------+------------------------------+
| Logo      [Unggah]  (bitmap 1-bit)      | Pratinjau struk <CMP-27>     |
| Header    [ Nama toko .............. ]  |        TOKO CONTOH           |
|           [ Alamat ................. ]  |   Jl. Contoh No. 5           |
| Footer    [ Terima kasih ........... ]  | -----------------------------|
| Bahasa struk [Indonesia v]              | No : OUT01-POS02-1126-000123 |
| Lebar kertas [58 mm | 80 mm]            | ...                          |
|                       [Simpan]          |        Terima kasih          |
+-----------------------------------------+------------------------------+
```
- **Pratinjau langsung** (teks mono, kolom sesuai lebar) memperbarui saat mengetik; menampilkan hasil **transliterasi** karakter non-Latin (BR-I18N-008).
- Perubahan zona/jam potong/mode harga: banner info "Berlaku untuk transaksi berikutnya; transaksi lama tidak berubah" (EC-025/026). Tarif pajak punya tanggal **berlaku mulai** (riwayat tersimpan; BR-TAX-001).
- Aturan pajak yang belum dikonfirmasi akuntan (RSK-06) diberi tautan bantuan; semua bersifat konfigurasi.
- HP: tab pill bergulir; form satu kolom; pratinjau di bawah form.

#### SCR-A08 — Pengguna, Role, Register & Device (FR-AUT-002/007, FR-DEV-001..004; FLOW-01/16)

Tab pill: **Pengguna** · **Role & izin** (matriks BR-AUT-009 sebagai tabel centang; batas diskon per role) · **Register** · **Device**.

```
Device (desktop)
Nama     Register   Status     Sinkron terakhir  Pending         Jam    Persist  Versi
Tablet-1 OUT01-POS02 (Online)  14.05             0               +0s    (v) Ya   v8
Tablet-2 OUT01-POS03 (Offline) kemarin 17.20     (^ 5 · 26 jam)  +9m(!) (x) Tidak v7 (!)
Aksi baris: [Detail] [Cabut] [Pulihkan register]
```
- Pending > 0 ditampilkan dengan angka + **umur** (FR-DEV-004); offset jam > 10 mnt memakai chip `warning` (BR-TIM-006); versi usang (`update_required`).
- **Buat kode pairing** → dialog menampilkan kode 8 karakter dalam `font-mono` besar, hitung mundur **15 menit**, dan **sekali pakai** (FR-DEV-001); **plus kode QR** (≥ 160 px, latar putih, zona tenang 4 modul, kontras tinggi) yang memuat **alamat lengkap `<DOMAIN>/<slug>/pos` + kode di fragmen URL** (`…/pos#<kode>`; DOQ-20 dijawab user). Di bawah QR: kode (besar) dan alamat sebagai **cadangan ketik manual** — "Atau buka {alamat} lalu ketik kode". Tombol **Salin kode** dan **Salin alamat** (alamat **tanpa** kode); QR dapat disembunyikan ("Sembunyikan QR") agar tidak terlihat orang lain. QR dan kode kedaluwarsa bersama (tampil "Kedaluwarsa — buat kode baru"; QR tidak dapat dipakai lagi).
- **Pulihkan register** → wizard: cabut device lama → input "nomor struk fisik terakhir" (opsional) → pratinjau gap yang dibuat (mis. 000125–000127; nomor berikut 000128) → konfirmasi (BR-INV-008, FR-DEV-003). Tindakan teraudit.
- **Tab Pengguna = anggota tenant ini** (keanggotaan per tenant; akun bersifat global). Owner melihat **hanya anggota tenantnya** — tidak pernah akun/tenant lain.

```
Pengguna  [Cari nama atau email]  [Peran v]  [Outlet v]            [+ Undang anggota]
Nama   Email             Peran       Outlet        PIN terminal  Aksi
Dewi   dewi@contoh.id    Kasir       OUT01         Ada           [ ... ]
Budi   budi@contoh.id    Supervisor  OUT01, OUT02  Ada           [ ... ]
Rina   rina@contoh.id    Waiter      OUT01         Belum         [ ... ]
Andi   andi@contoh.id    Kasir       OUT01         -    (Menunggu undangan)  [Batalkan undangan]
Menu [ ... ]: Ubah peran/outlet · Terbitkan kode atur ulang · Reset PIN terminal · Keluarkan dari {tenant}

Undangan tertunda (2)
Email            Peran     Berlaku sampai        Status        Aksi
andi@contoh.id   Kasir     22/11/2026 14.05      (Menunggu)    [Batalkan] [Terbitkan ulang]
sari@contoh.id   Waiter    19/11/2026 09.10      (Kedaluwarsa) [Terbitkan ulang]
```
**Kode sekali pakai terikat email (keputusan user 2026-11-19):** undangan dan atur ulang kata sandi **tanpa email** memakai **kode sekali pakai** yang diterbitkan **penerbit** (Owner atau Operator Platform) dan **disampaikan sendiri** oleh penerbit. **Undangan berlaku 72 jam; atur ulang berlaku 24 jam.** Penerima memasukkan **email + kode + kata sandi yang ia tentukan sendiri** (akun baru) atau **kata sandi akun yang sudah ada** (SCR-S06/S07). **Tidak ada kata sandi sementara** dan tidak ada "wajib ganti kata sandi".
- **Undang anggota** (Owner): dialog dengan **Email**, **Nama**, **Peran**, **Outlet ditugaskan** → **Buat kode undangan**. Hasil **selalu sama**, baik email itu akun baru maupun akun yang sudah ada di tenant lain (tidak membocorkan keberadaan akun). Dialog hasil: **kode** (berkelompok, `code-id`, pola CMP-36 non-galat: `surface-subtle`, tombol **Salin kode** 56 px), email penerima, **masa berlaku** "Berlaku 72 jam (sampai {tanggal waktu} {zona})", alamat `<DOMAIN>/<slug>/join` + **Salin alamat**, dan catatan "Kode ini hanya ditampilkan sekali. Sampaikan langsung kepada penerima; penerima menentukan kata sandinya sendiri." Bila email sudah menjadi anggota **tenant ini**: "Email ini sudah menjadi anggota {Nama tenant}." (hanya soal tenant sendiri); kegagalan lain: "Tidak dapat membuat undangan. Periksa isian lalu coba lagi."
- **Undangan tertunda** (keputusan user 2026-11-19): daftar milik tenant ini yang menampilkan **undangan yang belum dipakai** dan **waktu kedaluwarsanya**. Status: `Menunggu` (info) atau `Kedaluwarsa` (netral). **Undangan kedaluwarsa tetap tampil** dengan label **Kedaluwarsa** dan **dapat diterbitkan ulang selama 7 hari setelah kedaluwarsa** (keterangan "Dapat diterbitkan ulang sampai {tanggal}"); sesudah itu **baris hilang dari daftar** (pembersihan otomatis). Undangan yang sudah dipakai keluar dari daftar. Aksi: **Batalkan** dan **Terbitkan ulang**. **Terbitkan ulang** membuat **kode baru** (ditampilkan sekali) dan **kode lama otomatis tidak berlaku** (**digantikan**); **Batalkan** mencabut kode (**dibatalkan**) — kedua alasan dicatat di audit/log, **tidak berbeda di tampilan daftar** (baris yang dibatalkan atau digantikan tidak tampil lagi sebagai kode lama). **Membatalkan undangan menghapus entri `Menunggu undangan` (profil `PENDING`) dari daftar Pengguna** — entri itu tampil di tab Pengguna selama undangan belum dipakai.
- **Terbitkan kode atur ulang** (Owner; dari menu baris): konfirmasi (L2) "Terbitkan kode atur ulang untuk {nama}?" → dialog hasil (kode, masa berlaku **24 jam**, alamat `<DOMAIN>/<slug>/reset`, Salin). **Aturan:** Owner hanya boleh mereset akun yang keanggotaannya **HANYA di tenantnya**. Akun multi-tenant hanya oleh **Operator Platform atau pemiliknya sendiri** (SCR-A11). Tombol **tidak dinonaktifkan** per akun (agar status akun tidak terbaca dari UI); bila ditolak, pesan **generik**: "Tidak dapat menerbitkan kode atur ulang untuk akun ini. Hubungi Operator Platform." — **tidak mengakui** bahwa akun itu multi-tenant.
- **Keluarkan dari tenant** (hapus **keanggotaan**, **bukan akun**): dialog destruktif (L2) "Keluarkan {nama} dari {Nama tenant}?" — "Akun tidak dihapus. {nama} kehilangan akses ke {Nama tenant}; riwayat transaksi dan audit tetap tersimpan." Akses `/admin` berakhir segera; akses terminal (PIN) berakhir saat perangkat sinkron (BR-AUT-010). **Tidak dapat mengeluarkan satu-satunya Owner.** Pengguna yang dikeluarkan tetap dapat masuk ke tenant lain bila punya keanggotaan di sana.
- **Reset PIN terminal & buka kunci**: aksi pada baris pengguna (FR-AUT-007; manager sesuai BR-AUT-009). Pengelolaan **keanggotaan, undangan, dan kode atur ulang** **hanya Owner** (`DOQ-25`); tercatat audit (penerbitan, pemakaian, pembatalan kode).
- Pesan tidak membocorkan keberadaan akun: tidak ada pencarian email global, tidak ada pesan "akun sudah ada di tenant lain", tidak ada daftar tenant milik akun lain.
- Form **Register**: field **Prefiks invoice** (`font-mono`, huruf besar; **wajib untuk jenis Kasir**, disembunyikan untuk Pelayan; FR-DEV-001, BR-INV-003) dengan **saran awal** `{KODE_OUTLET}-{KODE_REGISTER}`, **pratinjau nomor** langsung (`OUT01-POS02-1126-000001`) dan pratinjau nota kredit (`OUT01-POS02-NK-1126-000001`), serta **validasi inline**: "Prefiks sudah dipakai register lain" (unik se-tenant, termasuk prefiks lama register lain), bentuk tidak valid (huruf besar/angka, tanda hubung hanya di dalam, 2–16 karakter, tidak berakhiran `NK`; `PERLU KONFIRMASI` di SCHEMA OQ-S24). Mengubah prefiks register yang sudah memiliki transaksi menampilkan banner `info` "Berlaku mulai bulan berikutnya (periode MMYY berikutnya); nomor lama tidak berubah" dan menyimpan riwayat. Field **Jenis** (segmented **Kasir | Pelayan**; FR-DEV-006, BR-FNB-011) dengan keterangan "Register Pelayan tidak membayar, tidak membuka shift, dan tidak menerbitkan invoice"; jenis tidak dapat diubah saat ada shift terbuka atau bill `OPEN` di register itu (pesan alasan terlihat). Register `PELAYAN` tidak muncul sebagai tujuan serah-terima.
- Hak manager dibatasi outlet yang ditugaskan.

#### SCR-A09 — Perlu Perhatian, Gap Invoice, Audit Log (FR-ADM-001/002, FR-AUD-003; FLOW-18; BR-INV-007)

Tab pill: **Perlu perhatian** (badge angka) · **Gap invoice** · **Audit**.

```
Perlu perhatian — daftar + panel detail (desktop: dua panel; HP: layar detail)
+--------------------------------------+--------------------------------+
| (!) Nota kredit ...NK-1126-000002    | Detail                         |
|     Struktural · Tablet-2 · 14.05    | Alasan: payload tidak valid    |
| (!) Penjualan ...-D1 (nomor konflik) | Device: Tablet-2 (OUT01-POS03) |
|     Otorisasi · Tablet-1             | Ringkasan payload (tanpa data  |
|                                      |  sensitif) · KODE#id           |
|                                      | [Terima manual][Abaikan+alasan]|
|                                      | [Eskalasi ke developer]        |
+--------------------------------------+--------------------------------+
```
- Tiga tindakan persis FLOW-18; **Abaikan** wajib alasan; semua teraudit. Perintah dependen dilepas otomatis setelah induknya selesai.
- **Gap invoice**: tabel (register, periode `MMYY`, rentang nomor, status `OPEN`/`EXPLAINED`), aksi "Beri anotasi" (dialog teks) (FR-ADM-002).
- **Audit**: filter aktor/aksi/tanggal; tabel read-only; kolom "disetujui oleh"; ekspor; tidak ada tombol ubah/hapus (FR-AUD-001/003). Akuntan hanya melihat.

#### SCR-A10 — Master Meja & Laporan Bill F&B (FR-FNB-001, FR-FNB-011; F5)

Tabel master meja (kode, **area**, kapasitas, aktif) dengan impor/CRUD; tab "Bill terbuka tanpa pemegang aktif" dan "Bill ganda pada meja" (laporan R-04; kolom: meja, bill_ref, device, umur, total) dengan keterangan "Tidak ada pengambilalihan; bill baru dibuat manual (BR-FNB-004)". Tidak ada tombol "Tutup paksa".

---

#### SCR-A11 — Akun Saya (ubah kata sandi)

Dibuka dari **menu avatar → Akun saya**. Karena identitas **global**, akun yang terdaftar di lebih dari satu tenant **hanya dapat diatur ulang oleh pemiliknya sendiri atau Operator Platform** — layar ini adalah jalur "pemilik sendiri" (pemilik mengetahui kata sandi saat ini).

```
Akun saya
 Email                dewi@contoh.id   (tidak dapat diubah di sini)
 Kata sandi saat ini  [__________(mata)]
 Kata sandi baru      [__________(mata)]
 Ulangi kata sandi    [__________(mata)]
 [        Simpan kata sandi        ]
```
- Dialog/halaman kecil (≤ 480 px). Validasi: kata sandi baru berbeda dari yang lama; aturan panjang/kekuatan ditetapkan PRD/ARCHITECTURE. Galat: "Kata sandi saat ini salah." (terbatas laju seperti login).
- **Keluar** (menu avatar) mengakhiri **hanya sesi tenant ini** (cookie sesi per slug). Tidak ada "lupa kata sandi" di sini; pemilik yang lupa kata sandi meminta **kode atur ulang** dari Owner (akun satu-tenant) atau Operator Platform (akun multi-tenant). Tidak ada kata sandi sementara.

### 4.3a Halaman Sistem Publik (tanpa sesi tenant)

Halaman yang dapat dilihat **tanpa login**: **SCR-S05** (pemilih aplikasi `/<slug>`), **SCR-S06/S07** (gabung dan atur ulang dengan kode), **SCR-S01** (tenant ditangguhkan), **SCR-S02** (404 generik); ditambah **SCR-S03** (sesi tidak cocok) dan **SCR-S04** (reset aplikasi, statis). Prinsip: **tidak membocorkan** daftar tenant, tidak menyarankan slug mirip, tidak ada pencarian, tidak ada tautan beranda (root `/` sendiri = 404). Bahasa mengikuti bahasa peramban (fallback `id-ID`) dengan pengalih kecil **ID | EN**. Komponen: kartu terpusat di atas `canvas` (§2.1.3), `radius-modal`, lebar maks. 480 (SCR-S05: 560), padding 32 (HP 24), teks `Solva POS` (placeholder logo, `DOQ-12`) di atas kartu, ikon `icon-2xl` `ink-muted`, judul `h2`, isi `body-lg` `ink-soft`. Warna hanya token tetap (tanpa warna tenant). Satu `h1`, `role="main"`, tanpa banner/indikator koneksi.

#### SCR-S02 — Halaman Tidak Ditemukan (404 generik)

Dipakai untuk: **root `/`**, **slug tidak dikenal**, dan jalur lain yang tidak ada. Tampilan **identik** untuk semua kasus (tidak membedakan "slug tidak ada" dari alasan lain).

```
<canvas>
          Solva POS
+----------------------------------------+
|              (compass)                  |
|        Halaman tidak ditemukan          |
|  Alamat yang Anda buka tidak tersedia.  |
|  Periksa kembali alamat, atau minta     |
|  alamat yang benar dari administrator   |
|  bisnis Anda.                           |
+----------------------------------------+
                                  (ID | EN)
```
- Tidak ada tombol (tidak ada tujuan aman untuk diarahkan). Tidak ada kode referensi `KODE#id` (bukan galat sistem). Ikon `compass`.

#### SCR-S01 — Layanan Tidak Tersedia (tenant ditangguhkan)

Dipakai saat slug **valid** tetapi tenant **ditangguhkan** (kunjungan tanpa sesi lewat browser). **Diputuskan user:** halaman "tidak tersedia" untuk tenant ditangguhkan berbeda dari 404 generik untuk slug tak dikenal (`DOQ-21`).

```
<canvas>
          Solva POS
+----------------------------------------+
|              (circle-pause)             |
|        Layanan tidak tersedia           |
|  Layanan untuk alamat ini sedang tidak  |
|  tersedia. Hubungi penyedia layanan.   |
|                                        |
+----------------------------------------+
                                  (ID | EN)
```
- **Tanpa nama tenant dan tanpa alasan** (mis. tagihan) ditampilkan kepada publik; hanya tersedia kepada pemilik lewat kanal lain. Konsekuensi yang diterima: halaman ini membedakan slug-ditangguhkan dari slug-tidak-dikenal sehingga menandakan slug itu ada (dampak kecil; keputusan user).
- **Perangkat yang sudah terpasang** (PWA `/pos` dengan antrean pending) tidak memakai halaman publik ini: ia memakai varian di SCR-P15 dengan **Ekspor pending**.
- Tombol: tidak ada. Ikon `circle-pause`.

#### SCR-S05 — Pemilih Aplikasi (`/<slug>` polos)

Dipakai saat pengguna membuka **`<DOMAIN>/<slug>`** tanpa `/pos` atau `/admin`, untuk slug **valid dan aktif**. Menampilkan **nama tenant ini saja** (tanpa membocorkan tenant lain) dan dua pilihan. Slug tak dikenal tetap **404 generik** (SCR-S02); tenant ditangguhkan tetap SCR-S01.

```
<canvas>
          Solva POS
+--------------------------------------------------+
|  (AB)  Nama Tenant                               |
|        /nama-tenant   <mono>                     |
|                                                   |
|  Pilih aplikasi                                   |
|  +------------------------+ +------------------+ |
|  | (shopping-cart)        | | (layout-dashboard)| |
|  | Terminal Kasir         | | Back-office       | |
|  | Untuk kasir dan waiter | | Untuk pemilik dan | |
|  | di outlet              | | manager           | |
|  +------------------------+ +------------------+ |
+--------------------------------------------------+
                                          (ID | EN)
HP: dua kartu bertumpuk, penuh lebar.
```
- **Dua tautan besar** (`<a>`, bukan tombol): "Terminal Kasir" → `/<slug>/pos`, "Back-office" → `/<slug>/admin`. Kartu min. tinggi 96, `radius-lg`, border `line`, ikon `icon-lg`, judul `title`, keterangan `body-sm` `ink-soft`; hover `surface-hover`; fokus cincin 2 px. Target sentuh ≥ 96 px (seluruh kartu).
- Memakai CMP-35 `hero` (avatar `primary-700` + nama + slug). **Tidak** mengarahkan otomatis dan **tidak** mengingat pilihan terakhir (tanpa penyimpanan). PWA terpasang tidak melewati halaman ini (`start_url` = `/<slug>/pos`).
- **Tanpa daftar/pencarian tenant**; nama tenant tampil kepada siapa pun yang mengetahui slug (diterima; keputusan user).
- Kunci terjemahan: `sys.picker.*` (§6.5).

#### SCR-S03 — Sesi Tidak Cocok dengan Alamat (`/admin`)

Dipakai bila **sesi/cookie tidak cocok dengan slug** pada alamat (token milik slug lain, rusak, atau kedaluwarsa). Karena **cookie sesi per slug**, sesi tenant lain **tidak terbawa** (pengguna cukup melihat login); layar ini hanya untuk kasus sesi yang tidak valid. **Tidak ada pengalih tenant** dan layar tidak menyebut tenant lain.

```
+----------------------------------------+
|        (lock)                           |
|  Sesi ini tidak berlaku                 |
|  untuk alamat ini                       |
|  Masuk lagi untuk melanjutkan.          |
|  [          Masuk          ]            |
+----------------------------------------+
```
- **Masuk** → SCR-A01 pada slug yang sama. Data form yang belum disimpan memicu konfirmasi (L2). Kode referensi `KODE#id` + "Salin" ditampilkan (FR-LOG-005).
- **`/pos` tidak memiliki layar ini**: terminal memakai pairing dan PIN per tenant (penyimpanan lokal terpisah total, `DOQ-19`).

Responsif halaman sistem: kartu lebar penuh di HP (gutter 16), terpusat ≥ md; tombol penuh lebar di HP.

#### SCR-S06 — Gabung dengan Kode Undangan (`/<slug>/join`)

Halaman **penerima undangan** (tanpa sesi). Alamat `<DOMAIN>/<slug>/join` (satu tujuan: bergabung dengan undangan; `DOQ-26` dijawab user). Memuat **penanda tenant** (CMP-35 `hero`) untuk slug valid dan aktif; slug tak dikenal → SCR-S02, tenant ditangguhkan → SCR-S01.

```
<canvas>
          Solva POS
+--------------------------------------------------+
|  (AB) Nama Tenant    /nama-tenant                 |
|  Gabung ke Nama Tenant                            |
|  Email           [__________________]             |
|  Kode undangan   [ ____-____ ]                    |
|  Kata sandi      [______________ (mata)]          |
|  Belum punya akun? Buat kata sandi baru.          |
|  Sudah punya akun? Masukkan kata sandi Anda.      |
|  [               Gabung               ]           |
+--------------------------------------------------+
```
- Penerima memasukkan **email + kode + kata sandi**: **akun baru** → kata sandi yang **ia tentukan sendiri**; **akun yang sudah ada** → kata sandi akun itu. **Teks halaman sama untuk semua orang** (kedua kalimat petunjuk selalu tampil), sehingga halaman **tidak membocorkan apakah akun sudah ada**.
- **Satu pesan galat generik** untuk kode salah, **kedaluwarsa (72 jam)**, **terpakai**, kode untuk email lain, atau kata sandi akun lama yang salah: "Email, kode, atau kata sandi tidak sesuai, atau kode sudah kedaluwarsa." (tidak membedakan penyebab). Batas laju: "Terlalu banyak percobaan. Tunggu beberapa menit." (`RATE_LIMITED`, tanpa menyebut slug).
- Kolom kode: huruf besar otomatis, mengabaikan spasi/tanda hubung, `font-mono` `code-id`; alfabet tanpa huruf mirip (format persis: ARCHITECTURE). Tombol Gabung `control-xl`, `loading` saat berjalan.
- **Berhasil** → "Selesai. Silakan masuk ke {Nama tenant}." dan menuju SCR-A01 (**login terpisah per tenant**, tidak ada auto-login). Kode menjadi **terpakai** (sekali pakai).
- Aksesibilitas: label eksplisit, galat `role="alert"`, tidak mengandalkan warna.

#### SCR-S07 — Atur Ulang Kata Sandi dengan Kode (`/<slug>/reset`)

Halaman **penerima kode atur ulang** (tanpa sesi), alamat `<DOMAIN>/<slug>/reset` (satu tujuan: atur ulang kata sandi; `DOQ-26` dijawab user). Layout dan komponen sama dengan SCR-S06.

```
<canvas>
          Solva POS
+--------------------------------------------------+
|  (AB) Nama Tenant    /nama-tenant                 |
|  Atur ulang kata sandi                            |
|  Email              [__________________]          |
|  Kode atur ulang    [ ____-____ ]                 |
|  Kata sandi baru    [______________ (mata)]       |
|  Ulangi kata sandi  [______________ (mata)]       |
|  [          Simpan kata sandi          ]          |
+--------------------------------------------------+
```
- Kode berlaku **24 jam**, **sekali pakai**, terikat email. **Satu pesan galat generik**: "Email atau kode tidak valid, atau kode sudah kedaluwarsa." (tidak membedakan kedaluwarsa/terpakai/salah). Batas laju sama dengan SCR-S06.
- **Berhasil** → "Kata sandi diperbarui. Silakan masuk." lalu SCR-A01; sesi akun itu pada tenant ini diakhiri (`DIUSULKAN`). Kata sandi baru **ditentukan penerima sendiri**; **tidak ada kata sandi sementara**.
- Kode atur ulang diterbitkan Owner hanya untuk akun yang keanggotaannya **hanya di tenantnya**, atau oleh Operator Platform (SCR-A08).

#### SCR-S04 — Halaman Pemulihan / Reset Aplikasi (aplikasi gagal start)

Dipakai bila aplikasi **tidak dapat dimulai** (layar putih, cache aplikasi rusak, pembaruan gagal) atau dari tautan "mode aman" (SCR-P17). Halaman **statis minimal** (`recovery.html`, selaras ARCHITECTURE §9.7.6), dilayani di `/<slug>/pos/recovery`: **tenant-netral** (tanpa nama tenant), HTML + CSS/JS inline kecil, **tanpa bergantung pada bundle utama**, font web, atau pustaka ikon.

```
+------------------------------------------+
|  Solva POS                                |
|  Aplikasi tidak dapat dimulai             |
|  Data di perangkat ini, termasuk          |
|  transaksi yang belum terkirim, TIDAK     |
|  dihapus.                                 |
|  Kode: APP_ERROR                          |
|  ID:   D-20261117-143551-k7q2m            |
|  [          Salin kode          ]         |
|  [          Coba lagi           ]         |
|  [   Ekspor transaksi tertunda  ]         |
|  [       Reset aplikasi         ]         |
+------------------------------------------+
Setelah menekan "Reset aplikasi":
|  Ketik RESET untuk melanjutkan.           |
|  [ _ _ _ _ _ ]                            |
|  Langkah ini menghapus cache aplikasi     |
|  tenant ini lalu memuat ulang. Data lokal |
|  dan transaksi pending tidak dihapus.     |
|  Butuh internet.                          |
|  [   Lanjutkan reset   ]  [  Batal  ]     |
```
- **Coba lagi** = muat ulang biasa. **Ekspor transaksi tertunda** = membaca IndexedDB tenant langsung (tanpa bundle) menjadi file; sesuai ARCHITECTURE (`DOQ-23` menunggu konfirmasi user). **Reset aplikasi** = hanya oleh aksi manual **dengan mengetik "RESET"**; menghapus pendaftaran service worker dan cache aset **tenant ini saja** (tenant lain di browser yang sama tidak terpengaruh) lalu memuat ulang; **tidak pernah menyentuh data lokal/IndexedDB**, kunci, atau cookie; tidak menghapus transaksi pending.
- **Offline**: "Reset aplikasi" nonaktif dengan alasan "Reset aplikasi membutuhkan internet" (aplikasi perlu diunduh ulang); "Coba lagi" dan "Ekspor" tetap ada.
- Bila reset tidak menyelesaikan: kode + ID (`D-…`) dan keterangan "Hubungi manager atau dukungan Solva dengan kode ini; data Anda tidak hilang."
- **Token (nilai literal diizinkan hanya di sini, diturunkan dari token saat build, bukan hardcode bebas):**

| Token | Nilai | Dipakai |
|---|---|---|
| `app` / `surface` | `#FFFFFF` | Latar |
| `ink` / `ink-soft` | `#1B1D21` / `#52565F` | Judul dan isi (16,88 / 7,36 vs putih) |
| `action` + `on-action` | `#46780D` + `#FFFFFF` | Tombol primer (5,31) |
| `line` | `#DEDFE3` | Kartu (tombol sekunder: border `line-strong` `#C9CBD1`) |
| `danger-soft` / `danger-ink` | `#FDECEC` / `#B42318` | Lingkaran ikon (5,76) |
| `surface-subtle` | `#FAFAFB` | Kartu kode |
| Font | `system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`; kode: `ui-monospace, "Cascadia Mono", Consolas, monospace` | Tanpa unduhan font |
| Ukuran | judul 24/32, isi 16/24, kode 20/28; tombol 56 px, radius 10; kartu radius 16 | Sesuai `h1`, `body-lg`, `code-id`, `control-xl` |
| Ikon | **Satu SVG inline** (segitiga peringatan); tanpa gambar/ikon eksternal | — |

- Bahasa: bahasa peramban (`id-ID` default, `en-US`) dengan dua set teks tertanam; tanpa library i18n. Aksesibilitas: satu `h1`, tombol `<button>`, fokus terlihat (cincin `action` 2 px), tanpa animasi.


### 4.4 Ringkasan Perilaku Responsif Lintas Layar

| Kelas | `/pos` | `/admin` |
|---|---|---|
| HP portrait (< 640) | Bottom nav; katalog 2 kolom; keranjang = bottom sheet dari bilah total; bayar = layar penuh bertumpuk; denah meja 2 kolom; dialog = bottom sheet; kontrol 48/56 | Bottom nav + drawer; tabel → kartu daftar; filter di bottom sheet; form 1 kolom; KPI 1 kolom |
| HP landscape / HP besar (640–767) | Bottom nav; katalog 3 kolom; keranjang tetap bottom sheet; numpad bersisian dengan input | Seperti HP portrait, KPI 2 kolom |
| Tablet portrait (768–1023) | Rail 72; katalog 3 kolom; **panel keranjang bawah** (±40%); bayar 2 kolom bertumpuk (tagihan atas, input+numpad bawah) | Rail; tabel dengan scroll horizontal + kolom pertama lengket; KPI 2 kolom |
| Tablet landscape / laptop kecil (1024–1279) | Rail 72 + katalog + **panel keranjang 400**; bayar 2 kolom bersisian | Sidebar 240 (dapat diciutkan); tabel penuh; 3 kartu per baris |
| Desktop (≥ 1280) | Rail 72 + katalog + panel 440; dukung keyboard penuh (Enter/Esc/angka) dan scanner | Sidebar 240; konten maks. 1440; dua panel master–detail |

Pilihan orientasi: perangkat yang diputar saat transaksi berjalan **tidak kehilangan state** (keranjang, input, dialog); layout bergeser per tabel di atas tanpa memuat ulang.


---

## 5. Pola Interaksi dan Keadaan Sistem

### 5.1 Tingkat Perlindungan Aksi

Satu aturan untuk semua layar agar kasir tidak terhambat pada jalur sukses (DP-01) tetapi terlindungi pada aksi berisiko (DP-07).

| Tingkat | Perlindungan | Dipakai untuk | Rujukan |
|---|---|---|---|
| **L0** | Tanpa konfirmasi | Tambah item, ubah kuantitas/UOM, pilih metode bayar, Selesai bayar, buka shift | DP-01 |
| **L1** | Seketika + toast **"Urungkan"** (5 dtk) | Hapus baris keranjang retail, hapus pembayaran terapan | — |
| **L2** | Dialog konfirmasi (judul menyebut objek, tombol berlabel aksi) | Kosongkan keranjang (≥ 2 item), batalkan bill tanpa item aktif, gabung bill (tak dapat dibatalkan), serahkan bill ke kasir, kirim hitungan kas (terkunci), nonaktifkan produk, posting GR/opname, cabut device | BR-FNB-008, BR-SPL-024, BR-SHF-006 |
| **L3** | Dialog + **alasan wajib** (tanpa PIN) | Void **item** pada open bill, kas masuk/keluar, abaikan item perlu perhatian | BR-AUT-009 catatan, BR-SHF-004, FLOW-18 |
| **L4** | Dialog + **PIN supervisor** (+ alasan bila relevan) | Void invoice, retur/nota kredit, diskon di atas batas role, override lainnya | BR-AUT-006, BR-RTR-002, BR-INV-005 |
| **L5** | L2/L4 + **ketik konfirmasi** (mis. ketik kode register) | Cabut device, pulihkan register, tutup shift darurat (`/admin`) | BR-INV-008, BR-SHF-009 |

Aturan bersama: tombol konfirmasi berlabel aksi ("Void invoice", bukan "Ya"); tombol destruktif memakai varian `danger`; default fokus pada **Batal** untuk L2–L5; penyetuju ≠ peminta (BR-AUT-007).

### 5.2 Katalog Keadaan Sistem

| # | Keadaan | Pemicu | Tampilan | Perilaku & aksi pengguna | Rujukan |
|---|---|---|---|---|---|
| 1 | **Offline** | `navigator.onLine=false` / gagal kontak | Indikator `offline` (amber) di top bar; banner "Offline. Penjualan tetap tersimpan…" | Semua alur kasir tetap jalan. Layar **butuh online** diberi empty state `butuh-online`. Tidak ada modal | G-01, AP-03 |
| 2 | **Kembali online** | Event `online` | Indikator → `syncing` → `synced` | Push lalu pull otomatis ≤ 5 dtk (FR-SYN-008); tidak ada dialog; toast hanya bila ada **perintah perlu perhatian baru** | BR-SYN-040 |
| 3 | **Sync tertunda** | Ada perintah non-ACKED | Banner `pending` permanen: "Ada N transaksi belum terkirim sejak X jam." + **Ekspor**, **Lihat**; lencana angka di top bar | Banner tidak dapat ditutup; hilang otomatis saat ACK. Interval teks X: menit/jam sesuai kepatutan, jamak i18n | BR-SYN-051/052 |
| 4 | **Sedang sinkron** | Push/pull berjalan > 400 ms | Ikon `refresh-cw` berputar + "Menyinkronkan…" | Tidak memblokir layar; reduced-motion → ikon statis | FLOW-14/15 |
| 5 | **Gagal transien** | Jaringan/timeout/5xx | Tetap `pending`, status baris "Mencoba lagi 1 mnt" di SCR-P14 | **Tidak** muncul sebagai galat/perlu perhatian; backoff 5 dtk → 15 dtk → 1 mnt → 5 mnt | BR-SYN-024/030 |
| 6 | **Error sinkron (perlu perhatian)** | Gagal struktural/otorisasi | Indikator `sync_error` (danger) + lencana; di SCR-P14 daftar "Perlu perhatian" + `KODE#id` | Kasir tetap bekerja (tanpa head-of-line blocking); keputusan di `/admin` oleh manager | BR-SYN-030, FLOW-18 |
| 7 | **Bill dipegang device lain** | Bill `OPEN` dengan lease device lain | Meja `table_locked_other` (violet, garis putus-putus, ikon `lock`); bill read-only dengan banner violet "Dipegang device lain — hanya lihat. Diperbarui 14.05" | Semua aksi ubah nonaktif + alasan terlihat; **tidak ada** "ambil alih"/"tutup paksa"; saran teks: "Pegang di device pemilik, atau buat bill baru" | BR-FNB-003/004, EC-014 |
| 8 | **Bill tanpa pemegang aktif** (yatim) | Device pemegang dicabut/rusak | Hanya manager (`/admin`, laporan) dan kisi meja manager: `table_orphan` | Bill tidak dapat dipulihkan; panduan teks: buat bill baru | BR-FNB-004, EC-015 |
| 9 | **Lease offline hampir habis** | < 24 jam ke batas 7 hari | Banner `lease_warning` di semua layar: "Sambungkan ke internet dalam N jam…" | Tidak memblokir; saat login (SCR-P02) tampil sisa hari | BR-AUT-008 |
| 10 | **Lease offline habis (terkunci)** | 7 hari tanpa sync sukses / jam mundur | SCR-P15 `z-system` penuh layar | Tidak ada login/transaksi; hanya "Coba sinkronkan" dan **Ekspor pending** | BR-AUT-008/013 |
| 11 | **Stok estimasi ≤ 0** | Snapshot − penjualan lokal ≤ 0 | Chip `warning` "Stok estimasi ≤ 0" pada kartu/baris | **Non-blokir**; penjualan lanjut (AP-02). Tidak ada dialog | BR-STK-005, FR-POS-011 |
| 12 | **Stok minus (server)** | Saldo < 0 | `/admin`: chip `danger` `−n` di Saldo (R-02), dashboard "Perlu perhatian" | Diselesaikan lewat opname/penyesuaian | BR-STK-002 |
| 13 | **Item tidak tersedia di outlet** | Efektif `UNAVAILABLE` | POS: **disembunyikan** dari katalog/pencarian; scan → toast khusus "{Nama} tidak tersedia di outlet ini". `/admin`: chip `item_unavailable` | Open bill yang sudah berisi item: tetap dapat dibayar; menambah item itu diblokir dengan pesan yang sama; retur tetap boleh | BR-CAT-012/015/020, FR-POS-012/013 |
| 14 | **Harga belum diatur** | Tanpa harga outlet maupun default | Kartu abu "Harga belum diatur"; scan → toast `warning` | Tidak dapat masuk keranjang; (open price: dikecualikan) | FR-PRC-002, BR-PRC-002 |
| 15 | **Harga stale / produk nonaktif / tarif berubah** (server menandai) | Penjualan offline lama | **Tidak ada pesan ke kasir** (penjualan sudah final); hanya flag di laporan R-04 | Fakta tidak ditolak | AP-02, BR-SYN-030 |
| 16 | **Diskon melebihi batas role** | Nilai > batas | CMP-26 (PIN supervisor) | Tanpa persetujuan → nilai dikembalikan ke batas atau batal | BR-DSC-003, BR-AUT-006 |
| 17 | **PIN salah / terkunci** | Verifikasi gagal | "PIN salah. Sisa percobaan: N." → `PIN_LOCKED`: "PIN terkunci sementara. Tunggu sekitar {menit} menit atau minta manager mereset." (numpad nonaktif; tanpa jam dinding) | 5 → 5 mnt; 5 lagi → 15 mnt; 15 total → sampai reset oleh supervisor/manager; hitungan monotonik, jeda tidak dapat dimundurkan lewat jam tablet | BR-AUT-005, BR-AUT-013 |
| 18 | **Kegagalan cetak** | Printer terputus/kertas habis (`PRINT_FAILED`) | Layar sukses tetap hijau; **banner non-blokir** "Struk {nomor} belum tercetak" + **Cetak ulang**; **ikon status printer** di top bar berlencana; chip `print_failed` di SCR-P09 | Penjualan **tidak** terpengaruh; **tidak ada dialog** yang memblokir checkout berikutnya; cetak ulang dari banner, Riwayat, atau SCR-P16 (berlabel "CETAK ULANG"); antrean `print_job` tidak hilang | AP-10, EC-019, BR-PRN-002 |
| 19 | **Printer belum terhubung** | Tidak ada adapter siap | Chip peringatan di top bar "Printer belum terhubung" (ikon `printer`) | Checkout tetap; cetak diantrikan; tautan ke SCR-P16 "Cetak uji" | FR-PRN-007, RSK-07 |
| 20 | **Loading (online)** | Permintaan > 150 ms | `/admin`: skeleton (CMP-20); tombol `loading`. `/pos` lokal: tanpa spinner | Spinner baru muncul > 150 ms; tidak ada layar loading penuh kecuali `butuh-online` | NFR-PERF-003 |
| 21 | **Sukses** | Aksi selesai | Aksi L0: perubahan langsung terlihat (tanpa toast). Finalisasi penjualan: SCR-P09. Aksi `/admin`: toast "Tersimpan" 3 dtk | Tidak ada animasi yang menahan alur | DP-01 |
| 22 | **Update tersedia / wajib** | SW mendeteksi versi baru | Banner `update_available` (semua halaman) + dialog "Pembaruan tersedia — muat ulang?" (**tidak** memotong checkout/bayar); wajib: `update_required` | "Nanti" → dialog muncul lagi 2 jam; wajib: shift baru diblokir | BR-SYN-002/003 |
| 23 | **Jam perangkat anomali** | \|offset\| > 10 mnt | Banner `warning` "Jam perangkat berbeda lebih dari 10 menit dari server." (manager juga di `/admin` device) | Non-blokir; jam mundur > 5 mnt → terkunci (#10) | BR-TIM-006, BR-AUT-013 |
| 24 | **Kuota penyimpanan > 70% / persist ditolak** | `navigator.storage` | Banner `warning` + progress di SCR-P16: "Penyimpanan perangkat hampir penuh" | Non-blokir; sarankan sinkron dan bersihkan; pending tidak pernah dihapus | BR-SYN-054, FR-DEV-005 |
| 25 | **Instance ganda** | Tab kedua | SCR-P15 varian | Tab kedua tidak dapat mengalokasikan nomor invoice | EC-021 |
| 26 | **Device dicabut** | Otorisasi ditolak | SCR-P15 varian + tombol Pasangkan ulang | Pending diekspor lebih dulu | FLOW-16 |
| 27 | **Shift belum terbuka** | Tidak ada shift `OPEN` pada register | Layar kasir/meja menampilkan banner `info` "Buka shift untuk mulai berjualan" + tombol **"Buka shift"** (menuju SCR-P03); tombol "Bayar" diganti tombol itu. **Register `PELAYAN` dikecualikan** (open bill, pra-bill, void item, serah-terima tanpa shift; tidak ada Bayar/Shift/Kas/Retur) | Katalog/denah tetap dapat dilihat; menambah item, open bill, bayar, retur tunai, kas masuk/keluar dinonaktifkan dengan alasan terlihat | BR-SHF-010 |
| 28 | **Tutup shift dengan bill terbuka / pending** | Saat Tutup shift | Peringatan non-blokir di langkah 1 | Bill tetap milik device dan dapat dibayar di shift berikutnya | BR-SHF-007 |
| 29 | **Retur butuh online** | Invoice register lain/di luar retensi lokal | Empty state `butuh-online` pada langkah 1 | Alternatif: sambungkan internet; tidak ada jalur offline | BR-RTR-004, EC-016 |
| 30 | **Kesalahan sistem tak terduga (T3)** | `INTERNAL_ERROR`/5xx/exception | Pesan ramah + **CMP-36** (`KODE#id` + tombol **Salin** besar), tanpa stack/SQL | Kasir menyalin kode dan mengirim manual (tanpa tombol "Laporkan"); ID ada di log; di sisi device bisa berawalan `D-` | FR-LOG-005, BR-LOG-008, §5.5 |
| 31 | **Nomor invoice konflik / gap** | Server mendeteksi | Hanya `/admin` (SCR-A09); kasir tidak melihat | Manager menganotasi | BR-INV-007/009 |
| 32 | **Perubahan katalog diterapkan** | Pull selesai | Katalog berganti **seketika setelah seluruh siklus pull diterapkan** (tidak setengah-diterapkan); tanpa notifikasi kecuali item di keranjang menjadi tidak tersedia (toast info) | Item dalam keranjang tetap bisa dibayar (fakta) | FR-SYN-017, BR-CAT-013 |
| 33 | **Serah-terima bill waiter → kasir** | `BILL_HANDED_OVER` | Pengirim: "Menunggu diterima oleh {register}" (violet, read-only) + **Batalkan serah-terima**. Kasir: "Bill masuk" + **Terima** | Hanya online; lease pindah setelah Terima; ditolak bila event bill belum ACK; terima vs batal bersamaan diputus server menurut urutan commit | BR-FNB-012/013, EC-058..061, FLOW-19 |
| 34 | **Layar terkunci (idle-lock)** | 10 menit tanpa sentuh/tombol/scan, atau kunci manual | SCR-P02 varian "Layar terkunci" | Staf yang sama + PIN → titik semula (state utuh). Timer berhenti saat pembayaran/dialog PIN supervisor. Staf tidak hadir: Supervisor+ hanya untuk **Tutup shift**, draf keranjang dibuang, override diaudit | BR-AUT-015, FR-AUT-009/010, EC-062/063, FLOW-20 |
| 35 | **Tenant ditangguhkan** | Server menandai tenant ditangguhkan | Publik: SCR-S01. Perangkat terpasang: varian SCR-P15 (+ **Ekspor pending**) | Tidak ada transaksi baru; data pending tetap dapat diekspor; perilaku server atas perintah pending perlu diselaraskan di PRD | KEP tenant-slug (belum bernomor), BR-SYN-052 |
| 36 | **Alamat tidak dikenal / root / `/<slug>` polos** | Slug tak dikenal atau `/` → SCR-S02; `/<slug>` valid → SCR-S05 | SCR-S02 (identik untuk semua kasus 404) atau pemilih SCR-S05 | Tidak ada daftar/saran tenant | KEP tenant-via-URL |
| 37 | **Sesi tidak cocok dengan alamat** | Cookie/token sesi tidak cocok dengan slug (cookie sesi per slug) | SCR-S03 (tanpa menyebut tenant lain) | **Masuk** lagi di alamat ini; sesi tenant lain tidak terbawa dan tidak terpengaruh | KEP tenant-via-URL |
| 38 | **Panel gagal dirender** | Galat render pada satu area (`APP_ERROR`) | CMP-37 "Panel ini bermasalah" hanya pada area itu + `APP_ERROR#D-…` + Salin; area lain tetap berfungsi | **Coba lagi** (render ulang area) atau **Kembali ke beranda**; 2× gagal → saran Muat ulang layar; tanpa muat ulang otomatis | CMP-37, BR-LOG-010 |
| 39 | **Seluruh layar gagal dirender** | Galat di luar batas area | SCR-P17 (kode `D-…`, Salin, Muat ulang, Ekspor pending) | Draf keranjang/bill aman; tanpa muat ulang otomatis | SCR-P17, FR-SYN-010 |
| 40 | **Aplikasi gagal start** | Layar putih/cache rusak/pembaruan gagal | SCR-S04 (halaman pemulihan statis) | Coba lagi; **Ekspor transaksi tertunda**; Reset aplikasi (ketik RESET; butuh internet; data lokal tidak dihapus) | SCR-S04 |
| 41 | **Aksi online-only gagal** | Simpan di `/admin`, daftar device, serah-terima bill: `DB_UNAVAILABLE`/`TIMEOUT` | Pesan T2 di area aksi + tombol **Coba lagi**; tombol utama nonaktif + `loading` selama berjalan | Data formulir **tidak hilang**; tidak ada coba ulang otomatis untuk aksi yang mengubah data (§5.5.3) | §5.5.3, BR-FNB-012 |
| 42 | **Server sibuk (`429` saat sync)** | Pembatas laju: `429` + `Retry-After` pada push/pull/resync | Indikator `server_busy` "Server sibuk — mencoba lagi" (CMP-17A, SCR-P14); **tanpa dialog dan tanpa toast** | Retry otomatis menurut `Retry-After` (≥ backoff); **bukan** offline, **bukan** "perlu perhatian"; kasir tetap bekerja | ARCHITECTURE §6.9.7, BR-SYN-024 |
| 43 | **Laporan berat terlalu banyak bersamaan** | Batas ±2 laporan bersamaan per tenant | Pesan "Laporan lain sedang diproses. Coba lagi sebentar lagi." di kartu laporan (tanpa kode); tombol nonaktif sambil menunggu | Tombol aktif lagi sebagai **Coba lagi**; filter dipertahankan | §5.5.3, ARCHITECTURE §6.9.3 |
| 44 | **Kode undangan/atur ulang tidak berhasil** | Kode salah, kedaluwarsa (72 jam undangan / 24 jam atur ulang), terpakai, atau tidak sesuai email | SCR-S06/S07: **satu pesan generik** (tidak membedakan penyebab; tidak membocorkan keberadaan akun) | Minta penerbit (Owner/Operator) menerbitkan kode baru; terbit ulang membatalkan kode lama | KEP identitas global, NFR-SEC-005 |

### 5.3 Pola Umpan Balik Sukses/Gagal

| Pola | Aturan |
|---|---|
| Visual | Ikon + teks; warna dari keluarga semantik. Sukses: `success`; peringatan: `warning`; galat: `danger`; info: `info` |
| Lokasi | Dekat sumber (inline untuk form; chip pada baris; toast hanya untuk konfirmasi singkat) |
| Kecepatan | Umpan balik ≤ 100 ms setelah input (visual); tidak ada animasi penghalang |
| Konsistensi | Pesan yang sama untuk kondisi yang sama di semua layar (kunci terjemahan tunggal, Bab 6) |
| Suara/getar | **Tidak dipakai** (DOQ-10: umpan balik hanya visual); karena itu setiap hasil scan/aksi wajib punya umpan balik visual yang jelas dan diumumkan lewat `aria-live` |

### 5.4 Pola Navigasi dan Fokus Kerja `/pos`

1. **Satu tangan:** aksi utama (Bayar, Selesai) di sisi bawah/kanan dalam jangkauan jempol; bilah total lengket di HP.
2. **Fokus kembali otomatis:** setelah scan/tambah item/tutup dialog, fokus kembali ke kolom pencarian/scan (tidak di tablet sentuh agar keyboard virtual tidak naik: `inputmode="none"` pada kolom scan; keyboard virtual hanya diminta saat pengguna mengetuk kolom).
3. **Tombol Kembali:** selalu terlihat pada layar bertingkat (Bayar, Split, Retur); data yang dimasukkan tidak hilang saat kembali.
4. **Rotasi layar** dan **perpindahan tab ke latar** tidak membuang keranjang/draf (state disimpan lokal).
5. **Kunci layar (BR-AUT-015):** **kunci otomatis setelah 10 menit tanpa aktivitas** (sentuh/tombol/scan) dan **kunci manual** di menu pengguna. Layar terkunci = SCR-P02 (pilih staf + PIN). **Shift, keranjang, open bill, dan input yang sedang diisi tidak hilang**. Timer **berhenti sementara** saat pembayaran berlangsung atau dialog PIN supervisor terbuka. Pembuka: **staf yang sama**; Supervisor/Manager/Owner hanya untuk pergantian kasir (**Tutup shift**) dengan draf keranjang dibuang. **Audit hanya** override supervisor dan penguncian karena PIN salah berulang; kunci/buka biasa tidak diaudit.


### 5.5 Manajemen Error di UI

Keputusan user (2026-11-18). Tujuan: kasir **selalu tahu apa yang harus dilakukan** tanpa melihat jargon, dan galat tidak pernah menghentikan penjualan yang masih mungkin dilakukan (DP-13, AP-02, AP-10).

#### 5.5.1 Tiga Tingkat Presentasi

| Tingkat | Definisi | Pola tampil | Kode `KODE#id` | Dialog? | Coba ulang |
|---|---|---|---|---|---|
| **T1 — Aturan bisnis / validasi** | Penolakan karena aturan atau isian (mis. "PIN salah", "Diskon melebihi batas", "Kuantitas tidak valid", izin kurang) | **Inline di bidang** (CMP-03/28; `danger-ink` + ikon + teks) atau **toast ringan** (CMP-16, 5 dtk, tanpa tombol) | **Tidak ditampilkan** (hanya di log) | Tidak | Pengguna memperbaiki isian |
| **T2 — Gangguan sementara** | Jaringan/timeout/layanan sibuk (`DB_UNAVAILABLE`, `TIMEOUT`), sync ditahan (`SYNC_HELD`), kegagalan cetak (`PRINT_FAILED`), penyimpanan hampir penuh (`STORAGE_LOW`), **server sibuk (`429` pembatas laju saat sync)** | **Indikator** di status koneksi/sinkron (CMP-17A) dan SCR-P14; banner non-blokir bila perlu (CMP-17B) | Tidak ditampilkan (di `/admin` boleh via tautan "Detail") | **Tidak** | **Otomatis** (backoff 5 dtk → 15 dtk → 1 mnt → 5 mnt, BR-SYN-024) di `/pos`; **manual** "Coba lagi" di `/admin` (§5.5.3) |
| **T3 — Kesalahan sistem tak terduga** | Galat yang tidak dapat dipulihkan pengguna (`INTERNAL_ERROR`, `APP_ERROR` untuk galat render/gagal start, `STORAGE_FULL`, `LOCAL_DB_FAILED`) | **Pesan ramah + CMP-36** (kode, ID, tombol Salin besar); panel/layar pemulihan (CMP-37, SCR-P17, SCR-S04) | **Ya** (`INTERNAL_ERROR`, `APP_ERROR`, `STORAGE_FULL`, `LOCAL_DB_FAILED`; + ID, `D-…` bila dibuat di perangkat) | Hanya bila perlu (layar pemulihan); tidak memblokir jalur kasir lain | Tombol **Muat ulang** manual; tidak ada muat ulang otomatis |

**Login (semua tingkat): pesan generik anti-enumerasi.** Login memakai **email + kata sandi** (identitas global + keanggotaan per tenant). Satu pesan — "Email atau kata sandi salah" — untuk kredensial salah, **akun tanpa keanggotaan di tenant pada slug itu**, dan akun tidak ada. Terkena batas: "Terlalu banyak percobaan. Coba lagi dalam sekitar {menit} menit." (`RATE_LIMITED`; perkiraan menit, tanpa hitung mundur detik; tanpa penguncian akun permanen; teks sama walau kunci menjadi slug + email). Pairing terkena batas: "Terlalu banyak percobaan. Tunggu beberapa menit." (tanpa menyebut slug/penyebab). Kode undangan/atur ulang salah, kedaluwarsa, atau terpakai: **satu pesan generik** (SCR-S06/S07). PIN terminal: lihat `PIN_LOCKED` (§5.5.2).

**Aturan memilih tingkat:** (1) bila pengguna dapat memperbaikinya sendiri dalam layar → **T1**; (2) bila akan pulih sendiri atau tinggal menunggu koneksi → **T2**; (3) bila tidak termasuk keduanya → **T3**. Kondisi **status** (offline, pending, lease, stok minus, pembaruan wajib) tetap memakai pola §5.2 (banner/layar sistem), bukan toast galat. Satu kejadian = **satu** presentasi (tidak ada toast ganda untuk galat yang sama).

#### 5.5.2 Katalog Kode dan Kalimat Tindakan

**22 kode** dari ARCHITECTURE §9.7.1 (stabil, katalog hanya bertambah; satu registri dipakai klien dan server). Kalimat tindakan (`id-ID`) mengikuti rujukan ARCHITECTURE dan menjadi kunci `error.<KODE>.action`; terjemahan `en-US` ada di kolom kanan. **Kode dan ID tidak diterjemahkan.** Klien yang menerima kode tak dikenal memperlakukannya menurut kelas dan tetap menampilkan `KODE#id`.

| Kode | Kelas | Tingkat / pola tampil | `id-ID` | `en-US` | Kode tampil? |
|---|---|---|---|---|---|
| `UNAUTHORIZED` | otorisasi | T1; `/admin` → login | Sesi berakhir. Masuk kembali. | Your session has ended. Sign in again. | Tidak |
| `FORBIDDEN` | otorisasi | T1, inline/toast | Anda tidak punya izin untuk tindakan ini. Hubungi manager. | You don't have permission for this action. Contact a manager. | Tidak |
| `VALIDATION_FAILED` | struktural | T1, inline per bidang | Data tidak valid. Periksa isian lalu coba lagi. | Invalid data. Check your input and try again. | Tidak |
| `DB_UNAVAILABLE` | transien | T2 (indikator; `/admin`: Coba lagi) | Layanan sedang sibuk. Coba lagi sebentar lagi. | The service is busy. Try again in a moment. | Tidak |
| `TIMEOUT` | transien | T2 (indikator; `/admin`: Coba lagi) | Permintaan terlalu lama. Periksa koneksi lalu coba lagi. | The request took too long. Check your connection and try again. | Tidak |
| `INTERNAL_ERROR` | sistem | **T3**, CMP-36 | Terjadi kesalahan sistem. Salin kode ini dan hubungi pengembang. | A system error occurred. Copy this code and contact the developer. | **Ya** |
| `PRINT_FAILED` | transien | T2, banner + Cetak ulang + ikon printer | Struk belum tercetak. Periksa printer dan kertas, lalu ketuk Cetak ulang. | The receipt wasn't printed. Check the printer and paper, then tap Reprint. | Tidak |
| `PIN_LOCKED` | otorisasi | T1, dialog/layar PIN (tanpa jam dinding) | PIN terkunci sementara. Tunggu sekitar {menit} menit atau minta manager mereset. | PIN temporarily locked. Wait about {menit} minutes or ask a manager to reset it. | Tidak |
| `DEVICE_REVOKED` | otorisasi | Layar sistem (SCR-P15) | Perangkat ini sudah dicabut. Ekspor transaksi tertunda, lalu hubungi manager. | This device has been revoked. Export pending transactions, then contact a manager. | Ya |
| `CREDENTIAL_EXPIRED` | otorisasi | Layar sistem (SCR-P15) | Kredensial perangkat kedaluwarsa. Pasangkan ulang perangkat. | The device credential has expired. Pair the device again. | Ya |
| `LEASE_EXPIRED` | otorisasi | Layar sistem (SCR-P15, perangkat terkunci) | Perangkat terkunci karena 7 hari tanpa sinkron. Hubungkan ke internet. | The device is locked after 7 days without syncing. Connect to the internet. | Ya |
| `UPDATE_REQUIRED` | skema | Banner wajib / SCR-P15 | Aplikasi perlu diperbarui. Selesaikan shift, lalu muat ulang saat diminta. | The app needs an update. Finish your shift, then reload when asked. | Tidak |
| `SYNC_HELD` | skema | T2, status baris "Ditahan" di SCR-P14 (bukan galat) | Sebagian transaksi ditahan menunggu pembaruan atau server. Tidak ada data yang hilang. | Some transactions are on hold waiting for an update or the server. No data has been lost. | Tidak |
| `TENANT_SUSPENDED` | otorisasi | SCR-S01 / SCR-P15 | Layanan untuk tenant ini sedang tidak tersedia. Hubungi penyedia layanan. | Service for this tenant is currently unavailable. Contact your service provider. | Tidak |
| `STORAGE_LOW` | transien | T2, banner | Penyimpanan perangkat hampir penuh. Sinkronkan dan bebaskan ruang; transaksi tertunda tidak dihapus. | Device storage is almost full. Sync and free up space; pending transactions are not deleted. | Tidak |
| `STORAGE_FULL` | sistem | **T3**, CMP-36 + tombol Ekspor | Penyimpanan penuh, transaksi tidak tersimpan. Ekspor transaksi tertunda lalu bebaskan ruang. | Storage is full and the transaction wasn't saved. Export pending transactions, then free up space. | **Ya** |
| `LOCAL_DB_FAILED` | sistem | **T3**, SCR-P15 varian "Gagal memperbarui data lokal" | Data lokal tidak dapat dibuka. Ekspor transaksi tertunda lalu hubungi pengembang. | Local data can't be opened. Export pending transactions, then contact the developer. | **Ya** |
| `APP_ERROR` | sistem | **T3**, CMP-37 (panel), SCR-P17 (layar), SCR-S04 (gagal start) | Layar ini mengalami masalah. Ketuk Coba lagi; draf Anda aman. | This screen ran into a problem. Tap Try again; your draft is safe. | **Ya** (`D-…`) |
| `HANDOVER_NOT_PENDING` | bisnis | T1, dialog/panel bill | Bill sudah diterima atau dibatalkan. Muat ulang daftar bill. | The bill was already accepted or canceled. Reload the bill list. | Tidak |
| `EVENTS_PENDING` | bisnis | T1, alasan tombol nonaktif | Masih ada perubahan bill yang belum terkirim. Tunggu sinkron selesai. | Some bill changes haven't been sent yet. Wait for the sync to finish. | Tidak |
| `RATE_LIMITED` | otorisasi | T1, inline. **Login admin:** perkiraan menit; **pairing:** pesan generik | Terlalu banyak percobaan. Tunggu beberapa menit. (Login: **Coba lagi dalam sekitar {menit} menit.**) | Too many attempts. Wait a few minutes. (Login: **Try again in about {menit} minutes.**) | Tidak |
| `FEATURE_DISABLED` | otorisasi | T1 / empty state `tanpa-akses` | Fitur ini tidak aktif untuk tenant Anda. | This feature isn't enabled for your tenant. | Tidak |

Kode `reason_code` antrean "perlu perhatian" (mis. `SERIES_CONFLICT`, `SCHEMA_NOT_MIGRATABLE`) adalah kode **data**, bukan kode tampilan kasir (SCHEMA §4.6.3). **`429` dari pembatas laju pada API device** (push/pull/ping/resync) **bukan** `RATE_LIMITED`: ia tingkat T2 "Server sibuk" tanpa dialog (§5.2 #42); `RATE_LIMITED` hanya untuk jalur interaktif tanpa-login (login admin dan pairing). Kode baru wajib menambah satu baris ke tabel ini (kelas, tingkat, kalimat tindakan) sebelum dipakai (ARCHITECTURE §9.7.1).

#### 5.5.3 Aksi Online-Only yang Gagal (`/admin`, daftar device, serah-terima bill)

| Aturan | Spesifikasi |
|---|---|
| Saat berjalan | Tombol utama **nonaktif** + `loading` (CMP-01) → **mencegah klik ganda**; sisa formulir tidak dapat diubah dengan cara yang menyebabkan kirim ganda |
| Saat gagal | Pesan T2 di area aksi (bukan dialog): kalimat tindakan §5.5.2 + tombol **Coba lagi** (manual); tombol utama kembali aktif. **Data formulir tidak hilang** (isian dipertahankan) |
| Aksi yang mengubah data | **Tidak** dicoba ulang otomatis; hasil tidak pasti setelah `TIMEOUT` → pengguna diminta memeriksa hasil (muat ulang daftar) sebelum mencoba lagi |
| Aksi hanya-baca (daftar, laporan) | Empty state varian `galat` (CMP-19) + **Coba lagi**; tanpa kode (tautan "Detail" boleh menampilkan kode) |
| Laporan berat terlalu banyak bersamaan | Pesan menunggu di kartu laporan, **tanpa kode**: "Laporan lain sedang diproses. Coba lagi sebentar lagi."; tombol **Tampilkan laporan** **nonaktif selama menunggu** (indikator `loading`, usulan ±5 dtk) lalu aktif lagi sebagai **Coba lagi**; filter yang sudah diisi tidak hilang (ARCHITECTURE §6.9.3: ±2 laporan bersamaan per tenant) |
| Serah-terima bill | Kegagalan menampilkan kalimat tindakan di dialog/panel bill; **status bill tidak berubah di sisi client** sebelum server mengonfirmasi (BR-FNB-012) |
| Offline | Tombol tidak dicoba; nonaktif dengan alasan "membutuhkan internet" (§5.2 #33) |

#### 5.5.4 Pelaporan dan Diagnostik

1. **Tidak ada tombol "Laporkan masalah"** di MVP. Kasir **menyalin `KODE#id`** (CMP-36, tombol Salin besar) dan mengirimnya **manual**.
2. **Format ID:** server `YYYYMMDD-HHmmss-xxxxx`; **lokal/offline `D-YYYYMMDD-HHmmss-xxxxx`** (BR-LOG-005; UTC; 5 karakter acak tanpa huruf mirip) — terbaca jelas, mono, dapat dibacakan lewat telepon (§CMP-36).
3. **Tidak ada halaman "Kesehatan Perangkat"** di MVP. Diagnostik untuk tenant hanya **antrean "perlu perhatian"** (SCR-P14 sisi device, SCR-A09 sisi manager) dan daftar device (SCR-A08, FR-DEV-004).
4. Error render/`window.onerror` masuk **log device** (antrean ≤ 500, dikirim di latar; BR-LOG-010) dan **tidak** masuk "perlu perhatian".

---

## 6. Konten dan Mikrocopy

### 6.1 Nada Bahasa

| Aspek | Aturan |
|---|---|
| Suara | Ringkas, jelas, tenang, membantu. Kalimat aktif. Tidak menyalahkan ("PIN salah", bukan "Anda salah memasukkan PIN") |
| Sapaan | Tanpa kata ganti bila memungkinkan; bila perlu, "Anda" (bukan "kamu"/"lu"). Instruksi dimulai dengan kata kerja ("Sambungkan ke internet…") |
| Panjang | Judul ≤ 5 kata; pesan ≤ 2 kalimat; tombol 1–3 kata kerja + objek ("Bayar Rp112.500", "Cetak ulang", "Pisah bill") |
| Teknis | Hindari jargon implementasi (lease, outbox, idempotency, tombstone) di UI kasir. Istilah teknis hanya di `/admin` bagian device/log, disertai penjelasan |
| Angka | Selalu menyertakan satuan/`Rp`; jumlah tanpa kata "sebanyak"; jamak via aturan i18n (BR-I18N-009) |
| Emosi | Netral-positif; tidak bernada panik pada kondisi normal (offline = informasi, bukan peringatan merah) |
| Huruf kapital | Gaya kalimat (hanya awal kalimat/nama diri). HURUF KAPITAL hanya untuk penanda struk/status baku: `VOID`, `CETAK ULANG`, `TOTAL` |
| Tanda baca | Tanpa tanda seru kecuali pada keberhasilan besar (opsional, hindari); elipsis `…` untuk proses ("Menyimpan…") |

### 6.2 Istilah Baku (selaras Glosarium PRD Bab 4)

| Istilah UI (`id-ID`) | Istilah UI (`en-US`) | Istilah PRD | Catatan |
|---|---|---|---|
| Tenant | Tenant | Tenant | Nama bisnis pelanggan; di UI sebut "alamat" (bukan "slug") untuk bagian URL |
| Outlet | Outlet | Outlet | — |
| Register | Register | Register / `cash_master` | UI kasir: nama register ("Kasir 2", kode `POS02`) |
| Perangkat | Device | Device | Hindari "alat" |
| Shift | Shift | Shift (`cash_cashier`) | — |
| Modal awal | Opening cash | Modal awal | — |
| Kas masuk / Kas keluar | Cash in / Cash out | Kas masuk/keluar | — |
| Hitung kas | Count cash | Blind count | Label layar; jangan tulis "blind count" |
| Selisih kas | Cash variance | Selisih kas | "Kurang"/"Lebih"/"Pas" |
| Bill terbuka | Open bill | Open bill | Satu bill pada meja |
| Dipegang device lain | Held by another device | Lease (open bill) | **Jangan tampilkan kata "lease" ke kasir** |
| Pra-bill | Pre-bill | Pra-bill | Tanpa nomor invoice |
| Pisah bill / Gabung bill | Split bill / Merge bills | Split/Merge | — |
| Serah-terima bill | Bill handover | `BILL_HANDED_OVER` / `BILL_ACCEPTED` | "Serahkan ke kasir", "Terima", "Bill masuk" |
| Layar terkunci | Screen locked | Idle-lock | Bukan "perangkat terkunci" (lease) |
| Invoice | Invoice | Invoice | "Nomor invoice" |
| Nota kredit | Credit note | Nota kredit | Penanda nomor `NK` tetap (tidak diterjemahkan, BR-INV-010) |
| Retur | Return | Retur | — |
| Void | Void | Void | Status `VOID` tidak diterjemahkan pada nomor/struk |
| Pembulatan | Rounding | Pembulatan | — |
| Kembalian | Change | Kembalian | Struk `en`: "Change" |
| Service charge | Service charge | Service charge | — |
| PPN / PB1 | VAT / PB1 | PPN / PB1 | Label pajak mengikuti profil outlet |
| Satuan | Unit | UOM | "Satuan dasar" untuk base UOM |
| Harga bebas | Open price | Open price | Penanda item |
| Tidak tersedia | Not available | `UNAVAILABLE` | Di outlet tertentu |
| Perlu perhatian | Needs attention | Antrean "perlu perhatian" | — |
| Belum terkirim | Not yet sent | Pending | — |
| Menyinkronkan… | Syncing… | Sync | "Sinkron" boleh dipakai; hindari "sync" |
| Stok minus | Negative stock | Stok minus | — |
| Dalam perjalanan | In transit | In-transit | Transfer |
| Perangkat terkunci | Device locked | Lease offline habis | — |

### 6.3 Format Angka, Uang, Tanggal, dan Waktu (BR-I18N-006; BR-TIM-002; BR-MNY)

| Jenis | `id-ID` | `en-US` | Aturan |
|---|---|---|---|
| Uang | `Rp112.476` | `Rp112,476` | Simbol **`Rp`** tanpa spasi, di semua locale; hanya integer rupiah; negatif `−Rp2.100` (U+2212) |
| Kuantitas | `0,5` · `1.500` | `0.5` · `1,500` | Input diurai per locale; hasil urai ditampilkan sebelum konfirmasi |
| Persen | `10%` · `5,5%` | `10%` · `5.5%` | — |
| Tanggal | `17/11/2026` | `11/17/2026` | Zona **outlet**; di tabel laporan bisa `17 Nov 2026` |
| Waktu | `14.05` (24 jam, titik) | `2:05 PM` | Zona **outlet**; singkatan zona (WIB/WITA/WIT) hanya di detail/`/admin` |
| Tanggal-waktu | `17/11/2026 14.05` | `11/17/2026 2:05 PM` | — |
| Durasi relatif | "2 jam", "5 menit", "kemarin" | "2 hours", "5 minutes", "yesterday" | Gunakan aturan jamak ICU |
| Nomor invoice | `OUT01-POS02-1126-000123` | sama | `font-mono`; **tidak dilokalisasi** |
| Kode/barcode/SKU | apa adanya | sama | Tidak dipengaruhi locale |

Tanggal bisnis (`business_date`) ditampilkan di laporan; waktu transaksi memakai waktu outlet, **bukan** waktu perangkat pembaca (BR-TIM-005).

### 6.4 Konvensi Kunci Terjemahan

Tidak ada string UI literal di komponen (BR-I18N-001). Kunci berpola `{area}.{layar|komponen}.{elemen}`; nilai memakai interpolasi bernama dan aturan jamak.

| Pola | Contoh kunci |
|---|---|
| Layar | `pos.cart.title`, `pos.payment.change`, `admin.devices.column.pending` |
| Status (enum → teks) | `status.sync.offline`, `status.table.occupied`, `status.invoice.void` |
| Galat | `error.pin.wrong`, `error.payment.nonCashExceeds`, `error.server.generic` |
| Umum | `common.cancel`, `common.save`, `common.retry`, `common.copy` |

Kode enum status **tidak** diterjemahkan di penyimpanan (BR-I18N-004); hanya tampilan.

### 6.5 Contoh Pesan (kunci → `id-ID` / `en-US`)

**Status dan banner**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `banner.offline` | Offline. Penjualan tetap tersimpan di perangkat ini. | Offline. Sales are still saved on this device. |
| `banner.pending` | Ada {n} transaksi belum terkirim sejak {durasi}. | {n, plural, one {# transaction hasn't} other {# transactions haven't}} been sent for {durasi}. |
| `banner.leaseWarning` | Sambungkan ke internet dalam {jam} jam agar perangkat tidak terkunci. | Connect to the internet within {jam} hours so this device doesn't lock. |
| `banner.updateAvailable` | Pembaruan tersedia. | An update is available. |
| `banner.updateRequired` | Pembaruan wajib. Shift baru tidak dapat dibuka sebelum diperbarui. | Update required. You can't open a new shift until you update. |
| `status.sync.synced` | Tersinkron {jam} | Synced {jam} |
| `status.sync.serverBusy` | Server sibuk — mencoba lagi | Server busy — retrying |
| `device.locked.title` | Perangkat terkunci | Device locked |
| `device.locked.body` | Sudah 7 hari tanpa sinkronisasi. Sambungkan ke internet untuk membuka kunci. Transaksi yang belum terkirim tetap aman dan dapat diekspor. | It has been 7 days without syncing. Connect to the internet to unlock. Unsent transactions are safe and can be exported. |

**Kasir (retail)**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `pos.cart.empty` | Keranjang kosong. Scan barcode atau pilih produk. | Cart is empty. Scan a barcode or pick a product. |
| `pos.scan.unknown` | Barcode tidak dikenal | Unknown barcode |
| `pos.scan.unavailable` | {nama} tidak tersedia di outlet ini | {nama} isn't available at this outlet |
| `pos.price.missing` | Harga untuk {nama} belum diatur | No price set for {nama} |
| `pos.stock.estimateLow` | Stok estimasi ≤ 0 | Estimated stock ≤ 0 |
| `pos.qty.invalid` | Kuantitas {qty} {uom} tidak valid untuk satuan {base} | {qty} {uom} isn't valid for unit {base} |
| `pos.qty.parsed` | Dibaca: {qty} {uom} | Read as: {qty} {uom} |
| `pos.shift.required` | Buka shift untuk mulai berjualan. | Open a shift to start selling. |
| `pos.removed` | {nama} dihapus | {nama} removed |
| `common.undo` | Urungkan | Undo |

**Pembayaran**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `pos.payment.remaining` | Sisa | Remaining |
| `pos.payment.change` | Kembalian | Change |
| `error.payment.nonCashExceeds` | Pembayaran non-tunai tidak boleh melebihi sisa tagihan. | Non-cash payments can't exceed the remaining balance. |
| `pos.payment.done.title` | Pembayaran berhasil | Payment successful |
| `pos.payment.done.saved` | Tersimpan di perangkat. | Saved on this device. |
| `pos.print.printing` / `.ok` / `.failed` | Mencetak… / Tercetak / Cetak gagal | Printing… / Printed / Print failed |
| `pos.print.reprint` | Cetak ulang | Reprint |

**Persetujuan dan retur**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `approval.title` | Persetujuan supervisor | Supervisor approval |
| `approval.summary.discount` | Diskon {nominal} pada bill {total} | {nominal} discount on a {total} bill |
| `error.pin.wrong` | PIN salah. Sisa percobaan: {n}. | Wrong PIN. Attempts left: {n}. |
| `error.pin.locked` | PIN terkunci sementara. Tunggu sekitar {menit} menit atau minta manager mereset. | PIN temporarily locked. Wait about {menit} minutes or ask a manager to reset it. |
| `error.pin.lockedPermanent` | PIN terkunci. Minta manager mereset. | PIN locked. Ask a manager to reset it. |
| `void.confirm.title` | Void invoice {nomor}? | Void invoice {nomor}? |
| `void.confirm.body` | Nomor invoice tetap terpakai dan pembayaran serta stok akan dibalik. Tindakan ini tidak dapat dibatalkan. | The invoice number stays used and payment and stock will be reversed. This can't be undone. |
| `void.blocked.shiftClosed` | Shift sudah ditutup. Gunakan Retur. | The shift is closed. Use Return instead. |
| `return.outsideWindow` | Di luar batas retur (hingga {tanggal}). | Outside the return window (until {tanggal}). |
| `return.requiresOnline` | Retur invoice ini membutuhkan internet. | Returning this invoice requires an internet connection. |

**F&B**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `bill.readonly` | Dipegang device lain — hanya lihat. Diperbarui {waktu}. | Held by another device — view only. Updated {waktu}. |
| `bill.merge.blocked` | Dipegang device lain — tidak dapat digabung. | Held by another device — can't be merged. |
| `bill.merge.warn` | Diskon bill sumber akan dibuang. Tindakan ini tidak dapat dibatalkan. | The source bill's discount will be dropped. This can't be undone. |
| `bill.void.reason` | Alasan menghapus item | Reason for removing this item |
| `bill.handover.action` | Serahkan ke kasir | Hand over to cashier |
| `bill.handover.pending` | Menunggu diterima oleh {register} | Waiting to be accepted by {register} |
| `bill.handover.incoming` | Bill masuk dari {register} | Incoming bill from {register} |
| `bill.handover.accept` / `.cancel` | Terima / Batalkan serah-terima | Accept / Cancel handover |
| `bill.handover.offline` | Serah-terima membutuhkan internet | Handover requires an internet connection |
| `bill.handover.eventsPending` | Masih ada perubahan bill yang belum terkirim. Tunggu sinkron selesai. | Some bill changes haven't been sent yet. Wait for the sync to finish. |
| `bill.handover.lost` | Bill sudah diterima atau dibatalkan. Muat ulang daftar bill. | The bill was already accepted or canceled. Reload the bill list. |
| `lock.title` | Layar terkunci | Screen locked |
| `lock.idle` | Terkunci karena tidak ada aktivitas selama 10 menit. Masukkan PIN untuk melanjutkan. | Locked after 10 minutes of inactivity. Enter your PIN to continue. |
| `lock.override` | Dibuka supervisor: hanya Tutup shift yang tersedia. Draf keranjang akan dibuang. | Unlocked by a supervisor: only Close shift is available. The cart draft will be discarded. |
| `table.status.free/occupied/awaiting/lockedOther` | Kosong / Terisi / Menunggu bayar / Dipegang device lain | Free / Occupied / Awaiting payment / Held by another device |

**Shift**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `shift.close.count` | Hitung uang di laci | Count the cash in the drawer |
| `shift.close.lockNote` | Hitungan terkunci setelah dikirim. | The count is locked once submitted. |
| `shift.variance.short` | Kurang {nominal} | Short by {nominal} |
| `shift.variance.over` | Lebih {nominal} | Over by {nominal} |
| `shift.variance.exact` | Pas | Exact |
| `shift.openBills.warn` | Ada {n} bill terbuka. Bill dapat dibayar pada shift berikutnya. | {n, plural, one {There is # open bill.} other {There are # open bills.}} Bills can be paid in the next shift. |

**Tenant, alamat, dan halaman sistem**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `tenant.login.title` | Masuk ke {tenant} | Sign in to {tenant} |
| `tenant.login.notYours` | Bukan {tenant}? Periksa alamat. | Not {tenant}? Check the address. |
| `tenant.pairing.title` | Pasangkan perangkat ke {tenant} | Pair this device with {tenant} |
| `tenant.pairing.qr.scan` | Pindai QR | Scan QR |
| `tenant.pairing.qr.wrongAddress` | QR ini bukan untuk alamat ini. Buka alamat yang tertera pada QR. | This QR isn't for this address. Open the address shown on the QR. |
| `tenant.pairing.qr.fallback` | Atau buka {alamat} lalu ketik kode | Or open {alamat} and type the code |
| `tenant.sameDevice` | Perangkat ini juga dipakai untuk tenant lain. | This device is also used for another tenant. |
| `sys.picker.title` | Pilih aplikasi | Choose an app |
| `sys.picker.pos` / `sys.picker.pos.desc` | Terminal Kasir / Untuk kasir dan waiter di outlet | Point of Sale / For cashiers and waiters at the outlet |
| `sys.picker.admin` / `sys.picker.admin.desc` | Back-office / Untuk pemilik dan manager | Back office / For owners and managers |
| `auth.login.forgotHint` | Lupa kata sandi? Minta kode atur ulang dari Owner bisnis Anda. Bila akun Anda dipakai di beberapa bisnis, hubungi dukungan Solva. | Forgot your password? Ask your business Owner for a reset code. If your account is used for several businesses, contact Solva support. |
| `auth.login.haveInvite` / `auth.login.haveReset` | Punya kode undangan? / Punya kode atur ulang? | Have an invitation code? / Have a reset code? |
| `account.title` | Akun saya | My account |
| `account.password.current` / `.new` / `.repeat` | Kata sandi saat ini / Kata sandi baru / Ulangi kata sandi | Current password / New password / Repeat password |
| `account.password.wrongCurrent` | Kata sandi saat ini salah. | The current password is incorrect. |
| `member.add.title` | Undang anggota | Invite member |
| `member.add.already` | Email ini sudah menjadi anggota {tenant}. | This email is already a member of {tenant}. |
| `member.add.failed` | Tidak dapat membuat undangan. Periksa isian lalu coba lagi. | Couldn't create the invitation. Check your input and try again. |
| `member.remove.title` | Keluarkan {nama} dari {tenant}? | Remove {nama} from {tenant}? |
| `member.remove.body` | Akun tidak dihapus. {nama} kehilangan akses ke {tenant}; riwayat transaksi dan audit tetap tersimpan. | The account isn't deleted. {nama} loses access to {tenant}; transaction history and audit records are kept. |
| `member.remove.lastOwner` | Tidak dapat mengeluarkan satu-satunya Owner. | You can't remove the only Owner. |
| `invite.code.title` | Kode undangan untuk {email} | Invitation code for {email} |
| `invite.code.expires` | Berlaku {jam} jam (sampai {waktu}). | Valid for {jam} hours (until {waktu}). |
| `invite.code.shownOnce` | Kode ini hanya ditampilkan sekali. Sampaikan langsung kepada penerima; penerima menentukan kata sandinya sendiri. | This code is shown only once. Give it to the recipient in person; they choose their own password. |
| `invite.code.copy` / `invite.link.copy` | Salin kode / Salin alamat | Copy code / Copy address |
| `invite.code.fallback` | Atau buka {alamat} lalu masukkan email dan kode. | Or open {alamat} and enter the email and code. |
| `invite.status.pending` / `.expired` | Menunggu / Kedaluwarsa | Pending / Expired |
| `invite.revoke` / `invite.reissue` | Batalkan / Terbitkan ulang | Revoke / Reissue |
| `invite.revoke.confirm` | Batalkan undangan untuk {email}? Kode tidak dapat dipakai lagi dan entri Menunggu undangan dihapus dari daftar pengguna. | Revoke the invitation for {email}? The code can no longer be used and the pending entry is removed from the user list. |
| `invite.reissue.until` | Dapat diterbitkan ulang sampai {tanggal}. | Can be reissued until {tanggal}. |
| `member.status.pendingInvite` | Menunggu undangan | Pending invitation |
| `resetissue.confirm` | Terbitkan kode atur ulang untuk {nama}? | Issue a reset code for {nama}? |
| `resetissue.expires` | Berlaku {jam} jam (sampai {waktu}). | Valid for {jam} hours (until {waktu}). |
| `resetissue.refused` | Tidak dapat menerbitkan kode atur ulang untuk akun ini. Hubungi Operator Platform. | Couldn't issue a reset code for this account. Contact the Platform Operator. |
| `join.title` | Gabung ke {tenant} | Join {tenant} |
| `join.code` | Kode undangan | Invitation code |
| `join.password.hint` | Belum punya akun? Buat kata sandi baru. Sudah punya akun? Masukkan kata sandi Anda. | No account yet? Create a new password. Already have an account? Enter your password. |
| `join.submit` | Gabung | Join |
| `join.invalid` | Email, kode, atau kata sandi tidak sesuai, atau kode sudah kedaluwarsa. | The email, code, or password doesn't match, or the code has expired. |
| `join.done` | Selesai. Silakan masuk ke {tenant}. | Done. Please sign in to {tenant}. |
| `resetcode.title` | Atur ulang kata sandi — {tenant} | Reset password — {tenant} |
| `resetcode.code` | Kode atur ulang | Reset code |
| `resetcode.invalid` | Email atau kode tidak valid, atau kode sudah kedaluwarsa. | The email or code is invalid, or the code has expired. |
| `resetcode.done` | Kata sandi diperbarui. Silakan masuk. | Password updated. Please sign in. |
| `sys.session.title` | Sesi ini tidak berlaku untuk alamat ini | This session isn't valid for this address |
| `sys.session.body` | Masuk lagi untuk melanjutkan. | Sign in again to continue. |
| `account.signOut` | Keluar | Sign out |
| `sys.notFound.title` | Halaman tidak ditemukan | Page not found |
| `sys.notFound.body` | Alamat yang Anda buka tidak tersedia. Periksa kembali alamat, atau minta alamat yang benar dari administrator bisnis Anda. | The address you opened isn't available. Check it again, or ask your business administrator for the right address. |
| `sys.suspended.title` | Layanan tidak tersedia | Service unavailable |
| `sys.suspended.body` | Layanan untuk alamat ini sedang tidak tersedia. Hubungi penyedia layanan. | Service for this address is currently unavailable. Contact your service provider. |

**Galat: blok kode, panel, layar pemulihan, reset aplikasi, cetak** (kalimat tindakan per kode: §5.5.2)

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `err.code.label` / `err.id.label` | Kode / ID | Code / ID |
| `err.id.local` | ID dibuat di perangkat ini | ID created on this device |
| `err.copy` | Salin kode | Copy code |
| `err.copied` | Disalin | Copied |
| `err.copyFailed` | Tidak dapat menyalin. Tekan lama pada kode lalu pilih Salin. | Couldn't copy. Press and hold the code, then choose Copy. |
| `err.retry` | Coba lagi | Try again |
| `err.formKept` | Isian Anda tidak hilang. | Your input has not been lost. |
| `err.panel.title` | Panel ini bermasalah | This panel has a problem |
| `err.panel.body` | Layar ini mengalami masalah. Ketuk Coba lagi; draf Anda aman. | This screen ran into a problem. Tap Try again; your draft is safe. |
| `err.panel.reload` | Coba lagi | Try again |
| `err.panel.home` | Kembali ke beranda | Back to home |
| `err.panel.reloadScreen` | Masih bermasalah? Muat ulang layar. | Still not working? Reload the screen. |
| `err.panel.cartSaved` | Keranjang tersimpan di perangkat ini. | The cart is saved on this device. |
| `err.screen.title` | Layar ini bermasalah | This screen has a problem |
| `err.screen.draftSafe` | Keranjang dan bill Anda tersimpan di perangkat ini. | Your cart and bills are saved on this device. |
| `err.screen.draftUnsaved` | Perubahan yang belum Anda simpan mungkin hilang. | Changes you haven't saved may be lost. |
| `err.screen.reload` | Muat ulang | Reload |
| `err.screen.export` | Ekspor transaksi pending | Export pending transactions |
| `err.reset.title` | Aplikasi tidak dapat dimulai | The app couldn't start |
| `err.reset.safe` | Data di perangkat ini, termasuk transaksi yang belum terkirim, tidak dihapus. | Data on this device, including unsent transactions, has not been deleted. |
| `err.reset.action` | Reset aplikasi | Reset app |
| `err.reset.confirm` | Ketik RESET untuk melanjutkan. Langkah ini menghapus cache aplikasi tenant ini lalu memuat ulang. Data lokal dan transaksi pending tidak dihapus. Butuh internet. | Type RESET to continue. This clears this tenant's app cache and reloads. Local data and pending transactions are not deleted. Requires internet. |
| `err.reset.typeLabel` | Ketik RESET | Type RESET |
| `err.screen.safeMode` | Buka halaman pemulihan (mode aman) | Open recovery page (safe mode) |
| `err.reset.go` | Lanjutkan reset | Continue reset |
| `err.reset.offline` | Reset aplikasi membutuhkan internet. | Resetting the app requires internet. |
| `err.reset.contact` | Hubungi manager atau dukungan Solva dengan kode ini; data Anda tidak hilang. | Contact your manager or Solva support with this code; your data is safe. |
| `print.failed.banner` | {n, plural, one {Struk {nomor} belum tercetak.} other {# struk belum tercetak.}} | {n, plural, one {Receipt {nomor} wasn't printed.} other {# receipts weren't printed.}} |
| `print.reprintAll` | Cetak ulang semua | Reprint all |
| `print.printerStatus` | Status printer | Printer status |

**Empty state dan galat umum**

| Kunci | `id-ID` | `en-US` |
|---|---|---|
| `empty.products.title` | Belum ada produk | No products yet |
| `empty.search.title` | Tidak ada hasil untuk "{kata}" | No results for "{kata}" |
| `empty.offline.title` | Fitur ini membutuhkan internet | This feature requires internet |
| `empty.noAccess.title` | Anda tidak memiliki akses | You don't have access |
| `error.server.generic` | Terjadi kesalahan sistem. Salin kode ini dan hubungi pengembang. | A system error occurred. Copy this code and contact the developer. |
| `error.field.required` | {label} wajib diisi | {label} is required |
| `error.login.invalid` | Email atau kata sandi salah | Incorrect email or password |
| `error.login.rateLimit` | Terlalu banyak percobaan. Coba lagi dalam sekitar {menit} menit. | Too many attempts. Try again in about {menit} minutes. |
| `admin.offline` | Back-office membutuhkan koneksi internet. | The back office requires an internet connection. |
| `admin.report.busy` | Laporan lain sedang diproses. Coba lagi sebentar lagi. | Another report is being processed. Try again in a moment. |
| `admin.settings.effectNext` | Berlaku untuk transaksi berikutnya; transaksi lama tidak berubah. | Applies to future transactions; past transactions are unchanged. |

---

## 7. Aksesibilitas

### 7.1 Target dan Cakupan

Target: **WCAG 2.2 level AA** untuk `/admin` dan `/pos`, dengan peningkatan di area POS (target sentuh 44–56 px, kontras AA pada semua teks informasi, tidak mengandalkan warna). Lingkungan nyata: layar HP/tablet Android dengan cahaya outlet terang, PC Windows dengan keyboard + scanner, pengguna yang terburu-buru. Pembaca layar: TalkBack (Android) dan NVDA (Windows) sebagai acuan uji (`DIUSULKAN`).

| Kriteria WCAG | Penerapan |
|---|---|
| 1.4.3 Kontras teks | ≥ 4,5 : 1 (besar ≥ 3 : 1); angka dihitung di Lampiran B |
| 1.4.11 Kontras non-teks | Batas kontrol `line-input` 3,11; fokus 5,31; grafik ≥ 3 : 1; ikon bermakna ≥ 3 : 1 |
| 1.4.1 Penggunaan warna | Setiap status: warna + ikon + teks (§2.1.5/6); grafik: label/pola/tabel (§2.1.7) |
| 1.4.4/1.4.10 Ubah ukuran & reflow | Teks hingga 200%; reflow tanpa scroll horizontal pada 320 CSS px (kecuali tabel data/grid yang memang dua-dimensi) |
| 1.4.12 Jarak teks | Tidak ada kontainer tinggi/lebar tetap yang memotong teks |
| 2.1.1/2.1.2 Keyboard | Semua fungsi dapat dipakai dengan keyboard; tidak ada perangkap fokus (selain dialog modal yang sah) |
| 2.4.7 / 2.4.11 Fokus terlihat | Cincin 2 px `focus-ring` + offset 2 px; elemen lengket tidak menutupi elemen berfokus (scroll-padding sesuai tinggi header/bilah total) |
| 2.5.5 / 2.5.8 Ukuran target | **44 px minimum** (melampaui 24 px AA 2.5.8), 48/56 px untuk aksi kasir |
| 3.3.1–3.3.4 Input | Label, error teks, saran perbaikan, konfirmasi untuk aksi berisiko (§5.1) |
| 4.1.2 / 4.1.3 Nama, peran, pesan status | ARIA ringkas (§7.5); pesan status via `aria-live` |

### 7.2 Kontras — Ringkasan Pasangan Kunci

(Hitungan lengkap: **Lampiran B**.)

| Pasangan | Rasio | Lolos |
|---|---|---|
| `ink` `#1B1D21` di atas `surface` putih | 16,88 | AA/AAA |
| `ink-soft` `#52565F` di atas putih | 7,36 | AA/AAA |
| `ink-muted` `#6B7079` di atas putih / `surface-hover` | 4,98 / 4,56 | AA |
| `ink-muted` di atas `surface-sunken` | 4,25 | **Gagal** → dilarang (pakai `ink-soft`) |
| Putih di atas `action` `#46780D` | 5,31 | AA |
| Putih di atas `primary-500` `#76B617` (referensi) | **2,48** | **Gagal** → tidak dipakai |
| Putih di atas `primary-600` `#5E9A10` | 3,44 | Hanya teks besar/ikon/grafik |
| `ink-brand` `#46780D` di atas putih / `surface-hover` | 5,31 / 4,87 | AA |
| `on-action-soft` `#3D660F` di atas `action-soft` | 6,36 | AA |
| `line-input` `#8E929C` di atas putih | 3,11 | Komponen UI (1.4.11) |
| `focus-ring` `#46780D` di atas putih | 5,31 | 1.4.11 |
| Teks keluarga semantik (`*-ink`) di atas `*-soft` | 5,49–7,23 | AA |
| `solid` semantik + putih | 5,04–6,86 | AA |

### 7.3 Navigasi Keyboard dan Pemindai di `/pos`

**Aturan dasar:** urutan Tab mengikuti urutan visual (top bar → nav → katalog → keranjang → aksi); tidak ada `tabindex` > 0; dialog menjebak fokus dan mengembalikannya; `Esc` menutup/mundur; `Enter` mengaktifkan tombol primer pada dialog dan form.

**Pemindai barcode (mode keyboard)**
1. Rentetan karakter dengan jeda antar-karakter sangat singkat (usulan ≤ 50 ms) diakhiri `Enter` dikenali sebagai **scan** dan ditangani global — tidak peduli elemen mana yang berfokus (kecuali kolom numerik/PIN yang aktif: pemindaian diabaikan di sana).
2. Scan **tidak** memicu pintasan keyboard (karakter tidak diteruskan ke handler pintasan selama burst).
3. Setelah scan, fokus tidak berpindah; umpan balik di wilayah `aria-live` ("Kopi Bubuk 200g, 2").

**Pintasan (Windows/keyboard; `DITETAPKAN`, dapat disesuaikan — `DOQ-16`)**

| Pintasan | Aksi | Layar |
|---|---|---|
| `F2` atau `/` | Fokus ke pencarian | SCR-P04/P06 |
| `F4` | Bayar (bila keranjang tidak kosong dan shift terbuka) | SCR-P04/P06 |
| `↑` / `↓` | Pilih baris keranjang | Panel keranjang |
| `+` / `−` | Tambah/kurangi kuantitas baris terpilih | Panel keranjang |
| `Delete` | Hapus baris terpilih (L1, ada "Urungkan") | Panel keranjang |
| `Enter` | Selesai (di layar bayar bila valid); "Transaksi baru" (di layar sukses) | SCR-P08/P09 |
| `Esc` | Kembali/tutup | semua |
| `Ctrl` + `K` | Bantuan pintasan (daftar) | semua |

Di HP/tablet sentuh, pintasan tidak diperlukan; seluruh fungsi tersedia lewat sentuh.

### 7.4 Sentuh, Zoom, dan Preferensi Sistem

| Aspek | Aturan |
|---|---|
| Ukuran sentuh | ≥ 44 px (default `/pos` 48; aksi utama 56); jarak ≥ 8 px (§2.3.2) |
| Zoom | Jangan menonaktifkan zoom pinch (`user-scalable` tidak dimatikan); tata letak bertahan pada 200%; di Windows zoom browser 200% pada 1366×768 tetap menyisakan jalur kasir (panel keranjang boleh menjadi bottom sheet) |
| `prefers-reduced-motion` | §2.6 |
| `prefers-contrast: more` | Border kartu naik ke `line-strong`, teks `ink-muted` → `ink-soft`, ring fokus 3 px |
| `forced-colors` (Windows High Contrast) | Semua kontrol memiliki border nyata; ikon memakai `currentColor`; status tetap terbaca karena ikon+teks |
| `prefers-color-scheme` | Hanya jika dark mode diaktifkan (DOQ-03) |
| Bahasa | Atribut `lang` pada `<html>` mengikuti locale aktif dan berubah saat ganti bahasa; nomor/kode dibungkus `lang`-netral |

### 7.5 Label ARIA Ringkas dan Landmark

| Elemen | Pola |
|---|---|
| Landmark | `header` (banner), `nav` (aria-label "Navigasi utama"), `main` (satu per halaman), `aside` (keranjang, "Keranjang"), `search` (pencarian). Skip-link "Lewati ke konten" |
| Tombol ikon | `aria-label` kunci terjemahan ("Tambah pelanggan", "Hapus {nama}") |
| Status koneksi | `role="status"`; teks tersembunyi lengkap ("Offline, 3 transaksi belum terkirim") |
| Kuantitas | Grup `role="group"` `aria-label="Kuantitas {nama}"`; tombol `−`/`+` berlabel |
| Total | `aria-live="polite"` dengan debounce 500 ms agar tidak menyusul tiap ketukan |
| Dialog | `role="dialog"`/`alertdialog`, `aria-modal`, `aria-labelledby`, fokus terkelola |
| Tabel | `<th scope>`, `aria-sort`, `caption` |
| Toast | `role="status"` (galat `alert`) |
| Kartu meja | Nama aksesibel "Meja 5, Terisi, 2 bill, Rp135.655" |
| Grafik | `role="img"` + ringkasan; tabel data setara |
| Status berwarna | Selalu ada teks; ikon dekoratif `aria-hidden="true"` |

### 7.6 Pengujian Aksesibilitas (acuan penerimaan)

1. Pindai otomatis (axe) pada semua layar bernomor di Bab 4: 0 pelanggaran serius.
2. Uji keyboard menyeluruh jalur: login PIN → buka shift → scan/tambah → bayar → selesai → tutup shift (tanpa mouse).
3. Simulasi buta warna (protanopia/deuteranopia/tritanopia) pada kisi meja, status operasional, dan grafik: setiap perbedaan tetap dapat dikenali lewat ikon/teks/pola.
4. Uji zoom 200% dan lebar 320 px.
5. Uji TalkBack (Android) pada SCR-P04/P08 dan NVDA (Windows) pada SCR-A03/A05.
6. Pengukuran kontras mengikuti §0.3; token baru wajib mencatat rasio.


---

## 8. Pemetaan Token ke Implementasi (Tailwind)

> Bagian ini **konseptual**: ia menetapkan nama, aturan, dan padanan. File tema/CSS/konfigurasi sesungguhnya dibuat saat implementasi (di luar dokumen ini). Versi Tailwind belum ditetapkan di PRD → rekomendasi **Tailwind v4** (tema via `@theme`); padanan v3 (`theme.extend`) memakai **nama utilitas yang sama** (`DOQ-17`).

### 8.1 Arsitektur Token

| Lapis | Isi | Boleh dipakai komponen? |
|---|---|---|
| **L1 Primitif** | `primary-50…950`, `neutral-0…950`, nilai keluarga semantik (`#1A7F46`, …), skala spasi, radius, bayangan | **Tidak langsung** (hanya dirujuk lapis L2) — kecuali yang disebut eksplisit: `primary-*` pada ilustrasi/heatmap, `chart-*`, `seq-*`, `div-*` |
| **L2 Peran** | `app`, `surface*`, `ink*`, `line*`, `action*`, `on-action*`, `focus-ring`, `{success,warning,danger,info,violet,teal}-{solid,soft,line,ink}`, status operasional dan status meja (alias ke keluarga) | **Ya — jalur normal** |
| **L3 Komponen** (opsional) | Variabel milik komponen bila perlu (mis. tinggi tombol), tetap menunjuk ke L2 | Ya, di dalam komponen |

Satu **sumber kebenaran**: semua nilai ada di satu definisi tema; dokumen ini menjadi spesifikasinya. Dark mode kelak = pengesampingan nilai **L2** di bawah atribut tema (mis. `data-theme="dark"`), bukan perubahan komponen.

### 8.2 Aturan Penamaan

| Aturan | Contoh benar | Contoh salah |
|---|---|---|
| `kebab-case`, huruf kecil | `surface-subtle`, `on-action-soft` | `surfaceSubtle`, `Surface_Subtle` |
| Nama peran menyatakan **fungsi**, bukan nilai | `action`, `ink-muted`, `danger-ink` | `green`, `lightGray`, `redText` |
| Skala numerik hanya di L1 | `primary-700`, `neutral-300` | `action-700` |
| Pasangan latar–teks berpasangan | `bg-action` + `text-on-action`; `bg-success-soft` + `text-success-ink` | `bg-action` + `text-white` |
| Ukuran kontrol: `control-{sm|md|lg|xl}` | `h-control-lg` | `h-12` untuk tombol |
| Status memakai nama enum UI (§2.1.5/6) | `status="offline"` → keluarga `warning` | `bg-orange-100` di komponen status |
| Satu nama = satu makna di seluruh aplikasi | — | `soft` dipakai juga untuk "lunak" non-warna |

### 8.3 Tabel Pemetaan Token → Variabel → Utilitas Tailwind

| Kategori | Nama token | Variabel tema (konseptual) | Utilitas Tailwind |
|---|---|---|---|
| Warna primitif | `primary-50…950` | `--color-primary-50` … `--color-primary-950` | `bg-primary-500`, `text-primary-700` (terbatas, §8.1) |
| | `neutral-0…950` | `--color-neutral-0` … | `bg-neutral-100` (terbatas) |
| Warna peran: permukaan | `canvas`, `app`, `surface`, `surface-subtle`, `surface-hover`, `surface-sunken`, `surface-inverse`, `scrim` | `--color-canvas`, `--color-app`, `--color-surface`, `--color-surface-hover`, … | `bg-app`, `bg-surface`, `bg-surface-sunken` |
| Warna peran: teks | `ink`, `ink-soft`, `ink-muted`, `ink-disabled`, `ink-inverse`, `ink-brand` | `--color-ink`, `--color-ink-soft`, … | `text-ink`, `text-ink-muted`, `text-ink-brand` |
| Warna peran: garis | `line-subtle`, `line`, `line-strong`, `line-input` | `--color-line-subtle`, … | `border-line`, `border-line-input`, `divide-line-subtle` |
| Warna peran: aksi | `action`, `action-hover`, `action-active`, `action-soft`, `action-soft-hover`, `on-action`, `on-action-soft`, `brand`, `focus-ring` | `--color-action`, … | `bg-action`, `hover:bg-action-hover`, `active:bg-action-active`, `text-on-action`, `ring-focus-ring` |
| Warna semantik | `{success,warning,danger,info,violet,teal}-{solid,soft,line,ink}` | `--color-success-solid`, `--color-success-soft`, `--color-success-line`, `--color-success-ink`, … | `bg-success-soft`, `border-success-line`, `text-success-ink` |
| Warna grafik | `chart-1…5`, `seq-1…5`, `div-neg-2…div-pos-2` | `--color-chart-1`, `--color-seq-1`, `--color-div-neg-2` | `fill-chart-1`, `bg-seq-3`, `stroke-chart-2` |
| Font | `font-sans`, `font-mono` | `--font-sans`, `--font-mono` | `font-sans`, `font-mono` |
| Ukuran teks | `total-xl`, `total-lg`, `display`, `h1`, `h2`, `h3`, `title`, `body-lg`, `body`, `body-sm`, `caption`, `label`, `label-sm`, `button-lg`, `button`, `num-xl`, `num-lg`, `num-md`, `num-sm`, `code-id` | `--text-h1: 1.5rem; --text-h1--line-height: 2rem;` dst. (+ bobot lewat `--font-weight-*`) | `text-h1`, `text-body`, `text-num-md font-semibold` |
| Angka tabular | (aturan) | — | `tabular-nums` (wajib untuk angka uang) |
| Spasi | skala 4 px | `--spacing: 0.25rem` | `p-4`, `gap-3`, `space-y-6` |
| Spasi peran | `gutter`, `card-pad`, `grid-gap`, `section-gap` | Komposisi utilitas di komponen layout (tabel §2.3.1) | `px-4 sm:px-5 lg:px-6` dll. |
| Tinggi kontrol | `control-sm/md/lg/xl`, `key` | `--spacing-control-sm: 2.25rem`, `-md: 2.75rem`, `-lg: 3rem`, `-xl: 3.5rem`; `--spacing-key` | `h-control-lg`, `min-h-control-md`, `size-key` |
| Radius | `radius-xs/sm/md/control/lg/card/modal/full` | `--radius-xs: .25rem` … `--radius-control: .625rem`, `--radius-card: 1rem`, `--radius-modal: 1.25rem` | `rounded-control`, `rounded-card`, `rounded-modal` |
| Border | `border-hairline/default/emphasis` | Lebar bawaan Tailwind | `border`, `border-2` |
| Bayangan | `shadow-card`, `shadow-pill`, `shadow-popover`, `shadow-modal` | `--shadow-card`, … (nilai §2.4.3) | `shadow-card`, `shadow-modal` |
| Opasitas | `opacity-scrim/hover-tint/pressed-tint` | warna `scrim` dan alfa lewat `color-mix`/token | `bg-scrim`; tint via `hover:bg-ink/[.04]` hanya lewat token alfa |
| Z-index | `z-base…z-system` | `--z-sticky: 10; --z-nav: 20; --z-header: 30; --z-banner: 35; --z-dropdown: 40; --z-modal-backdrop: 50; --z-modal: 60; --z-toast: 70; --z-pin: 80; --z-system: 90` | `z-(--z-modal)` (atau utilitas kustom `z-modal`) |
| Durasi | `duration-fast/base/slow/sheet` | `--duration-fast: 100ms` … | `duration-(--duration-base)` / utilitas kustom |
| Easing | `ease-standard/decelerate/accelerate` | `--ease-standard: cubic-bezier(0.2,0,0,1)` … | `ease-standard` |
| Breakpoint | `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536` | `--breakpoint-sm` … (default Tailwind) | `sm:`, `md:`, `lg:`, `xl:`, `2xl:` |
| Orientasi/pointer | portrait, landscape, coarse, fine | media query | `portrait:`, `landscape:`, `pointer-coarse:`, `pointer-fine:` |
| Layout | `sidebar-w` 240, `rail-w` 72, `header-h` 64/56, `topbar-pos-h` 56, `bottomnav-h` 64, `cart-panel-w` 400/440 | `--spacing-sidebar: 15rem; --spacing-rail: 4.5rem; --spacing-header: 4rem; --spacing-topbar: 3.5rem; --spacing-bottomnav: 4rem; --spacing-cart: 25rem` | `w-sidebar`, `w-rail`, `h-header`, `w-cart` |
| Lebar konten/dialog | `content-max`, `form-max`, `dialog-w-{sm,md,lg,xl}` | `--container-content: 90rem; --container-form: 45rem; --container-dialog-sm: 25rem; -md: 32.5rem; -lg: 45rem; -xl: 60rem` | `max-w-content`, `max-w-dialog-md` |
| Ikon | `icon-sm/md/lg/xl/2xl` | 16/20/24/32/48 px | `size-4`, `size-5`, `size-6`, `size-8`, `size-12` |
| Tema gelap | — | pengesampingan L2 di `[data-theme="dark"]` | — |

**Tailwind palet bawaan dinonaktifkan** (mengosongkan namespace `--color-*` bawaan) sehingga `bg-green-500`, `text-gray-600` dst. **tidak tersedia**; hanya token di atas yang dapat dipakai.

### 8.4 Aturan Penggunaan Token

| # | Aturan |
|---|---|
| T-01 | **Jangan hardcode warna**: tidak ada hex/`rgb()`/`hsl()`/nama warna di komponen, CSS, atau `style`. Semua dari token L2 |
| T-02 | **Jangan hardcode ukuran**: tidak ada `px` arbitrer (`w-[347px]`, `text-[13px]`, `h-[52px]`). Pakai skala spasi/token. Ukuran baru = tambahkan token + dokumentasi di Bab 2 |
| T-03 | **Komponen memakai token peran (L2)**, bukan primitif. Contoh: tombol memakai `bg-action`, bukan `bg-primary-700` |
| T-04 | **Pasangan latar + teks harus dari tabel kontras** (Lampiran B). Teks putih hanya di atas `action*`, `*-solid`, `surface-inverse`, `primary-700+` |
| T-05 | **Status operasional/meja hanya lewat enum** (§2.1.5/6) dan satu komponen status; tidak boleh memilih warna ad hoc |
| T-06 | **Angka uang/kuantitas/total/nomor selalu `tabular-nums`**; rata kanan di kolom |
| T-07 | **Target sentuh**: kontrol di `/pos` tidak lebih rendah dari `control-md` (44); default `control-lg` |
| T-08 | **Fokus**: jangan `outline-none` tanpa `focus-visible:ring-2 ring-focus-ring ring-offset-2` |
| T-09 | **Tidak ada opacity untuk menandai disabled**; pakai `surface-sunken` + `ink-disabled` |
| T-10 | **Hijau terang `primary-500` bukan warna teks/tombol-berteks-putih** (§2.1.1) |
| T-11 | **Tidak ada string UI literal**; teks lewat kunci terjemahan (BR-I18N-001) |
| T-12 | **Hover hanya untuk `(hover: hover)`**; jangan menaruh informasi hanya di hover |
| T-13 | **Animasi** memakai token durasi/easing dan menghormati `prefers-reduced-motion` |
| T-14 | **Ikon hanya dari set terpilih** (§2.7), warna `currentColor`, ukuran dari token |
| T-15 | **Token baru** wajib: nama peran, nilai, penggunaan, rasio kontras, padanan Tailwind — ditambahkan ke dokumen ini sebelum dipakai |
| T-16 | **Tidak ada warna tenant** (MVP): identitas tenant = nama + avatar `primary-700`; tidak ada token/pemilih/validasi warna tenant. Jangan menambahkan warna per tenant tanpa keputusan baru |
| T-18 | **Galat mengikuti tiga tingkat §5.5**: T1 inline/toast tanpa kode; T2 indikator + coba ulang tanpa dialog; T3 hanya lewat CMP-36 (`KODE#id` + Salin). Kalimat tindakan dari katalog §5.5.2; kode baru wajib ditambahkan ke katalog. Tidak ada tombol "Laporkan masalah" |

**Contoh pemakaian konseptual (bukan file):**

| Komponen | Komposisi utilitas (token peran) |
|---|---|
| Tombol primer `/pos` | `h-control-lg px-5 rounded-control bg-action text-on-action text-button-lg hover:bg-action-hover active:bg-action-active focus-visible:ring-2 ring-focus-ring ring-offset-2` |
| Tombol "Bayar" | sama dengan di atas, tinggi `h-control-xl`, `w-full` |
| Kartu | `bg-surface rounded-card border border-line shadow-card p-4` |
| Tab pill tidak aktif | `h-control-lg px-4 rounded-control bg-surface-sunken text-ink text-label` |
| Tab pill aktif | `h-control-lg px-4 rounded-control bg-action text-on-action text-label` |
| Chip status "Offline" | `h-7 px-2.5 rounded-md border border-warning-line bg-warning-soft text-warning-ink text-label-sm` + ikon `wifi-off` (nilai `h-7` = 28 px = token chip) |
| Angka total | `text-total-lg tabular-nums text-ink` |

### 8.5 Panduan bagi AI Coding Agent

**Urutan kerja:**
1. Baca **Bab 2 (token)** dan **Bab 3 (komponen)**; baca bagian layar di **Bab 4** untuk layar yang dikerjakan; cek **FR/BR** yang dirujuk di PRD.
2. Bangun **primitif UI** lebih dulu (CMP-01…08, 28, 30) dengan state lengkap (§3.0.1), baru komponen domain (CMP-21…27, 31).
3. Untuk tiap komponen tentukan **token peran**; bila tidak ada token yang cocok → **jangan membuat nilai baru di komponen**; usulkan token baru (T-15) atau catat sebagai pertanyaan.
4. Implementasikan **semua state** (default/hover/focus/active/disabled/loading/error) dan perilaku **tiga breakpoint**; uji pada 360×800, 800×1280, 1280×800, 1366×768.
5. Pastikan **aksesibilitas** (§7): label, fokus, live region, kontras sesuai Lampiran B, tidak mengandalkan warna.
6. Seluruh teks lewat kunci terjemahan (`id-ID`, `en-US`); jangan menyisipkan teks kasir yang belum ada di §6.5 tanpa menambah kunci.
7. **Jangan menghitung uang di UI**; tampilkan angka dari package hitung bersama (AP-06).
8. **Jangan mengarang** perilaku bisnis yang tidak ada di PRD; bila ragu, gunakan perilaku paling konservatif dan tandai di komentar/isu sebagai `PERLU KONFIRMASI`.
9. Jangan menyalin isi/merek dari gambar referensi; logo Solva = placeholder teks (DOQ-12).

**Definisi selesai sebuah komponen:** (a) hanya token L2; (b) semua state; (c) responsif 3 kelas; (d) lolos pindai a11y + uji keyboard; (e) tanpa string literal; (f) kontras sesuai tabel; (g) dokumentasi varian di galeri komponen internal (bila ada).

### 8.6 Versi dan Perubahan Token

| Aspek | Aturan |
|---|---|
| Penomoran | Semver pada dokumen ini: perubahan nilai = minor; token baru = minor; token dihapus/diganti nama = mayor |
| Catatan perubahan | Setiap perubahan dicatat di tabel revisi (kepala dokumen) |
| Sumber kebenaran | Dokumen ini → definisi tema → komponen. Jika berbeda, dokumen ini yang benar sampai direvisi |
| Penyetelan estimasi | Nilai `ESTIMASI DARI GAMBAR` diubah di satu token; tidak lewat komponen |

---

## 9. Open Questions Desain dan Traceability

### 9.1 Open Questions Desain (status 2026-11-19: **seluruh DOQ-01…26 TERJAWAB** (09/14/18 sudah masuk PRD; 15, 23, 24, 25, 26 dijawab/direvisi 2026-11-19); **tidak ada yang masih `PERLU KONFIRMASI`**)

Kolom 3 berisi jawaban user (`DIJAWAB`) atau rekomendasi sementara. Tidak ada pertanyaan yang **memblokir** dokumen.

| ID | Pertanyaan | Rekomendasi (dipakai sementara) | Opsi lain | Dampak |
|---|---|---|---|---|
| **DOQ-01** | Keluarga font | **DIJAWAB user: Plus Jakarta Sans** (self-host, variabel, OFL) | Cadangan: Inter (juga untuk angka bila `tnum` tidak tersedia) | Syarat verifikasi `tnum` sebelum implementasi; mengganti font hanya mengubah token `font-sans` |
| **DOQ-02** | Warna aksi | **DIJAWAB user: `primary-700` `#46780D`**; `primary-500` hanya identitas | — | Final |
| **DOQ-03** | Dark mode masuk MVP? | **DIJAWAB user: tidak, pasca-MVP**; token L2 siap | — | Final untuk MVP |
| **DOQ-04** | Latar aplikasi | **DIJAWAB user: putih seperti referensi** (`app` = `#FFFFFF`; border kartu `line`; hover memakai `surface-hover` `#F4F5F6`) | — | Final |
| **DOQ-05** | Mode padat 36 px di `/pos` | **DIJAWAB user: tidak**; min 44 px di `/pos` | — | Final |
| **DOQ-06** | Perangkat acuan desain/uji | **DIJAWAB user: set standar** — HP 360×800, tablet 800×1280 dan 1280×800, Windows 1366×768 | — | Final |
| **DOQ-07** | "Hitung per pecahan" di Tutup shift | **DIJAWAB user: ya, opsional** (bantuan hitung; hanya total yang disimpan) | — | Final |
| **DOQ-08** | Denah meja | **DIJAWAB user: kisi per area** | Denah spasial (ditunda; butuh perubahan master meja) | Final untuk MVP |
| **DOQ-09** | Status "Menunggu bayar" (pra-bill dicetak) | **DIJAWAB user dan SUDAH MASUK PRD**: event `PREBILL_PRINTED` (BR-FNB-010, FR-FNB-014); status diturunkan dari snapshot open bill | — | Final; skema mengikuti sesi SCHEMA |
| **DOQ-10** | Bunyi/getar | **DIJAWAB user: tanpa bunyi/getar** (hanya visual) | — | Final; tidak ada pengaturan bunyi di SCR-P16 |
| **DOQ-11** | Pustaka ikon | **DIJAWAB user: Lucide** | — | Final |
| **DOQ-12** | Logo/identitas merek Solva | **DIJAWAB user: placeholder teks "Solva POS"** sampai logo tersedia | Logo sendiri (kelak) | Warna brand dapat disesuaikan saat logo ada |
| **DOQ-13** | Gambar produk di katalog kasir | **DIJAWAB user: tanpa gambar di MVP**; kartu teks + inisial kategori. Gambar menjadi fitur setelah MVP | Gambar produk (unggah di `/admin`, cache di Dexie) setelah MVP | Final untuk MVP; menambah gambar kelak = skema produk + penyimpanan lokal + sync |
| **DOQ-14** | Kunci layar otomatis saat idle | **DIJAWAB user dan SUDAH MASUK PRD**: BR-AUT-015 (10 menit; state tidak hilang; timer berhenti saat pembayaran/dialog PIN supervisor; pembuka = staf yang sama; override Supervisor+ hanya untuk Tutup shift; audit terbatas) | — | Final |
| **DOQ-15** | Login back-office: SSO, "Lupa kata sandi", username | **DIJAWAB user (direvisi 2026-11-19): tanpa SSO; login hanya email + kata sandi (tanpa username); tanpa email di MVP — TIDAK ada tautan/layar "Lupa kata sandi" mandiri, tanpa verifikasi email; undangan manual; kata sandi diatur ulang lewat kode sekali pakai yang diterbitkan Owner atau Operator Platform dan disampaikan manual (diperbarui 2026-11-19).** Sebelumnya (2026-11-18): lupa kata sandi per tenant dengan akun terpisah per tenant | Opsi tidak dipilih: lupa kata sandi via email; akun terpisah per tenant | Final; SCR-A01 hanya teks bantuan statis |
| **DOQ-16** | Pintasan keyboard Windows | **DIJAWAB user: pakai set usulan §7.3** | — | Final |
| **DOQ-17** | Versi Tailwind | **DIJAWAB user: v4 (`@theme`)** | — | Final |
| **DOQ-18** | Alur F&B waiter ↔ kasir | **DIJAWAB user dan SUDAH MASUK PRD**: waiter mencatat di HP (register `PELAYAN`, BR-FNB-011), bayar di kasir lewat **serah-terima sukarela** (BR-FNB-012: `BILL_HANDED_OVER` → `BILL_ACCEPTED`, pembatalan `BILL_HANDOVER_CANCELED`, hanya online, pra-syarat event ACK, tujuan register `KASIR`) dan BR-FNB-013 | — | Final; register `PELAYAN` dikecualikan dari BR-SHF-010 untuk open bill/pra-bill/void item/serah-terima |
| **DOQ-19** | Satu perangkat untuk lebih dari satu tenant | **DIJAWAB user: boleh lebih dari satu tenant; penyimpanan lokal dipisah total.** Tanpa pengalih tenant in-app (tiap tenant = alamat/PWA sendiri); penanda tenant (CMP-35) selalu terlihat | Opsi tidak dipilih: satu tenant per perangkat; pengalih tenant in-app | Final; SCR-S03 hanya untuk `/admin` |
| **DOQ-20** | QR pairing memuat apa? | **DIJAWAB user:** alamat lengkap `<DOMAIN>/<slug>/pos` **+ kode pairing di fragmen URL** (`#`, tidak dikirim ke server); kode sekali pakai, kedaluwarsa 15 menit; **ketik kode manual tetap tersedia** | Opsi tidak dipilih: alamat saja; kode di query string | Final; SCR-P01, SCR-A08 |
| **DOQ-21** | Halaman tenant ditangguhkan: samakan dengan 404? | **DIJAWAB user:** 404 generik untuk slug tak dikenal; halaman "tidak tersedia" (SCR-S01, tanpa nama tenant dan alasan) untuk tenant ditangguhkan | Opsi tidak dipilih: disamakan dengan 404 | Final |
| **DOQ-22** | Identitas tenant | **DIJAWAB user. Warna:** tidak ada fitur/pengaturan warna tenant di MVP (avatar `primary-700`, aksen = warna primer). **Nama:** nama tampilan tenant (maks. 40 karakter) **diatur Operator Platform saat membuat tenant; perubahan lewat operator**; **tidak ada layar pengaturan nama untuk Owner di `/admin`**. **Domain kustom per tenant:** ditunda, tanpa layar/pengaturan di MVP. Format slug: ditegakkan ARCHITECTURE/PRD, tidak memengaruhi desain | Opsi tidak dipilih: Owner mengatur nama di `/admin` | Final; tidak ada layar baru. SCHEMA: nama tenant ditulis operator |
| **DOQ-23** | Halaman reset statis (SCR-S04) dan ekspor transaksi pending | **DIJAWAB user (2026-11-19): SCR-S04 menyediakan Ekspor transaksi tertunda** (sesuai ARCHITECTURE §9.7.6; IndexedDB polos tanpa bundle) | Opsi tidak dipilih: tanpa ekspor di halaman statis | Final |
| **DOQ-24** | Pengalih tenant sederhana untuk akun yang punya keanggotaan di beberapa tenant | **DIJAWAB user (2026-11-19): tidak perlu pengalih tenant** — akun global, tetapi **cookie sesi per slug** dan login terpisah per tenant; Keluar hanya mengakhiri sesi tenant itu | Opsi usulan tidak dipilih: daftar "Tenant saya" di menu avatar | Final |
| **DOQ-25** | Aturan pengelolaan anggota, undangan, dan atur ulang | **DIJAWAB user (2026-11-19):** undangan dan atur ulang **tanpa email** memakai **kode sekali pakai terikat email** (undangan **72 jam**, atur ulang **24 jam**) yang diterbitkan Owner/Operator dan disampaikan manual; penerima memasukkan **email + kode + kata sandi pilihannya sendiri** (akun baru) atau kata sandi akun yang ada; **tanpa kata sandi sementara dan tanpa "wajib ganti kata sandi"**. **Owner hanya mereset akun yang keanggotaannya hanya di tenantnya**; akun multi-tenant hanya oleh **Operator Platform atau pemiliknya**; penolakan ke Owner memakai pesan generik "Hubungi Operator Platform" (tidak mengakui akun multi-tenant). Hasil undangan **sama** untuk akun baru/lama | Opsi usulan tidak dipilih: kata sandi sementara; tombol nonaktif dengan alasan multi-tenant | Final; rincian format kode, kebijakan kata sandi, dan audit di PRD/ARCHITECTURE |
| **DOQ-26** | Alamat halaman penerima dan daftar undangan tertunda | **DIJAWAB user (2026-11-19):** **dua halaman terpisah** — `<DOMAIN>/<slug>/join` (bergabung/undangan) dan `<DOMAIN>/<slug>/reset` (atur ulang kata sandi), masing-masing satu tujuan dengan teks yang sesuai; **daftar "Undangan tertunda"** di tab Pengguna (SCR-A08) **dengan aksi Batalkan dan Terbitkan ulang**: menampilkan undangan yang belum dipakai dan waktu kedaluwarsanya; menerbitkan ulang membuat kode baru dan kode lama otomatis tidak berlaku | Opsi tidak dipilih: satu halaman bersama dengan dua mode; tanpa daftar undangan | Final |

### 9.2 Matriks Traceability Layar ↔ Requirement PRD

Kolom: **FR** (fungsional) · **BR/KEP/AP/EC** (aturan) · **FLOW** · **NFR**. Hanya ID yang berdampak pada UI.

| Layar | FR | BR / EC / AP | FLOW | NFR |
|---|---|---|---|---|
| SCR-P01 Pairing | FR-DEV-001, FR-DEV-002, FR-DEV-005 | BR-AUT-002, BR-SYN-050, KEP tenant-via-URL (slug, QR) | FLOW-01 | NFR-SEC-004, NFR-SEC-005 |
| SCR-P02 Staf & PIN | FR-AUT-003, FR-AUT-004, FR-AUT-006, FR-I18N-002, FR-AUT-009, FR-AUT-010 | BR-AUT-003/004/005/008/013, BR-I18N-002, BR-AUT-015, KEP tenant-via-URL (penanda tenant) | FLOW-02, FLOW-20 | NFR-PERF-004, NFR-PERF-007, NFR-SEC-005 |
| SCR-P03 Buka shift | FR-SHF-001, FR-SYN-018 | BR-SHF-001/002/010, BR-SYN-003 | FLOW-03 | NFR-PERF-001 |
| SCR-P04 Kasir retail | FR-POS-001..008, FR-POS-011..016, FR-PRC-002, FR-CAT-003, FR-CAT-014, FR-SYN-015, FR-SYN-017, FR-AUT-005, FR-I18N-004 | BR-CAT-007/012/015, BR-UOM-003/004, BR-PRC-002/007, BR-DSC-001..003, BR-STK-005, BR-I18N-006, AP-02, AP-06, EC-028 | FLOW-04 | NFR-PERF-001/003, NFR-COMP-002/003 |
| SCR-P05 Kisi meja | FR-FNB-001, FR-FNB-002, FR-FNB-003, FR-SYN-016, FR-FNB-011, FR-FNB-014, FR-FNB-015 | BR-FNB-001/003/004/007, EC-014/015, BR-FNB-010 | FLOW-05 | — |
| SCR-P06 Open bill F&B | FR-FNB-004, FR-FNB-005, FR-FNB-010, FR-FNB-012, FR-POS-004, FR-CAT-003, FR-FNB-013, FR-FNB-014, FR-FNB-015, FR-SHF-007 | BR-FNB-002/005/008, BR-PRC-006, BR-CAT-020, BR-AUT-009, BR-FNB-010/011/012/013, EC-058..061 | FLOW-05, FLOW-19 | NFR-PERF-001 |
| SCR-P07 Split/merge | FR-FNB-007, FR-FNB-008 | BR-SPL-001..007, BR-SPL-020..024, BR-FNB-013 | FLOW-06, FLOW-07 | — |
| SCR-P08 Pembayaran | FR-PAY-001..005, FR-POS-006, FR-POS-007, FR-POS-015, FR-AUT-005 | BR-PAY-001..005, BR-TAX-009, BR-INV-003/004, BR-MNY-001, BR-FNB-013 | FLOW-04 (7–8), FLOW-05 | NFR-PERF-001 |
| SCR-P09 Selesai & cetak | FR-PRN-002, FR-PRN-003, FR-PRN-004, FR-PRN-005, FR-SYN-010, FR-PRN-004 | BR-PRN-002/003/006, BR-INV-004, AP-10, EC-019/020 | FLOW-04 (8–10) | NFR-PERF-002 |
| SCR-P10 Riwayat/void/cetak ulang | FR-POS-009, FR-POS-010, FR-PRN-004, FR-I18N-005 | BR-INV-005, BR-RTR-004, BR-I18N-007, EC-016/018 | FLOW-09 | NFR-STOR-002 |
| SCR-P11 Retur | FR-RTR-001..007 | BR-RTR-001..009, BR-INV-010, BR-AUT-006/007, EC-016/017 | FLOW-08 | — |
| SCR-P12 Kas masuk/keluar | FR-SHF-002 | BR-SHF-004, BR-AUD-001 | — | — |
| SCR-P13 Tutup shift | FR-SHF-003, FR-SHF-004, FR-SHF-006, FR-AUT-010 | BR-SHF-003/005/006/007/008, BR-AUT-015, EC-063 | FLOW-10 | — |
| SCR-P14 Antrean sinkron | FR-SYN-007, FR-SYN-010, FR-SYN-013, FR-SYN-008, FR-DEV-004 | BR-SYN-024/030/040/051/052, BR-LOG-009, BR-SYN-024 | FLOW-14, FLOW-18 | NFR-REL-001 |
| SCR-P15 Layar sistem | FR-AUT-006, FR-SYN-018, FR-SYN-014, FR-DEV-002 | BR-AUT-008/013, BR-SYN-003, EC-021 | FLOW-16, FLOW-17 | — |
| SCR-P16 Pengaturan perangkat | FR-PRN-001, FR-PRN-007, FR-DEV-004, FR-DEV-005, FR-I18N-002/003 | BR-PRN-001/004/005, BR-SYN-050, BR-I18N-002/003, RSK-07 | — | NFR-I18N-002 |
| SCR-A01 Login admin | FR-AUT-001 | BR-AUT-001, KEP tenant-via-URL (login di-scope slug), identitas global + keanggotaan per tenant (belum bernomor di PRD) | — | NFR-SEC-005 |
| SCR-A02 Dashboard | FR-RPT-001..004 | BR-RPT-001, BR-STK-002 | — | — |
| SCR-A03 Master produk | FR-CAT-001..007, FR-CAT-014 | BR-CAT-001..008, BR-SYN-010 | — | — |
| SCR-A04 Harga | FR-PRC-001, FR-PRC-002, FR-PRC-004 | BR-PRC-001/002/004 | — | — |
| SCR-A05 Ketersediaan | FR-CAT-008..013 | BR-CAT-009..022 | — | — |
| SCR-A06 Stok | FR-INV-001..011, FR-RPT-003 | BR-STK-*, BR-HPP-*, BR-TRF-* | FLOW-11/12/13 | — |
| SCR-A07 Pengaturan outlet | FR-TNT-002, FR-TNT-003, FR-TNT-005, FR-PRN-006, FR-ADM-003, FR-PAY-002, FR-I18N-005 | BR-TAX-*, BR-TIM-*, BR-PRN-005, BR-I18N-007/008, EC-025/026 | FLOW-01 (1) | — |
| SCR-A08 Pengguna & device | FR-AUT-002, FR-AUT-007, FR-AUT-008, FR-DEV-001..004, FR-DEV-006 | BR-AUT-009/012, BR-INV-003/008, BR-SHF-009, BR-FNB-011, KEP tenant-via-URL (QR pairing), keanggotaan per tenant (belum bernomor di PRD), kode undangan/atur ulang (belum bernomor di PRD) | FLOW-01, FLOW-16 | — |
| SCR-A09 Perlu perhatian/gap/audit | FR-ADM-001, FR-ADM-002, FR-AUD-003 | BR-INV-007/009, BR-AUD-001..003 | FLOW-18 | NFR-AUD-001 |
| SCR-S01–S03 Halaman sistem | FR-LOG-005 | KEP tenant-via-URL (belum bernomor di PRD), BR-AUT-001 | — | NFR-SEC-005 |
| SCR-S05 Pemilih aplikasi | — | KEP tenant-via-URL (belum bernomor di PRD) | — | — |
| SCR-S06–S07 Gabung dan atur ulang dengan kode | FR-AUT-001 | KEP identitas global dan kode sekali pakai (belum bernomor di PRD), BR-AUT-001 | — | NFR-SEC-005 |
| SCR-P17 Layar pemulihan | FR-LOG-005, FR-LOG-007, FR-SYN-010 | BR-LOG-008, BR-LOG-010, BR-SYN-052, EC-020 | — | NFR-OBS-002, NFR-OBS-003 |
| SCR-S04 Reset aplikasi | FR-LOG-005, FR-SYN-013 | BR-LOG-008, BR-SYN-002/003 | FLOW-17 | NFR-PERF-004 |
| SCR-A10 Meja & bill F&B | FR-FNB-001, FR-FNB-011 | BR-FNB-001/004/007, EC-014/015 | — | — |
| SCR-A11 Akun saya | FR-AUT-001 | BR-AUT-001, identitas global (belum bernomor di PRD) | — | NFR-SEC-005 |
| Komponen lintas layar | FR-I18N-001, FR-LOG-005, FR-SYN-013 | BR-I18N-001, BR-LOG-008, BR-SYN-003, BR-LOG-008, BR-LOG-010 | FLOW-17 | NFR-OBS-002, NFR-I18N-002 |

**FR tanpa layar tersendiri (infrastruktur/tanpa antarmuka khusus):** FR-TNT-001/004, FR-SYN-001..006/009/011/012, FR-AUD-001/002/004, FR-INV-002 (logika), FR-LOG-001..004/006..008, FR-QA-*, FR-I18N-006/007/008 — hanya berdampak pada UI lewat komponen/pesan yang sudah dicatat (mis. banner, `KODE#id`, kunci terjemahan).

---

## 10. Lampiran

### Lampiran A — Ringkasan Ekstraksi dari Gambar Referensi

**A.1 Sumber:** `docs/reference/ui-reference.jpg`, 2000 × 1500 px; empat layar tema "Zero Health": (1) Dashboard, (2) Login, (3) Health Insights, (4) Action Plan. Isi (teks, ilustrasi, merek) **tidak dipakai**; hanya bahasa visual.

**A.2 Apa yang terlihat per layar dan token yang diturunkan**

| Layar referensi | Yang terlihat | Token / pola yang diambil | Tidak diambil |
|---|---|---|---|
| **Dashboard** | Sidebar kiri putih (logo, 6 menu ikon-garis + label, item aktif = pill putih berbayang berteks hijau, profil pengguna di bawah); header: judul kiri, lonceng + avatar kanan; grid 3 kartu atas + 3 kartu bawah; kartu "Health Snapshot" berisi donut gradien merah muda–oranye–hijau; kartu "Recent Activities" berisi batang abu muda dengan satu batang hijau aktif + bar dua-bagian (hijau/gelap); kartu "Action Plan" berisi daftar centang + progress bersegmen hijau + tombol outline; daftar kartu bersarang dengan nomor, tombol "View", status chip (oranye/hijau/merah); kartu metrik dengan ikon hijau dan sparkline | Tata letak sidebar + header (CMP-12/14); kartu (CMP-09); batang abu + aktif hijau (CMP-32); progress bersegmen (CMP-18); status chip (CMP-08); daftar bersarang (CMP-11); pill nav aktif (diadaptasi) | Donut gradien sebagai penyandi data (hanya dekoratif); isi kesehatan; avatar foto |
| **Login** | Panel kiri foto penuh bertinta gelap; panel kanan: judul, subjudul, input email/kata sandi (ikon mata), "Remember me", "Forgot password?", tombol hijau penuh "Login", pemisah "or login from", tombol outline "Continue with Google" | Gaya input (border tipis, radius ±10), tombol primer hijau penuh (SCR-A01) | Foto stetoskop, "Continue with Google", "Remember me", merek |
| **Health Insights** | Deretan **tab pill** (aktif hijau terisi, lain abu muda), kartu ringkasan, kartu "General Body Information" dengan badge hijau kecil, **kartu hero hijau** bertulisan besar, grafik area (garis hijau, isi merah muda), batang mingguan (track abu, batang hijau, satu terpilih dengan titik/garis putus-putus), tabel "All Report" | Tab pill (CMP-06), kartu hero (CMP-09 varian), batang mingguan (CMP-32), tabel (CMP-10) | Teks hero; area chart merah muda sebagai data |
| **Action Plan** | Sidebar sama; kartu "Timeline" berupa grid waktu × hari dengan sel kecil bertulisan; panel samping "Today's Plan" dengan progress bersegmen; kartu "Resource Library" 4 kolom (ikon hijau + judul + garis) | Pola grid jadwal (inspirasi matriks SCR-A05/A04); kartu kategori | Isi rencana kesehatan |

**A.3 Sampel piksel terukur (median kotak 5 × 5 px; JPEG sehingga ±3 nilai)**

| Elemen | Koordinat | Hex terukur | Token turunan |
|---|---|---|---|
| Latar luar | (10,10), (1110,400) | `#DEDFE3` | `neutral-200` / `canvas` |
| Tombol "Login" | (1790,483), (1930,483) | `#7BB717`, `#7AB616` | `primary-500` |
| Tab aktif | (275,917) | `#74B614` | `primary-500` |
| Batang aktif (Recent Activities) | (773,215) | `#7CBA17` | `primary-500` |
| Batang hijau (Insights) | (783,1340) | `#78B615` | `primary-500` |
| Kartu hero hijau | (900,1000), (1040,1140) | `#74B712`, `#74B710` | `primary-500` |
| → **Rata-rata kelompok hijau** | — | **≈ `#76B617`** | **`primary-500` = `#76B617`** |
| Track batang | (636,240), (783,1270) | `#EFEFF1`, `#F1F1F1` | `neutral-100` (`#ECEDEF`) |
| Tab tidak aktif (tepi sel) | (400,917) kolom | `#EAEAEA`–`#EDEDED` | `neutral-100` |
| Border kartu | (266,300) baris | `#F3F3F3`–`#F4F4F4` | `line` `#DEDFE3` (diperkuat dari `#F3F3F3`; `line-subtle` `#ECEDEF` hanya untuk pemisah dalam kartu) |
| Judul halaman/kartu | area teks | `#191919` / `#0B0B0B` | `ink` (`#1B1D21`) |
| Teks navigasi | "Insights" | `#5C5E5D` | `ink-soft` (`#52565F`) |
| Teks muted | "Mon" | `#7E7E7E` | `ink-muted` (`#6B7079`, diperkuat kontras) |
| Teks sub | subteks kartu | `#959595` | tidak dipakai (kontras < 3 : 1) |
| Segmen gelap (bar dua-bagian) | (760,337) | `#404040` | `neutral-700` |
| Donut merah muda / oranye / persik | (470,230) / (420,330) / (380,280) | `#FE7CAC` / `#FEAF77` / `#FED4BC` | dekoratif saja |
| Area chart (isi) | (550,1330) | `#FEF0F0` | dekoratif saja |
| Chip "Running" (oranye) | latar, border | latar ≈ `#FFEDD5`; border ≈ oranye | `warning-soft`/`warning-line` |
| Chip "Complete" (hijau), "Helpet" (merah) | — | hijau outline; merah muda + merah | `success-*`, `danger-*` |

**A.4 Pengukuran dimensi (piksel gambar → perkiraan ukuran 1×)**

Asumsi skala (`ESTIMASI DARI GAMBAR`): ukuran absolut tidak diketahui; diasumsikan **1 px desain ≈ 0,89 px gambar** (faktor ≈ 1,12), karena celah antar kartu ±14,5 px gambar ≈ 16 px dan lebar sidebar 213 px gambar ≈ 240 px — dua nilai yang lazim. Bila skala sebenarnya berbeda, semua angka bergeser proporsional dan harus disetel ulang di satu tempat (token).

| Elemen | Piksel gambar | Perkiraan 1× | Token |
|---|---|---|---|
| Lebar sidebar | ≈ 213 | ≈ 240 | `sidebar-w` 240 |
| Tinggi header | ≈ 59 | ≈ 64–66 | `header-h` 64 |
| Celah antar kartu | ≈ 14,5 | ≈ 16 | `grid-gap` 16 |
| Padding dalam kartu | ≈ 14 | ≈ 16 | `card-pad` 16 |
| Radius kartu (lihat lengkung sudut) | ≈ 14 | ≈ 16 | `radius-card` 16 |
| Tinggi tab / tombol login | ≈ 35–36 | ≈ 40 (referensi) | dinaikkan ke 44/48 untuk sentuh |
| Radius tab/tombol/input | ≈ 7–8 | ≈ 8–10 | `radius-control` 10 |
| Tinggi input | ≈ 32 | ≈ 36–40 | `control-sm/md` (POS 48) |
| Tinggi chip status | ≈ 25–28 | ≈ 28–32 | chip 28 |
| Tinggi item nav aktif / jarak antar item | ≈ 32 / 40 | ≈ 36 / 45 | item 44 (sentuh) |
| Judul halaman / kartu / nav | — | ≈ 22–24 / ≈ 16 / ≈ 14 | `h1`/`title`/`label` |

**A.5 Ringkasan penyesuaian demi POS** (ringkasan §1.2): hijau gelap untuk aksi; latar abu muda; border kartu diperkuat; target sentuh ≥ 44; teks min. 12 px; status selalu ikon + teks; grafik berpalet tervalidasi; hapus foto/SSO/isi kesehatan.

### Lampiran B — Tabel Rasio Kontras (dihitung, WCAG 2.x)

Semua nilai dihitung dengan rumus §0.3 pada hex yang tertulis, dibulatkan ke 2 desimal. `✔` = lolos untuk kegunaan tertulis; `✘` = tidak boleh dipakai untuk kegunaan itu.

**B.1 Skala primer di atas putih / `surface-hover` (`#F4F5F6`) / teks `neutral-900` di atasnya**

| Token | Hex | vs putih | vs `surface-hover` | `neutral-900` di atasnya | Putih di atasnya (= vs putih) | Pemakaian teks |
|---|---|---|---|---|---|---|
| primary-50 | `#F5FAEA` | 1,06 | 1,03 | 15,87 | — | Latar saja |
| primary-100 | `#E8F3CF` | 1,16 | 1,06 | 14,59 | — | Latar saja |
| primary-200 | `#D2E8A3` | 1,33 | 1,22 | 12,71 | — | Latar/garis |
| primary-300 | `#B4D96C` | 1,61 | 1,47 | 10,51 | — | Latar (dark: teks di atas gelap 10,51) |
| primary-400 | `#94C73C` | 2,00 | 1,83 | 8,43 | — | Latar (dark: teks di atas gelap 8,43) |
| primary-500 | `#76B617` | **2,48 ✘** | 2,27 | 6,81 ✔ | **2,48 ✘** | Teks gelap di atasnya ✔; putih ✘ |
| primary-600 | `#5E9A10` | 3,44 | 3,15 | 4,91 | 3,44 (teks besar/UI ✔) | Grafik/ikon ✔; teks normal ✘ |
| **primary-700** | `#46780D` | **5,31 ✔** | **4,87 ✔** | 3,18 | **5,31 ✔** | Teks/tombol ✔ |
| primary-800 | `#3D660F` | 6,76 ✔ | 6,19 ✔ | 2,50 | 6,76 ✔ | ✔ |
| primary-900 | `#32530F` | 8,82 ✔ | 8,08 ✔ | 1,91 | 8,82 ✔ | ✔ |
| primary-950 | `#172A04` | 15,34 ✔ | 14,05 ✔ | 1,10 | 15,34 ✔ | ✔ |

**B.2 Netral**

| Token | Hex | vs putih | vs `surface-hover` | vs `neutral-100` | Pemakaian |
|---|---|---|---|---|---|
| neutral-300 | `#C9CBD1` | 1,62 | 1,49 | 1,38 | Garis dekoratif (`line-strong`) |
| neutral-400 | `#8E929C` | 3,11 | 2,85 | 2,66 | `line-input` (UI ≥ 3 ✔ vs putih); `ink-disabled` |
| neutral-500 | `#6B7079` | **4,98 ✔** | **4,56 ✔** | **4,25 ✘** | `ink-muted` (jangan di atas `surface-sunken`) |
| neutral-600 | `#52565F` | 7,36 | 6,74 | 6,28 | `ink-soft` ✔ di semua permukaan |
| neutral-700 | `#3F434B` | 9,93 | 9,09 | 8,47 | Teks pada tab non-aktif ✔ |
| neutral-900 | `#1B1D21` | 16,88 | 15,46 | 14,41 | `ink` |

**B.3 Pasangan peran**

| Pasangan (teks / latar) | Rasio | Hasil |
|---|---|---|
| `ink` / `surface` putih | 16,88 | ✔ AAA |
| `ink` / `surface-hover` | 15,46 | ✔ |
| `ink-soft` / putih | 7,36 | ✔ |
| `ink-muted` / putih | 4,98 | ✔ AA |
| `ink-muted` / `surface-hover` | 4,56 | ✔ AA |
| `ink-muted` / `surface-sunken` | 4,25 | ✘ |
| `ink-disabled` / putih | 3,11 | (dikecualikan; informasi) |
| `ink-brand` `#46780D` / putih | 5,31 | ✔ |
| `ink-brand` / `surface-hover` | 4,87 | ✔ |
| `ink-brand` / `action-soft` `#F5FAEA` | 5,00 | ✔ |
| `ink-brand` / `action-soft-hover` `#E8F3CF` | 4,59 | ✔ |
| `on-action` putih / `action` | 5,31 | ✔ |
| putih / `action-hover` `#3D660F` | 6,76 | ✔ |
| putih / `action-active` `#32530F` | 8,82 | ✔ |
| `on-action-soft` `#3D660F` / `action-soft` | 6,36 | ✔ |
| `on-action-soft` / `action-soft-hover` | 5,84 | ✔ |
| `primary-800` / `primary-100` (inisial avatar) | 5,84 | ✔ |
| `neutral-900` / `primary-500` (opsi B DOQ-02) | 6,81 | ✔ |
| `primary-950` / `primary-500` | 6,19 | ✔ |
| putih / `primary-500` (referensi) | 2,48 | ✘ |
| putih / `primary-600` | 3,44 | teks besar/UI saja |
| `focus-ring` `#46780D` / putih | 5,31 | ✔ (≥ 3) |
| `line-input` `#8E929C` / putih | 3,11 | ✔ (≥ 3) |
| `neutral-700` / `neutral-100` (tab non-aktif) | 8,47 | ✔ |
| `neutral-900` / `neutral-100` | 14,41 | ✔ |
| putih / `surface-inverse` `#1B1D21` (toast) | 16,88 | ✔ |

**B.3a Ikon toast di atas `surface-inverse` `#1B1D21`:** sukses `#5FD08A` 8,74 · info `#6FB0F0` 7,35 · peringatan `#FFB454` 9,57 · galat `#FF8A80` 7,39 ✔.

**B.4 Keluarga semantik**

| Keluarga | `solid` / putih | `ink` / putih | `ink` / `soft` | `solid` / `soft` | `line` / putih (dekoratif) |
|---|---|---|---|---|---|
| success (`#1A7F46` · `#17703D` · `#E7F6EC` · `#8FD0A9`) | 5,04 ✔ | 6,14 ✔ | 5,49 ✔ | 4,51 ✔ | 1,79 |
| warning (`#9A5200` · `#8A4A00` · `#FFF3E0` · `#F0A64B`) | 5,86 ✔ | 6,86 ✔ | 6,26 ✔ | 5,35 ✔ | 2,05 |
| danger (`#C0281C` · `#B42318` · `#FDECEC` · `#E58B90`) | 5,90 ✔ | 6,57 ✔ | 5,76 ✔ | 5,16 ✔ | 2,49 |
| info (`#1F6FBA` · `#195E9E` · `#E8F1FB` · `#8FB8E6`) | 5,20 ✔ | 6,70 ✔ | 5,87 ✔ | 4,55 ✔ | 2,07 |
| violet (`#6444B8` · `#563AA0` · `#F1ECFB` · `#BCA9E8`) | 6,86 ✔ | 8,37 ✔ | 7,23 ✔ | 5,92 ✔ | 2,10 |
| teal (`#0F766E` · `#0D625C` · `#E2F5F3` · `#85CFC8`) | 5,47 ✔ | 7,19 ✔ | 6,37 ✔ | 4,84 ✔ | 1,79 |

**B.5 Status meja (teks di atas latar kartu)**

| Status | Teks / latar | Rasio |
|---|---|---|
| `table_free` | `neutral-700` `#3F434B` / putih | 9,93 ✔ |
| `table_occupied` | `primary-800` `#3D660F` / `primary-50` `#F5FAEA` | 6,36 ✔ |
| `table_awaiting_payment` | `warning-ink` / `warning-soft` | 6,26 ✔ |
| `table_locked_other` | `violet-ink` / `violet-soft` | 7,23 ✔ |
| `table_orphan` | `danger-ink` / `danger-soft` | 5,76 ✔ |

**B.6 Grafik (isi vs putih ≥ 3 : 1)**

| Token | Hex | vs putih |
|---|---|---|
| chart-1 | `#3D660F` | 6,76 |
| chart-2 | `#1F6FBA` | 5,20 |
| chart-3 | `#CF7B0E` | 3,23 |
| chart-4 | `#C2417A` | 4,85 |
| chart-5 | `#8E929C` | 3,11 |
| seq-1 `#E8F3CF` (1,16) · seq-2 `#B4D96C` (1,61) · seq-3 `#76B617` (2,48) · seq-4 `#46780D` (5,31) · seq-5 `#32530F` (8,82) | — | Sel heatmap selalu memuat angka; teks `ink` di atas seq-1..3 (≥ 6,81), putih di atas seq-4..5 |
| div-neg-2 `#1F6FBA` (5,20) · div-neg-1 `#8FB8E6` (2,07) · div-0 `#ECEDEF` · div-pos-1 `#F0B777` · div-pos-2 `#CF7B0E` (3,23) | — | Selalu disertai tanda/ikon/angka |

**B.7 Simulasi buta warna palet kategorikal (ΔE76; makin besar makin mudah dibedakan)**

| Skenario | Dua pasangan terdekat |
|---|---|
| Normal | chart-2↔chart-5: 43,0 · chart-4↔chart-5: 57,1 |
| Protanopia | chart-1↔chart-3: 19,9 · chart-4↔chart-5: 21,6 |
| Deuteranopia | chart-4↔chart-5: **12,0** · chart-1↔chart-3: 35,4 |
| Tritanopia | chart-3↔chart-4: 18,4 · chart-1↔chart-2: 21,8 |

Karena beberapa pasangan di bawah 20, pembeda non-warna (label langsung, penanda bentuk, tabel) **wajib** (§2.1.7).

**B.8 Mode gelap (bila diaktifkan; DOQ-03)** — lihat tabel §2.9 (seluruh rasio dihitung).

### Lampiran C — Ringkasan Token Satu Halaman (untuk AI coding agent)

| Kelompok | Ringkas |
|---|---|
| Aksi | `bg-action` `#46780D` + `text-on-action` putih; hover `#3D660F`; active `#32530F`; fokus `ring-focus-ring` 2 px offset 2 |
| Brand | `primary-500` `#76B617` — **dekoratif saja** |
| Permukaan | app `#FFFFFF` · surface `#FFFFFF` · surface-hover `#F4F5F6` · sunken `#ECEDEF` · inverse `#1B1D21` (kartu: border `line` `#DEDFE3`) |
| Teks | `ink` `#1B1D21` · `ink-soft` `#52565F` · `ink-muted` `#6B7079` (bukan di atas sunken) · `ink-brand` `#46780D` |
| Garis | subtle `#ECEDEF` · line `#DEDFE3` · strong `#C9CBD1` · **input `#8E929C`** |
| Semantik | success `#1A7F46` · warning `#9A5200` · danger `#C0281C` · info `#1F6FBA` · violet `#6444B8` · teal `#0F766E` (+ soft/line/ink) |
| Sentuh | min 44 · default `/pos` 48 · aksi utama 56 · numpad 64/56 · jarak ≥ 8 |
| Radius | kontrol 10 · kartu 16 · modal 20 · chip 8 · item nav 12 |
| Spasi | skala 4 px · gutter 16/20/24 · card-pad 16 (`/pos`) / 20 (`/admin`) |
| Teks | min 12 px · `/pos` dasar 16 · `/admin` dasar 14 · **tabular-nums wajib** |
| Layout | sidebar 240 · rail 72 · header 64 (HP 56) · top bar POS 56 · bottom nav 64 · panel keranjang 400/440 |
| Breakpoint | sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 |
| Status | selalu **ikon + teks + warna**; enum di §2.1.5/6 |
| Tenant | URL `<DOMAIN>/<slug>/pos` atau `/<slug>/admin`; `/<slug>` = pemilih; root + slug tak dikenal = 404 generik; **nama + avatar `primary-700`**, **tanpa logo dan tanpa warna tenant**; penanda tenant (CMP-35) selalu terlihat |
| Galat | T1 inline/toast tanpa kode · T2 indikator + coba ulang otomatis tanpa dialog (`/admin`: Coba lagi manual) · T3 CMP-36 (`KODE#id` + Salin 56 px, `code-id` 20/28 mono); ID lokal `D-YYYYMMDD-HHmmss-xxxxx`; login generik; boundary per area; tanpa "Laporkan masalah" dan tanpa "Kesehatan Perangkat" |
| Larangan | hex/px literal · `primary-500` untuk teks · putih di `primary-500` · `ink-muted` di atas sunken · opacity untuk disabled · warna sebagai satu-satunya pembeda · string UI literal |
