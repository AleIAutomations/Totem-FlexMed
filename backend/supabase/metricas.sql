-- FlexMed v5 — métricas, logs anônimos e gestão da loja do totem (enviados por backend/nuvem.py)
-- Rodar uma vez no SQL Editor do projeto Supabase (é seguro rodar de novo).
-- Sem imagem nem dado do rosto: só faixa etária estimada, atenção e o que foi tocado.
-- Horários em epoch (segundos); as colunas *_em são a mesma hora em timestamptz.

create table if not exists public.totem_audiencia (
  totem_id    text not null,
  local_id    bigint not null,
  inicio      double precision not null,
  fim         double precision not null,
  inicio_em   timestamptz generated always as (to_timestamp(inicio)) stored,
  faixa       text,                 -- menor | 18-28 | 28-38 | 38-48 | 48-58 | 58-68 | 68-78 | 78-88 | null
  idade       smallint,             -- idade estimada (mediana das leituras)
  confianca   real,                 -- probabilidade média da faixa escolhida (0..1)
  olhou       boolean default false,
  atencao_s   real default 0,
  contexto    text default 'standby',
  primary key (totem_id, local_id)
);
create index if not exists totem_audiencia_inicio on public.totem_audiencia (totem_id, inicio);

create table if not exists public.totem_exibicoes (
  totem_id      text not null,
  local_id      bigint not null,
  campaign_id   bigint,
  campanha_nome text,
  motivo        text,
  faixa_alvo    text,
  inicio        double precision not null,
  fim           double precision,
  inicio_em     timestamptz generated always as (to_timestamp(inicio)) stored,
  duracao_s     real default 0,
  espectadores  integer default 0,
  atencao_s     real default 0,
  faixas        jsonb default '{}'::jsonb,
  interagiu     boolean default false,
  primary key (totem_id, local_id)
);
create index if not exists totem_exibicoes_inicio on public.totem_exibicoes (totem_id, inicio);

create table if not exists public.totem_sessoes (
  totem_id        text not null,
  id              text not null,
  origem          text,
  inicio          double precision not null,
  fim             double precision,
  inicio_em       timestamptz generated always as (to_timestamp(inicio)) stored,
  duracao_s       real default 0,
  atencao_s       real default 0,
  faixa           text,
  cliques         integer default 0,
  produtos_vistos integer default 0,
  buscas          integer default 0,
  adicionados     integer default 0,
  finalizou       boolean default false,
  desistiu        boolean default false,
  ultima_tela     text,
  saida           text,
  primary key (totem_id, id)
);
create index if not exists totem_sessoes_inicio on public.totem_sessoes (totem_id, inicio);

create table if not exists public.totem_sessao_eventos (
  totem_id  text not null,
  local_id  bigint not null,
  sessao_id text not null,
  ts        double precision not null,
  ts_em     timestamptz generated always as (to_timestamp(ts)) stored,
  tipo      text not null,
  alvo      text,
  tela      text,
  detalhe   jsonb default '{}'::jsonb,
  primary key (totem_id, local_id)
);
create index if not exists totem_sessao_eventos_ts on public.totem_sessao_eventos (totem_id, ts);
create index if not exists totem_sessao_eventos_sessao on public.totem_sessao_eventos (totem_id, sessao_id);

create table if not exists public.totem_presenca_eventos (
  totem_id     text not null,
  local_id     bigint not null,
  ts           double precision not null,
  ts_em        timestamptz generated always as (to_timestamp(ts)) stored,
  tipo         text not null,       -- acordou | ausencia
  distancia_cm integer,
  detalhe      jsonb default '{}'::jsonb,
  primary key (totem_id, local_id)
);
create index if not exists totem_presenca_eventos_ts on public.totem_presenca_eventos (totem_id, ts);

-- ─── Loja: estoque, lotes, movimentações e pedidos (backend/loja.py) ───
create table if not exists public.totem_estoque (
  totem_id         text not null,
  product_id       text not null,     -- products.id
  sku              text,
  ean              text,
  marca            text,
  fabricante       text,
  fornecedor       text,
  unidade          text,
  custo            numeric(12,4),     -- custo médio ponderado
  estoque          integer default 0,
  estoque_minimo   integer default 0,
  estoque_maximo   integer default 0,
  controla_estoque boolean default true,
  atualizado       double precision,
  primary key (totem_id, product_id)
);
create index if not exists totem_estoque_sku on public.totem_estoque (totem_id, sku);

create table if not exists public.totem_estoque_lotes (
  totem_id   text not null,
  local_id   bigint not null,
  product_id text not null,
  lote       text,
  validade   date,
  quantidade integer default 0,
  atualizado double precision,
  primary key (totem_id, local_id)
);

create table if not exists public.totem_estoque_movimentos (
  totem_id   text not null,
  local_id   bigint not null,
  product_id text not null,
  sku        text,
  nome       text,
  tipo       text not null,           -- entrada | saida | perda | devolucao | ajuste | venda
  quantidade integer not null,        -- com sinal
  saldo_apos integer,
  custo_unit numeric(12,4),
  lote       text,
  motivo     text,
  pedido_id  text,
  usuario    text,
  ts         double precision not null,
  ts_em      timestamptz generated always as (to_timestamp(ts)) stored,
  primary key (totem_id, local_id)
);
create index if not exists totem_estoque_movimentos_ts on public.totem_estoque_movimentos (totem_id, ts);

create table if not exists public.totem_pedidos (
  totem_id    text not null,
  id          text not null,
  codigo      text,
  sessao_id   text,
  status      text,                   -- novo | separando | pronto | entregue | cancelado
  itens       integer,
  total       numeric(12,2),
  observacao  text,
  criado      double precision,
  criado_em   timestamptz generated always as (to_timestamp(criado)) stored,
  atualizado  double precision,
  entregue_em double precision,
  primary key (totem_id, id)
);

create table if not exists public.totem_pedido_itens (
  totem_id   text not null,
  local_id   bigint not null,
  pedido_id  text not null,
  product_id text not null,
  nome       text,
  sku        text,
  qtd        integer,
  preco_unit numeric(12,2),
  faltou     boolean default false,
  primary key (totem_id, local_id)
);

-- Só o backend (secret key) lê e grava: RLS ligado e nenhuma política pública
alter table public.totem_audiencia        enable row level security;
alter table public.totem_exibicoes        enable row level security;
alter table public.totem_sessoes          enable row level security;
alter table public.totem_sessao_eventos   enable row level security;
alter table public.totem_presenca_eventos enable row level security;
alter table public.totem_estoque            enable row level security;
alter table public.totem_estoque_lotes      enable row level security;
alter table public.totem_estoque_movimentos enable row level security;
alter table public.totem_pedidos            enable row level security;
alter table public.totem_pedido_itens       enable row level security;
