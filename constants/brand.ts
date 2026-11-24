/**
 * SWISHFlip commercial identity contract. Keep this in step with
 * SwishWeb-v2/src/lib/swishflipBrand.ts; it is visual only and never grants
 * a workspace or subscription entitlement.
 */
export const SWISHFLIP = {
  name: 'SWISHFlip',
  descriptor: 'The intelligent reseller platform.',
  slogan: "Turn what you have into what it's worth.",
  secondarySlogan: 'One platform. Every kind of reseller.',
  intelligence: 'Powered by SWISH AI.',
  colors: {
    midnight: '#071C26',
    deepOcean: '#102D39',
    gold: '#F4C65D',
    teal: '#19B5AC',
    arctic: '#F5F8FA',
    steel: '#91A6B2',
    success: '#36B37E',
    warning: '#E6A700',
    danger: '#D94B4B',
  },
} as const;

/** Existing niche IDs remain canonical; these accents are presentation only. */
export const NICHE_ACCENTS: Record<string, string> = {
  coins: '#D7A940',
  tunes_flip: '#A76EE8',
  antiques: '#D78B42',
  clothing: '#D6649D',
  tech: '#3C9FD6',
  trading_cards: '#8D72D8',
  bicycles: '#4DBD84',
  motocross: '#DF7654',
  fossils: '#48B8B0',
  beauty: '#D76A82',
  stamps: '#5DB7A0',
  collectibles: '#D68A4F',
  surplus_flip: '#19B5AC',
};
