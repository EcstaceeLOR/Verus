export interface TestClock {
  readonly now: () => Date;
}

export function fixedClock(timestamp: string): TestClock {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.valueOf())) throw new TypeError("Test clock requires an ISO timestamp");
  return Object.freeze({ now: () => new Date(instant) });
}
