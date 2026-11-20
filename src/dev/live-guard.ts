export function assertLive(env: NodeJS.ProcessEnv = process.env): void {
  if (env.FACTORY_LIVE !== '1') {
    throw new Error('FACTORY_LIVE=1 is required for live runs.');
  }
}

export class BudgetExceeded extends Error {
  constructor(total: number, cap: number) {
    super(`Budget exceeded: total ${total.toFixed(2)} reached cap ${cap.toFixed(2)}.`);
    this.name = 'BudgetExceeded';
  }
}

export class Budget {
  private static readonly MICRO_DOLLAR = 1_000_000;

  private totalMicroDollars = 0;
  private readonly capMicroDollars: number;

  constructor(cap = 1) {
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new Error('Budget cap must be a finite number above 0.');
    }

    this.capMicroDollars = Math.round(cap * Budget.MICRO_DOLLAR);
  }

  add(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Budget amount must be a non-negative finite number.');
    }

    this.totalMicroDollars += Math.round(amount * Budget.MICRO_DOLLAR);
    if (this.totalMicroDollars >= this.capMicroDollars) {
      throw new BudgetExceeded(this.total, this.capMicroDollars / Budget.MICRO_DOLLAR);
    }

    return this.total;
  }

  get total(): number {
    return this.totalMicroDollars / Budget.MICRO_DOLLAR;
  }
}
