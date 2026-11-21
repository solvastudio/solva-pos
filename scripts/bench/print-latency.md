# Prosedur Ukur Latensi Cetak (NFR-PERF-002) — perangkat nyata

Dijalankan **manual** oleh user di perangkat kasir sungguhan. Tidak diotomasi di CI karena `window.print()`
dan WebUSB/Bluetooth tidak tersedia di headless browser. Hasil ditulis ke `docs/spikes/F3-bukti-perangkat.md`.

## Persiapan

1. Pasangkan perangkat ke outlet uji (Pairing) lalu login staf kasir.
2. Buka shift dengan modal awal bebas.
3. Pengaturan Perangkat → pilih jalur cetak (WebUSB / Bluetooth BLE / Cetak browser), lebar kertas, dan profil printer. Tekan **Hubungkan printer**, lalu **Cetak uji** sampai berhasil.
4. Tutup semua aplikasi berat lain di perangkat.

## Langkah ukur

1. Siapkan keranjang tetap (mis. 3 item: Kopi Hitam, Teh Tarik, Roti Bakar).
2. Isi pembayaran tunai (uang pas) lalu tekan **Selesai**. Mulai stopwatch **tepat saat** layar Penjualan Selesai muncul (penjualan tersimpan).
3. Hentikan stopwatch saat printer **mulai** mencetak (byte pertama keluar; NFR-PERF-002 mengukur mulai mengirim byte ke printer, bukan selesai mencetak).
4. Catat juga panel **Uji cetak** (`SCR-P16`) bila perlu sebagai pembanding.
5. Ulangi minimal **20 kali** per jalur. Hitung p50 dan p95 dari selisih waktu.
6. Catat laci kas (terbuka atau tidak) dan hasil untuk karakter non-Latin.

## Kriteria lulus

- p95 ≤ 1 detik untuk struk ≤ 40 baris (NFR-PERF-002, PRD Bab 9) pada minimal satu jalur per model printer.
- Tidak ada penjualan yang hilang atau tertahan karena cetak (AP-10).
- Setiap kegagalan cetak tampil sebagai banner dan dapat dicetak ulang.

## Catatan

- Jangan menulis angka perkiraan. Jika tidak diukur, kolom dibiarkan kosong.
- Lampirkan tanggal, versi aplikasi, dan nama printer pada laporan.
