import { ATTRIBUTES } from './character-fields.js?v=0.4.4';

const known = value => value !== undefined && value !== null && String(value).trim() !== '';

export function reviewGroup(key, detected, current = {}) {
  if (known(detected[key])) return 'detected';
  if (known(current[key])) return 'preserved';
  if (ATTRIBUTES.includes(key) && known(detected[`${key}Total`] ?? current[`${key}Total`])) return 'base';
  return 'missing';
}
