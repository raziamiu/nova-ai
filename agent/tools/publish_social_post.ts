import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { receiptSchema, publishSocialPostPayload } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

export default defineTool({
  description:
    "Publish (or schedule) an organic social post — instagram/tiktok/facebook reel, post, or story — with a caption in the brand voice and optional featured products. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: publishSocialPostPayload.extend({
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to marketing."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    const featured = payload.productIds[0]
      ? (await client.getProduct(payload.productIds[0]))?.name
      : undefined;
    const title = `${payload.scheduledFor ? "Schedule" : "Publish"} ${payload.platform} ${payload.format}${featured ? ` featuring "${featured}"` : ""}`;
    return performAction(client, {
      type: "publish_social_post",
      department: department ?? "marketing",
      title,
      payload,
      receipt,
    });
  },
});
