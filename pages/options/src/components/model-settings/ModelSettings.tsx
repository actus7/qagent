import { AgentModelsSection } from './AgentModelsSection';
import { ProviderSection } from './ProviderSection';
import { SpeechToTextSection } from './SpeechToTextSection';
import { useAgentModelSettings } from './useAgentModelSettings';
import { useProviderSettings } from './useProviderSettings';
import { useSpeechToTextSettings } from './useSpeechToTextSettings';

/** Options page "Models" tab: providers, per-agent model selection, and speech-to-text. */
export const ModelSettings = () => {
  const agentSettings = useAgentModelSettings();
  const providerSettings = useProviderSettings({ onAgentModelsReset: agentSettings.reloadAgentModels });
  const speechToText = useSpeechToTextSettings();

  return (
    <section className="space-y-6">
      <ProviderSection settings={providerSettings} />

      <AgentModelsSection availableModels={providerSettings.availableModels} agentSettings={agentSettings} />

      <SpeechToTextSection
        selectedModel={speechToText.selectedSpeechToTextModel}
        availableModels={providerSettings.availableModels}
        providers={providerSettings.providers}
        onModelChange={speechToText.handleSpeechToTextModelChange}
      />
    </section>
  );
};
