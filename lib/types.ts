// =========================================================
//  ptftrack — types.ts
// =========================================================

export type Currency = "EUR" | "USD" | "CAD" | "AUD" | "GBP";

export type Person = {
  id: string;
  name: string;
  user_id: string | null;
  created_at: string;
};

// =========================================================
//  BROKERS
// =========================================================

export type Broker = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
};

// =========================================================
//  STOCKS
// =========================================================

export type Account = {
  id: string;
  person_id: string;
  type: "CTO" | "PEA";
  currency: "EUR" | "USD";
  benchmark: "SP500" | "CAC40";
  total_invested: number;
  cash: number;
  created_at: string;
  people?: { name: string };
};

export type SubAccount = {
  id: string;
  account_id: string;
  broker_id: string | null;
  name: string | null;
  cash: number;
  created_at: string;
  updated_at: string;
  accounts?: Account;
  brokers?: { name: string; color: string | null } | null;
};

export type Holding = {
  id: string;
  account_id: string;
  sub_account_id: string;
  ticker: string;
  label: string | null;
  shares: number;
  avg_cost: number;
  last_price: number;
  updated_at: string;
};

export type DailySnapshot = {
  id: string;
  account_id: string;
  date: string;
  portfolio_value: number;
  index_value: number;
  index_raw: number | null;
  cash: number;
  fx_rate: number | null;
  confirmed: boolean;
  created_at: string;
};

export type CashMovement = {
  id: string;
  account_id: string;
  sub_account_id: string;
  date: string;
  amount: number;
  description: string | null;
  created_at: string;
};

export type RealizedPnl = {
  id: string;
  account_id: string;
  sub_account_id: string;
  date: string;
  amount: number;
  ticker: string | null;
  description: string | null;
  created_at: string;
};

export type Trade = {
  id: string;
  account_id: string;
  sub_account_id: string;
  date: string;
  ticker: string;
  side: "BUY" | "SELL";
  shares: number;
  price: number;
  fees: number;
  notes: string | null;
  created_at: string;
};

export type FxRate = {
  id: string;
  date: string;
  pair: string;
  rate: number;
  created_at: string;
};

// ★ NEW : Dividendes
export type Dividend = {
  id: string;
  account_id: string;
  sub_account_id: string | null;
  date: string;
  ticker: string | null;
  amount: number;                  // EUR
  amount_native: number | null;    // devise d'origine
  currency_native: Currency | null;
  fx_rate: number | null;
  withholding_tax: number;
  notes: string | null;
  created_at: string;
};

// =========================================================
//  BANQUE
// =========================================================

export type BankAccountType =
  | "checking" | "savings" | "livret_a" | "ldds" | "lep"
  | "pel" | "cel" | "assurance_vie" | "other";

export type BankAccount = {
  id: string;
  person_id: string;
  name: string;
  type: BankAccountType;
  bank_name: string | null;
  currency: Currency;
  balance: number;
  interest_rate: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  people?: { name: string };
};

// =========================================================
//  IMMOBILIER + DETTES
// =========================================================

export type PropertyType = "residence" | "rental" | "secondary" | "land" | "other";

export type Property = {
  id: string;
  person_id: string;
  name: string;
  type: PropertyType;
  address: string | null;
  purchase_date: string | null;
  purchase_price: number;
  current_value: number;
  currency: Currency;
  ownership_pct: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  people?: { name: string };
};

export type LoanType = "mortgage" | "consumer" | "student" | "other";

export type Loan = {
  id: string;
  person_id: string;
  property_id: string | null;
  name: string;
  type: LoanType;
  principal: number;
  current_balance: number;
  rate: number | null;
  start_date: string | null;
  end_date: string | null;
  monthly_payment: number | null;
  currency: Currency;
  notes: string | null;
  created_at: string;
  updated_at: string;
  people?: { name: string };
  properties?: { name: string } | null;
};

// =========================================================
//  ★ NEW : GOALS
// =========================================================

export type VelocityWindow = "30d" | "90d" | "180d" | "ytd" | "since_ref";

export type Goal = {
  id: string;
  person_id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
  start_amount: number | null;
  start_date: string | null;          // figée à 2025-12-31 pour la progression
  active: boolean;
  achieved_at: string | null;
  notes: string | null;
  velocity_window: VelocityWindow;    // fenêtre pour calculer la vélocité/projection
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// =========================================================
//  AGGREGATIONS
// =========================================================

export type BrokerTotal = {
  broker_id: string | null;
  broker_name: string;
  broker_color: string | null;
  total_value_eur: number;
  total_value_native: Record<Currency, number>;
  sub_account_count: number;
};

export type PersonNetWorth = {
  person_id: string;
  person_name: string;
  stocks: Record<Currency, number>;
  bank: Record<Currency, number>;
  real_estate: Record<Currency, number>;
  loans: Record<Currency, number>;
  net: Record<Currency, number>;
};