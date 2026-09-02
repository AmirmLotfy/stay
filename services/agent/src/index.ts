import { Agent, BedrockModel } from '@strands-agents/sdk';
import {
  IntentSchema,
  MinimalIntentContextSchema,
  type InterpretedIntent,
  type MinimalIntentContext,
} from '@stay/contracts';

export { IntentSchema, MinimalIntentContextSchema } from '@stay/contracts';
export type { InterpretedIntent, MinimalIntentContext } from '@stay/contracts';

export class AgentUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}

export function bedrockFeatureStatus(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  modelId?: string;
  reason?: string;
} {
  if (!env.BEDROCK_MODEL_ID) {
    return {
      enabled: false,
      reason: 'BEDROCK_MODEL_ID is not set. Deterministic workflows remain available.',
    };
  }
  if ((env.AWS_REGION ?? 'us-east-1') !== 'us-east-1') {
    return { enabled: false, reason: 'The STAY release gate requires Bedrock in us-east-1.' };
  }
  return { enabled: true, modelId: env.BEDROCK_MODEL_ID };
}

export async function interpretIntent(
  rawContext: MinimalIntentContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InterpretedIntent> {
  const context = MinimalIntentContextSchema.parse(rawContext);
  const status = bedrockFeatureStatus(env);
  if (!status.enabled || !status.modelId) {
    throw new AgentUnavailableError(status.reason ?? 'Bedrock is unavailable.');
  }

  const model = new BedrockModel({
    region: env.AWS_REGION ?? 'us-east-1',
    modelId: status.modelId,
    maxTokens: 300,
    temperature: 0.05,
    stream: false,
    clientConfig: {
      maxAttempts: 3,
      retryMode: 'adaptive',
    },
  });
  const agent = new Agent({
    name: 'STAY intent interpreter',
    model,
    structuredOutputSchema: IntentSchema,
    contextManager: false,
    systemPrompt: [
      'Interpret a resident request into one of the allowed STAY goal-level tools.',
      'Never choose escalation order, modify safety policy, disclose sensitive data, or resolve an incident.',
      'Do not infer medical conditions, falls, emergencies, addresses, contacts, access codes, or location.',
      'Set explicitEmergencyLanguage true only when the resident uses explicit urgent or emergency wording.',
      'The explanation may describe what you understood, but must say that no action has been taken.',
      'Return only the validated structured output.',
    ].join(' '),
  });

  const result = await agent.invoke(
    `Locale: ${context.locale}\nCurrent surface: ${context.currentSurface}\nVisible IDs: ${context.visibleEntityIds.join(', ')}\nResident request: ${context.utterance}`,
  );
  return IntentSchema.parse(result.structuredOutput);
}
