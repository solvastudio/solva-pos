# Bukti Perangkat F3 (templat — diisi user di perangkat nyata)

> **Status:** TEMPLAT KOSONG. Tidak ada angka di dokumen ini yang diisi oleh otomasi. Angka hanya boleh diisi
> dari pengukuran nyata mengikuti `scripts/bench/print-latency.md`.
> Dokumen ini tidak memblokir `gate:f3` (bagian perangkat = `MANUAL`), tetapi **memblokir rilis produksi pertama**
> sampai minimal satu jalur cetak terisi (PERLU KONFIRMASI: matriks perangkat, PRD Bab 15).

## Identitas uji

| Item | Nilai |
|---|---|
| Tanggal uji | |
| Penguji | |
| Versi aplikasi (`/health` atau footer Pengaturan Perangkat) | |
| Commit / tag | |

## Matriks printer (NFR-PERF-002, FR-PRN)

| Model printer | Koneksi (USB / BLE / browser-print) | OS | Browser (versi) | Lebar kertas (58/80 mm) | Profil printer | Jalur cetak (WebUSB / Bluetooth BLE / Cetak browser) |
|---|---|---|---|---|---|---|
| | | | | | | |

## Latensi "Selesai" (penjualan tersimpan) → printer mulai mencetak (≥ 20 cetak per jalur)

| Jalur | n | p50 (ms) | p95 (ms) | Target NFR-PERF-002 (mulai kirim byte ≤ 1000 ms, struk ≤ 40 baris) | Lulus (ya/tidak) |
|---|---|---|---|---|---|
| | | | | ≤ 1000 | |

## Perilaku perangkat

| Pemeriksaan | Hasil (ya/tidak) | Catatan |
|---|---|---|
| Laci kas terbuka otomatis / manual | | |
| Karakter non-Latin (transliterasi) | | |
| Potong kertas (jika didukung) | | |
| Struk gagal cetak: banner tampil, penjualan tetap tersimpan | | |
| Cetak ulang dari Pengaturan Perangkat (Daftar Cetak Gagal) | | |

## Keputusan

- Jalur cetak yang disetujui untuk rilis pertama: _(belum diputuskan)_
- Catatan risiko: _(isi)_
