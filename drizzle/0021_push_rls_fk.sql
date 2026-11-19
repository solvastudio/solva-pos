ALTER TABLE "idempotency_command"
  ADD CONSTRAINT "fk_idempotency_command__tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "idempotency_command"
  ADD CONSTRAINT "fk_idempotency_command__device"
  FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "idempotency_command"
  ADD CONSTRAINT "fk_idempotency_command__register"
  FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "idempotency_command"
  ADD CONSTRAINT "fk_idempotency_command__outlet"
  FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attention_item"
  ADD CONSTRAINT "fk_attention_item__tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attention_item"
  ADD CONSTRAINT "fk_attention_item__outlet"
  FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attention_item"
  ADD CONSTRAINT "fk_attention_item__register"
  FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_master" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attention_item"
  ADD CONSTRAINT "fk_attention_item__device"
  FOREIGN KEY ("tenant_id", "device_id") REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "attention_item"
  ADD CONSTRAINT "fk_attention_item__resolved_by"
  FOREIGN KEY ("tenant_id", "resolved_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "data_flag"
  ADD CONSTRAINT "fk_data_flag__tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant" ("id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "data_flag"
  ADD CONSTRAINT "fk_data_flag__outlet"
  FOREIGN KEY ("tenant_id", "outlet_id") REFERENCES "outlet" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "data_flag"
  ADD CONSTRAINT "fk_data_flag__acknowledged_by"
  FOREIGN KEY ("tenant_id", "acknowledged_by") REFERENCES "app_user" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE "audit_log"
  ADD CONSTRAINT "fk_audit_log__command"
  FOREIGN KEY ("command_id") REFERENCES "idempotency_command" ("command_id") ON DELETE NO ACTION NOT VALID;
--> statement-breakpoint
ALTER TABLE "audit_log" VALIDATE CONSTRAINT "fk_audit_log__command";
--> statement-breakpoint
SELECT solva_enable_tenant_rls('idempotency_command');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('attention_item');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('data_flag');
--> statement-breakpoint
GRANT SELECT, INSERT ON "idempotency_command" TO solva_app;
--> statement-breakpoint
GRANT UPDATE (status, result, processed_at, duration_ms, attempt_count) ON "idempotency_command" TO solva_app;
--> statement-breakpoint
SELECT solva_grant_app('attention_item', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('data_flag', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE FUNCTION forbid_idempotency_immutable_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.command_type IS DISTINCT FROM OLD.command_type
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.device_seq IS DISTINCT FROM OLD.device_seq THEN
    RAISE EXCEPTION 'immutable idempotency_command fields cannot be modified';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER idempotency_immutable_guard
  BEFORE UPDATE ON "idempotency_command"
  FOR EACH ROW EXECUTE FUNCTION forbid_idempotency_immutable_update();
