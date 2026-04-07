CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"invited_by" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_kv" (
	"team_id" text NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "plugin_kv_team_id_namespace_key_pk" PRIMARY KEY("team_id","namespace","key")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"action" text NOT NULL,
	"match_tool_pattern" text,
	"match_source_id" text,
	"priority" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_id_team_id_pk" PRIMARY KEY("id","team_id")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"encrypted_value" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secrets_id_team_id_pk" PRIMARY KEY("id","team_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_id_team_id_pk" PRIMARY KEY("id","team_id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_definitions" (
	"name" text NOT NULL,
	"team_id" text NOT NULL,
	"schema" jsonb NOT NULL,
	CONSTRAINT "tool_definitions_name_team_id_pk" PRIMARY KEY("name","team_id")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" text NOT NULL,
	"team_id" text NOT NULL,
	"source_id" text NOT NULL,
	"plugin_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"may_elicit" boolean,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_id_team_id_pk" PRIMARY KEY("id","team_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
