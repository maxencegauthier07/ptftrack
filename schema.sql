-- =============================================
-- PORTFOLIO TRACKER - Schema Supabase
-- Exécuter dans le SQL Editor de Supabase
-- =============================================

-- Personnes
CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Comptes (CTO / PEA par personne)
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('CTO', 'PEA')),
  currency text NOT NULL CHECK (currency IN ('EUR', 'USD')),
  benchmark text NOT NULL CHECK (benchmark IN ('SP500', 'CAC40')),
  total_invested numeric DEFAULT 0,
  cash numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(person_id, type)
);

-- Lignes / positions (actives et fermées)
CREATE TABLE IF NOT EXISTS holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  label text,
  shares numeric NOT NULL DEFAULT 0,
  avg_cost numeric DEFAULT 0,
  last_price numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(account_id, ticker)
);

-- Snapshots journaliers
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  portfolio_value numeric NOT NULL,
  index_value numeric NOT NULL,       -- indice ajusté (inclut les dépôts)
  index_raw numeric,                  -- indice brut (S&P500/CAC réel)
  cash numeric DEFAULT 0,
  fx_rate numeric,                    -- taux USDEUR
  confirmed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_id, date)
);

-- Mouvements de cash
CREATE TABLE IF NOT EXISTS cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount numeric NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Plus/moins values réalisées
CREATE TABLE IF NOT EXISTS realized_pnl (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount numeric NOT NULL,
  ticker text,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Historique des trades (achats/ventes)
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  date date NOT NULL,
  ticker text NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  shares numeric NOT NULL,
  price numeric NOT NULL,
  fees numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- =============================================
-- RLS (permissif - tu pourras restreindre après)
-- =============================================
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE realized_pnl ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON people FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON holdings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON daily_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON cash_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON realized_pnl FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON trades FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- INDEX
-- =============================================
CREATE INDEX IF NOT EXISTS idx_snap_acct_date ON daily_snapshots(account_id, date);
CREATE INDEX IF NOT EXISTS idx_holdings_acct ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_cash_acct ON cash_movements(account_id, date);
CREATE INDEX IF NOT EXISTS idx_trades_acct ON trades(account_id, date);
