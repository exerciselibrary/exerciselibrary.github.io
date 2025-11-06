export const PROGRAM_MODES = [
  { id: 'old-school', label: 'Old School Pump', minKg: 0, maxKg: 200 },
  { id: 'tut', label: 'TUT', minKg: 0, maxKg: 200 },
  { id: 'beast', label: 'Beast', minKg: 0, maxKg: 200 },
  { id: 'eccentric', label: 'Eccentric Only', minKg: 0, maxKg: 200 },
];

export const ECHO_LEVELS = [
  { id: 'hard', label: 'Hard' },
  { id: 'harder', label: 'Harder' },
  { id: 'intense', label: 'Intense' },
  { id: 'heroic', label: 'Heroic' },
  { id: 'epic', label: 'Epic' },
];

export const UNIT_LABELS = {
  kg: 'kg',
  lb: 'lb',
};

export const WEIGHT_LIMITS = {
  minKg: 0,
  maxKg: 200,
  incrementKg: 0.5,
};

export const ECHO_DEFAULT = ECHO_LEVELS[0].id;
export const PROGRAM_DEFAULT = PROGRAM_MODES[0].id;
