export const ATTRIBUTES = ['str', 'dex', 'int', 'luk'];

export const COMBAT_FIELDS = [
  { key: 'currentHp', label: 'HP actual' },
  { key: 'maxHp', label: 'HP máximo' },
  { key: 'currentMp', label: 'MP actual' },
  { key: 'maxMp', label: 'MP máximo' },
  { key: 'attackMin', label: 'Attack mínimo' },
  { key: 'attackMax', label: 'Attack máximo' },
  { key: 'weaponDefense', label: 'Weapon Def.' },
  { key: 'magicAttack', label: 'Magic' },
  { key: 'magicDefense', label: 'Magic Def.' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'avoidability', label: 'Evasion' },
  { key: 'critRate', label: 'Crit. Rate (%)', type: 'decimal' },
  { key: 'critDamage', label: 'Crit. Damage (%)', type: 'decimal' },
  { key: 'speed', label: 'Speed (%)', type: 'decimal' },
  { key: 'jump', label: 'Jump (%)', type: 'decimal' },
  { key: 'weaponAttack', label: 'Weapon Attack del arma' }
];

export const PROGRESS_FIELDS = [
  { key: 'exp', label: 'EXP actual' },
  { key: 'expPercent', label: 'EXP (%)', type: 'decimal' },
  { key: 'mesos', label: 'Mesos' }
];

export const CHARACTER_FIELDS = [
  { key: 'name', label: 'Nombre del personaje', type: 'text' },
  { key: 'job', label: 'Job y especialización', type: 'text' },
  { key: 'level', label: 'Nivel', min: 1 },
  { key: 'fame', label: 'Fame', min: -Number.MAX_SAFE_INTEGER },
  { key: 'apAvailable', label: 'AP libres' },
  ...PROGRESS_FIELDS,
  ...ATTRIBUTES.flatMap(key => [
    { key, label: `${key.toUpperCase()} base` },
    { key: `${key}Total`, label: `${key.toUpperCase()} mostrado` }
  ]),
  ...COMBAT_FIELDS
];
