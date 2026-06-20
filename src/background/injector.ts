/**
 * MAIN world injector — runs inside the page via chrome.scripting.executeScript.
 *
 * Must be a single self-contained function: no imports, no closures over outer
 * variables. All helpers are defined inside. Captured data is dispatched via
 * CustomEvent so the isolated content script can forward to background.
 */

export function mainWorldInterceptor(): void {
  const READY_TYPE = "__ai_memory_injector_ready__";
  const ERR_TYPE = "__ai_memory_injector_error__";
  function sendReady(stage: string): void {
    try {
      window.postMessage(
        { type: READY_TYPE, payload: { stage } },
        window.location.origin,
      );
    } catch (_) {}
  }

  // If we already installed, exit immediately.
  // We flag window itself (not window.fetch) because ChatGPT / Next.js can replace
  // window.fetch during hydration, making any flag stored on the old fetch reference
  // invisible to a second injection and causing duplicate capture.
  try {
    const w = window as unknown as { __aiMemoryInstalled?: boolean };
    if (w.__aiMemoryInstalled) {
      return;
    }
    w.__aiMemoryInstalled = true;
  } catch (_) {}

  try {
    sendReady("started");
  } catch (_) {}

  try {
    // postMessage crosses MAIN ↔ ISOLATED boundary; CustomEvent does not.
    const POST_TYPE = "__ai_memory_capture__";

    function sendCapture(
      provider: string,
      rawData: unknown,
      url: string,
      timestamp: number,
    ): void {
      try {
        window.postMessage(
          {
            type: POST_TYPE,
            payload: { provider, rawData, url, timestamp },
          },
          window.location.origin,
        );
      } catch {
        // ignore
      }
    }

    /** Fixed Gemini conversation endpoint — only this URL is used for capture. */
    const GEMINI_STREAM_GENERATE_PATH =
      "BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

    function isGeminiStreamGenerateUrl(url: string): boolean {
      if (!url || typeof url !== "string") return false;
      if (!url.includes("gemini.google.com")) return false;
      return url.includes(GEMINI_STREAM_GENERATE_PATH);
    }

    function detectProvider(url: string): string | null {
      if (!url || typeof url !== "string") return null;
      try {
        const u = new URL(url);
        const host = (u.hostname || "").toLowerCase();
        if (host === "gemini.google.com" || host.endsWith(".gemini.google.com"))
          return "google";
        if (
          host.includes("openai.com") ||
          (host === "chatgpt.com" && url.includes("/backend-api"))
        )
          return "openai";
        // TODO: Implement ClaudeAdapter
        if (host.includes("anthropic.com") || host === "claude.ai")
          return "anthropic";
        if (host === "www.perplexity.ai" || host === "perplexity.ai")
          return "perplexity";
        if (host === "grok.com" || host.endsWith(".grok.com")) return "xai";
      } catch (_) {
        if (url.includes("gemini.google.com")) return "google";
        if (
          url.includes("openai.com") ||
          url.includes("chatgpt.com/backend-api")
        )
          return "openai";
        // TODO: Implement ClaudeAdapter
        if (url.includes("anthropic.com") || url.includes("claude.ai/api"))
          return "anthropic";
        if (url.includes("perplexity.ai/rest/")) return "perplexity";
        if (url.includes("grok.com/rest/")) return "xai";
      }
      return null;
    }

    function isApiEndpoint(url: string): boolean {
      const patterns = [
        "/v1/chat/completions",
        "/backend-api/f/conversation",
        "/backend-api/conversation",
        // TODO: Implement ClaudeAdapter
        "claude.ai/api/",
        "api.anthropic.com/v1/messages",
        "perplexity.ai/rest/sse/perplexity_ask",
        "perplexity.ai/rest/thread/",
        "perplexity.ai/rest/thread/set_thread_title",
        "grok.com/rest/app-chat/conversations/new",
        "grok.com/rest/app-chat/conversations/",
        "grok.com/rest/app-chat/conversations_v2/",
      ];
      return patterns.some((p) => url.includes(p));
    }

    /** Only send capture for URLs that carry the actual conversation reply we want to store. */
    function isConversationCaptureUrl(url: string, provider: string): boolean {
      if (provider === "openai") {
        return (
          url.endsWith("chatgpt.com/backend-api/f/conversation") ||
          url.includes("chat.openai.com/backend-api/conversation")
        );
      }
      if (provider === "anthropic") {
        return (
          isClaudeCompletionUrl(url) ||
          url.includes("api.anthropic.com/v1/messages")
        );
      }
      if (provider === "google") {
        return isGeminiStreamGenerateUrl(url);
      }
      return false;
    }

    function isChatGPTDeltaV1(url: string): boolean {
      return url.includes("/backend-api/f/conversation");
    }

    /** Walk parsed value and collect text from arrays of strings or [id, string[]] blocks. */
    function collectTextFromGeminiChunk(val: unknown): string {
      if (typeof val === "string") return val;
      if (!Array.isArray(val)) return "";
      const parts: string[] = [];
      for (const item of val) {
        if (typeof item === "string") {
          parts.push(item);
        } else if (
          Array.isArray(item) &&
          item.length >= 2 &&
          Array.isArray(item[1])
        ) {
          const maybeTextParts = item[1].filter(
            (p): p is string => typeof p === "string",
          );
          if (maybeTextParts.length > 0) parts.push(maybeTextParts.join(""));
        } else if (Array.isArray(item)) {
          parts.push(collectTextFromGeminiChunk(item));
        }
      }
      return parts.join("");
    }

    /** Parse one Gemini Bard stream chunk (JSON string) to extract assistant text and conversationId. */
    function extractGeminiChunk(jsonStr: string): {
      text: string;
      cid: string;
    } {
      try {
        const outer = JSON.parse(jsonStr) as unknown[];
        if (
          !Array.isArray(outer) ||
          !Array.isArray(outer[0]) ||
          outer[0].length < 3
        )
          return { text: "", cid: "" };

        const innerStr = outer[0][2];
        if (typeof innerStr !== "string") return { text: "", cid: "" };

        const inner = JSON.parse(innerStr) as unknown[];
        if (!Array.isArray(inner)) return { text: "", cid: "" };
        let cid = "";
        if (Array.isArray(inner[1])) {
          const first = inner[1][0];
          // Precisely extract conversation IDs that start with "c_"
          if (typeof first === "string" && first.startsWith("c_")) cid = first;
          else if (typeof inner[1][1] === "string") cid = inner[1][1];
        }

        let text = "";
        for (const idx of [4, 3, 5, 6, 7]) {
          if (idx >= inner.length) continue;
          const blockList = inner[idx];
          if (!Array.isArray(blockList) || blockList.length === 0) continue;

          const parts: string[] = [];
          for (let b = 0; b < blockList.length; b++) {
            const block = blockList[b];
            if (
              !Array.isArray(block) ||
              block.length < 2 ||
              !Array.isArray(block[1])
            )
              continue;

            // Collect all strings within this block (joins fragmented string parts within a single block)
            const part = (block[1] as unknown[])
              .filter((p): p is string => typeof p === "string")
              .join("");

            if (part.length > 0) parts.push(part);
          }

          if (parts.length > 0) {
            text = parts.join("\n\n");
            break;
          }
        }

        if (!text && typeof collectTextFromGeminiChunk === "function") {
          text = collectTextFromGeminiChunk(inner);
        }
        return { text, cid };
      } catch {
        return { text: "", cid: "" };
      }
    }

    function parseGeminiBardResponseText(fullText: string): {
      lastAssistantText: string;
      conversationId: string;
    } {
      let lastAssistantText = "";
      let conversationId = "";
      if (!fullText || typeof fullText !== "string")
        return { lastAssistantText, conversationId };

      let maxLen = 0;
      let bestPayload: string | null = null;

      // Regex to find arrays starting with ["wrb.fr" (allows whitespace/newlines in between)
      const startRegex = /\[\s*"wrb\.fr"/g;
      let match;

      while ((match = startRegex.exec(fullText)) !== null) {
        const chunkStart = match.index;

        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let end = -1;

        // Traverse forward from ["wrb.fr", tracking bracket depth to extract the complete JSON array
        for (let j = chunkStart; j < fullText.length; j++) {
          const char = fullText[j];

          // Handle escape characters (e.g. \") to avoid misidentifying string boundaries
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          if (char === "\\") {
            escapeNext = true;
            continue;
          }

          // Toggle string mode on quote characters
          if (char === '"') {
            inString = !inString;
            continue;
          }

          // Only track bracket depth outside of string literals
          if (!inString) {
            if (char === "[") depth++;
            else if (char === "]") {
              depth--;
              if (depth === 0) {
                end = j + 1; // Found the perfectly balanced closing bracket
                break;
              }
            }
          }
        }

        if (end !== -1) {
          // Successfully extracted the ["wrb.fr", ...] array
          const chunkStr = fullText.slice(chunkStart, end);

          // Wrap in outer [] to match the format expected by extractGeminiChunk: [["wrb.fr", ...]]
          const wrappedChunk = `[${chunkStr}]`;

          // Keep the longest chunk (most likely to contain the most text)
          if (wrappedChunk.length > maxLen) {
            maxLen = wrappedChunk.length;
            bestPayload = wrappedChunk;
          }

          // Advance the regex past this chunk to continue searching for the next one
          startRegex.lastIndex = end;
        } else {
          // end === -1 means the stream was cut off with unbalanced brackets; stop here
          break;
        }
      }

      if (bestPayload) {
        const { text, cid } = extractGeminiChunk(bestPayload);
        if (text) lastAssistantText = text;
        if (cid) conversationId = cid;
      }

      return { lastAssistantText, conversationId };
    }

    /**
     * Parse form body (application/x-www-form-urlencoded) and return value for key.
     */
    function parseFormBodyKey(bodyText: string, key: string): string | null {
      if (!bodyText || typeof bodyText !== "string") return null;
      const parts = bodyText.split("&");
      for (const part of parts) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        const k = decodeURIComponent(part.slice(0, eq).replace(/\+/g, " "));
        if (k === key) {
          return decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
        }
      }
      return null;
    }

    /**
     * Extract user message and conversationId from Gemini Bard form payload (f.req).
     * f.req is JSON: [null, "<string>"] where string parses to [[userText,0,...], [...], [c_xxx, r_xxx, ...], ...].
     */
    function extractGeminiRequestUserMessage(
      bodyText: string,
    ): { text: string; conversationId?: string } | null {
      const fReq = parseFormBodyKey(bodyText, "f.req");
      if (!fReq) return null;
      let outer: unknown;
      try {
        outer = JSON.parse(fReq);
      } catch {
        return null;
      }
      if (!Array.isArray(outer) || outer.length < 2) return null;
      const innerStr = outer[1];
      if (typeof innerStr !== "string") return null;
      let inner: unknown;
      try {
        inner = JSON.parse(innerStr);
      } catch {
        return null;
      }
      if (!Array.isArray(inner) || inner.length === 0) return null;
      const first = inner[0];
      if (!Array.isArray(first) || first.length === 0) return null;
      const userText = first[0];
      if (typeof userText !== "string" || !userText.trim()) return null;
      let conversationId: string | undefined;
      if (inner.length > 2 && Array.isArray(inner[2]) && inner[2].length > 0) {
        const c = inner[2][0];
        if (typeof c === "string" && c.trim()) conversationId = c.trim();
      }
      return { text: userText.trim(), conversationId };
    }

    /** Extract user message from Claude completion POST body (payload.prompt). */
    function extractClaudeRequestUserMessage(
      body: unknown,
    ): { text: string; model?: string } | null {
      if (!body || typeof body !== "object") return null;
      const payload = body as Record<string, unknown>;
      const prompt = payload["prompt"];
      if (typeof prompt !== "string" || !prompt.trim()) return null;
      const model = payload["model"] as string | undefined;
      return { text: prompt.trim(), model };
    }

    /** Returns true for Claude Web conversation history fetch (existing chat loaded). */
    function isClaudeConversationHistoryUrl(url: string): boolean {
      return (
        /claude\.ai\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/.test(
          url,
        ) && url.includes("tree=True")
      );
    }

    /** Returns true for Claude Web completion streaming endpoint. */
    function isClaudeCompletionUrl(url: string): boolean {
      return url.includes("claude.ai/api/") && url.endsWith("/completion");
    }

    /** Returns true for Claude Web title generation endpoint. */
    function isClaudeTitleUrl(url: string): boolean {
      return url.includes("claude.ai/api/") && url.endsWith("/title");
    }

    /** Extract conversation UUID from Claude API URL path. */
    function extractClaudeConversationIdFromUrl(url: string): string | null {
      const match = url.match(/chat_conversations\/([^/]+)\//);
      return match ? match[1] : null;
    }

    /** Extract last user message and optional conversation_id from ChatGPT POST payload (payload.messages[]). */
    function extractChatGPTRequestUserMessage(body: unknown): {
      text: string;
      conversationId?: string;
      messageId?: string;
      model?: string;
    } | null {
      if (!body || typeof body !== "object") return null;
      const payload = body as Record<string, unknown>;
      const messages = payload["messages"] as
        | Array<Record<string, unknown>>
        | undefined;
      const model = payload["model"] as string | undefined;
      if (!Array.isArray(messages) || messages.length === 0) return null;

      // Find last user message (by role or author.role)
      let lastUser: Record<string, unknown> | null = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as Record<string, unknown>;
        const role = m["role"] as string | undefined;
        const author = m["author"] as Record<string, unknown> | undefined;
        const authorRole = author?.["role"] as string | undefined;
        if (role === "user" || authorRole === "user") {
          lastUser = m;
          break;
        }
      }
      if (!lastUser) return null;

      let text = "";
      const content = lastUser["content"];
      if (typeof content === "string") {
        text = content;
      } else if (
        content &&
        typeof content === "object" &&
        !Array.isArray(content)
      ) {
        const parts = (content as Record<string, unknown>)["parts"];
        if (Array.isArray(parts)) {
          const strings = parts.filter(
            (p) => typeof p === "string",
          ) as string[];
          const texts = parts
            .filter(
              (p) =>
                p &&
                typeof p === "object" &&
                (p as Record<string, unknown>)["text"] !== undefined,
            )
            .map((p) => (p as Record<string, unknown>)["text"] as string);
          text = strings.join("") || texts.join("");
        }
      }
      if (!text.trim()) return null;

      const conversationId =
        (payload["conversation_id"] as string | undefined) ??
        (payload["conversationId"] as string | undefined);
      const id =
        typeof conversationId === "string" && conversationId.trim()
          ? conversationId.trim()
          : undefined;

      const messageId = lastUser["id"] as string | undefined;
      const mid =
        typeof messageId === "string" && messageId.trim()
          ? messageId.trim()
          : undefined;

      return { text: text.trim(), conversationId: id, messageId: mid, model };
    }

    // ─── Grok URL helpers ────────────────────────────────────────────────────────

    /** Returns true for Grok new-conversation streaming endpoint. */
    function isGrokNewConversationUrl(url: string): boolean {
      return url.includes("grok.com/rest/app-chat/conversations/new");
    }

    /** Returns true for Grok existing-conversation streaming endpoint. */
    function isGrokResponsesUrl(url: string): boolean {
      return (
        /grok\.com\/rest\/app-chat\/conversations\/[^/]+\/responses$/.test(url)
      );
    }

    /** Returns true for Grok load-responses (history) endpoint. */
    function isGrokLoadResponsesUrl(url: string): boolean {
      return url.includes("grok.com/rest/app-chat/conversations/") &&
        url.endsWith("/load-responses");
    }

    /** Returns true for Grok single-conversation metadata endpoint. */
    function isGrokConversationsV2Url(url: string): boolean {
      return url.includes("grok.com/rest/app-chat/conversations_v2/");
    }

    /**
     * Extract conversation UUID from a Grok URL path.
     * Works for /conversations/<id>/responses and /conversations/<id>/load-responses.
     */
    function extractGrokConversationIdFromUrl(url: string): string | null {
      const m = url.match(/\/conversations\/([^/?]+)\//);
      return m ? m[1] : null;
    }

    /** Extract conversation ID from the current page's canonical <link> element.
     *  e.g. <link rel="canonical" href="https://grok.com/c/<id>">  →  "<id>"
     */
    function getGrokPageConversationId(): string | null {
      const link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) return null;
      const m = link.href.match(/\/c\/([^/?#]+)/);
      return m ? m[1] : null;
    }

    /**
     * Split a body text containing multiple concatenated JSON objects into an array.
     * Grok streams responses as plain JSON objects placed one after another:
     *   {"result":{...}}{"result":{...}}{"result":{...}}
     * A simple brace-depth counter correctly splits them regardless of whitespace.
     */
    function splitGrokObjects(text: string): Record<string, unknown>[] {
      const objects: Record<string, unknown>[] = [];
      let depth = 0;
      let start = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (ch === "\\") { escapeNext = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === "{") {
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const slice = text.slice(start, i + 1).trim();
            if (slice) {
              try {
                objects.push(JSON.parse(slice) as Record<string, unknown>);
              } catch {
                // ignore malformed slice
              }
            }
            start = i + 1;
          }
        }
      }
      return objects;
    }

    /**
     * Handle Grok streaming response (new or existing conversation).
     * Parses concatenated JSON objects and dispatches each message individually.
     */
    function handleGrokStreamingResponse(
      responseClone: Response,
      url: string,
      timestamp: number,
      isNew: boolean,
    ): void {
      responseClone
        .text()
        .then((text: string) => {
          const objects = splitGrokObjects(text);
          let conversationId: string | null = isNew
            ? null
            : extractGrokConversationIdFromUrl(url);

          for (const obj of objects) {
            const result = obj["result"] as Record<string, unknown> | undefined;
            if (!result) continue;

            // New conversation: first object contains conversation metadata
            if (isNew && result["conversation"]) {
              const conv = result["conversation"] as Record<string, unknown>;
              if (typeof conv["conversationId"] === "string") {
                conversationId = conv["conversationId"] as string;
              }
              continue;
            }

            // New conversation: messages are nested under result.response
            // Existing conversation: messages are directly under result
            const responseBlock = (result["response"] as Record<string, unknown> | undefined) ?? result;

            // User message
            const userResp = responseBlock["userResponse"] as Record<string, unknown> | undefined;
            if (userResp && typeof userResp["message"] === "string" && conversationId) {
              const msg = (userResp["message"] as string).trim();
              if (msg) {
                sendCapture(
                  "xai",
                  {
                    role: "user",
                    content: msg,
                    conversationId,
                    messageId: userResp["responseId"] as string | undefined,
                    model: userResp["model"] as string | undefined,
                    isPartial: false,
                  },
                  url,
                  timestamp,
                );
              }
            }

            // Assistant message
            const modelResp = responseBlock["modelResponse"] as Record<string, unknown> | undefined;
            if (modelResp && typeof modelResp["message"] === "string" && conversationId) {
              const msg = (modelResp["message"] as string).trim();
              if (msg) {
                sendCapture(
                  "xai",
                  {
                    role: "assistant",
                    content: msg,
                    conversationId,
                    messageId: modelResp["responseId"] as string | undefined,
                    parentMessageId: modelResp["parentResponseId"] as string | undefined,
                    model: modelResp["model"] as string | undefined,
                    isPartial: false,
                  },
                  url,
                  timestamp + 1,
                );
              }
            }

            // Title update (new conversations only, final object)
            if (isNew && result["title"] && conversationId) {
              const titleObj = result["title"] as Record<string, unknown>;
              const newTitle = titleObj["newTitle"] as string | undefined;
              if (newTitle?.trim()) {
                sendCapture(
                  "xai",
                  {
                    type: "title_update",
                    conversationId,
                    title: newTitle.trim(),
                  },
                  url,
                  timestamp,
                );
              }
            }
          }
        })
        .catch(() => undefined);
    }

    /** Returns true for Perplexity live-ask SSE endpoint. */
    function isPerplexityAskUrl(url: string): boolean {
      return url.includes("perplexity.ai/rest/sse/perplexity_ask");
    }

    /** Returns true for Perplexity thread history REST endpoint. */
    function isPerplexityThreadUrl(url: string): boolean {
      if (!/perplexity\.ai\/rest\/thread\//.test(url)) return false;
      // Exclude known action sub-paths (mark_viewed, vote, report, etc.)
      // Real thread-history slugs appear directly after /rest/thread/
      const segment = url
        .split("/rest/thread/")[1]
        ?.split("?")[0]
        ?.split("/")[0];
      const actionVerbs = [
        "mark_viewed",
        "vote",
        "report",
        "bookmark",
        "delete",
        "share",
        "set_thread_title",
      ];
      return !actionVerbs.includes(segment ?? "");
    }

    /** Extract user message from Perplexity POST body. */
    function extractPerplexityRequestUserMessage(
      body: unknown,
    ): { text: string; conversationId?: string; messageId?: string } | null {
      if (!body || typeof body !== "object") return null;
      const payload = body as Record<string, unknown>;
      const queryStr = payload["query_str"] as string | undefined;
      if (!queryStr?.trim()) return null;
      const params = payload["params"] as Record<string, unknown> | undefined;
      const frontendUuid = params?.["frontend_uuid"] as string | undefined;
      return {
        text: queryStr.trim(),
        messageId: frontendUuid,
        // conversationId comes from the SSE stream, not the request body
      };
    }

    /**
     * Extract assistant answer text from Perplexity SSE `text` field JSON.
     * The `text` field is a stringified JSON array of steps; the FINAL step
     * (or last step with content) holds the actual answer.
     */
    function extractAnswerFromPerplexityTextJson(textJson: string): string {
      try {
        const steps = JSON.parse(textJson) as Array<Record<string, unknown>>;
        if (!Array.isArray(steps) || !steps.length) return "";

        const tryExtract = (step: Record<string, unknown>): string => {
          const stepContent = step["content"] as
            | Record<string, unknown>
            | undefined;
          if (!stepContent) return "";
          const answerStr = stepContent["answer"] as string | undefined;
          if (!answerStr) return "";
          try {
            const answerObj = JSON.parse(answerStr) as Record<string, unknown>;
            const ans = answerObj["answer"] as string | undefined;
            if (ans) return ans;
          } catch {
            /* ignore */
          }
          return answerStr; // treat as plain text if not JSON
        };

        // Prefer the FINAL step
        for (const step of steps) {
          if (step["step_type"] === "FINAL") {
            const ans = tryExtract(step);
            if (ans) {
              return ans;
            }
          }
        }
        // Fallback: last step with extractable content
        for (let i = steps.length - 1; i >= 0; i--) {
          const ans = tryExtract(steps[i]);
          if (ans) {
            return ans;
          }
        }
      } catch {
        /* ignore */
      }
      return "";
    }

    /** Assemble Perplexity SSE stream and emit captured user + assistant messages.
     *
     * Strategy: the `final_sse_message: true` event (second-to-last SSE event,
     * just before `end_of_stream`) contains the fully consolidated response:
     *   - `context_uuid`          → conversationId
     *   - `query_str`             → user message (redundant but reliable fallback)
     *   - `thread_title`          → conversation title
     *   - `display_model`         → model name
     *   - `blocks[intended_usage="ask_text_0_markdown"].markdown_block.answer` → full answer
     *   - `text` (JSON string)    → tertiary fallback for answer
     *
     * We also dispatch the user message early as soon as `context_uuid` appears
     * (first SSE event) so it's recorded before the assistant reply.
     */
    async function assemblePerplexitySSEStream(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      url: string,
      timestamp: number,
      isPartialRef: { value: boolean },
      pendingUserPayload: PendingUserPayload,
    ): Promise<void> {
      const decoder = new TextDecoder();
      let buffer = "";
      let conversationId = "";
      let model = "";
      let userDispatched = false;

      outer: try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            // Break immediately on end_of_stream event marker
            if (line.startsWith("event:")) {
              if (line.slice(6).trim() === "end_of_stream") break outer;
              continue;
            }

            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "{}") continue;

            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(jsonStr) as Record<string, unknown>;
            } catch {
              continue;
            }

            // Grab context_uuid from the very first event and dispatch user message early.
            // IMPORTANT: omit messageId here — frontend_uuid from the request body equals
            // msg["uuid"] in every SSE event, so using it for both user and assistant would
            // produce identical DB primary keys, causing a ConstraintError on the second write.
            if (
              !conversationId &&
              typeof msg["context_uuid"] === "string" &&
              msg["context_uuid"]
            ) {
              conversationId = msg["context_uuid"];
              if (pendingUserPayload && !userDispatched) {
                userDispatched = true;
                const { messageId: _drop, ...userPayloadWithoutId } =
                  pendingUserPayload as Record<string, unknown>;
                sendCapture(
                  "perplexity",
                  { ...userPayloadWithoutId, conversationId },
                  url,
                  timestamp,
                );
              }
            }
            if (
              !model &&
              typeof msg["display_model"] === "string" &&
              msg["display_model"]
            )
              model = msg["display_model"];

            // final_sse_message: true — the single fully-consolidated event we care about.
            // It contains the full answer, user query, title and all metadata.
            if (msg["final_sse_message"] !== true) continue;

            const effectiveConvId =
              conversationId ||
              (typeof msg["context_uuid"] === "string"
                ? msg["context_uuid"]
                : "") ||
              "unknown";
            const threadTitle =
              typeof msg["thread_title"] === "string"
                ? msg["thread_title"]
                : undefined;
            const finalModel =
              model ||
              (typeof msg["display_model"] === "string"
                ? msg["display_model"]
                : "");
            // Use backend_uuid for the assistant ID — it is unique per response.
            // msg["uuid"] equals frontend_uuid from the POST body, so using it for both
            // user and assistant would produce a duplicate primary key in IndexedDB.
            const backendUuid =
              typeof msg["backend_uuid"] === "string"
                ? msg["backend_uuid"]
                : undefined;

            // Dispatch user message from final event's query_str (fallback if early dispatch missed).
            // Do NOT pass messageId here either — frontend_uuid collides with the response uuid.
            const queryStr =
              typeof msg["query_str"] === "string"
                ? msg["query_str"].trim()
                : "";
            if (queryStr && !userDispatched) {
              userDispatched = true;
              sendCapture(
                "perplexity",
                {
                  role: "user",
                  content: queryStr,
                  conversationId: effectiveConvId,
                  model: finalModel,
                  isPartial: false,
                },
                url,
                timestamp,
              );
            }

            // Extract assistant answer: prefer blocks[ask_text_0_markdown].markdown_block.answer,
            // fall back to any markdown_block answer, then parse the `text` JSON field.
            let assembledAnswer = "";
            const fBlocks = msg["blocks"] as
              | Array<Record<string, unknown>>
              | undefined;
            if (Array.isArray(fBlocks)) {
              for (const usage of ["ask_text_0_markdown", "ask_text"]) {
                for (const block of fBlocks) {
                  if (block["intended_usage"] !== usage) continue;
                  const mb = block["markdown_block"] as
                    | Record<string, unknown>
                    | undefined;
                  if (typeof mb?.["answer"] === "string" && mb["answer"]) {
                    assembledAnswer = mb["answer"];
                    break;
                  }
                }
                if (assembledAnswer) break;
              }
            }
            // Tertiary fallback: parse the nested `text` JSON for the FINAL step answer
            if (!assembledAnswer && typeof msg["text"] === "string") {
              assembledAnswer = extractAnswerFromPerplexityTextJson(msg["text"]);
            }

            if (assembledAnswer) {
              const assistantPayload: Record<string, unknown> = {
                role: "assistant",
                content: assembledAnswer,
                conversationId: effectiveConvId,
                model: finalModel,
                isPartial: false,
              };
              if (backendUuid) assistantPayload["messageId"] = backendUuid;
              if (threadTitle) assistantPayload["threadTitle"] = threadTitle;
              sendCapture("perplexity", assistantPayload, url, timestamp);
              // Emit a title_update so the conversation appears with a proper name in the table
              const titleToUse =
                threadTitle || pendingUserPayload?.content || queryStr;
              if (titleToUse && effectiveConvId !== "unknown") {
                sendCapture(
                  "perplexity",
                  {
                    type: "title_update",
                    title: titleToUse,
                    conversationId: effectiveConvId,
                  },
                  url,
                  timestamp,
                );
              }
            }

            // Fallback: if user message was never dispatched, send now
            if (pendingUserPayload && !userDispatched) {
              sendCapture(
                "perplexity",
                { ...pendingUserPayload, conversationId: effectiveConvId },
                url,
                timestamp,
              );
            }

            break outer;
          }
        }
      } catch {
        isPartialRef.value = true;
      }
    }

    // ── Provider Strategy Table ───────────────────────────────────────────────
    // All referenced helpers are already defined above in the same function scope.
    // Adding a new provider = adding one entry here + updating detectProvider().
    const PROVIDER_STRATEGIES: Record<
      string,
      {
        isConversationCaptureUrl(url: string): boolean;
        extractUserMessageFromBody(
          body: unknown,
          url: string,
        ): {
          text: string;
          conversationId?: string;
          messageId?: string;
          model?: string;
        } | null;
        conversationIdFromUrl(url: string): string | undefined;
        usesDeltaV1(url: string): boolean;
      }
    > = {
      openai: {
        isConversationCaptureUrl(url) {
          return (
            url.endsWith("chatgpt.com/backend-api/f/conversation") ||
            url.includes("chat.openai.com/backend-api/conversation")
          );
        },
        extractUserMessageFromBody(body, _url) {
          return extractChatGPTRequestUserMessage(body);
        },
        conversationIdFromUrl(_url) {
          return undefined;
        },
        usesDeltaV1(url) {
          return isChatGPTDeltaV1(url);
        },
      },
      anthropic: {
        isConversationCaptureUrl(url) {
          return (
            isClaudeCompletionUrl(url) ||
            url.includes("api.anthropic.com/v1/messages")
          );
        },
        extractUserMessageFromBody(body, url) {
          if (!isClaudeCompletionUrl(url)) return null;
          const result = extractClaudeRequestUserMessage(body);
          if (!result) return null;
          const conversationId =
            extractClaudeConversationIdFromUrl(url) ?? undefined;
          return { text: result.text, model: result.model, conversationId };
        },
        conversationIdFromUrl(url) {
          return extractClaudeConversationIdFromUrl(url) ?? undefined;
        },
        usesDeltaV1(_url) {
          return false;
        },
      },
      google: {
        // Gemini uses XHR, not fetch — the fetch interceptor early-exits for google
        isConversationCaptureUrl(_url) {
          return false;
        },
        extractUserMessageFromBody(_body, _url) {
          return null;
        },
        conversationIdFromUrl(_url) {
          return undefined;
        },
        usesDeltaV1(_url) {
          return false;
        },
      },
      perplexity: {
        isConversationCaptureUrl(url) {
          return isPerplexityAskUrl(url);
        },
        extractUserMessageFromBody(body, _url) {
          return extractPerplexityRequestUserMessage(body);
        },
        conversationIdFromUrl(_url) {
          return undefined;
        },
        usesDeltaV1(_url) {
          return false;
        },
      },
    };

    /** Pending user message when POST had no conversationId (new chat); we defer until stream gives us one. */
    type PendingUserPayload = {
      role: "user";
      content: string;
      model?: string;
      messageId?: string;
      isPartial: boolean;
    } | null;

    async function assembleChatGPTDeltaV1(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      url: string,
      timestamp: number,
      isPartialRef: { value: boolean },
      pendingUserPayload: PendingUserPayload = null,
    ): Promise<void> {
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let conversationId = "";
      let model: string | undefined;
      let assistantMessageId: string | undefined;
      const assistantChunks: string[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

              const cid =
                (parsed["conversation_id"] as string | undefined) ??
                (parsed["conversationId"] as string | undefined);
              if (typeof cid === "string" && cid.trim())
                conversationId = cid.trim();

              if (currentEvent === "delta") {
                if (parsed["o"] === "add") {
                  const msg = (
                    parsed["v"] as Record<string, unknown> | undefined
                  )?.["message"] as Record<string, unknown> | undefined;
                  if (!model) {
                    model = (
                      msg?.["metadata"] as Record<string, unknown> | undefined
                    )?.["model_slug"] as string | undefined;
                  }
                  // Capture the assistant message's UUID from the stream — this matches
                  // the data-message-id attribute ChatGPT renders in the DOM, so the
                  // DOM-scan path (reload) and the network-capture path (new chat) both
                  // store the assistant reply under the same ID, preventing duplicates.
                  if (!assistantMessageId) {
                    const msgId = msg?.["id"] as string | undefined;
                    if (typeof msgId === "string" && msgId.trim()) {
                      assistantMessageId = msgId.trim();
                    }
                  }
                }
                // Only use one path: if v is an array it's a patch operation (containing
                // nested append ops); if v is a plain string it's a direct top-level append.
                // These two formats are mutually exclusive — never let both paths run for
                // the same event, which would duplicate the same text chunk.
                if (
                  Array.isArray(parsed["v"]) &&
                  (parsed["o"] === "patch" || parsed["o"] === undefined)
                ) {
                  for (const patch of parsed["v"] as Record<
                    string,
                    unknown
                  >[]) {
                    if (
                      patch["o"] === "append" &&
                      patch["p"] === "/message/content/parts/0" &&
                      typeof patch["v"] === "string"
                    ) {
                      assistantChunks.push(patch["v"]);
                    }
                  }
                } else if (
                  parsed["o"] === "append" &&
                  typeof parsed["v"] === "string"
                ) {
                  assistantChunks.push(parsed["v"]);
                }
              }
            } catch {
              // skip unparseable
            }
          }
        }
      } catch {
        isPartialRef.value = true;
      }

      const assistantText = assistantChunks.join("");
      // For new chats: send deferred user message first with conversationId from stream
      if (pendingUserPayload && conversationId) {
        sendCapture(
          "openai",
          { ...pendingUserPayload, conversationId },
          url,
          timestamp,
        );
      } else if (pendingUserPayload && !conversationId) {
        // Fallback: stream gave no conversationId, send user with 'unknown' to avoid losing it
        sendCapture(
          "openai",
          { ...pendingUserPayload, conversationId: "unknown" },
          url,
          timestamp,
        );
      }
      // Only store the assistant reply when the stream completed cleanly (not cut off).
      // A partial/cut-off reply would be stored as incomplete content, and if ChatGPT
      // retries the full stream, the complete version would be stored again as a duplicate.
      if (assistantText && !isPartialRef.value) {
        const assistantPayload: Record<string, unknown> = {
          role: "assistant",
          content: assistantText,
          conversationId: conversationId || "unknown",
          model,
          isPartial: false,
        };
        if (assistantMessageId)
          assistantPayload["messageId"] = assistantMessageId;
        sendCapture("openai", assistantPayload, url, timestamp);
      }
    }

    async function assembleSSEStream(
      reader: ReadableStreamDefaultReader<Uint8Array>,
      provider: string,
      url: string,
      timestamp: number,
      isPartialRef: { value: boolean },
      conversationIdOverride?: string,
    ): Promise<void> {
      const decoder = new TextDecoder();
      let buffer = "";
      const contentChunks: string[] = [];
      let conversationId: string | undefined = conversationIdOverride;
      let model: string | undefined;
      let role = "assistant";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

              const choices = parsed["choices"] as
                | Array<Record<string, unknown>>
                | undefined;
              if (choices?.length) {
                const delta = choices[0]["delta"] as
                  | Record<string, unknown>
                  | undefined;
                if (delta?.["content"])
                  contentChunks.push(delta["content"] as string);
                if (delta?.["role"]) role = delta["role"] as string;
                if (!conversationId)
                  conversationId = parsed["id"] as string | undefined;
                if (!model) model = parsed["model"] as string | undefined;
              }

              if (parsed["type"] === "content_block_delta") {
                const d = parsed["delta"] as
                  | Record<string, unknown>
                  | undefined;
                if (d?.["text"]) contentChunks.push(d["text"] as string);
              }

              if (parsed["type"] === "message_start") {
                const msg = parsed["message"] as
                  | Record<string, unknown>
                  | undefined;
                // Only fall back to stream id if no override was provided
                if (!conversationId)
                  conversationId = msg?.["id"] as string | undefined;
                if (!model) model = msg?.["model"] as string | undefined;
              }
            } catch {
              // skip
            }
          }
        }
      } catch {
        isPartialRef.value = true;
      }

      const assembled = contentChunks.join("");
      if (assembled && !isPartialRef.value) {
        sendCapture(
          provider,
          {
            role,
            content: assembled,
            conversationId: conversationId ?? String(timestamp),
            model,
            isPartial: false,
          },
          url,
          timestamp,
        );
      }
    }

    // Verify fetch is available (the window-level guard above already prevents double injection)
    try {
      if (typeof window.fetch !== "function") {
        sendReady("error: window.fetch is not a function");
        return;
      }
    } catch (e) {
      sendReady("error: " + (e instanceof Error ? e.message : String(e)));
      return;
    }

    let originalFetch: typeof window.fetch;
    try {
      originalFetch = window.fetch.bind(window);
    } catch (e) {
      sendReady(
        "error: bind failed " + (e instanceof Error ? e.message : String(e)),
      );
      return;
    }

    // Skip wrapping for known third-party/analytics URLs so we don't appear in their CSP/violation stacks.
    const isIgnoredHost = (u: string): boolean =>
      /googleadservices\.com|googletagmanager\.com|google-analytics\.com|doubleclick\.net/i.test(
        u,
      );

    const interceptedFetch = async function interceptedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      let url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (typeof url !== "string") url = "";
      if (!url && input instanceof Request) {
        const r = input as Request;
        url = (r.url && typeof r.url === "string" ? r.url : "") || "";
      }
      if (
        typeof url === "string" &&
        url.startsWith("/") &&
        typeof window !== "undefined" &&
        window.location
      ) {
        url = window.location.origin + url;
      }
      if (
        typeof url === "string" &&
        !url.startsWith("http") &&
        typeof window !== "undefined" &&
        window.location
      ) {
        try {
          url = new URL(url, window.location.href).href;
        } catch (_) {}
      }
      if (isIgnoredHost(url)) return originalFetch(input, init);

      const provider = detectProvider(url);
      if (provider === "google") {
        return originalFetch(input, init);
      }

      if (!provider || !isApiEndpoint(url)) {
        return originalFetch(input, init);
      }

      const timestamp = Date.now();
      let pendingUserPayload: PendingUserPayload = null;

      const strategy = PROVIDER_STRATEGIES[provider];

      // Capture user message from POST body via provider strategy
      if (strategy && strategy.isConversationCaptureUrl(url)) {
        const method = (
          init?.method ??
          (input instanceof Request ? (input as Request).method : "GET")
        ).toUpperCase();
        if (method === "POST") {
          let bodyJson: unknown = null;
          if (typeof init?.body === "string") {
            try {
              bodyJson = JSON.parse(init.body);
            } catch {
              // ignore
            }
          } else if (
            init?.body &&
            typeof (init.body as Blob).text === "function"
          ) {
            // Blob body
            try {
              const text = await (init.body as Blob).text();
              bodyJson = text ? JSON.parse(text) : null;
            } catch {
              // ignore
            }
          } else if (input instanceof Request && (input as Request).body) {
            try {
              const cloned = (input as Request).clone();
              const text = await cloned.text();
              bodyJson = text ? JSON.parse(text) : null;
            } catch {
              // ignore
            }
          }
          const userPayload = bodyJson
            ? strategy.extractUserMessageFromBody(bodyJson, url)
            : null;
          if (userPayload?.text) {
            if (userPayload.conversationId) {
              const payload: Record<string, unknown> = {
                role: "user",
                content: userPayload.text,
                isPartial: false,
                conversationId: userPayload.conversationId,
              };
              if (userPayload.model) payload["model"] = userPayload.model;
              if (userPayload.messageId)
                payload["messageId"] = userPayload.messageId;
              sendCapture(provider, payload, url, timestamp);
            } else {
              pendingUserPayload = {
                role: "user",
                content: userPayload.text,
                model: userPayload.model,
                isPartial: false,
                messageId: userPayload.messageId,
              };
            }
          }
        }
      }

      // Intercept Perplexity set_thread_title: read context_uuid + title from POST body
      if (
        provider === "perplexity" &&
        url.includes("perplexity.ai/rest/thread/set_thread_title")
      ) {
        let setTitleBody: Record<string, unknown> | null = null;
        if (typeof init?.body === "string") {
          try {
            setTitleBody = JSON.parse(init.body);
          } catch {
            /* ignore */
          }
        } else if (input instanceof Request) {
          try {
            const cloned = (input as Request).clone();
            const text = await cloned.text();
            if (text) setTitleBody = JSON.parse(text);
          } catch {
            /* ignore */
          }
        }
        if (setTitleBody) {
          const contextUuid = setTitleBody["context_uuid"] as
            | string
            | undefined;
          const newTitle = setTitleBody["title"] as string | undefined;
          if (
            contextUuid &&
            typeof contextUuid === "string" &&
            contextUuid.trim() &&
            newTitle &&
            typeof newTitle === "string" &&
            newTitle.trim()
          ) {
            sendCapture(
              "perplexity",
              {
                type: "title_update",
                title: newTitle.trim(),
                conversationId: contextUuid.trim(),
              },
              url,
              timestamp,
            );
          }
        }
        return originalFetch(input, init);
      }

      const response = await originalFetch(input, init);

      // Intercept Claude conversation history (user opened existing chat)
      if (provider === "anthropic" && isClaudeConversationHistoryUrl(url)) {
        response
          .clone()
          .json()
          .then((data: unknown) => {
            if (data && typeof data === "object") {
              const d = data as Record<string, unknown>;
              sendCapture("anthropic", data, url, timestamp);
              const title = d["name"];
              const conversationId = d["uuid"];
              if (
                typeof title === "string" &&
                title.trim() &&
                typeof conversationId === "string" &&
                conversationId.trim()
              ) {
                sendCapture(
                  "anthropic",
                  {
                    type: "title_update",
                    title: title.trim(),
                    conversationId: conversationId.trim(),
                  },
                  url,
                  timestamp,
                );
              }
            }
          })
          .catch(() => undefined);
        return response;
      }

      // Intercept Claude title API response and send as title_update
      if (provider === "anthropic" && isClaudeTitleUrl(url)) {
        const clonedTitle = response.clone();
        clonedTitle
          .json()
          .then((data: unknown) => {
            if (data && typeof data === "object") {
              const titleData = data as Record<string, unknown>;
              const title = titleData["title"];
              if (typeof title === "string" && title.trim()) {
                const conversationId = extractClaudeConversationIdFromUrl(url);
                if (conversationId) {
                  sendCapture(
                    "anthropic",
                    {
                      type: "title_update",
                      title: title.trim(),
                      conversationId,
                    },
                    url,
                    timestamp,
                  );
                }
              }
            }
          })
          .catch(() => undefined);
        return response;
      }

      // Intercept Perplexity thread history (user opened existing thread)
      if (provider === "perplexity" && isPerplexityThreadUrl(url)) {
        response
          .clone()
          .json()
          .then((data: unknown) => {
            if (data && typeof data === "object") {
              sendCapture("perplexity", data, url, timestamp);
            }
          })
          .catch(() => undefined);
        return response;
      }

      // Intercept Grok single-conversation metadata (conversations_v2) → title_update
      if (provider === "xai" && isGrokConversationsV2Url(url)) {
        response
          .clone()
          .json()
          .then((data: unknown) => {
            if (data && typeof data === "object") {
              const d = data as Record<string, unknown>;
              const conv = d["conversation"] as Record<string, unknown> | undefined;
              const conversationId = conv?.["conversationId"] as string | undefined;
              const title = conv?.["title"] as string | undefined;
              if (conversationId && title && title !== "New conversation") {
                sendCapture(
                  "xai",
                  { type: "title_update", conversationId, title: title.trim() },
                  url,
                  timestamp,
                );
              }
            }
          })
          .catch(() => undefined);
        return response;
      }

      // Intercept Grok history (load-responses)
      if (provider === "xai" && isGrokLoadResponsesUrl(url)) {
        const urlConversationId = extractGrokConversationIdFromUrl(url);
        const pageConversationId = getGrokPageConversationId();
        // Only capture if URL conversation ID matches the current page's conversation
        // (fall back to capturing if no canonical link is present)
        if (urlConversationId && (pageConversationId === null || urlConversationId === pageConversationId)) {
          response
            .clone()
            .json()
            .then((data: unknown) => {
              if (data && typeof data === "object") {
                const payload = {
                  ...(data as Record<string, unknown>),
                  _conversationId: urlConversationId,
                };
                sendCapture("xai", payload, url, timestamp);
              }
            })
            .catch(() => undefined);
        }
        return response;
      }

      // Intercept Grok new conversation streaming (concatenated JSON)
      if (provider === "xai" && isGrokNewConversationUrl(url)) {
        handleGrokStreamingResponse(response.clone(), url, timestamp, true);
        return response;
      }

      // Intercept Grok existing conversation streaming (concatenated JSON)
      if (provider === "xai" && isGrokResponsesUrl(url)) {
        handleGrokStreamingResponse(response.clone(), url, timestamp, false);
        return response;
      }

      if (!strategy || !strategy.isConversationCaptureUrl(url)) {
        return response;
      }

      const cloned = response.clone();
      const contentType = response.headers.get("content-type") ?? "";

      // Perplexity SSE endpoint may use text/plain or other content-type instead of text/event-stream
      const isPerplexitySse =
        provider === "perplexity" && isPerplexityAskUrl(url);
      if (contentType.includes("text/event-stream") || isPerplexitySse) {
        const reader = cloned.body?.getReader();
        if (reader) {
          const isPartialRef = { value: false };
          const convIdOverride = strategy.conversationIdFromUrl(url);
          let task: Promise<void>;
          if (provider === "perplexity") {
            task = assemblePerplexitySSEStream(
              reader,
              url,
              timestamp,
              isPartialRef,
              pendingUserPayload,
            );
          } else if (strategy.usesDeltaV1(url)) {
            task = assembleChatGPTDeltaV1(
              reader,
              url,
              timestamp,
              isPartialRef,
              pendingUserPayload,
            );
          } else {
            task = assembleSSEStream(
              reader,
              provider,
              url,
              timestamp,
              isPartialRef,
              convIdOverride,
            );
          }
          task.catch(() => {
            isPartialRef.value = true;
          });
        }
      } else if (contentType.includes("application/json")) {
        cloned
          .json()
          .then((data: unknown) => sendCapture(provider, data, url, timestamp))
          .catch(() => undefined);
      }

      return response;
    };

    try {
      (
        interceptedFetch as unknown as { __aiMemoryIntercepted: boolean }
      ).__aiMemoryIntercepted = true;
      window.fetch = interceptedFetch;
      sendReady("fetch_installed");
    } catch (e) {
      sendReady(
        "error: assign fetch " + (e instanceof Error ? e.message : String(e)),
      );
    }

    // Prevent double injection for XHR too
    if (
      (window.XMLHttpRequest as unknown as { __aiMemoryIntercepted?: boolean })
        .__aiMemoryIntercepted
    ) {
      return;
    }

    const OriginalXHR = window.XMLHttpRequest;

    class InterceptedXMLHttpRequest extends OriginalXHR {
      private _url = "";
      private _method = "";
      private _timestamp = 0;

      open(method: string, url: string | URL, ...rest: unknown[]): void {
        this._method = method;
        this._url = typeof url === "string" ? url : (url as URL).href;
        if (
          this._url.startsWith("/") &&
          typeof window !== "undefined" &&
          window.location
        ) {
          this._url = window.location.origin + this._url;
        } else if (
          this._url &&
          !this._url.startsWith("http") &&
          typeof window !== "undefined" &&
          window.location
        ) {
          try {
            this._url = new URL(this._url, window.location.href).href;
          } catch (_) {}
        }
        // @ts-expect-error forward rest args
        super.open(method, url, ...rest);
      }

      send(body?: Document | XMLHttpRequestBodyInit | null): void {
        const provider = detectProvider(this._url);

        // Gemini now uses DOM-based capture via gemini-injector.tsx; skip XHR interception
        if (
          provider &&
          isApiEndpoint(this._url) &&
          isConversationCaptureUrl(this._url, provider)
        ) {
          if (!this._timestamp) this._timestamp = Date.now();
          this.addEventListener("load", () => {
            try {
              const contentType = (
                this.getResponseHeader("content-type") ?? ""
              ).toLowerCase();
              if (contentType.includes("application/json") && provider) {
                const data = JSON.parse(this.responseText as string) as unknown;
                sendCapture(provider, data, this._url, this._timestamp);
              }
            } catch {
              // ignore
            }
          });
        }

        super.send(body ?? null);
      }
    }

    // Mark as intercepted to prevent double injection
    (
      InterceptedXMLHttpRequest as unknown as { __aiMemoryIntercepted: boolean }
    ).__aiMemoryIntercepted = true;
    window.XMLHttpRequest = InterceptedXMLHttpRequest as typeof XMLHttpRequest;
  } catch (e) {
    sendReady("error: " + (e instanceof Error ? e.message : String(e)));
  }
}
