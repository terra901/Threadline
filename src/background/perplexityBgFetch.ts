import type { CaptureMessage } from "../types/messages";

// ─── Perplexity background-fetch fallback ─────────────────────────────────────
// When Cloudflare Access blocks Perplexity's restricted static JS on page reload,
// the SPA may not fully initialise, so the page-level fetch to /rest/thread/<slug>
// is never made and our fetch interceptor never fires.
// Solution: the background SW proactively fetches the thread REST endpoint on
// tab-complete for Perplexity thread pages. The extension has host_permissions for
// www.perplexity.ai, so `credentials: 'include'` carries the user's auth cookies.

/**
 * Extracts the thread slug from a Perplexity thread page URL.
 * Matches https://www.perplexity.ai/search/<slug>
 */
export function extractPerplexityThreadSlug(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    if (u.hostname !== "www.perplexity.ai") return null;
    const m = u.pathname.match(/^\/search\/([^/]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Proactively fetches Perplexity thread history from the background service worker.
 * This runs independently of the page's JS, bypassing any Cloudflare Access issues
 * that might prevent the page from making the request itself.
 *
 * @param handleCapture - callback to process the fetched data (background/index handleCaptureMessage)
 */
export async function maybeFetchPerplexityThreadHistory(
  pageUrl: string,
  handleCapture: (msg: CaptureMessage) => Promise<unknown>,
): Promise<void> {
  const slug = extractPerplexityThreadSlug(pageUrl);
  if (!slug) return;

  // Build REST URL with the same block-use-cases the SPA normally requests
  const params = new URLSearchParams({
    with_parent_info: "true",
    with_schematized_response: "true",
    version: "2.18",
    source: "default",
    limit: "50",
    offset: "0",
    from_first: "true",
  });
  for (const useCase of [
    "answer_modes",
    "media_items",
    "knowledge_cards",
    "inline_entity_cards",
    "place_widgets",
    "finance_widgets",
    "news_widgets",
    "shopping_widgets",
    "search_result_widgets",
    "inline_images",
    "inline_assets",
    "diff_blocks",
    "inline_knowledge_cards",
    "answer_tabs",
    "preserve_latex",
    "in_context_suggestions",
    "inline_claims",
    "unified_assets",
  ]) {
    params.append("supported_block_use_cases", useCase);
  }

  const restUrl = `https://www.perplexity.ai/rest/thread/${encodeURIComponent(slug)}?${params.toString()}`;

  try {
    const res = await fetch(restUrl, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        Referer: pageUrl,
      },
    });

    if (!res.ok) {
      console.warn(
        "[Threadline] Perplexity bg fetch failed, status:",
        res.status,
        "slug:",
        slug,
      );
      return;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      console.warn(
        "[Threadline] Perplexity bg fetch non-JSON response:",
        contentType,
        "slug:",
        slug,
      );
      return;
    }

    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return;

    // Only proceed if it looks like a valid thread history response
    const d = data as Record<string, unknown>;
    if (d["status"] !== "success" || !Array.isArray(d["entries"])) return;

    await handleCapture({
      type: "CAPTURE_MESSAGE",
      payload: {
        provider: "perplexity",
        rawData: data,
        url: restUrl,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    console.warn("[Threadline] Perplexity bg fetch error for slug:", slug, err);
  }
}
