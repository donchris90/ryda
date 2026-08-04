export enum DriverLevel {
  ROOKIE = 'rookie',
  STANDARD = 'standard',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  DIAMOND = 'diamond',
  ELITE = 'elite',
}

// Default commission percent charged to the driver at each level.
// Higher levels earn a lower commission rate as an incentive.
export const DEFAULT_COMMISSION_BY_LEVEL: Record<DriverLevel, number> = {
  [DriverLevel.ROOKIE]: 25,
  [DriverLevel.STANDARD]: 22,
  [DriverLevel.SILVER]: 20,
  [DriverLevel.GOLD]: 18,
  [DriverLevel.PLATINUM]: 15,
  [DriverLevel.DIAMOND]: 12,
  [DriverLevel.ELITE]: 10,
};
