import { t } from '@extension/i18n';
import { AgentNameEnum, normalizeReasoningEffort } from '@extension/storage';
import type { ReasoningEffort } from '@extension/storage';
import { MAX_REQUESTS_PER_MINUTE, MIN_REQUESTS_PER_MINUTE, PANEL_CLASS, SELECT_CLASS } from './constants';
import { ModelOptions } from './ModelOptions';
import { ParameterSlider } from './ParameterSlider';
import { getDefaultReasoningEffort, isAnthropicModel, isOpenAIReasoningModel } from './modelUtils';
import type { AgentModelParameters, AvailableModel, ParameterChangeOptions, ParameterName } from './types';

interface AgentModelSelectorProps {
  agentName: AgentNameEnum;
  availableModels: AvailableModel[];
  selectedModel: string;
  parameters: AgentModelParameters;
  reasoningEffort: ReasoningEffort | undefined;
  onModelChange: (modelValue: string) => void;
  onParameterChange: (paramName: ParameterName, value: number, options?: ParameterChangeOptions) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
}

function getAgentDescription(agentName: AgentNameEnum): string {
  switch (agentName) {
    case AgentNameEnum.Navigator:
      return t('options_models_agents_navigator');
    case AgentNameEnum.Planner:
      return t('options_models_agents_planner');
    default:
      return '';
  }
}

/** Model picker plus the parameter controls that apply to the selected model. */
export function AgentModelSelector({
  agentName,
  availableModels,
  selectedModel,
  parameters,
  reasoningEffort,
  onModelChange,
  onParameterChange,
  onReasoningEffortChange,
}: AgentModelSelectorProps) {
  const hasModel = Boolean(selectedModel);
  const isReasoningModel = hasModel && isOpenAIReasoningModel(selectedModel);
  const showTopP = hasModel && !isReasoningModel && !isAnthropicModel(selectedModel);

  return (
    <div className={PANEL_CLASS}>
      <h3 className="mb-2 text-lg font-medium text-foreground">
        {agentName.charAt(0).toUpperCase() + agentName.slice(1)}
      </h3>
      <p className="mb-4 text-sm font-normal text-muted-foreground">{getAgentDescription(agentName)}</p>

      <div className="space-y-4">
        <div className="flex items-center">
          <label htmlFor={`${agentName}-model`} className="w-24 text-sm font-medium text-foreground">
            {t('options_models_labels_model')}
          </label>
          <select
            id={`${agentName}-model`}
            className={SELECT_CLASS}
            disabled={availableModels.length === 0}
            value={selectedModel || ''}
            onChange={e => onModelChange(e.target.value)}>
            <option key="default" value="">
              {t('options_models_chooseModel')}
            </option>
            <ModelOptions models={availableModels} />
          </select>
        </div>

        {hasModel && (
          <div className="flex items-center">
            <label htmlFor={`${agentName}-rpm`} className="w-24 text-sm font-medium text-foreground">
              {t('options_models_labels_rpm')}
            </label>
            <div className="flex flex-1 items-center space-x-2">
              <input
                id={`${agentName}-rpm`}
                type="number"
                min={MIN_REQUESTS_PER_MINUTE}
                max={MAX_REQUESTS_PER_MINUTE}
                step="1"
                value={parameters.requestsPerMinute}
                onChange={e => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(value) && value >= MIN_REQUESTS_PER_MINUTE && value <= MAX_REQUESTS_PER_MINUTE) {
                    onParameterChange('requestsPerMinute', value, { debounceMs: 0 });
                  }
                }}
                className="w-24 rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground focus:border-border focus:ring-2 focus:ring-ring"
                aria-label={t('options_models_aria_requestsPerMinuteInput', [agentName])}
              />
              <span className="text-xs text-muted-foreground">{t('options_models_labels_requestsPerMinuteUnit')}</span>
            </div>
          </div>
        )}

        {hasModel && !isReasoningModel && (
          <ParameterSlider
            id={`${agentName}-temperature`}
            label={t('options_models_labels_temperature')}
            value={parameters.temperature}
            min={0}
            max={2}
            step={0.01}
            decimals={2}
            numberAriaLabel={t('options_models_aria_temperatureInput', [agentName])}
            onChange={(value, options) => onParameterChange('temperature', value, options)}
          />
        )}

        {showTopP && (
          <ParameterSlider
            id={`${agentName}-topP`}
            label={t('options_models_labels_topP')}
            value={parameters.topP}
            min={0}
            max={1}
            step={0.001}
            decimals={3}
            numberAriaLabel={t('options_models_aria_topPInput', [agentName])}
            onChange={(value, options) => onParameterChange('topP', value, options)}
          />
        )}

        {isReasoningModel && (
          <div className="flex items-center">
            <label htmlFor={`${agentName}-reasoning-effort`} className="w-24 text-sm font-medium text-foreground">
              {t('options_models_labels_reasoning')}
            </label>
            <div className="flex flex-1 items-center space-x-2">
              <select
                id={`${agentName}-reasoning-effort`}
                value={reasoningEffort || getDefaultReasoningEffort(agentName)}
                onChange={e => onReasoningEffortChange(normalizeReasoningEffort(e.target.value) || 'minimal')}
                className={SELECT_CLASS}>
                <option value="minimal">{t('options_models_labels_reasoningEffort_minimal')}</option>
                <option value="low">{t('options_models_labels_reasoningEffort_low')}</option>
                <option value="medium">{t('options_models_labels_reasoningEffort_medium')}</option>
                <option value="high">{t('options_models_labels_reasoningEffort_high')}</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
