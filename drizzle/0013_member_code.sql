CREATE TABLE "member_code" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"email" "citext" NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"used_at" timestamptz,
	"redeemed_auth_user_id" text,
	"revoked_at" timestamptz,
	"revoke_reason" text,
	"issued_by" uuid,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "uq_member_code__code_hash" UNIQUE("code_hash"),
	CONSTRAINT "ck_member_code__kind" CHECK ("member_code"."kind" IN ('INVITE', 'RESET')),
	CONSTRAINT "ck_member_code__email_len" CHECK (char_length("member_code"."email") <= 254),
	CONSTRAINT "ck_member_code__expires_gt_created" CHECK ("member_code"."expires_at" > "member_code"."created_at"),
	CONSTRAINT "ck_member_code__revoke_reason" CHECK ("member_code"."revoke_reason" IN ('CANCELED', 'REPLACED')),
	CONSTRAINT "ck_member_code__used_or_revoked" CHECK ("member_code"."used_at" IS NULL OR "member_code"."revoked_at" IS NULL),
	CONSTRAINT "ck_member_code__revoked_pair" CHECK (("member_code"."revoked_at" IS NULL) = ("member_code"."revoke_reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "member_code" ADD CONSTRAINT "fk_member_code__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_code" ADD CONSTRAINT "fk_member_code__app_user" FOREIGN KEY ("tenant_id","app_user_id") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_code" ADD CONSTRAINT "fk_member_code__issued_by" FOREIGN KEY ("tenant_id","issued_by") REFERENCES "public"."app_user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_member_code__active_user_kind" ON "member_code" USING btree ("app_user_id","kind") WHERE "member_code"."used_at" IS NULL AND "member_code"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_member_code__user_kind_created" ON "member_code" USING btree ("app_user_id","kind","created_at" DESC);--> statement-breakpoint
CREATE INDEX "ix_member_code__expires_at" ON "member_code" USING btree ("expires_at");