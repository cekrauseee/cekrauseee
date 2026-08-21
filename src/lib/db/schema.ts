import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("shell_user", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull().default("anonymous"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "shell_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jtiHash: text("jti_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("shell_session_jti_hash_unique").on(table.jtiHash),
    index("shell_session_user_id_idx").on(table.userId),
  ],
);

export const workspaces = pgTable(
  "shell_workspace",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("default"),
    cwd: text("cwd").notNull().default("/workspace"),
    shellState: text("shell_state")
      .notNull()
      .default(
        '{"version":1,"engineVersion":"just-bash@3.3.0","unsupportedFeatures":["process-substitutions","signals","async-job-control"],"snapshot":null}',
      ),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("shell_workspace_user_name_unique").on(table.userId, table.name),
    index("shell_workspace_user_id_idx").on(table.userId),
  ],
);

export const workspaceNodes = pgTable(
  "shell_workspace_node",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: text("kind").notNull(),
    mode: integer("mode").notNull().default(0o644),
    content: text("content"),
    target: text("target"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("shell_workspace_node_path_unique").on(
      table.workspaceId,
      table.path,
    ),
    index("shell_workspace_node_workspace_id_idx").on(table.workspaceId),
  ],
);

export const transcripts = pgTable(
  "shell_transcript",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    command: text("command").notNull(),
    stdout: text("stdout").notNull(),
    stderr: text("stderr").notNull(),
    exitCode: integer("exit_code").notNull(),
    cwd: text("cwd").notNull(),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("shell_transcript_workspace_request_unique").on(
      table.workspaceId,
      table.requestId,
    ),
    index("shell_transcript_workspace_id_idx").on(table.workspaceId),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceNode = typeof workspaceNodes.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
