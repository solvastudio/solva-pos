CREATE TABLE "staff_pin" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_salt" "bytea" NOT NULL,
	"pin_hash" "bytea" NOT NULL,
	"kdf_algo" text NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"kdf_salt" "bytea" NOT NULL,
	"pin_epoch" integer NOT NULL,
	CONSTRAINT "uq_staff_pin__user_device" UNIQUE("user_id","device_id"),
	CONSTRAINT "ck_staff_pin__algo" CHECK ("staff_pin"."kdf_algo" IN ('ARGON2ID', 'PBKDF2_SHA256')),
	CONSTRAINT "ck_staff_pin__epoch" CHECK ("staff_pin"."pin_epoch" >= 1),
	CONSTRAINT "ck_staff_pin__version" CHECK ("staff_pin"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff_pin_state" (
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"lock_tier" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamptz,
	"last_failed_at" timestamptz,
	"pin_epoch_seen" integer DEFAULT 1 NOT NULL,
	"reported_at" timestamptz DEFAULT now() NOT NULL,
	"last_device_seq" bigint NOT NULL,
	CONSTRAINT "pk_staff_pin_state" PRIMARY KEY("user_id","device_id"),
	CONSTRAINT "ck_staff_pin_state__failed_count" CHECK ("staff_pin_state"."failed_count" BETWEEN 0 AND 15),
	CONSTRAINT "ck_staff_pin_state__lock_tier" CHECK ("staff_pin_state"."lock_tier" BETWEEN 0 AND 3),
	CONSTRAINT "ck_staff_pin_state__epoch" CHECK ("staff_pin_state"."pin_epoch_seen" >= 1)
);
--> statement-breakpoint
CREATE TABLE "user_pin_credential" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kdf_algo" text NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"kdf_salt" "bytea" NOT NULL,
	"verifier" "bytea" NOT NULL,
	"pin_epoch" integer DEFAULT 1 NOT NULL,
	"pin_set_at" timestamptz DEFAULT now() NOT NULL,
	"pin_set_by" uuid NOT NULL,
	CONSTRAINT "ck_user_pin_credential__algo" CHECK ("user_pin_credential"."kdf_algo" IN ('ARGON2ID', 'PBKDF2_SHA256')),
	CONSTRAINT "ck_user_pin_credential__epoch" CHECK ("user_pin_credential"."pin_epoch" >= 1)
);
--> statement-breakpoint
ALTER TABLE "staff_pin" ADD CONSTRAINT "fk_staff_pin__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pin" ADD CONSTRAINT "fk_staff_pin__user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pin" ADD CONSTRAINT "fk_staff_pin__device" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pin_state" ADD CONSTRAINT "fk_staff_pin_state__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pin_state" ADD CONSTRAINT "fk_staff_pin_state__user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pin_state" ADD CONSTRAINT "fk_staff_pin_state__device" FOREIGN KEY ("tenant_id","device_id") REFERENCES "public"."device"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pin_credential" ADD CONSTRAINT "fk_user_pin_credential__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pin_credential" ADD CONSTRAINT "fk_user_pin_credential__user" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pin_credential" ADD CONSTRAINT "fk_user_pin_credential__set_by" FOREIGN KEY ("tenant_id","pin_set_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_staff_pin__feed" ON "staff_pin" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_staff_pin__device_feed" ON "staff_pin" USING btree ("tenant_id","device_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_staff_pin_state__tenant_user" ON "staff_pin_state" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_user_pin_credential__tenant" ON "user_pin_credential" USING btree ("tenant_id");