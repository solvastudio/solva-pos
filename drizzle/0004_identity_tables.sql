CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"auth_user_id" text,
	"display_name" text NOT NULL,
	"preferred_locale" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"membership_status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "uq_app_user__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_app_user__version" CHECK ("app_user"."version" > 0),
	CONSTRAINT "ck_app_user__display_name_len" CHECK (char_length("app_user"."display_name") BETWEEN 1 AND 80),
	CONSTRAINT "ck_app_user__preferred_locale" CHECK ("app_user"."preferred_locale" IN ('id-ID', 'en-US')),
	CONSTRAINT "ck_app_user__membership_status" CHECK ("app_user"."membership_status" IN ('PENDING', 'ACTIVE')),
	CONSTRAINT "ck_app_user__pending_no_auth" CHECK ("app_user"."membership_status" = 'ACTIVE' OR "app_user"."auth_user_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "cash_master" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"outlet_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"register_type" text DEFAULT 'CASHIER' NOT NULL,
	"paper_width_mm" smallint DEFAULT 80 NOT NULL,
	"default_locale" text,
	CONSTRAINT "uq_cash_master__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_cash_master__outlet_code" UNIQUE("outlet_id","code"),
	CONSTRAINT "ck_cash_master__version" CHECK ("cash_master"."version" > 0),
	CONSTRAINT "ck_cash_master__code" CHECK ("cash_master"."code" ~ '^[A-Z0-9]{1,10}$'),
	CONSTRAINT "ck_cash_master__status" CHECK ("cash_master"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "ck_cash_master__register_type" CHECK ("cash_master"."register_type" IN ('CASHIER', 'WAITER')),
	CONSTRAINT "ck_cash_master__paper_width_mm" CHECK ("cash_master"."paper_width_mm" IN (58, 80)),
	CONSTRAINT "ck_cash_master__default_locale" CHECK ("cash_master"."default_locale" IN ('id-ID', 'en-US'))
);
--> statement-breakpoint
CREATE TABLE "legal_entity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"name" text NOT NULL,
	"npwp" text,
	"is_pkp" boolean DEFAULT false NOT NULL,
	"pkp_since" date,
	"address" text,
	CONSTRAINT "uq_legal_entity__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_legal_entity__version" CHECK ("legal_entity"."version" > 0),
	CONSTRAINT "ck_legal_entity__name_len" CHECK (char_length("legal_entity"."name") BETWEEN 1 AND 160),
	CONSTRAINT "ck_legal_entity__npwp" CHECK ("legal_entity"."npwp" ~ '^\d{15,16}$'),
	CONSTRAINT "ck_legal_entity__pkp_npwp" CHECK ("legal_entity"."is_pkp" = false OR "legal_entity"."npwp" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "outlet" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"legal_entity_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"day_cutoff_time" time DEFAULT '00:00' NOT NULL,
	"cash_rounding_unit" integer DEFAULT 100 NOT NULL,
	"price_tax_mode" text NOT NULL,
	"tax_profile" text DEFAULT 'NONE' NOT NULL,
	"service_charge_enabled" boolean DEFAULT false NOT NULL,
	"service_charge_rate" numeric(7, 4) DEFAULT 0 NOT NULL,
	"service_charge_taxable" boolean DEFAULT true NOT NULL,
	"inventory_enabled_at" timestamptz,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_outlet__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_outlet__tenant_code" UNIQUE("tenant_id","code"),
	CONSTRAINT "ck_outlet__version" CHECK ("outlet"."version" > 0),
	CONSTRAINT "ck_outlet__code" CHECK ("outlet"."code" ~ '^[A-Z0-9]{1,10}$'),
	CONSTRAINT "ck_outlet__name_len" CHECK (char_length("outlet"."name") BETWEEN 1 AND 120),
	CONSTRAINT "ck_outlet__timezone" CHECK ("outlet"."timezone" IN ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')),
	CONSTRAINT "ck_outlet__cash_rounding_unit" CHECK ("outlet"."cash_rounding_unit" IN (0, 100, 500, 1000)),
	CONSTRAINT "ck_outlet__price_tax_mode" CHECK ("outlet"."price_tax_mode" IN ('INCLUSIVE', 'EXCLUSIVE')),
	CONSTRAINT "ck_outlet__tax_profile" CHECK ("outlet"."tax_profile" IN ('NONE', 'PPN', 'PB1')),
	CONSTRAINT "ck_outlet__service_charge_rate_range" CHECK ("outlet"."service_charge_rate" >= 0 AND "outlet"."service_charge_rate" <= 100),
	CONSTRAINT "ck_outlet__service_charge_enabled" CHECK ("outlet"."service_charge_enabled" OR "outlet"."service_charge_rate" = 0)
);
--> statement-breakpoint
CREATE TABLE "outlet_receipt_setting" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"outlet_id" uuid NOT NULL,
	"receipt_locale" text DEFAULT 'id-ID' NOT NULL,
	"header_text" text,
	"footer_text" text,
	"logo_object_key" text,
	"logo_sha256" text,
	CONSTRAINT "uq_outlet_receipt_setting__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_outlet_receipt_setting__outlet_id" UNIQUE("outlet_id"),
	CONSTRAINT "ck_outlet_receipt_setting__version" CHECK ("outlet_receipt_setting"."version" > 0),
	CONSTRAINT "ck_outlet_receipt_setting__locale" CHECK ("outlet_receipt_setting"."receipt_locale" IN ('id-ID', 'en-US')),
	CONSTRAINT "ck_outlet_receipt_setting__header_len" CHECK (char_length("outlet_receipt_setting"."header_text") <= 600),
	CONSTRAINT "ck_outlet_receipt_setting__footer_len" CHECK (char_length("outlet_receipt_setting"."footer_text") <= 600),
	CONSTRAINT "ck_outlet_receipt_setting__logo_key_len" CHECK (char_length("outlet_receipt_setting"."logo_object_key") <= 200),
	CONSTRAINT "ck_outlet_receipt_setting__logo_sha256" CHECK ("outlet_receipt_setting"."logo_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payment_method" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"requires_reference" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_payment_method__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_payment_method__version" CHECK ("payment_method"."version" > 0),
	CONSTRAINT "ck_payment_method__code" CHECK ("payment_method"."code" ~ '^[A-Z0-9_]{2,20}$'),
	CONSTRAINT "ck_payment_method__name_len" CHECK (char_length("payment_method"."name") BETWEEN 1 AND 60),
	CONSTRAINT "ck_payment_method__kind" CHECK ("payment_method"."kind" IN ('CASH', 'NON_CASH'))
);
--> statement-breakpoint
CREATE TABLE "permission" (
	"code" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "ck_permission__code" CHECK ("permission"."code" ~ '^[a-z_.]{3,50}$')
);
--> statement-breakpoint
CREATE TABLE "register_invoice_prefix" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"register_id" uuid NOT NULL,
	"effective_month" date NOT NULL,
	"invoice_prefix" text NOT NULL,
	CONSTRAINT "uq_register_invoice_prefix__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_register_invoice_prefix__reg_month" UNIQUE("register_id","effective_month"),
	CONSTRAINT "ck_register_invoice_prefix__version" CHECK ("register_invoice_prefix"."version" > 0),
	CONSTRAINT "ck_register_invoice_prefix__month_start" CHECK (EXTRACT(day FROM "register_invoice_prefix"."effective_month") = 1),
	CONSTRAINT "ck_register_invoice_prefix__len" CHECK (char_length("register_invoice_prefix"."invoice_prefix") BETWEEN 2 AND 16),
	CONSTRAINT "ck_register_invoice_prefix__format" CHECK ("register_invoice_prefix"."invoice_prefix" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
	CONSTRAINT "ck_register_invoice_prefix__not_nk" CHECK ("register_invoice_prefix"."invoice_prefix" !~ '(^|-)NK$')
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"discount_limit_pct" numeric(7, 4) DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_role__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_role__version" CHECK ("role"."version" > 0),
	CONSTRAINT "ck_role__code" CHECK ("role"."code" ~ '^[A-Z_]{2,30}$'),
	CONSTRAINT "ck_role__discount_limit" CHECK ("role"."discount_limit_pct" >= 0 AND "role"."discount_limit_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"role_id" uuid NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "uq_role_permission__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_role_permission__role_perm" UNIQUE("role_id","permission_code"),
	CONSTRAINT "ck_role_permission__version" CHECK ("role_permission"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tax_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"tax_code" text NOT NULL,
	"outlet_id" uuid,
	"effective_from" date NOT NULL,
	"rate" numeric(7, 4) NOT NULL,
	CONSTRAINT "uq_tax_rate_history__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_tax_rate_history__key" UNIQUE NULLS NOT DISTINCT("tenant_id","tax_code","outlet_id","effective_from"),
	CONSTRAINT "ck_tax_rate_history__version" CHECK ("tax_rate_history"."version" > 0),
	CONSTRAINT "ck_tax_rate_history__tax_code" CHECK ("tax_rate_history"."tax_code" IN ('PPN', 'PB1')),
	CONSTRAINT "ck_tax_rate_history__rate" CHECK ("tax_rate_history"."rate" >= 0 AND "tax_rate_history"."rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "user_outlet" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"user_id" uuid NOT NULL,
	"outlet_id" uuid,
	"role_id" uuid NOT NULL,
	CONSTRAINT "uq_user_outlet__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_user_outlet__version" CHECK ("user_outlet"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "fk_app_user__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_master" ADD CONSTRAINT "fk_cash_master__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_master" ADD CONSTRAINT "fk_cash_master__outlet" FOREIGN KEY ("tenant_id","outlet_id") REFERENCES "public"."outlet"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "fk_legal_entity__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet" ADD CONSTRAINT "fk_outlet__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet" ADD CONSTRAINT "fk_outlet__legal_entity" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entity"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_receipt_setting" ADD CONSTRAINT "fk_outlet_receipt_setting__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_receipt_setting" ADD CONSTRAINT "fk_outlet_receipt_setting__outlet" FOREIGN KEY ("tenant_id","outlet_id") REFERENCES "public"."outlet"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "fk_payment_method__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_invoice_prefix" ADD CONSTRAINT "fk_register_invoice_prefix__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_invoice_prefix" ADD CONSTRAINT "fk_register_invoice_prefix__register" FOREIGN KEY ("tenant_id","register_id") REFERENCES "public"."cash_master"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "fk_role__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_permission_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permission"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "fk_role_permission__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "fk_role_permission__role" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."role"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate_history" ADD CONSTRAINT "fk_tax_rate_history__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate_history" ADD CONSTRAINT "fk_tax_rate_history__outlet" FOREIGN KEY ("tenant_id","outlet_id") REFERENCES "public"."outlet"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_outlet" ADD CONSTRAINT "fk_user_outlet__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_outlet" ADD CONSTRAINT "fk_user_outlet__user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_outlet" ADD CONSTRAINT "fk_user_outlet__outlet" FOREIGN KEY ("tenant_id","outlet_id") REFERENCES "public"."outlet"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_outlet" ADD CONSTRAINT "fk_user_outlet__role" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."role"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_app_user__tenant_version_id" ON "app_user" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_user__tenant_display_name" ON "app_user" USING btree ("tenant_id","display_name") WHERE "app_user"."deleted_at" IS NULL AND "app_user"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_user__tenant_auth_user" ON "app_user" USING btree ("tenant_id","auth_user_id") WHERE "app_user"."auth_user_id" IS NOT NULL AND "app_user"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_app_user__auth_user_active" ON "app_user" USING btree ("auth_user_id") WHERE "app_user"."auth_user_id" IS NOT NULL AND "app_user"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_cash_master__tenant_version_id" ON "cash_master" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_legal_entity__tenant_version_id" ON "legal_entity" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_legal_entity__tenant_npwp" ON "legal_entity" USING btree ("tenant_id","npwp") WHERE "legal_entity"."npwp" IS NOT NULL AND "legal_entity"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_outlet__tenant_version_id" ON "outlet" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_outlet_receipt_setting__tenant_version_id" ON "outlet_receipt_setting" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_payment_method__tenant_version_id" ON "payment_method" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_method__tenant_code" ON "payment_method" USING btree ("tenant_id","code") WHERE "payment_method"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_method__single_cash" ON "payment_method" USING btree ("tenant_id") WHERE "payment_method"."kind" = 'CASH' AND "payment_method"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_register_invoice_prefix__tenant_version_id" ON "register_invoice_prefix" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_register_invoice_prefix__tenant_prefix" ON "register_invoice_prefix" USING btree ("tenant_id","invoice_prefix");--> statement-breakpoint
CREATE INDEX "ix_role__tenant_version_id" ON "role" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_role__tenant_code" ON "role" USING btree ("tenant_id","code") WHERE "role"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_role_permission__tenant_version_id" ON "role_permission" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_tax_rate_history__tenant_version_id" ON "tax_rate_history" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_user_outlet__tenant_version_id" ON "user_outlet" USING btree ("tenant_id","version","id");