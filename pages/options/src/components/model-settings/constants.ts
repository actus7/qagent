import { ProviderTypeEnum } from '@extension/storage';

export const PARAMETER_SAVE_DEBOUNCE_MS = 250;
export const MIN_REQUESTS_PER_MINUTE = 1;
export const MAX_REQUESTS_PER_MINUTE = 600;
export const PROVIDER_SCROLL_DELAY_MS = 100;

/** Provider types that need a Base URL before they can be saved. */
export const BASE_URL_PROVIDER_TYPES: readonly ProviderTypeEnum[] = [
  ProviderTypeEnum.CustomOpenAI,
  ProviderTypeEnum.Ollama,
  ProviderTypeEnum.AzureOpenAI,
  ProviderTypeEnum.OpenRouter,
  ProviderTypeEnum.Llama,
];

export const SECTION_CARD_CLASS = 'rounded-lg border border-border bg-card p-6 text-left shadow-sm';
export const PANEL_CLASS = 'rounded-lg border border-border bg-muted p-4';
export const FIELD_LABEL_CLASS = 'w-20 text-sm font-medium text-foreground';
export const SELECT_CLASS = 'flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground';
export const TEXT_INPUT_CLASS =
  'rounded-md border border-input bg-card p-2 text-sm text-foreground outline-none focus:border-border focus:ring-2 focus:ring-ring';
export const TAG_CONTAINER_CLASS =
  'flex min-h-[42px] flex-wrap items-center gap-2 rounded-md border border-input bg-card p-2 text-foreground';
export const TAG_CHIP_CLASS = 'flex items-center rounded-full bg-muted px-2 py-1 text-sm text-primary';
export const TAG_INPUT_CLASS =
  'min-w-[150px] flex-1 border-none bg-transparent p-1 text-sm text-foreground outline-none';
export const NUMBER_INPUT_CLASS =
  'w-20 rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground focus:border-border focus:ring-2 focus:ring-ring';
