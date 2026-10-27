import type { AgentNameEnum, ModelConfig, ProviderConfig } from '@extension/storage';
import { ProviderTypeEnum } from '@extension/storage';
import type { ChatModel } from './helper';

/** Success/failure counts per `provider:model`, kept across tasks so working models are tried first. */
export type ModelHealth = Record<string, { ok: number; fail: number; lastOk?: number; lastFail?: number }>;

export interface ModelFailoverDeps {
  createChatModel: (providerConfig: ProviderConfig, modelConfig: ModelConfig) => ChatModel;
  /** Makes `config` the model of `slot`, so the next task starts with the model that worked. */
  persistSlotModel: (slot: AgentNameEnum, config: ModelConfig) => Promise<void>;
  saveHealth: (health: ModelHealth) => Promise<void>;
  now?: () => number;
}

interface Candidate {
  key: string;
  providerConfig: ProviderConfig;
  config: ModelConfig;
  chatModel?: ChatModel;
}

export const modelKey = (provider: string, modelName: string): string => `${provider}:${modelName}`;

function modelNamesOf(provider: ProviderConfig): string[] {
  const names = provider.type === ProviderTypeEnum.AzureOpenAI ? provider.azureDeploymentNames : provider.modelNames;
  return [...new Set((names ?? []).map(name => name.trim()).filter(Boolean))];
}

/** A provider needs an API key unless it is a local server or custom gateway. */
function usable(provider: ProviderConfig): boolean {
  if (provider.apiKey?.trim()) return true;
  const type = provider.type ?? ProviderTypeEnum.CustomOpenAI;
  return type === ProviderTypeEnum.Ollama || type === ProviderTypeEnum.CustomOpenAI;
}

/** Higher is better: models that worked recently and fail rarely come first. */
function healthScore(entry: ModelHealth[string] | undefined): number {
  if (!entry) return 0;
  const total = entry.ok + entry.fail;
  const successRate = total > 0 ? entry.ok / total : 0;
  const recentWin = entry.lastOk && (!entry.lastFail || entry.lastOk > entry.lastFail) ? 1 : 0;
  return recentWin * 2 + successRate;
}

const latestOf = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

/**
 * Merges a health snapshot into the stored one. Counts and timestamps only grow, so the larger value of each field
 * is the newer one; two writers that each saw an older snapshot keep both sets of results.
 */
export function mergeModelHealth(stored: ModelHealth, next: ModelHealth): ModelHealth {
  const merged: ModelHealth = { ...stored };
  for (const [key, entry] of Object.entries(next)) {
    const previous = merged[key];
    merged[key] = previous
      ? {
          ok: Math.max(previous.ok, entry.ok),
          fail: Math.max(previous.fail, entry.fail),
          lastOk: latestOf(previous.lastOk, entry.lastOk),
          lastFail: latestOf(previous.lastFail, entry.lastFail),
        }
      : entry;
  }
  return merged;
}

/**
 * Every model the user configured, with `primary` first and the rest ordered by past results.
 * Providers that are blocked (managed policy) or have no API key are left out by the caller / here.
 */
export function orderCandidates(
  primary: ModelConfig,
  providers: Record<string, ProviderConfig>,
  health: ModelHealth,
): Array<{ key: string; providerConfig: ProviderConfig; config: ModelConfig }> {
  const primaryKey = modelKey(primary.provider, primary.modelName);
  const others: Array<{ key: string; providerConfig: ProviderConfig; config: ModelConfig }> = [];
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    if (!usable(providerConfig)) continue;
    for (const modelName of modelNamesOf(providerConfig)) {
      const key = modelKey(providerId, modelName);
      if (key === primaryKey) continue;
      // Only provider and model change: sampling parameters are provider-specific, the store fills the defaults
      others.push({ key, providerConfig, config: { provider: providerId, modelName } });
    }
  }
  others.sort((a, b) => healthScore(health[b.key]) - healthScore(health[a.key]));
  const primaryProvider = providers[primary.provider];
  return primaryProvider ? [{ key: primaryKey, providerConfig: primaryProvider, config: primary }, ...others] : others;
}

/**
 * Keeps an agent slot working when its model fails: the next available model is tried, and the one that
 * answers becomes the slot's configured model. When every model fails the configuration is left as it was
 * (the default model) and the last error is returned to the caller. Models that failed during this task are
 * tried last on later calls, so a dead model does not cost a timeout on every step.
 */
export class ModelFailover {
  readonly slot: AgentNameEnum;
  private readonly deps: ModelFailoverDeps;
  private readonly candidates: Candidate[];
  private readonly failedThisTask = new Set<string>();
  private health: ModelHealth;
  private current: Candidate;
  private readonly primary: Candidate;

  constructor(
    slot: AgentNameEnum,
    candidates: Array<{ key: string; providerConfig: ProviderConfig; config: ModelConfig }>,
    health: ModelHealth,
    deps: ModelFailoverDeps,
  ) {
    if (candidates.length === 0) throw new Error('ModelFailover needs at least one model');
    this.slot = slot;
    this.deps = deps;
    this.health = health;
    this.candidates = candidates.map(candidate => ({ ...candidate }));
    this.primary = this.candidates[0];
    this.current = this.primary;
  }

  /** The configured (default) model, used when every model failed. */
  get primaryModel(): ChatModel {
    return this.chatModelOf(this.primary);
  }

  get size(): number {
    return this.candidates.length;
  }

  /** Models to try for one call, in order: the current one, untried ones by rank, then the ones that failed. */
  attemptOrder(): ChatModel[] {
    const rest = this.candidates.filter(candidate => candidate !== this.current);
    const fresh = rest.filter(candidate => !this.failedThisTask.has(candidate.key));
    const failed = rest.filter(candidate => this.failedThisTask.has(candidate.key));
    return [this.current, ...fresh, ...failed].map(candidate => this.chatModelOf(candidate));
  }

  async recordFailure(model: ChatModel): Promise<void> {
    const key = modelKey(model.provider, model.modelName);
    this.failedThisTask.add(key);
    const entry = this.health[key] ?? { ok: 0, fail: 0 };
    this.health = { ...this.health, [key]: { ...entry, fail: entry.fail + 1, lastFail: this.now() } };
    await this.deps.saveHealth(this.health).catch(() => {});
  }

  /** Records the success; a model other than the current one becomes the slot's configured model. */
  async recordSuccess(model: ChatModel): Promise<boolean> {
    const key = modelKey(model.provider, model.modelName);
    const candidate = this.candidates.find(item => item.key === key);
    this.failedThisTask.delete(key);
    const entry = this.health[key] ?? { ok: 0, fail: 0 };
    this.health = { ...this.health, [key]: { ...entry, ok: entry.ok + 1, lastOk: this.now() } };
    await this.deps.saveHealth(this.health).catch(() => {});
    if (!candidate || candidate === this.current) return false;
    this.current = candidate;
    await this.deps.persistSlotModel(this.slot, candidate.config);
    return true;
  }

  /** Every model failed: go back to the configured default for the next call. */
  restoreDefault(): ChatModel {
    this.current = this.primary;
    return this.primaryModel;
  }

  private chatModelOf(candidate: Candidate): ChatModel {
    candidate.chatModel ??= {
      ...this.deps.createChatModel(candidate.providerConfig, candidate.config),
      failover: this,
    };
    return candidate.chatModel;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}

export interface FailoverRunOptions {
  /** False for errors no other model can fix (user cancel, browser conflict, partial output already shown). */
  shouldTryNext: (error: unknown) => boolean;
  /** Called before trying a model other than the one in use. */
  onSwitch?: (model: ChatModel) => void;
  /** Called when a model other than the one in use answered and became the configured one. */
  onSwitched?: (model: ChatModel) => void;
}

/**
 * Runs `run` with `model`, then with each other configured model while it keeps failing.
 * Without a failover it is a plain call. When every model fails the default is restored and the first error is thrown.
 */
export async function runWithFailover<T>(
  model: ChatModel,
  run: (model: ChatModel) => Promise<T>,
  options: FailoverRunOptions,
): Promise<T> {
  const failover = model.failover;
  if (!failover) return run(model);
  let firstError: unknown;
  let inUse = model;
  for (const candidate of failover.attemptOrder()) {
    if (candidate !== inUse) {
      options.onSwitch?.(candidate);
      inUse = candidate;
    }
    try {
      const result = await run(candidate);
      if (await failover.recordSuccess(candidate)) options.onSwitched?.(candidate);
      return result;
    } catch (error) {
      if (!options.shouldTryNext(error)) throw error;
      firstError ??= error;
      await failover.recordFailure(candidate);
    }
  }
  const fallback = failover.restoreDefault();
  if (fallback !== inUse) options.onSwitch?.(fallback);
  throw firstError;
}
