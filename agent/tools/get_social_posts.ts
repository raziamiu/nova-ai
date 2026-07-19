import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "List social media posts (Instagram/TikTok/Facebook reels, posts, stories) with caption, linked products, and schedule. Filter by status (draft, scheduled, published). Use to review the content calendar before drafting or publishing. Returns { count, posts } (max 50).",
  inputSchema: z.object({
    status: z
      .enum(["draft", "scheduled", "published"])
      .optional()
      .describe("Only posts with this status"),
  }),
  async execute(input) {
    const client = getStoreClient();
    const posts = client.listSocialPosts(input.status);
    return { count: posts.length, posts: posts.slice(0, 50) };
  },
});
