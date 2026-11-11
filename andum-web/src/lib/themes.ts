export type ThemeId = 'none' | 'confetti' | 'gift' | 'balloons' | 'hearts' | 'gold'

export const THEMES: Array<{ id: ThemeId; n: string }> = [
  { id: 'none', n: 'Plain' },
  { id: 'confetti', n: 'Celebrate' },
  { id: 'gift', n: 'Surprise' },
  { id: 'balloons', n: 'Balloons' },
  { id: 'hearts', n: 'Thank you' },
  { id: 'gold', n: 'Milestone' },
]

export const THEME_TINT: Record<ThemeId, string> = {
  confetti: 'rgba(111,227,193,.24)',
  gift: 'rgba(141,177,255,.26)',
  balloons: 'rgba(242,139,147,.22)',
  hearts: 'rgba(242,139,147,.24)',
  gold: 'rgba(242,182,97,.26)',
  none: 'rgba(255,255,255,.06)',
}
