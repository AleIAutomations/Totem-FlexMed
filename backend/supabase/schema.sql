-- FlexMed — schema do catálogo de produtos no Supabase.
-- Rode no SQL Editor do projeto. É idempotente (pode rodar de novo) e não apaga
-- dados: só cria tabelas, adiciona colunas e preenche valores derivados.
--
--   categorias        tipos de produto (analgésico, dermocosmético...)
--   products          catálogo (nome, descrição, tipo, preço, imagem...)
--   coletas           cada execução de importação/scraping
--   historico_precos  preço de cada produto em cada coleta

-- ─── categorias ─────────────────────────────────────────────────────────────
create table if not exists public.categorias (
    id         bigint generated always as identity primary key,
    slug       text not null unique,
    nome       text not null,
    created_at timestamptz not null default now()
);

insert into public.categorias (slug, nome) values
    ('analgesico',  'Analgésicos'),
    ('antibiotico', 'Antibióticos'),
    ('vitaminas',   'Vitaminas'),
    ('diabetes',    'Diabetes'),
    ('dermato',     'Dermato'),
    ('infantil',    'Infantil'),
    ('cuidados',    'Cuidados'),
    ('gastro',      'Gastrointestinais'),
    ('outros',      'Outros')
on conflict (slug) do nothing;

-- ─── products (tabela já existente: só acrescenta colunas) ──────────────────
alter table public.products add column if not exists "tipo"              text          not null default '';
alter table public.products add column if not exists "dicaIA"            text          not null default '';
alter table public.products add column if not exists "locaisDisponiveis" text[]        not null default '{}';
alter table public.products add column if not exists "active"            boolean       not null default true;
alter table public.products add column if not exists "updatedAt"         timestamptz   not null default now();
alter table public.products add column if not exists "precoValor"        numeric(10,2);              -- preço numérico (null = sem preço)
alter table public.products add column if not exists "precoOriginal"     numeric(10,2);              -- preço "de" (riscado) quando em promoção
alter table public.products add column if not exists "categoriaId"       bigint references public.categorias (id) on delete set null;
alter table public.products add column if not exists "fonte"             text          not null default 'manual';
alter table public.products add column if not exists "fonteUrl"          text;                       -- página de origem (dedup de importações)

alter table public.products alter column "id" set default gen_random_uuid()::text;

create unique index if not exists products_fonte_url_key on public.products ("fonteUrl") where "fonteUrl" is not null;
create index if not exists products_nome_idx       on public.products (lower(nome));
create index if not exists products_categoria_idx  on public.products (categoria);
create index if not exists products_active_nome_idx on public.products (active, nome);

-- "R$ 12,90" -> 12.90 para os produtos que já existiam
update public.products
   set "precoValor" = replace(replace(substring(preco from '[0-9][0-9.]*,[0-9]{2}|[0-9]+'), '.', ''), ',', '.')::numeric
 where "precoValor" is null and preco ~ '[0-9]';

update public.products p
   set "categoriaId" = c.id
  from public.categorias c
 where p."categoriaId" is null and c.slug = p.categoria;

create or replace function public.flexmed_set_updated_at() returns trigger
language plpgsql as $$
begin
    new."updatedAt" = now();
    return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
    before update on public.products
    for each row execute function public.flexmed_set_updated_at();

-- ─── coletas ────────────────────────────────────────────────────────────────
create table if not exists public.coletas (
    id            bigint generated always as identity primary key,
    fonte         text not null,
    status        text not null default 'executando',   -- executando | concluida | erro
    total         integer not null default 0,
    erro          text,
    iniciada_em   timestamptz not null default now(),
    finalizada_em timestamptz
);

-- ─── historico_precos ───────────────────────────────────────────────────────
create table if not exists public.historico_precos (
    id            bigint generated always as identity primary key,
    product_id    text not null references public.products (id) on delete cascade,
    coleta_id     bigint references public.coletas (id) on delete set null,
    preco         numeric(10,2) not null,
    registrado_em timestamptz not null default now()
);
create index if not exists historico_precos_produto_idx on public.historico_precos (product_id, registrado_em desc);

-- ─── segurança ──────────────────────────────────────────────────────────────
-- RLS ligado e sem políticas: só o backend (secret key) lê e escreve.
alter table public.products         enable row level security;
alter table public.categorias       enable row level security;
alter table public.coletas          enable row level security;
alter table public.historico_precos enable row level security;

-- ─── imagens ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do nothing;
