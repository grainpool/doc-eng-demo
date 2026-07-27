import { z } from "zod";
import { idSchema } from "./ids.js";

/**
 * Chat contracts (1.4.0, expansion Phase 1). Relay-internal — Concord never
 * parses these; they live here because @relay/contracts is where Relay's
 * enforced constants double as T1 fact sources (same pattern as limits.ts).
 */

/**
 * T1 fact `limit.chat.message.max_chars`: the one place the chat message
 * length limit exists. The stream route's Zod gate reads it; the product-truth
 * T1 resolver reports it.
 */
export const LIMIT_CHAT_MESSAGE_MAX_CHARS = 8_000;

export const CONVERSATION_TITLE_MAX_CHARS = 120;

/**
 * One part of an AI SDK v6 UIMessage. Stored verbatim as
 * conversation_message.parts_json; deliberately open (passthrough) so future
 * part types survive round-tripping without a migration. `type` is the only
 * required discriminator.
 */
export const MessagePartSchema = z.looseObject({ type: z.string() });

export const ConversationMessageSchema = z.object({
  id: idSchema("msg"),
  conversation_id: idSchema("cnv"),
  role: z.enum(["user", "assistant"]),
  parts: z.array(MessagePartSchema),
  created_at: z.string(), // ISO 8601 UTC, same convention as every other row schema
});

export const ConversationSchema = z.object({
  id: idSchema("cnv"),
  /** vis_* visitor id or the literal 'seed'; null only for pre-scoping rows. */
  owner_id: z.string().nullable(),
  project_id: idSchema("prj").nullable(),
  title: z.string().min(1).max(CONVERSATION_TITLE_MAX_CHARS),
  created_at: z.string(),
  updated_at: z.string(),
});

export type MessagePart = z.infer<typeof MessagePartSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
