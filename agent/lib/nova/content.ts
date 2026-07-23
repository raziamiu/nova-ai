/**
 * Content generation (Stage 4 "Craft", §13 + FR-6) — the deterministic sink
 * for the model's draft.
 *
 * Nova (the model) writes the copy in-session, in the store's brand voice, and
 * hands it to `generate_content`. This is where that draft is turned into a
 * reviewable artefact: scored against the structured BrandProfile with the
 * deterministic `scoreVoice` pass, then filed into the founder's review queue
 * with its score + every cited violation. The creativity is the model's; the
 * SCORING and the receipt are code, so a draft can never reach the founder with
 * an unexplained number, and a flagged draft can't quietly pass (§2.4).
 *
 * `contentId` makes this the request-changes loop too: re-filing an existing
 * draft keeps the prior version and returns it to review (see the API's
 * `POST /agent-data/content` regeneration branch).
 */

import type { StoreClient } from "../store/client";
import type { ContentItem, ContentLanguage, ContentType, VoiceScore } from "../types";
import { scoreVoice, detectLanguage } from "./voice";

export interface DraftContentInput {
  type: ContentType;
  title: string;
  /** The model-written copy. */
  text: string;
  language?: ContentLanguage;
  topic?: string;
  /** Present = revise this existing draft (request-changes loop). */
  contentId?: string;
  /** The founder's change request being addressed, when revising. */
  note?: string;
}

export interface DraftContentResult {
  item: ContentItem;
  score: VoiceScore;
  /** Model-facing next step — non-empty only when the draft is flagged off-voice. */
  guidance: string;
}

/**
 * Score a model-written draft against the store's brand voice and file it into
 * review. Returns the filed item, its score, and — when flagged — guidance the
 * model can act on to revise BEFORE the founder ever sees an off-voice draft.
 */
export async function draftAndFileContent(
  store: StoreClient,
  input: DraftContentInput,
): Promise<DraftContentResult> {
  const profile = await store.getBrandProfile();
  const language = input.language ?? detectLanguage(input.text);
  const score = scoreVoice({ text: input.text, type: input.type, language }, profile);

  const body: Record<string, unknown> = { text: input.text };
  if (input.topic) body.topic = input.topic;
  if (input.note) body.note = input.note;

  const item = await store.fileContent({
    id: input.contentId,
    type: input.type,
    title: input.title,
    language,
    body,
    voiceScore: score.score,
    violations: score.violations,
  });

  return { item, score, guidance: reviseGuidance(score, item.id) };
}

/** The revise prompt the tool hands back to the model when a draft is flagged. */
export function reviseGuidance(score: VoiceScore, contentId: string): string {
  if (!score.flagged) return "";
  const cites = score.violations.map((v) => v.message).join(" ");
  return (
    `This draft scored ${score.score} and is flagged off-voice. ` +
    `Rewrite it to fix each of these, then call generate_content again with contentId "${contentId}" ` +
    `so the founder only sees an in-voice revision: ${cites}`
  );
}
