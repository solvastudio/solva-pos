# SCHEMA — Rancangan Struktur Database & Kamus Data Solva POS

| Atribut | Nilai |
|---|---|
| Nama produk | Solva POS |
| Jenis dokumen | Rancangan Skema Database (server PostgreSQL + client Dexie/IndexedDB) + Kamus Data |
| Status dokumen | **Draft 0.17 — selaras dengan versi terkini `docs/PRD.md`, `docs/ARCHITECTURE.md`, dan `docs/DESIGN.md` di folder `docs/`** (nomor Draft/revisi dokumen lain sengaja **tidak disematkan** karena dikerjakan paralel; rujukan memakai ID keputusan/aturan, mis. `BR-xxx`, `AD-xx`, `DOQ-xx`). Seluruh Open Questions skema **OQ-S01..S40 sudah dijawab user** (OQ-S30 dan OQ-S34 digantikan oleh model identitas global); yang masih `PERLU KONFIRMASI` hanya OQ-01(c) (outlet campuran PPN+PB1) dan konfirmasi akuntan/auditor atas perlakuan hukum (Bab 10). Riwayat Draft di baris berikut |
| Riwayat Draft | **0.1–0.5** (2026-11-17/18): rancangan awal, jawaban OQ-S01..S23, sinkron PRD (tarif pajak berlaku-mulai `tax_rate_history`, prefiks invoice per register, serah-terima bill, kunci layar). **0.6**: versioning (`app_version`/`schema_version`, versi minimum klien, `feature_flag`, migrasi aditif). **0.7**: identifikasi tenant lewat slug, Dexie per `tenant_id`. **0.8**: error management (`device_log`, `cart_draft`, katalog kode, `channel`). **0.9**: identitas per tenant, tanpa warna tenant. **0.10**: jawaban OQ-S27..S35. **0.11**: rate limit (tanpa tabel/kolom baru). **0.12**: identitas global + keanggotaan per tenant. **0.13**: `member_code` (kode undangan/reset), cookie per slug. **0.14**: OQ-S39 terjawab. **0.15**: daftar "Undangan tertunda" (`revoke_reason`). **0.16** (2026-11-19): OQ-S40 terjawab; pengalih tenant tidak ada; traceability dirujukkan ke ID PRD (BR-VER/TEN/IDN/ERR/RLM); koreksi nama tenant ≤ 40 dan audit undangan memuat email (PRD menang). **0.17**: nomor Draft/revisi dokumen lain dihapus dari seluruh dokumen ini (rujukan memakai ID) |
| Tanggal | 2026-11-19 |
| Peran penyusun | Senior Database Architect + Backend Systems Engineer |
| Sumber kebenaran aturan bisnis | `docs/PRD.md` (ID `BR-xxx`, `FR-xxx`, `KEP-xx`, `EC-xxx`, `OQ-xx`). **Bila dokumen ini berbeda dari PRD, PRD yang menang**; perbedaan terhadap brief awal dicatat di Bab 7 |
| Cakupan | Rancangan konseptual-fisik: tabel, kolom, tipe, constraint, relasi, indeks, RLS, store Dexie, pemetaan sinkronisasi. **Bukan** kode aplikasi, **bukan** file migrasi SQL, **bukan** skema Drizzle. Cuplikan DDL di dokumen ini hanya ilustrasi |
| Ruang lingkup fase | Seluruh tabel MVP F1–F5 (PRD Bab 13). Kolom "Fase" pada Bab 8 menunjukkan kapan tabel pertama kali dibutuhkan |

---

## 0. Cara Membaca Dokumen Ini

### 0.1 Tag status (mengikuti PRD §0.1)

| Tag | Arti di dokumen ini |
|---|---|
| `DISEPAKATI` | Bersumber langsung dari keputusan PRD berstatus `DISEPAKATI`. Tidak dibantah ulang. |
| `DIUSULKAN` | Keputusan desain skema yang ditetapkan penyusun agar rancangan tidak ambigu dan tidak memblokir pengembangan; selaras dengan PRD dan dapat diubah dengan dampak kecil. |
| `PERLU KONFIRMASI` | Bergantung pada butir PRD yang masih terbuka (kini hanya OQ-01(c) dan konfirmasi akuntan/auditor) **atau** pilihan desain skema yang tidak diatur PRD dan punya opsi nyata. Dikumpulkan di Bab 9 (opsi + dampak) dan Bab 10 (daftar kolom/tabel terdampak). |

### 0.2 Konvensi penulisan

- **Tabel** ditulis `snake_case` huruf kecil, **tunggal** (`sale`, bukan `sales`). Penyimpangan yang disengaja: `cash_master` (= *register*) dan `cash_cashier` (= *shift*) dipertahankan dari PRD; `table` dan `user` adalah kata tercadang SQL sehingga menjadi `fnb_table` dan `app_user`.
- **Kolom `tipe PG`** = tipe PostgreSQL. **Kolom `TS / Lokal`** = tipe TypeScript yang sama dengan representasi di JSON sync dan di Dexie (IndexedDB). Legenda pemetaan di §1.3.
- **Constraint**: `PK`, `FK→tabel`, `UQ` (unique), `NN` (NOT NULL), `DEF` (DEFAULT), `CHK` (CHECK). Semua FK antar tabel bertenant adalah **FK komposit** `(tenant_id, x_id)` (§1.8) walau di kamus ditulis ringkas `FK→x`.
- **Kolom standar** (`STD-M`, `STD-S`, `STD-T`, `STD-L`, `STD-D`) didefinisikan **sekali** di §2.2 dan diwarisi tabel yang menyebutnya. Kamus tiap tabel hanya mendaftar kolom spesifik tabel itu.
- **Rujukan PRD** ditulis dalam kurung, mis. `(BR-INV-003)`.
- `R(x)` = pembulatan half-up (BR-MNY-004); `LR` = largest remainder (BR-MNY-006).

### 0.3 Ringkasan keputusan skema (satu halaman)

| # | Keputusan | Status |
|---|---|---|
| 1 | PK `uuid` UUIDv7 dibuat client (offline-safe); nomor invoice **bukan** PK | `DISEPAKATI` (ID UUIDv7, §5.1 PRD) |
| 2 | Uang `bigint` rupiah; kuantitas/faktor `numeric(18,4)`; persentase tarif `numeric(7,4)`; **tidak ada `NUMERIC` untuk uang** | `DISEPAKATI` (BR-MNY-001/002) — menggantikan permintaan brief, lihat §7.1 |
| 3 | Waktu `timestamptz` UTC + `business_date` tersimpan + zona IANA per outlet | `DISEPAKATI` (BR-TIM-001..005) |
| 4 | `tenant_id` di semua tabel bertenant + RLS `FORCE` | `DISEPAKATI` (BR-TNT-001) |
| 5 | Pull sync = counter versi `tenant_sync`; kolom `version` hanya pada tabel yang ikut feed | `DISEPAKATI` (BR-SYN-010) |
| 6 | Push sync = perintah idempoten `idempotency_command` + outbox Dexie; **tanpa resolusi konflik merge / LWW** | `DISEPAKATI` (BR-SYN-020/030) |
| 7 | Ledger stok `stock_movement` append-only + saldo `stock_balance` (qty, nilai) di transaksi yang sama; HPP moving average per outlet; FIFO/layer **tidak dipakai** | `DISEPAKATI` (BR-STK-001, BR-HPP-001/002) |
| 8 | Enum = `text` + `CHECK`; lookup tabel hanya untuk data yang dikonfigurasi tenant | `DIUSULKAN` |
| 9 | Audit log append-only dengan hash berantai per tenant | `DISEPAKATI` append-only; hash berantai `DIUSULKAN` (BR-AUD-002) |
| 10 | Tabel log operasional **tidak ada di PostgreSQL**: log = file JSON (server) + antrean Dexie (device) | `DISEPAKATI` (BR-LOG-002/010) — lihat §7.5 |
| 11 | Open Questions skema OQ-S01..S18 dijawab user (2026-11-17). Keputusan menonjol: **hanya tarif pajak** yang berlaku-mulai (OQ-S04), logo struk sebagai **berkas di folder server** (OQ-S06), login `/admin` **hanya email + password lewat identitas global + keanggotaan per tenant** (OQ-S02, direvisi 2026-11-19), **satu device aktif per register** (OQ-S14), rantai audit ketat per tenant (OQ-S07) | `DISEPAKATI` (user, 2026-11-17) — Bab 9 |
| 13 | **Prefiks nomor invoice per register** (PRD): nomor `{PREFIKS}-{MMYY}-{URUT6}`; prefiks per register (`register_invoice_prefix`), wajib untuk register `CASHIER`, unik per tenant; opsi "cetak kode register" dan awalan per outlet dihapus | `DISEPAKATI` (keputusan user 2026-11-18; bentuk prefiks disetujui 2026-11-19, OQ-S24 terjawab) |
| 14 | **Versioning** (keputusan user 2026-11-18, ARCHITECTURE §9.6): tiap perintah, `sale`, `credit_note`, `bill_event` membawa `app_version` (teks SemVer `v1.6.2`) **dan** `schema_version` (kontrak, integer monoton); versi protokol sync dan versi skema Dexie **tidak** disimpan per transaksi; versi minimum klien di `app_release`; feature flag per tenant `feature_flag` (master turun, default di kode); migrasi DB **aditif** (expand → contract dua rilis) | `DISEPAKATI` (user; OQ-S25/S26 terjawab 2026-11-19) |
| 15 | **Identifikasi tenant lewat URL** (keputusan user 2026-11-18): `tenant.slug` **permanen**, unik tanpa membedakan huruf besar-kecil, 3–30 karakter, kata terlarang; slug tak dikenal vs tenant tidak aktif dapat dibedakan server; login di-scope slug (identitas global + keanggotaan per tenant, baris 17); satu origin untuk semua tenant sehingga **database Dexie dan semua penanda lokal dinamai `tenant_id`** (bukan slug) dengan registry slug→tenant_id yang terpisah | `DISEPAKATI` (user); kata terlarang = konstanta di kode + uji rute, slug permanen = trigger, domain kustom ditunda tanpa kolom (OQ-S27..S29 terjawab) |
| 16 | **Error management** (keputusan user 2026-11-18): log operasional tetap **berkas JSON** di server (OQ-S18; **tidak ada tabel log server**); device menulis `device_log` (Dexie, ≤ 500) dengan **ID referensi lokal** `D-YYYYMMDD-HHmmss-xxxxx`; **katalog kode error stabil** (arti tidak berubah, hanya bertambah, tanpa bahasa); source map rilis = berkas privat di server; aksi online-only memakai `idempotency_command.channel='ONLINE'` | `DISEPAKATI` (user); source map tanpa kolom, `channel`, format `D-…` (OQ-S31..S33 terjawab) |
| 17 | **Identitas global + keanggotaan per tenant** (keputusan user 2026-11-19; **menggantikan** "akun per tenant" 2026-11-18 dan OQ-S30/S34): satu **email = satu akun Better Auth global** (email unik se-sistem, satu password); `app_user` = **profil/keanggotaan per tenant** (`UQ (tenant_id, auth_user_id)`; peran/izin/cakupan outlet tetap di tenant); staf kasir boleh `app_user` **tanpa** identitas global (hanya PIN); tenant = *organization* BA, keanggotaan aktif = `member`; login back-office **hanya email** (tanpa username, alias, verifikasi email, email keluar); undangan/reset password lewat **kode sekali pakai terikat email** (tabel `member_code`; undangan 72 jam, reset 24 jam; penerbit tidak melihat/menetapkan password; `membership_status` `PENDING`→`ACTIVE`); mengeluarkan anggota = hapus keanggotaan; **cookie sesi per slug** (akun tetap global). **Tidak ada fitur/kolom warna tenant** di MVP; nama tenant diatur operator platform (OQ-S35) | `DISEPAKATI` (user; OQ-S37/S38/S39 terjawab 2026-11-19) |
| 18 | **Rate limit** (keputusan user 2026-11-18/19, ARCHITECTURE §6.9): penghitung di **memori proses** (hilang saat restart diterima); **tidak ada tabel/kolom baru** di server (tanpa `locked_until`/percobaan di `app_user` atau `pairing_code`, tanpa kuota per tenant); PIN di device = hitungan monotonik + jeda berbasis jam terkoreksi (`staff_pin_state`) | `DISEPAKATI` (user; rincian lokal OQ-S36 terjawab 2026-11-19) |
| 12 | **Serah-terima bill waiter → kasir** (PRD): lease berpindah **hanya** lewat event `BILL_ACCEPTED` yang diproses server (online); kolom jenis register `cash_master.register_type` (`CASHIER`/`WAITER`); status `PREBILL_PRINTED` → `bill.is_awaiting_payment`; kunci layar 10 menit hanya sisi device (`meta.idle_lock`, `cart_draft`) | `DISEPAKATI` inti (PRD KEP-22); detail skema dijawab user (OQ-S19..S23) |

### 0.4 Daftar isi

1. Prinsip Desain Database & Standar Tipe Data
2. Kolom Metadata Wajib untuk Offline-First & Sinkronisasi
3. ERD (per modul + keseluruhan)
4. Kamus Data per Modul (4.1 … 4.6)
5. Strategi Indexing, Constraint, Optimasi, Partisi, RLS
6. Pemetaan Sinkronisasi Server vs Client, Store Dexie, Estimasi Storage
7. Rekonsiliasi dengan PRD
8. Matriks Traceability Tabel ↔ BR/FR
9. Open Questions Skema (seluruhnya terjawab: S01..S40 — S30 dan S34 digantikan)
10. Kolom/Tabel yang Bergantung pada Keputusan PRD (terjawab dan masih open)
- Lampiran A — Katalog nilai enum · Lampiran B — Daftar tipe perintah (command) · Lampiran C — Ilustrasi DDL

---

## 1. Prinsip Desain Database & Standar Tipe Data

### 1.1 Prinsip desain

| ID | Prinsip | Turunan dari |
|---|---|---|
| DB-01 | **Server adalah otoritas**. Skema server menyimpan hasil akhir; skema client hanya salinan baca-saja (master) atau fakta awal yang menunggu dikirim (transaksi). | AP-01, AP-04 |
| DB-02 | **Fakta tidak ditolak**: tidak ada constraint yang membuat penjualan nyata gagal tersimpan karena alasan bisnis (stok minus, harga beda, produk nonaktif). Kondisi bisnis dicatat sebagai **flag** (`data_flag`), bukan `CHECK` yang melempar error. Constraint hanya untuk integritas struktural. | AP-02, BR-SYN-030 |
| DB-03 | **Snapshot di transaksi**: nama, harga, faktor UOM, tarif, mode pajak, locale struk disalin ke baris transaksi; tidak ada FK yang artinya "ambil nilai terbaru". FK ke master hanya untuk penelusuran. | AP-07, EC-023 |
| DB-04 | **Append-only** untuk ledger stok, audit log, event bill. Ditegakkan di level hak akses (REVOKE UPDATE/DELETE) + trigger penjaga. | AP-09, BR-AUD-002 |
| DB-05 | **Satu pintu penulisan master** (menaikkan `tenant_sync.version`, men-stamp `version`) — diuji, tidak ada penulisan master langsung. | BR-ARC-006 |
| DB-06 | **Kepemilikan tabel per modul**; join lintas modul hanya via view/read model terdaftar. Pemetaan modul → tabel di §1.9. | BR-ARC-003 |
| DB-07 | **Siap partisi, tidak dipartisi di MVP**: tabel besar memiliki kunci waktu (`business_date`/`processed_at`); keputusan retensi server ditinjau ulang sebelum produksi jangka panjang. | NFR-DATA-001, OQ-03 |
| DB-08 | **Satu representasi kanonik** lintas server/client/JSON: uang integer, kuantitas string desimal, waktu ISO-8601 UTC, tanggal `YYYY-MM-DD`; tidak bergantung locale. | BR-I18N-006, BR-MNY-002 |
| DB-09 | **Model siap diperluas** (hub LAN, KDS): setiap baris transaksi menyimpan `register_id`/`device_id` asal; `bill_event` berurut per device. | AP-11 |
| DB-10 | **Migrasi server aditif (expand → contract, dua rilis)**: kolom/tabel baru harus **nullable atau ber-DEFAULT**; penghapusan, perubahan nama/tipe/makna kolom dan penyempitan constraint **hanya** pada rilis kontrak **setelah** versi minimum klien (`app_release.min_supported_*`) dinaikkan melewati semua klien yang masih bergantung pada bentuk lama. Tidak ada migrasi destruktif dan tidak ada migrasi turun (§2.5). | AP-11, BR-SYN-003/022, NFR-MNT-001 |
| DB-11 | **Versi menempel di fakta**: perintah, penjualan, nota kredit, dan event bill menyimpan `app_version` dan `schema_version`; event append-only disimpan **permanen**, sehingga server membaca kontrak lama **selamanya** lewat *upcaster* di aplikasi (bukan di database). | BR-SYN-022, AP-09 |
| DB-12 | **Isolasi tenant juga di sisi client**: satu origin dapat melayani banyak tenant, sehingga database Dexie, kunci penyimpanan lokal, nama Web Lock dan kanal siaran diberi awalan `tenant_id`; tidak ada pembacaan data tenant lintas tenant di device. Satu-satunya penyimpanan lintas tenant adalah registry slug→tenant_id (tanpa data bisnis; §4.6.9). | BR-TNT-001, NFR-SEC-002 |

### 1.2 Strategi primary key: UUIDv7 buatan client

`DISEPAKATI` (PRD §5.1: "ID: UUIDv7").

| Aspek | Ketentuan |
|---|---|
| Tipe | Server: `uuid` (16 byte). Client/JSON: `string` kanonik huruf kecil 36 karakter. |
| Pembuat | **Client** untuk semua baris yang lahir di device (`sale`, `sale_line`, `shift`, `bill`, `bill_event`, `outbox_command`, …) sehingga bisa dibuat **tanpa jaringan** dan **tanpa koordinasi**. **Server** untuk baris yang lahir di server (master, GR, transfer, stocktake, `stock_movement`, `attention_item`, `audit_log` server-side). Generator sama (paket Kernel bersama, AP-06). PostgreSQL 18 memiliki `uuidv7()` bawaan yang boleh dipakai sebagai `DEFAULT` cadangan; bila memakai versi lebih lama, ID selalu diberikan aplikasi. |
| Alasan UUIDv7 (bukan UUIDv4 / bigserial) | (1) **offline**: tidak butuh sequence server (bigserial mustahil di device); (2) **time-ordered** → sisipan B-tree ke ujung kanan indeks, locality baik (UUIDv4 acak memecah halaman indeks pada tabel 10⁷ baris); (3) **idempotensi**: ID yang sama dikirim ulang → upsert tanpa efek ganda (EC-004); (4) tabrakan antar device praktis mustahil (74 bit acak). |
| **Peringatan urutan** | Bagian waktu UUIDv7 berasal dari **jam device yang tidak dipercaya** (AP-08). ID hanya menjamin **keunikan dan kira-kira berurutan**, **bukan** urutan bisnis. Urutan otoritatif memakai `received_at`/`processed_at` (waktu server), `version` (master), `bal_seq` (ledger), `chain_seq` (audit), `bill_seq`+`device_seq` (event bill). |
| Hubungan dengan nomor invoice | **`invoice_no` BUKAN PK dan BUKAN kunci FK.** `invoice_no` adalah atribut bisnis (format `{PREFIKS}-{MMYY}-{URUT6}`, BR-INV-003) yang unik per tenant dan tanpa celah per (register, `MMYY`). Alasan dipisah: nomor baru ada **saat finalisasi** (BR-INV-004) sedangkan `id` ada sejak keranjang; nomor bisa berakhiran `-D1` pada konflik (BR-INV-009); prefiks register dapat berubah per periode; seluruh FK harus stabil. Hubungan keduanya: `UNIQUE (tenant_id, invoice_no)` dan `UNIQUE (register_id, invoice_period, invoice_seq, invoice_conflict_idx)` (§4.5). |
| ID untuk idempotensi | Untuk `FinalizeSale`, kunci idempotensi = `sale.id` (PRD §6.3). Untuk perintah lain, kunci = `command_id` UUIDv7 milik perintah (`idempotency_command.command_id`). |
| PK komposit | Dipakai hanya untuk tabel asosiasi murni dan tabel 1:1 (mis. `tenant_sync` PK = `tenant_id`; `stock_balance` PK = `(outlet_id, sku_id)`; `invoice_series` PK = `(register_id, doc_type, period)`). |
| ID di URL/QR/log | Boleh ditulis di log (`saleId`, `commandId`; BR-LOG-006/007); bukan data pribadi. |

### 1.3 Presisi angka, mata uang, dan pemetaan tipe

`DISEPAKATI` (BR-MNY-001/002/003; AP-05). **Alasan inti**: float/double tidak dapat merepresentasikan 0,1 secara eksak dan menghasilkan selisih akumulatif pada total, pajak, dan alokasi LR; akuntansi POS menuntut angka struk offline = angka server = angka laporan (G-03). Maka pecahan **hanya muncul sesaat saat kalkulasi di titik terdefinisi (BR-MNY-003), hasilnya dibulatkan ke integer, DISIMPAN, dan tidak pernah dihitung ulang**.

| Kategori | Tipe PostgreSQL | Tipe TS / Dexie / JSON | Aturan |
|---|---|---|---|
| **Uang** (harga, diskon, pajak, SC, rounding, total, HPP, nilai persediaan, kas) | `bigint` (satuan terkecil; IDR = 1 rupiah) | `number` bilangan bulat aman (`Number.isSafeInteger`; maks ±9,0×10¹⁵) | Tidak pernah float. Nilai uang negatif hanya di tempat yang sah (`rounding`, `value_delta`, `inventory_value` stok minus, `variance`). Driver `pg` memetakan `int8` ke `number` dengan guard (melempar bila di luar rentang aman), bukan ke `string`. Wire JSON: bilangan bulat. |
| **Kuantitas** (qty jual, qty base, stok, resep) | `numeric(18,4)` (scale tetap **4**, OQ-09) | `string` desimal kanonik, regex `^-?\d+(\.\d{1,4})?$`, tanpa notasi ilmiah | Aritmetika memakai library desimal; operator float dilarang (BR-MNY-002). `numeric(18,4)` membulatkan diam-diam bila diberi >4 digit pecahan, sedangkan BR-UOM-005 mewajibkan **penolakan** → validasi Zod di batas sync **sebelum** query; kolom tidak membawa pengaman kedua selain `CHECK (qty = trunc(qty, 4))` yang dipasang pada tabel ledger. |
| **Faktor konversi** | `numeric(18,4)` | `string` desimal | `> 0` (BR-UOM-002/005). |
| **Persentase** (tarif pajak/SC, persen diskon) | `numeric(7,4)` **dalam persen** (`11.0000` = 11%) | `string` desimal | Rumus memakai `p/100` di kernel. `CHECK 0 ≤ x ≤ 100`. (Alternatif basis point ditolak sementara, OQ-S13.) |
| **Kode mata uang** | `char(3)` `CHECK (currency = 'IDR')` | `'IDR'` | Disimpan pada dokumen yang bernilai (BR-MNY-001); hanya IDR beroperasi di MVP; mengizinkan perluasan tanpa migrasi destruktif. |
| **Counter/urutan** (`version`, `invoice_seq`, `bill_seq`, `device_seq`, `bal_seq`, `chain_seq`) | `bigint` atau `integer` | `number` | `version` bigint (counter tenant tidak pernah turun); seri nomor dokumen `integer` (7 digit setelah 999999 tetap muat). |
| **Waktu instan** | `timestamptz` (disimpan UTC) | `string` ISO-8601 dengan akhiran `Z`, mis. `2026-11-17T07:05:12.345Z` | BR-TIM-001. Tidak ada `timestamp without time zone`. |
| **Tanggal bisnis** | `date` | `string` `YYYY-MM-DD` | Dihitung sekali saat transaksi dibuat lalu disimpan (BR-TIM-004); tidak pernah diturunkan ulang di laporan. |
| **Jam potong** | `time` | `string` `HH:MM` | Per outlet. |
| **Zona waktu** | `text` + `CHECK IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura')` | string | BR-TIM-002. |
| **ID** | `uuid` | `string` | §1.2. |
| **Boolean** | `boolean` | `boolean` | Di IndexedDB boolean **tidak dapat diindeks**; kolom yang perlu indeks lokal dipetakan ke `0/1` (`number`) atau ke string status. Ditandai pada Bab 6. |
| **Hash / salt / biner kecil** | `bytea` | `string` base64url (JSON) / `Uint8Array` (Dexie) | PIN hash, salt, hash audit. |
| **Teks bebas / kode** | `text` | `string` | Panjang dibatasi `CHECK (char_length(x) <= n)` pada kolom yang dicetak/ditampilkan. |
| **Payload fleksibel** | `jsonb` | `object` | Dipakai **hanya** untuk: payload perintah/event, `before_data/after_data` audit, `detail` flag, konfigurasi KDF. Uang di dalam `jsonb` tetap integer dan kuantitas tetap string. **Tidak** dipakai untuk kolom yang perlu di-filter/di-join. |

**Mengapa `numeric` hanya untuk kuantitas/faktor/persentase** (menjawab brief yang menyebut NUMERIC untuk uang, lihat §7.1): kuantitas memang pecahan (0,333 kg) dan sudah diputuskan `numeric` scale 4. Uang tidak pernah pecahan **setelah dibulatkan**; menyimpannya sebagai `numeric` hanya membuka peluang pecahan tertinggal di database (mis. `4162.5`) yang kemudian tertampil/terjumlah berbeda di client (JS `number`) dan server. `bigint` memaksa pembulatan terjadi di kode terdefinisi (Kernel bersama) dan sekaligus mempercepat agregat laporan.

**Biaya per satuan (rata-rata, biaya referensi)** **tidak disimpan sebagai angka pecahan**. Disimpan sebagai pasangan (nilai `bigint`, kuantitas `numeric`) dan dibagi saat dibutuhkan (BR-HPP-002); lihat `stock_balance.ref_value/ref_qty` (§4.3).

### 1.4 Waktu: UTC, `business_date`, zona outlet

| Aspek | Ketentuan | Rujukan |
|---|---|---|
| Penyimpanan | Seluruh instan `timestamptz` UTC. Sesi database `SET TIME ZONE 'UTC'`; aplikasi tidak pernah menyimpan jam lokal. | BR-TIM-001 |
| Zona & jam potong | `outlet.timezone` (3 nilai IANA) dan `outlet.day_cutoff_time` (default `00:00`). Perubahan hanya berlaku ke transaksi berikutnya (EC-026). | BR-TIM-002/003 |
| `business_date` | Kolom `date NOT NULL` di setiap dokumen transaksi (`sale`, `credit_note`, `cash_movement`, `stock_movement`, `goods_receipt`, `transfer`, `stocktake`, `bill_event`, …). Dihitung **sekali** oleh Kernel bersama dari `occurred_at` terkoreksi + zona + jam potong outlet, **disimpan**, tidak diturunkan ulang. | BR-TIM-004 |
| Waktu device vs server | Tiap dokumen yang lahir di device membawa 4 waktu: `created_at_device` (jam device mentah), `clock_offset_ms` (offset terhadap server dari sync terakhir), `occurred_at` (= device + offset; dipakai untuk `business_date` dan label), dan `received_at` (jam server saat diproses; **acuan urutan**). | BR-TIM-005, AP-08 |
| Periode nomor dokumen | `invoice_period` `char(4)` `MMYY` **dari `business_date`**, bukan jam dinding (BR-INV-003). | BR-INV-003 |
| Penggunaan `occurred_at` | Hanya label/pelaporan (mis. flag `item_tidak_tersedia`, BR-CAT-013); **tidak pernah** dipakai menolak atau mengurutkan pemrosesan. | BR-CAT-013 |
| Log operasional | Di file, UTC `Z` (BR-LOG-003) — bukan tabel. | §7.5 |

*Contoh (V-22):* outlet `Asia/Jakarta`, jam potong `04:00`. Penjualan 2026-11-18 02:30 WIB → `occurred_at = 2026-11-17T19:30:00Z`, `business_date = 2026-11-17`, `invoice_period = '1126'`. Penjualan 2026-11-18 04:00:00 WIB → `business_date = 2026-11-18`.

### 1.5 Konvensi penamaan

| Objek | Aturan | Contoh |
|---|---|---|
| Tabel | `snake_case`, tunggal; tabel asosiasi `a_b` | `sale_line`, `sku_uom`, `role_permission` |
| Kolom | `snake_case`; FK = `<entitas>_id`; waktu = `<kata_kerja>_at`; tanggal = `<..>_date`; uang bigint tanpa sufiks khusus tetapi bernama jelas (`line_gross`, `tax_amount`); kuantitas basis = `qty_base`; kuantitas UOM jual = `qty` | `created_at`, `business_date`, `outlet_id` |
| Boolean | awalan `is_`/`has_`/`allow_` | `is_active`, `allow_fraction` |
| PK | `id` (kecuali PK komposit) | — |
| Constraint | `pk_<tabel>`, `fk_<tabel>__<ref>`, `uq_<tabel>__<kolom>`, `ck_<tabel>__<aturan>` | `ck_sale__rounding_unit` |
| Indeks | `ix_<tabel>__<kolom...>`; parsial menambah akhiran `__live` untuk `deleted_at IS NULL` | `ix_price_entry__outlet_sku__live` |
| Enum teks | HURUF_BESAR_UNDERSCORE; kode alasan HURUF_BESAR | `'PAID'`, `'KEMBALI_STOK'` |
| Nama tabel ↔ entitas PRD | Dipetakan di §7.2 | `register` → `cash_master` |

### 1.6 Enum vs tabel lookup

`DIUSULKAN`.

| Pilihan | Dipakai untuk | Alasan |
|---|---|---|
| `text` + `CHECK (col IN (...))` | Himpunan **stabil dan kecil** yang berubah bersama rilis aplikasi: `status` dokumen, `movement_type`, `doc_type`, `tax_profile`, `price_tax_mode`, `disposition`, `direction`, jenis event bill | Tipe `ENUM` PostgreSQL sulit di-*rename/remove*, tak bisa dikurangi nilai tanpa membangun ulang; migrasi Drizzle lebih sederhana dengan `CHECK`; di JSON/Dexie nilainya string biasa (BR-I18N-004: status disimpan sebagai **kode**, bukan teks terjemahan). Menambah nilai = migrasi ringan (`DROP/ADD CONSTRAINT`), dan klien N−1 yang belum mengenal nilai baru tetap aman karena server yang menolak/menerima. |
| Tabel lookup bertenant | Himpunan yang **dikonfigurasi pengguna**: `uom`, `payment_method`, `role`, `category`, `modifier_group` | Dapat ditambah tenant tanpa rilis; ikut feed sync dengan `version`. |
| Tabel lookup global (tanpa `tenant_id`) | `permission` (katalog kode permission), `app_release` | Bukan data tenant; diisi migrasi/seed; baca-saja bagi aplikasi (§1.8). |
| Kode alasan (void/retur/kas) | `reason_code text` (kode HURUF_BESAR dari katalog aplikasi, mis. `CUSTOMER_REQUEST`, `WRONG_ITEM`, `DAMAGED`, `OTHER`) + `reason_text text` bebas | BR-I18N-004 (kode, bukan teks) dan BR-I18N-005 (alasan bebas satu bahasa). Katalog kode di aplikasi, bukan tabel, agar offline dan berversi bersama kamus i18n. |

Katalog lengkap nilai enum: Lampiran A.

### 1.7 Soft delete (tombstone) dan penghapusan

| Kelas tabel | Perlakuan | Rujukan |
|---|---|---|
| Master yang ikut feed (`version`) | **Soft delete**: `deleted_at` diisi, `version` dinaikkan (tombstone ikut feed pull agar device menghapus salinan). Tidak ada `DELETE` fisik pada baris yang pernah dirujuk transaksi. Baris yang sama sekali tak pernah dirujuk (mis. override ketersediaan SKU) dapat dihapus fisik **setelah** melewati `tenant_sync.tombstone_floor_version`. | BR-SYN-010, BR-CAT-004, EC-023 |
| Master server-saja | Soft delete bila dirujuk transaksi; hapus fisik bila tidak. | — |
| Transaksi (`sale`, `credit_note`, `shift`, `cash_movement`) | **Tidak pernah dihapus.** Pembatalan = **status** (`VOID`, `CANCELED`), nomor tetap terpakai. | BR-INV-005 |
| Ledger/audit/event | **Tidak pernah diubah atau dihapus** (append-only). Koreksi = baris baru berlawanan (`GR_REVERSAL`, `SALE_VOID`). | BR-STK-001, BR-AUD-002 |
| Natural-key unik + soft delete | Dua pola: (a) **unik parsial** `WHERE deleted_at IS NULL` bila nama/kode dapat dipakai ulang oleh baris baru (kategori, SKU code, barcode); (b) **unik penuh + "hidupkan kembali"** (undelete) bila tabel dirujuk FK komposit atau natural key-nya bermakna tunggal (`sku_uom (sku_id, uom_id)`, `price_entry`, `item_outlet_availability`). Pola dipilih per tabel di Bab 4. | — |

Tombstone dan hapus fisik: *"pembersihan tombstone (30 hari)"* pada PRD (BR-SYN-010 poin 6) diterjemahkan di skema menjadi **`tenant_sync.tombstone_floor_version`** — versi tertinggi yang tombstone-nya **tidak lagi dijamin ada di feed**. Cursor device di bawah nilai ini → `FULL_RESYNC_REQUIRED`. Baris soft-deleted yang masih dirujuk transaksi **tetap ada secara fisik** (tidak dihapus) dan hanya tidak lagi dikirim pada full resync (full resync menyaring `deleted_at IS NULL`).

### 1.8 Multi-tenant dan Row Level Security (ringkasan)

`DISEPAKATI` (BR-TNT-001, NFR-SEC-002). Detail kebijakan di §5.6.

1. **`tenant_id uuid NOT NULL` ada di semua tabel bertenant**, termasuk tabel anak dan ledger (denormalisasi disengaja agar RLS dapat dievaluasi tanpa join).
2. **RLS `ENABLE` + `FORCE`** pada semua tabel bertenant. Kebijakan: `tenant_id = current_setting('app.tenant_id')::uuid` untuk `USING` dan `WITH CHECK`. `app.tenant_id` diisi per transaksi (`set_config(..., true)` = `SET LOCAL`) oleh lapisan akses data **setelah** autentikasi (sesi Better Auth untuk `/admin`; credential device untuk `/pos`).
3. **FK komposit tenant-aman** (`DISEPAKATI`, OQ-S03): setiap tabel induk yang dirujuk memiliki `UNIQUE (tenant_id, id)`, dan setiap FK anak berbentuk `FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, id)`. Alasan: pemeriksaan FK di PostgreSQL **tidak tunduk pada RLS**; tanpa FK komposit, bug aplikasi dapat menulis baris tenant A yang merujuk ID baris tenant B. Biaya: satu indeks unik tambahan kecil per tabel induk. Di kamus ditulis `FK→induk` saja.
4. **Pengecualian "tabel global"** (tanpa `tenant_id`, tanpa RLS, baca-saja bagi peran aplikasi, diisi migrasi): `permission`, `app_release`, serta tabel milik Better Auth (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) yang dikelola library dan **di luar cakupan kamus ini** kecuali tautannya (`tenant.auth_org_id`, `app_user.auth_user_id`). Pengecualian ini **tidak berisi data bisnis tenant** dan dicatat di §7.3 (BR-TNT-001 dibaca untuk "tabel yang memuat data tenant").
5. **Pembatasan per outlet** (Manager hanya outlet yang ditugaskan) ditegakkan di lapisan aplikasi (permission + `user_outlet`); RLS cukup pada tenant. Opsi kebijakan RLS kedua per outlet dicatat di §5.6 sebagai penguatan lanjutan.

### 1.9 Pemetaan modul (BR-ARC-003) → tabel fisik

| Modul | Tabel yang dimiliki (fisik) |
|---|---|
| **Identitas & Tenancy** | `tenant`, `legal_entity`, `outlet`, `tax_rate_history`, `register_invoice_prefix`, `outlet_receipt_setting`, `feature_flag`, `payment_method`, `app_user`, `member_code`, `role`, `permission`*, `role_permission`, `user_outlet`, `cash_master`, `device`, `pairing_code`, `user_pin_credential`, `staff_pin`, `staff_pin_state` |
| **Katalog** | `category`, `uom`, `product`, `product_attribute`, `attribute_value`, `sku`, `sku_attribute_value`, `sku_uom`, `price_entry`, `item_outlet_availability`, `modifier_group`, `modifier_group_product`, `modifier`, `modifier_ingredient`, `recipe_item` |
| **Inventori** | `stock_balance`, `stock_movement`, `supplier`, `goods_receipt`, `goods_receipt_line`, `transfer`, `transfer_line`, `stocktake`, `stocktake_line` |
| **Penjualan** | `sale`, `sale_line`, `sale_line_modifier`, `sale_payment`, `credit_note`, `credit_note_line`, `credit_note_refund`, `invoice_series`, `invoice_gap`, `register_recovery` |
| **Shift & Kas** | `cash_cashier`, `cash_movement` |
| **F&B** | `fnb_table`, `bill`, `bill_item`, `bill_item_modifier`, `bill_event` |
| **Sync** | `tenant_sync`, `idempotency_command`, `attention_item`, `data_flag`, `device_sync_status`, `app_release`* |
| **Audit** | `audit_log`, `audit_chain_head` |
| Laporan | (tanpa tabel; view/read model baca-saja, §5.8) |

\* tabel global. Catatan: `price_entry` berada di modul **Katalog** (BR-ARC-003) walau dibahas bersama inventaris di Bab 4.3 sesuai urutan brief. `stock_balance` mengacu `outlet_id`, `sku_id` modul lain hanya lewat FK (relasi data), bukan penulisan langsung (BR-ARC-003).

### 1.10 Kelas tabel

Kelas menentukan kolom wajib (§2.3) dan perilaku sinkronisasi (Bab 6).

| Kelas | Kode | Ciri | Contoh |
|---|---|---|---|
| Master turun | **M** | Ditulis online di `/admin`; ikut feed pull; punya `version`, tombstone | `product`, `sku`, `price_entry`, `outlet`, `app_user` |
| Master server-saja | **S** | Ditulis online; **tidak** diunduh device | `supplier`, `product_attribute`, `recipe_item`, `user_pin_credential` |
| Transaksi naik | **T** | Lahir di device (UUIDv7 client), dikirim sebagai perintah, diproses server; tak dihapus | `sale`, `credit_note`, `cash_cashier`, `bill` |
| Anak transaksi | **TC** | Baris anak dari kelas T, ikut perintah yang sama | `sale_line`, `sale_payment` |
| Ledger / append-only | **L** | Hanya INSERT; tak ada `updated_at`/`deleted_at` | `stock_movement`, `audit_log`, `bill_event` |
| Dokumen online | **D** | Ditulis online di `/admin` (GR, transfer, opname), siklus status, tak diunduh | `goods_receipt`, `transfer`, `stocktake` |
| Saldo/proyeksi | **P** | Diturunkan dari ledger/event dalam transaksi yang sama; dapat dibangun ulang | `stock_balance`, `bill`, `bill_item`, `invoice_series` |
| Kontrol sinkronisasi | **K** | Mengendalikan sync/antrean/idempotensi | `tenant_sync`, `idempotency_command`, `attention_item` |
| Global | **G** | Tanpa `tenant_id`, tanpa RLS | `permission`, `app_release` |

---

## 2. Kolom Metadata Wajib untuk Offline-First dan Sinkronisasi

### 2.1 Peran kolom sinkronisasi per sisi (rekonsiliasi `version` / `synced_at` / `sync_status`)

Brief awal menyebut kolom `version` untuk resolusi konflik, `synced_at`, dan `sync_status`. **PRD memutuskan model yang berbeda** (BR-SYN-010/020/030, AP-01/04): server adalah otoritas, master satu arah turun, transaksi satu arah naik sebagai perintah idempoten. Konsekuensinya, kolom-kolom itu tidak berperan sebagai resolusi konflik, dan sebagian hanya ada di salah satu sisi:

| Kolom | Server (PostgreSQL) | Client (Dexie) | Peran sebenarnya |
|---|---|---|---|
| `version` (`bigint`) | **Ada hanya di tabel kelas M** (yang ikut feed). Di-stamp dari `tenant_sync.version` dalam transaksi penulisan yang sama. | Salinan dari server; **baca-saja**; tidak pernah dinaikkan di client. | **Posisi dalam feed pull** (cursor `(version, id)`), **bukan** pembanding konflik. Banyak baris dapat berbagi satu versi (impor massal). |
| `updated_at` | Ada di kelas M/S/D/P; diisi `now()` oleh aplikasi | Salinan informasi | **Informasi** audit/tampilan. **Tidak pernah dipakai sebagai cursor** (jebakan 1, BR-SYN-011) dan tidak dipakai menyelesaikan konflik. |
| `deleted_at` | Ada di kelas M/S | Salinan (baris tombstone langsung dihapus dari Dexie saat diterima) | Tombstone feed (BR-SYN-010). |
| `received_at` | Ada di kelas T/TC/L: jam **server** saat perintah diproses | Diisi dari hasil ACK (`server_result.received_at`) | Acuan urutan dan "waktu terima" — **pengganti peran `synced_at` di server**. |
| `synced_at` | **Tidak ada di server** (semua yang ada di server pasti sudah "tersinkron"; `received_at` sudah mencatat kapan). | **Ada hanya di store transaksi lokal**: waktu ACK diterima (waktu server dari respons) | Dipakai retensi lokal (hanya yang `ACKED` boleh dibersihkan, BR-SYN-054) dan tampilan "terkirim". |
| `sync_status` | **Tidak ada** | **Ada hanya di store transaksi lokal** (`sale`, `credit_note`, `shift`, `cash_movement`, `bill`, …): `PENDING` / `SENDING` / `ACKED` / `NEEDS_ATTENTION` | **Cermin** status `outbox_command` pada baris dokumennya, agar daftar riwayat dan badge "belum terkirim" cepat. **Sumber kebenaran status = `outbox_command`**. |
| `device_seq` | Ada di `idempotency_command`, `bill_event` | Ada di `outbox_command`, `bill_event` lokal | Urutan lokal per device (FIFO per register, BR-SYN-023). Tidak dipercaya lintas device. |
| `schema_version` | Ada di semua tabel T (`STD-T`), `bill_event`, `idempotency_command`, `audit_log` | Ada di `outbox_command` & dokumen lokal | **Versi kontrak** payload (integer monoton; server menerima N dan N−1 untuk perintah **baru**, membaca kontrak lama **selamanya**; BR-SYN-022, §2.5). |
| `app_version` | Ada di semua tabel T (`STD-T`), `bill_event`, `idempotency_command`, `audit_log`, `device_sync_status` | Ada di `outbox_command` & dokumen lokal | **Versi aplikasi** (tag SemVer, mis. `v1.6.2`): identitas rilis pembuat fakta; diagnostik/jejak, **bukan** dasar pemrosesan (§2.5). |
| `catalog_cursor` | Ada di `sale` | Ada di `sale` lokal | Versi master yang dimiliki device saat menjual (BR-CAT-013). |
| `clock_offset_ms` | Ada di dokumen T & `device_sync_status` | Ada di `meta` & dokumen lokal | Koreksi jam (BR-TIM-005). |

**Tidak ada resolusi konflik merge / last-write-wins di skema ini**, karena:
1. Master hanya diubah online oleh admin; commit terakhir menang **secara serial** oleh counter versi (EC-049) — tidak ada penulisan master dari device.
2. Transaksi tidak pernah diedit dua pihak: tiap dokumen lahir di satu device; server hanya menerima.
3. Open bill dimiliki **satu device** (lease), sehingga tidak ada penulisan bersamaan (BR-FNB-003).
4. Satu-satunya kasus "konflik" ditangani sebagai **flag/antrean** (`data_flag`, `attention_item`, nomor `-Dn`), bukan penggabungan nilai (BR-SYN-030, BR-INV-009).

Satu-satunya frasa "commit terakhir menang" di PRD (EC-049: dua admin mengubah ketersediaan item/outlet yang sama bersamaan) dipenuhi oleh **serialisasi counter versi** `tenant_sync` (versi 131 lalu 132; keduanya tercatat di audit) — bukan oleh kolom atau algoritma penggabungan di skema.

### 2.2 Kolom standar (diwarisi tabel yang menyebutnya)

#### `STD-M` — master yang ikut feed (kelas M)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 (server membuat; admin online). |
| `tenant_id` | `uuid` | `string` | NN, FK→`tenant` | BR-TNT-001; kunci RLS. |
| `version` | `bigint` | `number` (baca-saja) | NN, CHK `> 0` | Stamp dari `tenant_sync` (BR-SYN-010). **Satu-satunya jalur penulisan: fungsi Sync** (BR-ARC-006). |
| `created_at` | `timestamptz` | `string` ISO | NN, DEF `now()` | Informasi. |
| `updated_at` | `timestamptz` | `string` ISO | NN, DEF `now()` | Informasi; **bukan cursor** (BR-SYN-011). |
| `created_by` | `uuid` | `string \| null` | FK→`app_user`, NULL | Pelaku; NULL = sistem/seed. |
| `updated_by` | `uuid` | `string \| null` | FK→`app_user`, NULL | Pelaku perubahan terakhir. |
| `deleted_at` | `timestamptz` | `string \| null` | NULL | Tombstone. Tidak ada kolom `is_deleted` terpisah. |

#### `STD-S` — master server-saja (kelas S)

`id`, `tenant_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` (definisi sama dengan `STD-M`), **tanpa `version`**.

#### `STD-T` — header dokumen transaksi dari device (kelas T)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 buatan **client**. |
| `tenant_id` | `uuid` | `string` | NN, FK→`tenant` | — |
| `outlet_id` | `uuid` | `string` | NN, FK→`outlet` | Filter laporan & sync. |
| `register_id` | `uuid` | `string` | NN, FK→`cash_master` | Identitas asal (AP-11). |
| `device_id` | `uuid` | `string` | NN, FK→`device` | Device fisik pembuat (bisa berganti pada register yang sama). |
| `created_by` | `uuid` | `string` | NN, FK→`app_user` | Staf yang bertindak (kasir). |
| `created_at_device` | `timestamptz` | `string` ISO | NN | Jam device **mentah** (tak dipercaya). |
| `clock_offset_ms` | `integer` | `number` | NN | Offset server−device saat dibuat (BR-TIM-005). |
| `occurred_at` | `timestamptz` | `string` ISO | NN | `created_at_device + clock_offset_ms`; dasar `business_date`. |
| `business_date` | `date` | `string` | NN | Tersimpan (BR-TIM-004). |
| `received_at` | `timestamptz` | `string` ISO (dari ACK) | NN, DEF `now()` | Jam **server** saat diproses; acuan urutan. |
| `command_id` | `uuid` | `string` | NN, FK→`idempotency_command` | Perintah pembuat baris (jejak idempotensi, korelasi log). |
| `schema_version` | `integer` | `number` | NN, CHK `> 0` | **Versi kontrak** perintah pembawa (integer monoton, §2.5). Ditulis eksplisit dari perintah; `DEFAULT 1` hanya dipakai migrasi *backfill* lalu dilepas. |
| `app_version` | `text` | `string \| null` | NULL, CHK `char_length <= 30`, CHK `app_version ~ '^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$'` | **Versi aplikasi** pembuat (tag SemVer; sumber `__APP_VERSION__` saat build; BR-LOG-004). Nullable di DB **hanya** untuk baris lama/hasil backfill; amplop perintah baru wajib membawanya (Zod). |

Anak transaksi (kelas TC) mewarisi **`id`, `tenant_id`, `<induk>_id`** dan, bila dipakai pelaporan baris, mendenormalisasi **`outlet_id`** dan **`business_date`** dari induknya (diisi pada INSERT yang sama, tak pernah diubah).

#### `STD-L` — ledger append-only (kelas L)

`id uuid PK`, `tenant_id`, `outlet_id` (bila relevan), `processed_at timestamptz NN DEF now()` (server), `occurred_at timestamptz`, `business_date date NN`, tanpa `updated_at`, tanpa `deleted_at`, tanpa `version`. Hak `UPDATE/DELETE` dicabut (§5.5).

#### `STD-D` — dokumen online (GR, transfer, opname; kelas D)

`id`, `tenant_id`, `outlet_id`, `doc_no text NN` (`UQ (tenant_id, doc_no)`), `status text NN`, `business_date date NN`, `created_at`, `updated_at`, `created_by NN`, `posted_at`, `posted_by`, `note text`. Tanpa `version` (tidak diunduh). Nomor dokumen tidak wajib tanpa celah (BR-FNB-002 analog); format (OQ-S05 terjawab): `GR-{OUTLET}-{MMYY}-{URUT4}`, `TRF-…`, `OPN-…` (mis. `GR-OUT01-1126-0001`), `MMYY` dari `business_date` dokumen (sama seperti nomor invoice, BR-INV-003); urut per outlet per jenis per bulan (reset tiap `MMYY`), diberikan server.

### 2.3 Kolom wajib per kelas tabel (matriks)

`●` wajib · `○` opsional/tergantung tabel · `–` tidak ada

| Kolom | M | S | T | TC | L | D | P | K |
|---|---|---|---|---|---|---|---|---|
| `id` (UUIDv7) | ● | ● | ● | ● | ● | ● | ○ (PK komposit) | ● |
| `tenant_id` | ● | ● | ● | ● | ● | ● | ● | ● |
| `version` | ● | – | – | – | – | – | – | ○ (`tenant_sync` itu sendiri) |
| `created_at` / `updated_at` | ●/● | ●/● | `received_at`/○ | – | `processed_at`/– | ●/● | –/● | ●/○ |
| `created_by` / `updated_by` | ●/● | ●/● | ●/– | – | ○/– | ●/– | – | ○ |
| `deleted_at` | ● | ● | – | – | – | – | – | – |
| `outlet_id` | ○ | ○ | ● | ○ (denorm) | ○ | ● | ● | ○ |
| `register_id` / `device_id` | – | – | ●/● | – | ○ | – | – | ○ |
| `created_at_device`, `clock_offset_ms`, `occurred_at` | – | – | ● | – | ○ | – | – | – |
| `business_date` | – | – | ● | ○ (denorm) | ● | ● | – | – |
| `command_id`, `schema_version`, `app_version` | – | – | ● | – | ○ | – | – | ● |
| `status` | ○ | ○ | ● | ○ | – | ● | ○ | ● |

### 2.4 Pola audit

Tiga lapis, masing-masing punya tujuan berbeda (jangan dicampur):

| Lapis | Mekanisme | Isi | Mutabel? |
|---|---|---|---|
| 1. Metadata pelaku di baris | `created_by`, `updated_by`, `approved_by` (kolom FK pada baris dokumen: `void_approved_by`, `approver_id`) | "Siapa terakhir" — informasi cepat | Berubah bersama baris |
| 2. **Audit log bisnis** `audit_log` | Satu entri per peristiwa BR-AUD-001 (void, diskon override, perubahan harga/ketersediaan, retur, role/PIN, device, GR/transfer/opname, selisih kas, anotasi gap, ekspor pending, laci, kunci PIN, penyelesaian "perlu perhatian") dengan aktor, penyetuju, sebelum/sesudah, waktu device & server, hash berantai | Jejak tak dapat diubah | **Tidak** (append-only, §4.6) |
| 3. Log operasional | File JSON (server) + antrean Dexie (device) | Diagnostik teknis; **bukan** tabel | Dibuang sesuai retensi (BR-LOG-001/011) |

Aturan penulisan audit: dibuat **di transaksi yang sama** dengan perubahan bisnisnya (BR-ARC-005); entri yang lahir offline ikut **payload perintah di outbox** (disematkan atomik di perintah `FinalizeSale` dll., atau perintah `AppendAudit` tersendiri) sehingga **tidak hilang walau perintah terkaitnya masuk "perlu perhatian"** (BR-AUD-003). Korelasi ke log: kolom `request_ref` (ID referensi `YYYYMMDD-HHmmss-xxxxx`, BR-LOG-005) dan `command_id` pada `audit_log`, `idempotency_command`, `attention_item`.

---
### 2.5 Versioning, kompatibilitas, dan migrasi aditif

Keputusan user 2026-11-18 (selaras `docs/ARCHITECTURE.md` §3.2/§9.6; kini tercantum di PRD: KEP-23, BR-VER-001..012, FR-VER-001..008; lihat §7.2). Ada **empat nomor versi, terpisah**; hanya dua yang disimpan per fakta:

| Nomor | Contoh | Disimpan di | Per transaksi? | Fungsi |
|---|---|---|---|---|
| **Versi aplikasi** `app_version` | `v1.6.2` (tag SemVer git) | Kolom `app_version` (`text`) pada tabel T (`STD-T`: `sale`, `credit_note`, `cash_cashier`, `cash_movement`, `bill`), `bill_event`, `idempotency_command`, `audit_log`; Dexie `outbox_command` dan store transaksi | **Ya** | Identitas rilis pembuat fakta (diagnostik, penelusuran bug); **tidak** dipakai memproses |
| **Versi kontrak** `schema_version` | `7` (integer monoton) | Kolom `schema_version` (`integer`) pada tabel yang sama | **Ya** | Format payload perintah/event; dasar upcaster dan penerimaan N / N−1 |
| **Versi protokol sync** | `2` | `device_sync_status.sync_protocol_version`; Dexie `meta.sync_protocol_version` | **Tidak** | Mekanisme tukar data (amplop, cursor, urutan siklus) |
| **Versi skema Dexie** | `12` | Dexie `meta.dexie_version` (lokal saja) | **Tidak** | Bentuk store/indeks lokal; tidak dikirim ke server |

**Kapan `schema_version` naik** — hanya bila format perintah/event berubah **tidak kompatibel**: isian wajib baru, ubah nama/tipe/satuan, hapus/ubah makna. Isian **opsional** baru tidak wajib menaikkan.

**Nama kolom final dan bentuknya** (konsisten dengan konvensi §1.5; sudah dipakai di Bab 4):

| Aspek | `schema_version` | `app_version` |
|---|---|---|
| Tipe PG / TS | `integer` / `number` | `text` / `string \| null` |
| Nullability | **NN**, `CHK > 0` | **NULL** diizinkan (CHK format SemVer `^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$`, ≤ 30 karakter) |
| Default | Tidak ada di aplikasi (ditulis eksplisit dari perintah). **Backfill:** migrasi menambah kolom `NOT NULL DEFAULT 1` (kontrak awal) lalu melepas default | Tidak ada; baris lama/hasil backfill = `NULL`; **amplop perintah baru wajib membawanya** (validasi Zod, bukan constraint DB) |
| Indeks | **Tidak diindeks** (tidak dipakai di jalur baca harian). Laporan "berapa perintah per versi" memakai agregasi berkala; indeks parsial ditambahkan hanya bila terbukti perlu | idem |
| Audit | `audit_log`: kedua kolom **nullable** (entri buatan server tanpa perintah) | idem |

**Event append-only dan upcaster.** Event/perintah yang sudah tersimpan **tidak diubah** dan `schema_version` menempel permanen di barisnya. Server harus dapat membaca **semua** versi lama **selamanya**: bentuk lama diterjemahkan ke bentuk terkini oleh **upcaster di aplikasi** (fungsi murni `vN → vN+1`, ber-golden-test per pasangan versi di paket `contracts`), **bukan** oleh trigger/view database. Isian payload berada di kolom `jsonb` (`payload`, `result`, `before_data`/`after_data`); kolom bertipe mengikuti aturan aditif di bawah. *Menerima* perintah baru dibatasi `min_supported_*` (§4.6.8); *membaca* yang sudah tersimpan tidak pernah dibatasi.

**Migrasi database server aditif (expand → contract, dua rilis; DB-10):**

| Fase | Rilis | Boleh | Dilarang |
|---|---|---|---|
| **Expand** | N | Menambah tabel/kolom **nullable atau ber-DEFAULT**; indeks baru (`CREATE INDEX CONCURRENTLY`); `CHECK … NOT VALID` lalu `VALIDATE`; menambah nilai enum-`CHECK`; aplikasi menulis bentuk baru **dan** tetap membaca bentuk lama | `DROP`/`RENAME` kolom, ubah tipe/makna, `NOT NULL` tanpa default pada tabel berisi |
| **Backfill** | N | Mengisi kolom baru bertahap (batch kecil di luar transaksi master) | Kunci panjang pada tabel besar |
| **Contract** | N+k, **setelah** `min_supported_*` dinaikkan melewati semua klien yang bergantung pada bentuk lama | Menghapus kolom lama, menyempitkan constraint, `SET NOT NULL` | Dilakukan pada rilis yang sama dengan expand |

Tidak ada migrasi turun; rollback aplikasi hanya ke versi yang masih mengenal semua kontrak yang sudah dipakai klien (ARCHITECTURE §3.2 butir 6). Menambah `NOT NULL` melalui tiga langkah: tambah nullable/default → backfill → `SET NOT NULL`/validasi constraint.

---
## 3. ERD (Entity Relationship Diagram) Berbasis Teks

**Notasi:** `A 1───* B` = satu A memiliki banyak B (1:N) · `A 1───1 B` = 1:1 · `A *───* B` = N:M (lewat tabel asosiasi yang disebut) · `0..1` = opsional · `──>` = FK (arah ke induk) · `[..]` = catatan. Semua tabel bertenant memiliki `tenant_id → tenant` (tidak digambar ulang di tiap garis agar terbaca; lihat §1.8). Tabel global ditandai `(G)`.

### 3.1 ERD Modul 1 — Bisnis, Outlet, Pengguna, Device

```
 tenant 1───1 tenant_sync                        [counter versi]       tenant 1───1 audit_chain_head (modul 6)
   │  [slug PERMANEN, unik (semua status); status ACTIVE/SUSPENDED/CLOSED; dicari lewat resolve_tenant_by_slug sebelum konteks RLS]
   │
   ├─1──* legal_entity                            [NPWP, is_pkp]
   │        └─1──* outlet                         [timezone, day_cutoff_time, cash_rounding_unit, mode harga, profil pajak, flag SC, inventory_enabled_at]
   │                ├─1──1 outlet_receipt_setting [header/footer/locale struk/logo]
   │                └─1──* cash_master            [= REGISTER: kode, lebar kertas, jenis CASHIER/WAITER]
   │                        ├─1──* device ──1──1 device_sync_status       (modul 6)
   │                        │        │   [riwayat; maks. 1 device aktif per register]
   │                        │        └──1──* staff_pin_state  [per user × device; arah naik]
   │                        ├─1──* register_invoice_prefix            [prefiks nomor invoice; berlaku-mulai bulan; wajib CASHIER; unik per tenant]
   │                        ├─1──* pairing_code
   │                        └─1──* register_recovery                      (modul 5)
   │
   ├─1──* tax_rate_history                        [berlaku-mulai; outlet_id NULL = default tenant; terisi = khusus outlet]
   │
   ├─1──* feature_flag                            [override per tenant; default di kode; Owner menulis, POS baca-saja]
   │
   ├─1──* member_code                             [kode undangan (72 jam)/reset (24 jam) sekali pakai, terikat email; → app_user; server-saja; dicabut = revoked_at + revoke_reason CANCELED|REPLACED]
   │
   ├─1──* payment_method                          [CASH / NON_CASH]
   │
   ├─1──* role ──1──* role_permission *──1 permission (G)               [batas diskon di role]
   │
   └─1──* app_user                                [profil/keanggotaan per tenant: staf PIN-only (auth_user_id NULL) & akun back-office; auth_user_id → user Better Auth GLOBAL (email unik se-sistem); UQ (tenant_id, auth_user_id); membership_status PENDING|ACTIVE; member BA = cermin keanggotaan ACTIVE]
            ├─1──1 user_pin_credential            [server-saja: verifier PIN]
            ├─*──* outlet  lewat  user_outlet (+ role_id N:1 role)       [outlet_id NULL = semua outlet]
            └─*──* device  lewat  staff_pin       [hash PIN, salt per device; arah turun]
```

Kardinalitas penting: `tenant 1:N legal_entity 1:N outlet 1:N cash_master 1:N device` (hierarki KEP-03); `app_user N:M outlet` lewat `user_outlet` (membawa `role_id`); `role N:M permission` lewat `role_permission`; `app_user 1:1 user_pin_credential`; `app_user N:M device` lewat `staff_pin`.

### 3.2 ERD Modul 2 — Master Produk & Multi-UOM

```
 tenant ─1───* category (self: parent_id → category.id, maks 2 tingkat)
 tenant ─1───* uom

 category 1───* product  *───1 uom (base_uom_id)
                 │1
                 ├──* product_attribute 1──* attribute_value          [server-saja: struktur varian]
                 │1
                 └──* sku ──────────────────────────────┐
                      │ 1  [produk tanpa varian = 1 SKU implisit, is_default]
                      │
                      ├──* sku_attribute_value *──1 attribute_value   [N:M sku × nilai atribut; server-saja]
                      │
                      ├──* sku_uom *──1 uom    [faktor ke base, barcode per UOM; UQ(sku_id,uom_id)]
                      │       │1
                      │       └──* price_entry  (modul 3)   [FK komposit (sku_id,uom_id) → sku_uom]
                      │
                      ├──* recipe_item (menu_sku_id)   *──1 sku (ingredient_sku_id)   [BOM 1 level; server-saja]
                      │
                      └──* item_outlet_availability (sku_id NULL = tingkat produk)   *──1 outlet

 product 1───* item_outlet_availability (tingkat produk: 1 baris per produk × outlet)

 modifier_group *───* product            lewat modifier_group_product
 modifier_group 1───* modifier 1───* modifier_ingredient *──1 sku (bahan)   [ADD/REDUCE/REMOVE; server-saja]
```

Kardinalitas: `product 1:N sku`; `sku 1:N sku_uom` (tepat satu baris `is_base`); `sku N:M attribute_value`; `product N:M outlet` (via `item_outlet_availability`, atribut `status`); `product(menu) 1:N recipe_item N:1 sku(bahan)`.

### 3.3 ERD Modul 3 — Harga & Inventaris per Outlet

```
 sku_uom 1───* price_entry *───0..1 outlet      [outlet_id NULL = harga default tenant (BR-PRC-002)]

 outlet 1───* stock_balance *───1 sku           [PK (outlet_id, sku_id): qty, inventory_value, ref_value/ref_qty]
 stock_balance 1───* stock_movement             [ledger append-only; bal_seq menaikkan urutan per (outlet,sku)]
                                                 (relasi logis, bukan FK: movement tetap ada walau saldo dibangun ulang)

 supplier 1───* goods_receipt 1───* goods_receipt_line *──1 sku, *──1 uom
 goods_receipt 0..1───1 goods_receipt   (reversal_of_id: dokumen koreksi → GR asal)

 outlet(from) 1───* transfer *───1 outlet(to)
 transfer 1───* transfer_line *──1 sku                      [in-transit = transfer_line dari transfer status SENT]

 outlet 1───* stocktake 1───* stocktake_line *──1 sku

 Sumber movement (source_type/source_id, relasi logis):
   sale_line · credit_note_line · goods_receipt_line · transfer_line(OUT/IN) · stocktake_line
```

Kardinalitas: `outlet N:M sku` lewat `stock_balance` (satu baris per pasangan); `transfer` menghubungkan **dua** outlet (`from_outlet_id`, `to_outlet_id`); `stock_movement N:1 (outlet, sku)`.

### 3.4 ERD Modul 4 — HPP Multi-Outlet (alur data, bukan tabel baru)

HPP memakai tabel Modul 3 + kolom snapshot di Modul 5. Tidak ada tabel layer/lot (FIFO ditolak, §4.4).

```
 FinalizeSale (server, 1 transaksi)
   sale_line ──(qty_base, sku)──┐
   [menu F&B] recipe_item ──────┤──> untuk tiap SKU terkonsumsi, urut sku_id ASC:
   modifier_ingredient ─────────┘       SELECT … FROM stock_balance WHERE (outlet_id,sku_id) FOR UPDATE
                                         hitung HPP = R(nilai × q_out / qty)   [BR-HPP-003/005]
                                         INSERT stock_movement (qty_delta<0, value_delta<0, bal_seq+1)
                                         UPDATE stock_balance (qty, nilai, rev, ref_value/ref_qty)
                                         sale_line.cost_snapshot += HPP        [BR-HPP-004: biaya saat server memproses]

 credit_note_line (KEMBALI_STOK) ──> stock_movement RETURN_IN pada biaya snapshot  [BR-HPP-007]
 sale VOID                        ──> stock_movement SALE_VOID (reverses_movement_id) pada biaya snapshot
 transfer SENT/RECEIVED           ──> TRANSFER_OUT (biaya rata-rata saat itu) / TRANSFER_IN (nilai_kirim × q_terima / q_kirim)
```

### 3.5 ERD Modul 5 — Operasional Kasir & Transaksi

```
 cash_master(register) 1───* cash_cashier(shift) 1───* cash_movement
                                  │1
                                  ├───* sale 1───* sale_line 1───* sale_line_modifier *──1 modifier
                                  │       │1            │*──1 sku, *──1 uom   [snapshot, FK hanya untuk penelusuran]
                                  │       ├───* sale_payment *──1 payment_method
                                  │       ├───* credit_note 1───* credit_note_line *──1 sale_line
                                  │       │              └───* credit_note_refund *──1 payment_method
                                  │       └───* data_flag   (entity_type='SALE'/'SALE_LINE'; modul 6)
                                  └───* credit_note (shift pencatat refund tunai)

 cash_master 1───* invoice_series (register, doc_type, period)    [pencatatan nomor tertinggi/gap]
 cash_master 1───* invoice_gap
 cash_master 1───* register_recovery 0..1──1 invoice_gap

 --- F&B ---
 outlet 1───* fnb_table 1───* bill 1───* bill_item 1───* bill_item_modifier *──1 modifier
                           │       │1
                           │       ├───* bill_event          [append-only; bill_seq, device_seq]
                           │       ├───0..1 bill (parent_bill_id: bill anak split → induk)
                           │       ├───0..1 bill (merged_into_bill_id)
                           │       └───0..1 sale (sale.bill_id; tepat satu sale per bill anak/bill biasa yang PAID)
                           ├── bill.lease_device_id *──1 device         [pemegang (lease); pindah HANYA lewat BILL_ACCEPTED di server]
                           └── bill.lease_register_id / handover_target_register_id *──1 cash_master   [pemegang saat ini / tujuan serah-terima 'menunggu diterima']
```

Kardinalitas: `sale 1:N sale_line`; `sale 1:N sale_payment` (multi-metode, BR-PAY-002); `sale 1:N credit_note` (retur parsial berkali-kali, kumulatif ≤ qty); `sale 1:0..1 bill` (F&B); `bill 1:N bill` (split: induk → anak; merge: sumber → target); `cash_cashier 1:N sale` dan `1:N cash_movement`; satu register memiliki **maksimal satu** `cash_cashier` berstatus `OPEN` (BR-SHF-001).

### 3.6 ERD Modul 6 — Sinkronisasi & Log

```
 tenant 1───1 tenant_sync                    [version, tombstone_floor_version]
 tenant 1───1 audit_chain_head               [last_seq, last_hash; lock baris untuk rantai]
 tenant 1───* audit_log                      [append-only; UQ(tenant_id, chain_seq)]

 device 1───1 device_sync_status             [last_success_sync_at, clock_offset_ms, pending_count, app_version, storage_persist]
 device 1───* idempotency_command 1───0..1 attention_item     [1 perintah gagal struktural/otorisasi → 1 item]
 idempotency_command 1───* sale / credit_note / cash_movement / bill_event / stock_movement / audit_log   [via command_id]
 idempotency_command 1───* data_flag         [flag bisnis yang dihasilkan pemrosesan perintah]
 attention_item *──0..1 idempotency_command  (blocked_by_command_id: perintah dependen ditahan menunggu induknya)

 app_release (G)  [katalog rilis + versi minimum klien: min_supported_app_version / min_supported_schema_version] — dirujuk device_sync_status.app_version (logis)

 device (client) ── Dexie device_log ──POST /device-log──► BERKAS log server (scope device; ref_local D-…; BUKAN tabel)
 device (client) ── Dexie cart_draft (CART|BILL; lokal saja; tak disinkron)
 idempotency_command.channel = OUTBOX (push) | ONLINE (HandOverBill/AcceptBill/CancelBillHandover; device_seq NULL)

 (Tidak ada tabel log operasional di PostgreSQL — §7.5.)
```

### 3.7 ERD Ringkas Keseluruhan

```
                                    ┌──────────┐
                                    │  tenant  │──1:1── tenant_sync / audit_chain_head
                                    └────┬─────┘
                       ┌──────────┬──────┴───────┬─────────────┬───────────────┐
                    1:N│       1:N│           1:N│          1:N│            1:N│
                 legal_entity  app_user ──N:M── role    category/uom      payment_method
                       │1:N        │ N:M ── outlet(user_outlet)   │
                    ┌──┴───┐       │                              │1:N
                    │outlet│◄──────┘                           product ─1:N─ sku ─1:N─ sku_uom
                    └─┬─┬─┬┘                                       │            │        │1:N
        outlet_*_config│ │ │1:N                                    │N:M(outlet)  │        price_entry ──0..1── outlet
                       │ │ └── fnb_table ─1:N─ bill ─1:N─ bill_event/bill_item
                       │ │1:N                              │0..1:1
                       │ cash_master(register) ─1:N─ device ─1:N─ idempotency_command ─0..1─ attention_item
                       │   │1:N                                │
                       │   cash_cashier(shift) ─1:N─ cash_movement
                       │        │1:N                           │ command_id (jejak)
                       │        sale ─1:N─ sale_line ─1:N─ sale_line_modifier
                       │          │ ├─1:N─ sale_payment
                       │          │ └─1:N─ credit_note ─1:N─ credit_note_line / credit_note_refund
                       │ 1:N                │ (cost_snapshot ◄── HPP server)
                       └─ stock_balance ─1:N─ stock_movement ◄── sumber: sale_line, credit_note_line,
                              (outlet×sku)         goods_receipt_line, transfer_line, stocktake_line
                       goods_receipt / transfer / stocktake (dokumen online)
                       audit_log (aktor, penyetuju, objek) · data_flag (flag bisnis) · invoice_series/invoice_gap
```

### 3.7.1 Ringkasan kardinalitas lintas modul

| Relasi | Tipe | Catatan |
|---|---|---|
| tenant → legal_entity → outlet → cash_master → device | 1:N berantai | KEP-03; device tunggal aktif per register |
| app_user ↔ outlet | N:M (`user_outlet`) | Membawa role; `outlet_id NULL` = semua outlet |
| app_user ↔ device | N:M (`staff_pin`) | Salt per device |
| role ↔ permission | N:M (`role_permission`) | `permission` global |
| product → sku → sku_uom | 1:N → 1:N | Produk tanpa varian = 1 SKU implisit |
| sku ↔ attribute_value | N:M (`sku_attribute_value`) | Server-saja |
| product ↔ outlet | N:M (`item_outlet_availability`) | Override SKU: baris dengan `sku_id` |
| sku_uom → price_entry | 1:N | Harga per (SKU, UOM, outlet NULL/outlet) |
| outlet ↔ sku | N:M (`stock_balance`) | PK `(outlet_id, sku_id)` |
| shift (cash_cashier) → sale | 1:N | Satu shift OPEN per register |
| sale → sale_line / sale_payment / credit_note | 1:N | Snapshot di baris |
| credit_note_line → sale_line | N:1 | Kumulatif qty retur ≤ qty baris |
| bill → bill (split/merge) | 1:N (self) | `parent_bill_id`, `merged_into_bill_id` |
| bill → sale | 1:0..1 | `sale.bill_id` |
| bill ↔ cash_master | N:1 ×2 | `lease_register_id` (pemegang) dan `handover_target_register_id` (tujuan serah-terima); register berjenis `CASHIER` untuk pembayaran/penerimaan |
| idempotency_command → attention_item | 1:0..1 | Satu perintah gagal → satu item |
| device → device_sync_status | 1:1 | — |

---
## 4. Kamus Data per Modul

**Cara membaca.** Tiap tabel memuat: **fungsi**, **kelas** (§1.10), **lokasi** (server / Dexie dan arah sinkronisasi), **kolom** (nama, tipe PG, tipe TS/lokal, constraint, keterangan + aturan bisnis), serta **constraint tabel & indeks khusus**. Kolom standar (`STD-*`, §2.2) tidak diulang. Tipe TS/lokal mengikuti legenda §1.3 (uang `number` integer · kuantitas/faktor/persen `string` desimal · waktu `string` ISO UTC · tanggal `string` `YYYY-MM-DD`). Untuk tabel **server-saja**, kolom TS memuat tipe TS di server dan **tidak ada representasi Dexie**.

Notasi lokasi Dexie: **↓ penuh** = diunduh penuh ke device (baca-saja) · **↓ filter outlet** / **↓ filter device** = hanya baris outlet/device itu · **↑ lokal** = lahir di device, dikirim lewat outbox · **↕ campuran** · **—** = tidak ada di device.

---

### 4.1 Modul 1 — Bisnis, Outlet, Pengguna, Device (Identitas & Tenancy)

#### 4.1.1 `tenant` — pelanggan SaaS

Batas isolasi RLS (BR-TNT-001). Kelas **M** (versi dan locale bawaan diunduh). Lokasi: server + Dexie **↓ penuh** (hanya baris tenant sendiri; disimpan di store `meta`). Rujukan: KEP-03, BR-TNT-001, BR-I18N-002, FR-TNT-001.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | Berfungsi sebagai `tenant_id` (tabel ini tidak memiliki kolom `tenant_id`; RLS: `id = app.tenant_id`). |
| `name` | `text` | `string` | NN, CHK `char_length BETWEEN 1 AND 40` | Nama tampilan tenant (tampil di UI/PWA; maks 40 karakter menurut PRD BR-TEN-007/EC-097). **Diatur operator platform saat pembuatan tenant; perubahan hanya lewat operator** (`/platform`) — **tidak ada layar atau permission Owner untuk mengubah nama di MVP** (OQ-S35 terjawab). Dampak skema: **tidak ada** — tidak ada permission `tenant.rename`, tidak ada kolom tambahan; operator menulis lewat fungsi Sync dengan konteks tenant tujuan (§5.6 butir 7) sehingga `version`/feed tetap berjalan, dan perubahannya dicatat sebagai aksi sistem di `audit_log` (`actor_user_id` NULL). **Tidak ada kolom warna/tema tenant**: tidak ada fitur atau pengaturan warna tenant di MVP (keputusan user 2026-11-18), sehingga tidak ada kolom, constraint format warna, maupun validasi kontras. **Tidak ada kolom paket/kuota**: tidak ada kuota per tenant di MVP (rate limit hanya per device/akun/IP/slug di memori; ARCHITECTURE §6.9.3). |
| `slug` | `text` | `string` | NN, UQ (penuh, semua status), CHK `slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'` (3–30 karakter, hanya huruf kecil/angka/tanda hubung, tidak diawali/diakhiri tanda hubung) | Pengenal tenant di URL sub-path (`/{slug}/admin`, `/{slug}/pos`). **Permanen** (tidak dapat diubah setelah dibuat) dan **tidak rahasia**. Lihat "Slug tenant" di bawah. |
| `status` | `text` | `string` | NN, DEF `'ACTIVE'`, CHK IN (`ACTIVE`,`SUSPENDED`,`CLOSED`) | Tenant tidak dihapus; `SUSPENDED/CLOSED` ditolak saat sync (billing di luar MVP). **Sudah memadai** untuk membedakan tenant ditangguhkan dari slug tak dikenal (lihat "Slug tenant"); kolom `suspended_at` **tidak ditambahkan** (waktu perubahan status ada di `updated_at` dan `audit_log`). |
| `default_locale` | `text` | `string` | NN, DEF `'id-ID'`, CHK IN (`id-ID`,`en-US`) | Prioritas ke-3 pemilihan bahasa (BR-I18N-002). |
| `currency` | `char(3)` | `string` | NN, DEF `'IDR'`, CHK `= 'IDR'` | BR-MNY-001. |
| `auth_org_id` | `text` | `string` | UQ, NULL | Tautan ke *organization* Better Auth (BR-AUT-001). Tabel Better Auth di luar kamus. Kebenaran identitas URL tetap `tenant.slug`; slug *organization* BA, bila dipakai, hanya salinan. |
| `version` | `bigint` | `number` | NN | Distamp dari `tenant_sync` miliknya sendiri. |
| `created_at`, `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

**Slug tenant** (keputusan user 2026-11-18: tenant dikenali dari URL sub-path):

1. **Keunikan tanpa membedakan huruf besar-kecil.** Dipilih **`text` + CHECK huruf kecil + `UNIQUE`** (bukan `citext`): karena CHECK hanya meloloskan `a-z`, `0-9`, `-`, nilai tersimpan selalu huruf kecil sehingga `UNIQUE` biasa **sudah** tak membedakan huruf besar-kecil; tidak perlu ekstensi atau indeks `lower(slug)`. Aplikasi **menormalkan ke huruf kecil** (`lower()`) segmen URL sebelum mencari. (Email di `user` Better Auth disimpan huruf kecil oleh library.)
2. **Keunikan penuh, tidak pernah dipakai ulang.** `UQ (slug)` berlaku untuk **semua** status termasuk `CLOSED`; tenant tidak pernah dihapus (di atas) sehingga slug lama tidak dapat diambil tenant lain (mencegah URL lama, bookmark, dan database Dexie lama menunjuk tenant yang salah).
3. **Kata terlarang** (platform, admin, pos, api, health, assets, login, static, www, dan serupa): ditolak saat pembuatan tenant. **Disimpan sebagai konstanta di kode, bukan tabel (OQ-S27 terjawab 2026-11-18)**: konstanta di paket `contracts` yang dipakai validator Zod, plus uji otomatis yang memastikan setiap segmen rute tingkat-atas aplikasi ada di daftar. Usulan isi awal (final di kode): `platform, admin, pos, api, health, ping, assets, static, login, logout, signup, register, auth, sync, release, status, support, help, docs, billing, dashboard, app, www, root, solva, system, public, owner`.
4. **Permanen.** Slug tidak boleh berubah setelah dibuat. **Ditegakkan di database oleh trigger (OQ-S28 terjawab 2026-11-18)**: trigger `BEFORE UPDATE OF slug` yang melempar galat bila `NEW.slug IS DISTINCT FROM OLD.slug`. Tidak ada API/layar yang mengubah slug; memindahkan tenant ke slug lain adalah operasi di luar MVP (tenant baru + migrasi data).
5. **Tidak rahasia.** Slug muncul di URL dan registry perangkat; keamanan **tidak** bergantung pada kerahasiaan slug (autentikasi + RLS tetap berlaku). Perlindungan terhadap penebakan slug adalah *rate limit* — **batas umum per IP di Nginx** ditambah **penghitung memori per IP + slug** di aplikasi (ARCHITECTURE §6.9.3) — bukan penyamaran; **tidak ada tabel atau kolom** di database untuk ini.
6. **Slug tak dikenal vs tenant tidak aktif dapat dibedakan server.** Pencarian slug mengembalikan `(tenant_id, status)`: **tidak ada baris** → server membalas **404 generik** (tanpa petunjuk); `status` `SUSPENDED`/`CLOSED` → halaman **"tidak tersedia"** (tanpa data tenant); `ACTIVE` → lanjut ke login/enrollment. Konsekuensi yang diterima: keberadaan slug dapat diketahui dari perbedaan respons (slug memang tidak rahasia).
7. **Pencarian sebelum konteks tenant.** Pada saat slug dicari, `app.tenant_id` belum ada dan RLS `tenant` (`id = app.tenant_id`) akan menghasilkan nol baris. Dipakai **fungsi `resolve_tenant_by_slug(text)`**: `SECURITY DEFINER`, `search_path` terkunci, mengembalikan **hanya** `(id, status)` maksimal satu baris, `EXECUTE` hanya untuk `solva_app`; tidak memberi akses baca lain ke `tenant` dan **tidak** memakai `BYPASSRLS` (selaras §5.6 butir 7). Hasilnya dipakai untuk mengisi `app.tenant_id` pada transaksi berikutnya.
8. **Domain kustom per tenant ditunda** (OQ-S29 terjawab 2026-11-18): **tanpa kolom atau tabel** di MVP; kelak tabel aditif `tenant_domain` (DB-10).

#### 4.1.2 `legal_entity` — entitas hukum (NPWP, PKP)

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh** (header struk dapat memuat nama/NPWP; snapshot ke `sale`). Rujukan: BR-TNT-002, BR-TAX-002, BR-TAX-010, FR-TNT-002.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `name` | `text` | `string` | NN, CHK ≤ 160 | Nama badan usaha. |
| `npwp` | `text` | `string \| null` | NULL, CHK `npwp ~ '^\d{15,16}$'` | Disimpan **tanpa tanda baca**; format tampilan oleh UI. 15 digit (lama) atau 16 digit (NIK/NPWP baru). |
| `is_pkp` | `boolean` | `boolean` | NN, DEF `false` | Status PKP **melekat di entitas hukum**, bukan outlet (BR-TNT-002). Menentukan apakah outlet boleh `tax_profile = 'PPN'` (BR-TAX-002). |
| `pkp_since` | `date` | `string \| null` | NULL | Informasi administratif. |
| `address` | `text` | `string \| null` | NULL | Untuk faktur pajak fase lanjut. |

Constraint tabel: `CHK (is_pkp = false OR npwp IS NOT NULL)` (PKP wajib punya NPWP) · `UQ (tenant_id, npwp) WHERE npwp IS NOT NULL AND deleted_at IS NULL`.

#### 4.1.3 `outlet` — lokasi usaha

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet** (hanya baris outlet device; transfer antar outlet dilakukan online sehingga outlet lain tidak diperlukan di device). Rujukan: KEP-03, BR-TNT-003/004, BR-TIM-002/003, BR-TAX-001/002/003/005/009, BR-STK-004, FR-TNT-003, EC-025.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `legal_entity_id` | `uuid` | `string` | NN, FK→`legal_entity` | Tepat satu entitas hukum per outlet (BR-TNT-002). |
| `code` | `text` | `string` | NN, CHK `^[A-Z0-9]{1,10}$` | Mis. `OUT01`. **Tidak dapat diubah setelah ada transaksi** (trigger penjaga; dipertahankan sebagai kehati-hatian — kode **tidak lagi membentuk nomor invoice**, BR-TNT-004). |
| `name` | `text` | `string` | NN, CHK ≤ 120 | — |
| `address` | `text` | `string \| null` | NULL | Cetak struk (header bebas ada di `outlet_receipt_setting`). |
| `phone` | `text` | `string \| null` | NULL | — |
| `timezone` | `text` | `string` | NN, DEF `'Asia/Jakarta'`, CHK IN (`Asia/Jakarta`,`Asia/Makassar`,`Asia/Jayapura`) | BR-TIM-002. Perubahan hanya berlaku transaksi berikutnya (EC-026). |
| `day_cutoff_time` | `time` | `string` `HH:MM` | NN, DEF `'00:00'` | Jam potong hari bisnis (BR-TIM-003). Batas awal inklusif. |
| `cash_rounding_unit` | `integer` | `number` | NN, DEF `100`, CHK IN (`0`,`100`,`500`,`1000`) | Unit pembulatan tunai; `0` = tidak dibulatkan (BR-TAX-009). Disalin ke `sale.cash_rounding_unit`. |
| `price_tax_mode` | `text` | `string` | NN, CHK IN (`INCLUSIVE`,`EXCLUSIVE`) | Mode harga per outlet (BR-TAX-003). **Wajib dipilih saat outlet dibuat.** Berlaku langsung (tanpa tanggal; OQ-S04 opsi B); disalin ke `sale.price_tax_mode` (EC-025). |
| `tax_profile` | `text` | `string` | NN, DEF `'NONE'`, CHK IN (`NONE`,`PPN`,`PB1`) | Satu profil aktif sekali waktu (BR-TAX-002; AS-09 `PERLU KONFIRMASI` OQ-01c: outlet campuran). `PPN` hanya bila `legal_entity.is_pkp` (trigger). Tarifnya ada di `tax_rate_history`. |
| `service_charge_enabled` | `boolean` | `boolean` | NN, DEF `false` | Service charge aktif (F&B). |
| `service_charge_rate` | `numeric(7,4)` | `string` | NN, DEF `0`, CHK 0..100 | Persen service charge (mis. `5.0000`). **Berlaku langsung** (tidak berlaku-mulai); disalin ke `sale.service_charge_rate`. Harus `0` bila `service_charge_enabled = false`. |
| `service_charge_taxable` | `boolean` | `boolean` | NN, DEF `true` | SC masuk dasar pajak? (BR-TAX-005; `DISEPAKATI` OQ-01a: default ya, dapat diubah per outlet). |
| `inventory_enabled_at` | `timestamptz` | `string \| null` | NULL | Aktivasi stok per outlet (BR-STK-004). NULL = belum aktif; penjualan sebelumnya tidak membuat movement. Dipakai F3→F4 bertahap. |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | Outlet bertransaksi tak dihapus; hanya dinonaktifkan. |

Constraint tabel: `UQ (tenant_id, code)` (penuh, bukan parsial: kode outlet tak dipakai ulang) · trigger: `legal_entity` harus satu tenant (dijamin FK komposit). **Efek samping pembuatan outlet:** dalam satu transaksi (satu kenaikan versi) dibuat baris awal `outlet_receipt_setting`, **dan** baris `item_outlet_availability` `AVAILABLE` untuk semua produk aktif (BR-CAT-011, OQ-24).

#### 4.1.4 `tax_rate_history` — riwayat tarif pajak (berlaku-mulai)

**Keputusan (revisi 2026-11-18): hanya tarif *pajak* yang berlaku-mulai**, disimpan di tabel riwayat tersendiri. Tarif **service charge**, mode harga, profil pajak, SC aktif, dan SC kena pajak berada di `outlet` dan berlaku **langsung** (§4.1.3); riwayat perubahannya ada di audit log (nilai sebelum/sesudah) dan tiap transaksi menyalin tarif yang dipakainya.

*Tujuan tanggal berlaku-mulai:* device memilih tarif menurut **`business_date` transaksi**, bukan waktu sinkron. Contoh: PPN 11% → 12% mulai 1 Januari; owner menyiapkannya 20 Desember; tablet yang offline pun memakai 11% untuk transaksi 31 Des dan 12% untuk 1 Jan. Baris lama tidak ditimpa sehingga penjualan dan retur lama tetap dapat ditelusuri.

*Bentuk:* satu tabel dengan **kode pajak** dan **outlet opsional** (pola sama dengan `price_entry`): baris `outlet_id IS NULL` = **default tenant** (cocok untuk PPN yang berlaku nasional: satu baris untuk semua outlet); baris dengan `outlet_id` = tarif khusus outlet (cocok untuk PB1 yang ditetapkan per daerah). Kolom `tax_code` membuat tabel siap bila kelak dibutuhkan dua pajak sekaligus (OQ-01c).

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet** (baris outlet device + baris default tenant). Rujukan: BR-TAX-001, FR-TNT-005, EC-005. **Bergantung pada OQ-01** (§10).

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `tax_code` | `text` | `string` | NN, CHK IN (`PPN`,`PB1`) | Jenis pajak; dipilih Kernel dari `outlet.tax_profile` (profil `NONE` = tanpa pajak, tidak memakai tabel ini). |
| `outlet_id` | `uuid` | `string \| null` | NULL, FK→`outlet` | **NULL = default tenant**; terisi = khusus outlet. |
| `effective_from` | `date` | `string` | NN | Tanggal bisnis mulai berlaku. |
| `rate` | `numeric(7,4)` | `string` | NN, CHK 0..100 | Persen pajak (mis. `11.0000` PPN efektif, `10.0000` PB1). |

Constraint tabel: **`UQ NULLS NOT DISTINCT (tenant_id, tax_code, outlet_id, effective_from)`** penuh (hapus = tombstone; isi ulang = hidupkan kembali baris). Perubahan tarif **hanya menambah baris baru** dengan `effective_from` ≥ tanggal bisnis hari ini (histori tak diubah); dicatat audit `tax_rate.changed` (BR-AUD-001).

**Aturan pemilihan tarif** (Kernel, client dan server sama), untuk transaksi dengan `business_date = d` pada outlet `o` berprofil `tax_code = c`:

```
rate = baris(c, o) dengan effective_from terbesar ≤ d      -- 1. khusus outlet
    ?? baris(c, NULL) dengan effective_from terbesar ≤ d   -- 2. default tenant
    ?? tidak ada → tarif tidak dapat ditentukan (profil belum dikonfigurasi; transaksi diblokir di POS)
```

Tarif yang terpilih dan barisnya disalin ke `sale` (`tax_rate`, `tax_rate_id`) sebagai snapshot. Validasi lintas tabel: outlet berprofil `PPN`/`PB1` wajib memiliki tarif yang dapat dipilih; `PPN` hanya untuk entitas hukum PKP (trigger pada `outlet`).

**Konsekuensi yang diterima:** perubahan `outlet.price_tax_mode`, `tax_profile`, `service_charge_enabled`/`service_charge_rate`/`service_charge_taxable` tidak dijadwalkan; berlaku pada transaksi berikutnya setelah device menerima perubahan (EC-025). Tablet yang sinkron lebih dulu berganti lebih dulu — disarankan mengubahnya di luar jam operasional.

#### 4.1.5 `register_invoice_prefix` — prefiks nomor invoice per register (berlaku-mulai bulan)

**Keputusan user 2026-11-18 (PRD, BR-INV-003):** nomor invoice **`{PREFIKS}-{MMYY}-{URUT6}`**, nota kredit **`{PREFIKS}-NK-{MMYY}-{URUT6}`**. Prefiks diatur **per register**, **wajib** (register `CASHIER`), dan **unik di seluruh tenant**. Tabel ini **menggantikan** `outlet_invoice_config` (awalan per outlet + opsi "cetak kode register"): kode outlet dan kode register tidak lagi membentuk nomor.

Perubahan prefiks tetap berlaku **mulai periode `MMYY` berikutnya** (BR-INV-003), sehingga disimpan sebagai baris berperiode dan dipilih menurut `business_date` (device offline pun benar). Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter device** (prefiks register sendiri). Rujukan: BR-INV-003/010, FR-DEV-001, FR-POS-015, V-29.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `register_id` | `uuid` | `string` | NN, FK→`cash_master` | Register pemilik prefiks. |
| `effective_month` | `date` | `string` | NN, CHK `EXTRACT(day FROM effective_month) = 1` | Hari pertama bulan **bisnis** mulai berlaku. Device memilih baris terbesar ≤ awal bulan `business_date`. Baris awal = bulan bisnis saat register dibuat. |
| `invoice_prefix` | `text` | `string` | NN, CHK `char_length BETWEEN 2 AND 16`, CHK `invoice_prefix ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'`, CHK `invoice_prefix !~ '(^\|-)NK$'` | Huruf besar dan angka; **tanda hubung hanya di dalam** (tidak di awal/akhir, tidak berurutan); **segmen terakhir bukan `NK`** agar tidak rancu dengan nota kredit. Bentuk ini disetujui (OQ-S24 terjawab 2026-11-19). Mis. `OUT01-POS02`, `KSR1`. |

Constraint tabel: `UQ (register_id, effective_month)` penuh (hapus = tombstone; isi ulang = hidupkan kembali). **Validasi lintas baris (trigger + aplikasi, bukan CHECK):**
1. **Unik per tenant:** `invoice_prefix` tidak boleh dipakai baris **register lain** (tidak ter-tombstone, bulan mana pun) di tenant yang sama; register yang sama boleh memakai kembali prefiksnya. Indeks bantu `(tenant_id, invoice_prefix)` (bukan unik, karena satu register dapat memiliki beberapa baris berprefiks sama).
2. **Wajib untuk `CASHIER`:** register berjenis `CASHIER` harus punya minimal satu baris yang berlaku pada bulan berjalan; register `WAITER` tidak wajib (tidak menerbitkan invoice, BR-FNB-011).
3. **Berlaku-mulai:** baris baru (selain baris awal) hanya boleh `effective_month` = awal bulan **berikutnya** atau lebih.
4. Pengaman terakhir: `UQ (tenant_id, invoice_no)` di `sale`/`credit_note` (§4.5). Bila nomor tetap kembar (mis. device lama dipulihkan), nomor diterima dengan akhiran `-Dn` dan masuk "perlu perhatian" (BR-INV-009).

**Membaca nomor** (parsing dari kanan): `URUT` (digit) → `MMYY` (4 digit) → bila ada `NK` → sisanya = prefiks. Karena segmen terakhir prefiks bukan `NK` dan prefiks register berbeda tidak dapat sama, tidak ada nomor invoice yang dapat tertukar dengan nomor nota kredit atau dengan register lain.

*Contoh:* register `POS02` mengubah prefiks pada 20 November 2026.

| `effective_month` | `invoice_prefix` | Dipakai untuk `business_date` |
|---|---|---|
| 2026-11-01 | `OUT01-POS02` | s.d. 30 Nov 2026 → `OUT01-POS02-1126-000732` |
| 2026-12-01 | `KSR2` | mulai 1 Des 2026 → `KSR2-1226-000001` |

Prefiks `OUT01-POS02` tidak dapat dipakai register lain, walau sudah tidak berlaku bagi `POS02`.

#### 4.1.6 `outlet_receipt_setting` — kustomisasi struk per outlet

Kelas **M**. Mewarisi `STD-M`. Relasi **1:1** dengan `outlet`. Lokasi: server + Dexie **↓ filter outlet**; logo disalin ke store `asset_cache` sebagai bitmap (BR-PRN-003). Rujukan: BR-PRN-005, BR-I18N-005/007, FR-PRN-006.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `outlet_id` | `uuid` | `string` | NN, UQ, FK→`outlet` | 1:1. |
| `receipt_locale` | `text` | `string` | NN, DEF `'id-ID'`, CHK IN (`id-ID`,`en-US`) | Bahasa struk pelanggan; disalin ke `sale.receipt_locale` agar cetak ulang identik (BR-I18N-007). |
| `header_text` | `text` | `string \| null` | NULL, CHK ≤ 600 | Teks bebas satu bahasa (BR-I18N-005). |
| `footer_text` | `text` | `string \| null` | NULL, CHK ≤ 600 | — |
| `logo_object_key` | `text` | `string \| null` | NULL, CHK `char_length <= 200` | Jalur relatif berkas logo di **folder server** (volume persisten di luar image; keputusan OQ-S06: berkas, bukan kolom database). Folder logo ikut jalur backup volume. Device mengunduh lewat endpoint terpisah. |
| `logo_sha256` | `text` | `string \| null` | NULL, CHK `^[0-9a-f]{64}$` | Penanda perubahan agar device hanya mengunduh ulang bila hash berbeda. |

#### 4.1.7 `payment_method` — metode pembayaran

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh**. Rujukan: BR-PAY-001/005, FR-PAY-002.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `code` | `text` | `string` | NN, CHK `^[A-Z0-9_]{2,20}$` | Mis. `CASH`, `QRIS`, `TRANSFER`, `CARD`. Disalin ke `sale_payment.method_code`. |
| `name` | `text` | `string` | NN, CHK ≤ 60 | Nama tampilan (satu bahasa, BR-I18N-005). |
| `kind` | `text` | `string` | NN, CHK IN (`CASH`,`NON_CASH`) | Hanya `CASH` yang menghasilkan kembalian, pembulatan, dan masuk `kas_diharapkan` (BR-PAY-003/005, BR-SHF-005). |
| `requires_reference` | `boolean` | `boolean` | NN, DEF `false` | Referensi non-tunai opsional/diwajibkan UI (tidak divalidasi isinya, BR-PAY-005). |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | — |

Constraint tabel: `UQ (tenant_id, code) WHERE deleted_at IS NULL` · `UQ (tenant_id) WHERE kind = 'CASH' AND deleted_at IS NULL` (tepat satu metode tunai per tenant; dibuat saat tenant dibuat).

#### 4.1.8 `app_user` — pengguna (staf dan akun back-office)

Satu tabel untuk **profil/keanggotaan per tenant**: staf kasir (hanya PIN, **tanpa** identitas global) dan pengguna back-office (login `/admin` dengan **email + password** lewat identitas global Better Auth). Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet** (staf yang ditugaskan ke outlet device). Rujukan: BR-AUT-001/003, BR-I18N-002, FR-AUT-001/002. **Keputusan user 2026-11-19 (menggantikan OQ-S02 versi lama, OQ-S30, OQ-S34):** identitas **global** (tabel `user` Better Auth: satu email = satu akun = satu password) dan **keanggotaan per tenant** (organization `member`); `app_user` adalah profil tenant yang menunjuk **satu** identitas global lewat `auth_user_id`. Orang yang sama di dua tenant = **satu akun global + dua baris `app_user`** (peran, status, cakupan outlet masing-masing).

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `auth_user_id` | `text` | `string \| null` | NULL | Tautan ke `user` Better Auth **global** (bukan FK komposit; tabel BA di luar RLS). `NULL` = staf kasir **tanpa** akun back-office (hanya PIN) **atau** undangan back-office yang belum ditukar (`PENDING`). Satu identitas dapat dirujuk banyak `app_user` (satu per tenant), **tidak** lebih dari satu per tenant: `UQ (tenant_id, auth_user_id) WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL`. Tidak ada `UQ (auth_user_id)` global lagi. Dipertahankan pada baris yang dikeluarkan (jejak audit). |
| `display_name` | `text` | `string` | NN, CHK ≤ 80 | Nama yang dipilih di layar login PIN (BR-AUT-003: pemilihan nama → PIN tak perlu unik) dan nama tampilan di `/admin`. |
| `preferred_locale` | `text` | `string \| null` | NULL, CHK IN (`id-ID`,`en-US`) | Prioritas ke-1 bahasa (BR-I18N-002); ikut tersinkron. |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | Nonaktif → ditolak saat device online berikutnya (BR-AUT-010, EC-012) dan ditolak oleh penjaga keanggotaan `/admin`. |
| `membership_status` | `text` | `string` | NN, DEF `'ACTIVE'`, CHK IN (`PENDING`,`ACTIVE`) | `PENDING` = baris dibuat **hanya** karena undangan back-office dan **kodenya belum ditukar** (`member_code` `INVITE` aktif); `ACTIVE` = staf/keanggotaan aktif. **Dipertahankan** (walau tidak ada password sementara) karena: (1) membedakan "undangan menunggu" dari staf PIN-only aktif — keduanya ber-`auth_user_id` `NULL`; (2) menahan baris dari unduhan device dan login PIN sampai undangan diterima; (3) memberi daftar "undangan menunggu" di `/admin` dan dasar pembersihan undangan kedaluwarsa tanpa tabel tambahan. Staf PIN-only yang kemudian diundang menjadi back-office **tetap `ACTIVE`** (PIN tetap bekerja) sampai kodenya ditukar. `PENDING → ACTIVE` terjadi dalam transaksi penukaran kode. |

**Kolom yang dihapus (2026-11-19):** `username` (login back-office **hanya email**; sebelumnya `UQ (tenant_id, username)` dan CHECK format dihapus bersamanya) dan `email` (email hidup di `user` Better Auth global, **unik se-sistem**; tidak disalin ke `app_user`). Staf kasir memakai `display_name` + PIN di POS.

Constraint tabel: `UQ (tenant_id, display_name) WHERE deleted_at IS NULL AND is_active` · `UQ (tenant_id, auth_user_id) WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL` · indeks **non-unik** `(auth_user_id) WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL` (menghitung keanggotaan lintas tenant, lihat "Risiko pengambilalihan") · `CHK (membership_status = 'ACTIVE' OR auth_user_id IS NULL)` (baris `PENDING` belum memiliki akun). RLS: standar tenant (`tenant_id = app.tenant_id`); baris tenant lain tak terlihat.

**Pemetaan tabel Better Auth (model global + keanggotaan).**

| Tabel BA | Peran di Solva | Catatan |
|---|---|---|
| `user` | **Identitas global**: `email` (unik se-sistem, huruf kecil), `name`; **tanpa username** | Satu per orang. Tidak ada alias email; `emailVerified` tidak dipakai. Tidak ada bidang tambahan (tanpa `must_change_password`: tidak ada password sementara). |
| `account` | Kredensial password **tunggal** per identitas | Satu password untuk semua tenant orang itu. |
| `session` | **Cookie sesi PER SLUG** (keputusan user 2026-11-19; menggantikan asumsi satu cookie global): tiap tenant memiliki login dan sesi sendiri di browser yang sama (mis. cookie dengan `Path=/{slug}` atau nama berawalan slug), **akun tetap global** | `activeOrganizationId` sesi = tenant slug tersebut; dua tenant dapat aktif bersamaan di satu browser dengan dua login terpisah. Penjaga keanggotaan tetap menjadi penentu akses. Mencabut sesi = per slug (reset password mencabut **seluruh** sesi akun di semua slug). |
| `organization` | Satu per tenant (`tenant.auth_org_id`) | Tenant = organisasi BA. |
| `member` | **Keanggotaan aktif** (user × organization) | Hanya untuk `app_user` ber-`auth_user_id` berstatus `ACTIVE`; dibuat pada penukaran kode `INVITE`, dihapus saat dikeluarkan. `role` BA hanya **cerminan kasar** (`owner`/`member`); **izin berasal dari tabel kita** (`app_user`/`user_outlet`/`role`/`permission`). |
| `invitation` | **Tidak dipakai** | Undangan memakai tabel kita `member_code` (kode sekali pakai terikat email) + `membership_status`. |
| `verification` | **Tidak dipakai** | Tanpa verifikasi email dan tanpa token reset lewat email. |

**Sumber kebenaran:** `app_user` (+ `user_outlet`) adalah sumber kebenaran keanggotaan dan peran tenant; `member` BA adalah cermin yang diubah dalam **transaksi database yang sama** (satu fungsi administrasi/penukaran kode, tidak ada jalur lain) — OQ-S37 terjawab (opsi A).

**Alur login `/{slug}/admin` dan penjaga keanggotaan.** slug → `resolve_tenant_by_slug` → email + password ke BA (identitas global) → **sesi untuk slug itu** (cookie per slug) → **penjaga**: harus ada `app_user` dengan `tenant_id` = tenant slug, `auth_user_id` = pengguna sesi, `membership_status = 'ACTIVE'`, `is_active`, belum dihapus; jika tidak → akses ditolak (pesan generik). `app.tenant_id` diisi dari slug yang lolos penjaga, bukan dari cookie saja. Kegagalan login selalu generik.

**Pembatasan login admin (rate limit, keputusan user 2026-11-18/19): di memori, bukan kolom.** Jeda progresif (30 dtk → 1 → 2 → 5 → 15 mnt; tanpa penguncian permanen) dihitung di memori proses (ARCHITECTURE §6.9.3); **kunci memakai email lintas slug** (OQ-S37 terjawab — satu password global tidak boleh dapat ditebak lewat banyak slug), dengan batas per IP yang longgar sebagai jaring pengaman. **Tidak ada tabel atau kolom penguncian akun** (mis. `locked_until`, `failed_login_count`) di `app_user`, dengan alasan: (1) penguncian akun di DB memungkinkan **penolakan layanan terhadap akun korban**; (2) menulis ke DB pada tiap percobaan di jalur **tanpa autentikasi** menambah beban dan jalur serangan; (3) `app_user` adalah master yang ikut feed sync — kolom penguncian akan menaikkan `version` dan mengalir ke device tanpa guna; (4) hitungan hilang saat restart diterima.

**Undangan back-office — kode sekali pakai (OQ-S38 mekanisme B, keputusan user 2026-11-19; MVP tidak mengirim email).** Tabel `member_code` (§4.1.19). Owner (atau operator) memasukkan **email + peran/cakupan outlet**; sistem membuat `app_user` `PENDING` (`auth_user_id` NULL; atau memakai staf PIN-only yang sudah ada) dan satu `member_code` `INVITE` terikat email (berlaku **72 jam**), lalu **menyerahkan kode secara manual** kepada calon anggota. **Penerbit tidak pernah melihat atau menetapkan password.** Penerbitan **tidak mencari** apakah email sudah punya akun, sehingga **perilaku dan respons sama** untuk email yang sudah/belum punya akun (anti-enumerasi). Penukaran (di `/{slug}/admin`, satu transaksi): kode valid + email cocok → bila **belum ada akun** BA, orang itu **menetapkan passwordnya sendiri** (akun global dibuat); bila **sudah ada akun**, ia **membuktikan dengan password yang sudah dimilikinya** → `app_user.auth_user_id` terisi, `membership_status = 'ACTIVE'`, baris `member` BA dibuat, audit `member.accepted`. Bila akun sudah menjadi anggota tenant ini, penukaran ditolak (`UQ (tenant_id, auth_user_id)`).

**Reset password — kode sekali pakai (24 jam).** `member_code` `RESET` terikat email akun; penerbit (Owner atau operator platform) **tidak melihat atau menetapkan password** — pemilik akun menetapkan passwordnya sendiri saat menukar kode. Penukaran mengganti password global, **mencabut seluruh sesi akun** (semua slug), audit `member.password_reset` (penerbitan: `member.reset_issued`). Tidak ada tabel `verification`/token email.

**Aturan reset dan risiko pengambilalihan lintas tenant (OQ-S38 terjawab).** Karena identitas global, Owner tenant A yang dapat mereset password akun yang juga anggota tenant B = dapat masuk sebagai orang itu ke tenant B. Aturan: **Owner hanya boleh mereset akun yang keanggotaannya HANYA di tenantnya**; penghitungan diperiksa **dua kali — saat penerbitan dan saat penukaran** kode (anggota yang bergabung ke tenant lain di antaranya membuat penukaran ditolak). **Akun multi-tenant hanya dapat direset oleh operator platform atau pemiliknya sendiri** (pemilik: mengganti password dengan password lama, bukan lewat kode). Penolakan **generik**: "Hubungi operator platform" (tidak menyebut tenant lain). Data untuk menurunkan "akun hanya di satu tenant": indeks `app_user(auth_user_id)` (di atas) dan fungsi **`auth_account_membership_count(auth_user_id)`** — `SECURITY DEFINER`, `search_path` terkunci, hanya mengembalikan **jumlah** (`app_user` belum dihapus ber-`auth_user_id` itu lintas tenant **+** `member_code` `INVITE` yang masih aktif untuk email akun itu di tenant lain, agar undangan yang belum ditukar ikut terhitung); `EXECUTE` hanya untuk `solva_app` (pola `resolve_tenant_by_slug`). Karena kode terikat email dan tidak ada password sementara, **tidak ada butir "klaim akun"**. **Risiko residu (diterima di MVP, OQ-S39 terjawab):** tanpa verifikasi email, penerbit yang memegang kode dan email dapat menukarnya sendiri (hanya pada akun yang berada di tenantnya saja, tercatat audit); bergabungnya akun itu ke tenant lain tetap memerlukan kode tenant lain **dan** password akun, sehingga tidak ada jalur masuk ke tenant lain.

**Mengeluarkan anggota = mencabut keanggotaan di tenant itu saja.** `app_user.deleted_at` diisi (tombstone), `is_active = false`, baris `member` BA dihapus dan sesi (cookie slug) tenant itu dicabut; **identitas global, password, dan keanggotaan di tenant lain tidak berubah**. Soft delete akun tenant **tidak** menghapus identitas global. `auth_user_id` dipertahankan pada baris tombstone (jejak audit); `UQ` parsial memungkinkan undangan ulang. Identitas tanpa keanggotaan sama sekali dibersihkan manual oleh operator (di luar MVP). Mengganti email = mengubah `user.email` global: hanya pemilik akun (dengan password) atau operator, **bukan** Owner tenant (OQ-S37).

#### 4.1.9 `role` — peran dan batas diskon

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh**. Rujukan: KEP-05, BR-AUT-009/012, BR-DSC-001/003, FR-AUT-002.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `code` | `text` | `string` | NN, CHK `^[A-Z_]{2,30}$` | Seed: `OWNER`,`MANAGER`,`SUPERVISOR`,`CASHIER`,`WAITER`,`WAREHOUSE`,`ACCOUNTANT` (PRD §3.2). |
| `name` | `text` | `string` | NN | Nama tampilan. |
| `is_system` | `boolean` | `boolean` | NN, DEF `false` | Role bawaan (`true`) tidak dapat dihapus; role kustom (`false`) dapat dihapus selama tidak dipakai anggota aktif (BR-AUT-012). |
| `discount_limit_pct` | `numeric(7,4)` | `string` | NN, DEF `0`, CHK 0..100 | **Batas diskon efektif % dari gross** (Owner 100, Manager 50, Supervisor 20, Kasir 5, lainnya 0; OQ-05). Dibandingkan dengan persen efektif terbesar (BR-DSC-003). |

Constraint tabel: `UQ (tenant_id, code) WHERE deleted_at IS NULL`. Perubahan nilai tercatat audit dan ikut feed (BR-AUT-012).

#### 4.1.10 `permission` — katalog permission (tabel global)

Kelas **G** (tanpa `tenant_id`, tanpa RLS; diisi migrasi/seed; aplikasi hanya `SELECT`). Lokasi: server; Dexie menerima hanya **kode** lewat `role_permission`. Rujukan: BR-AUT-009.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `code` | `text` | `string` | PK, CHK `^[a-z_.]{3,50}$` | Mis. `sale.create`, `bill.edit`, `bill.void_item`, `discount.manual`, `discount.approve`, `sale.void`, `return.approve`, `shift.open_close`, `cash.in_out`, `shift.view_variance`, `shift.force_close`, `gap.annotate`, `catalog.manage`, `inventory.manage`, `user.manage`, `report.view`, `audit.view`, `customer.view_phone`, `drawer.open`, **`bill.handover`**, **`bill.accept`**, **`screen.unlock_override`**, **`flag.manage`**, **`role.manage`** (kelola role; Owner dan Manager, BR-AUT-012). Nama yang tidak disebut eksplisit di PRD (`sale.create`, `bill.edit`, dst.) bersifat usulan yang dikunci saat seed F1 (OQ-S12 terjawab). Bawaan `customer.view_phone` (lihat nomor telepon pelanggan tanpa masking, BR-CUS-002): `OWNER` dan `MANAGER`. **PRD (BR-AUT-009):** `bill.handover` (serahkan bill ke kasir) = Owner, Manager, Supervisor, Waiter; `bill.accept` (terima bill, hanya di register `CASHIER`) = Owner, Manager, Supervisor, Kasir. `flag.manage` (ubah feature flag tenant, **hanya Owner**, keputusan user 2026-11-18); `screen.unlock_override` (buka kunci layar staf lain hanya untuk pergantian kasir/tutup shift, BR-AUT-015) = Supervisor, Manager, Owner — nama kode dikunci pada OQ-S22 (terjawab). |
| `module` | `text` | `string` | NN | Pengelompokan UI. |
| `description` | `text` | `string` | NN | Penjelasan (kunci i18n, bukan teks terjemahan). |

#### 4.1.11 `role_permission` — role × permission

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh**. Rujukan: BR-AUT-009/012.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `role_id` | `uuid` | `string` | NN, FK→`role` | — |
| `permission_code` | `text` | `string` | NN, FK→`permission(code)` | Kode `B` (sampai batas diskon) diwujudkan oleh `discount.manual` + `role.discount_limit_pct`; `Y*` (Manager hanya outlet ditugaskan) oleh `user_outlet`. |

Constraint tabel: `UQ (role_id, permission_code)` (penuh; cabut = tombstone, beri ulang = hidupkan kembali).

#### 4.1.12 `user_outlet` — penugasan pengguna ke outlet

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet** (baris outlet device + baris tenant-wide `outlet_id IS NULL`). Rujukan: BR-AUT-009 (`Y*`), PRD §6.3.A.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `user_id` | `uuid` | `string` | NN, FK→`app_user` | — |
| `outlet_id` | `uuid` | `string \| null` | NULL, FK→`outlet` | **NULL = berlaku di semua outlet tenant** (Owner, Akuntan: "semua outlet", PRD §3.2) — penafsiran skema, OQ-S15. |
| `role_id` | `uuid` | `string` | NN, FK→`role` | Role pengguna **pada outlet itu**. |

Constraint tabel: `UQ NULLS NOT DISTINCT (user_id, outlet_id) WHERE deleted_at IS NULL` (satu role per pengguna per outlet; satu baris tenant-wide).

#### 4.1.13 `cash_master` — register (device kasir logis)

Tabel fisik **`cash_master`** = entitas PRD `register` (BR-INV-001). Setiap perangkat kasir termasuk HP waiter didaftarkan sebagai register sendiri (AS-02). Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet** (seluruh register di outlet device — kecil; dibutuhkan untuk daftar tujuan serah-terima dan label asal "bill masuk"; OQ-S23 terjawab). Rujukan: BR-INV-001/002, BR-TNT-004, BR-PRN-005, BR-FNB-011/012, FR-DEV-001, FR-DEV-006, FR-SHF-007, FR-FNB-015.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `outlet_id` | `uuid` | `string` | NN, FK→`outlet` | — |
| `code` | `text` | `string` | NN, CHK `^[A-Z0-9]{1,10}$` | Mis. `POS02`. **Tidak dapat diubah setelah ada transaksi** (BR-TNT-004; kode **tidak lagi membentuk nomor invoice** — prefiks ada di `register_invoice_prefix`, §4.1.5). |
| `name` | `text` | `string` | NN | Mis. "Kasir 2". |
| `status` | `text` | `string` | NN, DEF `'ACTIVE'`, CHK IN (`ACTIVE`,`INACTIVE`) | `INACTIVE` = tidak bisa di-enroll device baru; register berinvoice tak dihapus. |
| `register_type` | `text` | `string` | NN, DEF `'CASHIER'`, CHK IN (`CASHIER`,`WAITER`) | **Jenis register** (BR-FNB-011, FR-DEV-006). `CASHIER`: seri invoice/nota kredit, shift, pembayaran, kas, retur, dan tujuan/penerima serah-terima bill. `WAITER` (mis. HP waiter): hanya open bill, pra-bill, void item, dan **menyerahkan** bill; **dikecualikan dari syarat shift** untuk aksi itu (BR-SHF-010) dan **tidak** punya shift, pembayaran, kas, retur, maupun invoice/nota kredit (tidak membuat baris `invoice_series`). Jenis tidak dapat diubah selama ada `cash_cashier` `OPEN` atau `bill` `OPEN` pada register itu (trigger; OQ-S22 terjawab: **tidak boleh diubah** selama ada shift atau bill `OPEN`). |
| `paper_width_mm` | `smallint` | `number` | NN, DEF `80`, CHK IN (`58`,`80`) | Lebar kertas struk per register (BR-PRN-005; `DIUSULKAN`). |
| `default_locale` | `text` | `string \| null` | NULL, CHK IN (`id-ID`,`en-US`) | Bahasa bawaan layar PIN (BR-I18N-002). |

Constraint tabel: `UQ (outlet_id, code)` (penuh) · **seri nomor dan prefiksnya tidak disimpan di sini** — prefiks di `register_invoice_prefix` (wajib untuk `CASHIER`, dibuat bersama register dalam satu transaksi), pencatatan nomor tertinggi dan gap dimiliki modul Penjualan (`invoice_series`, `invoice_gap`; BR-ARC-003). **Register `WAITER`:** perintah `OpenShift`, `CloseShift`, `RecordCashMovement`, `FinalizeSale`, `FinalizeCreditNote` dari register berjenis `WAITER` **ditolak sebagai otorisasi** → `attention_item` (validasi pemrosesan; bukan `CHECK` lintas tabel, DB-02). Inisialisasi `last_invoice_seq_received = 0` (FLOW-01) berarti **tidak ada baris** `invoice_series` untuk periode itu (dibuat saat nomor pertama diterima).

#### 4.1.14 `device` — perangkat fisik terdaftar (enrollment & credential)

Perangkat fisik/browser yang diikat ke satu register lewat enrollment. Kelas **S** (server-saja; device mengenali identitasnya dari credential yang tersimpan di Dexie). Tidak memakai `STD-S` penuh: **tanpa `deleted_at`** (dicabut via `revoked_at`). Lokasi: server; baris tak diunduh. Rujukan: BR-AUT-002/008/010, NFR-SEC-004, FR-DEV-002.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 server saat enrollment; dikirim ke device sebagai `device_id`. |
| `tenant_id` | `uuid` | `string` | NN, FK→`tenant` | — |
| `register_id` | `uuid` | `string` | NN, FK→`cash_master` | Riwayat device per register dipertahankan (device lama dicabut, device baru di-enroll — FLOW-16). |
| `name` | `text` | `string` | NN, CHK ≤ 80 | Mis. "Tablet kasir 2". |
| `credential_hash` | `bytea` | `string` | NN, UQ | SHA-256 dari token acak 256-bit. **Token tidak pernah disimpan di server**; hanya dikirim sekali ke device (BR-AUT-002, NFR-SEC-004). |
| `credential_issued_at` | `timestamptz` | `string` | NN, DEF `now()` | — |
| `credential_expires_at` | `timestamptz` | `string` | NN | Umur 180 hari bergulir (`DIUSULKAN`). Diperpanjang pada sync sukses **hanya bila sisa < 150 hari** agar tidak menulis baris ini setiap sync (hot-row). |
| `pairing_code_id` | `uuid` | `string \| null` | NULL, FK→`pairing_code` | Jejak kode yang dipakai. |
| `user_agent` | `text` | `string \| null` | NULL, CHK ≤ 300 | Info diagnostik (bukan data pribadi). |
| `enrolled_at` | `timestamptz` | `string` | NN, DEF `now()` | — |
| `enrolled_by` | `uuid` | `string` | NN, FK→`app_user` | Owner/manager (audit). |
| `revoked_at` | `timestamptz` | `string \| null` | NULL | Pencabutan **berlaku saat device online berikutnya** (BR-AUT-010). Ditolak otorisasi → perintah ke "perlu perhatian". |
| `revoked_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | — |
| `revoke_reason_code` | `text` | `string \| null` | NULL | Mis. `LOST`, `REPLACED`, `STOLEN`. |
| `created_at`, `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Constraint tabel: **`UQ (register_id) WHERE revoked_at IS NULL`** — maksimal **satu device aktif per register**, karena counter nomor invoice dihitung lokal di device dan dua device aktif pada register yang sama akan bertabrakan (BR-INV-002; dikonfirmasi OQ-S14: satu device hanya terikat satu register; register memiliki banyak shift tetapi hanya satu `OPEN`; mengganti device = cabut lalu enroll). Kolom volatil (sync terakhir, pending, offset) **sengaja dipisah** ke `device_sync_status` (§4.6) agar baris ini tidak ikut terkunci/ditulis tiap sync.

#### 4.1.15 `pairing_code` — kode pairing sekali pakai

Kelas **S**; tanpa `STD-S`. Lokasi: server. Rujukan: BR-AUT-002, FR-DEV-001, NFR-SEC-005. **Konsisten dengan keputusan QR pairing (2026-11-18):** kode dibawa **QR di fragmen URL** (`<DOMAIN>/{slug}/pos#pair=…`) — fragmen tidak dikirim ke server dan tidak muncul di log akses; server hanya menerima kode di badan permintaan enrollment; kode **sekali pakai, berlaku 15 menit**. **Tidak ada perubahan skema** (`code_hash`, `expires_at = created_at + 15 menit`, `used_at` atomik tetap).

**Pembatasan percobaan enrollment (rate limit, keputusan user 2026-11-18/19): di memori, bukan kolom.** `POST /enroll` dibatasi per IP dan per slug oleh penghitung di memori proses (ARCHITECTURE §6.9.3; nilai awal 10 / 5 mnt per IP dan ±30 / 5 mnt per slug). **Tidak ada kolom percobaan** (mis. `failed_attempts`) pada `pairing_code`, dengan alasan: (1) kode berentropi tinggi (32⁸ ≈ 1,1×10¹²), berlaku hanya 15 menit, dan sekali pakai — dengan batas per slug (±90 tebakan per masa berlaku kode) peluang menebak satu kode ≈ 10⁻¹⁰, sehingga penghitung persisten tidak menambah keamanan berarti; (2) percobaan yang gagal tidak terkait baris kode tertentu (kode salah tidak cocok `code_hash` mana pun), jadi tidak ada baris untuk dihitungkan; (3) menulis ke DB pada setiap percobaan di jalur tanpa login membuka jalan beban/DoS; (4) hilangnya hitungan saat proses restart diterima (penyerang tak dapat memicu restart, dan masa berlaku kode singkat).

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | — |
| `tenant_id` | `uuid` | `string` | NN, FK | — |
| `register_id` | `uuid` | `string` | NN, FK→`cash_master` | Kode terikat ke satu register. |
| `code_hash` | `bytea` | `string` | NN, UQ | SHA-256 dari kode 8 karakter yang dinormalkan. Kode polos hanya ditampilkan sekali kepada pembuat; tidak disimpan. |
| `expires_at` | `timestamptz` | `string` | NN, CHK `expires_at > created_at` | `created_at + 15 menit`. |
| `used_at` | `timestamptz` | `string \| null` | NULL | Sekali pakai: terisi → tidak boleh dipakai lagi. Dipasang atomik (`UPDATE … WHERE used_at IS NULL AND expires_at > now()` mengembalikan 1 baris). |
| `used_by_device_id` | `uuid` | `string \| null` | NULL, FK→`device` | — |
| `created_by` | `uuid` | `string` | NN, FK→`app_user` | — |
| `created_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Pembatasan percobaan/brute-force pairing (NFR-SEC-005) memakai penghitung di memori proses (AS-06 satu instance); tidak ada tabel (§7.5).

#### 4.1.16 `user_pin_credential` — verifier PIN per pengguna (server-saja)

Pendukung skema PIN: menyimpan **verifier** (hasil hash lambat PIN dengan salt pengguna) sehingga server dapat menurunkan `staff_pin` untuk **device baru tanpa mengetahui PIN polos**. Kelas **S**. Tidak diunduh. Rujukan: BR-AUT-004, NFR-SEC-003, FR-AUT-004. **Keputusan OQ-S01:** verifier server + HMAC per device.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `user_id` | `uuid` | `string` | PK, FK→`app_user` | 1:1. |
| `tenant_id` | `uuid` | `string` | NN, FK | — |
| `kdf_algo` | `text` | `string` | NN, CHK IN (`ARGON2ID`,`PBKDF2_SHA256`) | Hash lambat (BR-AUT-004). |
| `kdf_params` | `jsonb` | `object` | NN | Parameter dikalibrasi saat implementasi (target 250–500 ms di tablet menengah; NFR-PERF-007). |
| `kdf_salt` | `bytea` | `string` | NN | Salt per pengguna. |
| `verifier` | `bytea` | `string` | NN | `slow_hash(PIN, kdf_salt, kdf_params)`. **PIN polos tidak pernah disimpan atau dicatat** (NFR-SEC-003, BR-LOG-007). |
| `pin_epoch` | `integer` | `number` | NN, DEF `1` | Naik setiap reset/ganti PIN; device membersihkan penghitung percobaan lokal bila melihat epoch lebih tinggi. |
| `pin_set_at`, `pin_set_by` | `timestamptz`, `uuid` | `string` | NN | Audit reset (FR-AUT-007). |

#### 4.1.17 `staff_pin` — hash PIN per (pengguna, device) yang diunduh

Hash yang diverifikasi **lokal** di device. Dihitung server `pin_hash = HMAC-SHA256(device_salt, verifier)`; nilai berbeda di tiap device walau PIN sama (FR-AUT-004). Kelas **M** (turun, **terfilter per device**). Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter device**. Rujukan: BR-AUT-003/004, FLOW-01/02.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `user_id` | `uuid` | `string` | NN, FK→`app_user` | — |
| `device_id` | `uuid` | `string` | NN, FK→`device` | Salt per device (BR-AUT-004). |
| `device_salt` | `bytea` | `string` | NN | Acak per baris. |
| `pin_hash` | `bytea` | `string` | NN | Lihat di atas. Verifikasi di device: hitung `slow_hash(PIN, kdf_salt, kdf_params)` → HMAC dengan `device_salt` → bandingkan. |
| `kdf_algo` | `text` | `string` | NN | Disalin dari `user_pin_credential` agar device tahu cara menghitung. |
| `kdf_params` | `jsonb` | `object` | NN | idem. |
| `kdf_salt` | `bytea` | `string` | NN | idem (salt pengguna; tidak rahasia terhadap brute-force offline — risiko residual BR-AUT-014/RSK-05 diterima). |
| `pin_epoch` | `integer` | `number` | NN | Salinan epoch saat baris dihitung. |

Constraint tabel: `UQ (user_id, device_id)` (penuh). Baris dibuat/dihitung ulang oleh Sync ketika (a) PIN diganti, (b) device baru di-enroll, (c) penugasan outlet berubah. Device **dicabut** → baris tombstone.

#### 4.1.18 `staff_pin_state` — penghitung percobaan PIN & kunci (asal device)

Penghitung kegagalan dan kunci disimpan lokal dan ikut disinkron (BR-AUT-005). Dipisah dari `staff_pin` karena **arahnya naik** (device → server) sedangkan `staff_pin` turun. Kelas **T-ringkas** (keadaan terakhir per pasangan, bukan ledger). Lokasi: server + Dexie **↑ lokal** (store `staff_pin_state`). Rujukan: BR-AUT-005, BR-AUD-001 ("penguncian PIN"), FR-AUT-003/007.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `user_id` | `uuid` | `string` | PK (1/2), FK→`app_user` | — |
| `device_id` | `uuid` | `string` | PK (2/2), FK→`device` | — |
| `tenant_id` | `uuid` | `string` | NN, FK | — |
| `failed_count` | `integer` | `number` | NN, DEF `0`, CHK `BETWEEN 0 AND 15` | **Hitungan monotonik**: hanya naik sampai PIN benar (→ 0) atau reset supervisor/manager (`pin_epoch`); **ditulis ke Dexie SEBELUM PIN diverifikasi** sehingga crash/muat ulang di tengah verifikasi tidak menghapus percobaan. 5× → kunci 5 mnt; 5× berikutnya → 15 mnt; total 15× → kunci hingga reset (`DIUSULKAN`, BR-AUT-005). Tidak dikurangi oleh berlalunya waktu. |
| `lock_tier` | `smallint` | `number` | NN, DEF `0`, CHK 0..3 | 0 tak terkunci · 1 (5 mnt) · 2 (15 mnt) · **3 = menunggu reset supervisor** (penanda "perlu reset"; **tidak ada kolom boolean terpisah**, turunan `lock_tier = 3`; boolean juga tak dapat diindeks di IndexedDB). |
| `locked_until` | `timestamptz` | `string \| null` | NULL | Tenggat jeda dalam **waktu terkoreksi**, dihitung saat kunci dipasang: `max(trusted_now, meta.clock.max_seen_time) + durasi` (ARCHITECTURE §6.9.6). `NULL` untuk tier 0 dan 3. **Sisa jeda = `locked_until − max(trusted_now, max_seen_time)`**, sehingga **bertahan saat aplikasi dimuat ulang** dan **tidak dapat dipendekkan dengan memundurkan tanggal tablet** (`max_seen_time` hanya naik, BR-AUT-013); di dalam satu sesi hitung mundur memakai `performance.now()`. **Tanpa kolom basis jam tambahan** — basis monotonik = `meta.clock.max_seen_time` yang sudah ada (OQ-S36). |
| `last_failed_at` | `timestamptz` | `string \| null` | NULL | — |
| `pin_epoch_seen` | `integer` | `number` | NN, DEF `1` | Epoch yang diketahui; reset manager menaikkan `user_pin_credential.pin_epoch` sehingga penghitung dibersihkan. |
| `reported_at` | `timestamptz` | `string` | NN, DEF `now()` | Jam server saat laporan terakhir diterima. |
| `last_device_seq` | `bigint` | `number` | NN | Laporan lebih lama (urutan lebih kecil) diabaikan. |

Dipakai server hanya untuk tampilan manager dan keputusan reset; kunci sesungguhnya ditegakkan lokal di device.

**Dexie `staff_pin_state` (PK `[user_id+device_id]`):** field sama dengan kolom di atas kecuali yang hanya milik server (`tenant_id`, `reported_at`, `last_device_seq`). **Dilaporkan lewat `ReportPinState`** (perintah outbox, Lampiran B): `user_id`, `failed_count`, `lock_tier`, `locked_until`, `last_failed_at`, `pin_epoch_seen`; `device_id`/`tenant_id` dari credential; urutan dijaga `device_seq` perintah (server menolak laporan yang lebih lama, `last_device_seq`). Laporan dibuat saat `lock_tier` berubah dan saat penghitung dibersihkan karena `pin_epoch` baru (bukan tiap kegagalan; frekuensi: saat `lock_tier` berubah, OQ-S36 terjawab 2026-11-19). `lock_tier` 3 menghasilkan audit `pin.locked`. **Reset total hanya oleh supervisor/manager**: menaikkan `user_pin_credential.pin_epoch`; device yang melihat epoch lebih tinggi mengosongkan penghitung lokal. **Batas yang jujur:** ini bukan perlindungan terhadap penyerang yang memegang perangkat dan mengubah IndexedDB (itu dilawan hash lambat + HMAC per device, OQ-S01); tujuannya menghambat tebakan di layar.

#### 4.1.19 `member_code` — kode undangan/reset sekali pakai terikat email

Keputusan user 2026-11-19 (OQ-S38 mekanisme B). Kelas **S**; tanpa `STD-S` (pola `pairing_code`). Lokasi: **server saja** (tidak disinkron). Rujukan: BR-AUT-001, FR-AUT-002, NFR-SEC-005 (kode seperti `pairing_code`). Menggantikan password sementara: **penerbit tidak pernah melihat atau menetapkan password**; kode sama untuk email yang sudah maupun belum punya akun (anti-enumerasi).

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 server. |
| `tenant_id` | `uuid` | `string` | NN, FK | Tenant penerbit; kode ditukar pada slug tenant ini. |
| `app_user_id` | `uuid` | `string` | NN, FK komposit→`app_user` | Profil yang ditautkan (`INVITE`: baris `PENDING`/staf PIN-only) atau akun yang direset (`RESET`: wajib `auth_user_id` terisi, divalidasi aplikasi). |
| `kind` | `text` | `string` | NN, CHK IN (`INVITE`,`RESET`) | — |
| `email` | `citext` | `string` | NN, CHK `char_length <= 254` | **Email terikat**: penukaran harus menyertakan email yang sama. Satu-satunya tempat email calon anggota disimpan sebelum akun ada; dihapus bersama baris saat dibersihkan. |
| `code_hash` | `bytea` | `string` | NN, UQ | SHA-256 kode yang dinormalkan; kode polos hanya tampil sekali kepada penerbit. **Kode 10 karakter** alfabet 32 (±1,1×10¹⁵; OQ-S39 terjawab), tanpa kolom percobaan. |
| `expires_at` | `timestamptz` | `string` | NN, CHK `expires_at > created_at` | `INVITE` = `created_at + 72 jam`; `RESET` = `created_at + 24 jam` (nilai dipasang aplikasi). |
| `used_at` | `timestamptz` | `string \| null` | NULL | Sekali pakai, dipasang **atomik**: `UPDATE … WHERE code_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND email = $2` mengembalikan 1 baris. |
| `redeemed_auth_user_id` | `text` | `string \| null` | NULL | Identitas BA yang menukar (jejak; terisi bersama `used_at`). |
| `revoked_at` | `timestamptz` | `string \| null` | NULL | Waktu kode **tidak berlaku lagi karena dicabut**: dibatalkan penerbit atau digantikan kode baru. Dipakai untuk **semua** pencabutan (tidak ada kolom `canceled_at` terpisah: akan menduplikasi makna; pembeda ada di `revoke_reason`). Baris **tidak dihapus** saat dicabut (jejak sampai dibersihkan 7 hari). |
| `revoke_reason` | `text` | `string \| null` | NULL, CHK IN (`CANCELED`,`REPLACED`) | `CANCELED` = dibatalkan lewat aksi "Batalkan"; `REPLACED` = digantikan lewat "Terbitkan ulang". Diperlukan agar baris yang dicabut menjelaskan dirinya (audit/operasional) tanpa menelusuri `audit_log`. `CHK ((revoked_at IS NULL) = (revoke_reason IS NULL))`. |
| `issued_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | Owner penerbit; `NULL` = operator platform (aktor di `audit_log`). |
| `created_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Constraint tabel: `UQ (code_hash)` · `UQ (app_user_id, kind) WHERE used_at IS NULL AND revoked_at IS NULL` (satu kode aktif per profil dan jenis; kode baru **mencabut** yang lama lebih dulu) · `CHK (used_at IS NULL OR revoked_at IS NULL)` · `CHK ((revoked_at IS NULL) = (revoke_reason IS NULL))` · indeks `(app_user_id, kind, created_at DESC)` (kode terbaru per profil untuk daftar "Undangan tertunda") dan `(expires_at)` (pembersihan). RLS standar tenant (daftar, batalkan, terbitkan ulang semuanya berjalan dalam konteks tenant; baris tenant lain tak terlihat); hak `DELETE` untuk pembersihan fisik (kedaluwarsa/terpakai/dicabut + 7 hari; jejak tetap di `audit_log`).

**Tidak ada kolom percobaan** (seperti `pairing_code`): penukaran dibatasi per IP, per slug, dan per email oleh penghitung memori (ARCHITECTURE §6.9); kode berentropi tinggi, terikat email (penyerang harus tahu email **dan** kode), sekali pakai, masa berlaku terbatas; percobaan salah tidak terkait baris tertentu dan menulis ke DB di jalur tanpa login membuka jalan DoS.

**Daftar "Undangan tertunda", Batalkan, dan Terbitkan ulang (DESIGN DOQ-26, keputusan user 2026-11-19).** Halaman penerima: `/{slug}/join` hanya menerima `kind = 'INVITE'`, `/{slug}/reset` hanya `kind = 'RESET'` (jenis tak cocok → ditolak generik).
- **Daftar:** diturunkan dari `app_user` `PENDING` yang belum dihapus (RLS tenant) digabung dengan **kode `INVITE` terbaru** per profil (`LATERAL … ORDER BY created_at DESC LIMIT 1`, memakai indeks `(app_user_id, kind, created_at DESC)`): nama tampilan, email terikat, penerbit (`issued_by`), `expires_at`, dan keadaan (aktif / kedaluwarsa / dicabut). Jumlahnya kecil per tenant sehingga **tidak diperlukan indeks parsial per tenant** tambahan. Undangan kedaluwarsa yang belum dibersihkan tetap tampil (≤ 7 hari) dengan aksi **Terbitkan ulang**.
- **Batalkan:** satu transaksi — `revoked_at = now()`, `revoke_reason = 'CANCELED'`; bila `app_user` masih `PENDING` (belum punya akun; murni undangan) baris itu **di-soft-delete** (tombstone) beserta `user_outlet`-nya agar tidak tersisa yatim; bila itu staf PIN-only `ACTIVE` yang diundang menjadi back-office, baris staf **dipertahankan** (hanya kode yang dicabut). Audit `member.invite_canceled` (aktor = pembatal).
- **Terbitkan ulang:** satu transaksi — kunci baris lama (`SELECT … FOR UPDATE`) → cabut (`revoked_at`, `revoke_reason = 'REPLACED'`) → `INSERT` kode baru (hash baru, `expires_at` baru 72 jam, `app_user_id`, `email`, `kind` sama) → kode lama **otomatis tidak berlaku** dan `UQ` parsial tetap utuh (pencabutan mendahului penyisipan). Profil `PENDING` (peran/cakupan outlet) tidak berubah. Audit `member.invite_reissued` (kode `RESET`: `member.reset_issued`) dengan `before_data`/`after_data` memuat **id kode lama dan baru** — tautan pengganti dicatat di audit, **bukan kolom** `replaced_by_id` (OQ-S40 terjawab). Penerbit/pembatal tercatat di `audit_log` (`actor_user_id`); kolom `issued_by` hanya menyimpan penerbit **kode saat ini**. Audit memuat aktor, **email**, peran, tenant, dan id kode (PRD FR-IDN-011/014) dan **tidak** memuat kode polos.
- **Hak akses:** sama dengan mengundang anggota (permission pengelolaan pengguna; kode permission dikunci saat seed F1, OQ-S12) — tidak ada permission baru.
- **Pembersihan:** pekerja latar menghapus fisik baris kode 7 hari setelah kedaluwarsa/terpakai/dicabut **dan** me-soft-delete profil `PENDING` yang kehilangan semua kode (tanpa email, profil yatim tak dapat diundang ulang).

**Penukaran:** `INVITE` — satu transaksi: tandai terpakai → (akun baru: buat identitas dengan password pilihan pemilik / akun ada: verifikasi password) → `app_user.auth_user_id`, `membership_status='ACTIVE'` → `member` BA → audit `member.accepted`. `RESET` — periksa ulang hitungan keanggotaan (Owner: harus 1) → ganti password → cabut seluruh sesi → audit `member.password_reset`.

---
### 4.2 Modul 2 — Master Produk & Multi-UOM (Katalog)

Seluruh tabel modul ini ditulis **hanya online di `/admin`** (BR-SYN-001) lewat fungsi Sync (BR-ARC-006). Tabel yang diunduh device memiliki `version`; tabel struktur varian dan resep **server-saja**.

#### 4.2.1 `category` — kategori dan sub-kategori

Dua tingkat (BR-CAT-001). Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh**. Rujukan: BR-CAT-001, FR-CAT-001.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `parent_id` | `uuid` | `string \| null` | NULL, FK→`category` | `NULL` = kategori; terisi = sub-kategori. |
| `name` | `text` | `string` | NN, CHK ≤ 80 | Satu bahasa (BR-I18N-005). |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |

Constraint tabel: `CHK (parent_id IS DISTINCT FROM id)` · trigger **maksimal 2 tingkat** (induk harus berkolom `parent_id IS NULL`) · `UQ NULLS NOT DISTINCT (tenant_id, parent_id, lower(name)) WHERE deleted_at IS NULL` (nama unik dalam induk yang sama).

#### 4.2.2 `uom` — satuan

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh**. Rujukan: BR-UOM-001..005, FR-CAT-003.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `code` | `text` | `string` | NN, CHK `^[a-z0-9]{1,12}$` | `pcs`, `dus`, `kg`, `g`, `l`, `ml`, `porsi`, … |
| `name` | `text` | `string` | NN | Satu bahasa. |
| `allow_fraction` | `boolean` | `boolean` | NN, DEF `false` | Bila false, hasil konversi ke base yang pecahan **ditolak** saat input (BR-UOM-004, EC-028). Flag **base UOM** yang menentukan; flag UOM turunan hanya untuk input. |

Constraint tabel: `UQ (tenant_id, lower(code)) WHERE deleted_at IS NULL`.

#### 4.2.3 `product` — produk induk

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh** (≤ 5.000 SKU efektif per outlet; katalog tenant penuh, BR-CAT-014/AS-12). Rujukan: BR-CAT-002/003/004, BR-TAX-008, BR-PRC-007, BR-STK-004, FR-CAT-002/005/014.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `category_id` | `uuid` | `string` | NN, FK→`category` | Kategori atau sub-kategori. |
| `code` | `text` | `string` | NN, CHK `^[A-Za-z0-9\-_.]{1,30}$` | Kode produk induk (mis. `KAOS01`). |
| `name` | `text` | `string` | NN, CHK ≤ 160 | Disalin ke `sale_line.item_name` (snapshot). |
| `product_type` | `text` | `string` | NN, DEF `'RETAIL'`, CHK IN (`RETAIL`,`MENU_FNB`) | `MENU_FNB` memicu konsumsi resep (bukan stok SKU menu) saat dibayar (BR-RCP-005). |
| `has_variants` | `boolean` | `boolean` | NN, DEF `false` | False → satu SKU implisit `is_default` (BR-CAT-003). |
| `base_uom_id` | `uuid` | `string` | NN, FK→`uom` | **Satuan dasar tempat stok disimpan** (BR-UOM-001); seluruh SKU produk ini berbagi base UOM (PRD §6.3 menaruhnya di produk). Tidak dapat diubah setelah ada `stock_movement`/`sale_line` (trigger). |
| `track_stock` | `boolean` | `boolean` | NN, DEF `true` | Pelacakan stok per produk (BR-STK-004); efektif bila `outlet.inventory_enabled_at IS NOT NULL`. Untuk `MENU_FNB`: bermakna "konsumsi resep dicatat". |
| `taxable` | `boolean` | `boolean` | NN, DEF `true` | False → baris keluar dari dasar pajak (BR-TAX-008). Disalin ke `sale_line.taxable`. |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | Nonaktif **global** mengalahkan ketersediaan outlet (BR-CAT-004/010 butir 4a). Produk yang pernah bertransaksi **tidak dihapus**, hanya `is_active = false`. |
| `is_open_price` | `boolean` | `boolean` | NN, DEF `false` | Penanda item open price: harga diketik kasir (BR-PRC-007, FR-CAT-014). Disalin ke `sale_line.is_open_price` sebagai snapshot. |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |

Constraint tabel: `UQ (tenant_id, code) WHERE deleted_at IS NULL` · `UQ (id, tenant_id)` (untuk FK komposit). Dexie: kolom turunan `search_tokens: string[]` (multiEntry) dihitung client saat menerima baris (§6.3).

#### 4.2.4 `product_attribute` dan `attribute_value` — struktur varian

Definisi atribut (mis. Ukuran, Warna) dan nilainya (S, M, L). **Server-saja**: device hanya memerlukan label hasil di `sku.variant_label`. Kelas **S**. Mewarisi `STD-S`. Rujukan: BR-CAT-002/005, FR-CAT-002/007.

**`product_attribute`**

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-S)* | | | | |
| `product_id` | `uuid` | `string` | NN, FK→`product` | — |
| `name` | `text` | `string` | NN, CHK ≤ 40 | Mis. "Ukuran". |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |

Constraint: `UQ (product_id, lower(name)) WHERE deleted_at IS NULL` · trigger **maksimal 3 atribut per produk** (parameter BR-CAT-005, Lampiran C PRD).

**`attribute_value`**

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-S)* | | | | |
| `attribute_id` | `uuid` | `string` | NN, FK→`product_attribute` | — |
| `value` | `text` | `string` | NN, CHK ≤ 40 | Mis. "Merah". |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |

Constraint: `UQ (attribute_id, lower(value)) WHERE deleted_at IS NULL`.

#### 4.2.5 `sku` — varian yang dapat dijual/distok

SKU = kombinasi nilai atribut; punya barcode, UOM, harga per outlet, dan stok sendiri (BR-CAT-002). Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh**. Rujukan: BR-CAT-002/003/004/005, FR-CAT-002.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `product_id` | `uuid` | `string` | NN, FK→`product` | — |
| `sku_code` | `text` | `string` | NN, CHK `^[A-Za-z0-9\-_.]{1,40}$` | Mis. `KAOS01-S-MRH`. |
| `variant_label` | `text` | `string \| null` | NULL, CHK ≤ 80 | **Denormalisasi tampilan** kombinasi atribut (mis. `S / Merah`), dihitung server saat generate SKU; satu-satunya info varian yang diunduh device. NULL untuk SKU implisit. |
| `is_default` | `boolean` | `boolean` | NN, DEF `false` | SKU implisit produk tanpa varian (BR-CAT-003). |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | Kombinasi yang dihapus tetapi pernah dijual → nonaktif, bukan dihapus (BR-CAT-002 contoh). |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |

Constraint tabel: `UQ (tenant_id, sku_code) WHERE deleted_at IS NULL` · `UQ (id, product_id)` (untuk FK komposit override ketersediaan) · `UQ (product_id) WHERE is_default AND deleted_at IS NULL` · trigger: produk `has_variants = false` ⇒ tepat satu SKU `is_default`; **maksimal 100 SKU aktif per produk** (BR-CAT-005). Menambah SKU pada produk yang sudah ada **tidak** mewarisi override SKU lain (BR-CAT-011).

#### 4.2.6 `sku_attribute_value` — SKU × nilai atribut (N:M)

**Server-saja.** Kelas **S**. Mewarisi `STD-S`. Rujukan: BR-CAT-002.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-S)* | | | | |
| `sku_id` | `uuid` | `string` | NN, FK→`sku` | — |
| `attribute_value_id` | `uuid` | `string` | NN, FK→`attribute_value` | — |

Constraint: `UQ (sku_id, attribute_value_id)` · trigger: satu nilai per atribut per SKU (tidak dua nilai atribut yang sama pada satu SKU).

#### 4.2.7 `sku_uom` — UOM per SKU: faktor konversi dan barcode

Setiap SKU memiliki satu UOM dasar (`is_base`, faktor 1) dan nol-atau-lebih UOM turunan (konversi **datar**, langsung ke base, BR-UOM-002). Barcode **per UOM** (BR-CAT-006). Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh** (indeks barcode lokal). Rujukan: BR-UOM-002..006, BR-CAT-006/007, FR-CAT-003/004, FR-POS-001.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `sku_id` | `uuid` | `string` | NN, FK→`sku` | — |
| `uom_id` | `uuid` | `string` | NN, FK→`uom` | — |
| `conversion_factor` | `numeric(18,4)` | `string` | NN, CHK `> 0` | **Jumlah satuan dasar dalam 1 UOM** (dus = 12 pcs → `12.0000`). `qty_base = qty × factor` (BR-UOM-002). Perubahan hanya berlaku ke depan; transaksi lama memakai snapshot (BR-UOM-006, EC-024). |
| `is_base` | `boolean` | `boolean` | NN, DEF `false` | Baris UOM dasar SKU. |
| `barcode` | `text` | `string \| null` | NULL, CHK `char_length BETWEEN 1 AND 64` | Barcode **per (SKU, UOM)**; boleh NULL (item tanpa barcode, mis. menu F&B). Disimpan apa adanya (hanya di-trim). |

Constraint tabel: **`UQ (sku_id, uom_id)`** penuh (dasar FK komposit dari `price_entry`; "hapus lalu tambah lagi" = hidupkan kembali baris) · **`UQ (tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL`** (barcode ganda ditolak, BR-CAT-006, EC-032) · `UQ (sku_id) WHERE is_base AND deleted_at IS NULL` (tepat satu base) · `CHK (NOT is_base OR conversion_factor = 1)` · trigger: `uom_id` baris `is_base` harus = `product.base_uom_id` SKU itu; baris non-base tidak boleh memakai UOM yang sama dengan base. Kuantitas jual yang hasil konversinya pecahan pada base `allow_fraction = false` ditolak di Kernel (bukan di DB) (BR-UOM-004).

*Contoh (BR-UOM-003):* Susu UHT 1L — baris `pcs` (`is_base`, factor `1.0000`, barcode `8990001`) dan baris `dus` (factor `12.0000`, barcode `8990012`). Jual 0,5 dus → `qty_base = 0,5 × 12 = 6,0000`.

#### 4.2.8 `item_outlet_availability` — ketersediaan item per outlet

Tabel `DISEPAKATI` KEP-18 (BR-CAT-009..016): flag eksplisit per **(produk induk × outlet)** dengan **override per SKU**, **terpisah dari harga**. Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet**. Rujukan: BR-CAT-009..022, FR-CAT-008..013, FR-SYN-017, FR-POS-012..014.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `outlet_id` | `uuid` | `string` | NN, FK→`outlet` | — |
| `product_id` | `uuid` | `string` | NN, FK→`product` | — |
| `sku_id` | `uuid` | `string \| null` | NULL | **NULL = baris tingkat produk; terisi = override SKU** (BR-CAT-010). Override hanya ada bila menyimpang dari induk (jarang). |
| `status` | `text` | `string` | NN, CHK IN (`AVAILABLE`,`UNAVAILABLE`) | UOM mengikuti SKU: tidak ada ketersediaan per UOM (BR-CAT-010 butir 3). |
| `changed_at` | `timestamptz` | `string` | NN, DEF `now()` | **Waktu server** perubahan status (awal transaksi). Dipakai penandaan `item_tidak_tersedia` (BR-CAT-013: `occurred_at ≥ changed_at`). |
| `changed_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | Aktor (audit BR-CAT-021). |

Constraint tabel: **`UQ NULLS NOT DISTINCT (outlet_id, product_id, sku_id)`** penuh (menghapus override = tombstone; membuat lagi = hidupkan kembali baris, sehingga unik tetap berlaku) · **FK komposit `(sku_id, product_id) → sku (id, product_id)`** (override harus SKU milik produk yang sama; tidak berlaku bila `sku_id` NULL) · `CHK` tidak ada untuk "baris produk wajib ada" (dijamin Sync: baris produk dibuat eksplisit untuk setiap produk × outlet dalam satu transaksi, BR-CAT-011).

**Status efektif (BR-CAT-010/016)** — dihitung di Kernel bersama (client & server), bukan kolom:

```
efektif(sku, outlet) =
   TIDAK       bila product.is_active = false atau sku.is_active = false     -- (a) global menang
   override.status  bila ada baris (outlet, product, sku) tidak ter-tombstone   -- (b) override menang dua arah
   produk.status    bila ada baris (outlet, product, NULL) tidak ter-tombstone   -- (c)
   AVAILABLE        selain itu                                                   -- (d) default, mis. pull belum selesai (EC-050)
```

Volume: pada ≤ 5.000 produk × N outlet, baris per outlet ≈ 5.000 (+ override); device hanya mengunduh outlet-nya (BR-SYN-010 poin 7). Outlet baru → ±5.000 baris dalam **satu versi** (EC-048). Indeks pendukung feed & efektif: §5.2.

#### 4.2.9 `modifier_group`, `modifier_group_product`, `modifier` — modifier / add-on F&B

Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh**. Rujukan: BR-PRC-006, BR-RCP-004, FR-FNB-005, OQ-26 (modifier **tanpa** status per outlet).

**`modifier_group`** — kelompok opsi (mis. "Level Pedas", "Topping")

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `name` | `text` | `string` | NN, CHK ≤ 60 | — |
| `selection_type` | `text` | `string` | NN, DEF `'MULTI'`, CHK IN (`SINGLE`,`MULTI`) | — |
| `min_select` | `integer` | `number` | NN, DEF `0`, CHK ≥ 0 | — |
| `max_select` | `integer` | `number \| null` | NULL, CHK `max_select IS NULL OR max_select >= min_select` | NULL = tak terbatas. |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | — |

**`modifier_group_product`** — produk menu mana menawarkan kelompok mana (N:M)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `modifier_group_id` | `uuid` | `string` | NN, FK→`modifier_group` | — |
| `product_id` | `uuid` | `string` | NN, FK→`product` | Biasanya `product_type = 'MENU_FNB'`. |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |

Constraint: `UQ (modifier_group_id, product_id)` penuh (hapus = tombstone; tambah lagi = hidupkan kembali).

**`modifier`** — satu opsi

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `modifier_group_id` | `uuid` | `string` | NN, FK→`modifier_group` | — |
| `name` | `text` | `string` | NN, CHK ≤ 60 | Disalin ke `sale_line_modifier.name`. |
| `price_delta` | `bigint` | `number` | NN, DEF `0` | **Selisih harga** modifier (bisa nol/positif; negatif diperbolehkan tetapi harga satuan akhir wajib ≥ 0 — divalidasi di Kernel). Harga satuan baris = harga menu + Σ selisih (BR-PRC-006). |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | Tanpa status per outlet (OQ-26). |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |

Constraint: `UQ (modifier_group_id, lower(name)) WHERE deleted_at IS NULL`.

#### 4.2.10 `modifier_ingredient` — dampak modifier pada bahan resep

**Server-saja** (konsumsi dihitung server saat pembayaran, BR-RCP-005). Kelas **S**. Mewarisi `STD-S`. Rujukan: BR-RCP-004.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-S)* | | | | |
| `modifier_id` | `uuid` | `string` | NN, FK→`modifier` | — |
| `ingredient_sku_id` | `uuid` | `string` | NN, FK→`sku` | Bahan baku. |
| `adjust_type` | `text` | `string` | NN, CHK IN (`ADD`,`REDUCE`,`REMOVE`) | `ADD` menambah qty; `REDUCE` mengurangi qty; `REMOVE` menghapus bahan dari resep (mis. "Tanpa Kecap"). **"Mengganti" bahan = `REMOVE` bahan lama + `ADD` bahan baru** (dua baris). |
| `qty` | `numeric(18,4)` | `string \| null` | NULL | Dalam **base UOM bahan** per 1 porsi. |

Constraint: `CHK ((adjust_type = 'REMOVE' AND qty IS NULL) OR (adjust_type IN ('ADD','REDUCE') AND qty > 0))` · `UQ (modifier_id, ingredient_sku_id) WHERE deleted_at IS NULL`. Rumus konsumsi per bahan: `max(0, qty_resep + ΣADD − ΣREDUCE)` (atau 0 bila ada `REMOVE`) `× qty_porsi` (BR-RCP-004).

#### 4.2.11 `recipe_item` — resep/BOM satu level

Definisi resep ada di **Katalog**; konsumsi di Inventori (BR-ARC-002). **Server-saja.** Kelas **S**. Mewarisi `STD-S`. Rujukan: BR-RCP-001/002/003/006, FR-FNB-009.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-S)* | | | | |
| `menu_sku_id` | `uuid` | `string` | NN, FK→`sku` | SKU menu (PRD: `menu_sku_id`). |
| `ingredient_sku_id` | `uuid` | `string` | NN, FK→`sku` | Bahan baku. |
| `qty` | `numeric(18,4)` | `string` | NN, CHK `> 0` | **Per 1 porsi menu**, dalam **base UOM bahan** (BR-RCP-002). Contoh Nasi Goreng: Beras `150.0000` g, Telur `1.0000`, Minyak `20.0000` ml, Kecap `10.0000` ml. |

Constraint tabel: `UQ (menu_sku_id, ingredient_sku_id) WHERE deleted_at IS NULL` · `CHK (menu_sku_id <> ingredient_sku_id)` · trigger **satu level** (BR-RCP-001): `ingredient_sku_id` tidak boleh sendiri memiliki `recipe_item` sebagai menu, dan `menu_sku_id` tidak boleh menjadi bahan di resep lain. Perubahan resep **berlaku ke depan**; penjualan offline yang tiba telat memakai resep yang berlaku **saat server memproses** (BR-RCP-006) — karena itu resep **tidak** di-snapshot ke baris penjualan (hanya hasil `cost_snapshot` dan movement). Menu tanpa baris resep: tidak ada konsumsi/HPP dan diberi flag `TANPA_RESEP` (R-04).

---

### 4.3 Modul 3 — Harga & Inventaris per Outlet

#### 4.3.1 `price_entry` — harga jual per (SKU + UOM + outlet)

Kelas **M** (milik modul Katalog, BR-ARC-003). Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet** (baris outlet device **+** baris default tenant `outlet_id IS NULL`). Rujukan: BR-PRC-001..007, BR-TAX-003, FR-PRC-001/002, FR-PRC-004.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `sku_id` | `uuid` | `string` | NN | — |
| `uom_id` | `uuid` | `string` | NN | **FK komposit `(sku_id, uom_id) → sku_uom (sku_id, uom_id)`**: harga hanya untuk UOM yang dimiliki SKU. |
| `outlet_id` | `uuid` | `string \| null` | NULL, FK→`outlet` | **NULL = harga default tenant** (BR-PRC-002 langkah 2). |
| `price` | `bigint` | `number` | NN, CHK `>= 0` | Integer rupiah (BR-PRC-001). Dihargai eksplisit per UOM: 1 dus boleh lebih murah dari 12× eceran (Rp130.000 vs 12 × 11.500). Pada item `is_open_price`, nilai ini hanya nilai awal opsional (BR-PRC-007). |
| `currency` | `char(3)` | `string` | NN, DEF `'IDR'`, CHK `= 'IDR'` | — |

Constraint tabel: **`UQ NULLS NOT DISTINCT (tenant_id, sku_id, uom_id, outlet_id)`** penuh (sehingga ada tepat satu harga per kunci; "hapus lalu isi lagi" = hidupkan kembali). Aturan fallback (BR-PRC-002), dihitung di Kernel dari baris yang diunduh:

```
harga(sku, uom, outlet) = price_entry(sku, uom, outlet)            -- 1. eksplisit outlet
                       ?? price_entry(sku, uom, NULL)               -- 2. default tenant
                       ?? (item open price ? harga diketik kasir    -- pengecualian BR-PRC-007
                                           : TIDAK DAPAT DIJUAL)    -- 3. blokir "harga belum diatur"
```

**Tidak pernah** diturunkan dari harga base × faktor (BR-PRC-002). Ketiadaan harga **tidak** menyiratkan item tidak tersedia (BR-CAT-009, EC-038/053). Perubahan harga tercatat audit (FR-PRC-004).

#### 4.3.2 `stock_balance` — saldo stok per (SKU, outlet)

Proyeksi **kuantitas + nilai persediaan** yang diperbarui **dalam transaksi yang sama** dengan penulisan `stock_movement` di bawah **row lock** (BR-STK-001). Biaya rata-rata **tidak disimpan sebagai angka** otoritatif (BR-HPP-002). Kelas **P**. Lokasi: server; device menerima **snapshot terpisah** (bukan feed berversi; BR-SYN-010 poin 8, BR-STK-005) → store `stock_snapshot`. Rujukan: BR-STK-001/002/004, BR-HPP-001..005, FR-INV-002/003/005.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `outlet_id` | `uuid` | `string` | PK (1/2), FK→`outlet` | — |
| `sku_id` | `uuid` | `string` | PK (2/2), FK→`sku` | — |
| `tenant_id` | `uuid` | `string` | NN, FK→`tenant` | RLS. |
| `qty` | `numeric(18,4)` | `string` | NN, DEF `0` | Dalam **base UOM**. **Boleh negatif** (stok minus diizinkan, BR-STK-002; AP-02) — tidak ada `CHECK qty >= 0` (DB-02). |
| `inventory_value` | `bigint` | `number` | NN, DEF `0` | Nilai persediaan integer rupiah; boleh negatif bersama `qty` negatif. **Saat `qty = 0`, nilai dipaksa 0** (BR-HPP-003) — dijaga `CHK (qty <> 0 OR inventory_value = 0)`. |
| `ref_value` | `bigint` | `number` | NN, DEF `0` | **Biaya referensi — pembilang**: `inventory_value` pada saat terakhir `qty > 0` (BR-HPP-005). |
| `ref_qty` | `numeric(18,4)` | `string` | NN, DEF `0` | **Biaya referensi — penyebut**: `qty` pada saat yang sama. Biaya referensi per satuan = `ref_value / ref_qty` (dihitung bila dibutuhkan; tidak disimpan sebagai pecahan, BR-HPP-002). Diperbarui setiap kali saldo setelah movement `qty > 0`. Keputusan OQ-12: `DISEPAKATI` (biaya referensi). |
| `rev` | `bigint` | `number` | NN, DEF `0` | Penghitung urutan movement per (outlet, SKU); dinaikkan 1 tiap movement dan disalin ke `stock_movement.bal_seq`. Menjadi **urutan pemrosesan otoritatif** biaya (BR-STK-006/HPP-004). |
| `last_movement_at` | `timestamptz` | `string \| null` | NULL | `processed_at` movement terakhir; dasar snapshot/penyegaran. |
| `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Constraint tabel: `CHK (ref_qty >= 0)` · `CHK (qty = trunc(qty,4))` (BR-UOM-005; jaga pembulatan diam-diam). Indeks parsial stok minus (R-02/R-04): `ix_stock_balance__negative (tenant_id, outlet_id) WHERE qty < 0` (§5.2). Baris dibuat **malas** (saat movement pertama/GR/opname). **Aktivasi stok** per outlet/produk (BR-STK-004): movement dibuat hanya bila `outlet.inventory_enabled_at IS NOT NULL` dan `product.track_stock`.

*Contoh (BR-HPP-003 baris 1–2):* GR 100 pcs @8.000 → `qty 100.0000`, `inventory_value 800000`, `ref_value 800000`, `ref_qty 100.0000`, `rev 1`. Jual 30 → HPP `R(800000×30/100) = 240000` → `qty 70.0000`, `inventory_value 560000`, `rev 2`. Biaya rata-rata (tampilan) = `560000/70 = 8000`.

#### 4.3.3 `stock_movement` — kartu stok / ledger (append-only)

Sumber kebenaran stok dan HPP (BR-STK-001). **Tidak pernah di-UPDATE/DELETE.** Kelas **L**. Mewarisi `STD-L`. Lokasi: **server saja** (volume tinggi hanya mengalir ke atas; tidak diunduh, BR-SYN-010 poin 8). Kandidat partisi bulanan (§5.7). Rujukan: BR-STK-001/003/006/007/008, BR-HPP-003/004/005/007, BR-RCP-005, FR-INV-002/010.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-L)* | | | | `id`, `tenant_id`, `outlet_id` (NN), `processed_at`, `occurred_at`, `business_date`. |
| `sku_id` | `uuid` | `string` | NN, FK→`sku` | — |
| `movement_type` | `text` | `string` | NN, CHK IN (`SALE`,`SALE_VOID`,`RETURN_IN`,`GR_IN`,`GR_REVERSAL`,`TRANSFER_OUT`,`TRANSFER_IN`,`ADJUSTMENT`,`RECIPE_CONSUMPTION`) | BR-STK-007. |
| `qty_delta` | `numeric(18,4)` | `string` | NN, CHK `qty_delta <> 0`, `qty_delta = trunc(qty_delta,4)` | Dalam **base UOM**; positif masuk, negatif keluar (BR-STK-008). |
| `value_delta` | `bigint` | `number` | NN | Nilai integer; **tanda mengikuti `qty_delta`** (kecuali kasus nol-nilai). Keluar penjualan: `−HPP`. |
| `qty_after` | `numeric(18,4)` | `string` | NN | Saldo kuantitas setelah movement (jejak replay & verifikasi). |
| `value_after` | `bigint` | `number` | NN | Saldo nilai setelah movement. |
| `bal_seq` | `bigint` | `number` | NN | = `stock_balance.rev` setelah movement; urutan per (outlet, SKU). |
| `cost_basis` | `text` | `string` | NN, CHK IN (`AVERAGE`,`REFERENCE`,`MIXED`,`SNAPSHOT`,`TRANSFER`,`DECLARED`) | Cara nilai ditetapkan: `AVERAGE` (rumus BR-HPP-003), `REFERENCE` (seluruhnya biaya referensi karena saldo ≤ 0, BR-HPP-005), `MIXED` (sebagian tertutup stok = `AVERAGE`, sisa kekurangan = `REFERENCE`, dalam satu movement), `SNAPSHOT` (retur/void pada biaya snapshot, BR-HPP-007), `TRANSFER` (biaya transfer), `DECLARED` (nilai GR yang dimasukkan). |
| `is_negative_result` | `boolean` | `boolean` | NN, DEF `false` | Saldo setelah movement `qty < 0` (sumber laporan stok minus & flag `STOK_MINUS`). |
| `source_type` | `text` | `string` | NN, CHK IN (`SALE_LINE`,`CREDIT_NOTE_LINE`,`GR_LINE`,`TRANSFER_LINE`,`STOCKTAKE_LINE`) | Jenis dokumen sumber (relasi logis; tanpa FK agar ledger tak bergantung siklus hidup dokumen). |
| `source_id` | `uuid` | `string` | NN | ID baris sumber (mis. `sale_line.id`). |
| `reverses_movement_id` | `uuid` | `string \| null` | NULL | Untuk `SALE_VOID`/`GR_REVERSAL`/retur: movement asal yang dibalik (`SALE_VOID` = balik pada **biaya snapshot** movement asal). |
| `command_id` | `uuid` | `string \| null` | NULL, FK→`idempotency_command` | Perintah pemroses (NULL untuk dokumen `/admin`). |
| `created_by` | `uuid` | `string \| null` | NULL | Aktor (kasir / pengguna). |

Constraint tabel: **`UQ (tenant_id, source_type, source_id, sku_id, movement_type)`** (idempotensi: satu movement per baris sumber per SKU per jenis; `RECIPE_CONSUMPTION` per bahan per baris menu — qty dari resep + modifier digabung per SKU) · **`UQ (outlet_id, sku_id, bal_seq)`** (urutan tanpa celah di bawah row lock; bila tabel kelak dipartisi, kunci ini perlu memuat kunci partisi — §5.7) · `CHK ((qty_delta > 0 AND value_delta >= 0) OR (qty_delta < 0 AND value_delta <= 0) OR value_delta = 0)` · `CHK (qty_after <> 0 OR value_after = 0)` · trigger `BEFORE UPDATE OR DELETE` → exception (§5.5).

*Waktu & urutan (BR-STK-006, BR-HPP-004):* `occurred_at` = waktu transaksi terkoreksi (label); `processed_at` = waktu server (acuan biaya); `business_date` = tanggal bisnis. Contoh BR-HPP-004: `occurred_at 14:00`, `processed_at 16:00`, `qty_delta −10`, `value_delta −82083`, `cost_basis AVERAGE`, `qty_after 110`, `value_after 902917`.

#### 4.3.4 `supplier` — pemasok (referensi sederhana)

Kelas **S**. Mewarisi `STD-S`. Lokasi: server. PO/hutang di luar scope (BR-STK-021).

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-S)* | | | | |
| `name` | `text` | `string` | NN, CHK ≤ 120 | — |
| `contact` | `text` | `string \| null` | NULL, CHK ≤ 200 | Kontak teks bebas. |

Constraint: `UQ (tenant_id, lower(name)) WHERE deleted_at IS NULL`.

#### 4.3.5 `goods_receipt` dan `goods_receipt_line` — penerimaan barang

Sumber HPP masuk. Dilakukan **online** di `/admin` (OQ-20). Kelas **D**. Mewarisi `STD-D`. Lokasi: server. Rujukan: BR-STK-020/021/022, FR-INV-001/008/011.

**`goods_receipt`**

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-D)* | | | | `status` ∈ (`DRAFT`,`POSTED`) untuk dokumen `RECEIPT`; `POSTED` untuk `REVERSAL`. |
| `doc_type` | `text` | `string` | NN, DEF `'RECEIPT'`, CHK IN (`RECEIPT`,`REVERSAL`) | **Dokumen koreksi** (`REVERSAL`) membuat movement berlawanan; GR `POSTED` tak pernah diubah (BR-STK-022). |
| `supplier_id` | `uuid` | `string \| null` | NULL, FK→`supplier` | Opsional. |
| `reversal_of_id` | `uuid` | `string \| null` | NULL, FK→`goods_receipt` | Wajib terisi bila `REVERSAL`; satu koreksi per GR (`UQ`). |
| `total_value` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Σ `line_value`. |
| `status` | `text` | `string` | NN, CHK IN (`DRAFT`,`POSTED`) | Posting menaikkan saldo dan menggeser rata-rata dalam satu transaksi. |
| `supplier_ref` | `text` | `string \| null` | NULL, CHK ≤ 60 | Nomor surat jalan/faktur pemasok (teks bebas). |

Constraint tabel: `CHK ((doc_type = 'REVERSAL') = (reversal_of_id IS NOT NULL))` · `UQ (reversal_of_id) WHERE reversal_of_id IS NOT NULL` · `CHK (doc_type <> 'REVERSAL' OR status = 'POSTED')`.

**`goods_receipt_line`** (anak; mewarisi `id`, `tenant_id`, `goods_receipt_id`)

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id`, `tenant_id`, `goods_receipt_id` | | | PK, FK | — |
| `line_no` | `integer` | `number` | NN | Urutan baris. |
| `sku_id` | `uuid` | `string` | NN, FK→`sku` | — |
| `uom_id` | `uuid` | `string` | NN | FK komposit `(sku_id, uom_id) → sku_uom`. |
| `qty` | `numeric(18,4)` | `string` | NN, CHK `> 0` | Dalam UOM terima (mis. 5 dus). |
| `conversion_factor` | `numeric(18,4)` | `string` | NN, CHK `> 0` | **Snapshot** faktor saat posting. |
| `qty_base` | `numeric(18,4)` | `string` | NN, CHK `> 0` | `= qty × conversion_factor` (mis. 60 pcs). |
| `unit_cost` | `bigint` | `number \| null` | NULL, CHK `>= 0` | Biaya per **UOM terima** (opsional bila total baris diisi langsung). |
| `line_value` | `bigint` | `number` | NN, CHK `>= 0` | Nilai baris = `R(qty × unit_cost)` atau total yang diketik. **Biaya bersih** (pajak masukan tidak dihitung, BR-STK-021). |

*Contoh (BR-STK-020):* 5 dus @96.000 → `qty 5.0000`, `conversion_factor 12.0000`, `qty_base 60.0000`, `unit_cost 96000`, `line_value 480000` → movement `GR_IN`: `qty_delta +60.0000`, `value_delta +480000`.

#### 4.3.6 `transfer` dan `transfer_line` — transfer antar outlet (dua langkah, in-transit)

Dilakukan online; penerimaan **satu kali**; kelebihan fisik diselesaikan lewat opname (OQ-14). Kelas **D**. Mewarisi `STD-D` (kolom `outlet_id` = outlet **asal**). Lokasi: server. Rujukan: BR-TRF-001..004, FR-INV-006/011.

**`transfer`**

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-D)* | | | | `status` ∈ (`DRAFT`,`SENT`,`RECEIVED`,`CANCELED`). |
| `from_outlet_id` | `uuid` | `string` | NN, FK→`outlet` | Sama dengan `outlet_id` STD-D. |
| `to_outlet_id` | `uuid` | `string` | NN, FK→`outlet`, CHK `<> from_outlet_id` | Retur lintas outlet tidak didukung (BR-RTR-004), tetapi transfer stok ya. |
| `status` | `text` | `string` | NN, DEF `'DRAFT'`, CHK IN (`DRAFT`,`SENT`,`RECEIVED`,`CANCELED`) | `CANCELED` **hanya dari `DRAFT`**; `SENT` tak dapat diubah (BR-TRF-001/002). |
| `sent_at`, `sent_by` | `timestamptz`, `uuid` | `string` | NULL | Terisi saat `SENT`. |
| `received_at`, `received_by` | `timestamptz`, `uuid` | `string` | NULL | Terisi saat `RECEIVED` (juga untuk penutupan `qty_terima = 0`). |
| `close_reason_code`, `close_reason_text` | `text` | `string \| null` | NULL | Wajib bila diterima dengan selisih penuh/ditutup tanpa barang tiba (BR-TRF-004). |

Constraint tabel: `CHK (status <> 'SENT' OR (sent_at IS NOT NULL AND sent_by IS NOT NULL))` · `CHK (status <> 'RECEIVED' OR received_at IS NOT NULL)` · indeks parsial `WHERE status = 'SENT'` untuk **in-transit** (§5.2).

**`transfer_line`**

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id`, `tenant_id`, `transfer_id` | | | PK, FK | — |
| `line_no` | `integer` | `number` | NN | — |
| `sku_id` | `uuid` | `string` | NN, FK→`sku` | — |
| `uom_id` | `uuid` | `string` | NN | FK komposit `(sku_id, uom_id) → sku_uom`. |
| `qty_input` | `numeric(18,4)` | `string` | NN, CHK `> 0` | Dalam UOM yang diketik. |
| `conversion_factor` | `numeric(18,4)` | `string` | NN, CHK `> 0` | Snapshot. |
| `qty_sent_base` | `numeric(18,4)` | `string` | NN, CHK `> 0` | Base UOM. |
| `value_sent` | `bigint` | `number \| null` | NULL | **Diisi saat kirim**: biaya rata-rata asal saat itu (`R(nilai × qty / saldo)`; BR-TRF-002) — nilai **persediaan dalam perjalanan**. |
| `qty_received_base` | `numeric(18,4)` | `string \| null` | NULL, CHK `qty_received_base BETWEEN 0 AND qty_sent_base` | `≤ qty_kirim`; kelebihan lewat opname (BR-TRF-004). |
| `value_received` | `bigint` | `number \| null` | NULL | `R(value_sent × qty_received / qty_sent)` (BR-TRF-003). |
| `qty_variance_base` | `numeric(18,4)` | `string \| null` | NULL | `qty_sent − qty_received`. |
| `value_variance` | `bigint` | `number \| null` | NULL | `value_sent − value_received` — **selisih transfer** (bukan persediaan; R-04). |

*Contoh (BR-TRF):* kirim 40 pcs dari A: `value_sent = R(985000×40/120) = 328333` (movement `TRANSFER_OUT` di A); B terima 38 → `value_received = R(328333×38/40) = 311916` (movement `TRANSFER_IN` di B); `qty_variance_base 2.0000`, `value_variance 16417`.

**In-transit** (qty & nilai) **bukan tabel**: diturunkan sebagai view `v_in_transit` = Σ `transfer_line.qty_sent_base`/`value_sent` dari `transfer` berstatus `SENT` (§5.8). In-transit **bukan** bagian `stock_balance` outlet mana pun (BR-TRF-002).

#### 4.3.7 `stocktake` dan `stocktake_line` — stock opname / penyesuaian

Delta terhadap snapshot (BR-STK-030/031). Online di `/admin`. Kelas **D**. Mewarisi `STD-D`. Lokasi: server. Rujukan: BR-STK-030/031/032/033, FR-INV-007.

**`stocktake`**

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-D)* | | | | — |
| `status` | `text` | `string` | NN, DEF `'DRAFT'`, CHK IN (`DRAFT`,`POSTED`,`CANCELED`) | Hitung fisik dilakukan di antara `DRAFT` dan `POSTED`. |
| `scope` | `text` | `string` | NN, DEF `'SELECTED'`, CHK IN (`ALL`,`SELECTED`) | Seluruh/subset SKU (FLOW-13). |
| `snapshot_at` | `timestamptz` | `string` | NN | Waktu server `snapshot_qty` diambil. |

**`stocktake_line`**

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id`, `tenant_id`, `stocktake_id` | | | PK, FK | — |
| `sku_id` | `uuid` | `string` | NN, FK→`sku` | `UQ (stocktake_id, sku_id)`. |
| `snapshot_qty` | `numeric(18,4)` | `string` | NN | Saldo saat dokumen dibuat (base UOM). |
| `counted_qty` | `numeric(18,4)` | `string \| null` | NULL, CHK `>= 0` | Diisi manager/gudang. |
| `delta_qty` | `numeric(18,4)` | `string \| null` | GENERATED `counted_qty − snapshot_qty` STORED | `delta` terhadap snapshot (BR-STK-030). Penjualan sesudah snapshot tidak hilang (BR-STK-031). |
| `delta_value` | `bigint` | `number \| null` | NULL | Diisi saat posting: delta negatif `−R(nilai×abs(Δ)/qty)` (seluruh nilai bila `abs(Δ) = qty`); delta positif `R(nilai×Δ/qty)` atau `Δ × biaya referensi` bila `qty ≤ 0` (BR-STK-030/032). |

*Contoh (BR-STK-032):* A 80 pcs / 656.667, fisik 77 → `delta_qty −3.0000`, `delta_value −24625` → saldo `77 / 632042`.

---

### 4.4 Modul 4 — HPP Multi-Outlet (Moving Average dari Ledger)

Modul ini **tidak menambah tabel**; ia adalah **aturan perhitungan** di atas `stock_balance`, `stock_movement`, dan kolom snapshot pada Modul 5 (`sale_line.cost_snapshot`, `credit_note_line.cost_returned`). Perhitungan dijalankan **di server** di bawah row lock (BR-HPP-001).

#### 4.4.1 Pemetaan aturan → kolom

| Aturan PRD | Perwujudan di skema |
|---|---|
| Moving average **per outlet**, per SKU (BR-HPP-001) | `stock_balance` PK `(outlet_id, sku_id)` — saldo tiap outlet independen. |
| Yang disimpan: nilai persediaan (integer) + kuantitas (decimal); rata-rata **tidak** disimpan (BR-HPP-002) | `stock_balance.inventory_value` (`bigint`) dan `qty` (`numeric(18,4)`). Tidak ada kolom `avg_cost`. Rata-rata = `inventory_value / qty` saat dibutuhkan (tampilan R-02). |
| Masuk: `qty += q_in; nilai += nilai_in` (BR-HPP-003) | `stock_movement` `GR_IN` / `TRANSFER_IN` / `RETURN_IN` / `ADJUSTMENT(+)` dengan `value_delta > 0`. |
| Keluar `q_out` saat `qty > 0`: `HPP = R(nilai × q_out / qty)` (BR-HPP-003) | `stock_movement` `SALE`/`RECIPE_CONSUMPTION`/`TRANSFER_OUT`/`ADJUSTMENT(−)` dengan `value_delta = −HPP`, `cost_basis = 'AVERAGE'`. |
| `qty` menjadi 0 ⇒ nilai dipaksa 0; `q_out = qty` ⇒ `HPP = nilai` (BR-HPP-003) | `CHK (qty <> 0 OR inventory_value = 0)` + `CHK (qty_after <> 0 OR value_after = 0)`. |
| HPP dibulatkan **saat dicatat** dan disimpan di baris penjualan (`cost_snapshot`) | `sale_line.cost_snapshot` = −Σ `value_delta` movement baris itu (konsistensi dijaga uji properti). |
| Penjualan offline telat: biaya **saat server memproses**, bukan backdate (BR-HPP-004) | `stock_movement.occurred_at` (label) vs `processed_at` (acuan); urutan biaya = `bal_seq`. |
| Stok tidak cukup: bagian tertutup stok habiskan nilai; kekurangan × biaya referensi; saldo negatif (BR-HPP-005, `DISEPAKATI` OQ-12: biaya referensi) | `stock_balance.ref_value/ref_qty`; satu movement per (sumber, SKU) dengan `cost_basis = 'MIXED'` (bagian tertutup stok + bagian kekurangan; contoh BR-HPP-005: 24.000 + 16.000 = HPP 40.000); `is_negative_result = true`; flag `STOK_MINUS` di `data_flag`. |
| HPP menu = Σ bahan (BR-HPP-006, BR-RCP-003) | Satu `RECIPE_CONSUMPTION` per bahan per baris; urutan bahan menurut `sku_id` ASC (deterministik) di dalam baris, baris menurut `line_no`. |
| Retur `KEMBALI_STOK` pada biaya snapshot (BR-HPP-007, BR-RTR-008) | `RETURN_IN`, `cost_basis = 'SNAPSHOT'`, `value_delta = R(cost_snapshot_baris × q / Q)`; retur terakhir mengambil sisa. Dicatat `credit_note_line.cost_returned`. |
| Void invoice: balik pada biaya snapshot (BR-INV-005) | `SALE_VOID` dengan `reverses_movement_id` = movement asal, `value_delta = −value_delta asal`. |
| Transfer: biaya rata-rata saat kirim; selisih bukan persediaan (BR-TRF-002/003) | `transfer_line.value_sent/value_received/value_variance` (§4.3.6). |
| HPP laba kotor tidak dilaporkan di MVP (BR-HPP-008) | Data tersedia (`cost_snapshot`); tidak ada tabel laporan. |

#### 4.4.2 Opsi yang ditolak / tidak dipakai

| Opsi | Keputusan | Alasan |
|---|---|---|
| **FIFO / layer biaya (lot)** — tabel `stock_layer(sku, outlet, qty_remaining, unit_cost, received_at)` | **TIDAK dipakai** (PRD menetapkan moving average, BR-HPP-001; FIFO tidak disebut) | Penjualan offline tiba telat dan tidak berurutan (BR-HPP-004) membuat konsumsi layer bergantung urutan kedatangan; layer menambah tabel besar dan kontensi; moving average cukup dengan 2 angka per (SKU, outlet). Serial/batch/kedaluwarsa juga ditunda (PRD §2.2). |
| Biaya rata-rata disimpan sebagai `numeric` per SKU | Ditolak | Menyimpan pecahan memicu drift dan melanggar BR-HPP-002; nilai + kuantitas integer/decimal-skala-tetap cukup. |
| Backdate HPP ke waktu jual | Ditolak | Bertentangan dengan BR-HPP-004; merombak ledger lampau. |
| Satu HPP lintas outlet (global) | Ditolak | Harus independen per outlet (KEP-08). |
| Retur memakai rata-rata saat retur | Ditolak | OQ-07 terjawab: biaya snapshot penjualan. |

---
### 4.5 Modul 5 — Operasional Kasir & Transaksi

**Prinsip modul ini** (berlaku untuk semua tabel kelas T/TC di bawah):

1. **Lahir di device**, dikirim sebagai perintah atomik (`FinalizeSale`, `VoidSale`, `FinalizeCreditNote`, `OpenShift`, `CloseShift`, `RecordCashMovement`, `AppendBillEvents`; Lampiran B), diproses server **idempoten dalam satu transaksi** (BR-SYN-020).
2. **Tidak ada `CHECK` yang menolak penjualan karena angka** (DB-02, AP-02). Kesamaan aritmetika (mis. `G = S2 + SC + pajak`, Σ alokasi = total bill, Σ pembayaran = tagihan) diverifikasi di **kode pemrosesan** memakai Kernel bersama dan hasilnya berupa **flag `SELISIH_HITUNG`** (angka client tetap disimpan, BR-MNY-007/EC-029) — **kecuali** pelanggaran struktural (payload rusak, referensi tidak dikenal, Σ pembayaran ≠ tagihan sehingga bill tak dapat `PAID`, BR-PAY-004) yang me-rollback transaksi dan membuat `attention_item` (BR-SYN-030). `CHECK` di bawah hanya untuk **domain nilai** (tanda, enum, pola NULL).
3. **Setelah terisi, baris fakta tidak diubah**. Pengecualian terdaftar: `status`/kolom `void_*` pada `sale`; transisi `status` `cash_cashier`; kolom hasil server (`cost_snapshot`, `cost_returned`, `expected_cash`, `variance`, `recap_*`). Ditegakkan dengan **hak UPDATE tingkat kolom** (§5.5).
4. **Snapshot** nama, harga, faktor, tarif, mode pajak, locale struk disalin ke baris (AP-07).
5. **Register `WAITER` (PRD, BR-FNB-011)** tidak menerbitkan invoice/nota kredit dan tidak memiliki shift/pembayaran/kas/retur; **pembayaran bill hasil serah-terima dicatat pada shift register `CASHIER` penerima** (BR-FNB-013) — `sale.shift_id`/`sale_payment.shift_id` selalu shift register pembayar.

#### 4.5.1 `cash_cashier` — shift

Tabel fisik `cash_cashier` = entitas PRD `shift` (kasir × register × rentang waktu, BR-SHF-001). Kelas **T**. Kolom STD-T dipakai dengan catatan: `created_by` = **kasir pemegang shift**; `occurred_at`/`created_at_device`/`clock_offset_ms` = **waktu buka**; `business_date` = tanggal bisnis buka; `command_id` = perintah `OpenShift`. Lokasi: server + Dexie **↑ lokal** (store `shift`). Rujukan: BR-SHF-001..010, FR-SHF-001..006, FLOW-03/10, R-03.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-T)* | | | | Lihat catatan di atas. |
| `status` | `text` | `string` | NN, DEF `'OPEN'`, CHK IN (`OPEN`,`CLOSED`,`FORCE_CLOSED`) | `FORCE_CLOSED` = tutup darurat manager (BR-SHF-009). |
| `opening_cash` | `bigint` | `number` | NN, CHK `>= 0` | Modal awal (BR-SHF-002). |
| `closed_at` | `timestamptz` | `string \| null` | NULL | Waktu tutup terkoreksi (device); untuk `FORCE_CLOSED` waktu server. |
| `closed_at_device` | `timestamptz` | `string \| null` | NULL | Jam device mentah saat tutup. |
| `close_command_id` | `uuid` | `string \| null` | NULL, FK→`idempotency_command` | Perintah `CloseShift`. |
| `counted_cash` | `bigint` | `number \| null` | NULL, CHK `>= 0` | **Hitungan fisik (blind count)**; terkunci setelah submit (BR-SHF-005/006). Untuk `FORCE_CLOSED`: hitungan manual manager. |
| `count_submitted_at` | `timestamptz` | `string \| null` | NULL | Setelah terisi hitungan **tidak dapat diubah** (kolom write-once). |
| `expected_cash_device` | `bigint` | `number \| null` | NULL | Yang dihitung device dan **ditampilkan ke kasir setelah submit** (BR-SHF-006). |
| `variance_device` | `bigint` | `number \| null` | NULL | `counted_cash − expected_cash_device` (negatif = kurang). |
| `expected_cash` | `bigint` | `number \| null` | NULL | **Hitung ulang server** setelah semua perintah register diterima (BR-SHF-008): `opening_cash + Σ tunai terapan + Σ kas masuk − Σ kas keluar − Σ refund tunai` (BR-SHF-005). |
| `variance` | `bigint` | `number \| null` | NULL | `counted_cash − expected_cash` (otoritatif; sumber R-03). Hanya dicatat; tidak memblokir tutup (EC-037). |
| `recap_cash_sales` | `bigint` | `number \| null` | NULL | Σ `sale_payment.amount_applied` tunai pada shift (void membatalkan kontribusi). Denormalisasi hasil hitung server untuk R-03. |
| `recap_cash_in`, `recap_cash_out` | `bigint` | `number \| null` | NULL | Σ `cash_movement` `IN`/`OUT`. |
| `recap_cash_refund` | `bigint` | `number \| null` | NULL | Σ `credit_note_refund` tunai pada shift. |
| `recap_status` | `text` | `string` | NN, DEF `'INCOMPLETE'`, CHK IN (`COMPLETE`,`INCOMPLETE`) | **"Belum lengkap"** selama ada perintah pending register itu (BR-SHF-008; ditentukan dari `device_sync_status.pending_count` dan perintah `CloseShift` diterima). |
| `recap_computed_at` | `timestamptz` | `string \| null` | NULL | — |
| `force_closed_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | Wajib bila `FORCE_CLOSED`. |
| `force_close_reason_text` | `text` | `string \| null` | NULL | Wajib bila `FORCE_CLOSED` (alasan; audit). |
| `close_note` | `text` | `string \| null` | NULL, CHK ≤ 300 | — |

Constraint tabel: **`UQ (register_id) WHERE status = 'OPEN'`** (satu shift terbuka per register; dua register di satu outlet boleh paralel, BR-SHF-001) · `CHK (status = 'OPEN' OR closed_at IS NOT NULL)` · `CHK (status <> 'CLOSED' OR (counted_cash IS NOT NULL AND count_submitted_at IS NOT NULL))` · `CHK (status <> 'FORCE_CLOSED' OR (force_closed_by IS NOT NULL AND force_close_reason_text IS NOT NULL AND counted_cash IS NOT NULL))` · `UQ (id, register_id)` untuk FK komposit dari dokumen. Perintah yang berurutan **FIFO per register** (BR-SYN-023) menjamin `OpenShift` setelah `CloseShift` sebelumnya; pelanggaran `UQ` (mis. perintah dari device lama yang dipulihkan) → `attention_item`, bukan penolakan diam (EC-034).

Shift tertutup boleh meninggalkan open bill (BR-SHF-007): **pembayaran tercatat pada shift saat pembayaran terjadi** → `sale.shift_id`/`sale_payment.shift_id` selalu shift **saat bayar**, bukan shift saat bill dibuka.

#### 4.5.2 `cash_movement` — kas masuk / keluar

Kelas **T**. Mewarisi `STD-T`. Lokasi: server + Dexie **↑ lokal**. Rujukan: BR-SHF-004, FR-SHF-002.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-T)* | | | | — |
| `shift_id` | `uuid` | `string` | NN, FK→`cash_cashier` | Harus shift `OPEN` (BR-SHF-010; diverifikasi di perintah). |
| `direction` | `text` | `string` | NN, CHK IN (`IN`,`OUT`) | — |
| `amount` | `bigint` | `number` | NN, CHK `> 0` | Integer rupiah. |
| `reason_code` | `text` | `string` | NN | Kode alasan (katalog aplikasi). |
| `reason_text` | `text` | `string` | NN, CHK `char_length >= 1` | **Alasan wajib** (BR-SHF-004), teks bebas satu bahasa. |

Entri audit dibuat bersamaan (BR-AUD-001: "kas masuk/keluar").

#### 4.5.3 `sale` — header penjualan (invoice)

Dokumen akuntansi penjualan. Satu baris = satu invoice **PAID/VOID**. Dibuat server saat memproses `FinalizeSale`; salinan lokal dibuat device dalam **satu transaksi IndexedDB** bersama counter nomor, `sale_line`, `sale_payment`, `outbox_command`, `print_job` (BR-INV-004). Kelas **T**. Mewarisi `STD-T`. Lokasi: server + Dexie **↑ lokal** (retensi 3 bulan, hanya yang tersinkron dibersihkan). Rujukan: BR-INV-001..011, BR-MNY-*, BR-TAX-*, BR-DSC-*, BR-PAY-*, BR-CUS-*, BR-I18N-007, FR-POS-007/015, V-04..V-08/V-29/V-30.

*Pengelompokan kolom:*

**(a) Nomor dokumen**

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-T)* | | | | `register_id` = register penerbit nomor; `device_id` = device pada saat itu. |
| `invoice_no` | `text` | `string` | NN, CHK ≤ 40 | Format `{PREFIKS}-{MMYY}-{URUT6}`, mis. `OUT01-POS02-1126-000123` (prefiks `OUT01-POS02`); tambahan `-D1`,`-D2` bila konflik (BR-INV-009). **Bukan PK.** |
| `invoice_prefix` | `text` | `string` | NN, CHK `char_length BETWEEN 2 AND 16` | **Snapshot prefiks register** dari `register_invoice_prefix` periode itu (bentuk lengkap seperti §4.1.5). |
| `invoice_period` | `char(4)` | `string` | NN, CHK `^(0[1-9]\|1[0-2])\d{2}$` | `MMYY` dari **`business_date`** (BR-INV-003). |
| `invoice_seq` | `integer` | `number` | NN, CHK `> 0` | Urut per (register, periode); reset `1` tiap `MMYY`; **tanpa celah** (BR-INV-002); 7 digit bila > 999999. Dialokasikan **saat finalisasi**, atomik di device (BR-INV-004). |
| `invoice_conflict_idx` | `smallint` | `number` | NN, DEF `0`, CHK `>= 0` | `0` normal; `n > 0` → nomor tampilan berakhiran `-Dn` karena nomor sama dipakai penjualan lain (BR-INV-009, EC-034). |

Constraint nomor: **`UQ (tenant_id, invoice_no)`** · **`UQ (register_id, invoice_period, invoice_seq, invoice_conflict_idx)`** (integritas seri per register). Kecocokan `invoice_no` dengan komponen-komponennya diverifikasi di kode (flag bila tak cocok), bukan `CHECK`.

**(b) Status, void, relasi**

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `shift_id` | `uuid` | `string` | NN, FK→`cash_cashier` | Shift saat bayar (BR-SHF-010). |
| `legal_entity_id` | `uuid` | `string` | NN, FK→`legal_entity` | Entitas hukum penerbit (snapshot pemilik NPWP/PKP). |
| `status` | `text` | `string` | NN, DEF `'PAID'`, CHK IN (`PAID`,`VOID`) | **Tidak ada status lain**: tidak ada penjualan setengah bayar (BR-PAY-004). `VOID` mempertahankan nomor (BR-INV-005). |
| `voided_at` | `timestamptz` | `string \| null` | NULL | — |
| `voided_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | Peminta. |
| `void_approved_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | **Penyetuju (PIN supervisor)** ≠ peminta (BR-AUT-006/007). |
| `void_reason_code` | `text` | `string \| null` | NULL | — |
| `void_reason_text` | `text` | `string \| null` | NULL | Alasan wajib (BR-INV-005). |
| `void_command_id` | `uuid` | `string \| null` | NULL, FK→`idempotency_command` | Perintah `VoidSale`. |
| `bill_id` | `uuid` | `string \| null` | NULL, FK→`bill` | Rujukan buta ke open bill F&B (BR-ARC-004: Penjualan tidak tahu F&B). Validasi `FinalizeSale` ber-`bill_id` (BR-FNB-006/013): register pembayar = `bill.lease_register_id`, berjenis `CASHIER`, `handover_status = 'NONE'`, dan memiliki shift terbuka; pelanggaran = otorisasi/struktural → `attention_item`. |
| `bill_ref` | `text` | `string \| null` | NULL | Snapshot nomor tampilan bill (mis. `M05-0003`). |

Constraint: `CHK (status <> 'VOID' OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_approved_by IS NOT NULL AND void_reason_text IS NOT NULL))` · `CHK (void_approved_by IS NULL OR void_approved_by <> voided_by)` · `UQ (bill_id) WHERE bill_id IS NOT NULL` · `UQ (id, outlet_id, business_date)` (rujukan denormalisasi anak).

**(c) Snapshot konfigurasi** (BR-TAX-001, BR-TAX-010, BR-I18N-007, BR-PRC-005)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `price_tax_mode` | `text` | `string` | NN, CHK IN (`INCLUSIVE`,`EXCLUSIVE`) | Salinan mode outlet saat jual (EC-025). |
| `tax_profile` | `text` | `string` | NN, CHK IN (`NONE`,`PPN`,`PB1`) | — |
| `tax_rate` | `numeric(7,4)` | `string` | NN, CHK 0..100 | Tarif snapshot. |
| `service_charge_rate` | `numeric(7,4)` | `string` | NN, DEF `0`, CHK 0..100 | `0` bila SC mati. |
| `service_charge_taxable` | `boolean` | `boolean` | NN | Snapshot (OQ-01a: default ya). |
| `cash_rounding_unit` | `integer` | `number` | NN, CHK IN (`0`,`100`,`500`,`1000`) | — |
| `tax_rate_id` | `uuid` | `string \| null` | NULL, FK→`tax_rate_history` | Jejak baris riwayat tarif pajak yang dipakai; dasar flag `TARIF_BERBEDA` (EC-005). NULL bila profil `NONE`. |
| `receipt_locale` | `text` | `string` | NN, CHK IN (`id-ID`,`en-US`) | **Cetak ulang identik** walau pengaturan outlet berubah (BR-I18N-007). |
| `legal_entity_npwp` | `text` | `string \| null` | NULL | Snapshot NPWP (BR-TAX-010). |
| `legal_entity_is_pkp` | `boolean` | `boolean` | NN | Snapshot PKP. |
| `currency` | `char(3)` | `string` | NN, DEF `'IDR'`, CHK `= 'IDR'` | — |

**(d) Nilai** (semua integer rupiah, dibulatkan dan **disimpan**; BR-MNY-003/005, BR-TAX-006)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `gross_total` | `bigint` | `number` | NN, CHK `>= 0` | Σ `line_gross`. |
| `line_discount_total` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Σ diskon baris. |
| `bill_discount_type` | `text` | `string \| null` | NULL, CHK IN (`PERCENT`,`NOMINAL`) | Satu diskon per bill (BR-DSC-002). |
| `bill_discount_pct` | `numeric(7,4)` | `string \| null` | NULL, CHK 0..100 | Bila `PERCENT`. |
| `bill_discount_input` | `bigint` | `number \| null` | NULL, CHK `>= 0` | Nominal yang diketik bila `NOMINAL`. |
| `bill_discount_total` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | **D** (BR-TAX-006 langkah 5), dibulatkan 1×. |
| `discount_approved_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | Penyetuju PIN bila melewati batas role (BR-DSC-003; juga ada di audit). |
| `net_subtotal` | `bigint` | `number` | NN, CHK `>= 0` | **S2** = gross − diskon baris − diskon bill. |
| `service_charge` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | **SC** (BR-TAX-006 langkah 7). |
| `tax_base` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | **Dasar pajak B** = S2 (+ SC bila kena pajak) untuk baris kena pajak. |
| `tax_amount` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Pajak (PPN/PB1): eksklusif `R(B×r)`; inklusif `R(B×r/(1+r))`. |
| `dpp` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | DPP = B (eksklusif) atau `B − pajak` (inklusif) — BR-TAX-010. |
| `grand_total` | `bigint` | `number` | NN, CHK `>= 0` | **G** sebelum pembulatan tunai (eksklusif: S2+SC+pajak; inklusif: S2+SC). |
| `rounding` | `bigint` | `number` | NN, DEF `0` | **Bisa negatif**; hanya dari tunai penyelesai; **tidak mengubah dasar pajak** (BR-TAX-009). |
| `total_due` | `bigint` | `number` | GENERATED ALWAYS AS (`grand_total + rounding`) STORED | Total diterima/ditagih (R-01). Pembayaran Σ `amount_applied` = `total_due`. |

*Contoh (V-04, BR-TAX Contoh 1):* `gross_total 106700`, `line_discount_total 5370`, `net_subtotal 101330`, `tax_amount 11146`, `dpp 101330`, `grand_total 112476`, `rounding 24`, `total_due 112500`, tunai diterima 150.000, kembalian 37.500.
*Contoh inklusif (V-05):* `tax_base 101330`, `tax_amount 10042`, `dpp 91288`, `grand_total 101330`, `rounding −30`, `total_due 101300`.
*Contoh open price (V-30):* `gross_total 49500`, `tax_amount 5445`, `grand_total 54945`, `rounding −45`, `total_due 54900`, kembalian 5.100.

**(e) Pelanggan, jejak versi, biaya**

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `customer_name` | `text` | `string \| null` | NULL, CHK ≤ 80 | Snapshot opsional (BR-CUS-001). **Tidak pernah ditulis ke log** (BR-LOG-007). |
| `customer_phone` | `text` | `string \| null` | NULL, CHK ≤ 20 | Snapshot opsional; **dimasker di laporan** bagi pengguna tanpa permission `customer.view_phone` (BR-CUS-002/OQ-21). Tanpa enkripsi kolom (OQ-21 terjawab). |
| `catalog_cursor` | `bigint` | `number \| null` | NULL | Versi master yang dimiliki device saat menjual; dasar flag `ITEM_TIDAK_TERSEDIA` (BR-CAT-013, FR-POS-014). |
| `cost_total` | `bigint` | `number \| null` | NULL | Σ `sale_line.cost_snapshot` diisi server; NULL bila stok tidak dilacak. Bahan laporan laba kotor kelak (BR-HPP-008). |

Dexie (kolom tambahan lokal, bukan di server): `sync_status`, `synced_at`, `server_result` (flag dan HPP hasil ACK), `print_state`.

#### 4.5.4 `sale_line` — item penjualan (snapshot)

Kelas **TC**. Lokasi: server + Dexie **↑ lokal**. Rujukan: BR-MNY-003..006, BR-DSC-005, BR-TAX-006, BR-UOM-006, BR-PRC-003/006/007, BR-RTR-006, BR-HPP-004, FR-POS-004/016, V-03/V-09.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 client. |
| `tenant_id` | `uuid` | `string` | NN | — |
| `sale_id` | `uuid` | `string` | NN, FK→`sale` | — |
| `outlet_id`, `business_date` | `uuid`, `date` | `string` | NN | Denormalisasi `sale` (dasar laporan per item). |
| `line_no` | `integer` | `number` | NN, CHK `> 0` | Urutan baris; **bobot seri LR** (BR-MNY-006) dan urutan konsumsi stok (BR-RCP-003). `UQ (sale_id, line_no)`. |
| `line_kind` | `text` | `string` | NN, DEF `'ITEM'`, CHK IN (`ITEM`,`SHARE`,`STOCK_BASIS`) | `SHARE` = baris sintetis "Bagian k/N" pada bagi rata; `STOCK_BASIS` = baris **tak tercetak, nilai uang 0**, hanya dasar konsumsi stok/HPP yang dibawa **anak pertama yang lunas** pada bagi rata (BR-SPL-007 butir 3). Bentuk ini dikunci pada OQ-S16. |
| `product_id` | `uuid` | `string \| null` | NULL, FK→`product` | Penelusuran saja; tak dipakai untuk nilai. |
| `sku_id` | `uuid` | `string \| null` | NULL, FK→`sku` | `CHK (line_kind = 'SHARE' OR sku_id IS NOT NULL)`. |
| `uom_id` | `uuid` | `string \| null` | NULL, FK→`uom` | `CHK (line_kind = 'SHARE' OR uom_id IS NOT NULL)`. |
| `sku_code` | `text` | `string` | NN | **Snapshot** kode SKU. |
| `item_name` | `text` | `string` | NN, CHK ≤ 200 | **Snapshot** nama (produk + varian), atau "Bagian k/N — {bill_ref}" untuk `SHARE`. |
| `uom_code` | `text` | `string` | NN | Snapshot kode UOM jual. |
| `qty` | `numeric(18,4)` | `string` | NN, CHK `> 0` | **Kuantitas dalam UOM jual** (BR-UOM-006). |
| `conversion_factor` | `numeric(18,4)` | `string` | NN, CHK `> 0` | **Faktor snapshot** (EC-024). |
| `qty_base` | `numeric(18,4)` | `string` | NN, CHK `> 0` | `qty × conversion_factor` — dasar movement stok. |
| `unit_price` | `bigint` | `number` | NN, CHK `>= 0` | **Snapshot harga satuan** (menu + Σ selisih modifier, BR-PRC-006; atau harga diketik bila open price). |
| `price_source` | `text` | `string` | NN, CHK IN (`OUTLET`,`TENANT_DEFAULT`,`OPEN_PRICE`) | Asal harga (BR-PRC-002/007); `OPEN_PRICE` dikecualikan dari flag harga stale. |
| `is_open_price` | `boolean` | `boolean` | NN, DEF `false` | **Snapshot penanda** (tetap benar walau master berubah, EC-056; BR-PRC-007). |
| `taxable` | `boolean` | `boolean` | NN, DEF `true` | Snapshot `product.taxable` (BR-TAX-008). |
| `discount_type` | `text` | `string \| null` | NULL, CHK IN (`PERCENT`,`NOMINAL`) | Satu diskon per baris (BR-DSC-002). |
| `discount_pct` | `numeric(7,4)` | `string \| null` | NULL, CHK 0..100 | — |
| `discount_input` | `bigint` | `number \| null` | NULL, CHK `>= 0` | Nominal diketik. |
| `discount_approved_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | Penyetuju bila di atas batas. |
| `line_gross` | `bigint` | `number` | NN, CHK `>= 0` | `R(unit_price × qty)` (BR-MNY-005; 1× per baris). |
| `line_discount` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Diskon baris (persen: `R(gross×p/100)`; nominal: `min(nominal, gross)`). |
| `line_net` | `bigint` | `number` | NN, CHK `>= 0` | `line_gross − line_discount`. |
| `bill_discount_alloc` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | **Alokasi LR** diskon bill ke baris, **disimpan** (BR-DSC-005, V-03). |
| `service_alloc` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Alokasi LR SC (BR-TAX-006 langkah 12). |
| `tax_alloc` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Alokasi LR pajak (mis. V-09: 4.070/1.760/5.316). Dasar nilai retur (BR-RTR-006). |
| `cost_snapshot` | `bigint` | `number \| null` | NULL | **HPP baris, diisi server** (BR-HPP-004): −Σ `value_delta` movement baris ini. NULL = stok tak dilacak / menu tanpa resep (BR-RCP-006). |
| `note` | `text` | `string \| null` | NULL, CHK ≤ 200 | Catatan baris (bagian kriteria "sejenis" pada merge, BR-SPL-022). |
| `source_bill_item_id` | `uuid` | `string \| null` | NULL | Penelusuran ke `bill_item` (F&B). |

Constraint tambahan: `CHK (line_kind <> 'STOCK_BASIS' OR (line_gross = 0 AND line_discount = 0 AND line_net = 0 AND bill_discount_alloc = 0 AND service_alloc = 0 AND tax_alloc = 0))` · `CHK (price_source <> 'OPEN_PRICE' OR (is_open_price AND unit_price > 0))` (harga open price integer > 0, EC-055) · `CHK ((discount_type IS NULL) = (discount_pct IS NULL AND discount_input IS NULL))`. **Harga stale** (BR-PRC-003) **tidak** disimpan di kolom: server membandingkan `unit_price` dengan harga master saat memproses dan membuat flag `HARGA_STALE` (selisih ditulis di `data_flag.diff_amount`, mis. −1.000).

*Contoh (V-03):* diskon bill 10.000 dialokasikan LR ke tiga baris `line_net` 70.000/16.000/44.500 → `bill_discount_alloc` 5.364/1.226/3.410 (Σ 10.000).

#### 4.5.5 `sale_line_modifier` — modifier pada baris penjualan

Snapshot modifier terpilih pada baris (F&B). Kelas **TC**. Lokasi: server + Dexie **↑ lokal**. Rujukan: BR-PRC-006, BR-RCP-004, FR-FNB-005.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | — |
| `tenant_id` | `uuid` | `string` | NN | — |
| `sale_line_id` | `uuid` | `string` | NN, FK→`sale_line` | — |
| `modifier_id` | `uuid` | `string \| null` | NULL, FK→`modifier` | Rujukan penelusuran; **server memakainya untuk menurunkan penyesuaian bahan** (`modifier_ingredient`) saat memproses (BR-RCP-004/006). |
| `name` | `text` | `string` | NN | **Snapshot** nama. |
| `price_delta` | `bigint` | `number` | NN | **Snapshot** selisih harga (sudah termasuk dalam `sale_line.unit_price`). |
| `qty` | `smallint` | `number` | NN, DEF `1`, CHK `>= 1` | Jumlah pilihan per 1 unit baris. |

Constraint: `UQ (sale_line_id, modifier_id) WHERE modifier_id IS NOT NULL`.

#### 4.5.6 `sale_payment` — pembayaran multi-metode

Kelas **TC**. Lokasi: server + Dexie **↑ lokal**. Rujukan: BR-PAY-001..005, BR-TAX-009, BR-SHF-005, FR-PAY-001..005, V-11.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | — |
| `tenant_id` | `uuid` | `string` | NN | — |
| `sale_id` | `uuid` | `string` | NN, FK→`sale` | — |
| `shift_id` | `uuid` | `string` | NN, FK→`cash_cashier` | Shift saat pembayaran (dasar `kas_diharapkan`). |
| `outlet_id`, `business_date` | `uuid`, `date` | `string` | NN | Denormalisasi (rekap per metode). |
| `seq` | `smallint` | `number` | NN, CHK `> 0` | Urutan pembayaran; `UQ (sale_id, seq)`. |
| `method_id` | `uuid` | `string` | NN, FK→`payment_method` | — |
| `method_code`, `method_name` | `text` | `string` | NN | **Snapshot**. |
| `method_kind` | `text` | `string` | NN, CHK IN (`CASH`,`NON_CASH`) | Snapshot. |
| `amount_applied` | `bigint` | `number` | NN, CHK `> 0` | **Nominal diterapkan** ke tagihan (tunai: sudah termasuk pembulatan tunai bila penyelesai, mis. 35.700; BR-SHF-005). Σ = `sale.total_due`. Non-tunai **tidak boleh** melebihi sisa (BR-PAY-003; diverifikasi di kode, EC-035). |
| `cash_tendered` | `bigint` | `number \| null` | NULL, CHK `>= 0` | Tunai diterima; hanya `CASH`. |
| `change_given` | `bigint` | `number \| null` | NULL, CHK `>= 0` | **Kembalian** = `cash_tendered − amount_applied`; hanya `CASH`. |
| `reference` | `text` | `string \| null` | NULL, CHK ≤ 60 | Referensi non-tunai opsional (4 digit kartu/kode approval/ID transfer); tidak divalidasi (BR-PAY-005). |
| `is_rounding_settler` | `boolean` | `boolean` | NN, DEF `false` | Penanda pembayaran **tunai yang menyelesaikan** tagihan dan karenanya dibulatkan (BR-TAX-009). |

Constraint: `CHK ((method_kind = 'CASH' AND cash_tendered IS NOT NULL AND change_given IS NOT NULL) OR (method_kind = 'NON_CASH' AND cash_tendered IS NULL AND change_given IS NULL))` · `CHK (NOT is_rounding_settler OR method_kind = 'CASH')`.

*Contoh (V-11, G=135.655):* `seq 1` QRIS `amount_applied 100000`; `seq 2` CASH `amount_applied 35700`, `cash_tendered 50000`, `change_given 14300`, `is_rounding_settler true`; `sale.rounding = 45`, `total_due = 135700`.

#### 4.5.7 `credit_note`, `credit_note_line`, `credit_note_refund` — retur / nota kredit

Dokumen retur **terpisah**, merujuk invoice asal, **seri sendiri per register**, invoice asal **tidak diubah** (BR-RTR-001, BR-INV-010). Kelas **T** / **TC**. Lokasi: server + Dexie **↑ lokal**. Rujukan: BR-RTR-001..009, BR-HPP-007, FR-RTR-001..007, V-18.

**`credit_note`** (mewarisi `STD-T`; `created_by` = kasir pembuat)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-T)* | | | | `business_date` = tanggal bisnis **nota kredit** (bukan invoice asal; BR-RTR-009). |
| `cn_no` | `text` | `string` | NN, CHK ≤ 40 | Format `{PREFIKS}-NK-{MMYY}-{URUT6}` (mis. `OUT01-POS02-NK-1126-000001`); penanda `NK` tetap (BR-INV-010). |
| `cn_prefix` | `text` | `string` | NN | Snapshot prefiks register (sama dengan prefiks invoice periode itu). |
| `cn_period` | `char(4)` | `string` | NN, CHK `^(0[1-9]\|1[0-2])\d{2}$` | `MMYY` dari `business_date` NK. |
| `cn_seq` | `integer` | `number` | NN, CHK `> 0` | Seri terpisah dari invoice, tanpa celah, reset bulanan. |
| `cn_conflict_idx` | `smallint` | `number` | NN, DEF `0` | Analog `invoice_conflict_idx`. |
| `original_sale_id` | `uuid` | `string` | NN, FK→`sale` | Wajib (BR-RTR-001). Invoice `VOID` tidak dapat diretur (BR-RTR-009; diverifikasi di kode). |
| `original_invoice_no` | `text` | `string` | NN | Snapshot untuk cetak. |
| `shift_id` | `uuid` | `string` | NN, FK→`cash_cashier` | Shift pencatat refund tunai (BR-RTR-007). |
| `status` | `text` | `string` | NN, DEF `'POSTED'`, CHK IN (`POSTED`) | Nilai tunggal disiapkan untuk perluasan. |
| `reason_code` | `text` | `string` | NN | Kode alasan. |
| `reason_text` | `text` | `string \| null` | NULL | Teks bebas. |
| `approved_by` | `uuid` | `string` | NN, FK→`app_user` | **Supervisor penyetuju** (PIN, BR-RTR-002/AUT-006). `CHK (approved_by <> created_by)` (BR-AUT-007). |
| `price_tax_mode` | `text` | `string` | NN, CHK IN (`INCLUSIVE`,`EXCLUSIVE`) | Disalin dari invoice asal (menentukan apakah pajak ikut dalam `refund_gross`). |
| `cash_rounding_unit` | `integer` | `number` | NN | Unit pembulatan refund tunai. |
| `receipt_locale` | `text` | `string` | NN | Snapshot dari invoice asal. |
| `net_total` | `bigint` | `number` | NN, CHK `>= 0` | Σ `refund_net` baris. |
| `service_total` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Σ `refund_service`. |
| `tax_total` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | Σ `refund_tax`. |
| `refund_gross` | `bigint` | `number` | NN, CHK `>= 0` | Eksklusif: net + SC + pajak; inklusif: net + SC (pajak sudah termasuk). Mis. 16.110 + 1.772 = 17.882. |
| `rounding` | `bigint` | `number` | NN, DEF `0` | Pembulatan refund tunai (mis. +18), **dicatat terpisah** (BR-RTR-006). |
| `refund_total` | `bigint` | `number` | GENERATED ALWAYS AS (`refund_gross + rounding`) STORED | Σ `credit_note_refund.amount_applied` (mis. 17.900). |

Constraint: `UQ (tenant_id, cn_no)` · `UQ (register_id, cn_period, cn_seq, cn_conflict_idx)`. **Jendela retur 3 bulan kalender** (BR-RTR-003) dan batas kuantitas kumulatif (BR-RTR-009) divalidasi di perintah (kode), bukan `CHECK` (lintas tabel).

**`credit_note_line`** (anak)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id`, `tenant_id` | `uuid` | `string` | PK, NN | — |
| `credit_note_id` | `uuid` | `string` | NN, FK→`credit_note` | — |
| `sale_line_id` | `uuid` | `string` | NN, FK→`sale_line` | Baris invoice yang diretur. Kumulatif Σ `qty_returned` ≤ `sale_line.qty` (BR-RTR-009; diverifikasi server, pelanggaran = struktural → "perlu perhatian"). |
| `outlet_id`, `business_date` | | | NN | Denormalisasi. |
| `line_no` | `integer` | `number` | NN | `UQ (credit_note_id, line_no)`. |
| `qty_returned` | `numeric(18,4)` | `string` | NN, CHK `> 0` | Dalam UOM jual baris asal. |
| `qty_returned_base` | `numeric(18,4)` | `string` | NN, CHK `> 0` | Memakai `conversion_factor` snapshot baris asal. |
| `refund_net` | `bigint` | `number` | NN, CHK `>= 0` | `R((line_net − bill_discount_alloc) × q / Q)`; **retur terakhir mengambil sisa** (BR-RTR-006). |
| `refund_service` | `bigint` | `number` | NN, DEF `0` | `R(service_alloc × q / Q)` (idem sisa). |
| `refund_tax` | `bigint` | `number` | NN, DEF `0` | `R(tax_alloc × q / Q)` (idem sisa). Mis. 5.316 × 1/3 = 1.772. |
| `is_final_return` | `boolean` | `boolean` | NN, DEF `false` | **Fakta** bahwa retur ini menghabiskan sisa kuantitas baris dan mengambil sisa komponen (BR-RTR-006; V-18: 3.333 + 3.333 + 3.334). |
| `disposition` | `text` | `string \| null` | NULL, CHK IN (`KEMBALI_STOK`,`BUANG`) | Default retail `KEMBALI_STOK`, menu F&B ber-resep `BUANG` (BR-RTR-008). **NULL hanya untuk baris `SHARE`** (retur "Bagian k/N" bersifat nilai uang saja, BR-SPL-007 butir 4; dijaga kode). |
| `cost_returned` | `bigint` | `number \| null` | NULL | **Diisi server** bila `KEMBALI_STOK`: `R(cost_snapshot_baris × q / Q)` (retur terakhir mengambil sisa; mis. 8.208). NULL bila `BUANG`. |

**`credit_note_refund`** (anak: metode pengembalian)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id`, `tenant_id` | | | PK, NN | — |
| `credit_note_id` | `uuid` | `string` | NN, FK→`credit_note` | — |
| `shift_id` | `uuid` | `string` | NN, FK→`cash_cashier` | Shift tempat kas keluar (BR-RTR-007). |
| `seq` | `smallint` | `number` | NN | `UQ (credit_note_id, seq)`. |
| `method_id` | `uuid` | `string` | NN, FK→`payment_method` | Tunai atau mengikuti metode asal (OQ-19). |
| `method_code`, `method_name`, `method_kind` | `text` | `string` | NN | Snapshot. |
| `amount_applied` | `bigint` | `number` | NN, CHK `> 0` | Tunai: **setelah pembulatan** (mis. 17.900) → mengurangi `kas_diharapkan` (BR-SHF-005). |
| `reference` | `text` | `string \| null` | NULL | Referensi non-tunai manual. |

Σ `amount_applied` = `credit_note.refund_total` (diverifikasi di kode).

#### 4.5.8 `invoice_series` — pencatatan nomor tertinggi per register & periode

Dimiliki modul Penjualan (bukan kolom `cash_master`; BR-ARC-003/INV-006). Kelas **P**. Lokasi: **server saja** (counter lokal ada di Dexie `local_counter`). Rujukan: BR-INV-002/006/007/008, FR-DEV-003.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `register_id` | `uuid` | `string` | PK (1/3), FK→`cash_master` | — |
| `doc_type` | `text` | `string` | PK (2/3), CHK IN (`INVOICE`,`CREDIT_NOTE`) | Seri invoice dan nota kredit **terpisah** (BR-INV-010). |
| `period` | `char(4)` | `string` | PK (3/3), CHK `^(0[1-9]\|1[0-2])\d{2}$` | `MMYY` (reset bulanan). |
| `tenant_id` | `uuid` | `string` | NN | — |
| `outlet_id` | `uuid` | `string` | NN | — |
| `max_seq_received` | `integer` | `number` | NN, DEF `0` | **`last_invoice_seq_received`** (BR-INV-006): nomor tertinggi yang diterima. |
| `received_count` | `integer` | `number` | NN, DEF `0` | Banyaknya nomor berbeda yang diterima (verifikasi: `max_seq_received − received_count` = Σ panjang gap `OPEN/EXPLAINED`). |
| `last_received_at` | `timestamptz` | `string \| null` | NULL | — |
| `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Diperbarui (row lock) pada transaksi pemrosesan yang sama dengan penyisipan `sale`/`credit_note`; lock per register mempertahankan urutan FIFO (BR-SYN-023). Baris dibuat saat nomor pertama periode itu diterima (ketiadaan baris = `0`, FLOW-01).

#### 4.5.9 `invoice_gap` — gap nomor yang dapat diaudit

Nomor lebih kecil dari yang tertinggi yang **tidak pernah diterima** dicatat sebagai gap (BR-INV-007). Kelas **P/T-server**. Lokasi: server saja. Rujukan: BR-INV-007/008, FR-ADM-002, EC-008.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 server. |
| `tenant_id`, `outlet_id`, `register_id` | `uuid` | `string` | NN, FK | — |
| `doc_type` | `text` | `string` | NN, CHK IN (`INVOICE`,`CREDIT_NOTE`) | — |
| `period` | `char(4)` | `string` | NN | `MMYY`. |
| `seq_from`, `seq_to` | `integer` | `number` | NN, CHK `seq_from <= seq_to`, `seq_from > 0` | Rentang inklusif. |
| `origin` | `text` | `string` | NN, CHK IN (`DETECTED`,`RECOVERY_DECLARED`) | `DETECTED`: lompatan saat menerima nomor lebih besar. `RECOVERY_DECLARED`: dari "nomor struk fisik terakhir" saat pemulihan register (BR-INV-008). |
| `status` | `text` | `string` | NN, DEF `'OPEN'`, CHK IN (`OPEN`,`EXPLAINED`,`FILLED`) | `OPEN`→`EXPLAINED` oleh manager (BR-INV-007). **`FILLED`** (perluasan, OQ-S10 terjawab): nomor di rentang itu akhirnya tiba (perintah pending diterima/impor file ekspor); bila hanya sebagian terisi, baris dipecah menjadi baris sisa baru. |
| `reason_code`, `reason_text` | `text` | `string \| null` | NULL | Penjelasan (mis. `DEVICE_LOST`). |
| `explained_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | — |
| `explained_at`, `filled_at` | `timestamptz` | `string \| null` | NULL | — |
| `detected_at` | `timestamptz` | `string` | NN, DEF `now()` | — |
| `register_recovery_id` | `uuid` | `string \| null` | NULL, FK→`register_recovery` | Untuk `RECOVERY_DECLARED`. |

Constraint tabel: **`EXCLUDE USING gist (register_id WITH =, doc_type WITH =, period WITH =, int4range(seq_from, seq_to, '[]') WITH &&) WHERE (status <> 'FILLED')`** (gap aktif tidak saling tumpang tindih; memerlukan ekstensi `btree_gist`) · `CHK (status <> 'EXPLAINED' OR (explained_by IS NOT NULL AND explained_at IS NOT NULL AND reason_text IS NOT NULL))`. Anotasi dicatat audit (BR-AUD-001). **Gap akibat kehilangan device sebelum sync tidak dapat dieliminasi total** (RSK-02).

#### 4.5.10 `register_recovery` — pemulihan register

Mencatat keputusan awal nomor saat device pengganti dipasang (BR-INV-008, FLOW-16). Kelas **T-server**. Lokasi: server saja (nilai awal counter dikirim ke device baru saat enrollment). Rujukan: BR-INV-008, FR-DEV-003, V-29.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | — |
| `tenant_id`, `outlet_id`, `register_id` | `uuid` | `string` | NN, FK | — |
| `doc_type` | `text` | `string` | NN, CHK IN (`INVOICE`,`CREDIT_NOTE`) | Satu baris per jenis seri. |
| `period` | `char(4)` | `string` | NN | Periode `MMYY` berjalan saat pemulihan. |
| `old_device_id` | `uuid` | `string` | NN, FK→`device` | Device yang dicabut. |
| `new_device_id` | `uuid` | `string \| null` | NULL, FK→`device` | Terisi saat device baru di-enroll. |
| `highest_received_seq` | `integer` | `number` | NN, CHK `>= 0` | `invoice_series.max_seq_received` saat pemulihan. |
| `declared_last_seq` | `integer` | `number \| null` | NULL, CHK `>= highest_received_seq` | **"Nomor terakhir pada struk fisik terakhir"** yang dimasukkan manager bila diketahui. |
| `next_seq` | `integer` | `number` | NN, CHK `> 0` | Awal counter device baru = `COALESCE(declared_last_seq, highest_received_seq) + 1` (contoh BR-INV-008: tertinggi 124, dinyatakan 127 → mulai 128, gap 125–127). |
| `reason_text` | `text` | `string \| null` | NULL | — |
| `performed_by` | `uuid` | `string` | NN, FK→`app_user` | Owner/manager. |
| `performed_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Periode berikutnya (setelah pergantian `MMYY`) mulai `000001` seperti biasa (BR-INV-008).

---

#### 4.5.11 F&B — `fnb_table`

Master meja (online). Status meja **diturunkan**: terisi bila ada ≥ 1 `bill` `OPEN` pada meja itu (BR-FNB-001) — bukan kolom. Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ filter outlet**. Rujukan: BR-FNB-001, FR-FNB-001. (Nama `fnb_table`: `table` adalah kata tercadang SQL.)

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `outlet_id` | `uuid` | `string` | NN, FK→`outlet` | — |
| `code` | `text` | `string` | NN, CHK `^[A-Za-z0-9\-_.]{1,10}$` | Mis. `M05`. |
| `area` | `text` | `string \| null` | NULL, CHK ≤ 40 | Mis. "Indoor". |
| `capacity` | `smallint` | `number \| null` | NULL, CHK `> 0` | — |
| `sort_order` | `integer` | `number` | NN, DEF `0` | — |
| `is_active` | `boolean` | `boolean` | NN, DEF `true` | — |

Constraint: `UQ (outlet_id, code) WHERE deleted_at IS NULL`.

#### 4.5.12 `bill` — open bill (proyeksi dari event)

**Open bill bukan dokumen akuntansi** (BR-FNB-002): tidak mengonsumsi nomor invoice; `bill_ref` hanya identitas operasional. Baris `bill` adalah **proyeksi** yang diperbarui server dalam transaksi pemrosesan `AppendBillEvents` (status diturunkan dari event, BR-FNB-005); sumber kebenaran = `bill_event`. Kelas **T/P**. Kolom `STD-T` dipakai untuk **pembukaan bill** (register/device **pembuka**, tidak berubah walau lease berpindah): `register_id`/`device_id`/`created_by`/`occurred_at`/`business_date`/`command_id` = register, device, staf, waktu, tanggal bisnis, dan perintah **pembuka**; `received_at` = waktu event pertama diterima. Lokasi: server + Dexie **↑ lokal** (bill milik device ini) + store `bill_snapshot` **↓** (bill device lain, read-only; FR-SYN-016). Rujukan: BR-FNB-001..009, BR-SPL-001..007/020..024, FR-FNB-002..004/007/008.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-T)* | | | | Lihat catatan di atas. |
| `table_id` | `uuid` | `string` | NN, FK→`fnb_table` | Meja bill (dapat berubah lewat event `TABLE_SET`). |
| `bill_ref` | `text` | `string` | NN, CHK ≤ 30 | Mis. `M05-0003`. **Bukan unik** (dua device offline dapat menghasilkan `bill_ref` sama; BR-FNB-007) — ditemukan lewat `(outlet_id, bill_ref)` indeks non-unik. |
| `status` | `text` | `string` | NN, DEF `'OPEN'`, CHK IN (`OPEN`,`SPLIT`,`PAID`,`CANCELED`,`MERGED`,`CLOSED_BY_SPLIT`) | `SPLIT` = induk yang dipecah (tidak pernah mendapat invoice, BR-SPL-001); `CLOSED_BY_SPLIT` = induk ditutup otomatis bila seluruh anak `PAID`/`CANCELED` (BR-SPL-002); `MERGED` = sumber merge. |
| `lease_device_id` | `uuid` | `string` | NN, FK→`device` | **Device pemegang (lease)** (BR-FNB-003): hanya pemegang yang boleh mengedit; terikat ke **device**, bukan staf; tidak kedaluwarsa. **Berpindah hanya lewat serah-terima sukarela yang diterima register tujuan** (BR-FNB-012): kolom ini dan `lease_register_id` diubah **hanya** oleh fungsi server pemroses `BILL_ACCEPTED` dalam satu transaksi; trigger menolak `UPDATE` lewat jalur lain. Awal = device pembuka; anak split mewarisi pemegang induk (BR-SPL-001). **Tetap tidak ada take-over atau tutup paksa** (BR-FNB-004): serah-terima inisiatif dan persetujuan pemegang. |
| `lease_register_id` | `uuid` | `string` | NN, FK→`cash_master` | **Register pemegang saat ini.** Awal = register pembuka; menjadi register penerima setelah `BILL_ACCEPTED` (BR-FNB-012). Acuan syarat pembayaran: pemegang harus register berjenis `CASHIER` dan pembayaran tercatat pada shift register ini (BR-FNB-006/013; divalidasi saat `FinalizeSale`). Hubungan register ↔ device pemegang (bila device register diganti): OQ-S20 terjawab — keduanya disimpan. |
| `handover_status` | `text` | `string` | NN, DEF `'NONE'`, CHK IN (`NONE`,`PENDING`) | `PENDING` = **"menunggu diterima oleh {register}"** (BR-FNB-012 butir 2): bill **masih dimiliki pengirim** tetapi **read-only bagi pengirim**, dan tidak dapat dipisah, digabung, dibayar, atau diubah (BR-FNB-013). `bill.status` tetap `OPEN`. Diset `PENDING` oleh `BILL_HANDED_OVER`, kembali `NONE` oleh `BILL_ACCEPTED` atau `BILL_HANDOVER_CANCELED`. |
| `handover_target_register_id` | `uuid` | `string \| null` | NULL, FK→`cash_master` | Register `CASHIER` tujuan yang dipilih pengirim; terisi ⇔ `PENDING`. Dasar daftar **"bill masuk"** di register tujuan (lewat `bill_snapshot`). |
| `handover_event_id` | `uuid` | `string \| null` | NULL, FK→`bill_event` | Event `BILL_HANDED_OVER` yang sedang menunggu; terisi ⇔ `PENDING`. |
| `handover_requested_at` | `timestamptz` | `string \| null` | NULL | Jam **server** `BILL_HANDED_OVER` (dasar laporan "menunggu terlalu lama"). |
| `prebill_seq` | `integer` | `number \| null` | NULL | `bill_seq` `PREBILL_PRINTED` **terbaru** (BR-FNB-010). Dicatat saat pemegang memicu pra-bill, tidak bergantung keberhasilan cetak; tiap cetak ulang = satu event baru. |
| `prebill_printed_at` | `timestamptz` | `string \| null` | NULL | Jam server event `PREBILL_PRINTED` terbaru (tampilan "pra-bill dicetak pukul …"). |
| `last_content_seq` | `integer` | `number` | NN, DEF `0` | `bill_seq` event **perubahan isi** terakhir (`ITEM_ADDED`, `ITEM_VOIDED`, `ITEM_QTY_CHANGED`, `MODIFIER_SET`). |
| `is_awaiting_payment` | `boolean` | `boolean` | GENERATED ALWAYS AS (`prebill_seq IS NOT NULL AND prebill_seq > last_content_seq`) STORED | Status meja **"Menunggu bayar"** (BR-FNB-010, FR-FNB-014): `PREBILL_PRINTED` terbaru lebih baru daripada event perubahan isi terakhir; menambah/mengubah item sesudah pra-bill mengembalikannya ke "Terisi". Ikut **snapshot open bill** ke semua device. Bermakna hanya saat `status = 'OPEN'`. Penurunan di kolom turunan ini dikunci pada OQ-S19 (terjawab). |
| `parent_bill_id` | `uuid` | `string \| null` | NULL, FK→`bill` | Induk bila bill ini hasil split. |
| `split_mode` | `text` | `string \| null` | NULL, CHK IN (`ITEM`,`QTY`,`EQUAL`) | BR-SPL-003. |
| `share_index`, `share_count` | `smallint` | `number \| null` | NULL | Untuk `EQUAL`: bagian `k` dari `N` (BR-SPL-007). `CHK ((split_mode = 'EQUAL') = (share_index IS NOT NULL AND share_count IS NOT NULL))`, `share_index BETWEEN 1 AND share_count`. |
| `merged_into_bill_id` | `uuid` | `string \| null` | NULL, FK→`bill` | Wajib bila `MERGED` (BR-SPL-021). |
| `bill_discount_type` | `text` | `string \| null` | NULL, CHK IN (`PERCENT`,`NOMINAL`) | Diskon bill sementara pada open bill (event `DISCOUNT_SET`; OQ-S08 terjawab). Pada merge, diskon bill sumber dibuang (BR-SPL-022). |
| `bill_discount_pct` | `numeric(7,4)` | `string \| null` | NULL, CHK 0..100 | — |
| `bill_discount_input` | `bigint` | `number \| null` | NULL, CHK `>= 0` | — |
| `bill_discount_approved_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | — |
| `customer_name`, `customer_phone` | `text` | `string \| null` | NULL | Snapshot pelanggan (BR-CUS-001); target merge dipertahankan (BR-SPL-022). |
| `last_event_seq` | `integer` | `number` | NN, DEF `0` | `bill_seq` tertinggi yang diterapkan. |
| `last_event_at` | `timestamptz` | `string \| null` | NULL | Jam server event terakhir; ditampilkan sebagai **"terakhir diperbarui"** di snapshot (BR-FNB-003). |
| `closed_at` | `timestamptz` | `string \| null` | NULL | Terisi saat `PAID`/`CANCELED`/`MERGED`/`CLOSED_BY_SPLIT`. |

Constraint tabel: `CHK (status <> 'MERGED' OR merged_into_bill_id IS NOT NULL)` · `CHK (parent_bill_id IS NULL OR parent_bill_id <> id)` · `CHK ((handover_status = 'PENDING') = (handover_target_register_id IS NOT NULL AND handover_event_id IS NOT NULL))` · `CHK (handover_status = 'NONE' OR status = 'OPEN')` · trigger: `lease_device_id`/`lease_register_id` hanya boleh berubah dari fungsi pemroses `BILL_ACCEPTED` (§5.4.2). **Validasi server saat penerimaan** (BR-FNB-012 butir 5; ditolak langsung dengan pesan jelas, bukan `attention_item`): register tujuan berjenis `CASHIER`, satu outlet, device pengirim belum dicabut, bill masih `PENDING` · `UQ (id, tenant_id)` · indeks parsial meja terisi `WHERE status = 'OPEN'` (§5.2). **Banyak bill per meja diizinkan** (BR-FNB-007): tidak ada UQ pada `(outlet_id, table_id)`; server menandai flag `BILL_GANDA_MEJA`. Bill yatim = `status = 'OPEN'` dengan `lease_device_id` dicabut/tak aktif (termasuk bill `PENDING` yang register tujuannya tidak merespons: pengirim membatalkan lalu memilih tujuan lain, EC-060) → laporan "tanpa pemegang aktif" (EC-015) berupa view, bukan kolom.

Relasi `bill → sale`: lewat `sale.bill_id` (unik). Induk `SPLIT` tidak pernah punya `sale`. Mode `EQUAL`: anak tidak memiliki `bill_item`; baris sintetis `SHARE` dibuat saat finalisasi (BR-SPL-007).

#### 4.5.13 `bill_item` dan `bill_item_modifier` — isi open bill (proyeksi)

Proyeksi item aktif pada bill, diturunkan dari event; diperlukan untuk snapshot open bill, split, merge, dan sebagai dasar `FinalizeSale`. Kelas **P**. Lokasi: server + Dexie **↑ lokal** (bill milik device). Rujukan: BR-FNB-005/008, BR-SPL-003/022, FR-FNB-004.

**`bill_item`**

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 client (`ITEM_ADDED`). |
| `tenant_id`, `outlet_id` | `uuid` | `string` | NN | — |
| `bill_id` | `uuid` | `string` | NN, FK→`bill` | — |
| `line_no` | `integer` | `number` | NN | Urutan tampil. |
| `sku_id`, `uom_id` | `uuid` | `string` | NN | FK→`sku`; FK komposit `(sku_id, uom_id) → sku_uom`. |
| `sku_code`, `item_name`, `uom_code` | `text` | `string` | NN | **Snapshot** (BR-PRC-006). |
| `qty` | `numeric(18,4)` | `string` | NN, CHK `> 0` | — |
| `conversion_factor` | `numeric(18,4)` | `string` | NN | Snapshot. |
| `unit_price` | `bigint` | `number` | NN, CHK `>= 0` | Harga menu + Σ selisih modifier. |
| `price_source`, `is_open_price`, `taxable` | | | | Sama seperti `sale_line`. |
| `discount_type`, `discount_pct`, `discount_input`, `discount_approved_by` | | | | Diskon baris sementara. |
| `note` | `text` | `string \| null` | NULL | Bagian kriteria "sejenis" (BR-SPL-022). |
| `status` | `text` | `string` | NN, DEF `'ACTIVE'`, CHK IN (`ACTIVE`,`VOIDED`,`MOVED`) | `VOIDED` = `ITEM_VOIDED` (**event, bukan penghapusan**; BR-FNB-005); `MOVED` = dipindah ke bill lain oleh split/merge. |
| `void_reason_code`, `void_reason_text` | `text` | `string \| null` | NULL | Wajib bila `VOIDED` (tanpa PIN, OQ-17). |
| `origin_bill_id` | `uuid` | `string \| null` | NULL, FK→`bill` | Asal item (merge/split). |
| `origin_item_id` | `uuid` | `string \| null` | NULL, FK→`bill_item` | — |
| `created_event_id` | `uuid` | `string` | NN, FK→`bill_event` | Event pembuat. |

Constraint: `CHK (status <> 'VOIDED' OR void_reason_text IS NOT NULL)` · `UQ (bill_id, line_no)`.

**`bill_item_modifier`**: `id`, `tenant_id`, `bill_item_id` FK→`bill_item`, `modifier_id` FK→`modifier`, `name` (snapshot), `price_delta bigint` (snapshot), `qty smallint DEF 1`; `UQ (bill_item_id, modifier_id)`. Kriteria "item sejenis" pada merge membandingkan SKU, UOM, **kumpulan modifier**, harga satuan, diskon baris, dan `note` (BR-SPL-022).

#### 4.5.14 `bill_event` — event open bill (append-only)

Perubahan bill = **event append-only**, bukan penimpaan status (BR-SYN-021, BR-FNB-005, AP-09). Kelas **L**. Lokasi: server + Dexie **↑ lokal**. Kandidat partisi (§5.7). Rujukan: BR-FNB-005, BR-SYN-021, FR-SYN-005, FR-FNB-004, AP-11 (siap KDS).

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 client; penyisipan `ON CONFLICT (id) DO NOTHING` (idempoten). |
| `tenant_id`, `outlet_id` | `uuid` | `string` | NN | — |
| `bill_id` | `uuid` | `string` | NN, FK→`bill` | — |
| `bill_seq` | `integer` | `number` | NN, CHK `> 0` | Urutan **per bill** (ditetapkan pemegang lease; BR-FNB-005). `UQ (bill_id, bill_seq)`. Diterapkan ke proyeksi **berurutan** walau tiba acak (FR-SYN-005). **Event serah-terima** (`BILL_HANDED_OVER`/`BILL_ACCEPTED`/`BILL_HANDOVER_CANCELED`) dijalankan **online** dan `bill_seq`-nya ditetapkan **server** = `bill.last_event_seq + 1` dalam transaksi yang sama; pra-syarat antrean event bersih (BR-FNB-012 butir 1) menjamin tak ada celah; pemegang baru melanjutkan dari `last_event_seq` yang diunduh bersama bill (OQ-S21 terjawab). |
| `device_id` | `uuid` | `string` | NN, FK→`device` | Device pembuat event = **pemegang saat itu**; untuk `BILL_ACCEPTED` = device register penerima. |
| `register_id` | `uuid` | `string` | NN, FK→`cash_master` | — |
| `device_seq` | `bigint` | `number` | NN | Penghitung urut **device-wide** (satu penghitung untuk semua perintah outbox dan event); `UQ (device_id, device_seq)` (BR-FNB-005). |
| `staff_id` | `uuid` | `string` | NN, FK→`app_user` | **Staf yang bertindak** (lease terikat device, bukan staf; BR-FNB-003). |
| `event_type` | `text` | `string` | NN, CHK IN (`BILL_OPENED`,`ITEM_ADDED`,`ITEM_VOIDED`,`ITEM_QTY_CHANGED`,`MODIFIER_SET`,`CUSTOMER_SET`,`TABLE_SET`,`BILL_CANCELED`,`PREBILL_PRINTED`,`BILL_HANDED_OVER`,`BILL_ACCEPTED`,`BILL_HANDOVER_CANCELED`,`DISCOUNT_SET`,`BILL_SPLIT`,`BILL_MERGED`) | Daftar PRD (BR-FNB-005) mencakup 12 jenis termasuk **`PREBILL_PRINTED`** (BR-FNB-010) dan **`BILL_HANDED_OVER`/`BILL_ACCEPTED`/`BILL_HANDOVER_CANCELED`** (BR-FNB-012); skema masih menambah **`DISCOUNT_SET`, `BILL_SPLIT`, `BILL_MERGED`** yang dirujuk FLOW-06/07 tetapi tak terdaftar di BR-FNB-005 (§7.2). Pembayaran **bukan event**: `bill.status = 'PAID'` ditetapkan oleh pemrosesan `FinalizeSale`. |
| `payload` | `jsonb` | `object` | NN | Isi event (uang integer, qty string). Tidak memuat data pelanggan di luar kolom terdaftar. |
| `reason_code`, `reason_text` | `text` | `string \| null` | NULL | Alasan void item (`ITEM_VOIDED`, tanpa PIN, OQ-17). |
| `origin_bill_id` | `uuid` | `string \| null` | NULL, FK→`bill` | Untuk `BILL_MERGED`: bill sumber (BR-SPL-022). |
| `origin_event_ids` | `uuid[]` | `string[] \| null` | NULL | Daftar event asal yang digabung (jejak per-event waktu/staf tetap ada, BR-SPL-022). |
| `target_register_id` | `uuid` | `string \| null` | NULL, FK→`cash_master` | Hanya `BILL_HANDED_OVER`: register `CASHIER` tujuan (BR-FNB-012). |
| `handover_event_id` | `uuid` | `string \| null` | NULL, FK→`bill_event` | Hanya `BILL_ACCEPTED` / `BILL_HANDOVER_CANCELED`: event `BILL_HANDED_OVER` yang dijawab. |
| `created_at_device`, `clock_offset_ms`, `occurred_at`, `business_date` | | | NN | Seperti `STD-T`. |
| `received_at` | `timestamptz` | `string` | NN, DEF `now()` | Jam server. |
| `command_id` | `uuid` | `string` | NN, FK→`idempotency_command` | Perintah `AppendBillEvents`, atau `HandOverBill` / `AcceptBill` / `CancelBillHandover` untuk event serah-terima (Lampiran B). |
| `schema_version` | `integer` | `number` | NN, CHK `> 0` | **Versi kontrak** event ini. Event **append-only dan permanen**: `schema_version` menempel di tiap event dan **tidak pernah diubah**; payload lama dibaca server lewat *upcaster* (§2.5). |
| `app_version` | `text` | `string \| null` | NULL, CHK `char_length <= 30`, CHK `app_version ~ '^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$'` | Versi aplikasi pembuat event (jejak; tidak dipakai memproses). |

**Jejak serah-terima (BR-FNB-012 butir 6):** staf penyerah = `staff_id` event `BILL_HANDED_OVER`; staf penerima = `staff_id` event `BILL_ACCEPTED`; register asal = `bill.lease_register_id` saat penyerahan, tujuan = `target_register_id`; waktu = `received_at` (jam server). Tidak ada entri `audit_log` tersendiri (OQ-S19 terjawab); riwayat pemegang **diturunkan dari `bill_event`** (tanpa tabel riwayat terpisah). **Pembatasan penulis:** event isi/pra-bill dari device yang **bukan pemegang saat ini**, atau dari pemegang saat `handover_status = 'PENDING'`, ditolak sebagai otorisasi → `attention_item` — kecuali `BILL_HANDOVER_CANCELED` oleh pengirim.

Ledger: hak `UPDATE/DELETE` dicabut; trigger penjaga (§5.5). Event ber-`bill_seq` melewati celah (mis. event 5 tiba sebelum 4) **ditahan** di antrean pemrosesan sampai urutan lengkap atau dinilai struktural (BR-SYN-023: perintah dependen ditahan).

---
### 4.6 Modul 6 — Sinkronisasi & Log

#### 4.6.1 `tenant_sync` — counter versi per tenant

Inti pull sync **tanpa baris terlewat** (BR-SYN-010/011). Kelas **K**. Lokasi: server saja (device hanya menyimpan cursor di `meta`). Rujukan: BR-SYN-010..013, FR-SYN-001/002/003, RSK-03/13.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `tenant_id` | `uuid` | `string` | PK, FK→`tenant` | Satu baris per tenant, dibuat bersama tenant. |
| `version` | `bigint` | `number` | NN, DEF `0`, CHK `>= 0` | **Counter versi.** Dinaikkan secara atomik di transaksi penulisan master; baris ini terkunci (row lock) sampai COMMIT sehingga **urutan versi = urutan commit, tanpa celah** (BR-SYN-010 butir 3). Impor massal = satu kenaikan untuk banyak baris (butir 4). |
| `tombstone_floor_version` | `bigint` | `number` | NN, DEF `0`, CHK `0 <= x <= version` | Cursor device `< floor` → `FULL_RESYNC_REQUIRED` (BR-SYN-010 butir 6; FLOW-15). Naik oleh pembersih berkala (default tombstone dijamin 30 hari). |
| `floor_updated_at` | `timestamptz` | `string \| null` | NULL | Kapan floor terakhir dinaikkan. |
| `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Mekanisme (ilustrasi; urutan wajib):

```sql
BEGIN;                                                    -- transaksi PENDEK (BR-SYN-012)
  UPDATE tenant_sync SET version = version + 1, updated_at = now()
   WHERE tenant_id = $1 RETURNING version;                -- v; row lock ditahan sampai COMMIT
  UPDATE price_entry SET price = $2, version = $v, updated_at = now(), updated_by = $3
   WHERE id = $4 AND tenant_id = $1;                      -- stamp version = v
  INSERT INTO audit_log (...) VALUES (...);               -- audit di akhir transaksi
COMMIT;
```

Mengapa bukan `updated_at` atau `bigserial` sebagai cursor: lihat jebakan 1 dan 2 di BR-SYN-011 (waktu mulai transaksi dan nilai sequence tidak berurutan dengan urutan commit). Konsekuensi diterima: penulis master per tenant **diserialkan** (RSK-13).

#### 4.6.2 `idempotency_command` — log perintah push (idempotensi)

Menjamin **satu efek** per perintah walau dikirim berkali-kali (BR-SYN-020, EC-004, NFR-REL-001). Kelas **K**. Lokasi: server saja. Rujukan: BR-SYN-020..024/030, BR-LOG-009, FLOW-14.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `command_id` | `uuid` | `string` | PK | **Idempotency key** UUIDv7 buatan client (untuk `FinalizeSale` = `sale.id`). |
| `tenant_id` | `uuid` | `string` | NN, FK→`tenant` | — |
| `device_id`, `register_id`, `outlet_id` | `uuid` | `string` | NN, FK | Identitas pengirim (dari credential device, bukan dari payload). |
| `command_type` | `text` | `string` | NN, CHK IN (daftar Lampiran B) | Mis. `FinalizeSale`. |
| `channel` | `text` | `string` | NN, DEF `'OUTBOX'`, CHK IN (`OUTBOX`,`ONLINE`) | `OUTBOX` = perintah dari outbox Dexie (semua perintah push). `ONLINE` = aksi **online-only tanpa outbox** (`HandOverBill`, `AcceptBill`, `CancelBillHandover`; BR-FNB-012): dikirim langsung, kegagalannya dijawab **sinkron** kepada pengguna (`KODE#id`) dan **tidak** menjadi antrean "perlu perhatian". Tambahan aditif (DB-10); lihat OQ-S32. |
| `schema_version` | `integer` | `number` | NN, CHK `> 0` | **Versi kontrak** perintah. Server menerima **perintah baru** hanya bila ≥ `app_release.min_supported_schema_version` (BR-SYN-022: N dan N−1); perintah lama yang sudah tersimpan tetap dibaca selamanya (§2.5). |
| `device_seq` | `bigint` | `number \| null` | NULL, CHK `channel = 'ONLINE' OR device_seq IS NOT NULL` | Urutan device-wide; dasar FIFO per register (BR-SYN-023). **Wajib untuk `OUTBOX` (arti tidak berubah)**; `NULL` untuk `ONLINE` (aksi itu tidak mengantre sehingga tidak ikut urutan FIFO dan tidak meninggalkan celah `device_seq`). Tidak dipercaya lintas device. |
| `payload_hash` | `char(64)` | `string` | NN, CHK `^[0-9a-f]{64}$` | SHA-256 payload kanonik. Kunci sama + hash berbeda → **struktural** (penyalahgunaan/bug) → "perlu perhatian". |
| `status` | `text` | `string` | NN, CHK IN (`ACKED`,`ATTENTION`,`ACCEPTED_MANUAL`,`DISMISSED`) | `ACKED` = diproses sukses; `ATTENTION` = gagal struktural/otorisasi (BR-SYN-030); `ACCEPTED_MANUAL`/`DISMISSED` = keputusan manager (FLOW-18). Kegagalan **transien tidak dicatat di sini** (tak ada baris; client mencoba ulang). |
| `result` | `jsonb` | `object` | NN | **Hasil yang dikembalikan ulang** pada pengiriman ulang (ID dokumen, nomor, `received_at`, ringkasan flag, HPP). Tanpa data pelanggan. |
| `payload_size` | `integer` | `number` | NN, DEF `0` | Diagnostik. |
| `received_at` | `timestamptz` | `string` | NN, DEF `now()` | Penerimaan pertama. |
| `processed_at` | `timestamptz` | `string \| null` | NULL | — |
| `duration_ms` | `integer` | `number \| null` | NULL | Untuk log sync (BR-LOG-009). |
| `attempt_count` | `integer` | `number` | NN, DEF `1` | Bertambah pada pengiriman ulang. |
| `request_ref` | `text` | `string \| null` | NULL, CHK `^[A-Za-z0-9._-]{1,64}$` | **ID referensi** request (BR-LOG-005) untuk korelasi dengan log file. |
| `app_version` | `text` | `string \| null` | NULL, CHK `char_length <= 30`, CHK `app_version ~ '^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$'` | Versi aplikasi pengirim (header `X-App-Version`, ARCHITECTURE §4.2.1). |

Constraint tabel: `UQ (device_id, device_seq)` (menolak duplikasi urutan dari device yang sama; baris `ONLINE` ber-`device_seq` `NULL` tidak ikut) · `CHK (channel = 'OUTBOX' OR status = 'ACKED')` (aksi online-only yang ditolak **tidak** meninggalkan baris; hanya yang sukses disimpan agar pengiriman ulang setelah respons hilang mengembalikan hasil yang sama) · indeks `(tenant_id, received_at)`. Perintah dan dokumen yang dihasilkannya dicatat dalam **transaksi yang sama** (atomik, BR-ARC-005): baris ini `INSERT` pertama; bila gagal struktural, seluruh transaksi di-rollback lalu baris `ATTENTION` ditulis di transaksi terpisah. **Aksi online-only dan enrollment.** Cukup memakai tabel ini (perluasan `channel`, bukan tabel baru) untuk tiga aksi serah-terima bill, karena `bill_event.command_id` sudah merujuknya. **Enrollment device (`EnrollDevice`) bukan perintah di tabel ini**: pada saat itu `device_id`/`register_id` belum ada dan credential hanya dikembalikan **sekali** (tidak boleh disimpan di `result`). Keamanannya dijamin `pairing_code` sekali pakai (`UPDATE … WHERE used_at IS NULL` atomik, §4.1.15): bila respons enrollment hilang, kode sudah terpakai dan manajer menerbitkan kode baru — gagal-aman, tanpa menyimpan rahasia; hasilnya tercatat `audit_log` (`device.enrolled`) dengan `request_ref`.

Retensi: disimpan tanpa penghapusan di MVP (OQ-03/RSK-12); bila tabel membesar, `result` dapat dikosongkan untuk perintah lama tanpa mengubah semantik idempotensi (keputusan OQ-S09: baris perintah dipertahankan, hanya `result` lama yang dikosongkan setelah N bulan; N diatur konfigurasi).

#### 4.6.3 `attention_item` — antrean "perlu perhatian"

Perintah gagal **struktural** atau **otorisasi** yang perlu keputusan manager (BR-SYN-030, FLOW-18, FR-ADM-001). Kelas **K**. Lokasi: server saja. Rujukan: BR-SYN-023/030, BR-INV-009, EC-007/011/027/034.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 server. |
| `tenant_id`, `outlet_id`, `register_id`, `device_id` | `uuid` | `string` | NN, FK | Sumber. |
| `command_id` | `uuid` | `string` | NN, UQ, FK→`idempotency_command` | Satu perintah → satu item; sama dengan `commandId` di log (FR-LOG-006). |
| `command_type` | `text` | `string` | NN | — |
| `reason_class` | `text` | `string` | NN, CHK IN (`STRUCTURAL`,`AUTHORIZATION`) | Hanya dua kelas masuk antrean (BR-SYN-030). |
| `reason_code` | `text` | `string` | NN, CHK `reason_code ~ '^[A-Z][A-Z0-9_]{1,39}$'` | Kode **data** dari katalog kode error stabil (Lampiran A.5 butir 2; bukan kode tampilan kasir): mis. `VALIDATION_FAILED`, `UNKNOWN_REFERENCE`, `DEVICE_REVOKED`, `CREDENTIAL_INVALID`, `SERIES_CONFLICT`, `RETURN_EXCEEDS_QTY`, `PAYMENT_MISMATCH`, `SCHEMA_NOT_MIGRATABLE`. Kode, bukan teks (BR-I18N-004); hanya format yang dijaga CHECK (bukan `CHECK IN`) agar kode baru tidak memerlukan migrasi (DB-10). |
| `detail` | `text` | `string \| null` | NULL, CHK ≤ 500 | Ringkasan **tanpa data sensitif** (BR-LOG-007). |
| `payload` | `jsonb` | `object` | NN | Payload asli untuk "terima manual"/impor; **dapat memuat nama/telepon pelanggan sehingga akses dibatasi manager dan tidak pernah ditulis ke log**. |
| `blocked_by_command_id` | `uuid` | `string \| null` | NULL, FK→`idempotency_command` | Perintah dependen yang **ditahan** menunggu induknya (BR-SYN-023/EC-027). |
| `status` | `text` | `string` | NN, DEF `'OPEN'`, CHK IN (`OPEN`,`ACCEPTED`,`DISMISSED`,`ESCALATED`) | Keputusan manager: terima manual, abaikan + alasan (teraudit), eskalasi developer. |
| `resolution_note` | `text` | `string \| null` | NULL | Wajib bila `DISMISSED`. |
| `resolved_by` | `uuid` | `string \| null` | NULL, FK→`app_user` | — |
| `resolved_at` | `timestamptz` | `string \| null` | NULL | — |
| `request_ref` | `text` | `string \| null` | NULL | ID referensi pemrosesan yang gagal. |
| `created_at`, `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Constraint: `CHK (status <> 'DISMISSED' OR resolution_note IS NOT NULL)` · `CHK (status IN ('OPEN','ESCALATED') OR resolved_at IS NOT NULL)` · indeks parsial `WHERE status IN ('OPEN','ESCALATED')` untuk daftar manager.

#### 4.6.4 `data_flag` — log konflik / flag data bisnis

Kondisi bisnis yang **diterima sebagai fakta** tetapi perlu terlihat manager/laporan (BR-SYN-030 baris pertama; bukan error log, BR-LOG-009). Satu tabel untuk semua flag agar R-04 satu sumber. Kelas **K**. Lokasi: server saja. Rujukan: BR-PRC-003, BR-CAT-013, BR-STK-002, BR-INV-009, BR-MNY-007, EC-001/002/003/005/029, R-04.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 server. |
| `tenant_id`, `outlet_id` | `uuid` | `string` | NN, FK | — |
| `business_date` | `date` | `string` | NN | Tanggal bisnis dokumen sumber (filter R-04). |
| `flag_code` | `text` | `string` | NN, CHK IN (`HARGA_STALE`,`ITEM_NONAKTIF`,`ITEM_TIDAK_TERSEDIA`,`TARIF_BERBEDA`,`SELISIH_HITUNG`,`NOMOR_KONFLIK`,`STOK_MINUS`,`TANPA_RESEP`,`BILL_GANDA_MEJA`,`SELISIH_TRANSFER`) | Katalog Lampiran A. |
| `severity` | `text` | `string` | NN, DEF `'WARN'`, CHK IN (`INFO`,`WARN`) | — |
| `entity_type` | `text` | `string` | NN, CHK IN (`SALE`,`SALE_LINE`,`CREDIT_NOTE`,`STOCK_MOVEMENT`,`BILL`,`TRANSFER_LINE`) | Dokumen yang ditandai. |
| `entity_id` | `uuid` | `string` | NN | — |
| `parent_id` | `uuid` | `string \| null` | NULL | Dokumen induk (mis. `sale_id` untuk `SALE_LINE`). |
| `diff_amount` | `bigint` | `number \| null` | NULL | Selisih rupiah bila relevan (mis. harga stale `−1000`; `SELISIH_HITUNG` Rp1). |
| `detail` | `jsonb` | `object \| null` | NULL | Nilai terkait: `{expected, actual, catalog_cursor, changed_version, …}`; tanpa data pelanggan. |
| `command_id` | `uuid` | `string \| null` | NULL, FK→`idempotency_command` | Perintah yang menimbulkan flag. |
| `status` | `text` | `string` | NN, DEF `'OPEN'`, CHK IN (`OPEN`,`ACKNOWLEDGED`,`RESOLVED`) | `RESOLVED` otomatis mis. `STOK_MINUS` saat saldo kembali ≥ 0 oleh opname. |
| `acknowledged_by`, `acknowledged_at` | `uuid`, `timestamptz` | `string \| null` | NULL | — |
| `created_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Constraint: `UQ (tenant_id, entity_type, entity_id, flag_code)` (flag idempoten pada replay). Contoh **harga stale** (BR-PRC-003): `flag_code HARGA_STALE`, `entity_type SALE_LINE`, `diff_amount −1000` (−500 × 2), `detail {"sold_price":18500,"latest_price":19000}`. Contoh **V-28**: `ITEM_TIDAK_TERSEDIA` bila baris ketersediaan efektif `UNAVAILABLE` dengan `version > sale.catalog_cursor` **dan** `sale.occurred_at ≥ item_outlet_availability.changed_at`; penjualan sebelum perubahan di-commit **tidak** ditandai (BR-CAT-013).

#### 4.6.5 `audit_log` — audit log bisnis (append-only, hash berantai)

Jejak peristiwa BR-AUD-001 **tidak dapat diubah**. Kelas **L**. Lokasi: server saja (entri yang lahir offline terkirim bersama outbox). Rujukan: BR-AUD-001..003, BR-AUT-006/007, NFR-AUD-001, NFR-SEC-008, FR-AUD-001..004.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `id` | `uuid` | `string` | PK | UUIDv7 oleh pembuat entri (client untuk entri offline — idempoten; server untuk lainnya). |
| `tenant_id` | `uuid` | `string` | NN, FK→`tenant` | — |
| `chain_seq` | `bigint` | `number` | NN, CHK `> 0` | Urutan **per tenant tanpa celah** yang ditetapkan di bawah lock `audit_chain_head`. `UQ (tenant_id, chain_seq)`. |
| `outlet_id`, `register_id`, `device_id` | `uuid` | `string \| null` | NULL | Konteks (device asal, BR-AUD-003). |
| `actor_user_id` | `uuid` | `string \| null` | NULL, FK→`app_user` | Pelaku; NULL = sistem. |
| `approver_user_id` | `uuid` | `string \| null` | NULL, FK→`app_user` | **Penyetuju** (PIN supervisor; BR-AUT-006). `CHK (approver_user_id IS NULL OR approver_user_id <> actor_user_id)` (BR-AUT-007). |
| `action` | `text` | `string` | NN, CHK `^[a-z_.]{3,60}$` | Kode aksi (Lampiran A.4), mis. `sale.void`, `discount.override`, `price.changed`, `availability.changed`, `return.created`, `pin.locked`, `shift.force_closed`, `gap.explained`. Kode, bukan teks (BR-I18N-004). |
| `entity_type` | `text` | `string` | NN | Mis. `sale`, `price_entry`, `device`. |
| `entity_id` | `uuid` | `string \| null` | NULL | — |
| `before_data`, `after_data` | `jsonb` | `object \| null` | NULL | Nilai sebelum/sesudah. **Tidak memuat PIN/hash/token/nama-telepon pelanggan** (BR-LOG-007 berlaku analog). |
| `reason_code`, `reason_text` | `text` | `string \| null` | NULL | Alasan. |
| `occurred_at_device` | `timestamptz` | `string \| null` | NULL | Jam device mentah. |
| `clock_offset_ms` | `integer` | `number \| null` | NULL | — |
| `occurred_at` | `timestamptz` | `string` | NN | Waktu terkoreksi (offset) atau waktu server. |
| `recorded_at` | `timestamptz` | `string` | NN, DEF `now()` | **Waktu server** (BR-AUD-003: waktu device & server). |
| `business_date` | `date` | `string \| null` | NULL | — |
| `command_id` | `uuid` | `string \| null` | NULL, FK→`idempotency_command` | Perintah yang membawa entri. |
| `request_ref` | `text` | `string \| null` | NULL | ID referensi log. |
| `schema_version` | `integer` | `number \| null` | NULL, CHK `> 0` | Versi kontrak perintah pembawa (NULL untuk entri yang dibuat server tanpa perintah). |
| `app_version` | `text` | `string \| null` | NULL, CHK `char_length <= 30`, CHK `app_version ~ '^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$'` | Versi aplikasi pembuat entri (NULL bila dibuat server). |
| `prev_hash` | `bytea` | `string` | NN | `row_hash` entri sebelumnya (`chain_seq − 1`); entri pertama memakai nilai awal tetap. |
| `row_hash` | `bytea` | `string` | NN | `SHA-256(prev_hash ‖ canonical(kolom di atas selain hash))`. Verifikasi berantai mendeteksi pengubahan satu entri (FR-AUD-004). |

Ketentuan tegas (BR-AUD-002, NFR-SEC-008): (1) peran aplikasi **hanya `INSERT`/`SELECT`**; `REVOKE UPDATE, DELETE, TRUNCATE`; (2) trigger `BEFORE UPDATE OR DELETE` melempar kesalahan (pertahanan berlapis); (3) RLS hanya kebijakan `SELECT`/`INSERT`; (4) entri dibuat **di akhir transaksi bisnis** agar lock `audit_chain_head` ditahan sesingkat mungkin; (5) rantai **ketat per tenant** (keputusan OQ-S07; hash berantai tetap prioritas P1).

#### 4.6.6 `audit_chain_head` — kepala rantai audit per tenant

Kelas **K**. Lokasi: server saja. Rujukan: BR-AUD-002, FR-AUD-004.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `tenant_id` | `uuid` | `string` | PK, FK→`tenant` | — |
| `last_seq` | `bigint` | `number` | NN, DEF `0` | `chain_seq` terakhir. |
| `last_hash` | `bytea` | `string` | NN | `row_hash` terakhir. |
| `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Setiap penulisan audit: `SELECT … FOR UPDATE` baris ini → hitung `chain_seq = last_seq + 1`, `prev_hash = last_hash` → `INSERT audit_log` → `UPDATE` head. Serialisasi audit per tenant diterima karena beban ≤ 500 transaksi/hari/outlet (§5.4).

#### 4.6.7 `device_sync_status` — status sinkron & clock offset per device

Kolom **volatil** yang berubah tiap sync, dipisah dari `device` agar baris identitas/credential tidak panas. Kelas **K**. Relasi **1:1** dengan `device`. Lokasi: server saja (device menghitung sendiri versi lokalnya di `meta`). Rujukan: BR-SYN-050/051, BR-TIM-005/006, BR-AUT-008, FR-DEV-004/005, FR-SYN-011, BR-SYN-003 butir 6.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `device_id` | `uuid` | `string` | PK, FK→`device` | — |
| `tenant_id`, `register_id` | `uuid` | `string` | NN, FK | Denormalisasi untuk RLS dan daftar. |
| `last_attempt_at` | `timestamptz` | `string \| null` | NULL | Kontak terakhir (apa pun hasilnya). |
| `last_success_sync_at` | `timestamptz` | `string \| null` | NULL | **Sync sukses** = push tanpa kegagalan transien + pull selesai (BR-AUT-008). Dasar lease offline 7 hari. |
| `last_push_at`, `last_pull_at` | `timestamptz` | `string \| null` | NULL | — |
| `pull_cursor_version` | `bigint` | `number \| null` | NULL | Cursor terakhir yang dilaporkan device. |
| `pending_count` | `integer` | `number` | NN, DEF `0`, CHK `>= 0` | Perintah non-`ACKED` menurut laporan device (FR-DEV-004; dasar `cash_cashier.recap_status`). |
| `oldest_pending_at` | `timestamptz` | `string \| null` | NULL | Umur pending tertua (banner BR-SYN-051). |
| `attention_count` | `integer` | `number` | NN, DEF `0` | — |
| `clock_offset_ms` | `integer` | `number \| null` | NULL | Selisih server−device pada sync terakhir (BR-TIM-005). `abs(offset) > 10 menit` → peringatan manager (BR-TIM-006). |
| `clock_offset_at` | `timestamptz` | `string \| null` | NULL | — |
| `app_version` | `text` | `string \| null` | NULL | Versi aplikasi di device (FR-DEV-004; BR-SYN-003). |
| `schema_version` | `integer` | `number \| null` | NULL | **Versi kontrak** yang dikirim device (`X-Schema-Version`). |
| `sync_protocol_version` | `integer` | `number \| null` | NULL | Versi protokol sync device (`X-Sync-Protocol`); **tidak** disimpan per transaksi. |
| `storage_persist` | `text` | `string` | NN, DEF `'UNKNOWN'`, CHK IN (`GRANTED`,`DENIED`,`UNKNOWN`) | Hasil `navigator.storage.persist()` (BR-SYN-050, FR-DEV-005). |
| `storage_used_pct` | `smallint` | `number \| null` | NULL, CHK 0..100 | Peringatan > 70% (BR-SYN-054). |
| `last_error_code` | `text` | `string \| null` | NULL, CHK `last_error_code ~ '^[A-Z][A-Z0-9_]{1,39}$'` | Kode error terakhir dari katalog stabil (Lampiran A.5); tanpa stack dan tanpa teks bahasa. |
| `last_error_ref` | `text` | `string \| null` | NULL, CHK `^[A-Za-z0-9._-]{1,64}$` | ID referensi untuk dicari di log: ID server `YYYYMMDD-HHmmss-xxxxx` atau ID lokal perangkat `D-YYYYMMDD-HHmmss-xxxxx` (§4.6.9, OQ-S33). |
| `updated_at` | `timestamptz` | `string` | NN, DEF `now()` | — |

Lease offline berakhir pada `last_success_sync_at + 7 hari` (waktu terkoreksi); **tidak disimpan sebagai kolom** (diturunkan). Hanya dikomunikasikan, ditegakkan di device (BR-AUT-008).

#### 4.6.8 `app_release` — katalog versi aplikasi & versi minimum klien (tabel global)

Dasar kebijakan **N / N−1**, toleransi, rilis wajib (BR-SYN-003, BR-SYN-022) dan **versi minimum klien** (keputusan user 2026-11-18). Kelas **G**. Lokasi: server; device menerima nilai minimum lewat respons sync (`meta.min_supported`). Rujukan: BR-SYN-003/022, FLOW-17, FR-SYN-013/018, ARCHITECTURE §3.2/§9.6.

| Kolom | Tipe PG | TS | Constraint | Keterangan |
|---|---|---|---|---|
| `app_version` | `text` | `string` | PK, CHK ≤ 30, CHK format tag SemVer (`^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$`) | Mis. `v1.8.0` (tag git rilis). |
| `schema_version` | `integer` | `number` | NN, CHK `> 0` | **Versi kontrak** (N) yang dibawa rilis ini. |
| `released_at` | `timestamptz` | `string` | NN | — |
| `is_mandatory` | `boolean` | `boolean` | NN, DEF `false` | **Rilis wajib**: tanpa tombol "Nanti"; diterapkan otomatis bila tak ada checkout/shift (BR-SYN-003 butir 4). |
| `min_supported_schema_version` | `integer` | `number` | NN, CHK `> 0` AND `<= schema_version` | **Versi kontrak terendah yang masih diterima untuk perintah/event BARU** (= N−1 pada rilis biasa). Sebelumnya bernama `min_accepted_schema_version` (diubah mengikuti keputusan user; ARCHITECTURE perlu menyesuaikan). |
| `min_supported_app_version` | `text` | `string \| null` | NULL, CHK format tag SemVer | **Versi aplikasi terendah yang masih boleh sync** (push dan pull). NULL = tanpa batas bawah. Dibandingkan dengan pustaka SemVer di aplikasi (bukan urut leksikografis teks). |
| `accept_previous_until` | `timestamptz` | `string \| null` | NULL | Batas waktu klien dengan `schema_version` lama masih boleh **mengirim** (BR-SYN-003 butir 3: 30 hari menurut PRD BR-VER-002; OQ-29 PRD terjawab). |
| `notes` | `text` | `string \| null` | NULL | — |

**Kebijakan efektif = baris rilis dengan `released_at` terbaru** (nilai minimum boleh diubah pada baris itu tanpa rilis baru). Penyimpanan di baris `app_release` (bukan tabel konfigurasi terpisah) dipilih user (OQ-S25 terjawab 2026-11-19; opsi lain dan dampaknya di Bab 9). Tiap lingkungan (staging/produksi) memiliki database sendiri sehingga tidak perlu kolom lingkungan.

**Source map rilis.** Disimpan di server sebagai **berkas privat per rilis** (tidak pernah dilayani ke klien; hanya dibaca skrip CLI pencarian/pembacaan log, BR-LOG-013), **bukan** di database. **Tidak ada kolom tambahan di `app_release`** (keputusan user 2026-11-18, OQ-S31 terjawab): lokasi diturunkan dari `app_version` yang sudah menjadi PK dan tag git (`{DIR_SOURCEMAP}/{app_version}/…`, seperti logo struk yang berupa berkas di folder server, OQ-S06); isi berkas tidak masuk DB; tidak ada logika sync atau keputusan aplikasi yang bergantung padanya, sehingga kolom `sourcemap_path` hanya menduplikasi konvensi dan dapat basi. Pemeriksaan "rilis ini punya source map" dilakukan skrip ops pada rilis.

**Dampak ke sync:**
1. **Push:** perintah dengan `schema_version < min_supported_schema_version` atau `app_version < min_supported_app_version` **ditahan** (balasan `426 UPDATE_REQUIRED`): tetap di outbox, banner "wajib update", **shift baru diblokir** — bukan "perlu perhatian" (BR-SYN-003 butir 5; `last_error_class='SCHEMA'`). Perintah/event yang **sudah tersimpan** di server tetap dapat dibaca selamanya (upcaster): *menerima* dibatasi minimum, *membaca* tidak.
2. **Pull:** klien dengan `app_version < min_supported_app_version` tidak dilayani pull (`UPDATE_REQUIRED`) agar tidak menerapkan master yang bentuknya sudah berubah; klien di atas minimum tetap dilayani (kolom master baru bersifat aditif, DB-10). Setiap respons membawa `min_supported_*`, `latest`, `is_mandatory`, dan `max_schema_version` (klien lebih baru dari server: perintah ditahan `SERVER_BEHIND`).
3. **Menaikkan minimum** adalah prasyarat **fase kontrak** migrasi (DB-10): kolom/nilai lama baru boleh dihapus setelah minimum melewati semua klien yang masih memakainya.

#### 4.6.9 Store Dexie khusus client (tanpa padanan tabel server)

Store berikut hanya ada di IndexedDB. Seluruhnya berversi (`Dexie.version(n).stores(...)`, NFR-MNT-001); migrasi satu arah; migrasi **wajib juga menaikkan versi payload `outbox_command` tertunda** (BR-SYN-022). Definisi string `stores()` lengkap ada di §6.3.

**Penamaan database dan isolasi tenant (keputusan user 2026-11-18).** Semua tenant dilayani **satu origin**, sehingga IndexedDB/localStorage dipakai bersama; pemisahan dilakukan lewat nama:

| Penyimpanan | Nama | Isi |
|---|---|---|
| Database tenant | `solva-pos:{tenant_id}` (`tenant_id` = UUID, **bukan** slug) | Seluruh store di bagian ini dan §6.3 (`meta`, master, transaksi, `outbox_command`, `local_counter`, …). **Satu database per tenant**, versi skema Dexie sendiri-sendiri. |
| Registry perangkat | `solva-registry` (database terpisah) | Store `tenant_directory`: `tenant_id` (PK), `slug` (`&`), `last_opened_at`. Hanya peta **slug → tenant_id** agar rute `/{slug}/pos` menemukan database yang benar **saat offline**. Tanpa data bisnis, nama tenant, atau kredensial; slug permanen sehingga peta tidak basi. |
| Penanda lain | `solva:{tenant_id}:…` | Kunci `localStorage`/`sessionStorage`, nama **Web Lock** (counter invoice, instance aktif), nama **BroadcastChannel**, dan penanda sejenis. Tidak ada penanda tenant yang tanpa awalan. |

Aturan: (1) **satu perangkat boleh dipakai untuk lebih dari satu tenant** dengan pemisahan penuh — enrollment tiap tenant menghasilkan `device` (dan `device_id`, credential, register) **sendiri**; (2) kode tidak pernah membuka database tenant selain yang ditunjuk `tenant_id` rute dan kredensial aktif, sehingga **tidak ada data tenant yang dibaca lintas tenant**; (3) mencabut tenant dari perangkat = `Dexie.delete('solva-pos:{tenant_id}')` + hapus barisnya di registry + penanda `solva:{tenant_id}:…`; (4) kuota penyimpanan dan `storage.persist()` bersifat **per origin** (dipakai bersama semua tenant di perangkat itu), sehingga `meta.storage.used_pct` mencerminkan origin; (5) slug yang belum ada di registry hanya dapat dipetakan **online** (lewat `resolve_tenant_by_slug`, §4.1.1).

**`outbox_command`** — antrean perintah (outbox hibrida; BR-SYN-020..024/030/051). Primary key `id`.

| Field | Tipe lokal | Keterangan |
|---|---|---|
| `id` | `string` (UUIDv7) | = `command_id` = idempotency key. |
| `type` | `string` | Tipe perintah (Lampiran B). |
| `payload` | `object` | Isi atomik lengkap (mis. `FinalizeSale`: sale, lines, payments, nomor, flag lokal, entri audit tersemat). Uang integer; kuantitas string. |
| `schema_version` | `number` | **Versi kontrak** payload (integer monoton); dimigrasi bersama upgrade Dexie lewat rantai migrator N−1 → N untuk perintah non-`ACKED` (BR-SYN-022). |
| `app_version` | `string` | Tag SemVer aplikasi saat perintah dibuat (mis. `v1.6.2`); tidak berubah walau aplikasi diperbarui kemudian. |
| `device_seq` | `number` | Urutan device-wide (FIFO per register). |
| `register_id` | `string` | — |
| `status` | `'PENDING' \| 'SENDING' \| 'ACKED' \| 'NEEDS_ATTENTION'` | **Sumber kebenaran status sync** dokumen (dicerminkan ke `sale.sync_status` dst.). |
| `entity_type`, `entity_id` | `string` | Dokumen terkait (mis. `sale`, id). |
| `dependency_key` | `string \| null` | Mis. `sale:<id>` atau `bill:<id>`; perintah dengan kunci yang sama diproses berurutan; perintah dependen ditahan hingga induknya `ACKED` (BR-SYN-023). |
| `depends_on` | `string[]` | Daftar `command_id` induk (mis. nota kredit → invoice yang belum terkirim). |
| `attempts` | `number` | Percobaan; **tanpa batas** untuk transien (BR-SYN-024). |
| `next_retry_at` | `string \| null` | Backoff eksponensial 5 dtk → 15 dtk → 1 mnt → 5 mnt (maks). |
| `last_error_class` | `'TRANSIENT' \| 'STRUCTURAL' \| 'AUTHORIZATION' \| 'SCHEMA' \| null` | `SCHEMA` = ditahan karena versi terlalu lama (BR-SYN-003 butir 5; bukan "perlu perhatian"). |
| `last_error_code`, `last_error_ref` | `string \| null` | Kode dari **katalog stabil** (Lampiran A.5; 22 kode tampilan; bukan teks bahasa) dan ID referensi server untuk `KODE#id` publik (BR-LOG-008). Kode tak dikenal klien (kode baru dari server lebih baru) tetap disimpan dan ditampilkan generik beserta `KODE#id`. |
| `created_at`, `sent_at`, `acked_at` | `string` | Waktu terkoreksi. |
| `result` | `object \| null` | Respons ACK (waktu terima, flag, HPP). |

**Perintah serah-terima bill (`HandOverBill`, `AcceptBill`, `CancelBillHandover`) tidak memakai outbox**: dikirim langsung saat online (BR-FNB-012 butir 4; tombol nonaktif bila offline) dan server memutuskan pemegang.

Kebijakan: `PENDING`/`SENDING`/`NEEDS_ATTENTION` **tidak pernah dibuang** (BR-SYN-051, NFR-STOR-003); payload `ACKED` dibersihkan setelah 7 hari (`DIUSULKAN`; menghindari duplikasi ±135 MB), ringkasan tetap hingga dokumen terkait dibersihkan retensi 3 bulan.

**`local_counter`** — counter lokal. PK `key` = `"{register_id}|{doc_type}|{period}"` (mis. `…|INVOICE|1126`) dan `"device_seq"`. Field: `key`, `register_id`, `doc_type` (`INVOICE`/`CREDIT_NOTE`), `period` (`MMYY`), `last_seq` (`number`), `updated_at`. **Dinaikkan di transaksi IndexedDB yang sama dengan penyimpanan dokumen** (BR-INV-004); crash di tengah → rollback → nomor tak terpakai (EC-020). Tab kedua dicegah mengalokasikan nomor (Web Locks, EC-021). Awal counter pada register yang dipulihkan datang dari server (`register_recovery.next_seq`).

**`meta`** — key-value status device. PK `key`. Kunci: `device` (`device_id`, `tenant_id`, `tenant_slug` (salinan baca-saja untuk tampilan), `register_id`, `outlet_id`, credential, `credential_expires_at`) · `cursor` (`{version, id}`) · `snapshot_version` (untuk full resync, FLOW-15) · `full_resync` (`{last_completed_at, retry_after_at}`; **OQ-S36 terjawab 2026-11-19: ditambahkan**; penahan klien setelah `429` — batas full resync **1 per jam per device** dihitung server di memori; tidak dikirim ke server) · `full_resync_stage` (penunjuk resume full resync: `{cycle_id, snapshot_token, snapshot_version, entities, counts, entity_index, after_id, started_at_ms}`; baris halaman yang sudah diunduh disimpan di `pull_stage` sehingga siklus yang terputus dilanjutkan dalam 25 menit tanpa memanggil `pull/full/start` lagi (token snapshot server berlaku 30 menit); `null` saat idle; tidak dikirim ke server) · `clock` (`offset_ms`, `measured_at`, `max_seen_time`) · `last_success_sync_at` + `server_time_at_sync` + basis monotonik (lease 7 hari tahan jam mundur, BR-AUT-013) · `app_version` (build), `schema_version` (kontrak build), `sync_protocol_version`, `dexie_version` (versi skema IndexedDB; **tidak** dikirim) · `min_supported` (`{app_version, schema_version, is_mandatory}` dari respons sync terakhir) · `storage` (`persist`, `used_pct`) · `catalog_cursor` (versi master terkini) · `locale` · **`idle_lock`** (`{timeout_min: 10, locked, locked_staff_id, locked_at}`; kunci layar sisi device saja, **tanpa kolom server**; pengatur waktu berhenti saat pembayaran/dialog PIN supervisor; BR-AUT-015, FLOW-20).

**`device_log`** — antrean log device (BR-LOG-010). Lokal; **bukan** tabel server: server menulis kiriman ini ke **berkas log** ber-`scope: device` (OQ-S18, §7.5). PK `++id` (auto-increment lokal; urutan `id` = urutan tulis, dipakai untuk "tertua").

| Field | Tipe lokal | Keterangan |
|---|---|---|
| `id` | `number` | PK `++id`. |
| `ref_local` | `string` | **ID referensi lokal** `D-YYYYMMDD-HHmmss-xxxxx`: awalan `D-` (khusus perangkat; ID server tanpa awalan, job `job-`) + waktu **terkoreksi offset** (UTC, BR-TIM-005) + 5 karakter acak dari alfabet tanpa `i`,`l`,`o`,`0`,`1` (BR-LOG-005). Unik (`&ref_local`; bila bentrok dibuat ulang). Ditampilkan di layar sebagai `KODE#D-…` agar dapat dicari server lewat `refLocal`. Memenuhi `CHK ^[A-Za-z0-9._-]{1,64}$` kolom `request_ref`. Format dikunci (OQ-S33 terjawab 2026-11-18). |
| `created_at` | `string` | Waktu **terkoreksi** (ISO UTC). |
| `clock_offset_ms` | `number \| null` | Offset yang dipakai saat menulis (bantu menelusuri anomali jam). |
| `level` | `'info' \| 'warn' \| 'error' \| 'fatal'` | Mengikuti level log server (BR-LOG-002). |
| `code` | `string` | **Kode dari katalog stabil** (Lampiran A.5): salah satu dari **22 kode tampilan** (ARCHITECTURE §9.7.1; mis. `APP_ERROR`, `PRINT_FAILED`, `SYNC_HELD`, `STORAGE_LOW`, `PIN_LOCKED`, `DEVICE_REVOKED`, `UPDATE_REQUIRED`) atau kode log non-tampilan (`SYNC_FAILED`, `CLOCK_ANOMALY`, `PERSIST_DENIED`, `UPDATE_ACCEPTED`, `UPDATE_REJECTED`). Format `^[A-Z][A-Z0-9_]{1,39}$`. |
| `route` | `string \| null` | Pola rute tanpa **query dan fragment** (kode pairing berada di fragment, BR-LOG-007). |
| `stack` | `string \| null` | Stack ringkas, dipotong ≤ 2.000 karakter. |
| `ctx` | `object \| null` | Konteks kecil dari **daftar field tertutup** (BR-LOG-006; mis. `commandId`, `httpStatus`, `printJobId`, `attempt`); hasil serialisasi ≤ 1.000 karakter. **Tanpa** PIN, nama/telepon pelanggan, isi keranjang (BR-LOG-007). |
| `app_version`, `schema_version` | `string`, `number` | Versi pembuat entri (§2.5). |
| `device_id`, `register_id` | `string \| null` | Dari `meta.device` saat entri ditulis; `null` bila belum enroll. **Tidak dikirim** dalam badan (server mengambil dari credential). |
| `send_status` | `'PENDING' \| 'SENDING'` | `PENDING` = belum dikirim; `SENDING` = dalam batch berjalan (dikembalikan ke `PENDING` saat boot atau gagal). Yang **sudah diterima server dihapus** (tidak ada status `SENT`). |
| `attempts` | `number` | Jumlah percobaan kirim (diagnostik). |

Aturan: (1) **Antrean terbatas 500 entri**; setelah `add`, bila `count() > 500` entri dengan `id` terkecil dibuang (termasuk yang `SENDING`) — **satu-satunya data lokal yang boleh dibuang tanpa syarat** (BR-LOG-010 butir 1). (2) **Tidak pernah memengaruhi outbox transaksi**: penulisan log memakai transaksi Dexie **terpisah** (atau bersama transaksi finalisasi hanya bila ARCHITECTURE menetapkannya), kegagalannya (kuota penuh, galat) **ditelan** dan tidak menggagalkan penjualan; `outbox_command` tidak pernah dibuang demi log. (3) Pengiriman bersama siklus sync: **≤ 100 entri `PENDING` terlama per siklus** dan ≤ 20 laporan/10 menit/device; sukses 2xx → entri dihapus; 429/5xx/jaringan → kembali `PENDING`; pengiriman log **tidak memblokir** sync transaksi dan kegagalannya **bukan** "perlu perhatian". (4) Indeks: `[send_status+id]` (ambil batch terlama), `&ref_local` (cari/dedup). Pembuangan tertua memakai urutan PK. (5) Payload `POST /device-log`: §6.2.1. (6) Mengubah indeks = kenaikan versi Dexie; migrasi **mengosongkan** `device_log` (diagnostik, aman).

**`stock_snapshot`** — snapshot saldo stok untuk POS (BR-SYN-010 butir 8, BR-STK-005). PK `sku_id` (per outlet device). Field: `sku_id`, `qty` (string), `inventory_value` (opsional; hanya untuk role berizin), `effective_available` (boolean turunan). Disertai satu rekaman di `meta` `stock_snapshot_meta` = `{as_of_server_time, acked_device_seq}`. **Estimasi lokal** = `snapshot.qty − Σ penjualan lokal dengan device_seq > acked_device_seq` (informasional; ≤ 0 → peringatan non-blokir, penjualan tetap boleh).

**`bill_snapshot`** — snapshot open bill outlet milik **device lain** (read-only, FR-SYN-016). PK `bill_id`. Field: `bill_id`, `table_id`, `bill_ref`, `status`, `lease_device_id`, `lease_register_id`, `is_awaiting_payment`, `handover_status`, `handover_target_register_id` (bill masuk), `items` (array ringkas), `last_event_at` ("terakhir diperbarui"). Diganti utuh tiap pull; tidak pernah diedit lokal.

**`cart_draft`** — draf keranjang **dan** draf pengeditan bill, disimpan lokal agar **pulih setelah kunci layar otomatis, muat ulang, atau crash render** (BR-AUT-015 butir 2; ARCHITECTURE §3.1: Dexie sumber kebenaran saat boot). Lokal saja, **tidak pernah disinkron**, ada di database per tenant seperti store lain (§4.6.9). PK `id` (UUIDv7).

| Field | Tipe lokal | Keterangan |
|---|---|---|
| `id` | `string` | PK UUIDv7. |
| `kind` | `'CART' \| 'BILL'` | `CART` = keranjang penjualan retail/kasir; `BILL` = draf pengeditan open bill F&B (belum menjadi event). |
| `register_id`, `staff_id` | `string` | Register dan pemilik (staf yang menyusun). |
| `bill_id` | `string \| null` | Hanya `BILL` yang mengedit bill terbuka. |
| `bill_key` | `string` | Kunci turunan `bill_id ?? ''` (IndexedDB tidak mengindeks `null`). |
| `base_content_seq` | `number \| null` | `bill.last_content_seq` saat draf dibuka; bila snapshot bill sudah maju saat pemulihan, UI meminta pemilik memeriksa draf. |
| `table_id` | `string \| null` | Meja (F&B). |
| `lines` | `object[]` | Item mentah: `sku_id`, `uom_id`, `qty` (string), harga snapshot, diskon, modifier. |
| `customer_name`, `customer_phone`, `bill_discount` | opsional | Seperti keranjang; **tidak pernah ditulis ke log** (BR-LOG-007). |
| `status` | `'ACTIVE' \| 'DISCARDED'` | — |
| `created_at`, `updated_at` | `string` | Waktu terkoreksi. |

**Kunci/indeks (`stores()`):** `'id, [register_id+staff_id+status], bill_key, status'`. Pemulihan saat boot: `where('[register_id+staff_id+status]').equals([register, staf, 'ACTIVE'])`; draf bill tertentu: `where('bill_key').equals(bill_id)`.

**Penulisan:** *tulis-susul* ke Dexie setelah tiap perubahan keranjang (debounce pendek) dan pada `visibilitychange`/`pagehide`; hanya instance aktif yang menulis (multi-tab). Bukan dokumen (belum bernomor, tanpa efek keuangan) dan **bukan** sumber `outbox_command`.

**Dibuang** (`DISCARDED`/hapus): (a) dipakai menjadi penjualan/disimpan sebagai event bill — dihapus **dalam transaksi finalisasi yang sama** (ARCHITECTURE §3.3 langkah 6); (b) shift staf ditutup oleh override supervisor — draf `DISCARDED` dan jumlahnya dicatat di audit override (BR-AUT-015 butir 4–5); (c) dibuang manual; (d) draf `BILL` yang bill-nya sudah `PAID`/`CANCELED`/`MERGED` atau tidak lagi dipegang device ini. **Tidak dibuang** saat **kunci layar** otomatis atau pindah staf biasa (draf milik `staff_id`); **tidak dibuang** oleh full resync atau upgrade Dexie (NFR-STOR-003). Baris `DISCARDED` dibersihkan pada pemeliharaan lokal berikutnya (`DIUSULKAN`). Bentuk penyimpanan dikunci pada OQ-S22 (terjawab); perluasan `kind`/`bill_key` mengikuti keputusan error management 2026-11-18; migrasi mengisi `kind='CART'`, `bill_id=null`, `bill_key=''` pada baris lama.

**`print_job`** — antrean cetak (BR-PRN-002). PK `id` (UUIDv7). Field: `kind` (`RECEIPT`/`REPRINT`/`PREBILL`/`SHIFT_RECAP`/`CASH_DRAWER`/`TEST`), `entity_type`, `entity_id`, `receipt_locale` (snapshot dari dokumen), `status` (`QUEUED`/`PRINTING`/`DONE`/`FAILED`), `attempts`, `last_error_code`, `created_at`, `printed_at`. Isi ESC/POS dibangun **saat dicetak** dari dokumen tersimpan (tidak disimpan sebagai byte). **Kegagalan cetak tidak menggagalkan penjualan** (AP-10). **Tidak** disinkron ke server (diagnostik lewat `device_log`).

**`asset_cache`** — logo bitmap hasil unduhan (BR-PRN-003). PK `key` (`logo:{outlet_id}`). Field: `key`, `sha256`, `bitmap` (`Blob`/`Uint8Array` raster ESC/POS), `updated_at`.

#### 4.6.10 `feature_flag` — feature flag per tenant (master turun)

Keputusan user 2026-11-18: feature flag **per tenant**, ikut master data (counter versi `tenant_sync`, tombstone), diunduh ke Dexie, **nilai terakhir dipakai saat offline**; hanya **Owner** yang mengubah lewat back-office, POS **baca-saja**; **nilai bawaan tiap flag ada di kode**, bukan di tabel. Karena itu tabel hanya menyimpan **override eksplisit**: tidak ada baris = pakai default kode; baris di-tombstone = kembali ke default. Kelas **M**. Mewarisi `STD-M`. Lokasi: server + Dexie **↓ penuh** (seluruh baris tenant; jumlah kecil). Rujukan: BR-SYN-010 (feed), BR-AUT-009 (hak akses), BR-AUD-001.

| Kolom | Tipe PG | TS / Lokal | Constraint | Keterangan |
|---|---|---|---|---|
| *(STD-M)* | | | | |
| `flag_key` | `text` | `string` | NN, CHK `^[a-z][a-z0-9_.]{2,63}$` | Kunci flag; **katalog kunci hidup di kode** (modul `contracts`). Kunci yang tidak dikenal kode diabaikan di client dan ditolak di API admin; tabel tidak memakai `CHECK IN (...)` agar kunci baru tidak membutuhkan migrasi. |
| `enabled` | `boolean` | `boolean` | NN | Nilai override. Flag dievaluasi `override?.enabled ?? DEFAULT_KODE[flag_key]`. |
| `params` | `jsonb` | `object \| null` | NULL, CHK `jsonb_typeof(params) = 'object'` | Parameter opsional (mis. ambang). Dipertahankan (OQ-S26 terjawab 2026-11-19: boolean + `params` opsional). |
| `note` | `text` | `string \| null` | NULL, CHK ≤ 200 | Catatan pemilik (alasan perubahan). |

Constraint tabel: **`UQ (tenant_id, flag_key)` penuh** (mengubah nilai = `UPDATE` baris; "kembali ke default" = tombstone; mengaktifkan lagi = hidupkan kembali baris, sehingga feed tetap satu baris per kunci). Indeks feed `(tenant_id, version, id)`.

Aturan:
1. **Hanya Owner menulis**: permission `flag.manage` (bawaan Owner; `/admin` saja). Perubahan melalui fungsi Sync (satu pintu, BR-ARC-006) dan tercatat `audit_log` aksi `feature_flag.changed` (flag, nilai lama/baru, aktor). Device **tidak pernah** menulis tabel ini (arah turun saja, AP-04).
2. **RLS** standar tenant (§5.6): `tenant_id = current_setting('app.tenant_id')`; peran aplikasi diberi `INSERT/UPDATE` hanya lewat jalur admin ber-permission `flag.manage`.
3. **Offline:** Dexie `feature_flag` menyimpan nilai terakhir; flag yang tidak ada di Dexie memakai default kode. Perubahan baru diterapkan setelah **seluruh siklus pull** selesai (pola BR-CAT-014), tidak di tengah halaman.
4. **Bukan pengganti `schema_version`**: flag mengatur perilaku/UX, **bukan** bentuk data; perubahan format perintah/event tetap lewat kenaikan `schema_version` (§2.5). Server tidak mengevaluasi ulang flag saat memproses perintah (fakta tidak ditolak, AP-02).
5. **Cakupan per tenant saja** (OQ-S26 terjawab 2026-11-19); per outlet dicatat sebagai opsi di Bab 9.

---
## 5. Strategi Indexing, Constraint, Optimasi, Partisi, dan RLS

### 5.1 Prinsip indeks

1. **Setiap indeks di PostgreSQL diawali `tenant_id`** (kecuali PK/UQ global) agar plan RLS (`tenant_id = $t`) memakai awalan indeks yang sama.
2. **Indeks mengikuti jalur baca nyata**: (a) delta sync (pull), (b) operasional harian per outlet/tanggal, (c) pencarian dokumen (nomor invoice, barcode, SKU), (d) laporan R-01..R-04, (e) lock/kontrol (parsial).
3. **Kolom yang sering di-UPDATE (`updated_at`, saldo) tidak diindeks** kecuali perlu, agar update tetap *HOT* (heap-only tuple); lihat §5.9.
4. Tabel besar yang append-only mendapat **BRIN** pada kolom waktu sebagai pelengkap murah (ordering fisik ≈ ordering waktu).
5. Pola paginasi: **keyset** (`WHERE (version,id) > ($v,$id) ORDER BY version,id LIMIT 500`), bukan `OFFSET` (BR-SYN-010 butir 5).

### 5.2 Daftar indeks utama

#### 5.2.1 Delta sync (pull master) — `(tenant_id, version, id)`

Setiap tabel kelas **M** memiliki indeks `ix_<tabel>__feed (tenant_id, version, id)`. Untuk tabel yang terfilter outlet, indeks dipecah menurut ruang filter:

| Tabel | Indeks feed | Alasan |
|---|---|---|
| `legal_entity`, `category`, `uom`, `product`, `sku`, `sku_uom`, `payment_method`, `role`, `role_permission`, `feature_flag`, `modifier_group`, `modifier_group_product`, `modifier` | `(tenant_id, version, id)` | Seluruh baris tenant ikut ke semua device. |
| `tenant` | PK `(id)` + `(id, version)` | Satu baris per tenant; dikirim bila `version` > cursor. |
| `outlet`, `outlet_receipt_setting`, `fnb_table`, `item_outlet_availability` | `(tenant_id, outlet_id, version, id)` | Filter `outlet_id = $outlet_device`; dua cabang tidak diperlukan karena `outlet_id` NOT NULL. |
| `price_entry`, `tax_rate_history` | `(tenant_id, outlet_id, version, id)` **dan** parsial `(tenant_id, version, id) WHERE outlet_id IS NULL` | `outlet_id` NULL = harga/tarif default tenant → dua cabang: outlet device + default. |
| `user_outlet` | `(tenant_id, outlet_id, version, id)` | `outlet_id` NULL (tenant-wide) ikut seluruh device: ditambah parsial `WHERE outlet_id IS NULL`. |
| `app_user` | `(tenant_id, version, id)` | Difilter di query lewat join `user_outlet`; jumlah kecil. |
| `staff_pin` | `(tenant_id, device_id, version, id)` | Filter per device. |
| `cash_master` | `(tenant_id, id)` (PK) + `(tenant_id, outlet_id, version, id)` | Seluruh register outlet device (OQ-S23). |
| `register_invoice_prefix` | `(tenant_id, register_id, version, id)` + `(tenant_id, invoice_prefix)` (validasi keunikan) | Device hanya menerima prefiks register-nya sendiri. |

**Pull lintas tabel dengan satu cursor `(version, id)`.** `id` UUIDv7 unik lintas tabel, sehingga satu cursor cukup. Server membangun halaman berikutnya dengan `UNION ALL` ringkas lalu mengambil baris lengkap per tabel:

```sql
-- ilustrasi: ambil 500 kunci berikutnya lintas tabel master (urut version, id)
SELECT entity, id, version FROM (
  (SELECT 'product'::text AS entity, id, version FROM product
     WHERE tenant_id = $t AND (version, id) > ($v, $id) ORDER BY version, id LIMIT 500)
  UNION ALL
  (SELECT 'sku', id, version FROM sku
     WHERE tenant_id = $t AND (version, id) > ($v, $id) ORDER BY version, id LIMIT 500)
  UNION ALL
  (SELECT 'price_entry', id, version FROM price_entry
     WHERE tenant_id = $t AND (version, id) > ($v, $id)
       AND (outlet_id = $outlet OR outlet_id IS NULL) ORDER BY version, id LIMIT 500)
  -- … tabel M lainnya
) k ORDER BY version, id LIMIT 500;
-- lalu per entity: SELECT * FROM <tabel> WHERE id = ANY($ids)  (termasuk baris tombstone, deleted_at != NULL)
```

Halaman memuat baris **termasuk tombstone**; device men-upsert/menghapus dalam satu transaksi Dexie per halaman, lalu memajukan cursor **setelah** halaman tersimpan (FLOW-15 langkah 4). Alternatif tabel perubahan terpusat (`sync_change(entity,id,version)`) **tidak dipilih** (menambah satu penulisan per baris master; tidak diperlukan pada skala ini); dapat ditambahkan tanpa mengubah kontrak.

#### 5.2.2 Operasional harian per outlet / tanggal bisnis

| Tabel | Indeks | Dipakai untuk |
|---|---|---|
| `sale` | `UQ (tenant_id, invoice_no)` · `UQ (register_id, invoice_period, invoice_seq, invoice_conflict_idx)` · `(tenant_id, outlet_id, business_date) INCLUDE (status, total_due)` · `(shift_id)` · `UQ (bill_id) WHERE bill_id IS NOT NULL` · `(tenant_id, received_at)` | Cari nomor, integritas seri, R-01 per hari/outlet, rekap shift, rujukan bill, "terima terbaru". |
| `sale_line` | `UQ (sale_id, line_no)` · `(tenant_id, outlet_id, business_date, sku_id)` · `(sku_id, tenant_id)` | Isi invoice, laporan per item, penelusuran SKU. |
| `sale_payment` | `UQ (sale_id, seq)` · `(shift_id, method_kind) INCLUDE (amount_applied)` · `(tenant_id, outlet_id, business_date, method_id)` | `kas_diharapkan` (agregat tunai per shift), rekap per metode R-01/R-03. |
| `credit_note` | `UQ (tenant_id, cn_no)` · `UQ (register_id, cn_period, cn_seq, cn_conflict_idx)` · `(original_sale_id)` · `(tenant_id, outlet_id, business_date)` | Retur per invoice, R-01 neto. |
| `credit_note_line` | `(sale_line_id)` INCLUDE (`qty_returned`) · `UQ (credit_note_id, line_no)` | **Kumulatif retur ≤ qty baris** (BR-RTR-009). |
| `cash_cashier` | `UQ (register_id) WHERE status='OPEN'` · `(tenant_id, outlet_id, business_date)` · `(register_id, occurred_at DESC)` | Satu shift terbuka, R-03. |
| `cash_movement` | `(shift_id)` INCLUDE (`direction`, `amount`) | Agregat kas masuk/keluar. |
| `sku_uom` | `UQ (tenant_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL` · `UQ (sku_id, uom_id)` | **Lookup barcode** (server; client memakai indeks Dexie setara), harga per UOM. |
| `sku` | `UQ (tenant_id, sku_code) WHERE deleted_at IS NULL` · `(product_id)` | Kode SKU, daftar varian. |
| `price_entry` | `UQ NULLS NOT DISTINCT (tenant_id, sku_id, uom_id, outlet_id)` | Harga per (SKU, UOM, outlet) + fallback default. |
| `tax_rate_history` | `UQ NULLS NOT DISTINCT (tenant_id, tax_code, outlet_id, effective_from)` | Pemilihan tarif menurut `business_date` (khusus outlet lalu default tenant). |
| `item_outlet_availability` | `UQ NULLS NOT DISTINCT (outlet_id, product_id, sku_id)` · `(tenant_id, outlet_id, status)` | Status efektif per outlet; laporan R-02 ketersediaan. |
| `stock_balance` | PK `(outlet_id, sku_id)` · parsial `(tenant_id, outlet_id) WHERE qty < 0` | Row lock; laporan stok minus. |
| `stock_movement` | `UQ (outlet_id, sku_id, bal_seq)` · `UQ (tenant_id, source_type, source_id, sku_id, movement_type)` · `(tenant_id, outlet_id, business_date)` · BRIN `(processed_at)` | Kartu stok per SKU, idempotensi movement, laporan harian. |
| `transfer` | parsial `(tenant_id, from_outlet_id) WHERE status='SENT'` dan `(tenant_id, to_outlet_id) WHERE status='SENT'` | **In-transit** per outlet. |
| `goods_receipt`, `stocktake` | `(tenant_id, outlet_id, business_date)` · `UQ (tenant_id, doc_no)` | Daftar dokumen. |
| `bill` | `(tenant_id, outlet_id, table_id) WHERE status='OPEN'` · `(tenant_id, outlet_id, bill_ref)` · `(lease_device_id) WHERE status='OPEN'` · `(tenant_id, lease_register_id) WHERE status='OPEN'` · `(tenant_id, handover_target_register_id) WHERE handover_status='PENDING'` (**"bill masuk"**) · `(parent_bill_id)` · `(merged_into_bill_id)` | Meja terisi, bill ganda/yatim, snapshot open bill. |
| `bill_event` | `UQ (bill_id, bill_seq)` · `UQ (device_id, device_seq)` · BRIN `(received_at)` | Urutan event per bill; idempotensi per device. |
| `invoice_series` | PK `(register_id, doc_type, period)` | Nomor tertinggi (row lock). |
| `invoice_gap` | `EXCLUDE (…int4range…)` · `(tenant_id, status) WHERE status='OPEN'` | Gap aktif, daftar anotasi. |
| `idempotency_command` | PK `(command_id)` · `UQ (device_id, device_seq)` · `(tenant_id, received_at)` · `(tenant_id, status) WHERE status='ATTENTION'` | Replay idempoten, FIFO, daftar masalah. |
| `attention_item` | parsial `(tenant_id, outlet_id, created_at) WHERE status IN ('OPEN','ESCALATED')` | Layar "perlu perhatian". |
| `data_flag` | `UQ (tenant_id, entity_type, entity_id, flag_code)` · `(tenant_id, outlet_id, business_date, flag_code)` | R-04. |
| `audit_log` | `UQ (tenant_id, chain_seq)` · `(tenant_id, recorded_at)` · `(tenant_id, entity_type, entity_id)` · `(tenant_id, actor_user_id, recorded_at)` · BRIN `(recorded_at)` | Penampil audit (filter aktor/aksi/tanggal), verifikasi rantai. |
| `device` | `UQ (register_id) WHERE revoked_at IS NULL` · `UQ (credential_hash)` | Maks. 1 device aktif/register; autentikasi credential. |
| `pairing_code` | `UQ (code_hash)` · `(expires_at)` | Validasi satu kali. |
| `member_code` | `UQ (code_hash)` · `UQ (app_user_id, kind) WHERE used_at IS NULL AND revoked_at IS NULL` · `(app_user_id, kind, created_at DESC)` · `(expires_at)` | Penukaran atomik satu kali; satu kode aktif per profil dan jenis; kode terbaru per profil untuk daftar "Undangan tertunda"; pembersihan. |
| `app_user` | `UQ (tenant_id, auth_user_id) WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL` · `UQ (tenant_id, display_name) WHERE deleted_at IS NULL AND is_active` · `(auth_user_id) WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL` (non-unik, hitung keanggotaan lintas tenant) | Keanggotaan per tenant ke identitas global; **email unik se-sistem ada di `user` Better Auth**, bukan di `app_user`; tidak ada `UQ` global pada `auth_user_id`. |

#### 5.2.3 Indeks pencarian (client Dexie)

Dexie tidak memiliki pencarian teks penuh; indeks lokal ditentukan di §6.3 (barcode unik, `search_tokens` multiEntry, `[outlet+tanggal]`, `[status+device_seq]`, …) untuk memenuhi NFR-PERF-003 (barcode ≤ 50 ms, nama ≤ 150 ms p95 pada 5.000 SKU).

### 5.3 Unique constraint & pola `deleted_at IS NULL`

| Pola | Tabel | Alasan |
|---|---|---|
| **Unik parsial** `WHERE deleted_at IS NULL` | `category(name)`, `uom(code)`, `product(code)`, `sku(sku_code)`, `sku_uom(barcode)`, `payment_method(code)`, `role(code)`, `app_user(tenant_id, auth_user_id)`, `legal_entity(npwp)`, `fnb_table(outlet,code)`, `modifier(group,name)`, `recipe_item(menu,ingredient)`, `modifier_ingredient`, `supplier(name)` | Nama/kode dapat dipakai ulang oleh baris baru setelah yang lama di-tombstone. |
| **Unik penuh + hidupkan kembali** | `sku_uom(sku_id,uom_id)`, `price_entry(sku,uom,outlet)`, `item_outlet_availability(outlet,product,sku)`, `role_permission`, `modifier_group_product`, `staff_pin(user,device)`, `tax_rate_history(tax_code,outlet,effective_from)`, `feature_flag(flag_key)`, `register_invoice_prefix(register,effective_month)` | Kunci bermakna tunggal dan/atau dirujuk FK komposit; sisipan ulang = `deleted_at := NULL` dan `version` baru (tetap satu baris → feed konsisten). |
| **Unik penuh tanpa soft delete** | `outlet(tenant,code)`, `cash_master(outlet,code)`, `sale(tenant,invoice_no)`, `credit_note(tenant,cn_no)` | Kode/nomor bermakna historis, tidak dipakai ulang. |
| **Unik parsial kondisi status** | `cash_cashier(register) WHERE status='OPEN'`, `device(register) WHERE revoked_at IS NULL`, `payment_method(tenant) WHERE kind='CASH'`, `sku(product) WHERE is_default`, `sale(bill_id)` | Aturan "maksimal satu yang aktif". |
| **Unik + `NULLS NOT DISTINCT`** (PG ≥ 15) | `price_entry`, `tax_rate_history`, `item_outlet_availability`, `user_outlet`, `category(parent,name)` | `NULL` pada `outlet_id`/`sku_id`/`parent_id` diperlakukan sebagai satu nilai → tepat satu baris default/produk/akar. |

### 5.4 Constraint, CHECK, trigger, kunci

#### 5.4.1 Jenis constraint yang dipakai

| Jenis | Dipakai untuk | Tidak dipakai untuk |
|---|---|---|
| `NOT NULL`, `DEFAULT` | Semua kolom wajib; default aman (`0`, `false`) | — |
| `CHECK` domain | Tanda nilai (`>= 0`, `> 0`), rentang persen 0..100, enum teks, pola NULL (mis. `CASH` ⇔ `cash_tendered NOT NULL`), pola format kode (`^[A-Z0-9]{1,10}$`), konsistensi tombstone/status (mis. `VOID` ⇒ kolom void terisi), `qty = trunc(qty,4)` pada ledger | **Identitas aritmetika bisnis** (`G = S2+SC+pajak`, Σ alokasi, Σ pembayaran) dan **aturan bisnis yang memakai data lain** (jendela retur, batas diskon, ketersediaan) — alasan: AP-02/DB-02, ini diverifikasi Kernel + flag (§4.5 prinsip 2) |
| `UNIQUE` / `EXCLUDE` | Keutuhan seri nomor, idempotensi, keunikan natural key, gap tak tumpang tindih | — |
| `FOREIGN KEY` komposit `(tenant_id, x_id)` | Semua referensi antar tabel bertenant (§1.8); `ON DELETE NO ACTION` (tidak ada hapus fisik pada baris yang dirujuk) | Referensi sumber ledger (`source_id`), `device`/`command` pada log yang bertahan lebih lama — memakai kolom biasa atau FK tanpa cascade |
| Trigger | Kasus **lintas baris/tabel yang tak dapat `CHECK`**: lihat §5.4.2 | Perhitungan bisnis (di Kernel) |

#### 5.4.2 Trigger / validasi lintas baris

| Aturan | Tempat | Mekanisme |
|---|---|---|
| Kategori maksimal 2 tingkat | `category` | trigger `BEFORE INSERT/UPDATE` |
| Maks. 3 atribut / 100 SKU aktif per produk | `product_attribute`, `sku` | trigger (parameter dari konfigurasi) |
| Produk tanpa varian = tepat satu SKU `is_default` | `sku` | trigger `CONSTRAINT … DEFERRABLE INITIALLY DEFERRED` |
| `sku_uom` base: `uom_id = product.base_uom_id`, `is_base` ⇒ faktor 1 | `sku_uom` | trigger |
| Resep satu level | `recipe_item` | trigger |
| `base_uom_id` produk tak dapat diubah setelah ada `stock_movement`/`sale_line` | `product` | trigger |
| Kode outlet/register tak dapat diubah setelah ada transaksi (kehati-hatian; kode tidak lagi membentuk nomor) | `outlet`, `cash_master` | trigger `BEFORE UPDATE OF code` |
| Profil `PPN` hanya bila entitas hukum PKP | `outlet` | trigger |
| Prefiks invoice **unik per tenant** (tidak dipakai register lain, termasuk riwayat); wajib untuk register `CASHIER`; baris baru berlaku bulan berikutnya | `register_invoice_prefix` | trigger + validasi aplikasi |
| `bill.lease_device_id` / `lease_register_id` hanya berubah lewat `BILL_ACCEPTED` (serah-terima, BR-FNB-012); tidak ada jalur lain | `bill` | trigger `BEFORE UPDATE OF lease_device_id, lease_register_id` yang menolak kecuali dipanggil dari fungsi pemroses `BILL_ACCEPTED` (mis. `SECURITY DEFINER` + hak `UPDATE` kolom itu hanya untuk fungsi tersebut) |
| `cash_master.register_type` tak dapat diubah selama ada shift `OPEN` / bill `OPEN` pada register itu | `cash_master` | trigger `BEFORE UPDATE OF register_type` (`DIUSULKAN` PRD, FR-DEV-006) |
| Register `WAITER` tidak membuat shift/penjualan/kas/nota kredit | `cash_cashier`, `sale`, `cash_movement`, `credit_note` | **validasi pemrosesan perintah** (otorisasi ⇒ `attention_item`), bukan trigger |
| Ledger/audit/event tak dapat diubah/dihapus | `stock_movement`, `audit_log`, `bill_event`, `idempotency_command.payload_hash` | trigger `BEFORE UPDATE OR DELETE` (§5.5) |
| Anak transaksi mewarisi `tenant_id` induk | semua TC | FK komposit (§1.8) |
| Kumulatif retur ≤ qty baris; retur invoice `VOID` dilarang | `credit_note_line` | **validasi pemrosesan perintah** (struktural ⇒ `attention_item`), bukan trigger |

#### 5.4.3 Urutan penguncian (mencegah deadlock) dalam transaksi pemrosesan

Setiap perintah bisnis mengunci sumber daya **dalam urutan tetap** (konsisten, sehingga dua transaksi tidak saling tunggu melingkar):

1. `idempotency_command` (insert; `ON CONFLICT` → baca hasil lama).
2. `bill` (F&B; satu baris, `SELECT … FOR UPDATE`) untuk `FinalizeSale` ber-`bill_id`, `AppendBillEvents`, dan perintah serah-terima (`HandOverBill`, `AcceptBill`, `CancelBillHandover`). Ini yang **menyerialkan penerimaan vs pembatalan vs pembayaran**: pemenang = commit pertama, yang kalah ditolak (BR-FNB-012 butir 3, EC-061).
3. `invoice_series` per register (satu baris).
4. `stock_balance`: seluruh baris yang akan disentuh **diurutkan `(outlet_id, sku_id)` ASC** dan dikunci sekaligus (`SELECT … FOR UPDATE ORDER BY …`). Bahan resep diurutkan menurut `sku_id` (deterministik, BR-RCP-003).
5. Tulis `sale`, `sale_line`, `sale_payment`, `stock_movement`, `data_flag` (tanpa lock tambahan).
6. `audit_chain_head` **terakhir** (lock tersingkat, §4.6.6) lalu `audit_log`.
7. COMMIT.

Penulisan master memakai urutan berbeda tetapi terpisah: `tenant_sync` → baris master → `audit_chain_head`. `tenant_sync` dan `stock_balance` tidak pernah dikunci dalam transaksi yang sama (master dan transaksi saling terpisah), sehingga tidak ada siklus.

#### 5.4.4 Constraint untuk keutuhan seri invoice per register (ringkasan)

| Lapisan | Mekanisme | Menjamin |
|---|---|---|
| Client | `local_counter` dinaikkan dalam **satu transaksi IndexedDB** dengan dokumen; Web Locks satu instance `/pos` | Tanpa celah di device; tanpa nomor hangus saat crash (BR-INV-004, EC-020/021) |
| Server | `UQ (register_id, invoice_period, invoice_seq, invoice_conflict_idx)` + `UQ (tenant_id, invoice_no)` | Tak ada dua dokumen dengan nomor sama (BR-INV-003) |
| Server | `invoice_series.max_seq_received` + `invoice_gap` (`EXCLUDE`) | Deteksi dan audit celah (BR-INV-006/007) |
| Server | Konflik nomor ⇒ diterima, `invoice_conflict_idx ≥ 1` (`-Dn`), flag `NOMOR_KONFLIK`, `attention_item` | Fakta tidak ditolak (BR-INV-009, AP-02) |
| Server | `register_recovery.next_seq` | Pemulihan tanpa tabrakan (BR-INV-008) |

### 5.5 Append-only, immutability, dan hak akses

**Peran database** (konseptual; `DIUSULKAN`):

| Peran | Hak | Dipakai oleh |
|---|---|---|
| `solva_owner` | Pemilik objek; DDL/migrasi | Proses migrasi saja (bukan aplikasi) |
| `solva_app` | `NOLOGIN`-grup; `SELECT/INSERT/UPDATE/DELETE` terbatas per tabel; **`NOBYPASSRLS`** | Aplikasi (`/admin`, `/pos` API) |
| `solva_report` | `SELECT` pada view/read model | Modul Laporan (opsional, BR-ARC-007) |

```sql
-- Tabel append-only (stock_movement, audit_log, bill_event): hanya tulis-baca
REVOKE ALL ON audit_log FROM solva_app;
GRANT SELECT, INSERT ON audit_log TO solva_app;           -- tak ada UPDATE/DELETE/TRUNCATE
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();         -- pertahanan berlapis (pemilik tabel pun gagal)

-- Dokumen transaksi: hanya kolom hasil server yang dapat diubah
GRANT SELECT, INSERT ON sale TO solva_app;
GRANT UPDATE (status, voided_at, voided_by, void_approved_by, void_reason_code,
              void_reason_text, void_command_id, cost_total) ON sale TO solva_app;
GRANT UPDATE (cost_snapshot) ON sale_line TO solva_app;
```

Hak `DELETE` hanya diberikan pada tabel yang sah dihapus fisik (mis. `pairing_code` dan `member_code` kedaluwarsa, `item_outlet_availability` tak terreferensi setelah `tombstone_floor`).

### 5.6 Row Level Security (konseptual)

`DISEPAKATI` (BR-TNT-001, NFR-SEC-002, FR-TNT-004).

1. **Pengaktifan**: setiap tabel bertenant `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;` (FORCE agar pemilik tabel pun tunduk).
2. **Konteks**: pada awal **setiap transaksi** lapisan akses data menjalankan `SELECT set_config('app.tenant_id', $tenant, true)` (`SET LOCAL`, hanya berlaku di transaksi itu; aman terhadap connection pooling mode transaksi). Nilai `app.tenant_id` datang dari **kredensial terotentikasi**: sesi Better Auth → organisasi → `tenant` (untuk `/admin`); `device.credential_hash` → `tenant_id` (untuk endpoint `/pos`). **Tidak pernah** dari body request.
3. **Kebijakan** (satu pola, diulang per tabel):

```sql
CREATE POLICY tenant_isolation ON price_entry
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- tabel tenant: id = current_setting('app.tenant_id')::uuid
-- audit_log / stock_movement / bill_event: kebijakan terpisah SELECT dan INSERT saja (tanpa UPDATE/DELETE)
```

   Bila `app.tenant_id` tak terisi, `current_setting(..., true)` mengembalikan `NULL` → predikat tak terpenuhi → **nol baris** (aman secara bawaan).
4. **Tabel global** (`permission`, `app_release`): tanpa RLS; `SELECT` saja bagi `solva_app`.
5. **Tabel Better Auth**: di luar RLS tenant; relasi ke tenant lewat `tenant.auth_org_id` (organisasi BA = tenant) dan `app_user.auth_user_id`; akses data aplikasi tetap melewati `app_user` bertenant. **Identitas back-office global (satu email = satu akun)**; keanggotaan per tenant = `app_user` (sumber kebenaran) + `member` BA (cermin). Sesi BA **global per origin**, sehingga isolasi tenant ditegakkan oleh **penjaga keanggotaan** (tenant slug harus punya `app_user` `ACTIVE` untuk pengguna sesi) dan RLS, bukan oleh pemisahan sesi. Fungsi `auth_account_membership_count(auth_user_id)` (`SECURITY DEFINER`, hanya mengembalikan jumlah) menjadi satu-satunya akses lintas-tenant ke `app_user` (§4.1.8). Uji: pengguna anggota tenant A saja tidak dapat masuk `/B/admin` walau sesinya valid; pemanggilan fungsi tidak membocorkan kolom/baris tenant lain.
6. **FK dan RLS**: pemeriksaan FK tidak tunduk RLS → FK komposit (§1.8) mencegah rujukan lintas tenant akibat bug.
7. **Operator platform**: tidak ada peran `BYPASSRLS` bagi aplikasi. Tugas lintas tenant (mis. pembersih tombstone, penghitung ukuran) dijalankan per-tenant dengan konteks tenant, atau lewat peran terpisah yang tidak dipakai jalur request.
8. **Pembatasan per outlet** (Manager hanya outlet yang ditugaskan) di lapisan aplikasi (§1.8 butir 5). Penguatan opsional: kebijakan RLS kedua `outlet_id = ANY(string_to_array(current_setting('app.outlet_ids', true), ',')::uuid[])` untuk tabel berkolom `outlet_id` — **tidak** diwajibkan PRD, dicatat sebagai opsi.
9. **Pengujian** (FR-TNT-004, F1 kriteria 1): uji otomatis — sebagai tenant A, kueri/penulisan terhadap setiap tabel bertenant menghasilkan **0 baris tenant B terbaca/tertulis**; uji tambahan: setiap tabel bertenant **harus** punya `FORCE RLS` dan kebijakan (pemeriksaan katalog pg).
10. **Pencarian tenant lewat slug (sebelum konteks tenant ada)**: fungsi `resolve_tenant_by_slug(text)` `SECURITY DEFINER` yang hanya mengembalikan `(id, status)` (§4.1.1 butir 7); satu-satunya akses lintas-baris ke `tenant` bagi peran aplikasi, tanpa `BYPASSRLS`. Uji: pemanggilan dengan slug tenant lain tidak membocorkan kolom lain; slug tak dikenal → nol baris.

### 5.7 Partisi bulanan opsional (retensi server belum diputuskan)

`DISEPAKATI` sebagian (NFR-DATA-001, OQ-03: **simpan semua untuk MVP; skema siap partisi**). **Tidak ada tabel dipartisi di MVP.**

| Tabel | Kunci partisi (siap) | Catatan kesiapan |
|---|---|---|
| `stock_movement` | `processed_at` (atau `business_date`) bulanan | **Kandidat utama** (volume terbesar). PK dan `UQ` lintas partisi harus memuat kunci partisi: `UQ (outlet_id, sku_id, bal_seq)` menjadi `UQ (outlet_id, sku_id, bal_seq, processed_at)` atau penjagaan di aplikasi (row lock `stock_balance.rev` sudah menjamin). Tidak ada FK **menuju** `stock_movement` (referensi `reverses_movement_id`/`source_id` bersifat logis) → aman. |
| `audit_log` | `recorded_at` bulanan | Tidak ada FK menuju; `UQ (tenant_id, chain_seq)` → perlu memuat `recorded_at` (rantai tetap utuh karena berurut). |
| `bill_event` | `received_at` bulanan | FK menuju `bill` (induk), bukan sebaliknya. `UQ (bill_id, bill_seq)` → tambah kunci partisi. |
| `idempotency_command` | `received_at` | **Bermasalah**: `command_id` harus unik global untuk idempotensi → partisi tidak diterapkan; gunakan pengosongan kolom `result`/`payload_size` untuk perintah lama (OQ-S09). |
| `sale`, `sale_line`, `sale_payment`, `credit_note*` | `business_date` bulanan | **Tidak dipartisi di MVP**: seluruhnya direferensikan FK (`sale_line.sale_id`, dst.) dan PK `id` harus memuat kunci partisi → perubahan PK/FK komposit (`(id, business_date)`) bila kelak diperlukan; kolom `business_date` **sudah ada** di semua baris untuk migrasi itu. Skala 500 trx/hari/outlet tidak memaksa partisi (§6.5). |

**Pemicu keputusan partisi** (`DIUSULKAN`): salah satu tabel ledger > ±50 juta baris atau total basis data > ±100 GB, atau ketika retensi/arsip diputuskan (OQ-03 ditinjau ulang bersama akuntan; RSK-12). Strategi migrasi: buat tabel partisi baru → salin per bulan → tukar nama → hapus lama; `pg_partman` opsional.

### 5.8 View / read model (tanpa tabel baru)

Modul Laporan **membaca saja** lewat view terdaftar (BR-ARC-007); RLS tetap berlaku (view `security_invoker = true`).

| View | Isi | Sumber tabel | Laporan |
|---|---|---|---|
| `v_sales_daily` | gross, diskon, S2, SC, pajak, rounding, total_due per (outlet, `business_date`), per metode; retur | `sale`, `sale_payment`, `credit_note` | R-01 |
| `v_stock_valuation` | qty, nilai, rata-rata (= nilai/qty), flag minus, status ketersediaan | `stock_balance`, `item_outlet_availability`, `product`, `sku` | R-02 |
| `v_in_transit` | Σ qty/nilai transfer `SENT` per outlet tujuan | `transfer`, `transfer_line` | R-02 |
| `v_shift_recap` | modal, tunai, kas masuk/keluar, refund tunai, diharapkan, dihitung, selisih, per metode non-tunai, status | `cash_cashier`, `sale_payment`, `cash_movement`, `credit_note_refund` | R-03 |
| `v_ops_flags` | flag, antrean, gap, selisih transfer, bill ganda/yatim, penjualan item tidak tersedia/open price | `data_flag`, `attention_item`, `invoice_gap`, `transfer_line`, `bill`, `sale_line` | R-04 |
| `v_effective_availability` | status efektif (SKU × outlet) mengikuti BR-CAT-010/016 | `product`, `sku`, `item_outlet_availability` | R-02, validasi |
| `v_orphan_bill` | bill `OPEN` dengan pemegang dicabut / tak sync > ambang; termasuk bill `PENDING` serah-terima yang menunggu lama (`handover_requested_at`) | `bill`, `device`, `device_sync_status` | R-04 (F5) |

*Contoh invarian uji (R-01, V-25):* `Σ total_due (PAID) − Σ refund_total = penjualan neto` (188.000 − 17.900 = 170.100). Laporan memakai `business_date` **tersimpan** (BR-RPT-001).

### 5.9 Optimasi lain

| Topik | Rancangan | Alasan |
|---|---|---|
| **HOT update & fillfactor** | `fillfactor = 70` pada tabel yang sering di-UPDATE di tempat: `tenant_sync`, `stock_balance`, `invoice_series`, `audit_chain_head`, `device_sync_status`, `bill` | Ruang kosong halaman memungkinkan HOT (tanpa menulis ulang indeks) pada baris panas. Kolom yang di-UPDATE sering **tidak diindeks**. |
| **Autovacuum** | Ambang lebih agresif (`autovacuum_vacuum_scale_factor = 0.02`) untuk tabel panas di atas | Mencegah bloat baris yang diperbarui ribuan kali. |
| **Transaksi master pendek** | Validasi di luar transaksi; satu kenaikan versi per impor (BR-SYN-012/013) | Mengurangi waktu tahan lock `tenant_sync` (RSK-13). |
| **Impor massal** | `INSERT … SELECT`/`COPY` ke tabel staging lalu satu transaksi pindah + stamp versi; halaman pull 500 baris | 4.000 SKU = 1 versi; unduhan 8 halaman (BR-SYN-013). |
| **Lock `audit_chain_head` sebagai titik serial per tenant** | Ditulis paling akhir; beban ≈ 0,1–10 perintah/dtk per tenant ≪ kapasitas serial | Rantai tetap utuh tanpa mengurangi throughput nyata (NFR-PERF-005: p95 ≤ 500 ms per `FinalizeSale`). |
| **Statistik & `INCLUDE`** | Indeks `INCLUDE (status, total_due)` dll. agar laporan *index-only* | Laporan harian cepat. |
| **`bigint` uang** | Agregat `SUM` bigint tanpa kasus pembulatan | Lebih cepat dan tepat daripada `numeric`. |
| **`jsonb` terbatas** | Hanya payload/audit/detail; tidak untuk kolom yang difilter | Hindari scan JSON pada laporan. |
| **Koneksi** | Pooler mode transaksi kompatibel `SET LOCAL` | RLS aman (§5.6). |
| **Keyset pagination** | Pull master & daftar audit | Tanpa `OFFSET`. |

---
## 6. Catatan Pemetaan Sinkronisasi Server vs Client

Prinsip arah (AP-04): **master satu arah turun** (server → device) lewat pull berversi; **transaksi satu arah naik** (device → server) lewat outbox; **volume tinggi hanya ke atas** (BR-SYN-010 butir 8). Tidak ada sync LAN antar device (AP-03).

### 6.1 Klasifikasi tabel

#### A. Diunduh penuh ke device (master baca-saja, ikut feed `version`)

| Tabel | Filter unduhan | Store Dexie | Catatan |
|---|---|---|---|
| `tenant` (baris sendiri) | — | `meta.tenant` (di database tenant) | Locale bawaan. Peta slug→`tenant_id` hanya di registry `solva-registry` (§4.6.9). |
| `legal_entity` | seluruh tenant | `legal_entity` | Header struk, snapshot NPWP/PKP. |
| `outlet`, `outlet_receipt_setting` | outlet device | idem | Mode harga/pajak/SC, struk. |
| `register_invoice_prefix` | **register device ini** | `register_invoice_prefix` | Prefiks nomor invoice berlaku-mulai; dipilih menurut `business_date` (§4.1.5). |
| `tax_rate_history` | outlet device + default tenant (`outlet_id IS NULL`) | `tax_rate_history` | Tarif pajak berlaku-mulai; dipilih menurut `business_date` (§4.1.4). |
| `cash_master` | **seluruh register outlet device** (PRD: daftar tujuan serah-terima, label asal "bill masuk"; OQ-S23 terjawab) | `cash_master` | Konfigurasi register sendiri + `register_type` semua register outlet. |
| `payment_method` | seluruh tenant | `payment_method` | — |
| `feature_flag` | **seluruh override tenant** (kecil) | `feature_flag` | Nilai terakhir dipakai saat offline; default kode bila tak ada baris; diterapkan setelah siklus pull lengkap; **POS baca-saja** (§4.6.10) |
| `app_user`, `user_outlet` | staf yang ditugaskan ke outlet device (+ tenant-wide); hanya `membership_status = 'ACTIVE'` | `app_user`, `user_outlet` | Layar pilih nama. **`auth_user_id` dan `membership_status` tidak diturunkan ke device**; tidak ada email/username di `app_user` (email global hanya di Better Auth, tidak ikut sync); baris `PENDING` tidak diturunkan (belum boleh login PIN). |
| `role`, `role_permission` | seluruh tenant | `role`, `role_permission` | Permission + `discount_limit_pct` untuk verifikasi lokal. |
| `staff_pin` | **device ini** | `staff_pin` | Hash PIN per device + parameter KDF. |
| `category`, `uom`, `product`, `sku`, `sku_uom` | **seluruh katalog tenant** (OQ-27c) | idem | `sku_uom` membawa faktor & barcode. |
| `price_entry` | outlet device + default tenant (`outlet_id IS NULL`) | `price_entry` | Fallback dihitung lokal (BR-PRC-002). |
| `item_outlet_availability` | outlet device | idem | Layar jual diterapkan setelah **seluruh siklus pull** (BR-CAT-014). |
| `modifier_group`, `modifier_group_product`, `modifier` | seluruh tenant | idem | Hanya perlu bila outlet F&B; tetap diunduh (kecil). |
| `fnb_table` | outlet device | `fnb_table` | Status meja diturunkan lokal. |

Tombstone (`deleted_at`) ikut feed; device menghapus baris lokal saat menerimanya. Pull: cursor `(version, id)`, halaman 500, **tanpa filter `deleted_at`** pada pull inkremental; full resync memfilter `deleted_at IS NULL`.

#### B. Transaksi naik, append-only atau terbatas rentang waktu

| Tabel | Store Dexie | Arah | Retensi lokal |
|---|---|---|---|
| `sale`, `sale_line`, `sale_line_modifier`, `sale_payment` | idem | ↑ | **3 bulan** setelah `business_date` **dan hanya bila `sync_status = ACKED`**; belum sync **tidak pernah dibuang** (BR-SYN-054, NFR-STOR-003) |
| `credit_note`, `credit_note_line`, `credit_note_refund` | idem | ↑ | Sama |
| `cash_cashier` (`shift`), `cash_movement` | `shift`, `cash_movement` | ↑ | Sama (shift tertutup & tersinkron > 3 bulan) |
| `bill`, `bill_item`, `bill_item_modifier`, `bill_event` | idem | ↑ (+ snapshot ↓) | Bill selesai & tersinkron > 3 bulan; event mengikuti bill. **Setelah `BILL_ACCEPTED`:** bill diunduh penuh (header, item, `last_event_seq`) ke store `bill`/`bill_item` register penerima; salinan pengirim menjadi **read-only** dan beralih ke `bill_snapshot` pada pull berikutnya |
| `staff_pin_state` | idem | ↑ | Terus (keadaan terakhir per pasangan) |
| `outbox_command` | idem | ↑ | `PENDING/SENDING/NEEDS_ATTENTION` **tidak pernah dibuang**; payload `ACKED` dibersihkan setelah 7 hari |
| `local_counter`, `meta` | idem | lokal | Terus |
| `print_job` | idem | lokal saja | `DONE` > 7 hari dibersihkan; `FAILED` dipertahankan sampai dicetak ulang/diabaikan |
| `cart_draft` | idem | lokal saja (**tidak** disinkron) | Draf keranjang dan draf bill (`kind`); pulih setelah crash/kunci layar; dibuang saat dipakai (dalam transaksi finalisasi), shift staf ditutup override, atau manual (§4.6.9); tidak pernah menjadi pending |
| `device_log` | idem | ↑ (log; saluran non-perintah `POST /device-log` → **berkas log server**, bukan tabel) | ≤ 500 entri, **tertua dibuang**; ≤ 100 entri/siklus; dihapus setelah diterima; tak pernah memengaruhi outbox (§4.6.9, §6.2.1) |

#### C. Snapshot (bukan feed berversi)

| Tabel/Store | Sumber server | Isi | Penyegaran |
|---|---|---|---|
| `stock_snapshot` | `stock_balance` (outlet device) | qty per SKU + `as_of_server_time` + `acked_device_seq` | Tiap siklus sync (online); estimasi lokal = snapshot − penjualan lokal belum tercermin (BR-STK-005) |
| `bill_snapshot` | `bill`, `bill_item` outlet (device lain) | Open bill read-only + "terakhir diperbarui" + `is_awaiting_payment` ("Menunggu bayar") + `handover_status`/`handover_target_register_id` ("bill masuk" di register tujuan) | Tiap sync (F5; FR-SYN-016, FR-FNB-014). **Online-only:** daftar "bill masuk" dan aksi Serahkan/Terima/Batal memerlukan jaringan (EC-058) |
| `asset_cache` | berkas di `outlet_receipt_setting.logo_object_key` | Bitmap logo | Bila `logo_sha256` berubah |

#### D. Hanya di server (tidak pernah diunduh)

`product_attribute`, `attribute_value`, `sku_attribute_value` (struktur varian; device cukup `sku.variant_label`) · `recipe_item`, `modifier_ingredient` (konsumsi dihitung server) · `supplier`, `goods_receipt(+line)`, `transfer(+line)`, `stocktake(+line)` (online-only, OQ-20) · `stock_balance`, `stock_movement` (ledger; volume tinggi hanya ke atas) · `user_pin_credential`, `device`, `pairing_code`, `member_code`, `device_sync_status` · `invoice_series`, `invoice_gap`, `register_recovery` · `tenant_sync`, `idempotency_command`, `attention_item`, `data_flag` · `audit_log`, `audit_chain_head` · `app_release` (versi terbaru dan `min_supported_*` disampaikan lewat respons sync dan disimpan device di `meta.min_supported`).

### 6.2 Hasil pemrosesan yang kembali ke device (ACK)

Setiap respons sync (push dan pull) juga membawa **kebijakan versi**: `latest`, `min_supported_app_version`, `min_supported_schema_version`, `is_mandatory`, dan `max_schema_version` server (§4.6.8). Device menyimpannya di `meta.min_supported`; bila versinya di bawah minimum, perintah ditahan di outbox (tidak hilang) dan shift baru diblokir.

Server mengembalikan ke device, per perintah, `result` (disimpan di `outbox_command.result` dan dicerminkan ke dokumen lokal): `received_at`, nomor final (bila konflik `-Dn`), ringkasan **flag** (harga stale, stok minus, item tidak tersedia, selisih hitung), HPP per baris bila relevan (`cost_snapshot`), `status` ACK/ATTENTION. Client **tidak** menghitung ulang HPP. Hasil ini hanya informasi (angka transaksi tidak berubah).

#### 6.2.1 Saluran `POST /device-log` (non-perintah)

Bukan perintah idempoten dan **tidak** lewat `idempotency_command`/outbox. Identitas (`tenant_id`, `device_id`, `register_id`) diambil server dari **credential device**, bukan dari badan. Server **tidak menulis ke tabel**: tiap entri menjadi satu baris **berkas log JSON** ber-`scope: "device"` memuat `refLocal`, `deviceId`, `registerId`, `tenantId`, `code`, `level`, `route`, `stack`, `ctx`, `appVersion`, `schemaVersion`, `clientTime` (= `created_at`) dan `clockOffsetMs` (OQ-S18; BR-LOG-010 butir 5).

```jsonc
// POST /api/pos/v1/device-log   (≤ 100 entri; ≤ 20 laporan / 10 menit / device; ukuran badan dibatasi ARCHITECTURE)
{
  "entries": [
    {
      "ref_local": "D-20261118-143551-k7q2m",
      "created_at": "2026-11-18T07:35:51.120Z",
      "clock_offset_ms": -1840,
      "level": "error",
      "code": "PRINT_FAILED",
      "route": "/pos/checkout",
      "stack": "Error: BLE write timeout\n  at PrinterAdapter.write (…)",
      "ctx": { "printJobId": "0192…", "attempt": 2 },
      "app_version": "v1.6.2",
      "schema_version": 7
    }
  ]
}
// → 2xx { "received": 1 }   ·   429 / 5xx / jaringan → entri tetap PENDING, dicoba lagi pada siklus berikutnya
```

Pengiriman **at-least-once**: bila respons hilang, entri terkirim ulang dan baris log dapat ganda; pencari log memakai `refLocal` untuk membuangnya (log diagnostik, bukan fakta bisnis). Kegagalan kirim **bukan** "perlu perhatian" (BR-LOG-010 butir 4).

### 6.3 Definisi store Dexie (ringkas, per versi skema)

Notasi Dexie: `primaryKey, indeks…` · `&x` unik · `*x` multiEntry · `[a+b]` kompon · `++id` auto-increment. IndexedDB **tidak dapat mengindeks `null`/`boolean`**: kolom nullable yang perlu kunci diganti kunci turunan string (`outlet_key`, `sku_key`), boolean tidak diindeks. Uang disimpan sebagai `number` integer; kuantitas sebagai `string`; waktu sebagai ISO string UTC (urutan leksikografis = urutan kronologis, sehingga `between()` pada indeks waktu aman).

```ts
// ilustrasi — BUKAN kode final; versi skema berubah dengan migrasi berurutan (NFR-MNT-001)
// Database ini dibuka per tenant: nama `solva-pos:${tenant_id}` (§4.6.9); registry terpisah di bawah blok ini.
db.version(1).stores({
  meta:                    'key',

  // ===== master turun (baca-saja; upsert/hapus dari pull) =====
  legal_entity:            'id',
  outlet:                  'id',
  tax_rate_history:        'id, [tax_code+outlet_key], effective_from',   // outlet_key = outlet_id atau '*' (default tenant)
  register_invoice_prefix: 'id, register_id, effective_month',
  outlet_receipt_setting:  'id, outlet_id',
  cash_master:             'id, outlet_id, register_type',
  payment_method:          'id, code',
  feature_flag:            'id, &flag_key',
  app_user:                'id, display_name',
  role:                    'id',
  role_permission:         'id, role_id',
  user_outlet:             'id, user_id',
  staff_pin:               'id, user_id',                    // sudah terfilter per device
  category:                'id, parent_id',
  uom:                     'id',
  product:                 'id, category_id, code, *search_tokens',   // search_tokens: array token nama/kode (turunan client)
  sku:                     'id, product_id, sku_code',
  sku_uom:                 'id, &barcode, [sku_id+uom_id], sku_id',   // &barcode: baris tanpa barcode tidak diindeks (field dihilangkan)
  price_entry:             'id, [sku_id+uom_id+outlet_key]',          // outlet_key = outlet_id atau '*' (default tenant)
  item_outlet_availability:'id, [product_id+sku_key]',                // sku_key = sku_id atau '*' (tingkat produk)
  modifier_group:          'id',
  modifier_group_product:  'id, product_id, modifier_group_id',
  modifier:                'id, modifier_group_id',
  fnb_table:               'id, code',

  // ===== transaksi lokal (↑) =====
  sale:                    'id, &invoice_no, [register_id+invoice_period+invoice_seq], business_date, shift_id, bill_id, [sync_status+business_date]',
  sale_line:               'id, sale_id, [sale_id+line_no]',
  sale_line_modifier:      'id, sale_line_id',
  sale_payment:            'id, sale_id, shift_id',
  credit_note:             'id, &cn_no, original_sale_id, business_date, shift_id, [sync_status+business_date]',
  credit_note_line:        'id, credit_note_id, sale_line_id',
  credit_note_refund:      'id, credit_note_id, shift_id',
  shift:                   'id, status, register_id, [sync_status+business_date]',
  cash_movement:           'id, shift_id',
  bill:                    'id, table_id, status, parent_bill_id, [sync_status+business_date]',
  bill_item:               'id, bill_id',
  bill_item_modifier:      'id, bill_item_id',
  bill_event:              'id, [bill_id+bill_seq], device_seq',
  staff_pin_state:         '[user_id+device_id]',

  // ===== infrastruktur sync / cetak / log =====
  outbox_command:          'id, [status+device_seq], dependency_key, entity_id',
  local_counter:           'key',
  print_job:               'id, [status+created_at], entity_id',
  device_log:              '++id, &ref_local, [send_status+id]',   // ≤ 500 entri; migrasi mengosongkan store lama
  stock_snapshot:          'sku_id',
  bill_snapshot:           'bill_id, table_id, status, handover_target_register_id',   // handover_target_register_id: hanya baris PENDING (field dihilangkan bila NONE)
  cart_draft:              'id, [register_id+staff_id+status], bill_key, status',   // kind CART|BILL; bill_key = bill_id ?? '' (null tak dapat diindeks)
  asset_cache:             'key',
});
```

**Penjelasan indeks lokal penting**

| Kebutuhan | Indeks | Kinerja/aturan |
|---|---|---|
| Scan barcode → (SKU, UOM) (FR-POS-001) | `sku_uom.&barcode` | ≤ 50 ms (NFR-PERF-003); satu barcode = satu `(sku_id, uom_id)` (BR-CAT-006). |
| Pencarian nama/kode produk (FR-POS-003) | `product.*search_tokens` + `code` | Token huruf kecil tanpa diakritik; pencarian awalan lewat `startsWith`; ≤ 150 ms p95 untuk 5.000 SKU. |
| Harga (SKU, UOM, outlet) + fallback | `price_entry.[sku_id+uom_id+outlet_key]` | Dua `get()` (outlet lalu `'*'`). |
| Ketersediaan efektif | `item_outlet_availability.[product_id+sku_key]` | `get(product,sku)` lalu `get(product,'*')`; default `AVAILABLE`. Hasil dapat di-cache ke struktur memori setelah pull. |
| Riwayat transaksi, cetak ulang, cari nomor (FR-POS-009) | `sale.&invoice_no`, `sale.business_date` | Nomor unik lokal. |
| Alokasi nomor berikutnya | `local_counter.key` | Dibaca dan dinaikkan dalam transaksi IndexedDB yang sama dengan penyimpanan dokumen. |
| Retur: kumulatif sudah diretur per baris | `credit_note_line.sale_line_id` | Σ `qty_returned` ≤ `sale_line.qty` (diverifikasi lokal; server memverifikasi ulang). |
| Retensi/pembersihan | `sale.[sync_status+business_date]` | `sync_status='ACKED' AND business_date < cutoff`. |
| Antrean push FIFO per register | `outbox_command.[status+device_seq]` | Ambil `PENDING` berurut; lewati yang `depends_on` belum `ACKED` (BR-SYN-023). |
| Banner "N transaksi belum terkirim sejak X jam" | `outbox_command.status` | Menghitung non-`ACKED`. |

**Contoh rekaman `sale` lokal (representasi kanonik)**

```json
{
  "id": "0192f1c2-7a5e-7b3a-9f6d-2b8c1e4a7d10",
  "tenant_id": "0192a000-0000-7000-8000-00000000a001",
  "outlet_id": "0192a000-0000-7000-8000-00000000b001", "register_id": "0192a000-0000-7000-8000-00000000c002",
  "device_id": "0192a000-0000-7000-8000-00000000d002", "shift_id": "0192f1c0-...",
  "invoice_no": "OUT01-POS02-1126-000123", "invoice_prefix": "OUT01-POS02",
  "invoice_period": "1126", "invoice_seq": 123, "invoice_conflict_idx": 0,
  "status": "PAID", "business_date": "2026-11-17",
  "created_at_device": "2026-11-17T07:05:12.345Z", "clock_offset_ms": 420000, "occurred_at": "2026-11-17T07:12:12.345Z",
  "price_tax_mode": "EXCLUSIVE", "tax_profile": "PPN", "tax_rate": "11.0000", "service_charge_rate": "0.0000",
  "cash_rounding_unit": 100, "receipt_locale": "id-ID",
  "gross_total": 106700, "line_discount_total": 5370, "bill_discount_total": 0, "net_subtotal": 101330,
  "service_charge": 0, "tax_base": 101330, "tax_amount": 11146, "dpp": 101330,
  "grand_total": 112476, "rounding": 24, "total_due": 112500,
  "sync_status": "PENDING", "synced_at": null, "server_result": null
}
```

(Uang `number` bulat; tarif `string`; kuantitas pada `sale_line` `string` mis. `"3.0000"`; waktu ISO `Z`.)

Registry perangkat (database terpisah `solva-registry`, bukan bagian database tenant; ilustrasi): `db.version(1).stores({ tenant_directory: 'tenant_id, &slug' })`.

### 6.4 Pemetaan peran kolom sync per store lokal

| Store lokal | `version` | `synced_at` | `sync_status` | `server_result` |
|---|---|---|---|---|
| Master turun | ✓ (salinan) | — | — | — |
| `sale`, `credit_note`, `shift`, `cash_movement`, `bill` | — | ✓ (waktu ACK) | ✓ (cermin `outbox_command.status`) | ✓ |
| `bill_event`, `staff_pin_state` | — | — | — (mengikuti perintah) | — |
| `outbox_command` | — | `acked_at` | `status` (sumber kebenaran) | `result` |
| `stock_snapshot`, `bill_snapshot` | — | `as_of` | — | — |

### 6.5 Estimasi ukuran storage (berdasarkan skala PRD)

Dasar skala: **≤ 5.000 produk (= SKU aktif per outlet), ≤ 500 transaksi/hari/outlet, retensi lokal 3 bulan (±45.000 transaksi/device), jam sampai 1 hari offline** (BR-SYN-054, NFR-STOR-002). Seluruh angka di bawah adalah **perkiraan kasar `DIUSULKAN`** (ukuran baris rata-rata + overhead indeks) dan harus divalidasi pada benchmark F3.

#### 6.5.1 Client (Dexie / IndexedDB)

*Catatan:* angka di bawah per **satu tenant** (satu database `solva-pos:{tenant_id}`); perangkat yang dipakai untuk beberapa tenant menjumlahkannya, dan kuota origin dipakai bersama (§4.6.9).

| Komponen | Hitung | Perkiraan |
|---|---|---|
| Katalog: `product` + `sku` + `sku_uom` + `price_entry` + `item_outlet_availability` + `category/uom/modifier*` | ≈ 5.000 produk/SKU × ±(0,4 + 0,3 + 0,6 + 0,3 + 0,15) KB + indeks (`search_tokens`, barcode) | **±15–20 MB** |
| Konfigurasi, user, role, PIN | < 1.000 baris | < 1 MB |
| Transaksi 3 bulan: 45.000 `sale` × (header ±1,2 KB + 4 `sale_line` × ±0,6 KB + 1,3 `sale_payment` × ±0,25 KB) | ±3,9 KB/transaksi ≈ 3–4 KB (PRD mengestimasi ±3 KB) | **±135–180 MB** |
| `credit_note*` (±1–2% transaksi), `shift`, `cash_movement` | — | < 5 MB |
| `outbox_command` (payload ACKED dibersihkan > 7 hari; pending kecil) | ≈ 3.500 × ±2 KB | ±7 MB |
| `print_job`, `device_log` (≤ 500), `stock_snapshot` (5.000 × ±0,1 KB), `asset_cache` | — | < 3 MB |
| F&B: `bill`, `bill_item`, `bill_event` (outlet F&B) | ±8 event × ±0,4 KB per bill, 3 bulan | +50–100 MB (hanya F&B) |
| **Total retail** | | **±160–210 MB** (mendekati estimasi PRD ±150 MB; peringatan kuota > 70%, BR-SYN-054) |
| **Total F&B** | | **±220–310 MB** |

Mitigasi yang sudah diatur: pembersihan retensi 3 bulan hanya untuk yang tersinkron; payload outbox `ACKED` dibuang cepat; `device_log` ≤ 500; `print_job` `DONE` dibersihkan. Bila katalog tenant jauh melebihi 5.000 SKU (OQ-27c), ukuran Dexie dan durasi full resync perlu diukur pada F2 (BR-CAT-014).

#### 6.5.2 Server (PostgreSQL), per outlet per tahun (500 transaksi/hari = 182.500/tahun)

| Tabel | Baris/tahun | Ukuran baris + indeks (kasar) | Ukuran/tahun |
|---|---|---|---|
| `sale` | 182.500 | ±1,1 KB | ±200 MB |
| `sale_line` | ±730.000 (4/trx) | ±0,6 KB | ±440 MB |
| `sale_payment` | ±237.000 | ±0,25 KB | ±60 MB |
| `stock_movement` | retail ±730.000 · F&B ±1,5–3 jt (bahan resep) | ±0,55 KB | retail ±400 MB · F&B ±0,8–1,7 GB |
| `idempotency_command` | ±190.000 (penjualan + shift/kas/bill) | ±0,8 KB (`result` jsonb) | ±150 MB |
| `audit_log` | ±10.000–30.000 | ±1 KB | ±10–30 MB |
| `data_flag`, `attention_item`, `credit_note*`, `cash_*` | — | — | < 50 MB |
| `bill_event` (F&B) | ±1,5 jt (±8 event/bill) | ±0,4 KB | ±600 MB |
| `bill`, `bill_item` (F&B) | ±0,4 jt | — | ±150 MB |
| **Total** | | | **retail ±1,2–1,5 GB / outlet-tahun · F&B ±3–4 GB / outlet-tahun** |

Master data (≤ 5.000 SKU, harga per outlet, ketersediaan) < 100 MB per tenant. **10 outlet campuran ≈ 15–35 GB/tahun**; tanpa penghapusan (OQ-03, RSK-12) ini menjadi pemicu tinjauan retensi/partisi (§5.7). Beban tulis puncak: ≈ 2–10 perintah/detik per tenant saat backlog sync pasca-gangguan (tiap perintah: ±5–15 baris + lock) — dalam kapasitas satu PostgreSQL VPS (AS-06) bila transaksi pendek.

---
## 7. Rekonsiliasi dengan PRD

Bagian ini mencatat **setiap** titik tempat rancangan skema berbeda dari permintaan awal (brief) atau dari penamaan/struktur konseptual PRD §6.3, beserta alasannya. **PRD yang menang.** Tidak ada kontradiksi terhadap keputusan `DISEPAKATI`; yang tercatat di bawah adalah penerjemahan konseptual → fisik dan perluasan yang tidak bertentangan.

### 7.1 Uang vs `NUMERIC` (brief ≠ PRD → PRD menang)

| Brief | PRD (diikuti) | Alasan |
|---|---|---|
| Uang/harga/pajak/diskon/HPP memakai `NUMERIC` | **Uang = bilangan bulat satuan terkecil, `bigint` (rupiah = 1); kuantitas = `numeric` scale tetap 4; nilai persediaan integer** (BR-MNY-001/002, BR-HPP-002, KEP-07, AP-05) | (1) Float/`numeric` pecahan di kolom uang menimbulkan selisih akumulatif dan beda angka client (JS) vs server; (2) PRD menetapkan **titik pembulatan terdefinisi** (BR-MNY-003) dan **hasil disimpan, tidak dihitung ulang**; (3) satu package perhitungan bersama client & server (AP-06) bekerja pada integer; (4) agregat laporan `SUM(bigint)` eksak. Pecahan hanya muncul **saat kalkulasi** (mis. 4.162,5 → R = 4.163) di Kernel. `numeric` dipakai **hanya** di tempat PRD menetapkannya: kuantitas (`qty`, `qty_base`, `qty_delta`, `snapshot_qty`…), faktor konversi (`conversion_factor`), persentase tarif/diskon (`tax_rate`, `service_charge_rate`, `discount_pct`, `discount_limit_pct`). Biaya rata-rata/biaya referensi **tidak disimpan sebagai pecahan**: pasangan (`bigint`, `numeric`) dibagi saat dibutuhkan (BR-HPP-002). |

### 7.2 Penamaan dan struktur: PRD §6.3 → tabel fisik

| PRD (entitas konseptual) | Tabel fisik | Perubahan & alasan |
|---|---|---|
| `register` (`cash_master`) | **`cash_master`** | Sama (nama PRD BR-INV-001). |
| `shift` (`cash_cashier`) | **`cash_cashier`** | Sama. Ditambah kolom rekap server (`recap_*`, `expected_cash`, `variance`) untuk R-03/BR-SHF-008. |
| `table` | **`fnb_table`** | `table` kata tercadang SQL. |
| `user` | **`app_user`** | `user` kata tercadang SQL; juga menghindari bentrok dengan tabel `user` Better Auth. |
| `stock_movements` (BR-STK-001), `stock_movement` (§6.3) | **`stock_movement`** | Konvensi tunggal; PRD memakai kedua bentuk. |
| `outlet` memuat `price_tax_mode`, `tax_profile`, `tax_rate`, `service_charge_*` (PRD ≤ 0.98 juga `invoice_prefix`, `print_register_code`) | `outlet` (mode harga, profil pajak, flag & tarif SC, unit pembulatan) + **`tax_rate_history`** (tarif pajak berlaku-mulai; kode pajak + outlet opsional) + **`register_invoice_prefix`** (prefiks invoice per register, berlaku-mulai) (+ `outlet_receipt_setting`) | BR-TAX-001/FR-TNT-005/EC-005 mewajibkan **tarif pajak** `berlaku_mulai`; keputusan 2026-11-18: hanya pajak yang dijadwalkan, tarif SC dan pengaturan lain langsung. **PRD (BR-INV-003):** prefiks invoice menjadi atribut **register** (wajib, unik per tenant), menggantikan awalan per outlet + opsi cetak kode register; perubahan tetap berlaku mulai periode `MMYY` berikutnya. Kolom bertanggal dipindah ke tabel riwayat/anak berperiode; kolom lain tetap di `outlet`. Kustomisasi struk dipisah (1:1). |
| `sale.subtotal`, `discount_total`, `service_charge`, `tax`, `rounding`, `grand_total` | `gross_total`, `line_discount_total`, `bill_discount_total`, `net_subtotal` (S2), `service_charge`, `tax_base`, `tax_amount`, `dpp`, `grand_total` (G), `rounding`, `total_due` | Menyimpan **seluruh titik** BR-TAX-006 (R-01 butuh gross, diskon, S2, SC, pajak, pembulatan, total) dan DPP (BR-TAX-010). `grand_total` = G sebelum pembulatan; `total_due` = G + rounding. |
| `sale.price_tax_mode & tarif snapshot`, `customer`, `schema_version`, `catalog_cursor` | kolom snapshot (§4.5.3-c), `customer_name/phone`, `schema_version` (STD-T), `catalog_cursor` | `customer` dipecah nama/telepon agar telepon dapat dimasker (BR-CUS-002). |
| `sale.received_at` + `created_at_device` + `clock_offset` | `received_at` + `created_at_device` + `clock_offset_ms` + `occurred_at` | `occurred_at` ditambah sebagai waktu terkoreksi eksplisit (BR-TIM-005). |
| `sale_line.flag harga stale` | **tidak ada kolom**; `data_flag` (`HARGA_STALE`) | Flag bisnis ditempatkan di satu tabel (R-04) agar tidak menambah kolom tiap flag baru; selisih ada di `diff_amount`. |
| `sale_line.qty` + UOM | `qty` (UOM jual) + `conversion_factor` (snapshot) + `qty_base` | BR-UOM-006. |
| `stock_balance.last_cost_reference` | `ref_value` + `ref_qty` | Menghindari biaya per satuan pecahan tersimpan (BR-HPP-002/005). |
| `stock_movement.kind`, `sumber`, `source_id` | `movement_type`, `source_type`, `source_id` + `bal_seq`, `qty_after`, `value_after`, `cost_basis`, `is_negative_result`, `reverses_movement_id` | Mendukung replay, urutan biaya (BR-HPP-004), idempotensi, laporan stok minus. |
| `invoice_gap.status (OPEN/EXPLAINED)` | `OPEN`, `EXPLAINED` + **`FILLED`** | Perluasan: gap yang akhirnya terisi nomor terlambat (menjaga audit; tidak bertentangan). |
| `bill.status (OPEN/SPLIT/PAID/CANCELED/MERGED)` | + **`CLOSED_BY_SPLIT`** | BR-SPL-002 menyebut `CLOSED_BY_SPLIT`; BR-FNB-005 daftar status tak memuatnya. |
| `bill_event.jenis` (BR-FNB-005; PRD menambah `PREBILL_PRINTED`, `BILL_HANDED_OVER`, `BILL_ACCEPTED`, `BILL_HANDOVER_CANCELED`) | + **`DISCOUNT_SET`**, **`BILL_SPLIT`**, **`BILL_MERGED`** (empat jenis PRD sudah masuk) | FLOW-06/07 merujuk event split/merge; diskon bill pada open bill (BR-SPL-004 "diskon bill induk") membutuhkan event/kolom. |
| `bill` lease (`lease_holder_device_id`) | `bill.lease_device_id` + **`lease_register_id`**, `handover_status`, `handover_target_register_id`, `handover_event_id`, `handover_requested_at`, `prebill_seq`, `prebill_printed_at`, `last_content_seq`, `is_awaiting_payment` | Nama konsisten `*_device_id`. PRD: lease berpindah hanya lewat serah-terima yang diterima register tujuan (BR-FNB-003/012); status "menunggu diterima" dan "menunggu bayar" perlu kolom turunan agar ikut snapshot ke semua device (BR-FNB-010). **Menggantikan** aturan lama "lease tidak dapat berpindah" (trigger kini mengizinkan hanya jalur `BILL_ACCEPTED`). |
| `register` memuat jenis (PRD §6.3: istilah `KASIR`/`PELAYAN`) | `cash_master.register_type` dengan nilai **bahasa Inggris** `CASHIER` (= `KASIR`, default) dan `WAITER` (= `PELAYAN`) | BR-FNB-011, FR-DEV-006. Nilai kolom memakai bahasa Inggris sesuai konvensi enum skema; PRD dan DESIGN tetap memakai istilah Indonesia sebagai nama konsep. Nilai ini terpisah dari kode role `CASHIER`/`WAITER` pada tabel `role` (kolom dan tabel berbeda). |
| Kunci layar (BR-AUT-015) | tanpa kolom server; Dexie `meta.idle_lock`, `cart_draft` | PRD: murni sisi device; audit hanya override supervisor dan kunci PIN (aksi audit `screen.unlock_override`). |
| (tidak ada) | `bill_item`, `bill_item_modifier` | PRD: "status bill diturunkan dari event" + merge/split memindahkan item + snapshot open bill → perlu proyeksi item (OQ-S08). |
| `device.last_sync_at`, `app_version`, offset, `storage.persist` | `device_sync_status` | FR-DEV-004 meminta data volatil; dipisah dari identitas device. |
| `staff_pin` (user, device, salt, pin_hash, kdf_params, **failed_count, locked_until**) | `staff_pin` (turun) + `staff_pin_state` (naik) + `user_pin_credential` | Penghitung kunci diubah di device (arah naik) sedangkan hash turun; verifier server menghindari keharusan mengetahui PIN polos saat device baru dipasang (OQ-S01). |
| `tenant_sync (tenant_id, version)` | + `tombstone_floor_version` | Mewujudkan "batas pembersihan tombstone 30 hari" (BR-SYN-010 butir 6) tanpa menghapus baris yang dirujuk transaksi. |
| `attention_item (command id, alasan, device, status)` | sama + `payload`, `blocked_by_command_id`, `request_ref`, keputusan | FLOW-18 (terima manual/abaikan/eskalasi) dan EC-027 (dependen ditahan). |
| `audit_log` (…hash berantai) | + `chain_seq`, `audit_chain_head` | Mengurutkan rantai per tenant tanpa celah. |
| `recipe_item.qty` | sama | Server-saja. |
| `modifier` "perubahan bahan (tambah/ganti/kurangi)" | `modifier` + `modifier_ingredient (ADD/REDUCE/REMOVE)` | "Ganti" = REMOVE + ADD. |
| (tidak ada) | `invoice_series`, `register_recovery` | BR-ARC-003 menempatkan pencatatan nomor tertinggi/gap di modul Penjualan (bukan kolom register); BR-INV-008 butuh catatan pemulihan. |
| PRD: "nomor versi skema" per perintah (BR-SYN-022) | `schema_version` (kontrak) **dan** `app_version` (tag SemVer) pada tabel T, `bill_event`, `idempotency_command`, `audit_log`; Dexie `outbox_command` | Keputusan user 2026-11-18 (ARCHITECTURE §9.6): empat nomor versi terpisah; hanya dua disimpan per fakta. PRD sudah memuatnya: BR-VER-001/002/003/008 (dua nomor versi, N/N−1 dan versi minimum, 30 hari), FR-VER-001/006; BR-SYN-022 tetap dasar kompatibilitas outbox. |
| `app_release` (N / N−1, 14 hari) | `app_release` + `min_supported_app_version`, `min_supported_schema_version` (diganti dari `min_accepted_schema_version`) | Versi minimum klien disimpan di baris rilis terbaru (OQ-S25 terjawab 2026-11-19); ARCHITECTURE §4.3.3 (blok `release`) dan §9.6 dan butir 5 perlu menyesuaikan nama kolom. |
| (tidak ada di PRD) | `feature_flag` | Keputusan user 2026-11-18: flag per tenant, master turun, default di kode, hanya Owner (`flag.manage`). PRD: BR-VER-009, FR-VER-007. |
| BR-AUT-001: Better Auth email + password | **Identitas global** (`user` BA: email unik se-sistem, satu password) + **keanggotaan per tenant** (`app_user` + `member` BA); `app_user` tanpa `username`/`email`; login `/{slug}/admin` hanya email | Keputusan user 2026-11-19, **menggantikan** OQ-S02 versi "app_user terpisah, satu orang = satu tenant", OQ-S30 (alias email per tenant), dan OQ-S34; sebelumnya juga menggantikan login username (OQ-S02 2026-11-17). Tanpa verifikasi email, tanpa token reset (tabel `verification` tidak dipakai), tanpa alias `{app_user_id}@auth.solva.invalid`; undangan/reset lewat **kode sekali pakai terikat email** (`member_code`, OQ-S38 mekanisme B; tanpa password sementara); cookie sesi **per slug**. PRD sudah memuatnya: KEP-27, BR-IDN-001..013, BR-TEN-003, FR-IDN-001..014. |
| BR-AUT-001 / BR-TNT-001: tenant dikenali dari login | `tenant.slug` permanen di URL sub-path; penjaga keanggotaan (`app_user` `ACTIVE` untuk tenant slug); database Dexie `solva-pos:{tenant_id}` + registry `solva-registry` | Keputusan user 2026-11-18, disesuaikan 2026-11-19: cookie sesi **per slug** (login terpisah per tenant, akun global), tenant ditentukan slug URL **setelah** penjaga keanggotaan lolos (bukan dari cookie). PRD: KEP-24, BR-TEN-001..012, FR-TEN-001..012 (termasuk perangkat multi-tenant BR-TEN-006). |
| Undangan/reset password tanpa email; keanggotaan | Tabel `member_code` (`INVITE` 72 jam, `RESET` 24 jam, `code_hash`, email terikat, `used_at` atomik, `issued_by`); `app_user.membership_status` (`PENDING`/`ACTIVE`); `auth_account_membership_count`; audit `member.*`; **tanpa** `must_change_password`/password sementara | Keputusan user 2026-11-19 (OQ-S38 mekanisme B): penerbit tidak melihat/menetapkan password; kode sama untuk email yang sudah/belum punya akun. Satu tabel server-saja baru; selaras `pairing_code`. Detail dikunci (OQ-S39 terjawab). Ditambah (DESIGN DOQ-26, 2026-11-19): `member_code.revoke_reason` (`CANCELED`/`REPLACED`) dan indeks `(app_user_id, kind, created_at DESC)` untuk daftar "Undangan tertunda", Batalkan, Terbitkan ulang; tanpa `canceled_at`, `replaced_by_id`, `revoked_by` (OQ-S40 terjawab). |
| Pengalih tenant (tenant switcher) | **Tidak ada**; tidak ada fungsi `list_memberships(auth_user_id)`, direktori keanggotaan, atau daftar tenant milik akun | Keputusan user 2026-11-19: tidak ada pengalih tenant (cookie sesi per slug, login terpisah per tenant; PRD FR-IDN-003/BR-IDN-002). Pencarian lintas-tenant yang tersisa hanya **`auth_account_membership_count(auth_user_id)`** (jumlah saja; dipakai aturan reset: Owner hanya akun yang hanya di tenantnya) dan **penjaga keanggotaan per slug** (`app_user` `ACTIVE` untuk tenant slug). Daftar tenant per akun tidak dibutuhkan dan akan membuka keanggotaan lintas tenant tanpa kebutuhan; `solva-registry` di perangkat hanya peta slug→`tenant_id` untuk Dexie, **bukan** pengalih. |
| Audit undangan/reset memuat email | `audit_log` `member.*` memuat aktor, **email**, peran, tenant, id kode; tanpa kode polos | PRD FR-IDN-011/014 menang atas rancangan awal "tanpa email di audit". Konsekuensi: email tersimpan di `audit_log` yang disimpan tanpa penghapusan (OQ-03) — dicatat sebagai pertimbangan privasi untuk ditinjau bersama kebijakan retensi. |
| PRD §6.3 `tenant`: nama tampilan maks 40 karakter (BR-TEN-007, EC-097) | `tenant.name` CHK ≤ **40** (sebelumnya 120) | PRD menang; diatur operator platform. |
| PRD FR-VER-006: `contract_version` | Kolom `schema_version` (versi kontrak) + `app_version` | Nama kolom `schema_version` dipertahankan (konsisten ARCHITECTURE dan Dexie); `contract_version` di PRD = `schema_version` di skema. |
| Rate limit (ARCHITECTURE §6.9, AD-40) | **Tidak ada tabel/kolom**: penghitung di memori proses; `staff_pin_state` ditinjau (tanpa kolom baru); `pairing_code`, `app_user`, `tenant` tanpa kolom percobaan/kunci/kuota; usulan `meta.full_resync` di Dexie | Keputusan user 2026-11-18/19. Alasan per tabel: §4.1.15, §4.1.8, §4.1.18. SSE satu koneksi per device dan full resync 1/jam/device: murni server-memori (tanpa kolom). Kunci login = **akun global (email lintas slug)** + jaring longgar per IP + slug (PRD BR-RLM-003, BR-IDN-009, FR-IDN-010; ARCHITECTURE §6.9.2) — selaras; rujukan PRD: BR-RLM-009/010/011/012, FR-RLM-002/003/008. |
| PRD §6.3 entitas `tenant`: "nama tampilan dan warna tema" (BR-TEN-007) | `tenant.name`; **tidak ada** kolom warna/tema | Keputusan user 2026-11-18: tidak ada fitur/pengaturan warna tenant di MVP (tidak ada kolom, constraint, atau validasi kontras). PRD sudah menghapus warna (BR-TEN-007, FR-TEN-008); nama tenant tetap, **diatur operator platform** (OQ-S35 terjawab; FR-TEN-010). |
| ARCHITECTURE §9.7.1: 22 kode error | Lampiran A.5 diselaraskan: 22 kode tampilan + kode data `reason_code` + kode log non-tampilan; `SERVER_BEHIND` menjadi `reason_code` dari `SYNC_HELD`; `CREDENTIAL_INVALID` menjadi kode data | Daftar final kode masih OQ-A24 (ARCHITECTURE). |
| BR-LOG-010 (log device) | Dexie `device_log` (+`ref_local`, `code` katalog, `send_status`, `attempts`, `ctx`, `device_id`, `register_id`, `app_version`, `schema_version`); indeks `'++id, &ref_local, [send_status+id]'` (sebelumnya `'++id, created_at'`); nama kode `STORAGE_LOW` menggantikan `QUOTA_HIGH` | Keputusan error management 2026-11-18. **Tetap tanpa tabel log di PostgreSQL** (OQ-S18). PRD: KEP-25, BR-ERR-002/003/006, FR-ERR-002/005/006 (ID `D-…`, katalog 22 kode stabil). |
| BR-AUT-015 (`cart_draft`) | `cart_draft` ditambah `kind` (`CART`/`BILL`), `bill_id`, `bill_key`, `base_content_seq`, `table_id`, `created_at`; indeks `'id, [register_id+staff_id+status], bill_key, status'` | Pemulihan crash render + draf bill. Arti field lama (`lines`, `status`, aturan dibuang) tidak berubah. |
| BR-FNB-012 (aksi online-only) | `idempotency_command.channel` (`OUTBOX`/`ONLINE`); `device_seq` menjadi **NULL untuk `ONLINE`** | **Relaksasi** `NOT NULL` pada `device_seq` secara terbatas (CHECK tetap mewajibkannya untuk `OUTBOX`); arti kolom untuk perintah outbox tidak berubah. `EnrollDevice` tidak masuk tabel ini (§4.6.2). OQ-S32. |
| Kode error `KODE#id` (BR-LOG-008) | Katalog kode stabil (Lampiran A.5); `CHECK` format pada `attention_item.reason_code`, `device_sync_status.last_error_code/ref`; tanpa `CHECK IN` | Kode baru tanpa migrasi (DB-10). PRD baru memuat 6 kode awal. |
| Source map rilis | Berkas privat server per `app_version`; **tidak ada kolom** di `app_release` (OQ-S31) | Tidak ada logika bergantung padanya. |
| `outbox_command` (id, tipe, payload, schema_version, device_seq, status, dependency_key) | sama + `depends_on`, `attempts`, `next_retry_at`, `last_error_*`, `result`, `entity_*` | Backoff (BR-SYN-024), dependensi (BR-SYN-023), hasil ACK. |
| `local_counter`, `print_job` (Dexie) | sama | Sesuai §6.3.E PRD. |

### 7.3 Hierarki, `tenant_id`, dan RLS

| Poin | Penyelesaian |
|---|---|
| Hierarki **Tenant → Entitas Hukum → Outlet → Register (`cash_master`) → shift (`cash_cashier`)** | Direalisasikan persis: `tenant 1:N legal_entity 1:N outlet 1:N cash_master 1:N cash_cashier` (§3.1, §3.5). Device sebagai anak register (`cash_master 1:N device`, satu aktif). |
| "`tenant_id` ada di **semua** tabel" (BR-TNT-001) | Semua tabel yang memuat data tenant memiliki `tenant_id` (termasuk anak dan ledger). **Pengecualian eksplisit:** `tenant` (kunci = `id`); tabel global tanpa data tenant — `permission`, `app_release` — dan tabel milik Better Auth (di luar kamus). Dicatat agar tidak dibaca sebagai pelanggaran. |
| RLS | `ENABLE` + `FORCE`, kebijakan `tenant_id = current_setting('app.tenant_id')` (§5.6). Pencarian tenant dari slug (sebelum konteks ada) lewat fungsi `resolve_tenant_by_slug` (§5.6 butir 10), bukan `BYPASSRLS`. |
| Tambahan (bukan PRD) | **FK komposit `(tenant_id, x_id)`** sebagai pertahanan berlapis (§1.8) — disetujui user (OQ-S03). |

### 7.4 Kolom sinkronisasi (`version`, `synced_at`, `sync_status`)

Diselesaikan di **§2.1**. Ringkas: server tidak memakai `version` untuk resolusi konflik; `version` hanya posisi feed pada tabel master (BR-SYN-010). `synced_at`/`sync_status` **hanya ada di client** (Dexie). Server memakai `received_at`/`processed_at`, `idempotency_command`, dan `attention_item`. **Tidak ada resolusi konflik merge / last-write-wins**; kebijakan konflik adalah penerimaan fakta + flag (BR-SYN-030).

### 7.5 Tabel log (brief) vs PRD §5.11

Brief meminta "tabel manajemen log sesuai PRD bab 5.11". PRD memutuskan **log operasional = file JSON per baris** (stdout + file harian di volume, retensi 30 hari, dicari via skrip CLI; BR-LOG-002/011/013/014) dan **antrean log device di Dexie** (≤ 500 entri, ikut sync; BR-LOG-010); log dipisahkan dari audit log (BR-LOG-001). Karena itu **tidak ada tabel PostgreSQL untuk log operasional**. Yang tersedia di skema untuk mendukung 5.11:

| Kebutuhan PRD 5.11 | Perwujudan skema |
|---|---|
| ID referensi `YYYYMMDD-HHmmss-xxxxx` ke log | Kolom `request_ref` pada `idempotency_command`, `attention_item`, `audit_log`, `device_sync_status.last_error_ref` (korelasi baris DB ↔ baris log); ID **lokal perangkat** `D-YYYYMMDD-HHmmss-xxxxx` pada Dexie `device_log.ref_local` dan `outbox_command.last_error_ref` (OQ-S33) |
| `commandId` pada log sync = item antrean | `idempotency_command.command_id` = `attention_item.command_id` (FR-LOG-006) |
| Antrean log device | Store Dexie `device_log` (§4.6.9); kirim lewat `POST /device-log` (§6.2.1) → berkas log server |
| Penerimaan log device oleh server | Ditulis ke **file log** (cakupan `device`), bukan tabel; pembatasan laju (≤ 20 laporan/10 menit/device) dijaga di memori proses (AS-06, satu instance) |
| Audit ≠ log operasional | `audit_log` terpisah (§4.6.5) |
| Penghitung kegagalan sync terlihat manager | `device_sync_status`, `attention_item` |

Bila kelak diinginkan pencarian log di `/admin` (di luar MVP; BR-LOG-013 memilih CLI), tabel `operational_log` dapat ditambahkan tanpa mengubah tabel lain (OQ-S18).

### 7.6 Database lokal = Dexie (bukan SQLite)

Kolom "tipe lokal" pada seluruh kamus berarti **tipe TypeScript/representasi di IndexedDB** (§1.3). Konsekuensi yang diterapkan: tidak ada tipe `numeric`/`bigint` lokal — uang `number` integer aman (batas `Number.MAX_SAFE_INTEGER`), kuantitas **string** desimal, waktu ISO-8601 UTC string, tanggal `YYYY-MM-DD`; `boolean`/`null` tidak dapat diindeks sehingga memakai kunci turunan (`outlet_key`, `sku_key`); tidak ada FK/constraint di IndexedDB — integritas ditegakkan Kernel + transaksi Dexie; store Dexie, PK, dan indeks didefinisikan di §6.3.

### 7.7 Hal yang diminta brief tetapi **tidak** diadopsi / disesuaikan

| Brief | Keputusan | Alasan |
|---|---|---|
| `NUMERIC` untuk uang | `bigint` (§7.1) | PRD KEP-07. |
| `version` sebagai resolusi konflik | Posisi feed saja | PRD BR-SYN-010/011 + AP-01. |
| `synced_at`/`sync_status` universal | Hanya client | Server otoritas (§2.1). |
| FIFO/layer HPP | **Tidak dipakai** (§4.4.2) | PRD memutuskan moving average per outlet (BR-HPP-001). |
| Tabel log | Tidak ada di PostgreSQL (§7.5) | PRD BR-LOG-002/010. |
| "Harga/pajak/diskon/HPP NUMERIC" pada Dexie | `number` integer | §1.3. |

---

## 8. Matriks Traceability Tabel ↔ BR / FR PRD

Fase mengikuti PRD Bab 13 (kapan tabel pertama dibutuhkan). Tabel server dan store Dexie khusus digabung; `(D)` = hanya Dexie.

| Tabel | Modul | Fase | Business Rules | Functional Requirements | Keputusan |
|---|---|---|---|---|---|
| `tenant` | 1 | F1 | BR-TNT-001, BR-I18N-002, BR-TEN-001..007/010, BR-RLM-011 | FR-TNT-001/004, FR-TEN-001/004/006/010 | KEP-03, KEP-24 (identifikasi tenant lewat slug) |
| `legal_entity` | 1 | F1 | BR-TNT-002, BR-TAX-002/010 | FR-TNT-002 | KEP-03 |
| `outlet` | 1 | F1 | BR-TNT-003/004, BR-TIM-002/003, BR-TAX-002/003/005/009, BR-PRC-005, BR-STK-004, EC-025 | FR-TNT-003 | KEP-01/03/09 |
| `tax_rate_history` | 1 | F1/F3 | BR-TAX-001, EC-005 | FR-TNT-005, FR-POS-006 | KEP-09 |
| `register_invoice_prefix` | 1 | F1/F3 | BR-INV-003/010, BR-TNT-004 | FR-DEV-001, FR-POS-015 | KEP-04 |
| `outlet_receipt_setting` | 1 | F3 | BR-PRN-005, BR-I18N-005/007 | FR-PRN-006, FR-I18N-005 | KEP-13/17 |
| `payment_method` | 1 | F3 | BR-PAY-001/005 | FR-PAY-002, FR-ADM-003 | KEP-13 |
| `app_user` | 1 | F1 | BR-AUT-001/003/010, BR-I18N-002, BR-IDN-001..003/006/007/011/012 | FR-AUT-001/002/008, FR-IDN-001/002/007/008 | KEP-05, KEP-27 (identitas global + keanggotaan per tenant) |
| `role` | 1 | F1 | BR-AUT-009/012, BR-DSC-001/003 | FR-AUT-002 | KEP-05/10 |
| `permission` (G) | 1 | F1 | BR-AUT-009, BR-AUT-015 | FR-AUT-002, FR-AUT-010 | KEP-05/22 |
| `role_permission` | 1 | F1 | BR-AUT-009/012 | FR-AUT-002 | KEP-05 |
| `user_outlet` | 1 | F1 | BR-AUT-009 (`Y*`) | FR-AUT-002 | KEP-05 |
| `cash_master` | 1 | F1 | BR-INV-001/002, BR-TNT-004, BR-PRN-005, BR-FNB-011 | FR-DEV-001/006, FR-SHF-007, FR-FNB-015 | KEP-04/22 |
| `device` | 1 | F1 | BR-AUT-002/008/010, NFR-SEC-004 | FR-DEV-002 | KEP-05 |
| `pairing_code` | 1 | F1 | BR-AUT-002, BR-TEN-007, BR-RLM-009, NFR-SEC-005 | FR-DEV-001, FR-TEN-009, FR-RLM-003 | KEP-05, KEP-26 |
| `member_code` | 1 | F1 | BR-IDN-003/004/005/013 | FR-IDN-004/005/006/011/012/013/014 | KEP-27; DESIGN DOQ-26 (Undangan tertunda) |
| `user_pin_credential` | 1 | F3 | BR-AUT-004/014, NFR-SEC-003 | FR-AUT-004/007 | KEP-05 |
| `staff_pin` | 1 | F3 | BR-AUT-003/004 | FR-AUT-003/004 | KEP-05 |
| `staff_pin_state` | 1 | F3 | BR-AUT-005, BR-RLM-010, BR-AUD-001 | FR-AUT-003/007, FR-RLM-008 | KEP-05, KEP-26 |
| `category` | 2 | F2 | BR-CAT-001 | FR-CAT-001 | KEP-06 |
| `uom` | 2 | F2 | BR-UOM-001..005 | FR-CAT-003 | KEP-06 |
| `product` | 2 | F2 | BR-CAT-002..004, BR-TAX-008, BR-PRC-007, BR-STK-004 | FR-CAT-002/005/014 | KEP-06/11/19 |
| `product_attribute`, `attribute_value`, `sku_attribute_value` | 2 | F2 | BR-CAT-002/005 | FR-CAT-002/007 | KEP-06/11 |
| `sku` | 2 | F2 | BR-CAT-002/003/004/005 | FR-CAT-002 | KEP-06 |
| `sku_uom` | 2 | F2 | BR-UOM-002..006, BR-CAT-006/007 | FR-CAT-003/004, FR-POS-001 | KEP-06 |
| `item_outlet_availability` | 2 | F2 | BR-CAT-009..022 | FR-CAT-008..013, FR-SYN-017, FR-POS-012..014, FR-INV-011, FR-FNB-012 | KEP-18 |
| `modifier_group`, `modifier_group_product`, `modifier` | 2 | F5 | BR-PRC-006, BR-RCP-004 | FR-FNB-005 | KEP-12 |
| `modifier_ingredient` | 2 | F5 | BR-RCP-004 | FR-FNB-005/009 | KEP-08 |
| `recipe_item` | 2 | F5 | BR-RCP-001..006, BR-HPP-006 | FR-FNB-009 | KEP-08 |
| `price_entry` | 3 | F2 | BR-PRC-001..007, BR-TAX-003 | FR-PRC-001..004 | KEP-06 |
| `stock_balance` | 3 | F4 | BR-STK-001/002/004/005, BR-HPP-001..005 | FR-INV-002/003/005, FR-SYN-015 | KEP-08 |
| `stock_movement` | 3 | F4 | BR-STK-001/003/006..008, BR-HPP-003..007, BR-RCP-005 | FR-INV-002/004/005/010 | KEP-08 |
| `supplier` | 3 | F4 | BR-STK-021 | FR-INV-001 | KEP-08 |
| `goods_receipt(+line)` | 3 | F4 | BR-STK-020..022 | FR-INV-001/008/011 | KEP-08 |
| `transfer(+line)` | 3 | F4 | BR-TRF-001..004 | FR-INV-006/011 | KEP-08 |
| `stocktake(+line)` | 3 | F4 | BR-STK-030..033 | FR-INV-007 | KEP-08 |
| `cash_cashier` | 5 | F3 | BR-SHF-001..010, BR-INV-005 | FR-SHF-001..006 | KEP-04 |
| `cash_movement` | 5 | F3 | BR-SHF-004/005 | FR-SHF-002 | KEP-04 |
| `sale` | 5 | F3 | BR-INV-001..011, BR-MNY-*, BR-TAX-*, BR-DSC-*, BR-PAY-*, BR-CUS-*, BR-I18N-007 | FR-POS-006/007/014/015, FR-PRC-003 | KEP-04/07/09/10/13 |
| `sale_line` | 5 | F3 | BR-MNY-005/006, BR-UOM-006, BR-PRC-003/006/007, BR-DSC-005, BR-RTR-006, BR-HPP-004 | FR-POS-004/016 | KEP-06/07/19 |
| `sale_line_modifier` | 5 | F5 | BR-PRC-006, BR-RCP-004 | FR-FNB-005 | KEP-12 |
| `sale_payment` | 5 | F3 | BR-PAY-001..005, BR-TAX-009, BR-SHF-005 | FR-PAY-001..005 | KEP-13 |
| `credit_note`, `credit_note_line`, `credit_note_refund` | 5 | F3/F4 | BR-RTR-001..009, BR-INV-010, BR-HPP-007 | FR-RTR-001..007 | KEP-04/08 |
| `invoice_series` | 5 | F3 | BR-INV-002/006/008/010 | FR-DEV-003 | KEP-04 |
| `invoice_gap` | 5 | F3 | BR-INV-007/008, RSK-02 | FR-ADM-002, FR-DEV-003 | KEP-04 |
| `register_recovery` | 5 | F3 | BR-INV-008 | FR-DEV-003 | KEP-04 |
| `fnb_table` | 5 | F5 | BR-FNB-001 | FR-FNB-001 | KEP-12 |
| `bill`, `bill_item`, `bill_item_modifier` | 5 | F5 | BR-FNB-001..013, BR-SPL-001..007/020..024, EC-058..061 | FR-FNB-002..004/007/008/011/013..015, FR-SYN-016 | KEP-12/22 |
| `bill_event` | 5 | F5 | BR-FNB-005/010/012, BR-SYN-021 | FR-SYN-005, FR-FNB-004/013/014 | KEP-12/22 |
| `tenant_sync` | 6 | F1 | BR-SYN-010..013 | FR-SYN-001/002/003 | KEP-01 |
| `idempotency_command` | 6 | F1/F3 | BR-SYN-020..024/030, BR-LOG-009 | FR-SYN-004/006/007, FR-LOG-006 | KEP-01 |
| `attention_item` | 6 | F3 | BR-SYN-030, BR-INV-009 | FR-ADM-001 | KEP-01 |
| `data_flag` | 6 | F3 | BR-PRC-003, BR-CAT-013, BR-STK-002, BR-MNY-007, BR-INV-009 | FR-RPT-004, FR-POS-014 | KEP-01/18 |
| `audit_log` | 6 | F1/F3 | BR-AUD-001..003, BR-AUT-006/007 | FR-AUD-001..004 | KEP-15 |
| `audit_chain_head` | 6 | F3 | BR-AUD-002 | FR-AUD-004 | KEP-15 |
| `device_sync_status` | 6 | F1/F3 | BR-SYN-050/051, BR-TIM-005/006, BR-AUT-008 | FR-DEV-004/005, FR-SYN-011 | KEP-01 |
| `app_release` (G) | 6 | F1 | BR-VER-002/003/004, BR-SYN-003/022 | FR-VER-001/004, FR-SYN-013/018, FR-SYN-006 | KEP-01, KEP-23 |
| `feature_flag` | 1 | F1 | BR-VER-009, BR-AUT-009, BR-AUD-001 | FR-VER-007 | KEP-23 (versioning) |
| `outbox_command` (D) | 6 | F1/F3 | BR-SYN-020..024/030/051/052 | FR-SYN-004/010 | KEP-01 |
| `local_counter` (D) | 6 | F3 | BR-INV-002/004 | FR-POS-007, FR-SYN-014 | KEP-04 |
| `meta` (D) | 6 | F1 | BR-TIM-005, BR-AUT-008/013/015, BR-SYN-050 | FR-SYN-011, FR-AUT-006/009 | KEP-01/05/22 |
| `device_log` (D) | 6 | F3 | BR-ERR-002/003/006, BR-LOG-005/008/010 | FR-ERR-002/005, FR-LOG-005/007 | KEP-21, KEP-25 (manajemen error) |
| `stock_snapshot` (D) | 6 | F4 | BR-STK-005, BR-SYN-010 | FR-SYN-015, FR-POS-011 | KEP-08 |
| `bill_snapshot` (D) | 6 | F5 | BR-FNB-003/010/012 | FR-SYN-016, FR-FNB-013/014 | KEP-12/22 |
| `cart_draft` (D) | 5 | F3 | BR-AUT-015, BR-ERR-007 | FR-AUT-009/010, FR-ERR-006 | KEP-22, KEP-25 |
| `print_job` (D) | 5 | F3 | BR-PRN-002 | FR-PRN-002/004 | KEP-13 |
| `asset_cache` (D) | 5 | F3 | BR-PRN-003 | FR-PRN-003 | KEP-13 |

---

## 9. Open Questions Skema (seluruhnya terjawab: S01..S40 — S30 dan S34 digantikan)

> **Seluruh OQ-S01..S23 sudah dijawab user** (S01..S18 pada 2026-11-17; S19..S23 pada 2026-11-18). Prefiks `OQ-S` dipakai agar tidak bertabrakan dengan `OQ-xx` PRD. Judul tiap butir memuat jawaban; teks opsi dipertahankan sebagai jejak keputusan (seperti Bab 15 PRD). OQ-S24..S40 **sudah dijawab user** (2026-11-18/19; OQ-S30 dan OQ-S34 **digantikan** oleh model identitas global 2026-11-19). Yang **masih `PERLU KONFIRMASI`** hanyalah OQ-01(c) (outlet campuran PPN+PB1) dan konfirmasi akuntan/auditor atas perlakuan hukum (Bab 10). Dua catatan penerapan:
> 1. **OQ-S04 (direvisi 2026-11-18):** **hanya tarif pajak** yang berlaku-mulai, disimpan di tabel riwayat `tax_rate_history` (kode pajak + outlet opsional); tarif service charge, mode harga, profil pajak, SC aktif, dan SC kena pajak berada di `outlet` dan berlaku langsung.
> 2. **OQ-S02 (direvisi 2026-11-19):** login `/admin` **hanya email + password** lewat **identitas global** (satu email = satu akun) dengan **keanggotaan per tenant**; memperluas/mengubah BR-AUT-001; **PRD direvisi paralel**.

| ID | Topik | Jawaban | Tabel terdampak |
|---|---|---|---|
| OQ-S01 | Skema hash PIN per device | A — verifier server + HMAC per device | `user_pin_credential`, `staff_pin`, `staff_pin_state` |
| OQ-S02 | `app_user` vs tabel `user` Better Auth | A — terpisah; **rev. 2026-11-19:** `app_user` = profil/keanggotaan per tenant → **identitas global** BA (satu email = satu akun); login hanya email; staf PIN-only tanpa identitas global (menggantikan "satu orang = satu tenant", login username, dan akun per tenant) | `app_user`, `tenant` |
| OQ-S03 | FK komposit tenant-aman | A — semua tabel | semua |
| OQ-S04 | Cakupan konfigurasi berlaku-mulai | B — hanya tarif pajak, di tabel riwayat `tax_rate_history` | `tax_rate_history`, `outlet` |
| OQ-S05 | Format nomor dokumen GR/transfer/opname | A — `GR-OUT01-1126-0001` dst. | `goods_receipt`, `transfer`, `stocktake` |
| OQ-S06 | Penyimpanan logo struk | B — berkas di folder server | `outlet_receipt_setting` |
| OQ-S07 | Strategi hash berantai audit | A — satu rantai ketat per tenant | `audit_log`, `audit_chain_head` |
| OQ-S08 | Proyeksi open bill & diskon pada open bill | A — proyeksi `bill_item` + event tambahan | `bill`, `bill_item`, `bill_event` |
| OQ-S09 | Retensi `idempotency_command` | A — simpan baris, kosongkan `result` lama | `idempotency_command` |
| OQ-S10 | Nomor konflik `-Dn` dan status gap `FILLED` | A — akhiran di nomor + `FILLED` otomatis | `sale`, `credit_note`, `invoice_gap` |
| OQ-S11 | Presisi `numeric(18,4)` | `numeric(18,4)` | kolom kuantitas |
| OQ-S12 | Kode permission & masking telepon | `customer.view_phone` → Owner & Manager | `permission`, `role_permission` |
| OQ-S13 | Satuan persentase | persen desimal `numeric(7,4)` | kolom persen |
| OQ-S14 | Satu device aktif per register | A — maksimal satu | `device` |
| OQ-S15 | Penugasan tenant-wide | A — `outlet_id NULL` = semua outlet (termasuk baru) | `user_outlet` |
| OQ-S16 | Pemodelan `SHARE`/`STOCK_BASIS` dan void | A — `line_kind` + kolom `void_*` di `sale` | `sale_line`, `sale` |
| OQ-S17 | Rekap shift | kolom `recap_*` + view | `cash_cashier` |
| OQ-S18 | Tabel log operasional untuk `/admin` | tidak ada tabel; skrip CLI | — |
| OQ-S19 | Representasi serah-terima & "menunggu bayar" di `bill` | A — kolom di `bill` + riwayat dari `bill_event`; tanpa tabel riwayat; tanpa `audit_log` | `bill`, `bill_event` |
| OQ-S20 | Pemegang bill: register atau device | A — simpan keduanya (`lease_register_id` + `lease_device_id`) | `bill` |
| OQ-S21 | `bill_seq` event serah-terima | A — server menetapkan `last_event_seq + 1` | `bill_event` |
| OQ-S22 | Kunci layar, `cart_draft`, permission override, jenis register | `cart_draft` di Dexie (lokal); `screen.unlock_override` (Supervisor, Manager, Owner); `register_type` tidak boleh diubah saat shift/bill `OPEN`; audit hanya override + kunci PIN | `cash_master`, `permission`, Dexie |
| OQ-S23 | Daftar register tujuan serah-terima | A — device mengunduh seluruh register outlet | `cash_master` |
| OQ-S31 | Referensi source map di `app_release` | **TERJAWAB 2026-11-18** — A: berkas privat per `app_version`, tanpa kolom | `app_release` |
| OQ-S32 | Kunci idempoten aksi online-only non-outbox | **TERJAWAB 2026-11-18** — A: `idempotency_command.channel` (`device_seq` NULL untuk `ONLINE`); enroll lewat `pairing_code` | `idempotency_command` |
| OQ-S33 | Format ID referensi lokal `device_log` | **TERJAWAB 2026-11-18** — A: `D-YYYYMMDD-HHmmss-xxxxx` | `device_log`, `request_ref` |
| OQ-S27 | Tempat daftar kata terlarang slug | **TERJAWAB 2026-11-18** — A: konstanta di kode + uji rute (bukan tabel) | `tenant.slug` |
| OQ-S28 | Penegakan slug permanen di database | **TERJAWAB 2026-11-18** — A: trigger `BEFORE UPDATE OF slug` | `tenant.slug` |
| OQ-S29 | Domain kustom per tenant | **TERJAWAB 2026-11-18** — ditunda; tanpa kolom/tabel di MVP (kelak `tenant_domain` aditif) | `tenant` |
| OQ-S30 | Pemetaan identitas Better Auth ke username/email per tenant | **TERJAWAB 2026-11-18, DIGANTIKAN 2026-11-19** oleh identitas global + keanggotaan (OQ-S02 rev., OQ-S37) | `app_user`, tabel BA |
| OQ-S34 | Detail pemetaan Better Auth (alias email, verifikasi, cookie, hapus akun) | **TERJAWAB 2026-11-19 — digantikan**: alias tidak dipakai, verifikasi email tidak dipakai, soft delete = hapus keanggotaan; cookie sesi per slug (OQ-S37) | `app_user`, tabel BA |
| OQ-S35 | Pengelola nama tenant | **TERJAWAB 2026-11-18** — operator platform saat pembuatan; perubahan lewat operator; tanpa layar Owner di MVP | `tenant.name` |
| OQ-S36 | Rincian rate limit lokal (basis jam PIN, `ReportPinState`, `meta.full_resync`) | **TERJAWAB 2026-11-19** — A: `locked_until` + `meta.clock.max_seen_time` tanpa kolom baru; laporan saat `lock_tier` berubah; `meta.full_resync` ditambahkan | `staff_pin_state`, Dexie `meta` |
| OQ-S37 | Model identitas global + keanggotaan: sumber kebenaran, peran BA, email, ganti email, `auth_user_id`, kunci rate limit, cookie sesi | **TERJAWAB 2026-11-19** — semua asumsi diterima (`app_user` sumber kebenaran, `member` cermin kasar; email tak disalin; ganti email oleh pemilik/operator; `auth_user_id` dipertahankan; kunci rate limit = email lintas slug); **cookie sesi PER SLUG** | `app_user`, tabel BA |
| OQ-S38 | Undangan & reset password tanpa email; pencegahan pengambilalihan lintas tenant | **TERJAWAB 2026-11-19** — mekanisme **B**: kode sekali pakai terikat email (undangan 72 jam, reset 24 jam), bukan password sementara; Owner hanya mereset akun yang hanya di tenantnya (dicek saat terbit dan tukar) | `member_code`, `app_user` |
| OQ-S39 | Detail tabel `member_code` (`tenant_id`, panjang kode, email terikat, retensi, penukaran, hitungan keanggotaan, pra-klaim email) | **TERJAWAB 2026-11-19** — semua asumsi diterima; risiko pra-klaim email **diterima di MVP** dengan mitigasi (verifikasi email kelak) | `member_code` |
| OQ-S40 | Dukungan `member_code` untuk daftar "Undangan tertunda" (Batalkan, Terbitkan ulang) | **TERJAWAB 2026-11-19** — semua asumsi diterima: `revoked_at` + `revoke_reason` (`CANCELED`/`REPLACED`); tautan pengganti hanya di `audit_log`; satu kode aktif per `(app_user_id, kind)`; `issued_by` + `audit_log.actor` tanpa `revoked_by`; Batalkan murni-undangan men-soft-delete profil `PENDING`; hapus fisik 7 hari + profil `PENDING` yatim di-soft-delete; satu indeks sederhana | `member_code`, `app_user` |
| OQ-S25 | Tempat versi minimum klien | **TERJAWAB 2026-11-19** — A: kolom di baris `app_release` terbaru | `app_release` |
| OQ-S26 | Cakupan & bentuk feature flag | **TERJAWAB 2026-11-19** — per tenant, boolean + `params` opsional, berlaku setelah siklus pull | `feature_flag` |
| OQ-S24 | Bentuk prefiks invoice (2–16 karakter, hubung di dalam, bukan berakhir `NK`, wajib `CASHIER`, unik lintas riwayat, kode terkunci) | **TERJAWAB 2026-11-19** — semua asumsi diterima | `register_invoice_prefix`, `cash_master`, `sale`, `credit_note` |

---

**OQ-S01 — Skema hash PIN per device — `TERJAWAB` (2026-11-17): opsi A — verifier server + HMAC per device.** PRD: hash lambat dengan **salt per device**, hash+permission disinkron (BR-AUT-004); salt berbeda membuat hash berbeda tiap device (FR-AUT-004). *Masalah:* server hanya dapat menghitung hash untuk device tertentu bila **mengetahui PIN** saat itu; device yang di-enroll **setelah** PIN ditetapkan tidak dapat diberi hash tanpa PIN polos.
- **A — Verifier server + HMAC per device** *(dipakai sebagai asumsi)*: `user_pin_credential.verifier = slow_hash(PIN, salt_user)`; `staff_pin.pin_hash = HMAC(device_salt, verifier)`. Device baru dapat diberi hash tanpa PIN; reset PIN menghitung ulang semua baris. Brute-force offline tetap memerlukan hash lambat per tebakan. Menambah satu tabel server-saja dan memperlihatkan `kdf_salt` ke device.
- **B — Hash lambat langsung per (user, device)** (harfiah): sederhana, tetapi PIN harus dimasukkan ulang oleh manager/staf untuk **setiap device baru** (atau disimpan polos sementara — tidak diinginkan).
- **C — PIN diatur langsung di device** (tak ada hash di server): menghilangkan reset terpusat dan sinkron hash; bertentangan dengan BR-AUT-004/FR-AUT-007.
*Dampak:* struktur 3 tabel PIN, alur enrollment device (FLOW-01) dan reset PIN (FR-AUT-007). *Asumsi:* **A**.

**OQ-S02 — `app_user` terpisah dari tabel `user` Better Auth — `TERJAWAB` (2026-11-17; direvisi 2026-11-18 dan **2026-11-19**): `app_user` terpisah dari `user` Better Auth sebagai **profil/keanggotaan per tenant** yang menunjuk **satu identitas global** (`auth_user_id`); login `/admin` **hanya email + password**; staf non-manager boleh punya akun; staf kasir boleh `app_user` tanpa identitas global. ~~satu orang = satu tenant~~ dan ~~username/email per tenant~~ (2026-11-18) **dicabut**.** Better Auth memiliki `user`/`organization`/`member`; staf kasir tidak punya email.
- **A — `app_user` bertenant terpisah**, tautan opsional `auth_user_id` *(asumsi)*: staf PIN-only tanpa akun BA; tenant = organisasi BA lewat `tenant.auth_org_id`. Dua sumber identitas yang harus dijaga sinkron untuk pengguna back-office.
- **B — Memperluas tabel `user` Better Auth** dengan kolom bisnis: satu sumber, tetapi memaksa staf PIN-only memiliki baris BA, RLS dan tenant pada tabel milik library, dan membuat sync master bergantung pada skema library.
Sub-pertanyaan: keunikan `display_name` per tenant (diasumsikan unik di antara yang aktif). *Dampak:* RLS, feed sync, login. *Asumsi:* A.
**Revisi 2026-11-18 (identifikasi tenant lewat slug dan email antar tenant):** (1) keunikan `username` **per tenant** (`UQ (tenant_id, username)`); (2) **email boleh sama di tenant berbeda** — `UQ (tenant_id, email)`; sebelumnya "satu orang = satu tenant" dan asumsi OQ-S30 "email unik se-sistem" **dicabut**; (3) orang yang sama di dua tenant = **dua `app_user` dan dua akun Better Auth** (password, sesi, reset password terpisah; tidak ada tabel "orang" lintas tenant); (4) login di-scope slug. Keputusan OQ-S02 lain (terpisah dari `user` BA, email **atau** username, staf non-manager boleh akun, `display_name` unik di antara yang aktif) **tidak berubah**. Pemetaan BA → OQ-S30 (terjawab) dan OQ-S34 (detail).

**Revisi 2026-11-19 (identitas global + keanggotaan per tenant) — menggantikan butir (2)–(4) revisi di atas:** (1) **satu email = satu akun Better Auth global** (email unik se-sistem, satu password); (2) `app_user` = **profil/keanggotaan per tenant** yang menunjuk satu identitas (`auth_user_id`), `UQ (tenant_id, auth_user_id)`; staf kasir tetap boleh `app_user` **tanpa** identitas global; (3) login back-office **hanya email** — kolom `username` dan `email` dihapus dari `app_user`; (4) tenant = *organization* BA (`tenant.auth_org_id`), keanggotaan aktif = `member`; (5) mengeluarkan anggota = hapus keanggotaan di tenant itu (identitas global tetap); (6) cookie sesi **per slug** (login terpisah per tenant, akun global; 2026-11-19 akhir). Detail: §4.1.8; OQ-S37/S38 terjawab, OQ-S39 terjawab. **Opsi yang dipertimbangkan dan ditolak:** akun terpisah per tenant (OQ-S30 lama) — membuat orang yang sama memiliki banyak password; satu `user` BA = satu tenant — tidak mendukung satu orang di banyak tenant.

**OQ-S03 — FK komposit tenant-aman — `TERJAWAB` (2026-11-17): opsi A — FK komposit di semua tabel bertenant.** FK `(tenant_id, x_id)` mencegah rujukan lintas tenant karena pemeriksaan FK tak tunduk RLS (§1.8).
- **A — FK komposit di semua tabel bertenant** *(asumsi)*: pertahanan berlapis; +satu `UNIQUE (tenant_id, id)` per tabel induk.
- **B — FK sederhana pada `id`**: skema lebih ringkas; bergantung pada kode aplikasi + RLS agar tidak merujuk lintas tenant.
*Dampak:* ukuran indeks (kecil), kompleksitas definisi Drizzle. *Asumsi:* A.

**OQ-S04 — Cakupan konfigurasi berlaku-mulai — `TERJAWAB` (2026-11-17): opsi B — hanya tarif pajak berlaku-mulai (tabel `tax_rate_history`).** BR-TAX-001 hanya mewajibkan `berlaku_mulai` untuk **tarif**. Opsi awal: apakah `price_tax_mode` dan SC ikut dijadwalkan (EC-025 menyatakan perubahan mode berlaku ke depan); `cash_rounding_unit` tetap di `outlet` (disalin sebagai snapshot ke transaksi).
- **A** — `price_tax_mode`, `tax_profile`, `tax_rate`, SC **semua** berlaku-mulai *(asumsi)*; unit pembulatan di `outlet`.
- **B** — hanya `tax_rate` berlaku-mulai; mode/SC langsung di `outlet`.
- **C** — semuanya (termasuk unit pembulatan) berlaku-mulai.
*Dampak:* pemilihan konfigurasi per transaksi di Kernel (`business_date`), jumlah baris feed. *Bergantung pada OQ-01.* **Dijawab: B.** *Penerapan (direvisi 2026-11-18):* hanya tarif **pajak** di `tax_rate_history` (BR-TAX-001); tarif SC, mode harga, profil pajak, SC aktif/kena pajak di `outlet` dan berlaku langsung (EC-025). *Konsekuensi diterima:* tablet yang sinkron lebih dulu berganti mode lebih dulu; disarankan mengubahnya di luar jam operasional.

**OQ-S05 — Nomor dokumen GR/transfer/opname — `TERJAWAB` (2026-11-17): opsi A — `GR-{OUTLET}-{MMYY}-{URUT4}`.** PRD hanya menyebut dokumen; nomor tidak wajib tanpa celah.
- **A — `GR-{OUTLET}-{MMYY}-{URUT4}`, `TRF-…`, `OPN-…`**, diberi server di bawah lock counter dokumen per (outlet, jenis, periode) *(asumsi)*.
- **B — nomor acak pendek** (tanpa urutan).
*Dampak:* satu tabel counter kecil (atau `MAX+1` di bawah lock), tampilan audit. *Asumsi:* A (counter dokumen dalam `STD-D.doc_no`; tabel counter ditentukan saat implementasi F4).

**OQ-S06 — Penyimpanan logo struk — `TERJAWAB` (2026-11-17): opsi B — berkas di folder server (`logo_object_key`).** Logo di-cache device sebagai bitmap (BR-PRN-003).
- **A — `bytea` ≤ 64 KB di `outlet_receipt_setting`** *(asumsi; VPS tunggal)*.
- **B — object storage / berkas volume** + kolom `logo_object_key`: DB lebih ramping; menambah dependensi operasional.
*Dampak:* backup, ukuran feed (logo tidak ikut feed baris karena diunduh terpisah). *Dijawab: B* (berkas di folder server; kolom `logo_png` diganti `logo_object_key`).

**OQ-S07 — Strategi hash berantai audit — `TERJAWAB` (2026-11-17): opsi A — satu rantai ketat per tenant.** BR-AUD-002 mengusulkan hash berantai **per tenant** (P1).
- **A — Rantai ketat per tenant** dengan `audit_chain_head` terkunci *(asumsi)*: sederhana, tamper-evident per entri; serialisasi tulis audit per tenant (diterima: lock ditahan sangat singkat di akhir transaksi, beban ≪ kapasitas).
- **B — Rantai per (tenant, outlet)**: paralelisme lebih baik; verifikasi per outlet; bertentangan dengan frasa "per tenant".
- **C — Hash baris tanpa rantai + segel batch periodik** (`audit_seal`): tanpa lock panas; deteksi pada granularitas batch.
*Dampak:* throughput `FinalizeSale` pada tenant besar; kompleksitas verifikasi. *Asumsi:* A.

**OQ-S08 — Proyeksi open bill di server & diskon pada open bill — `TERJAWAB` (2026-11-17): opsi A — proyeksi `bill_item` + event `DISCOUNT_SET`/`BILL_SPLIT`/`BILL_MERGED`.** PRD: status diturunkan dari event; open bill terlihat read-only oleh device lain lewat snapshot; split/merge memindahkan item; diskon bill induk dipakai saat split (BR-SPL-004) tetapi **daftar event BR-FNB-005 tidak memuat event diskon/split/merge**.
- **A — Proyeksi `bill`, `bill_item(+modifier)` diperbarui server dari event + event tambahan `DISCOUNT_SET`/`BILL_SPLIT`/`BILL_MERGED`** *(asumsi)*.
- **B — Tanpa proyeksi item**: server menyimpan hanya `bill_event`; snapshot dibangun dengan memutar ulang event tiap pull (lebih sedikit tabel; lebih mahal dan rumit untuk merge/split).
- **C — Diskon bill hanya diterapkan saat pembayaran** (bukan disimpan di open bill): menghilangkan `DISCOUNT_SET` dan kolom diskon di `bill`, tetapi split dengan "diskon bill induk" tidak dapat dihitung sebelum bayar.
*Dampak:* ukuran skema F5, snapshot open bill (FR-SYN-016). *Asumsi:* A.

**OQ-S09 — Retensi `idempotency_command` dan partisi — `TERJAWAB` (2026-11-17): opsi A — simpan baris, kosongkan `result` lama.** OQ-03 PRD: simpan semua (ditinjau ulang sebelum produksi jangka panjang). Tabel ini harus unik global per `command_id` sehingga tidak dapat dipartisi tanpa kunci partisi di PK.
- **A — Simpan penuh; kosongkan `result` untuk perintah > N bulan** *(asumsi; N = 12 bulan, `DIUSULKAN`, konstanta `IDEMPOTENCY_RESULT_RETENTION_MONTHS` di `modules/sync`)*; idempotensi aman karena pengiriman ulang hanya terjadi saat pending (hari–pekan).
- **B — Hapus baris `ACKED` > N bulan** (N ≥ batas toleransi versi & ekspor file, mis. 12 bulan): menghemat ruang; risiko kecil idempotensi untuk impor file ekspor sangat lama.
- **C — Partisi dengan PK `(command_id, received_at)`** + indeks unik global terpisah: rumit.
*Dampak:* ukuran DB (§6.5), kebijakan retensi (RSK-12). *Asumsi:* A. *Terkait:* tinjauan retensi tabel besar bersama akuntan (OQ-03).

**OQ-S10 — Nomor konflik `-Dn` dan status gap `FILLED` — `TERJAWAB` (2026-11-17): opsi A — akhiran `-Dn` pada nomor + gap otomatis `FILLED`.** BR-INV-009: nomor tampilan akhiran `-D1`; BR-INV-007: status gap `OPEN`/`EXPLAINED`.
- **A — `invoice_no` memuat akhiran** + `invoice_conflict_idx` terpisah *(asumsi)*; gap tambah `FILLED`.
- **B — `invoice_no` asli dipertahankan unik via kolom tampilan `display_no`**: memecah `UQ (tenant_id, invoice_no)` menjadi dua kolom.
- **C — Gap tidak pernah `FILLED`**: gap hanya `EXPLAINED`; nomor terlambat tercatat sebagai anotasi.
*Dampak:* integritas `UQ`, laporan gap. *Asumsi:* A.

**OQ-S11 — Presisi kuantitas — `TERJAWAB` (2026-11-17): `numeric(18,4)`.** PRD menetapkan **scale 4** (OQ-09) tetapi tidak presisi total. Asumsi `numeric(18,4)` (batas ±10¹⁴): jauh melampaui kebutuhan; alternatif `numeric(14,4)` (≈ 10¹⁰) menghemat sedikit ruang. *Asumsi:* `(18,4)`.

**OQ-S12 — Nama kode permission & masking telepon — `TERJAWAB` (2026-11-17): `customer.view_phone` untuk Owner dan Manager; kode lain dikunci saat seed F1.** BR-AUT-009 hanya menamai `discount.approve`, `return.approve`, `shift.view_variance`. Lainnya (`sale.create`, `bill.edit`, `bill.void_item`, `discount.manual`, `sale.void`, `shift.open_close`, `cash.in_out`, `shift.force_close`, `gap.annotate`, `catalog.manage`, `inventory.manage`, `user.manage`, `report.view`, `audit.view`, `drawer.open`) adalah **usulan**. BR-CUS-002 menyebut "permission khusus" untuk melihat telepon tanpa nama → diusulkan `customer.view_phone`. *Asumsi:* daftar di §4.1.10; dikunci saat seed F1.

**OQ-S13 — Satuan penyimpanan persentase — `TERJAWAB` (2026-11-17): persen desimal `numeric(7,4)`.** `numeric(7,4)` dalam persen (`11.0000`) *(asumsi)* vs bilangan bulat basis point (`1100`). Persen desimal selaras contoh PRD dan Zod/Kernel decimal; basis point menghindari `numeric` untuk tarif tetapi mengorbankan keterbacaan. *Asumsi:* persen `numeric(7,4)`.

**OQ-S14 — Satu device aktif per register — `TERJAWAB` (2026-11-17): opsi A — maksimal satu device aktif per register.** AS-02 menyatakan tiap device (termasuk HP waiter) adalah register sendiri; pergantian device lewat cabut + enroll (FLOW-16). Constraint `UQ (register_id) WHERE revoked_at IS NULL` melarang dua device aktif pada satu register karena counter nomor lokal akan bertabrakan.
- **A — Maksimal satu aktif** *(asumsi)*.
- **B — Beberapa device aktif per register** dengan alokasi blok nomor: bertentangan dengan seri per register tanpa celah (BR-INV-002).
*Dampak:* `device`, alur pemulihan. *Asumsi:* A.

**OQ-S15 — Penugasan tenant-wide — `TERJAWAB` (2026-11-17): opsi A — `NULL` = semua outlet, otomatis termasuk outlet baru.** PRD §3.2: Owner "semua outlet". Dipetakan `user_outlet.outlet_id IS NULL` = semua outlet (termasuk outlet yang dibuat kemudian).
- **A — NULL = semua outlet** *(asumsi)*.
- **B — Baris eksplisit per outlet**: lebih seragam, tetapi harus dibuat ulang saat outlet baru dibuat.
*Dampak:* feed `user_outlet`, otorisasi. *Asumsi:* A.

**OQ-S16 — Pemodelan `SHARE`/`STOCK_BASIS` dan void — `TERJAWAB` (2026-11-17): opsi A — `line_kind` di `sale_line` + kolom `void_*` di `sale`.** (a) Bagi rata (BR-SPL-007) memerlukan baris sintetis "Bagian k/N" dan **daftar item induk tak tercetak** sebagai dasar konsumsi pada anak pertama yang lunas. *A — `sale_line.line_kind` (`ITEM`/`SHARE`/`STOCK_BASIS`)* (asumsi) · *B — tabel `sale_consumption_basis` terpisah* (kolom `sale_line` tetap bersih; satu join tambahan) · *C — konsumsi dihitung dari `bill_item` induk tanpa menyalin ke `sale`* (tidak mandiri). (b) Void: kolom `void_*` pada `sale` *(asumsi)* vs tabel `sale_void` terpisah agar `sale` sepenuhnya immutable. *Asumsi:* A dan kolom `void_*`.

**OQ-S17 — Rekap shift — `TERJAWAB` (2026-11-17): kolom `recap_*` + view.** Kolom `recap_*`/`expected_cash`/`variance` di `cash_cashier` (hasil hitung ulang server, BR-SHF-008) *(asumsi)* vs hanya view `v_shift_recap`. Kolom mempercepat R-03 dan menjadikan angka server tercatat; harus dijaga ulang bila ada perintah terlambat. *Asumsi:* kolom + view.

**OQ-S18 — Tabel log operasional untuk `/admin` — `TERJAWAB` (2026-11-17): tidak ada tabel; skrip CLI cukup.** PRD memilih skrip CLI (BR-LOG-013). Bila kelak ingin pencarian di `/admin`: tabel `operational_log` (retensi 30 hari, indeks `(tenant_id, request_ref)`) atau impor file ke penyimpanan terpisah. *Asumsi:* tidak ada tabel (sesuai PRD).

> **OQ-S19..S23 (2026-11-18)** berasal dari PRD (KEP-22) dan **dijawab user pada hari yang sama**: seluruhnya memilih opsi yang sebelumnya menjadi asumsi, sehingga **tidak ada perubahan struktur**.

**OQ-S19 — Representasi serah-terima & "menunggu bayar" di `bill` — `TERJAWAB` (2026-11-18): opsi A — kolom serah-terima di `bill` + riwayat pemegang diturunkan dari `bill_event`; tanpa tabel riwayat; serah-terima tidak masuk `audit_log`.** PRD: pemegang berpindah hanya lewat `BILL_ACCEPTED`; status "menunggu diterima" masih dimiliki pengirim dan read-only; "menunggu bayar" diturunkan dari `PREBILL_PRINTED` terbaru vs event isi terakhir; jejak serah-terima ada di event, bukan audit tersendiri (BR-FNB-010/012 `DIUSULKAN`).
- **A — Kolom di `bill` (`handover_status`, `handover_target_register_id`, `handover_event_id`, `prebill_seq`, `last_content_seq`, `is_awaiting_payment` turunan) + riwayat pemegang diturunkan dari `bill_event`** *(asumsi)*: snapshot open bill langsung memuatnya; tanpa tabel baru.
- **B — Tabel `bill_lease_transfer` (bill, dari, ke, status, waktu)**: riwayat eksplisit dan mudah dilaporkan; satu tabel dan satu penulisan tambahan per serah-terima.
- **C — Tanpa kolom turunan**: status diturunkan dengan memutar ulang event tiap pull: lebih sedikit kolom, lebih mahal untuk snapshot.
Sub-butir: apakah serah-terima perlu entri `audit_log` (PRD: tidak). *Dampak:* snapshot open bill (FR-SYN-016), laporan bill yatim/menunggu lama. **Dijawab: A.**

**OQ-S20 — Pemegang bill: register atau device — `TERJAWAB` (2026-11-18): opsi A — simpan `lease_register_id` dan `lease_device_id`.** BR-FNB-003 menyatakan lease milik **device**; BR-FNB-012 menyatakan lease berpindah ke **register** penerima. Satu register hanya memiliki satu device aktif (BR-INV-001), tetapi device register bisa diganti (cabut + enroll).
- **A — Simpan `lease_register_id` dan `lease_device_id`** *(dipilih)*: pemegang efektif = device aktif register itu; bila device register diganti, bill tetap milik register tetapi `lease_device_id` menunjuk device lama sampai diselaraskan oleh manager (bill tampil yatim).
- **B — Hanya `lease_register_id`**: bill ikut register ke device baru; bertentangan dengan frasa "bukan take-over, device pemegang rusak ⇒ bill menunggu" (BR-FNB-004).
- **C — Hanya `lease_device_id`** (kondisi sebelum 0.97): serah-terima menyalin ke device aktif register tujuan.
*Dampak:* `bill`, aturan pemulihan device (FLOW-16). **Dijawab: A.**

**OQ-S21 — `bill_seq` untuk event yang ditetapkan server — `TERJAWAB` (2026-11-18): opsi A — server menetapkan `bill_seq = last_event_seq + 1` pada event serah-terima.** Event serah-terima dijalankan online; `bill_seq` biasanya ditetapkan pemegang.
- **A — Server menetapkan `bill_seq = last_event_seq + 1`**; pemegang baru melanjutkan dari `last_event_seq` yang diunduh bersama bill *(asumsi)*.
- **B — Pemegang yang menjalankan aksi (pengirim/penerima) menetapkan `bill_seq`** seperti event lain; server memvalidasi urutan.
*Dampak:* pemrosesan `AppendBillEvents`, balapan accept/cancel (EC-061). **Dijawab: A.**

**OQ-S22 — Kunci layar, `cart_draft`, permission override, jenis register — `TERJAWAB` (2026-11-18): `cart_draft` di Dexie (lokal, tidak disinkron); `screen.unlock_override` untuk Supervisor, Manager, Owner; `register_type` **tidak boleh** diubah saat shift atau bill `OPEN`; audit hanya `screen.unlock_override` dan kunci PIN berulang.** BR-AUT-015 (pembuka kunci dan audit `DIUSULKAN`), FR-DEV-006 (jenis tak dapat diubah saat shift/bill terbuka `DIUSULKAN`).
- Draf keranjang disimpan di Dexie `cart_draft` (lokal, tak disinkron) *(asumsi)* vs hanya memori + persist saat kunci.
- Nama kode permission `screen.unlock_override` (Supervisor, Manager, Owner) *(asumsi)* vs memakai `shift.open_close` milik peran supervisor.
- Larangan ubah `register_type` saat shift/bill `OPEN` sebagai trigger *(asumsi)*.
- Audit hanya `screen.unlock_override` dan kunci PIN berulang (PRD); tanpa kolom/tabel server tambahan.
*Dampak:* ukuran Dexie (kecil), seed permission. **Dijawab:** semua butir bertanda asumsi dipilih; larangan ubah `register_type` saat shift/bill `OPEN` dikonfirmasi.

**OQ-S23 — Daftar register tujuan serah-terima — `TERJAWAB` (2026-11-18): opsi A — device mengunduh seluruh register outlet.** Waiter memilih register `CASHIER` tujuan; label "bill masuk" menampilkan register asal.
- **A — Device mengunduh seluruh register outlet** (`cash_master` ↓ filter outlet) *(asumsi)*: kecil, memudahkan label dan memilih tujuan; menyimpang dari "hanya register device itu".
- **B — Daftar tujuan diambil online saat tombol Serahkan ditekan**: `cash_master` tetap hanya register sendiri; serah-terima memang online-only.
*Dampak:* filter pull `cash_master`, ukuran Dexie (± puluhan baris). **Dijawab: A.**


**OQ-S24 — Bentuk prefiks nomor invoice per register — `TERJAWAB` (2026-11-19): semua asumsi diterima (2–16 karakter, hubung di dalam, bukan berakhir `NK`; wajib `CASHIER`; unik lintas riwayat; kode outlet/register terkunci).** Keputusan user (2026-11-18, PRD): nomor `{PREFIKS}-{MMYY}-{URUT6}`; prefiks per register, **wajib**, **unik per tenant**. Yang tidak ditetapkan dan menjadi asumsi skema:
- **Bentuk:** huruf besar/angka, tanda hubung hanya di dalam, 2–16 karakter, **segmen terakhir bukan `NK`** *(asumsi)*; alternatif: tanpa tanda hubung, maks 10 karakter (seperti awalan lama) — contoh nomor di PRD (`OUT01-POS02-…`) lalu tidak lagi valid sebagai satu prefiks.
- **Wajib untuk siapa:** hanya register `CASHIER` *(asumsi; `WAITER` tidak menerbitkan invoice, BR-FNB-011)* vs semua register.
- **Keunikan:** tidak boleh dipakai register lain **seumur riwayat** (termasuk prefiks lama) *(asumsi)* vs hanya di antara prefiks yang sedang berlaku.
- **Kode outlet/register:** tetap tak dapat diubah setelah ada transaksi *(asumsi, kehati-hatian)* vs dibebaskan karena tak lagi membentuk nomor.
*Dampak:* `register_invoice_prefix`, form pembuatan register, validasi nomor, contoh V-29. **Dijawab:** semua butir bertanda asumsi diterima.


**OQ-S27 — Tempat menyimpan daftar kata terlarang slug — `TERJAWAB` (2026-11-18): opsi A — konstanta di kode (`contracts`) + validator + uji rute; bukan tabel.** Keputusan user: kata seperti platform, admin, pos, api, health, assets, login, static, www dan serupa tidak boleh menjadi slug.
- **A — Konstanta di kode (`contracts`) + validator + uji yang mencocokkan segmen rute tingkat-atas** *(asumsi)*: kata baru (rute baru) tanpa migrasi; daftar selalu sejalan dengan route tree. Kelemahan: penulisan langsung ke database melewati validator (pembuatan tenant hanya lewat aplikasi/skrip ops).
- **B — `CHECK (slug <> ALL (ARRAY[...]))`** : tegas di database, tetapi setiap kata baru memerlukan migrasi; kata baru yang bentrok dengan slug lama gagal tanpa `NOT VALID`.
- **C — Tabel global `reserved_slug` + trigger**: dapat diubah tanpa deploy, tetapi satu tabel dan satu trigger tambahan, dan daftar terpisah dari route tree.
*Dampak:* `tenant.slug`, pembuatan tenant, uji rute. Tenant lama yang slug-nya kelak menjadi kata terlarang tetap sah (daftar hanya berlaku untuk pembuatan baru). **Dijawab: A.**

**OQ-S28 — Penegakan slug permanen — `TERJAWAB` (2026-11-18): opsi A — trigger `BEFORE UPDATE OF slug` di database.** Keputusan user: slug tidak dapat diubah setelah dibuat.
- **A — Trigger `BEFORE UPDATE OF slug`** yang menolak perubahan nilai *(asumsi)*: berlaku untuk **semua** peran (termasuk pemilik tabel); hanya superuser yang dapat mematikannya (`ALTER TABLE … DISABLE TRIGGER`); tak terpengaruh kolom baru.
- **B — Cabut hak `UPDATE` pada kolom**: PostgreSQL tidak mengizinkan mencabut satu kolom bila peran memiliki `UPDATE` tingkat tabel; harus `REVOKE UPDATE` tabel lalu `GRANT UPDATE (kolom lain…)`, sehingga **setiap kolom baru wajib di-GRANT** (rawan terlupa, bertentangan dengan migrasi aditif DB-10); peran migrasi/pemilik tetap dapat mengubah.
- **C — Hanya validasi aplikasi**: paling lemah.
*Dampak:* `tenant`, uji skema (uji "UPDATE slug ditolak"). A dapat ditambah B sebagai lapisan kedua. **Dijawab: A.**

**OQ-S29 — Domain kustom per tenant — `TERJAWAB` (2026-11-18): ditunda; tanpa kolom atau tabel di MVP.** Keputusan user: **jangan menambah kolom** untuk domain kustom sekarang. Bila kelak diputuskan: tabel terpisah `tenant_domain` (`tenant_id`, `host` unik global, status verifikasi) — **aditif** (DB-10) sehingga tidak ada perubahan pada `tenant`; `resolve_tenant_by_slug` diperluas dengan pencarian per host, slug tetap pengenal internal; nama database Dexie tetap `tenant_id` sehingga **tidak terpengaruh**. *Dampak sekarang:* tidak ada. **Dijawab:** ditunda; tanpa kolom atau tabel (kelak `tenant_domain` aditif).

**OQ-S30 — Pemetaan identitas Better Auth untuk username dan email per tenant — `TERJAWAB` (2026-11-18), **DIGANTIKAN 2026-11-19** oleh identitas global + keanggotaan per tenant (OQ-S02 rev., OQ-S37; teks di bawah tidak lagi berlaku dan dipertahankan sebagai jejak keputusan): email boleh sama di tenant berbeda; akun orang yang sama di dua tenant = dua akun terpisah; identitas internal BA unik per tenant; email asli di `app_user`.** Tabel `user` Better Auth menjaga `username` **dan** `email` unik se-sistem, sedangkan `app_user` kini hanya unik per tenant.
- **A — Identitas BA komposit per tenant: `username` BA = `{tenant_id}:{username}`; email BA = alias internal per `app_user`; email asli hanya di `app_user`** *(dipilih; arah keputusan)*: isolasi penuh antar tenant; password/sesi/reset terpisah; mengubah email asli tidak menyentuh BA. Trade-off: surel (reset password) harus dikirim lewat *hook* ke `app_user.email`, bukan alamat `user.email` BA; BA tidak mengetahui email asli.
- **B — Email BA = email asli apa adanya** *(ditolak)*: bentrok bila email sama di dua tenant (`UNIQUE` BA).
- **C — Satu instance/basis data BA per tenant** *(ditolak untuk MVP)*: isolasi paling kuat tetapi biaya operasional besar.
- **D — Satu `user` BA dipakai banyak tenant** (tabel "orang" lintas tenant) *(ditolak oleh keputusan user)*: bertentangan dengan "dua akun terpisah".
*Dampak:* `app_user` (UQ per tenant; CHECK pengenal login), `auth_user_id` 1:1, §5.6 butir 5, alur login. **Detail yang belum final → OQ-S34.**

**OQ-S34 — Detail pemetaan Better Auth — `TERJAWAB` (2026-11-19): digantikan** — alias email **tidak dipakai**, verifikasi email **tidak dipakai**, soft delete = hapus keanggotaan (identitas global tetap), cookie sesi **per slug** (OQ-S37). Teks di bawah dipertahankan sebagai jejak keputusan; arah sebelumnya (OQ-S30); butir yang dulu belum final:
- **Bentuk alias email BA:** `{app_user_id}@auth.solva.invalid` *(asumsi)* vs `{local}+{tenant_id}@{domain-asli}` (dapat menerima surel di penyedia yang mendukung plus-addressing, tetapi tidak semua) vs `{tenant_id}.{hash}@…`.
- **Verifikasi email:** tidak dipakai di MVP *(asumsi)* vs diverifikasi lewat hook ke email asli (`emailVerified` BA menyangkut alias).
- **Cookie sesi per tenant:** satu origin untuk semua tenant, sehingga cookie sesi BA harus terpisah per tenant (mis. `Path=/{slug}` atau nama cookie berawalan `tenant_id`) *(asumsi)* agar dua akun dapat aktif bersamaan di satu browser; keputusan di ARCHITECTURE.
- **Soft delete:** hapus akun BA + `auth_user_id := NULL` *(asumsi)* vs nonaktifkan BA dan ubah nama identitas.
- **Perubahan username:** perbarui `user.username` BA komposit *(asumsi)*.
*Dampak:* hanya konfigurasi/hook Better Auth dan bentuk nilai; tidak ada kolom `app_user` tambahan. *Asumsi:* sesuai butir bertanda asumsi.

**OQ-S35 — Pengelola nama tenant — `TERJAWAB` (2026-11-18): operator platform mengatur nama saat pembuatan tenant; perubahan hanya lewat operator; tidak ada layar pengaturan nama oleh Owner di MVP.** Keputusan sebelumnya: tidak ada fitur/kolom warna tenant; nama tenant tetap ada.
- **A — Owner lewat `/admin`** *(asumsi awal; tidak dipilih)*: perlu permission (mis. `tenant.rename`) dan entri `audit_log`.
- **B — Hanya operator platform (`/platform`)** *(dipilih)*: nama dikunci dari sisi pelanggan; **tidak ada permission baru** di `permission` tenant dan **tidak ada kolom tambahan**; penulisan lewat fungsi Sync dengan konteks tenant tujuan, tercatat sebagai aksi sistem.
- **C — Keduanya**: ditolak (dua jalur tulis).
*Dampak skema:* tidak ada (`tenant.name` tetap `text` NN CHK ≤ 120); tidak ada `tenant.rename`; permission `flag.manage` dan lainnya tidak berubah. *Dampak dokumen lain:* DESIGN tidak memerlukan layar nama tenant bagi Owner; layar operator `/platform` mengatur nama.

**OQ-S37 — Model identitas global + keanggotaan per tenant — `TERJAWAB` (2026-11-19): semua asumsi diterima; cookie sesi PER SLUG.** Arah **DISEPAKATI** (user 2026-11-19): satu email = satu akun Better Auth global; `app_user` = profil/keanggotaan per tenant; login hanya email. Rincian (butir bertanda asumsi dipilih):
- **Sumber kebenaran keanggotaan:** **A — `app_user` (+ `user_outlet`) sumber kebenaran; `member` BA cermin** yang diubah dalam transaksi DB yang sama *(asumsi)*: peran/status/cakupan outlet memang di `app_user`; BA tidak perlu dipanggil di jalur data. **B — `member` BA sumber kebenaran, `app_user` turunan**: satu sumber untuk keanggotaan, tetapi data tenant dan feed sync bergantung skema library. **C — tidak memakai `member`** (organisasi BA hanya untuk `activeOrganizationId`): paling sedikit cermin, tetapi menjauh dari plugin organization yang diminta.
- **Peran BA `member.role`:** cerminan kasar (`owner`/`member`) *(asumsi)* vs tidak dipakai (hanya `member` tanpa peran).
- **Email tidak disalin ke `app_user`** *(asumsi; daftar anggota membaca email lewat `auth_user_id` ke `user` BA)* vs salinan untuk tampilan cepat (duplikasi; harus disinkron saat email berganti).
- **Ganti email:** hanya pemilik akun (dengan password) atau operator platform; **bukan** Owner tenant, karena email = identitas global dan dipakai di tenant lain *(asumsi)*.
- **`auth_user_id` pada baris yang dikeluarkan:** dipertahankan (jejak audit) *(asumsi)* vs dikosongkan.
- **Kunci rate limit login (ARCHITECTURE §6.9):** karena password global, kunci utama sebaiknya **email** (lintas slug) bukan hanya slug + akun — batas per slug saja memungkinkan menebak satu password lewat banyak slug.
*Dampak:* `app_user` (kolom `auth_user_id`, `membership_status`; `username`/`email` dihapus), pemetaan BA, §5.6 butir 5, ARCHITECTURE (login/sesi), PRD (BR-AUT-001). **Dijawab:** semua butir bertanda asumsi diterima (peran BA `member.role` hanya cerminan kasar `owner`/`member` dan izin dari tabel kita; email **tidak** disalin ke `app_user`; ganti email hanya oleh pemilik akun dengan password atau operator platform; `auth_user_id` dipertahankan pada baris yang dikeluarkan; kunci rate limit login = email lintas slug). **Cookie sesi PER SLUG** (login terpisah per tenant, akun tetap global) — menggantikan asumsi satu cookie sesi global; opsi "satu sesi global per origin" (2026-11-19 awal) dan "cookie per tenant" (OQ-S34) dipertahankan sebagai jejak. *Dampak tambahan:* `session` BA per slug (§4.1.8), ARCHITECTURE (konfigurasi cookie/sesi).

**OQ-S38 — Undangan, reset password tanpa email, dan risiko pengambilalihan lintas tenant — `TERJAWAB` (2026-11-19): mekanisme B — kode undangan/reset sekali pakai terikat email (undangan 72 jam, reset 24 jam), BUKAN password sementara.** Penerbit tidak pernah melihat atau menetapkan password; kode sama untuk email yang sudah/belum punya akun; Owner hanya mereset akun yang hanya di tenantnya (dicek saat penerbitan dan penukaran); akun multi-tenant hanya oleh operator atau pemiliknya; penolakan generik "hubungi operator platform"; audit `member.password_reset`; reset mencabut seluruh sesi. **Dihapus:** `must_change_password`, butir "klaim akun", dan ketergantungan `membership_status` pada password sementara (status dipertahankan: `PENDING` sampai kode ditukar). Tabel `member_code` (§4.1.19). Opsi dan butir di bawah (termasuk password sementara dan "klaim akun") dipertahankan sebagai **jejak keputusan; tidak lagi berlaku** kecuali mekanisme B. Keputusan semula: Keputusan user: MVP tidak mengirim email; undangan dan reset password manual oleh Owner atau operator platform; butir keamanan (Owner tenant A tidak boleh mereset akun yang juga anggota tenant lain) wajib didukung skema.
- **Undangan:** **A — `membership_status` `PENDING`→`ACTIVE`**; akun baru dibuat dengan password sementara (`must_change_password`), akun yang sudah ada menerima undangan saat login; respons seragam (anti-enumerasi) *(asumsi; tanpa tabel baru)*. **B — kode undangan sekali pakai** (seperti `pairing_code`; tabel/kolom baru): pemilik akun memasukkan kode, tidak ada password sementara pada undangan akun baru. **C — tanpa undangan**: anggota hanya dibuat operator platform.
- **Data "akun hanya di satu tenant":** **A — fungsi `auth_account_membership_count(auth_user_id)`** (`SECURITY DEFINER`, hanya jumlah; menghitung `app_user` belum dihapus **termasuk `PENDING`**) + indeks parsial `(auth_user_id)` *(asumsi)*. **B — hitung dari BA `member`** (tanpa fungsi baru, tetapi **tidak** memuat undangan `PENDING`, sehingga celah: undangan ke akun yang akan dibuat/diklaim). **C — kolom denormalisasi `membership_count`**: cepat, tetapi rawan basi dan melintasi RLS saat diperbarui.
- **Aturan reset:** Owner hanya bila count = 1, selebihnya hanya operator platform *(asumsi)*; reset = password sementara + `must_change_password` + cabut seluruh sesi + audit `member.password_reset`.
- **Klaim akun:** undangan ke akun yang masih ber-`must_change_password` ditolak/ditahan sampai pemilik mengganti password *(asumsi)* — mencegah pembuat akun (Owner A, mengetahui password sementara) menerima undangan tenant lain atas nama korban.
- **Bidang `must_change_password`:** *additionalField* di `user` BA *(asumsi)* vs penanda di sisi kita (kolom baru).
*Dampak:* `app_user.membership_status`, fungsi count, audit `member.*`, BA `user`; ARCHITECTURE (alur undangan/reset), DESIGN (layar anggota). **Dijawab: B** (tabel `member_code`, §4.1.19); fungsi count dipakai (diperluas dengan undangan aktif); `must_change_password` tidak dipakai.

**OQ-S39 — Detail tabel `member_code` — `TERJAWAB` (2026-11-19): semua asumsi diterima — `tenant_id` NOT NULL (reset operator memakai konteks salah satu tenant tempat akun menjadi anggota; RLS seragam); kode 10 karakter alfabet 32 (±1,1×10¹⁵) tanpa kolom percobaan (penghitung memori); `email` terikat disimpan hanya di `member_code` dan dibersihkan bersama baris; retensi fisik 7 hari setelah kedaluwarsa/terpakai; penukaran satu langkah tanpa membuka bahwa akun ada; hitungan keanggotaan menyertakan `INVITE` aktif lintas tenant; risiko pra-klaim email DITERIMA di MVP.** Mekanisme B sudah diputuskan (OQ-S38); rincian (butir bertanda asumsi dipilih):
- **`tenant_id` untuk reset oleh operator platform:** **A — `tenant_id` NN; operator menerbitkan dengan konteks salah satu tenant tempat akun menjadi anggota** (kode ditukar pada slug itu) *(asumsi; RLS seragam, tanpa baris `NULL`)* vs **B — `tenant_id` NULL untuk kode tingkat platform** (tanpa RLS tenant; akses hanya lewat fungsi; penukaran di halaman netral).
- **Panjang/entropi kode:** 8 karakter alfabet 32 seperti `pairing_code` (≈1,1×10¹²) vs **10 karakter (≈1,1×10¹⁵)** *(asumsi, karena masa berlaku 72 jam)*; tanpa kolom percobaan (penghitung memori).
- **Penyimpanan `email` terikat** di `member_code` (hanya di sini, dibersihkan bersama baris) *(asumsi)* vs menyimpan hash email (kode harus tetap dicocokkan dengan email yang diketik).
- **Retensi:** dibersihkan fisik 7 hari setelah kedaluwarsa/terpakai *(asumsi)*.
- **Penukaran satu langkah** (email + kode + password; akun baru → password dibuat, akun ada → password saat ini) *(asumsi)* vs dua layar berbeda (membuka bahwa akun ada).
- **Risiko pra-klaim email (tanpa verifikasi email):** penerbit yang memegang kode dan email dapat menukarnya sendiri dan menetapkan password atas email orang lain. Mitigasi: hanya berlaku bagi akun yang hanya ada di tenantnya; bergabung ke tenant lain tetap butuh kode tenant itu **dan** password akun; tercatat audit; operator dapat mereset. **Diterima di MVP (dijawab)** dengan mitigasi di atas; verifikasi email kelak (butuh pengiriman email, di luar MVP).
- **Hitungan keanggotaan** menyertakan `INVITE` aktif lintas tenant untuk email akun *(asumsi)* vs hanya `app_user` ber-`auth_user_id`.
*Dampak:* `member_code`, fungsi `auth_account_membership_count`, ARCHITECTURE (alur penukaran, rate limit), DESIGN. **Dijawab:** semua butir bertanda asumsi diterima.

**OQ-S40 — Dukungan `member_code` untuk daftar "Undangan tertunda", Batalkan, dan Terbitkan ulang — `TERJAWAB` (2026-11-19): semua asumsi diterima — `revoked_at` + `revoke_reason` (`CANCELED`/`REPLACED`); tautan kode pengganti hanya di `audit_log`; satu kode aktif per `(app_user_id, kind)`; penerbit `issued_by` + `audit_log.actor` tanpa `revoked_by`; membatalkan undangan murni men-soft-delete profil `PENDING`; kode dihapus fisik 7 hari setelah kedaluwarsa/terpakai dan profil `PENDING` yatim di-soft-delete; satu indeks sederhana; aksi audit `member.*`.** Keputusan user (DESIGN DOQ-26, 2026-11-19): daftar undangan belum dipakai di tab Pengguna `/admin` dengan aksi Batalkan dan Terbitkan ulang (kode baru; kode lama otomatis tidak berlaku); halaman `/{slug}/join` dan `/{slug}/reset`. Terpenuhi tanpa tabel baru; yang menjadi pilihan:
- **Status batal:** **A — `revoked_at` + `revoke_reason` (`CANCELED`/`REPLACED`)** *(asumsi)*: satu kolom waktu untuk semua pencabutan, alasan membedakan; **B — kolom `canceled_at` terpisah** selain `revoked_at`: dua kolom waktu bermakna tumpang tindih; **C — hapus fisik saat batal**: kehilangan jejak dan tak dapat membedakan kode yang dibatalkan dari yang tak pernah ada.
- **Tautan kode pengganti:** **A — hanya di `audit_log`** (`before_data`/`after_data` memuat id lama dan baru) *(asumsi)*; **B — kolom `replaced_by_id`** (FK ke baris yang sama): rantai langsung di tabel, tetapi menambah satu langkah `UPDATE` setelah `INSERT` dan satu FK.
- **Penerbit/pembatal:** `issued_by` (penerbit kode saat ini) + `audit_log.actor_user_id` untuk penerbit/pembatal/penerbit ulang *(asumsi)* vs kolom `revoked_by` (duplikasi audit).
- **Batalkan murni-undangan:** profil `PENDING` ikut di-soft-delete *(asumsi)* vs dibiarkan `PENDING` tanpa kode (yatim, tampil di daftar tanpa aksi bermakna).
- **Pembersihan undangan kedaluwarsa:** kode dihapus fisik 7 hari setelah kedaluwarsa dan profil `PENDING` yatim di-soft-delete *(asumsi)* vs profil dibiarkan sampai dibatalkan manual.
- **Indeks daftar:** `(app_user_id, kind, created_at DESC)` saja *(asumsi; jumlah kecil per tenant)* vs tambahan indeks parsial `(tenant_id, created_at) WHERE kind='INVITE' AND used_at IS NULL AND revoked_at IS NULL`.
*Dampak:* `member_code` (+1 kolom, +1 indeks, +1 CHECK), `app_user` (soft delete profil `PENDING`), audit `member.invite_canceled`/`member.invite_reissued`, DESIGN SCR-A08 (daftar), ARCHITECTURE (transaksi terbit ulang, pembersihan). **Dijawab:** semua butir bertanda asumsi diterima.

**OQ-S36 — Rincian rate limit lokal (PIN, resync) — `TERJAWAB` (2026-11-19): basis jam jeda PIN = opsi A (`locked_until` + `meta.clock.max_seen_time`, tanpa kolom baru); `ReportPinState` saat `lock_tier` berubah; `meta.full_resync` `{last_completed_at, retry_after_at}` ditambahkan.** Keputusan user: penghitung rate limit di memori proses, tanpa tabel baru; PIN di device memakai hitungan monotonik dan jeda yang tidak dapat dimundurkan lewat tanggal tablet. Rincian:
- **Basis jam jeda PIN:** **A — `locked_until` (waktu terkoreksi) + `meta.clock.max_seen_time` yang sudah ada; tanpa kolom baru** *(asumsi)*: sisa = `locked_until − max(trusted_now, max_seen_time)`; bertahan saat dimuat ulang. **B — kolom `lock_started_seen_time` + `lock_duration_ms`**: sisa dihitung dari selisih kenaikan `max_seen_time`; tidak bergantung pada nilai absolut, tetapi menambah dua kolom dan tetap bergantung Dexie yang dapat diubah lewat devtools.
- **Frekuensi `ReportPinState`:** saat `lock_tier` berubah dan saat reset epoch *(asumsi)* vs setiap kegagalan (lebih informatif bagi manager, lebih banyak perintah outbox).
- **`meta.full_resync`** `{last_completed_at, retry_after_at}` *(usulan)*: mencegah klien mencoba ulang full resync sebelum jatah 1/jam setelah `429`; alternatif: klien hanya mengandalkan `Retry-After` dalam memori (hilang saat muat ulang).
*Dampak:* `staff_pin_state` (kolom bila B), Dexie `meta`, ARCHITECTURE §6.9.6. **Dijawab:** A, laporan saat `lock_tier` berubah, `meta.full_resync` ditambahkan.

**OQ-S31 — Referensi source map di `app_release` — `TERJAWAB` (2026-11-18): opsi A — berkas privat per `app_version`, tanpa kolom di `app_release`.** Keputusan user: source map rilis disimpan di server sebagai berkas privat per rilis (bukan isi di DB).
- **A — Tanpa kolom; lokasi diturunkan dari `app_version`** (PK, = tag git) *(asumsi)*: tidak ada duplikasi konvensi; tak ada logika bergantung; ops memeriksa keberadaan berkas saat rilis.
- **B — `sourcemap_sha256 text NULL`** (integritas/deteksi berkas hilang/berganti): satu kolom aditif; berguna bila keberadaan berkas ingin dipastikan lewat DB.
- **C — `sourcemap_path text NULL`**: fleksibel bila lokasi tak mengikuti konvensi, tetapi dapat basi dan membuat DB menunjuk jalur sistem berkas.
*Dampak:* hanya skrip CLI log dan skrip ops rilis. **Dijawab: A.**

**OQ-S32 — Kunci idempoten aksi online-only non-outbox — `TERJAWAB` (2026-11-18): opsi A — kolom `channel` di `idempotency_command` (`device_seq` NULL untuk `ONLINE`); enroll lewat `pairing_code`.** `HandOverBill`/`AcceptBill`/`CancelBillHandover` dikirim langsung (tanpa outbox) tetapi `bill_event.command_id` sudah merujuk `idempotency_command` yang mewajibkan `device_seq`; `EnrollDevice` terjadi sebelum `device_id` ada.
- **A — Perluas `idempotency_command` dengan `channel` (`OUTBOX`/`ONLINE`), `device_seq` NULL untuk `ONLINE`**; hanya aksi sukses tersimpan; enroll **tidak** memakai tabel ini (dijaga `pairing_code` sekali pakai; respons hilang → kode baru) *(asumsi)*.
- **B — Tanpa perubahan skema**: aksi online-only mengambil `device_seq` dari counter biasa; celah `device_seq` tak berbahaya tetapi mencemari makna "urutan FIFO outbox".
- **C — Tabel terpisah `online_action`**: tidak mengubah `idempotency_command`, tetapi `bill_event.command_id` (FK) harus dilonggarkan atau digandakan.
- **Enroll:** menyimpan hasil (credential) agar replay mengembalikan hal yang sama **ditolak** (menyimpan rahasia di DB); alternatif: kunci idempoten klien + credential diturunkan deterministik dari rahasia klien (lebih kompleks).
*Dampak:* `idempotency_command` (1 kolom + CHECK), Lampiran B, ARCHITECTURE §4.2. Relaksasi `NOT NULL` dicatat di Bab 7. **Dijawab: A.**

**OQ-S33 — Format ID referensi lokal `device_log` — `TERJAWAB` (2026-11-18): opsi A — `D-YYYYMMDD-HHmmss-xxxxx`.** Keputusan user: sama dengan ID server tetapi berawalan khusus perangkat.
- **A — `D-YYYYMMDD-HHmmss-xxxxx`** (waktu terkoreksi UTC, alfabet tanpa `i l o 0 1`) *(asumsi)*: cocok CHECK `request_ref`; mudah dibedakan dari ID server dan job (`job-`); 31⁵ ≈ 28 juta kombinasi per detik, `&ref_local` menangkap bentrok.
- **B — Tanpa awalan, dibedakan lewat kolom `scope`**: ID tampak identik dengan ID server, rawan rancu saat dibacakan.
- **C — UUIDv7**: unik pasti, tetapi sulit dieja/difoto oleh kasir.
*Dampak:* `device_log.ref_local`, tampilan `KODE#D-…`, pencarian CLI. **Dijawab: A.**

**OQ-S25 — Tempat menyimpan versi minimum klien — `TERJAWAB` (2026-11-19): opsi A — kolom di baris `app_release` terbaru.** Keputusan user: server memiliki `min_supported_app_version` dan `min_supported_schema_version`; pilihan penyimpanan = opsi A.
- **A — Kolom di baris `app_release` terbaru** *(asumsi)*: tabel global yang sudah ada; satu sumber dengan "rilis wajib" dan toleransi; sejalan ARCHITECTURE (blok `release`); mengubah minimum = `UPDATE` baris terbaru.
- **B — Tabel singleton terpisah `client_policy`** (satu baris global: kedua nilai minimum, `grace_until`, `updated_by`): kebijakan tidak bercampur dengan katalog rilis; satu tabel tambahan.
- **C — Konfigurasi proses (env/berkas) di server**: tanpa tabel dan tanpa migrasi; perubahan butuh restart/deploy, tidak terjejak di database.
- **D — Override per tenant** (tambahan untuk A/B): rollout bertahap per tenant; menambah kompleksitas pemeriksaan di tiap sync.
Per lingkungan: tiap lingkungan memiliki database sendiri sehingga tidak perlu kolom lingkungan. *Dampak:* gerbang push/pull (§4.6.8), prasyarat fase kontrak migrasi, nama kolom `min_supported_schema_version` (mengganti `min_accepted_schema_version`). **Dijawab: A.**

**OQ-S26 — Cakupan dan bentuk feature flag — `TERJAWAB` (2026-11-19): per tenant, boolean + `params` opsional, berlaku setelah siklus pull.** Keputusan user: per tenant, master turun, default di kode, hanya Owner, POS baca-saja. Rincian (jawaban user 2026-11-19 memilih butir bertanda asumsi):
- **Cakupan:** per tenant saja *(asumsi)* vs tambahan override per outlet (`outlet_id` opsional seperti `price_entry`).
- **Nilai:** boolean + `params` jsonb opsional *(asumsi)* vs boolean saja (hapus `params`).
- **Waktu berlaku:** setelah siklus pull lengkap *(asumsi)* vs hanya pada login/buka shift berikutnya (hindari perubahan perilaku di tengah shift).
- **Nama permission** `flag.manage` (hanya Owner) *(asumsi)*.
*Dampak:* `feature_flag`, hak akses, ukuran Dexie (sangat kecil). **Dijawab:** semua butir bertanda asumsi diterima.

---

## 10. Kolom / Tabel yang Bergantung pada Keputusan PRD (terjawab dan masih open)

| Butir PRD terbuka | Tabel / kolom terdampak | Asumsi yang dipakai skema | Dampak bila jawaban berbeda |
|---|---|---|---|
| **OQ-01 (a)** SC kena pajak? — *terjawab 2026-11-18: flag per outlet, default ya* | `outlet.service_charge_taxable`; `sale.service_charge_taxable`, `tax_base`, `tax_amount`; `sale_line.tax_alloc` | Flag per outlet, default **ya** (Opsi C) | Tidak ada perubahan struktur (konfigurasi); nilai default dan uji dua cabang (V-06 vs V-07) |
| **OQ-01 (b)** Dasar & ekstraksi pajak mode inklusif — *terjawab: aturan BR-TAX-007 dipertahankan; harga "nett" = inklusif + SC nonaktif (tanpa kolom baru)* | `sale.tax_base`, `dpp`, `tax_amount`, `grand_total` | DPP = B − pajak (BR-TAX-006 9b); G = S2 + SC | Perubahan rumus Kernel; kolom tetap |
| **OQ-01 (c)/AS-09** PPN dan PB1 aktif **bersamaan** — *MVP: satu profil per outlet; outlet campuran tetap `PERLU KONFIRMASI` (akuntan)* | `outlet.tax_profile` (satu nilai), `sale.tax_profile/tax_rate/tax_amount` | Satu profil aktif (`NONE`/`PPN`/`PB1`) | **Perubahan struktur**: butuh tabel `sale_tax_line (sale_id, tax_code, rate, base, amount)` dan alokasi pajak ganda di `sale_line`; `outlet.tax_profile` menjadi relasi N:M ke jenis pajak; `tax_rate_history` sudah berkode pajak sehingga tidak berubah |
| **OQ-01 (d)** Perlakuan outlet non-PKP — *dikonfirmasi* | `legal_entity.is_pkp`, trigger `outlet` | `PPN` ditolak untuk non-PKP | Hanya aturan trigger |
| **OQ-01 (e)** Barang bebas PPN — *dikonfirmasi* | `product.taxable`, `sale_line.taxable` | Flag per produk | Bila perlu jenis pembebasan (bukan sekadar ya/tidak) → kolom kode pembebasan |
| **OQ-01 (f)** Dasar pengenaan khusus — *dikonfirmasi; barang mewah PPN 12% penuh belum didukung per produk* | — (tidak ada) | Tidak didukung | Menambah kolom faktor DPP pada `product`/`sale_line` |
| **OQ-02** Seri invoice **per register** — *terjawab 2026-11-18: opsi A; konfirmasi auditor tetap disarankan* | `invoice_series` (PK `register_id, doc_type, period`), `sale (register_id, invoice_period, invoice_seq)` unik, `invoice_gap`, `register_recovery`, `local_counter` | Seri per register (Opsi A/KEP-04) | Seri **per outlet** (B): hilang `UQ` per register; perlu tabel alokasi blok nomor (`invoice_block_lease`) dan koordinasi offline — **perubahan arsitektural**. Opsi C: tambah kolom nomor resmi server (`official_no`) di fase lanjut |
| **OQ-10** Pembulatan pajak per bill vs per baris — *terjawab 2026-11-18: per bill, half-up* | `sale.tax_amount` vs Σ `sale_line.tax_alloc` | Per bill (A) + alokasi LR per baris disimpan | Per baris (B): `tax_alloc` menjadi pembulatan langsung (bukan LR) dan `tax_amount = Σ tax_alloc`; kolom tetap, rumus Kernel berbeda |
| **OQ-12** Biaya saat stok minus/nol — *terjawab 2026-11-18: biaya referensi* | `stock_balance.ref_value`, `ref_qty`; `stock_movement.cost_basis` (`REFERENCE`,`MIXED`); `is_negative_result` | Biaya referensi (A) | Opsi B (HPP 0 + revaluasi): perlu mekanisme revaluasi dan penanda movement bernilai sementara; Opsi C (biaya GR terakhir): ganti `ref_*` dengan penunjuk `last_gr_unit_cost` |
| **OQ-03** (dijawab; **ditinjau ulang bersama akuntan**) Retensi server | `stock_movement`, `audit_log`, `bill_event`, `idempotency_command`, `sale*` (partisi), `tenant_sync.tombstone_floor_version` | Simpan semua tanpa penghapusan; skema siap partisi (§5.7) | Opsi retensi N tahun / purge: kebijakan arsip + partisi; kolom `business_date` sudah tersedia |
| **OQ-21** (dijawab) Data pelanggan: retensi & hak hapus data pribadi **perlu ditinjau** | `sale.customer_name`, `customer_phone`, `bill.customer_*` | Disimpan + masking di laporan; tanpa enkripsi/persetujuan | Bila regulasi menuntut penghapusan: tambah `customer_anonymized_at` dan prosedur penghapusan kolom (tabel `sale` bersifat tak-ubah → perlu pengecualian hak kolom) |
| **BR-INV-011** (OQ-02 terkait) Penomoran faktur pajak | (tidak ada tabel) | Di luar MVP | Tabel nomor resmi + relasi `sale` (fase lanjut) |
| **BR-AUT-005** Parameter kunci PIN (angka `DIUSULKAN`) | `staff_pin_state.lock_tier`, `failed_count`, `locked_until` | 5×/5 mnt · 5×/15 mnt · 15× reset | Hanya nilai konfigurasi |
| **BR-SYN-010 butir 6** Batas tombstone 30 hari (contoh angka) | `tenant_sync.tombstone_floor_version` | 30 hari | Parameter pembersih |
| **BR-TAX-009 / OQ-13** (dijawab) Unit pembulatan | `outlet.cash_rounding_unit`, `sale.rounding`, `credit_note.rounding` | Terdekat half-up, tunai penyelesai | — |
| **BR-FNB-010** (`DIUSULKAN` di PRD; **OQ-S19 terjawab**) "Menunggu bayar" diturunkan dari `PREBILL_PRINTED` terbaru vs event isi terakhir | `bill.prebill_seq`, `last_content_seq`, `is_awaiting_payment` | Penurunan di kolom turunan | Aturan lain → ubah ekspresi kolom / hitung di Kernel (OQ-S19) |
| **BR-FNB-012/013** (`DIUSULKAN` di PRD; **OQ-S19/S21 terjawab**) pra-syarat antrean event bersih, jejak hanya di event, bill menunggu tak dapat dipisah/digabung/dibayar | `bill.handover_*`, `bill_event.target_register_id`, `handover_event_id`, trigger lease | Kolom di `bill` + riwayat dari `bill_event` | Bila kelak perlu audit/riwayat eksplisit → tabel `bill_lease_transfer` atau entri `audit_log` (OQ-S19 menolaknya untuk MVP) |
| **BR-FNB-011** (`DIUSULKAN` di PRD; **OQ-S20 terjawab**) pengecualian shift, tidak ada invoice | `cash_master.register_type`; validasi perintah | Validasi pemrosesan, bukan constraint | Aturan lain → validasi perintah |
| **FR-DEV-006** (`DIUSULKAN` di PRD; **OQ-S22 terjawab: larangan dipakai**) jenis register tak dapat diubah saat shift/bill terbuka | trigger `cash_master.register_type` | Trigger | Dilonggarkan → hapus trigger |
| **BR-AUT-015** (`DIUSULKAN` di PRD; **OQ-S22 terjawab**) pembuka & audit | `meta.idle_lock`, `cart_draft` (Dexie), `permission.screen.unlock_override`, `audit_log.action` | Hanya sisi device; audit override + kunci PIN | Bila audit kunci biasa diwajibkan → tambah entri audit / kolom (OQ-S22) |
| **Prefiks invoice per register** (keputusan user; bentuk disetujui 2026-11-19) | `register_invoice_prefix.invoice_prefix`, `sale.invoice_prefix`, `credit_note.cn_prefix` | 2–16 karakter, hubung di dalam, bukan berakhir `NK`, wajib `CASHIER`, unik lintas riwayat (OQ-S24) | Aturan bentuk lain → ubah CHECK/trigger; contoh nomor PRD ikut menyesuaikan |
| **Versioning** (PRD KEP-23, BR-VER-001..012, FR-VER-001..008) | `schema_version`/`app_version` di tabel T, `bill_event`, `idempotency_command`, `audit_log`; `app_release.min_supported_*`; `feature_flag` | Kolom bentuk §2.5; versi minimum di `app_release` (OQ-S25); flag per tenant (OQ-S26) | Sudah di PRD; bila min disimpan di tabel lain → pindahkan dua kolom |
| **Identifikasi tenant lewat URL** (PRD KEP-24, BR-TEN-001..012, FR-TEN-001..012) | `tenant.slug` (permanen, kata terlarang), `resolve_tenant_by_slug`, Dexie `solva-pos:{tenant_id}` + `solva-registry` | Format slug; trigger permanen (OQ-S28 terjawab); daftar terlarang di kode (OQ-S27 terjawab); pemetaan Better Auth (OQ-S30 terjawab, detail OQ-S34) | Sudah di PRD; domain kustom ditunda (BR-TEN-010; OQ-S29 terjawab; kelak `tenant_domain`) |
| **Identitas global + keanggotaan per tenant; tanpa warna tenant** (PRD KEP-27, BR-IDN-001..013, FR-IDN-001..014, BR-TEN-003/007) | `app_user` (`auth_user_id` global, `UQ (tenant_id, auth_user_id)`, `membership_status`; **tanpa** `username`/`email`), `member_code` (kode undangan 72 jam/reset 24 jam), `auth_account_membership_count`, pemetaan BA (`user`/`account`/`session` per slug/`organization`/`member`); **tidak ada** kolom warna di `tenant` | OQ-S37/S38/S39 terjawab (detail `member_code` dikunci); nama tenant diatur operator platform (OQ-S35) | Sudah di PRD; tidak ada tindak lanjut skema |
| **Rate limit** (keputusan user 2026-11-18/19; ARCHITECTURE §6.9) | tidak ada tabel/kolom server; `staff_pin_state` (dokumentasi basis jam & laporan); Dexie `meta.full_resync` | Basis jam & frekuensi laporan (OQ-S36 terjawab); kunci login = email lintas slug (OQ-S37; BR-RLM-003) | Sudah di PRD: KEP-26, BR-RLM-001..014, FR-RLM-001..010; tidak ada tindak lanjut skema |
| **Undangan tertunda** (DESIGN DOQ-26; PRD FR-IDN-013/014, BR-IDN-004; keputusan user 2026-11-19) | `member_code.revoke_reason`, indeks `(app_user_id, kind, created_at DESC)`, audit `member.invite_canceled`/`member.invite_reissued` | OQ-S40 terjawab (tautan pengganti di audit; Batalkan menghapus profil `PENDING`; pembersihan 7 hari) | Perubahan opsi → tambah kolom (aditif, DB-10) |
| **Error management** (PRD KEP-25, BR-ERR-001..015, FR-ERR-001..012) | `device_log` (Dexie), `cart_draft` (Dexie), `idempotency_command.channel`, katalog kode error (Lampiran A.5), source map (berkas) | `ref_local` `D-…` (OQ-S33 terjawab), `channel` (OQ-S32 terjawab), tanpa kolom source map (OQ-S31 terjawab) | Sudah di PRD (BR-ERR-002/006); BR-FNB-012 (aksi online-only) dirujuk bersama BR-ERR-010 |
| **OQ-S01..S23** (skema) | terjawab; seluruhnya terjawab; lihat Bab 9 | — | — |

---

## Lampiran A — Katalog Nilai Enum (`text` + `CHECK`)

### A.1 Status dan jenis

| Kolom | Nilai | Rujukan |
|---|---|---|
| `tenant.status` | `ACTIVE`, `SUSPENDED`, `CLOSED` | — |
| `outlet.price_tax_mode`, `sale.price_tax_mode` | `INCLUSIVE`, `EXCLUSIVE` | BR-TAX-003 |
| `*.tax_profile` | `NONE`, `PPN`, `PB1` | BR-TAX-002 |
| `tax_rate_history.tax_code` | `PPN`, `PB1` | BR-TAX-001/002 |
| `payment_method.kind`, `sale_payment.method_kind` | `CASH`, `NON_CASH` | BR-PAY-001 |
| `product.product_type` | `RETAIL`, `MENU_FNB` | PRD §6.3 |
| `item_outlet_availability.status` | `AVAILABLE`, `UNAVAILABLE` | BR-CAT-009 |
| `modifier_group.selection_type` | `SINGLE`, `MULTI` | — |
| `modifier_ingredient.adjust_type` | `ADD`, `REDUCE`, `REMOVE` | BR-RCP-004 |
| `sale.status` | `PAID`, `VOID` | BR-INV-005 |
| `sale_line.line_kind` | `ITEM`, `SHARE`, `STOCK_BASIS` | BR-SPL-007 |
| `sale_line.price_source` | `OUTLET`, `TENANT_DEFAULT`, `OPEN_PRICE` | BR-PRC-002/007 |
| `*.discount_type` | `PERCENT`, `NOMINAL` | BR-DSC-001 |
| `credit_note.status` | `POSTED` | — |
| `credit_note_line.disposition` | `KEMBALI_STOK`, `BUANG` | BR-RTR-008 |
| `cash_cashier.status` | `OPEN`, `CLOSED`, `FORCE_CLOSED` | BR-SHF-009 |
| `cash_cashier.recap_status` | `COMPLETE`, `INCOMPLETE` | BR-SHF-008 |
| `cash_movement.direction` | `IN`, `OUT` | BR-SHF-004 |
| `invoice_series.doc_type`, `invoice_gap.doc_type`, `local_counter.doc_type` | `INVOICE`, `CREDIT_NOTE` | BR-INV-010 |
| `invoice_gap.status` | `OPEN`, `EXPLAINED`, `FILLED` | BR-INV-007 (+`FILLED`) |
| `invoice_gap.origin` | `DETECTED`, `RECOVERY_DECLARED` | BR-INV-008 |
| `goods_receipt.doc_type` | `RECEIPT`, `REVERSAL` | BR-STK-022 |
| `goods_receipt.status`, `stocktake.status` | `DRAFT`, `POSTED` (+`CANCELED` opname) | BR-STK-020/030 |
| `transfer.status` | `DRAFT`, `SENT`, `RECEIVED`, `CANCELED` | BR-TRF-001 |
| `bill.status` | `OPEN`, `SPLIT`, `PAID`, `CANCELED`, `MERGED`, `CLOSED_BY_SPLIT` | BR-FNB-*, BR-SPL-* |
| `bill.split_mode` | `ITEM`, `QTY`, `EQUAL` | BR-SPL-003 |
| `bill.handover_status` | `NONE`, `PENDING` ("menunggu diterima") | BR-FNB-012 |
| `bill_event.event_type` | `BILL_OPENED`, `ITEM_ADDED`, `ITEM_VOIDED`, `ITEM_QTY_CHANGED`, `MODIFIER_SET`, `CUSTOMER_SET`, `TABLE_SET`, `BILL_CANCELED`, `PREBILL_PRINTED`, `BILL_HANDED_OVER`, `BILL_ACCEPTED`, `BILL_HANDOVER_CANCELED`, `DISCOUNT_SET`, `BILL_SPLIT`, `BILL_MERGED` | BR-FNB-005/010/012 |
| `cash_master.register_type` | `CASHIER`, `WAITER` | BR-FNB-011 |
| `app_user.membership_status` | `PENDING`, `ACTIVE` | BR-AUT-001 (keputusan user 2026-11-19) |
| `member_code.kind` | `INVITE`, `RESET` | idem |
| `member_code.revoke_reason` | `CANCELED`, `REPLACED` | DESIGN DOQ-26 (user 2026-11-19) |
| `cart_draft.status` (Dexie) | `ACTIVE`, `DISCARDED` | BR-AUT-015 |
| `bill_item.status` | `ACTIVE`, `VOIDED`, `MOVED` | BR-FNB-005 |
| `idempotency_command.status` | `ACKED`, `ATTENTION`, `ACCEPTED_MANUAL`, `DISMISSED` | BR-SYN-030 |
| `attention_item.status` | `OPEN`, `ACCEPTED`, `DISMISSED`, `ESCALATED` | FLOW-18 |
| `attention_item.reason_class` | `STRUCTURAL`, `AUTHORIZATION` | BR-SYN-030 |
| `data_flag.status` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` | — |
| `device_sync_status.storage_persist` | `GRANTED`, `DENIED`, `UNKNOWN` | BR-SYN-050 |
| `outbox_command.status` (Dexie) | `PENDING`, `SENDING`, `ACKED`, `NEEDS_ATTENTION` | PRD §6.3.E |
| `print_job.status` (Dexie) | `QUEUED`, `PRINTING`, `DONE`, `FAILED` | BR-PRN-002 |
| Locale | `id-ID`, `en-US` | BR-I18N-001 |
| Zona waktu | `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura` | BR-TIM-002 |

### A.2 Jenis movement stok

`SALE`, `SALE_VOID`, `RETURN_IN`, `GR_IN`, `GR_REVERSAL`, `TRANSFER_OUT`, `TRANSFER_IN`, `ADJUSTMENT`, `RECIPE_CONSUMPTION` (BR-STK-007). `cost_basis`: `AVERAGE`, `REFERENCE`, `MIXED`, `SNAPSHOT`, `TRANSFER`, `DECLARED`.

### A.3 Kode flag data (`data_flag.flag_code`)

| Kode | Arti | Pemicu | Rujukan |
|---|---|---|---|
| `HARGA_STALE` | Harga snapshot ≠ harga terbaru saat diproses | Server membandingkan; bukan untuk `OPEN_PRICE` | BR-PRC-003 |
| `ITEM_NONAKTIF` | Dijual saat produk/SKU sudah `is_active = false` | — | BR-CAT-004, EC-001 |
| `ITEM_TIDAK_TERSEDIA` | Dijual setelah ketersediaan outlet diubah menjadi `UNAVAILABLE` | `version > catalog_cursor` dan `occurred_at ≥ changed_at` | BR-CAT-013 |
| `TARIF_BERBEDA` | Tarif pajak snapshot ≠ tarif yang berlaku pada `business_date` (`tax_rate_history`) | — | EC-005 |
| `SELISIH_HITUNG` | Hasil hitung ulang server ≠ angka client | Angka client tetap disimpan | BR-MNY-007, EC-029 |
| `NOMOR_KONFLIK` | Nomor invoice/NK sudah dipakai dokumen lain | `invoice_conflict_idx ≥ 1` | BR-INV-009 |
| `STOK_MINUS` | Movement menghasilkan saldo negatif | `is_negative_result` | BR-STK-002 |
| `TANPA_RESEP` | Menu F&B tanpa resep → tanpa konsumsi/HPP | — | BR-RCP-006 |
| `BILL_GANDA_MEJA` | Beberapa open bill pada meja yang sama dari device berbeda | — | BR-FNB-007 |
| `SELISIH_TRANSFER` | Qty/nilai terima ≠ kirim | `value_variance ≠ 0` | BR-TRF-003 |

### A.4 Kode aksi audit (`audit_log.action`) — contoh awal (BR-AUD-001)

`sale.void`, `discount.override`, `price.changed`, `availability.changed`, `return.created`, `role.changed`, `role.created`, `role.deleted`, `permission.changed`, `pin.reset`, `pin.locked`, `member.invited`, `member.invite_canceled`, `member.invite_reissued`, `member.accepted`, `member.removed`, `member.reset_issued`, `member.password_reset`, `device.enrolled`, `device.revoked`, `register.created`, `register.recovered`, `gr.posted`, `gr.reversed`, `transfer.sent`, `transfer.received`, `stocktake.posted`, `shift.force_closed`, `shift.variance`, `cash.movement`, `gap.explained`, `tax_rate.changed`, `outlet.changed`, `invoice_prefix.changed`, `feature_flag.changed`, `release_policy.changed`, `pending.exported`, `drawer.opened`, `attention.resolved`, `user.changed`, **`screen.unlock_override`** (PRD: **hanya** override supervisor dan penguncian PIN salah berulang yang diaudit; kunci/buka biasa oleh staf yang sama tidak diaudit, BR-AUT-015 butir 5).

---

### A.5 Katalog kode error (stabil; bukan teks bahasa)

Kode error dipakai di **`KODE#id`** layar (BR-LOG-008), `device_log.code`, `outbox_command.last_error_code`, `device_sync_status.last_error_code`, dan `attention_item.reason_code`. **Sumber kebenaran = registri `lib/contracts/error-codes.ts`** (diuji snapshot emas; ARCHITECTURE §9.7.1, `DISEPAKATI` user 2026-11-18; daftar final = OQ-A24 di ARCHITECTURE). Tabel ini mencerminkan isinya dan **tidak** memakai `CHECK IN` di database (hanya format `^[A-Z][A-Z0-9_]{1,39}$`).

**Aturan stabilitas:** (1) **arti kode tidak pernah berubah**; (2) katalog **hanya bertambah** — kode yang dihentikan **tetap dikenali** (ditandai usang + `replacedBy`), **tidak dihapus dan tidak dipakai ulang** untuk arti lain; (3) kode **bukan teks bahasa**: kalimat tindakan datang dari kamus i18n (BR-I18N-004); kode dan ID tidak diterjemahkan; (4) klien yang menemui kode yang belum dikenal menampilkan pesan generik + `KODE#id` (kode baru **tidak** menaikkan `schema_version`); (5) penamaan `HURUF_BESAR_DENGAN_GARIS_BAWAH`, ≤ 40 karakter.

**(1) Katalog kode tampilan — 22 kode** (ARCHITECTURE §9.7.1):

| Kelompok | Kode |
|---|---|
| Umum (BR-LOG-008) — 6 | `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_FAILED`, `DB_UNAVAILABLE`, `TIMEOUT`, `INTERNAL_ERROR` |
| Perangkat/kredensial — 6 | `PRINT_FAILED`, `PIN_LOCKED`, `DEVICE_REVOKED`, `CREDENTIAL_EXPIRED`, `LEASE_EXPIRED`, `APP_ERROR` |
| Versi/sinkron/tenant — 4 | `UPDATE_REQUIRED`, `SYNC_HELD` (alasan di `reason_code`: `SCHEMA`, `SERVER_BEHIND`, `TENANT_SUSPENDED`), `TENANT_SUSPENDED`, `FEATURE_DISABLED` |
| Penyimpanan lokal — 3 | `STORAGE_LOW`, `STORAGE_FULL`, `LOCAL_DB_FAILED` |
| Bisnis/laju — 3 | `HANDOVER_NOT_PENDING`, `EVENTS_PENDING`, `RATE_LIMITED` |

**(2) Kode data `attention_item.reason_code`** (bukan kode tampilan kasir; SCHEMA §4.6.3): `VALIDATION_FAILED`, `UNKNOWN_REFERENCE`, `DEVICE_REVOKED`, `CREDENTIAL_INVALID`, `SERIES_CONFLICT`, `RETURN_EXCEEDS_QTY`, `PAYMENT_MISMATCH`, `SCHEMA_NOT_MIGRATABLE` (sebagian sama dengan katalog (1)).

**(3) Kode log perangkat non-tampilan** (`device_log.code` saja; tidak muncul di layar): `SYNC_FAILED`, `CLOCK_ANOMALY`, `PERSIST_DENIED`, `UPDATE_ACCEPTED`, `UPDATE_REJECTED`.

`device_log.code` ∈ katalog (1) ∪ (3).

## Lampiran B — Tipe Perintah (Command) Push

Diproses idempoten oleh `idempotency_command`; tiap perintah **atomik dalam satu transaksi** server (BR-SYN-020, BR-ARC-005). `dependency_key` menentukan urutan/dependensi (BR-SYN-023). Nama tipe selain `FinalizeSale`, `VoidSale`, `FinalizeCreditNote`, `OpenShift`, `CloseShift`, dan `BillEvent` bersifat usulan.

| Tipe | Tabel yang ditulis (server) | `dependency_key` | Rujukan |
|---|---|---|---|
| `FinalizeSale` | `sale`, `sale_line`, `sale_line_modifier`, `sale_payment`, `stock_movement`, `stock_balance`, `invoice_series`, `invoice_gap`, `data_flag`, `bill` (status `PAID`), `audit_log` | `sale:{id}`; bila F&B juga `bill:{bill_id}` | BR-SYN-020, FR-SYN-004 |
| `VoidSale` | `sale` (status), `stock_movement` (`SALE_VOID`), `audit_log` | `sale:{sale_id}` (menunggu `FinalizeSale`-nya) | BR-INV-005 |
| `FinalizeCreditNote` | `credit_note(+line,+refund)`, `stock_movement` (`RETURN_IN`), `invoice_series`, `invoice_gap`, `audit_log` | `sale:{original_sale_id}` (menunggu invoice asal; EC-027) | BR-RTR-* |
| `OpenShift` | `cash_cashier` | `shift:{id}` | BR-SHF-002 |
| `RecordCashMovement` | `cash_movement`, `audit_log` | `shift:{shift_id}` | BR-SHF-004 |
| `CloseShift` | `cash_cashier` (status, hitungan), rekap server | `shift:{id}` | BR-SHF-005 |
| `AppendBillEvents` (`BillEvent`) | `bill_event` (termasuk `PREBILL_PRINTED`), `bill` (`prebill_*`, `last_content_seq`), `bill_item(+modifier)` | `bill:{bill_id}` (urut `bill_seq`) | BR-SYN-021, BR-FNB-010 |
| `HandOverBill` (**online-only**, tanpa outbox; nama `DIUSULKAN`) | `bill_event` (`BILL_HANDED_OVER`), `bill` (`handover_*`) | `bill:{bill_id}` | BR-FNB-012 |
| `AcceptBill` (**online-only**) | `bill_event` (`BILL_ACCEPTED`), `bill` (`lease_device_id`, `lease_register_id`, `handover_*`) dalam satu transaksi | `bill:{bill_id}` | BR-FNB-012/013, FLOW-19 |
| `CancelBillHandover` (**online-only**) | `bill_event` (`BILL_HANDOVER_CANCELED`), `bill` (`handover_*`) | `bill:{bill_id}` | BR-FNB-012 butir 3 |
| `AppendAudit` | `audit_log` | — | BR-AUD-003 |
| `ReportPinState` | `staff_pin_state`, `audit_log` (`pin.locked`) | — | BR-AUT-005 |

`HandOverBill`, `AcceptBill`, `CancelBillHandover` berbaris di `idempotency_command` dengan `channel='ONLINE'` (`device_seq` `NULL`, tanpa antrean/dependensi FIFO). `EnrollDevice` **bukan** perintah push (§4.6.2).

Saluran non-perintah (kegagalan **tidak** masuk "perlu perhatian"): pengiriman `device_log` (BR-LOG-010 butir 4), laporan status device (`device_sync_status`).

---

## Lampiran C — Ilustrasi DDL (bukan file migrasi)

```sql
-- C.1 price_entry: FK komposit tenant-aman + FK ke sku_uom + unik NULLS NOT DISTINCT (BR-PRC-001/002)
CREATE TABLE price_entry (
  id          uuid PRIMARY KEY,
  tenant_id   uuid   NOT NULL,
  sku_id      uuid   NOT NULL,
  uom_id      uuid   NOT NULL,
  outlet_id   uuid,                                   -- NULL = harga default tenant
  price       bigint NOT NULL CHECK (price >= 0),     -- integer rupiah
  currency    char(3) NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  version     bigint NOT NULL CHECK (version > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid, updated_by uuid,
  deleted_at  timestamptz,
  FOREIGN KEY (tenant_id, sku_id, uom_id) REFERENCES sku_uom (tenant_id, sku_id, uom_id),
  FOREIGN KEY (tenant_id, outlet_id)      REFERENCES outlet  (tenant_id, id),
  CONSTRAINT uq_price_entry__key UNIQUE NULLS NOT DISTINCT (tenant_id, sku_id, uom_id, outlet_id)
);
CREATE INDEX ix_price_entry__feed        ON price_entry (tenant_id, outlet_id, version, id);
CREATE INDEX ix_price_entry__feed_default ON price_entry (tenant_id, version, id) WHERE outlet_id IS NULL;

-- C.2 invoice_gap: gap aktif tidak boleh tumpang tindih (butuh ekstensi btree_gist)
ALTER TABLE invoice_gap ADD CONSTRAINT ex_invoice_gap__overlap
  EXCLUDE USING gist (register_id WITH =, doc_type WITH =, period WITH =,
                      int4range(seq_from, seq_to, '[]') WITH &&)
  WHERE (status <> 'FILLED');

-- C.3 stock_balance: kolom saldo + pengaman (stok minus DIIZINKAN: tidak ada CHECK qty >= 0)
CREATE TABLE stock_balance (
  outlet_id uuid NOT NULL, sku_id uuid NOT NULL, tenant_id uuid NOT NULL,
  qty             numeric(18,4) NOT NULL DEFAULT 0 CHECK (qty = trunc(qty, 4)),
  inventory_value bigint        NOT NULL DEFAULT 0,
  ref_value       bigint        NOT NULL DEFAULT 0,
  ref_qty         numeric(18,4) NOT NULL DEFAULT 0 CHECK (ref_qty >= 0),
  rev             bigint        NOT NULL DEFAULT 0,
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (outlet_id, sku_id),
  CHECK (qty <> 0 OR inventory_value = 0)             -- qty 0 ⇒ nilai 0 (BR-HPP-003)
) WITH (fillfactor = 70);
CREATE INDEX ix_stock_balance__negative ON stock_balance (tenant_id, outlet_id) WHERE qty < 0;

-- C.4 Pengeluaran stok dengan moving average (BR-HPP-003) — pseudo-SQL di bawah row lock
--   saldo: qty = 120, nilai = 985000 ; keluar q_out = 7
--   HPP = ROUND(nilai * q_out / qty)  -- half-up ke integer; bila q_out = qty maka HPP = nilai
--       = ROUND(985000 * 7 / 120) = ROUND(57458.33) = 57458
--   UPDATE stock_balance SET qty = qty - 7, inventory_value = inventory_value - 57458, rev = rev + 1 ...
--   INSERT stock_movement (..., qty_delta = -7, value_delta = -57458, qty_after = 113, value_after = 927542, bal_seq = rev)

-- C.5 RLS (pola per tabel)
ALTER TABLE price_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON price_entry
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- C.6 sale: seri nomor per register tanpa celah + unik per tenant (BR-INV-002/003)
ALTER TABLE sale ADD CONSTRAINT uq_sale__invoice_no UNIQUE (tenant_id, invoice_no);
ALTER TABLE sale ADD CONSTRAINT uq_sale__series
  UNIQUE (register_id, invoice_period, invoice_seq, invoice_conflict_idx);
```

*— Akhir dokumen —*
