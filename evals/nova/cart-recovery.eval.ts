import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

/**
 * PRD sales department: cart recovery consults the cart list, produces
 * personalized sends via the gated messaging tool, and reports one
 * consolidated summary (prepared or sent — honestly labeled).
 */
export default defineEval({
  description: "Cart recovery sweeps the abandoned carts and drafts personalized messages.",
  async test(t) {
    await t.send("Please recover our abandoned carts.");
    t.succeeded();
    t.calledTool("get_abandoned_carts");
    t.calledTool("send_customer_message");
    // At autonomy level 2 the sends come back "prepared" — the summary must
    // say prepared/queued (or sent, if the owner later raises autonomy).
    t.check(
      t.reply,
      satisfies(
        (v) => /prepared|queued|awaiting|approval|sent/i.test(String(v)),
        "summary states prepared/sent status",
      ),
    );
    t.check(
      t.reply,
      satisfies((v) => /\d/.test(String(v)), "summary includes a cart count or value"),
    );
  },
});
