import { z } from 'zod';

import type { NodeDefinition } from '../types';

const waitExternalConfig = z.object({
  timeoutHours: z.number().int().min(1).max(168).default(72),
});

export type WaitExternalConfig = z.infer<typeof waitExternalConfig>;

/**
 * Pauses this run until a correlated inbound webhook arrives
 * (`run_id` in the JSON body, posted to this automation's hook).
 * Resume is the same run — not a second automation.
 */
export const waitExternalNode: NodeDefinition<WaitExternalConfig> = {
  type: 'wait.external',
  kind: 'wait',
  label: 'Wait for webhook',
  description: 'Pause until a correlated inbound webhook resumes this run',
  category: 'integration',
  flags: { pausesFlow: true },
  configSchema: waitExternalConfig,
  summarize(config) {
    return `Wait for webhook (${config.timeoutHours}h)`;
  },
  execute(ctx, config) {
    const waitUntil = new Date(
      ctx.now.getTime() + config.timeoutHours * 3_600_000
    ).toISOString();
    return {
      status: 'wait',
      waitKind: 'event',
      waitUntil,
      output: {
        runId: ctx.runId,
        correlation: ctx.runId,
        timeoutHours: config.timeoutHours,
      },
    };
  },
};
