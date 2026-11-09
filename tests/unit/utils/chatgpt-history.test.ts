import { describe, expect, it } from "vitest";
import { parseChatGPTConversationDetail } from "../../../src/utils/chatgpt-history";

const CONVERSATION_ID = "11111111-1111-1111-1111-111111111111";

function node(
  id: string,
  role: string,
  text: string,
  createTime: number,
  parent: string | null,
  status = "finished_successfully",
) {
  return {
    id,
    message: {
      id,
      author: { role },
      create_time: createTime,
      status,
      content: { content_type: "text", parts: [text] },
      metadata:
        role === "assistant"
          ? { model_slug: "gpt-4o" }
          : (null as { model_slug?: string } | null),
    },
    parent,
    children: [],
  };
}

function makeConversation(nodes: Record<string, ReturnType<typeof node>>) {
  return { id: CONVERSATION_ID, title: "My Chat", create_time: 1000, mapping: nodes };
}

describe("parseChatGPTConversationDetail", () => {
  it("linearizes the full thread in order with real timestamps", () => {
    const conv = makeConversation({
      a: node("a", "user", "Hello", 1000, null),
      b: node("b", "assistant", "# Answer\n\n- one\n- two", 2000, "a"),
      c: node("c", "user", "More?", 3000, "b"),
      d: node("d", "assistant", "Yes", 4000, "c"),
    });
    const records = parseChatGPTConversationDetail(conv, "https://chatgpt.com/c/x");
    expect(records).toHaveLength(4);
    expect(records.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(records.map((r) => r.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // Real per-message timestamps
    expect(records[0].timestamp).toBe(1_000_000);
    expect(records[1].timestamp).toBe(2_000_000);
    // Round/turn numbering matches the DOM scheme (user turn = round*2+1, 1-based)
    expect(records.map((r) => r.roundIndex)).toEqual([0, 0, 1, 1]);
    expect(records.map((r) => r.turnIndex)).toEqual([1, 2, 3, 4]);
    expect(records.map((r) => r.branchIndex)).toEqual([0, 0, 0, 0]);
    expect(records.map((r) => r.pathId)).toEqual([
      `openai:${CONVERSATION_ID}:main`,
      `openai:${CONVERSATION_ID}:main`,
      `openai:${CONVERSATION_ID}:main`,
      `openai:${CONVERSATION_ID}:main`,
    ]);
    // Parent chain preserved
    expect(records[1].parentMessageId).toBe("a");
    expect(records[2].parentMessageId).toBe("b");
    // Markdown content survives intact
    expect(records[1].content).toBe("# Answer\n\n- one\n- two");
    // Session/title metadata
    expect(records[0].sessionId).toBe(`openai:${CONVERSATION_ID}`);
    expect(records[0].conversationTitle).toBe("My Chat");
    expect(records[0].metadata?.["source"]).toBe("chatgpt-api");
  });

  it("keeps an assistant reply in its user's round even when timestamps are out of order", () => {
    const conv = makeConversation({
      a: node("a", "user", "Q1", 1000, null),
      b: node("b", "assistant", "A1", 5000, "a"),
      c: node("c", "user", "Q2", 3000, "b"), // earlier clock than A1
      d: node("d", "assistant", "A2", 4000, "c"),
    });
    const records = parseChatGPTConversationDetail(conv, "https://chatgpt.com/c/x");
    // Time ordering: a(1000), c(3000), d(4000), b(5000)
    expect(records.map((r) => r.id)).toEqual(["a", "c", "d", "b"]);
    expect(records.map((r) => r.roundIndex)).toEqual([0, 1, 1, 0]);
    expect(records.map((r) => r.turnIndex)).toEqual([1, 3, 4, 2]);
    // Assistant b still belongs to round 0 (parent user a)
    const b = records.find((r) => r.id === "b");
    expect(b?.roundIndex).toBe(0);
  });

  it("skips partial/error/system messages and non-text content", () => {
    const conv = makeConversation({
      a: node("a", "user", "Q1", 1000, null),
      b: node("b", "assistant", "A1", 2000, "a", "in_progress"),
      c: node("c", "system", "system note", 1500, null),
      d: {
        id: "d",
        message: {
          id: "d",
          author: { role: "assistant" },
          create_time: 2500,
          status: "finished_successfully",
          content: { content_type: "code", parts: [{ text: "x = 1" }] },
          metadata: null,
        },
        parent: "a",
        children: [],
      } as unknown as ReturnType<typeof node>,
    });
    const records = parseChatGPTConversationDetail(conv, "https://chatgpt.com/c/x");
    expect(records.map((r) => r.id)).toEqual(["a", "d"]);
    expect(records[1].content).toBe("x = 1");
  });

  it("returns [] for missing mapping or empty conversations", () => {
    expect(parseChatGPTConversationDetail({ id: "x" }, "u")).toEqual([]);
    expect(
      parseChatGPTConversationDetail({ id: "x", mapping: {} }, "u"),
    ).toEqual([]);
  });

  it("parses the real backend-api shape (no top-level id, uses conversation_id)", () => {
    // The live /backend-api/conversation/<id> response carries conversation_id
    // but no top-level `id` — the original parser returned [] for this shape,
    // which made every history sync silently produce zero records.
    const conv: Record<string, unknown> = {
      conversation_id: CONVERSATION_ID,
      title: "Real Shape",
      create_time: 1000,
      mapping: {
        a: node("a", "user", "Q1", 1000, null),
        b: node("b", "assistant", "A1", 2000, "a"),
      },
    };
    const records = parseChatGPTConversationDetail(
      conv as never,
      "https://chatgpt.com/c/x",
    );
    expect(records).toHaveLength(2);
    expect(records[0].sessionId).toBe(`openai:${CONVERSATION_ID}`);
    expect(records[0].conversationTitle).toBe("Real Shape");
  });

  it("uses the URL override when the response carries neither id nor conversation_id", () => {
    const conv = makeConversation({
      a: node("a", "user", "Q1", 1000, null),
    });
    delete (conv as { id?: string }).id;
    const records = parseChatGPTConversationDetail(
      conv,
      "https://chatgpt.com/c/x",
      CONVERSATION_ID,
    );
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe(`openai:${CONVERSATION_ID}`);
  });
});
