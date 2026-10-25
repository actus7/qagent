// ARIA and native state of an element, shortened to the flags an LLM needs to decide what to do next.

export type AttributeBag = Record<string, string | null | undefined>;

const TRUE = 'true';

/**
 * Flags for the state an element is in. Native attributes (disabled, required) count too, so a plain
 * <button disabled> reads the same as <button aria-disabled="true">.
 * An attribute that is absent yields no flag; an explicit "false" never adds one.
 */
export function ariaStateFlags(attributes: AttributeBag, tagName: string | null): string[] {
  const has = (name: string) => attributes[name] !== undefined && attributes[name] !== null;
  const flags: string[] = [];

  if (has('disabled') || attributes['aria-disabled'] === TRUE) flags.push('disabled');
  if (attributes['aria-checked'] === TRUE || (tagName === 'input' && has('checked') && !has('aria-checked'))) {
    flags.push('checked');
  } else if (attributes['aria-checked'] === 'mixed') {
    flags.push('mixed');
  }
  if (attributes['aria-pressed'] === TRUE) flags.push('pressed');
  if (attributes['aria-expanded'] === TRUE) flags.push('expanded');
  else if (attributes['aria-expanded'] === 'false') flags.push('collapsed');
  if (attributes['aria-selected'] === TRUE) flags.push('selected');
  if (attributes['aria-current'] && attributes['aria-current'] !== 'false') flags.push('current');
  if (has('required') || attributes['aria-required'] === TRUE) flags.push('required');
  if (attributes['aria-invalid'] === TRUE) flags.push('invalid');
  if (attributes['aria-busy'] === TRUE) flags.push('busy');

  return flags;
}

/** Renders the flags as one compact token: `state=disabled,expanded`, or an empty string when there are none. */
export function formatAriaState(flags: string[]): string {
  return flags.length > 0 ? `state=${flags.join(',')}` : '';
}
