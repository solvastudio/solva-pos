-- Fase 54: nomor dokumen inventori ditetapkan sekali.
-- Dokumen dibuat dengan nomor sementara `DRAFT-xxxxxxxx`; posting/kirim/opname mengganti nomor itu
-- dengan nomor final `{JENIS}-{OUTLET}-{MMYY}-{URUT4}` (BR-STK-020). Kolom doc_no dan business_date
-- hanya boleh berubah saat nilai lama masih placeholder DRAFT, dan nomor final tidak boleh kembali
-- ke DRAFT. Grant UPDATE pada 0035 tetap diperlukan; trigger ini yang membatasi pemakaiannya.
CREATE OR REPLACE FUNCTION "solva_guard_doc_no"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."doc_no" IS DISTINCT FROM OLD."doc_no" THEN
    IF OLD."doc_no" NOT LIKE 'DRAFT-%' THEN
      RAISE EXCEPTION 'nomor dokumen sudah ditetapkan dan tidak dapat diubah' USING ERRCODE = '42501';
    END IF;
    IF NEW."doc_no" LIKE 'DRAFT-%' THEN
      RAISE EXCEPTION 'nomor final tidak boleh kembali ke DRAFT' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW."business_date" IS DISTINCT FROM OLD."business_date" AND OLD."doc_no" NOT LIKE 'DRAFT-%' THEN
    RAISE EXCEPTION 'tanggal bisnis dokumen sudah final dan tidak dapat diubah' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "trg_goods_receipt__doc_no" BEFORE UPDATE ON "goods_receipt"
  FOR EACH ROW EXECUTE FUNCTION "solva_guard_doc_no"();
--> statement-breakpoint
CREATE TRIGGER "trg_transfer__doc_no" BEFORE UPDATE ON "transfer"
  FOR EACH ROW EXECUTE FUNCTION "solva_guard_doc_no"();
--> statement-breakpoint
CREATE TRIGGER "trg_stocktake__doc_no" BEFORE UPDATE ON "stocktake"
  FOR EACH ROW EXECUTE FUNCTION "solva_guard_doc_no"();
