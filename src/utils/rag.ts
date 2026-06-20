import type { SearchMemoriesResponse } from "../types/messages";

export function formatRAGPrompt(
  query: string,
  results: SearchMemoriesResponse["payload"]["results"],
): string {
  const memoryBlocks = results
    .map(
      (m, i) =>
        `--- Memory ${i + 1} ---\n` +
        `${m.content}\n` +
        `---------------------`,
    )
    .join("\n");

  return (
    "[System Context: The following are relevant memories from our past conversations. Use them as background knowledge for your response.]\n" +
    memoryBlocks +
    "\n[User Query]\n" +
    query
  );
}
