CREATE TABLE "audit_chain_head" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"last_hash" "bytea" NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"chain_seq" bigint NOT NULL,
	"outlet_id" uuid,
	"register_id" uuid,
	"device_id" uuid,
	"actor_user_id" uuid,
	"approver_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_data" jsonb,
	"after_data" jsonb,
	"reason_code" text,
	"reason_text" text,
	"occurred_at_device" timestamptz,
	"clock_offset_ms" integer,
	"occurred_at" timestamptz NOT NULL,
	"recorded_at" timestamptz DEFAULT now() NOT NULL,
	"business_date" date,
	"command_id" uuid,
	"request_ref" text,
	"schema_version" integer,
	"app_version" text,
	"prev_hash" "bytea" NOT NULL,
	"row_hash" "bytea" NOT NULL,
	CONSTRAINT "uq_audit_log__tenant_seq" UNIQUE("tenant_id","chain_seq"),
	CONSTRAINT "ck_audit_log__chain_seq" CHECK ("audit_log"."chain_seq" > 0),
	CONSTRAINT "ck_audit_log__approver_not_actor" CHECK ("audit_log"."approver_user_id" IS NULL OR "audit_log"."approver_user_id" <> "audit_log"."actor_user_id"),
	CONSTRAINT "ck_audit_log__action" CHECK ("audit_log"."action" ~ '^[a-z_.]{3,60}$'),
	CONSTRAINT "ck_audit_log__schema_version" CHECK ("audit_log"."schema_version" > 0),
	CONSTRAINT "ck_audit_log__app_version_len" CHECK (char_length("audit_log"."app_version") <= 30),
	CONSTRAINT "ck_audit_log__app_version_semver" CHECK ("audit_log"."app_version" ~ '^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$')
);
--> statement-breakpoint
CREATE INDEX "ix_audit_log__tenant_recorded" ON "audit_log" USING btree ("tenant_id","recorded_at");--> statement-breakpoint
CREATE INDEX "ix_audit_log__tenant_entity" ON "audit_log" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ix_audit_log__tenant_action" ON "audit_log" USING btree ("tenant_id","action","recorded_at");