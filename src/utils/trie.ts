/**
 * Trie for prefix-based autosuggest of prompt text.
 * Stores full prompt strings; given a prefix, returns all prompts that start with it.
 */
export class PromptTrie {
  private root: TrieNode = { children: new Map(), prompts: [] }

  /** Insert a prompt text. Call when prompts are loaded or added. */
  insert(text: string): void {
    const t = text.trim()
    if (!t) return
    let node = this.root
    for (const ch of t) {
      let child = node.children.get(ch)
      if (!child) {
        child = { children: new Map(), prompts: [] }
        node.children.set(ch, child)
      }
      node = child
    }
    if (!node.prompts.includes(t)) node.prompts.push(t)
  }

  /** Remove a prompt text. Call when a prompt is deleted. */
  remove(text: string): void {
    const t = text.trim()
    if (!t) return
    const path: TrieNode[] = [this.root]
    let node = this.root
    for (const ch of t) {
      const child = node.children.get(ch)
      if (!child) return
      path.push(child)
      node = child
    }
    node.prompts = node.prompts.filter((p) => p !== t)
  }

  /** Clear and rebuild from a list of prompt texts. */
  rebuild(texts: string[]): void {
    this.root = { children: new Map(), prompts: [] }
    for (const t of texts) this.insert(t)
  }

  /** Return up to `limit` prompts that start with the given prefix. */
  suggest(prefix: string, limit = 5): string[] {
    const p = prefix.trim()
    if (!p) return []
    let node = this.root
    for (const ch of p) {
      const child = node.children.get(ch)
      if (!child) return []
      node = child
    }
    const results: string[] = []
    this.collect(node, results, limit)
    return results
  }

  private collect(node: TrieNode, out: string[], limit: number): void {
    if (out.length >= limit) return
    for (const p of node.prompts) {
      out.push(p)
      if (out.length >= limit) return
    }
    for (const child of node.children.values()) {
      this.collect(child, out, limit)
      if (out.length >= limit) return
    }
  }
}

interface TrieNode {
  children: Map<string, TrieNode>
  prompts: string[]
}
