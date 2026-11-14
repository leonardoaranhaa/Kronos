import { asOf } from './align';

export interface TimedRate {
  time: number;
  rate: number;
}

export interface TimedValue {
  time: number;
  value: number;
}

export interface OverlayPoint {
  time: number;
  fundingBps: number | null;
  openInterest: number | null;
}

/**
 * Visual alignment. A candle may display the last print at or before its close.
 * This does not feed the model.
 */
export function alignFuturesOverlay(input: {
  candleTimes: readonly number[];
  intervalMs: number;
  funding: readonly TimedRate[];
  openInterest: readonly TimedValue[];
}): OverlayPoint[] {
  return input.candleTimes.map(time => {
    const closeTime = time + input.intervalMs - 1;
    const funding = asOf(input.funding, closeTime);
    const interest = asOf(input.openInterest, closeTime);
    return {
      time,
      fundingBps: funding ? funding.rate * 10_000 : null,
      openInterest: interest ? interest.value : null
    };
  });
}
