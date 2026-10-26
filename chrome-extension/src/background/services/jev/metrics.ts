import { JEV_FEATURES, type JevFeature } from '@extension/storage';

export interface JevFeatureCounts {
  hits: number;
  fallbacks: number;
}

export interface TaskTimingSummary {
  totalMs: number;
  llmCalls: number;
  jevCalls: number;
  features: Record<JevFeature, JevFeatureCounts>;
}

const emptyCounts = (): Record<JevFeature, JevFeatureCounts> =>
  Object.fromEntries(JEV_FEATURES.map(feature => [feature, { hits: 0, fallbacks: 0 }])) as Record<
    JevFeature,
    JevFeatureCounts
  >;

/** Per-task counters for the optional timing log: LLM calls, Jev calls, and Jev hits and fallbacks per feature. */
export class JevTaskMetrics {
  private readonly startedAt: number;
  private llmCalls = 0;
  private jevCalls = 0;
  private readonly features = emptyCounts();

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  recordLlmCall(): void {
    this.llmCalls++;
  }

  recordJevCall(): void {
    this.jevCalls++;
  }

  recordHit(feature: JevFeature): void {
    this.features[feature].hits++;
  }

  recordFallback(feature: JevFeature): void {
    this.features[feature].fallbacks++;
  }

  summary(): TaskTimingSummary {
    return {
      totalMs: this.now() - this.startedAt,
      llmCalls: this.llmCalls,
      jevCalls: this.jevCalls,
      features: structuredClone(this.features),
    };
  }
}
