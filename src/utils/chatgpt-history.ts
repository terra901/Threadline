/**
 * ChatGPT backend-API history parser.
 *
 * ChatGPT web exposes its full conversation history through:
 *   GET /backend-api/conversations?offset=0&limit=100   → list of conversations
 *   GET /backend-api/conversation/<id>                  → full message mapping
 *
 * The conversation detail contains the *complete* authoritative thread
 * (every message, real create_time timestamps, markdown source in parts),
 * unlike a DOM scan which only sees whatever the page currently renders
 * (ChatGPT virtualizes long threads, so DOM scans silently miss early
 * messages — the root cause of "old conversations load incompletely").
 *
 * This module parses the mapping into MemoryRecords that use the same
 * primary keys (message UUIDs), session ids (`openai:<uuid>`), round/turn
 * numbering and `main` path as the DOM-scan / network-capture paths, so all
 * three sources deduplicate against each other instead of duplicating.
 */

import type { MemoryRecord } from "../types/memory";

/** One node of ChatGPT's conversation mapping tree. */
export interface ChatGPTMappingNode {
  id: string;
  message: {
    id?: string;
    author?: { role?: string };
    create_time?: number | null;
    status?: string;
    content?: { content_type?: string; parts?: unknown[] };
    metadata?: { model_slug?: string } | null;
  } | null;
  parent?: string | null;
  children?: string[];
}

export interface ChatGPTConversationDetail {
  id?: string;
  /** The live /backend-api/conversation/<id> response uses this field */
  conversation_id?: string;
  title?: string | null;
  create_time?: number | null;
  mapping?: Record<string, ChatGPTMappingNode>;
}

/** Recursively collect readable text out of a ChatGPT content part. */
function collectPartText(part: unknown, out: string[]): void {
  if (Array.isArray(part)) {
    for (const item of part) collectPartText(item, out);
    return;
  }
  if (typeof part === "string") {
    if (part.trim()) out.push(part);
    return;
  }
  if (!part || typeof part !== "object") return;
  const obj = part as Record<string, unknown>;
  if (typeof obj["text"] === "string" && obj["text"].trim()) {
    out.push(obj["text"]);
    return;
  }
  const content = obj["content"];
  if (Array.isArray(content)) {
    for (const item of content) collectPartText(item, out);
  }
  if (Array.isArray(obj["parts"])) {
    for (const item of obj["parts"]) collectPartText(item, out);
  }
}

function isFinishedStatus(status: unknown): boolean {
  return (
    status === "finished_successfully" ||
    status === "finished" ||
    status === "complete"
  );
}

/**
 * Parse a single ChatGPT conversation detail into MemoryRecords.
 *
 * Ordering: messages are linearized by create_time. Round index counts user
 * turns (round 0 = first user + its reply), turnIndex mirrors the DOM scheme
 * (user turn = round*2+1, assistant turn = round*2+2, 1-based), branchIndex
 * is 0 with the `main` path so history records merge cleanly into the graph.
 */
export function parseChatGPTConversationDetail(
  conv: ChatGPTConversationDetail,
  url: string,
  /** The conversation UUID as known from the URL — the detail response may
   *  omit the top-level id and only carry `conversation_id`. */
  conversationIdOverride?: string,
): MemoryRecord[] {
  const rawId =
    (typeof conv.id === "string" && conv.id.trim() ? conv.id.trim() : undefined) ??
    (typeof conv.conversation_id === "string" && conv.conversation_id.trim()
      ? conv.conversation_id.trim()
      : undefined) ??
    (typeof conversationIdOverride === "string" && conversationIdOverride.trim()
      ? conversationIdOverride.trim()
      : undefined);
  if (!rawId || !conv.mapping || typeof conv.mapping !== "object") {
    return [];
  }
  const conversationId = rawId;
  const sessionId = `openai:${conversationId}`;
  const conversationTitle =
    typeof conv.title === "string" && conv.title.trim()
      ? conv.title.trim()
      : undefined;
  const conversationCreatedAt = toMs(conv.create_time);

  // Collect all text messages.
  const nodes = Object.values(conv.mapping);
  const messages: Array<{
    node: ChatGPTMappingNode;
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    parentId?: string;
    model?: string;
  }> = [];

  for (const node of nodes) {
    const msg = node.message;

    if (!msg || !msg.author) continue;
    const role = msg.author.role;
    if (role !== "user" && role !== "assistant") continue;
    if (!isFinishedStatus(msg.status)) continue;

    const parts: string[] = [];
    collectPartText(msg.content?.parts ?? [], parts);
    const content = parts.join("\n").trim();
    if (!content) continue;

    const rawId =
      typeof msg.id === "string" && msg.id.trim() ? msg.id.trim() : node.id;
    if (!rawId) continue;

    const parentNode = node.parent ? conv.mapping[node.parent] : undefined;
    const parentMsg = parentNode?.message;
    const parentId =
      parentMsg &&
      typeof parentMsg.id === "string" &&
      parentMsg.id.trim() &&
      isFinishedStatus(parentMsg.status)
        ? parentMsg.id.trim()
        : undefined;

    messages.push({
      node,
      id: rawId,
      role: role as "user" | "assistant",
      content,
      timestamp: toMs(msg.create_time) ?? conversationCreatedAt ?? Date.now(),
      parentId,
      model:
        typeof msg.metadata?.model_slug === "string"
          ? msg.metadata.model_slug
          : undefined,
    });
  }

  if (messages.length === 0) return [];

  // Stable time-ordered linearization (ties broken by mapping insertion order).
  const ordered = messages
    .map((m, index) => ({ ...m, _order: index }))
    .sort((a, b) => a.timestamp - b.timestamp || a._order - b._order);

  // Round assignment: user messages each start a new round; an assistant
  // message inherits the round of its nearest user ancestor (parent chain),
  // falling back to the most recent user round.
  const roundByNodeId = new Map<string, number>();
  const turnByNodeId = new Map<string, number>();
  let userRounds = 0;
  const userRoundByNodeId = new Map<string, number>();

  for (const msg of ordered) {
    if (msg.role === "user") {
      const roundIndex = userRounds;
      userRounds += 1;
      roundByNodeId.set(msg.node.id, roundIndex);
      turnByNodeId.set(msg.node.id, roundIndex * 2 + 1);
      userRoundByNodeId.set(msg.node.id, roundIndex);
      continue;
    }
    // assistant: walk the parent chain for the nearest user ancestor
    let cursor = msg.node.parent;
    let roundIndex: number | undefined;
    let guard = 0;
    while (cursor && guard++ < 200) {
      const ancestor = conv.mapping[cursor];
      if (!ancestor) break;
      if (userRoundByNodeId.has(ancestor.id)) {
        roundIndex = userRoundByNodeId.get(ancestor.id);
        break;
      }
      cursor = ancestor.parent ?? undefined;
    }
    if (roundIndex === undefined && userRounds > 0) {
      roundIndex = userRounds - 1; // latest user round
    }
    const resolved = roundIndex ?? 0;
    roundByNodeId.set(msg.node.id, resolved);
    turnByNodeId.set(msg.node.id, resolved * 2 + 2);
  }

  const records: MemoryRecord[] = [];
  for (const msg of ordered) {
    const roundIndex = roundByNodeId.get(msg.node.id) ?? 0;
    const turnIndex = turnByNodeId.get(msg.node.id) ?? 0;
    const branchIndex = 0;
    const branchId = `${sessionId}:r${roundIndex}:b0`;
    const pathId = `${sessionId}:main`;
    const metadata: Record<string, unknown> = {
      source: "chatgpt-api",
      turnIndex,
      roundIndex,
      branchIndex,
      branchId,
      pathId,
      conversationTitle,
      url,
    };
    if (msg.parentId) metadata["parentMessageId"] = msg.parentId;

    records.push({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      provider: "openai",
      sessionId,
      parentMessageId: msg.parentId,
      originalMessageId: msg.id,
      model: msg.model,
      source: "chatgpt-api",
      sourceUrl: url,
      conversationTitle,
      timestamp: msg.timestamp,
      createdAt: msg.timestamp,
      turnIndex,
      roundIndex,
      branchIndex,
      branchId,
      pathId,
      isPartial: false,
      isDeleted: false,
      isSuperseded: false,
      metadata,
    });
  }
  return records;
}

function toMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
