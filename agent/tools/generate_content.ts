import { defineTool } from "eve/tools";
import { generateContentPayload } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";
import { draftAndFileContent } from "../lib/nova/content";

/**
 * generate_content (Stage 4 "Craft", E-11). You write the copy in the store's
 * brand voice; this tool scores it against the brand profile (0–100, every
 * point off cited) and files it into the founder's review queue. Nothing is
 * published — the founder approves, requests changes, or rejects it there.
 *
 * If the returned draft is `flagged`, DO NOT stop: read the `guidance`, rewrite
 * the copy to fix each cited violation, and call this again with the same
 * `contentId` so the founder only ever sees an in-voice revision.
 */
export default defineTool({
  description:
    "File a piece of store content you've written (post/reel/story/captions/email/sms/push/product_desc) into the founder's review queue, scored against the store's brand voice. You write the copy; this scores it (0–100, every deduction cited) and files it for the founder to approve/request-changes/reject — it does NOT publish. Pass contentId to file a revision of an existing draft (the request-changes loop). If the result is flagged off-voice, rewrite per the returned guidance and call again with the same contentId before the founder sees it.",
  inputSchema: generateContentPayload,
  async execute(input, ctx) {
    const store = storeFor(requireStore(ctx).storeId);
    const { item, score, guidance } = await draftAndFileContent(store, {
      type: input.type,
      title: input.title,
      text: input.text,
      language: input.language,
      topic: input.topic,
      contentId: input.contentId,
      note: input.note,
    });
    return {
      contentId: item.id,
      status: item.status,
      voiceScore: score.score,
      flagged: score.flagged,
      violations: score.violations,
      ...(guidance ? { guidance } : {}),
    };
  },
});
