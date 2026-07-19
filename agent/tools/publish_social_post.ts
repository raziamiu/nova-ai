import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { justificationSchema, publishSocialPostPayload } from "../lib/nova/schemas";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Publish (or schedule) an organic social post — instagram/tiktok/facebook reel, post, or story — with a caption in the brand voice and optional featured products. Autonomy-gated: returns status executed, prepared (awaiting owner approval), or blocked.",
  inputSchema: publishSocialPostPayload.extend({
    justification: justificationSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to marketing."),
  }),
  async execute({ justification, department, ...payload }) {
    const client = getStoreClient();
    const featured = payload.productIds[0]
      ? client.getProduct(payload.productIds[0])?.name
      : undefined;
    const title = `${payload.scheduledFor ? "Schedule" : "Publish"} ${payload.platform} ${payload.format}${featured ? ` featuring "${featured}"` : ""}`;
    return performAction({
      type: "publish_social_post",
      department: department ?? "marketing",
      title,
      payload,
      justification,
    });
  },
});
