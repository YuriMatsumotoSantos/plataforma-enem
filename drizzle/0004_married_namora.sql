CREATE TYPE "public"."simulado_mode" AS ENUM('mesclado', 'fiel');--> statement-breakpoint
CREATE TYPE "public"."simulado_status" AS ENUM('em_andamento', 'finalizado');--> statement-breakpoint
CREATE TABLE "simulados" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mode" "simulado_mode" NOT NULL,
	"exam_day" integer NOT NULL,
	"exam_year" integer,
	"status" "simulado_status" DEFAULT 'em_andamento' NOT NULL,
	"question_ids" jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_seconds" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "simulados" ADD CONSTRAINT "simulados_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "simulados_userId_idx" ON "simulados" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "simulados_status_idx" ON "simulados" USING btree ("status");