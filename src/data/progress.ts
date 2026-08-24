export type ProgressKind = 'goal' | 'constraint' | 'bet' | 'habit' | 'meaningful';

export const currentCycle = {
  label: 'August–September 2026',
  goals: [
    'Launch picturesuo.com with the complete writing archive.',
    'Publish one new, substantial piece after launch.',
  ],
  constraints: [
    'Keep ordinary site maintenance under 150 minutes per week.',
    'Never publish a private note, raw card, or real-time location automatically.',
  ],
};

export const progressItems: Array<{
  date: string;
  kind: ProgressKind;
  label: string;
  href?: string;
}> = [
  {
    date: '2026-08-23',
    kind: 'goal',
    label: 'Started the durable Picturesuo rebuild.',
  },
  {
    date: '2026-08-23',
    kind: 'constraint',
    label: 'Separated private reflection from public publishing.',
  },
  {
    date: '2026-08-23',
    kind: 'bet',
    label: 'Testing whether a public work archive creates useful opportunities.',
  },
];

export const progressLegend: Array<{ kind: ProgressKind; label: string; description: string }> = [
  { kind: 'goal', label: 'Goal work', description: 'Time advancing a defined outcome.' },
  {
    kind: 'constraint',
    label: 'Constraint',
    description: 'A boundary protecting time, privacy, or health.',
  },
  {
    kind: 'bet',
    label: 'Opportunity bet',
    description: 'A capped experiment with uncertain upside.',
  },
  { kind: 'habit', label: 'Maintenance', description: 'Small actions that keep life working.' },
  {
    kind: 'meaningful',
    label: 'Meaningful life',
    description: 'People, places, art, and moments worth remembering.',
  },
];
