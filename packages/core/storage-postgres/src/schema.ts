import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  customType,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Custom type — bytea for encrypted secret storage
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ---------------------------------------------------------------------------
// Identity & multi-tenancy
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().$default(() => "member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id").notNull(),
  email: text("email").notNull(),
  invitedBy: text("invited_by").notNull(),
  status: text("status").notNull().$default(() => "pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  teamId: text("team_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Domain data — all team-scoped
// ---------------------------------------------------------------------------

export const sources = pgTable(
  "sources",
  {
    id: text("id").notNull(),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").notNull().$default(() => ({})),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.teamId] })],
);

export const tools = pgTable(
  "tools",
  {
    id: text("id").notNull(),
    teamId: text("team_id").notNull(),
    sourceId: text("source_id").notNull(),
    pluginKey: text("plugin_key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    mayElicit: boolean("may_elicit").$default(() => false),
    inputSchema: jsonb("input_schema"),
    outputSchema: jsonb("output_schema"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.teamId] })],
);

export const toolDefinitions = pgTable(
  "tool_definitions",
  {
    name: text("name").notNull(),
    teamId: text("team_id").notNull(),
    schema: jsonb("schema").notNull(),
  },
  (table) => [primaryKey({ columns: [table.name, table.teamId] })],
);

export const secrets = pgTable(
  "secrets",
  {
    id: text("id").notNull(),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    purpose: text("purpose"),
    encryptedValue: bytea("encrypted_value").notNull(),
    iv: bytea("iv").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.teamId] })],
);

export const policies = pgTable(
  "policies",
  {
    id: text("id").notNull(),
    teamId: text("team_id").notNull(),
    name: text("name").notNull(),
    action: text("action").notNull(),
    matchToolPattern: text("match_tool_pattern"),
    matchSourceId: text("match_source_id"),
    priority: integer("priority").notNull().$default(() => 0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.teamId] })],
);

// ---------------------------------------------------------------------------
// Plugin KV — escape hatch for plugin-specific data
// ---------------------------------------------------------------------------

export const pluginKv = pgTable(
  "plugin_kv",
  {
    teamId: text("team_id").notNull(),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.namespace, table.key] })],
);
