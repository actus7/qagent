import { describe, it, expect } from 'vitest';
import {
  cropRectFromSelection,
  fitWithin,
  filterMentionTabs,
  filterSlashItems,
  findActiveTrigger,
  parseSlashCommand,
  replaceTrigger,
  slugifyCommand,
  type SlashCommandItem,
} from '@extension/shared';

describe('image downscale sizing', () => {
  it('scales the longest side down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(3136, 1568, 1568)).toEqual({ width: 1568, height: 784 });
    expect(fitWithin(1000, 4000, 1568)).toEqual({ width: 392, height: 1568 });
  });

  it('never upscales small images', () => {
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });
});

describe('screenshot crop mapping', () => {
  const display = { width: 500, height: 250 };
  const natural = { width: 1000, height: 500 };

  it('maps a selection on the displayed image to natural pixels', () => {
    expect(cropRectFromSelection({ x: 50, y: 25, width: 100, height: 50 }, display, natural)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
  });

  it('normalises a selection dragged up and to the left', () => {
    expect(cropRectFromSelection({ x: 150, y: 75, width: -100, height: -50 }, display, natural)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
  });

  it('returns null for a click without a drag (full screenshot)', () => {
    expect(cropRectFromSelection({ x: 10, y: 10, width: 0, height: 0 }, display, natural)).toBeNull();
  });

  it('clamps the selection to the image bounds', () => {
    expect(cropRectFromSelection({ x: 400, y: 200, width: 300, height: 300 }, display, natural)).toEqual({
      x: 800,
      y: 400,
      width: 200,
      height: 100,
    });
  });
});

describe('mention and slash triggers', () => {
  it('opens "@" anywhere a token starts and closes it after a space', () => {
    expect(findActiveTrigger('compare @gith', 13, '@')).toEqual({ start: 8, query: 'gith' });
    expect(findActiveTrigger('compare @github ', 16, '@')).toBeNull();
    expect(findActiveTrigger('mail a@b.com', 12, '@')).toBeNull();
  });

  it('opens "/" only as the first token of the composer', () => {
    expect(findActiveTrigger('/re', 3, '/')).toEqual({ start: 0, query: 're' });
    expect(findActiveTrigger('see /re', 7, '/')).toBeNull();
    expect(findActiveTrigger('/replay abc', 11, '/')).toBeNull();
  });

  it('replaces the trigger token and moves the caret after the replacement', () => {
    const trigger = findActiveTrigger('open @gh now', 8, '@');
    expect(trigger).not.toBeNull();
    expect(replaceTrigger('open @gh now', 8, trigger!, '@github.com ')).toEqual({
      text: 'open @github.com  now',
      caret: 'open @github.com '.length,
    });
  });

  it('filters tabs by title or host, keeps only http(s), and caps the list', () => {
    const tabs = [
      { id: 1, title: 'GitHub', url: 'https://github.com/x' },
      { id: 2, title: 'Docs', url: 'https://docs.example.org/' },
      { id: 3, title: 'Settings', url: 'chrome://settings' },
    ];
    expect(filterMentionTabs(tabs, 'git').map(tab => tab.id)).toEqual([1]);
    expect(filterMentionTabs(tabs, 'example').map(tab => tab.id)).toEqual([2]);
    expect(filterMentionTabs(tabs, 'settings')).toEqual([]);
    const many = Array.from({ length: 80 }, (_, index) => ({ id: index, title: `t${index}`, url: 'https://a.test/' }));
    expect(filterMentionTabs(many, '')).toHaveLength(50);
  });
});

describe('slash command parsing and filtering', () => {
  it('parses the command name and its argument text', () => {
    expect(parseSlashCommand('/replay   abc-123 ')).toEqual({ name: 'replay', args: 'abc-123' });
    expect(parseSlashCommand('/new')).toEqual({ name: 'new', args: '' });
    expect(parseSlashCommand('hello /new')).toBeNull();
    expect(parseSlashCommand('/')).toBeNull();
  });

  it('slugifies saved prompt titles and falls back when nothing is left', () => {
    expect(slugifyCommand('Teste de Login (Smoke Test)', 'x')).toBe('teste-de-login-smoke-test');
    expect(slugifyCommand('🔐🔐', 'prompt-7')).toBe('prompt-7');
  });

  it('ranks prefix matches before substring matches', () => {
    const items: SlashCommandItem[] = [
      { slug: 'login-smoke', title: 'Login smoke', kind: 'prompt', content: 'a' },
      { slug: 'login', title: 'Login', kind: 'prompt', content: 'b' },
      { slug: 'new', title: 'new', kind: 'builtin' },
    ];
    expect(filterSlashItems(items, 'log').map(item => item.slug)).toEqual(['login', 'login-smoke']);
    expect(filterSlashItems(items, 'ew').map(item => item.slug)).toEqual(['new']);
  });
});
