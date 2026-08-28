import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new client.Registry();

  readonly httpRequestsTotal = new client.Counter({
    name: 'ryda_http_requests_total',
    help: 'Total HTTP requests, labeled by method/route/status',
    labelNames: ['method', 'route', 'status'] as const,
  });

  readonly httpRequestDurationSeconds = new client.Histogram({
    name: 'ryda_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  });

  readonly rideRequestsTotal = new client.Counter({
    name: 'ryda_ride_requests_total',
    help: 'Total ride requests created, labeled by category',
    labelNames: ['category'] as const,
  });

  readonly rideCompletionsTotal = new client.Counter({
    name: 'ryda_ride_completions_total',
    help: 'Total rides completed, labeled by payment method',
    labelNames: ['paymentMethod'] as const,
  });

  readonly rideCancellationsTotal = new client.Counter({
    name: 'ryda_ride_cancellations_total',
    help: 'Total rides cancelled, labeled by who cancelled',
    labelNames: ['cancelledBy'] as const,
  });

  readonly dispatchOffersTotal = new client.Counter({
    name: 'ryda_dispatch_offers_total',
    help: 'Total smart-dispatch offers created',
  });

  readonly etaCalculationDurationSeconds = new client.Histogram({
    name: 'ryda_eta_calculation_duration_seconds',
    help: 'Latency of a single routing-API ETA calculation during driver ranking',
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  });

  readonly rankingCandidateCount = new client.Histogram({
    name: 'ryda_ranking_candidate_count',
    help: 'Number of eligible candidates handed to the ranking layer for a dispatch',
    buckets: [0, 1, 2, 3, 5, 8, 10, 20, 50],
  });

  readonly rankingRankedCount = new client.Histogram({
    name: 'ryda_ranking_ranked_count',
    help: 'Number of candidates the ranking layer actually returned, ranked, for a dispatch',
    buckets: [0, 1, 2, 3, 5, 8, 10, 20, 50],
  });

  readonly rankingRoutingFailuresTotal = new client.Counter({
    name: 'ryda_ranking_routing_failures_total',
    help: 'Total routing-API calls that failed or returned no result during ranking',
  });

  readonly rankingFallbackUsedTotal = new client.Counter({
    name: 'ryda_ranking_fallback_used_total',
    help: 'Total ranking runs that fell back to distance-based ETA estimate for at least one candidate',
  });

  readonly autoDispatchOffersTotal = new client.Counter({
    name: 'ryda_auto_dispatch_offers_total',
    help: 'Total AUTO-mode offers created (initial offer plus every decline/timeout reassignment)',
  });

  readonly autoDispatchReassignmentsTotal = new client.Counter({
    name: 'ryda_auto_dispatch_reassignments_total',
    help: 'Total times AUTO dispatch moved on to the next candidate, labeled by why',
    labelNames: ['reason'] as const, // 'declined' | 'expired'
  });

  readonly autoDispatchNoDriverFoundTotal = new client.Counter({
    name: 'ryda_auto_dispatch_no_driver_found_total',
    help: 'Total AUTO rides that exhausted the candidate pool up to the max radius with no eligible driver found',
  });

  readonly autoDispatchRadiusExpansionTotal = new client.Counter({
    name: 'ryda_auto_dispatch_radius_expansion_total',
    help: 'Total AUTO dispatch search rounds that needed to expand beyond the initial radius to find a candidate',
  });

  readonly walletTransactionsTotal = new client.Counter({
    name: 'ryda_wallet_transactions_total',
    help: 'Total wallet transactions, labeled by direction and category',
    labelNames: ['direction', 'category'] as const,
  });

  // ---- Batch 9: production-hardening observability additions ----
  // These fill the gaps against the requested metric list that weren't
  // already covered by an existing metric above. Where an existing
  // metric already covers a requested name (e.g. eta_calculation_latency
  // -> etaCalculationDurationSeconds, radius_expansion_rate ->
  // autoDispatchRadiusExpansionTotal for AUTO, plus
  // candidateSearchRadiusExpansionTotal below for MANUAL/courier too),
  // that mapping is called out in the batch 9 report rather than
  // duplicated here. "_rate" names throughout are deliberately exposed
  // as raw counters, not pre-computed ratios — this project always rates
  // things via PromQL over counters (see rankingFallbackUsedTotal,
  // autoDispatchNoDriverFoundTotal), consistent with normal Prometheus
  // practice; a service-side ratio gauge would just be a second,
  // divergence-prone source of truth for the same number.

  readonly driverLocationUpdatesTotal = new client.Counter({
    name: 'ryda_driver_location_updates_total',
    help: 'Total driver GPS location updates received. Rate this over time for driver_location_updates_per_second.',
  });

  readonly availableDriverCount = new client.Gauge({
    name: 'ryda_available_driver_count',
    help: 'Current number of drivers in the live geospatial index (ONLINE, approved, fresh GPS) — sampled periodically from Redis GEO, not a full Postgres scan.',
  });

  readonly candidateSearchDurationSeconds = new client.Histogram({
    name: 'ryda_candidate_search_duration_seconds',
    help: 'Latency of a full CandidateSearchService.search() call (all progressive-radius rounds), labeled by domain and mode',
    labelNames: ['domain', 'mode'] as const,
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  });

  readonly candidateSearchCandidateCount = new client.Histogram({
    name: 'ryda_candidate_search_candidate_count',
    help: 'Number of eligible candidates CandidateSearchService.search() returned, labeled by domain and mode — recorded for every call, not just ones that go on to ranking',
    labelNames: ['domain', 'mode'] as const,
    buckets: [0, 1, 2, 3, 5, 8, 10, 20, 50],
  });

  readonly candidateSearchRadiusExpansionTotal = new client.Counter({
    name: 'ryda_candidate_search_radius_expansion_total',
    help: 'Total CandidateSearchService.search() calls that needed to expand beyond the initial radius, labeled by domain and mode — covers MANUAL and courier too, not just AUTO (see autoDispatchRadiusExpansionTotal for the AUTO-specific equivalent)',
    labelNames: ['domain', 'mode'] as const,
  });

  readonly dispatchLatencySeconds = new client.Histogram({
    name: 'ryda_dispatch_latency_seconds',
    help: 'End-to-end latency of a dispatch step (search + rank + offer/notify), labeled by domain and mode. domain=ride,mode=manual is manual_selection_time; domain=ride,mode=auto is a single AUTO offer step; domain=courier is the courier notify step.',
    labelNames: ['domain', 'mode'] as const,
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  });

  readonly autoDispatchOffersAcceptedTotal = new client.Counter({
    name: 'ryda_auto_dispatch_offers_accepted_total',
    help: 'Total AUTO-mode rides that reached ACCEPTED. Divide by autoDispatchOffersTotal for auto_offer_accept_rate.',
  });

  readonly dispatchOfferTimeoutsTotal = new client.Counter({
    name: 'ryda_dispatch_offer_timeouts_total',
    help: 'Total ride offers (MANUAL or AUTO) that expired unanswered. Divide by dispatchOffersTotal for offer_timeout_rate.',
  });

  readonly courierDispatchNoDriverFoundTotal = new client.Counter({
    name: 'ryda_courier_dispatch_no_driver_found_total',
    help: 'Total delivery requests for which the shared candidate engine found zero eligible drivers up to the max search radius. Divide by delivery request count for courier_no_driver_rate.',
  });

  onModuleInit() {
    client.collectDefaultMetrics({ register: this.registry });
    this.registry.registerMetric(this.httpRequestsTotal);
    this.registry.registerMetric(this.httpRequestDurationSeconds);
    this.registry.registerMetric(this.rideRequestsTotal);
    this.registry.registerMetric(this.rideCompletionsTotal);
    this.registry.registerMetric(this.rideCancellationsTotal);
    this.registry.registerMetric(this.dispatchOffersTotal);
    this.registry.registerMetric(this.etaCalculationDurationSeconds);
    this.registry.registerMetric(this.rankingCandidateCount);
    this.registry.registerMetric(this.rankingRankedCount);
    this.registry.registerMetric(this.rankingRoutingFailuresTotal);
    this.registry.registerMetric(this.rankingFallbackUsedTotal);
    this.registry.registerMetric(this.autoDispatchOffersTotal);
    this.registry.registerMetric(this.autoDispatchReassignmentsTotal);
    this.registry.registerMetric(this.autoDispatchNoDriverFoundTotal);
    this.registry.registerMetric(this.autoDispatchRadiusExpansionTotal);
    this.registry.registerMetric(this.walletTransactionsTotal);
    this.registry.registerMetric(this.driverLocationUpdatesTotal);
    this.registry.registerMetric(this.availableDriverCount);
    this.registry.registerMetric(this.candidateSearchDurationSeconds);
    this.registry.registerMetric(this.candidateSearchCandidateCount);
    this.registry.registerMetric(this.candidateSearchRadiusExpansionTotal);
    this.registry.registerMetric(this.dispatchLatencySeconds);
    this.registry.registerMetric(this.autoDispatchOffersAcceptedTotal);
    this.registry.registerMetric(this.dispatchOfferTimeoutsTotal);
    this.registry.registerMetric(this.courierDispatchNoDriverFoundTotal);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
