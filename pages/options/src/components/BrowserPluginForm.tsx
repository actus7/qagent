import { useState } from 'react';
import { browserPluginsStore, parsePlugin, type BrowserPlugin, type PluginTool } from '@extension/storage';
import { Button } from '@extension/ui';
import { t } from '@extension/i18n';
import { isPluginValidationError, toStoredPlugin } from './browserPluginIO';

interface ToolDraft {
  /** Stable React key, so reordering or removing a tool does not reuse another tool's inputs. */
  key: string;
  name: string;
  description: string;
  parameters: string;
  code: string;
}

interface PluginDraft {
  name: string;
  description: string;
  matches: string;
  instructions: string;
  tools: ToolDraft[];
}

interface BrowserPluginFormProps {
  /** The plugin being edited; null creates a new one. */
  plugin: BrowserPlugin | null;
  onDone: () => void;
}

const INPUT_CLASS = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground';
const CODE_CLASS = `${INPUT_CLASS} font-mono text-xs`;
const LABEL_CLASS = 'mb-1 block text-xs font-medium text-foreground';

const newToolDraft = (): ToolDraft => ({
  key: crypto.randomUUID(),
  name: '',
  description: '',
  parameters: '{}',
  code: '',
});

const toolToDraft = (tool: PluginTool): ToolDraft => ({
  key: crypto.randomUUID(),
  name: tool.name,
  description: tool.description,
  parameters: JSON.stringify(tool.parameters, null, 2),
  code: tool.code,
});

const toDraft = (plugin: BrowserPlugin | null): PluginDraft =>
  plugin
    ? {
        name: plugin.name,
        description: plugin.description,
        matches: plugin.matches.join(', '),
        instructions: plugin.instructions,
        tools: plugin.tools.map(toolToDraft),
      }
    : { name: '', description: '', matches: '', instructions: '', tools: [] };

/** Builds the raw object for parsePlugin. Throws SyntaxError when a tool's parameters are not JSON. */
const toRawPlugin = (draft: PluginDraft, plugin: BrowserPlugin | null): unknown => ({
  id: plugin?.id,
  enabled: plugin?.enabled ?? true,
  version: plugin?.version,
  name: draft.name,
  description: draft.description,
  matches: draft.matches
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0),
  instructions: draft.instructions,
  tools: draft.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: JSON.parse(tool.parameters || '{}'),
    code: tool.code,
  })),
});

export const BrowserPluginForm = ({ plugin, onDone }: BrowserPluginFormProps) => {
  const [draft, setDraft] = useState<PluginDraft>(() => toDraft(plugin));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateTool = (index: number, patch: Partial<ToolDraft>) =>
    setDraft(prev => ({
      ...prev,
      tools: prev.tools.map((tool, position) => (position === index ? { ...tool, ...patch } : tool)),
    }));

  const removeTool = (index: number) =>
    setDraft(prev => ({ ...prev, tools: prev.tools.filter((_, position) => position !== index) }));

  const handleSave = async () => {
    setError(null);
    let raw: unknown;
    try {
      raw = toRawPlugin(draft, plugin);
    } catch (parseError) {
      if (!(parseError instanceof SyntaxError)) throw parseError;
      setError(t('options_plugins_error_invalidParams'));
      return;
    }
    let input;
    try {
      input = parsePlugin(raw);
    } catch (validationError) {
      if (!isPluginValidationError(validationError)) throw validationError;
      setError(t('options_plugins_error_invalid', [validationError.message]));
      return;
    }
    setSaving(true);
    try {
      await browserPluginsStore.save(toStoredPlugin(input, plugin));
      onDone();
    } catch (saveError) {
      console.error('Failed to save browser plugin:', saveError);
      setError(t('options_plugins_error_saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-6 text-left shadow-xs">
        <h2 className="mb-4 text-xl font-semibold text-foreground">
          {plugin ? t('options_plugins_form_titleEdit') : t('options_plugins_form_titleNew')}
        </h2>

        <div className="space-y-4">
          <label className="block">
            <span className={LABEL_CLASS}>{t('options_plugins_form_name')}</span>
            <input
              className={INPUT_CLASS}
              value={draft.name}
              onChange={event => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t('options_plugins_form_description')}</span>
            <input
              className={INPUT_CLASS}
              value={draft.description}
              onChange={event => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t('options_plugins_form_matches')}</span>
            <input
              className={INPUT_CLASS}
              value={draft.matches}
              onChange={event => setDraft({ ...draft, matches: event.target.value })}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t('options_plugins_form_matchesHint')}</span>
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t('options_plugins_form_instructions')}</span>
            <textarea
              className={INPUT_CLASS}
              rows={3}
              value={draft.instructions}
              onChange={event => setDraft({ ...draft, instructions: event.target.value })}
            />
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t('options_plugins_form_toolsHeader')}</h3>
              <Button
                size="compact"
                onClick={() => setDraft({ ...draft, tools: [...draft.tools, newToolDraft()] })}
                className="bg-secondary px-3 py-1.5 text-xs text-foreground">
                {t('options_plugins_btnAddTool')}
              </Button>
            </div>
            {draft.tools.map((tool, index) => (
              <div key={tool.key} className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
                <label className="block">
                  <span className={LABEL_CLASS}>{t('options_plugins_form_toolName')}</span>
                  <input
                    className={INPUT_CLASS}
                    value={tool.name}
                    onChange={event => updateTool(index, { name: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className={LABEL_CLASS}>{t('options_plugins_form_toolDescription')}</span>
                  <input
                    className={INPUT_CLASS}
                    value={tool.description}
                    onChange={event => updateTool(index, { description: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className={LABEL_CLASS}>{t('options_plugins_form_toolParams')}</span>
                  <textarea
                    className={CODE_CLASS}
                    rows={4}
                    value={tool.parameters}
                    onChange={event => updateTool(index, { parameters: event.target.value })}
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t('options_plugins_form_toolParamsHint')}
                  </span>
                </label>
                <label className="block">
                  <span className={LABEL_CLASS}>{t('options_plugins_form_toolCode')}</span>
                  <textarea
                    className={CODE_CLASS}
                    rows={6}
                    value={tool.code}
                    onChange={event => updateTool(index, { code: event.target.value })}
                  />
                </label>
                <div className="flex justify-end">
                  <Button
                    size="compact"
                    onClick={() => removeTool(index)}
                    className="bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:opacity-90">
                    {t('options_plugins_btnRemoveTool')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button size="compact" onClick={onDone} className="bg-secondary px-4 py-2 text-sm text-foreground">
            {t('options_plugins_btnCancel')}
          </Button>
          <Button
            size="compact"
            disabled={saving}
            onClick={() => void handleSave()}
            className="bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">
            {t('options_plugins_btnSave')}
          </Button>
        </div>
      </div>
    </section>
  );
};
