-- Hak kolom tambahan untuk dokumen inventori (Fase 54): nomor dokumen diberikan saat posting/kirim,
-- dan draft dapat mengubah tanggal bisnis serta tujuan transfer. Kolom kunci lain tetap tidak dapat diubah.
GRANT UPDATE (doc_no, business_date) ON "goods_receipt" TO solva_app;
--> statement-breakpoint
GRANT UPDATE (doc_no, business_date, to_outlet_id) ON "transfer" TO solva_app;
--> statement-breakpoint
GRANT UPDATE (doc_no) ON "stocktake" TO solva_app;
