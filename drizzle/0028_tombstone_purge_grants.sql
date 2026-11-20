-- Allow tombstone physical purge below tombstone_floor_version for unreferenced tables (Phase 33)
SELECT solva_grant_app('price_entry', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('feature_flag', 'SELECT, INSERT, UPDATE, DELETE');
