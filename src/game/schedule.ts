/**
 * Which generation you face in each round. Two generations a round while its speed limit is still
 * rising (roughly the first thirty), then three long jumps once it is at full speed and gains are small.
 */
export const ROUND_GENS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 34, 60, 300];
export const LAST_GEN = ROUND_GENS[ROUND_GENS.length - 1];
export const ROUNDS = ROUND_GENS.length;
/** Rounds count from 1. */
export const genForRound = (round: number) => ROUND_GENS[Math.max(1, Math.min(round, ROUNDS)) - 1];
