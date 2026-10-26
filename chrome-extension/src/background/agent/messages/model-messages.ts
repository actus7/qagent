import type {
  AssistantModelMessage,
  FilePart,
  ModelMessage,
  SystemModelMessage,
  TextPart,
  ToolModelMessage,
  UserContent,
  UserModelMessage,
} from 'ai';
import { parseBase64DataUrl } from '@extension/shared';

export type { ModelMessage, UserContent };

/** Tool name used for the agents' own structured output in the conversation history. */
export const AGENT_OUTPUT_TOOL = 'AgentOutput';

export const systemMessage = (content: string): SystemModelMessage => ({ role: 'system', content });
export const userMessage = (content: UserContent): UserModelMessage => ({ role: 'user', content });
export const assistantMessage = (content: string): AssistantModelMessage => ({ role: 'assistant', content });

/** An assistant turn that calls `toolName` with `input`, optionally preceded by text. */
export function assistantToolCall(
  toolName: string,
  toolCallId: string,
  input: unknown,
  text = '',
): AssistantModelMessage {
  return {
    role: 'assistant',
    content: [...(text ? [{ type: 'text' as const, text }] : []), { type: 'tool-call', toolCallId, toolName, input }],
  };
}

export const toolResultMessage = (toolName: string, toolCallId: string, value: string): ToolModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId, toolName, output: { type: 'text', value } }],
});

/** Image from a base64 data URL as a file part; `null` when the URL is not a base64 data URL. */
export function imagePart(dataUrl: string): FilePart | null {
  const parsed = parseBase64DataUrl(dataUrl);
  return parsed ? { type: 'file', mediaType: parsed.mimeType, data: parsed.base64 } : null;
}

export const isImagePart = (part: { type: string; mediaType?: string }): boolean =>
  part.type === 'image' || (part.type === 'file' && (part.mediaType ?? '').startsWith('image'));

/** The text a message carries, with tool calls and results rendered as JSON/text (used for token estimates). */
export function messageText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map(part => {
      if (part.type === 'text') return (part as TextPart).text;
      if (part.type === 'tool-call') return JSON.stringify(part.input);
      if (part.type === 'tool-result')
        return part.output.type === 'text' ? part.output.value : JSON.stringify(part.output);
      return '';
    })
    .join('');
}
