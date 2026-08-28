import { CandidateResult } from '../candidate-search/candidate-search.types';

/** Where a candidate's ETA figure actually came from — never left ambiguous. */
export enum EtaSource {
  /** Real road-network ETA from the routing provider. */
  ROUTING = 'routing',
  /**
   * Routing was unavailable or failed for this candidate, so a
   * straight-line-distance estimate was used instead. This is never
   * presented as if it were a routing result — see the ranking service's
   * fallback-formula doc comment for why, and dispatch logs always
   * carry this alongside the number.
   */
  FALLBACK_DISTANCE = 'fallback_distance',
}

export interface RankedCandidate extends CandidateResult {
  etaMinutes: number;
  etaSource: EtaSource;
}

export interface RankingOutcome {
  ranked: RankedCandidate[];
  /** How many real routing-API calls were made for this ranking run. */
  routingCallsMade: number;
  /** How many of those calls failed or returned no route. */
  routingFailures: number;
  /** True if any candidate in this run had to use the fallback ETA. */
  fallbackUsed: boolean;
}
