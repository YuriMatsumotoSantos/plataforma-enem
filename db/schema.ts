import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["aluno", "admin"]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: userRole("role").default("aluno").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const examArea = pgEnum("exam_area", [
  "linguagens",
  "humanas",
  "natureza",
  "matematica",
]);

export const questionStatus = pgEnum("question_status", [
  "pendente",
  "aprovada",
  "rejeitada",
]);

export const topics = pgTable("topics", {
  id: text("id").primaryKey(),
  area: examArea("area").notNull(),
  subject: text("subject").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Alternative = { letter: string; text: string };

export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    year: integer("year").notNull(),
    examDay: integer("exam_day").notNull(),
    questionNumber: integer("question_number").notNull(),
    area: examArea("area").notNull(),
    statement: text("statement").notNull(),
    alternatives: jsonb("alternatives").$type<Alternative[]>().notNull(),
    correctAnswer: text("correct_answer").notNull(),
    imageUrl: text("image_url"),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    status: questionStatus("status").default("pendente").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("questions_year_day_number_unique").on(
      table.year,
      table.examDay,
      table.questionNumber
    ),
    index("questions_topic_idx").on(table.topicId),
    index("questions_status_idx").on(table.status),
  ]
);

export const questionsRelations = relations(questions, ({ one }) => ({
  topic: one(topics, {
    fields: [questions.topicId],
    references: [topics.id],
  }),
}));

export const attempts = pgTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    selectedAnswer: text("selected_answer").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("attempts_question_idx").on(table.questionId),
    index("attempts_user_idx").on(table.userId),
  ]
);

export type Attempt = typeof attempts.$inferSelect;

export const simuladoMode = pgEnum("simulado_mode", ["mesclado", "fiel"]);
export const simuladoStatus = pgEnum("simulado_status", ["em_andamento", "finalizado"]);

export type SimuladoAnswer = { selectedAnswer: string | null; markedForReview: boolean };

export const simulados = pgTable(
  "simulados",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mode: simuladoMode("mode").notNull(),
    examDay: integer("exam_day").notNull(),
    examYear: integer("exam_year"),
    status: simuladoStatus("status").default("em_andamento").notNull(),
    questionIds: jsonb("question_ids").$type<string[]>().notNull(),
    answers: jsonb("answers")
      .$type<Record<string, SimuladoAnswer>>()
      .notNull()
      .default({}),
    durationSeconds: integer("duration_seconds").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("simulados_userId_idx").on(table.userId),
    index("simulados_status_idx").on(table.status),
  ]
);

export type Simulado = typeof simulados.$inferSelect;

export type Topic = typeof topics.$inferSelect;
export type Question = typeof questions.$inferSelect;

export const temas = pgTable("temas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Tema = typeof temas.$inferSelect;

export type RedacaoScores = {
  competencia1: number;
  competencia2: number;
  competencia3: number;
  competencia4: number;
  competencia5: number;
};

export type RedacaoFeedback = {
  justificativas: string[];
  comentarioGeral: string;
};

export const redacoes = pgTable(
  "redacoes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    temaId: text("tema_id")
      .notNull()
      .references(() => temas.id),
    text: text("text").notNull(),
    scores: jsonb("scores").$type<RedacaoScores>().notNull(),
    notaTotal: integer("nota_total").notNull(),
    feedback: jsonb("feedback").$type<RedacaoFeedback>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("redacoes_userId_idx").on(table.userId),
    index("redacoes_temaId_idx").on(table.temaId),
  ]
);

export type Redacao = typeof redacoes.$inferSelect;

export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    status: subscriptionStatus("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("subscriptions_userId_idx").on(table.userId)]
);

export type Subscription = typeof subscriptions.$inferSelect;
