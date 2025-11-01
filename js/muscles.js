// Utilities and canonical data for mapping muscle names.

export function normalizeMuscleName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const MUSCLE_COVERAGE = [
  { key: 'abductors', label: 'Abductors', aliases: ['abductor', 'abductors', 'hip abductors', 'gluteus medius', 'gluteus minimus'] },
  { key: 'biceps', label: 'Biceps', aliases: ['biceps', 'bicep', 'biceps brachii'] },
  { key: 'calves', label: 'Calves', aliases: ['calf', 'calves', 'gastrocnemius', 'soleus'] },
  { key: 'chest', label: 'Chest', aliases: ['chest', 'pectoralis', 'pectoralis major', 'pecs', 'pectoral'] },
  { key: 'core', label: 'Core', aliases: ['core', 'abs', 'abdominals', 'rectus abdominis', 'transverse abdominis', 'transversus abdominis'] },
  { key: 'forearms', label: 'Forearms', aliases: ['forearm', 'forearms', 'brachioradialis', 'pronator', 'supinator', 'wrist flexors', 'wrist extensors'] },
  { key: 'glutes', label: 'Glutes', aliases: ['glutes', 'glute', 'gluteus', 'gluteus maximus', 'gluteus medius', 'gluteus minimus'] },
  { key: 'hamstrings', label: 'Hamstrings', aliases: ['hamstring', 'hamstrings', 'biceps femoris', 'semimembranosus', 'semitendinosus'] },
  { key: 'lats', label: 'Lats', aliases: ['lats', 'lat', 'latissimus', 'latissimus dorsi'] },
  { key: 'lower_back', label: 'Lower Back', aliases: ['lower back', 'lower_back', 'lumbar', 'erector spinae', 'spinal erectors'] },
  { key: 'obliques', label: 'Obliques', aliases: ['oblique', 'obliques', 'internal oblique', 'external oblique', 'serratus', 'serratus anterior'] },
  { key: 'quads', label: 'Quads', aliases: ['quad', 'quads', 'quadriceps', 'vastus', 'rectus femoris'] },
  { key: 'shoulders', label: 'Shoulders', aliases: ['shoulder', 'shoulders', 'delts', 'deltoids', 'anterior deltoid', 'lateral deltoid', 'posterior deltoid'] },
  { key: 'traps', label: 'Traps', aliases: ['traps', 'trap', 'trapezius', 'upper trapezius'] },
  { key: 'triceps', label: 'Triceps', aliases: ['triceps', 'tricep', 'triceps brachii'] },
  { key: 'upper_back', label: 'Upper Back', aliases: ['upper back', 'upper_back', 'upper-back', 'upperback', 'middle back', 'mid back', 'rhomboids', 'rhomboid', 'teres major', 'teres minor'] }
];

export const MUSCLE_ALIAS_LOOKUP = (() => {
  const map = new Map();
  MUSCLE_COVERAGE.forEach((group) => {
    group.aliases.forEach((alias) => {
      map.set(normalizeMuscleName(alias), group.key);
    });
  });
  return map;
})();
