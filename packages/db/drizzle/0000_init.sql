CREATE SEQUENCE "public"."request_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"doc_version" text NOT NULL,
	"doc_sha256" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"house_id" text NOT NULL,
	"kind" text NOT NULL,
	"phone" text NOT NULL,
	"schedule" jsonb
);
--> statement-breakpoint
CREATE TABLE "demo_clock" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"offset_ms" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_clock_single_row_chk" CHECK ("demo_clock"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "executors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"name_short" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "houses" (
	"id" text PRIMARY KEY NOT NULL,
	"fias_id" text,
	"address" text NOT NULL,
	"region_code" text NOT NULL,
	"tz" text NOT NULL,
	"org_id" text,
	"data_kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "joins" (
	"request_id" text NOT NULL,
	"user_id" text NOT NULL,
	"apartment_label" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "joins_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "measurements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" text NOT NULL,
	"joiner_user_id" text,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"place" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"house_id" text,
	"org_id" text,
	"apartment_label" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	"apartment_area_m2" double precision,
	"residents" integer,
	"monthly_charge_kopecks" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_scope_chk" CHECK ("memberships"."house_id" is not null or "memberships"."org_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"inn" text,
	"region_code" text NOT NULL,
	"data_kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"stage" text NOT NULL,
	"uploaded_by" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_updates" (
	"update_key" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"house_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"service" text,
	"location" jsonb NOT NULL,
	"description" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"planned_notice" boolean,
	"accident" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"cluster_id" text,
	"executor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"user_hash" text NOT NULL,
	"user_id_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_user_hash_unique" UNIQUE("user_hash")
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executors" ADD CONSTRAINT "executors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executors" ADD CONSTRAINT "executors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "houses" ADD CONSTRAINT "houses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joins" ADD CONSTRAINT "joins_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joins" ADD CONSTRAINT "joins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_request_id_joiner_user_id_joins_request_id_user_id_fk" FOREIGN KEY ("request_id","joiner_user_id") REFERENCES "public"."joins"("request_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_executor_id_executors_id_fk" FOREIGN KEY ("executor_id") REFERENCES "public"."executors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measurements_request_idx" ON "measurements" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_status_next_idx" ON "outbox" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "photos_request_idx" ON "photos" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_events_request_at_idx" ON "request_events" USING btree ("request_id","at");--> statement-breakpoint
CREATE INDEX "requests_house_status_idx" ON "requests" USING btree ("house_id","status");--> statement-breakpoint
CREATE INDEX "requests_due_idx" ON "requests" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "requests_cluster_idx" ON "requests" USING btree ("cluster_id");