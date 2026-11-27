const known = value => value !== undefined && value !== null && String(value).trim() !== '';

export function reviewGroup(key, detected, current = {}) {
  if (known(detected[key])) return 'detected';
  if (known(current[key])) return 'preserved';
  return 'missing';
}
