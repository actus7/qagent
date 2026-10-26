import { t } from '@extension/i18n';
import { AgentNameEnum } from '@extension/storage';
import { AgentModelSelector } from './AgentModelSelector';
import { SECTION_CARD_CLASS } from './constants';
import type { AgentModelSettings } from './useAgentModelSettings';
import type { AvailableModel, CatalogProviderEntry } from './types';

interface AgentModelsSectionProps {
  availableModels: AvailableModel[];
  catalogProviders: CatalogProviderEntry[];
  onLoadCatalog: (providerId: string) => Promise<number>;
  agentSettings: AgentModelSettings;
}

/** "Agent models" card: one selector per agent (Planner, then Navigator). */
export function AgentModelsSection({
  availableModels,
  catalogProviders,
  onLoadCatalog,
  agentSettings,
}: AgentModelsSectionProps) {
  const { selectedModels, modelParameters, reasoningEffort } = agentSettings;

  return (
    <div className={SECTION_CARD_CLASS}>
      <h2 className="mb-4 text-left text-xl font-semibold text-foreground">{t('options_models_selection_header')}</h2>
      <div className="space-y-4">
        {[AgentNameEnum.Planner, AgentNameEnum.Navigator].map(agentName => (
          <div key={agentName}>
            <AgentModelSelector
              agentName={agentName}
              availableModels={availableModels}
              catalogProviders={catalogProviders}
              onLoadCatalog={onLoadCatalog}
              selectedModel={selectedModels[agentName]}
              parameters={modelParameters[agentName]}
              reasoningEffort={reasoningEffort[agentName]}
              onModelChange={modelValue => agentSettings.handleModelChange(agentName, modelValue)}
              onParameterChange={(paramName, value, options) =>
                agentSettings.handleParameterChange(agentName, paramName, value, options)
              }
              onReasoningEffortChange={value => agentSettings.handleReasoningEffortChange(agentName, value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
