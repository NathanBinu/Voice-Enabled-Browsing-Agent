import { z } from 'zod';

/** Entities extracted from user speech (kept flexible for MVP). */
export const Entities = z.object({
  brand: z.string().optional(),
  category: z.string().optional(),
  price_max: z.number().optional(),
  sort: z.string().optional(),

  // NEW — used by the executor for region/currency-aware search
  country: z.string().optional(),
  currency: z.string().optional(),
});

/** One atomic browser step (the executor understands these). */
export const Step = z.object({
  op: z.enum(['navigate','search','click','type','filter','sort','extract','screenshot']),
  url: z.string().url().optional(),
  selector: z.record(z.any()).optional(),
  text: z.string().optional(),
  facet: z.string().optional(),
  lte: z.number().optional(),
  by: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  target: z.string().optional(),
  schema: z.array(z.string()).optional(),
  limit: z.number().optional(),
});

/** This is the "contract" between the NLU and the executor. */
export const CommandJSON = z.object({
    id: z.string(),
    utterance: z.string(),
    intent: z.string(),
    confidence: z.number(),       // used by the confidence gate
    entities: Entities,
    steps: z.array(Step),
    postconditions: z.array(z.any()).optional(),
    requires_confirmation: z.boolean().optional(),
    timestamp: z.string()
});

export type Command = z.infer<typeof CommandJSON>;
export type CommandStep = z.infer<typeof Step>;
export type CommandEntities = z.infer<typeof Entities>;

/** (Optional) helper types for executor responses */
export type ExecutorArtifacts = { screenshots: string[]; table?: any[] };
export type ExecutorResult = {
  status: "done" | "error";
  answer?: string;          // spoken/tts text
  artifacts: ExecutorArtifacts;
};

//export type Command = z.infer<typeof CommandJSON>;

export const StagehandAction = z.object({
  type: z.enum(["navigate", "act", "extract", "observe"]).or(z.string()), // be permissive
  instruction: z.string().optional(),
  schema: z.record(z.any()).optional() // e.g. { price: "string", currency: "string" }
});

export const StagehandPlan = z.object({
  intent: z.string().optional(),
  product: z.string().optional(),
  specifications: z.array(z.string()).optional(),
  url: z.string().optional(),
  actions: z.array(StagehandAction)
});
export type StagehandPlan = z.infer<typeof StagehandPlan>;