"""Painel de marketing: o que o time precisa para avaliar e planejar campanhas.

Cruza todas as fontes do totem num único relatório, com comparação ao período
anterior de mesmo tamanho:
  audiência (câmera)   alcance, atenção, perfil por faixa etária, horários
  campanhas (standby)  exibições, espectadores, atenção, interação, efeito da segmentação
  vitrine              exibições, toques e taxa de toque por bloco e por segmentação
  sessões e eventos    engajamento, funil, buscas (com e sem resultado), sintomas pela voz
  pedidos (loja.py)    pedidos, receita, ticket médio, categorias e produtos mais vendidos
e gera "insights" em texto (melhor horário, faixa que mais converte, busca sem resultado...).

Rota: GET /api/relatorios/marketing?dias=30
"""
from __future__ import annotations

import time
from collections import Counter, defaultdict
from typing import Any

from flask import Blueprint, jsonify, request

import metricas
from visao import FAIXAS, SLUGS_FAIXAS

bp = Blueprint("marketing", __name__)
NOME_FAIXA = {s: n for s, n, _, _ in FAIXAS}
DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]


def _var(atual: float, anterior: float) -> float | None:
    """Variação % em relação ao período anterior (None se não havia base)."""
    return round((atual - anterior) / anterior * 100, 1) if anterior else None


def _pct(a: float, b: float) -> float:
    return round(a / b * 100, 1) if b else 0.0


def _dados(desde: float, ate: float) -> dict[str, Any]:
    def ler(remota, filtros, sql, colunas):
        linhas, _ = metricas._ler(remota, {**filtros}, sql, (desde,), colunas=colunas)
        return linhas
    campo = lambda c: {c: f"gte.{desde}"}
    aud = [r for r in ler("totem_audiencia", campo("inicio"),
                          "SELECT inicio, faixa, olhou, atencao_s, contexto FROM audiencia WHERE inicio>=?",
                          "inicio,faixa,olhou,atencao_s,contexto") if r["inicio"] < ate]
    exib = [r for r in ler("totem_exibicoes", campo("inicio"),
                           "SELECT * FROM exibicoes_anuncio WHERE inicio>=? AND fim IS NOT NULL", "*") if r["inicio"] < ate]
    sess = [r for r in ler("totem_sessoes", campo("inicio"),
                           "SELECT * FROM sessoes WHERE inicio>=? AND fim IS NOT NULL", "*") if r["inicio"] < ate]
    tipos = ("busca", "produto", "carrinho_add", "categoria", "voz", "vitrine_ver", "vitrine_clique")
    evs, _ = metricas._ler("totem_sessao_eventos", {"ts": f"gte.{desde}", "tipo": f"in.({','.join(tipos)})"},
                           f"SELECT sessao_id, ts, tipo, alvo, detalhe FROM sessao_eventos WHERE ts>=? AND tipo IN ({','.join('?' * len(tipos))})",
                           (desde, *tipos), colunas="sessao_id,ts,tipo,alvo,detalhe")
    evs = [e for e in evs if e["ts"] < ate]
    with metricas._db() as conn:
        try:
            pedidos = [dict(r) for r in conn.execute("SELECT * FROM pedidos WHERE criado>=? AND criado<?", (desde, ate))]
            itens = [dict(r) for r in conn.execute(
                "SELECT i.* FROM pedido_itens i JOIN pedidos p ON p.id=i.pedido_id WHERE p.criado>=? AND p.criado<?", (desde, ate))]
        except Exception:   # loja ainda não configurada
            pedidos, itens = [], []
        campanhas = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM campaigns")}
        try:
            blocos = {str(r["id"]): r["nome"] for r in conn.execute("SELECT id, nome FROM vitrine_blocos")}
        except Exception:
            blocos = {}
    return {"aud": aud, "exib": exib, "sess": sess, "evs": evs, "pedidos": pedidos, "itens": itens,
            "campanhas": campanhas, "blocos": blocos}


def _kpis(d: dict[str, Any]) -> dict[str, float]:
    olharam = [a for a in d["aud"] if a["olhou"]]
    entregues = [p for p in d["pedidos"] if p["status"] == "entregue"]
    receita = sum(p["total"] or 0 for p in entregues)
    return {
        "alcance": len(d["aud"]), "olharam": len(olharam), "taxa_atencao": _pct(len(olharam), len(d["aud"])),
        "atencao_media_s": round(sum(a["atencao_s"] or 0 for a in olharam) / len(olharam), 1) if olharam else 0,
        "sessoes": len(d["sess"]), "taxa_engajamento": _pct(len(d["sess"]), len(olharam)),
        "pedidos": len(d["pedidos"]), "entregues": len(entregues), "receita": round(receita, 2),
        "ticket_medio": round(receita / len(entregues), 2) if entregues else 0,
        "conversao": _pct(len(d["pedidos"]), len(d["sess"])),
        "exibicoes": len(d["exib"]), "espectadores": sum(e["espectadores"] or 0 for e in d["exib"]),
    }


@bp.get("/api/relatorios/marketing")
def relatorio():
    dias = max(1, min(request.args.get("dias", 30, type=int), 365))
    agora = time.time()
    desde, antes = agora - dias * 86400, agora - 2 * dias * 86400
    d = _dados(desde, agora + 1)
    anterior = _kpis(_dados(antes, desde))
    k = _kpis(d)
    kpis = {chave: {"valor": v, "anterior": anterior.get(chave), "variacao": _var(v, anterior.get(chave) or 0)}
            for chave, v in k.items()}

    faixa_sessao = {s["id"]: s["faixa"] for s in d["sess"]}
    eventos_por = defaultdict(list)
    for e in d["evs"]:
        eventos_por[e["tipo"]].append({**e, "detalhe": metricas._json(e["detalhe"])})

    # ─── funil completo ─────────────────────────────────────────────────────
    viram = {e["sessao_id"] for e in eventos_por["produto"]}
    adicionaram = {e["sessao_id"] for e in eventos_por["carrinho_add"]}
    funil = [("Passaram em frente", k["alcance"]), ("Olharam a tela", k["olharam"]),
             ("Usaram o totem", k["sessoes"]), ("Viram um produto", len(viram)),
             ("Puseram na lista", len(adicionaram)), ("Fizeram o pedido", k["pedidos"]),
             ("Retiraram no balcão", k["entregues"])]
    topo = funil[0][1] or 1
    funil = [{"etapa": e, "valor": v, "pct_topo": _pct(v, topo),
              "pct_etapa": _pct(v, funil[i - 1][1]) if i else 100.0} for i, (e, v) in enumerate(funil)]

    # ─── campanhas do standby ───────────────────────────────────────────────
    camp: dict[Any, dict[str, Any]] = defaultdict(lambda: {"exibicoes": 0, "espectadores": 0, "atencao_s": 0.0, "interacoes": 0,
                                                           "segmentadas": 0, "faixas": Counter(), "tempo_s": 0.0})
    seg = {"segmentado": [0, 0.0, 0], "rotacao": [0, 0.0, 0]}   # exibições, atenção, espectadores
    for e in d["exib"]:
        c = camp[e["campaign_id"]]
        c["exibicoes"] += 1
        c["espectadores"] += e["espectadores"] or 0
        c["atencao_s"] += e["atencao_s"] or 0
        c["interacoes"] += 1 if e["interagiu"] else 0
        c["tempo_s"] += e["duracao_s"] or 0
        c["segmentadas"] += e["motivo"] == "segmentado"
        c["faixas"].update(metricas._json(e["faixas"]))
        s = seg["segmentado" if e["motivo"] == "segmentado" else "rotacao"]
        s[0] += 1; s[1] += e["atencao_s"] or 0; s[2] += e["espectadores"] or 0
    campanhas = []
    for cid, c in camp.items():
        faixas = {f: n for f, n in c["faixas"].items() if f in SLUGS_FAIXAS and n}
        campanhas.append({
            "id": cid, "nome": d["campanhas"].get(cid, f"Campanha #{cid} (removida)"),
            "exibicoes": c["exibicoes"], "espectadores": c["espectadores"],
            "espectadores_por_exibicao": round(c["espectadores"] / c["exibicoes"], 2) if c["exibicoes"] else 0,
            "atencao_total_s": round(c["atencao_s"]), "atencao_por_espectador_s": round(c["atencao_s"] / c["espectadores"], 1) if c["espectadores"] else 0,
            "taxa_interacao": _pct(c["interacoes"], c["exibicoes"]), "interacoes": c["interacoes"],
            "pct_segmentadas": _pct(c["segmentadas"], c["exibicoes"]), "faixas": faixas,
            "faixa_principal": max(faixas, key=faixas.get) if faixas else None,
            "tempo_no_ar_s": round(c["tempo_s"]),
        })
    campanhas.sort(key=lambda c: -c["atencao_total_s"])
    media = lambda s: round(s[1] / s[0], 1) if s[0] else 0
    segmentacao = {"segmentadas": seg["segmentado"][0], "rotacao": seg["rotacao"][0],
                   "atencao_segmentada_s": media(seg["segmentado"]), "atencao_rotacao_s": media(seg["rotacao"]),
                   "ganho_pct": _var(media(seg["segmentado"]), media(seg["rotacao"]))}

    # ─── vitrine entre produtos ─────────────────────────────────────────────
    vit: dict[str, dict[str, Any]] = defaultdict(lambda: {"exibicoes": 0, "toques": 0})
    vit_motivo: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for e in eventos_por["vitrine_ver"]:
        vit[e["alvo"]]["exibicoes"] += 1
        vit_motivo["segmentado" if e["detalhe"].get("motivo") not in (None, "geral") else "geral"][0] += 1
    for e in eventos_por["vitrine_clique"]:
        vit[e["alvo"]]["toques"] += 1
        vit_motivo["segmentado" if e["detalhe"].get("motivo") not in (None, "geral") else "geral"][1] += 1
    vitrine = sorted([{"id": b, "nome": d["blocos"].get(b, f"Bloco #{b} (removido)"), **v,
                       "taxa_toque": _pct(v["toques"], v["exibicoes"])} for b, v in vit.items()], key=lambda v: -v["exibicoes"])
    vitrine_seg = {m: {"exibicoes": v[0], "toques": v[1], "taxa_toque": _pct(v[1], v[0])} for m, v in vit_motivo.items()}

    # ─── público: perfil e conversão por faixa ──────────────────────────────
    olharam_faixa = Counter(a["faixa"] for a in d["aud"] if a["olhou"] and a["faixa"] in SLUGS_FAIXAS)
    sess_faixa = Counter(s["faixa"] for s in d["sess"] if s["faixa"] in SLUGS_FAIXAS)
    pedidos_faixa, receita_faixa = Counter(), Counter()
    for p in d["pedidos"]:
        f = faixa_sessao.get(p["sessao_id"])
        if f in SLUGS_FAIXAS:
            pedidos_faixa[f] += 1
            if p["status"] == "entregue":
                receita_faixa[f] += p["total"] or 0
    total_olh = sum(olharam_faixa.values())
    publico = [{"faixa": f, "nome": NOME_FAIXA[f], "olharam": olharam_faixa[f], "pct_publico": _pct(olharam_faixa[f], total_olh),
                "sessoes": sess_faixa[f], "pedidos": pedidos_faixa[f], "conversao": _pct(pedidos_faixa[f], sess_faixa[f]),
                "receita": round(receita_faixa[f], 2)} for f in SLUGS_FAIXAS]

    # ─── horários (dia da semana × hora) ────────────────────────────────────
    grade = [[0] * 24 for _ in range(7)]
    for a in d["aud"]:
        t = time.localtime(a["inicio"])
        grade[t.tm_wday][t.tm_hour] += 1
    ped_hora = Counter(time.localtime(p["criado"]).tm_hour for p in d["pedidos"])
    aud_hora = Counter(time.localtime(a["inicio"]).tm_hour for a in d["aud"])
    por_hora = [{"hora": h, "alcance": aud_hora[h], "pedidos": ped_hora[h]} for h in range(24)]

    # ─── demanda: buscas, voz e navegação ───────────────────────────────────
    buscas, sem_resultado = Counter(), Counter()
    for e in eventos_por["busca"]:
        termo = (e["alvo"] or "").strip().lower()
        if not termo:
            continue
        buscas[termo] += 1
        if e["detalhe"].get("resultados") == 0:
            sem_resultado[termo] += 1
    sintomas = Counter(e["detalhe"].get("sintoma") for e in eventos_por["voz"] if e["detalhe"].get("sintoma"))
    categorias_nav = Counter(e["alvo"] for e in eventos_por["categoria"] if e["alvo"] and e["alvo"] != "todos")

    # ─── produtos: interesse x venda ────────────────────────────────────────
    vistos = Counter((e["detalhe"].get("id"), e["alvo"]) for e in eventos_por["produto"] if e["detalhe"].get("id"))
    na_lista = Counter(e["detalhe"].get("id") for e in eventos_por["carrinho_add"] if e["detalhe"].get("id"))
    vendidos_qtd, vendidos_valor, cat_receita = Counter(), Counter(), Counter()
    entregues = {p["id"] for p in d["pedidos"] if p["status"] == "entregue"}
    try:
        import loja
        cat_de = lambda pid: (loja._produto(pid) or {}).get("categoria") or "outros"
        preco_cheio = lambda pid: (loja._produto(pid) or {}).get("precoOriginal")
    except Exception:
        cat_de, preco_cheio = (lambda pid: "outros"), (lambda pid: None)
    receita_promocao = 0.0
    for i in d["itens"]:
        if i["pedido_id"] not in entregues:
            continue
        valor = i["qtd"] * (i["preco_unit"] or 0)
        vendidos_qtd[(i["product_id"], i["nome"])] += i["qtd"]
        vendidos_valor[i["product_id"]] += valor
        cat_receita[cat_de(i["product_id"])] += valor
        cheio = preco_cheio(i["product_id"])
        if cheio and i["preco_unit"] and cheio > i["preco_unit"]:
            receita_promocao += valor
    interesse_sem_venda = [{"id": pid, "nome": nome, "aberturas": n, "na_lista": na_lista[pid]}
                           for (pid, nome), n in vistos.most_common(40) if not any(v[0] == pid for v in vendidos_qtd)][:10]

    # ─── origem das sessões e dos pedidos ───────────────────────────────────
    origem_sess = Counter(s["origem"] for s in d["sess"])
    sess_origem = {s["id"]: s["origem"] for s in d["sess"]}
    origem_ped = Counter(sess_origem.get(p["sessao_id"], "sem sessão") for p in d["pedidos"])
    origens = [{"origem": o, "sessoes": origem_sess[o], "pedidos": origem_ped[o], "conversao": _pct(origem_ped[o], origem_sess[o])}
               for o in ("toque", "anuncio", "aproximacao")]

    # ─── insights em texto ──────────────────────────────────────────────────
    insights = []
    if any(sum(l) for l in grade):
        dia, hora = max(((di, h) for di in range(7) for h in range(24)), key=lambda x: grade[x[0]][x[1]])
        insights.append(f"Maior movimento em frente ao totem: {DIAS_SEMANA[dia]} às {hora}h. Programe as campanhas principais para esse horário.")
    if total_olh:
        top = max(publico, key=lambda p: p["olharam"])
        insights.append(f"Público predominante: {top['nome']} ({top['pct_publico']}% de quem olhou a tela).")
    convs = [p for p in publico if p["sessoes"] >= 3]
    if convs:
        melhor = max(convs, key=lambda p: p["conversao"])
        if melhor["conversao"]:
            insights.append(f"A faixa {melhor['nome']} é a que mais converte: {melhor['conversao']}% das sessões viram pedido.")
    if segmentacao["ganho_pct"] is not None and segmentacao["segmentadas"] >= 3:
        insights.append(f"Exibições segmentadas por idade prendem a atenção {abs(segmentacao['ganho_pct'])}% "
                        f"{'mais' if segmentacao['ganho_pct'] > 0 else 'menos'} que a rotação comum.")
    if sem_resultado:
        termo, n = sem_resultado.most_common(1)[0]
        insights.append(f"“{termo}” foi buscado {n}× sem resultado — oportunidade de cadastrar ou destacar esse produto.")
    if interesse_sem_venda:
        p = interesse_sem_venda[0]
        insights.append(f"“{p['nome']}” foi aberto {p['aberturas']}× e não vendeu — revise preço, foto ou faça uma campanha.")
    if campanhas:
        c = max(campanhas, key=lambda c: c["atencao_por_espectador_s"])
        insights.append(f"Campanha com maior atenção por espectador: “{c['nome']}” ({c['atencao_por_espectador_s']} s).")
    if k["olharam"] and k["sessoes"] / k["olharam"] < 0.1:
        insights.append("Menos de 10% de quem olha a tela começa a usar o totem — teste campanhas com chamada para ação (“toque para ver ofertas”).")

    try:
        import taxonomia
        nome_cat = taxonomia.nomes()
    except Exception:
        nome_cat = {}
    return jsonify({
        "dias": dias, "kpis": kpis, "funil": funil, "campanhas": campanhas, "segmentacao": segmentacao,
        "vitrine": vitrine[:15], "vitrine_segmentacao": vitrine_seg, "publico": publico,
        "horarios": {"grade": grade, "dias": DIAS_SEMANA, "por_hora": por_hora},
        "demanda": {"buscas": [{"termo": t, "vezes": n, "sem_resultado": sem_resultado[t]} for t, n in buscas.most_common(15)],
                    "sem_resultado": [{"termo": t, "vezes": n} for t, n in sem_resultado.most_common(10)],
                    "sintomas": [{"sintoma": s, "vezes": n} for s, n in sintomas.most_common(10)],
                    "categorias": [{"categoria": nome_cat.get(c, c), "vezes": n} for c, n in categorias_nav.most_common(10)]},
        "vendas": {"mais_vendidos": [{"id": pid, "nome": nome, "qtd": q, "receita": round(vendidos_valor[pid], 2)}
                                     for (pid, nome), q in vendidos_qtd.most_common(10)],
                   "categorias": [{"categoria": nome_cat.get(c, c), "receita": round(v, 2)} for c, v in cat_receita.most_common(10)],
                   "receita_promocao": round(receita_promocao, 2),
                   "pct_receita_promocao": _pct(receita_promocao, k["receita"]),
                   "itens_por_pedido": round(sum(p["itens"] or 0 for p in d["pedidos"]) / len(d["pedidos"]), 1) if d["pedidos"] else 0},
        "interesse_sem_venda": interesse_sem_venda, "origens": origens, "insights": insights,
    })
