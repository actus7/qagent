import { useEffect, useState } from 'react';
import { speechToTextModelStore } from '@extension/storage';

export function useSpeechToTextSettings() {
  const [selectedSpeechToTextModel, setSelectedSpeechToTextModel] = useState<string>('');

  useEffect(() => {
    const loadSpeechToTextModel = async () => {
      try {
        const config = await speechToTextModelStore.getSpeechToTextModel();
        if (config) {
          setSelectedSpeechToTextModel(`${config.provider}>${config.modelName}`);
        }
      } catch (error) {
        console.error('Error loading speech-to-text model:', error);
      }
    };
    void loadSpeechToTextModel();
  }, []);

  const handleSpeechToTextModelChange = async (modelValue: string) => {
    setSelectedSpeechToTextModel(modelValue);
    try {
      if (modelValue) {
        const [provider, modelName] = modelValue.split('>');
        await speechToTextModelStore.setSpeechToTextModel({ provider, modelName });
      } else {
        await speechToTextModelStore.resetSpeechToTextModel();
      }
    } catch (error) {
      console.error('Error saving speech-to-text model:', error);
    }
  };

  return { selectedSpeechToTextModel, handleSpeechToTextModelChange };
}
