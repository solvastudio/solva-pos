CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"name" text NOT NULL,
	"credential_hash" "bytea" NOT NULL,
	"credential_issued_at" timestamptz DEFAULT now() NOT NULL,
	"credential_expires_at" timestamptz NOT NULL,
	"pairing_code_id" uuid,
	"user_agent" text,
	"enrolled_at" timestamptz DEFAULT now() NOT NULL,
	"enrolled_by" uuid NOT NULL,
	"revoked_at" timestamptz,
	"revoked_by" uuid,
	"revoke_reason_code" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "uq_device__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_device__credential_hash" UNIQUE("credential_hash"),
	CONSTRAINT "ck_device__name_len" CHECK (char_length("device"."name") BETWEEN 1 AND 80),
	CONSTRAINT "ck_device__user_agent_len" CHECK (char_length("device"."user_agent") <= 300),
	CONSTRAINT "ck_device__revoke_reason_code" CHECK ("device"."revoke_reason_code" IN ('LOST', 'REPLACED', 'STOLEN', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "device_sync_status" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"last_attempt_at" timestamptz,
	"last_success_sync_at" timestamptz,
	"last_push_at" timestamptz,
	"last_pull_at" timestamptz,
	"pull_cursor_version" bigint,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"oldest_pending_at" timestamptz,
	"attention_count" integer DEFAULT 0 NOT NULL,
	"clock_offset_ms" integer,
	"clock_offset_at" timestamptz,
	"app_version" text,
	"schema_version" integer,
	"sync_protocol_version" integer,
	"storage_persist" text DEFAULT 'UNKNOWN' NOT NULL,
	"storage_used_pct" smallint,
	"last_error_code" text,
	"last_error_ref" text,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ck_device_sync_status__pending_count" CHECK ("device_sync_status"."pending_count" >= 0),
	CONSTRAINT "ck_device_sync_status__attention_count" CHECK ("device_sync_status"."attention_count" >= 0),
	CONSTRAINT "ck_device_sync_status__storage_persist" CHECK ("device_sync_status"."storage_persist" IN ('GRANTED', 'DENIED', 'UNKNOWN')),
	CONSTRAINT "ck_device_sync_status__storage_used_pct" CHECK ("device_sync_status"."storage_used_pct" >= 0 AND "device_sync_status"."storage_used_pct" <= 100),
	CONSTRAINT "ck_device_sync_status__last_error_code" CHECK ("device_sync_status"."last_error_code" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
	CONSTRAINT "ck_device_sync_status__last_error_ref" CHECK ("device_sync_status"."last_error_ref" ~ '^[A-Za-z0-9._-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "pairing_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"used_at" timestamptz,
	"used_by_device_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pairing_code__code_hash" UNIQUE("code_hash"),
	CONSTRAINT "ck_pairing_code__expires_gt_created" CHECK ("pairing_code"."expires_at" > "pairing_code"."created_at")
);
--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "fk_device__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "fk_device__register" FOREIGN KEY ("tenant_id","register_id") REFERENCES "public"."cash_master"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "fk_device__pairing_code" FOREIGN KEY ("pairing_code_id") REFERENCES "public"."pairing_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "fk_device__enrolled_by" FOREIGN KEY ("tenant_id","enrolled_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "fk_device__revoked_by" FOREIGN KEY ("tenant_id","revoked_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_status" ADD CONSTRAINT "fk_device_sync_status__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_status" ADD CONSTRAINT "fk_device_sync_status__device" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_status" ADD CONSTRAINT "fk_device_sync_status__register" FOREIGN KEY ("tenant_id","register_id") REFERENCES "public"."cash_master"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_code" ADD CONSTRAINT "fk_pairing_code__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_code" ADD CONSTRAINT "fk_pairing_code__register" FOREIGN KEY ("tenant_id","register_id") REFERENCES "public"."cash_master"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_code" ADD CONSTRAINT "fk_pairing_code__created_by" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_device__active_register" ON "device" USING btree ("register_id") WHERE "device"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_device__tenant_register" ON "device" USING btree ("tenant_id","register_id");--> statement-breakpoint
CREATE INDEX "ix_device_sync_status__tenant_register" ON "device_sync_status" USING btree ("tenant_id","register_id");--> statement-breakpoint
CREATE INDEX "ix_pairing_code__tenant_register" ON "pairing_code" USING btree ("tenant_id","register_id");