import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

/**
 * Stage 5 gate — bilingual. The same corpus must pass in Bangla: a Bangla ask
 * gets a grounded answer (tool-backed number), and Nova replies in the founder's
 * language, not a forced English fallback.
 */
export default defineEval({
  description: "A Bangla metric ask gets a grounded answer, in Bangla.",
  async test(t) {
    await t.send("এই সপ্তাহে কত টাকার বিক্রি হয়েছে আর কয়টা অর্ডার?");
    t.succeeded();
    t.noFailedActions();
    t.calledTool("get_business_snapshot");
    // Grounded: carries a figure (৳/taka/number).
    t.check(
      t.reply,
      satisfies((v) => /(৳|টাকা|taka|\d|[০-৯])/i.test(String(v)), "reply carries a grounded figure"),
    );
    // Answered in Bangla (contains Bangla script), not an English-only fallback.
    t.check(
      t.reply,
      satisfies((v) => /[ঀ-৿]/.test(String(v)), "reply is in Bangla"),
    );
  },
});
