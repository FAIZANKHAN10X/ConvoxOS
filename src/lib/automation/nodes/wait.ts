import { z } from 'zod';

import type { NodeDefinition } from '../types';

const waitConfig = z
  .object({
    amount: z.number().positive().optional(),
    unit: z.enum(['minutes', 'hours', 'days']).optional(),
    until: z.string().datetime().optional(),
  })
  .refine((v) => Boolean(v.until) || (v.amount != null && v.unit != null), {
    message: 'wait requires until or amount+unit',
  });

export const waitNode: NodeDefinition<z.infer<typeof waitConfig>> = {
  type: 'timing.wait',
  kind: 'wait',
  label: 'Wait',
  description: 'Pause the run until a later time',
  category: 'timing',
  configSchema: waitConfig,
  execute(ctx, config) {
    if (config.until) {
      return {
        status: 'wait',
        waitUntil: new Date(config.until).toISOString(),
      };
    }
    const amount = config.amount ?? 1;
    const unit = config.unit ?? 'hours';
    const ms =
      unit === 'days' ? 86_400_000 : unit === 'minutes' ? 60_000 : 3_600_000;
    return {
      status: 'wait',
      waitUntil: new Date(ctx.now.getTime() + amount * ms).toISOString(),
    };
  },
};
