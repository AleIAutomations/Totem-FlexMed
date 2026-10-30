"""Comportamento dos clientes no totem (página Atividade do admin).

Junta os eventos de sessão que o totem grava (frontend/sessao.js):
  clique / toque   posição do toque (x, y de 0 a 1) e região da tela; "toque" = sem resposta
  tela_tempo       tempo em cada tela e quanto dele a pessoa olhou (câmera)
  produto_tempo    tempo na página do produto, olhando e quanto rolou
  impressoes       produtos que apareceram na tela
  rolagem          até qual linha de produtos a pessoa foi
  layout           caixas das regiões da tela (fundo do mapa de toques)
e calcula mapa de toques, tempo por tela, funil por produto (apareceu → abriu →
pôs na lista), profundidade de rolagem e o que cada faixa etária olha.

Lê do Supabase quando disponível (metricas._ler), senão do SQLite. Anônimo: só
posição de toques e tempos, nunca imagem ou identificação.

Rota: GET /api/relatorios/comportamento?dias=7&faixa=
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from flask import Blueprint, jsonify, request

import metricas

bp = Blueprint("comportamento", __name__)

TIPOS = ("clique", "toque", "tela_tempo", "produto_tempo", "impressoes", "rolagem", "produto", "carrinho_add", "layout")
NOMES_TELA = {"inicio": "Início (catálogo)", "produto": "Página do produto", "carrinho": "Carrinho", "libras": "Libras",
              "qr": "QR code", "avaliacao": "Avaliação"}
FAIXAS_ROLAGEM = [(1, 2, "1–2 linhas"), (3, 5, "3–5 linhas"), (6, 10, "6–10 linhas"), (11, 20, "11–20 linhas"),
                  (21, 10 ** 6, "mais de 20")]


def _nome_produto(pid: str, visto: dict[str, str]) -> str:
    if pid in visto:
        return visto[pid]
    try:
        import loja
        p = loja._produto(pid)
        return (p or {}).get("nome") or pid
    except Exception:
        return pid


@bp.get("/api/relatorios/comportamento")
def relatorio():
    desde = metricas._desde()
    faixa = request.args.get("faixa") or ""
    eventos, fonte = metricas._ler(
        "totem_sessao_eventos", {"ts": f"gte.{desde}", "tipo": f"in.({','.join(TIPOS)})"},
        f"SELECT sessao_id, ts, tipo, alvo, tela, detalhe FROM sessao_eventos WHERE ts>=? AND tipo IN ({','.join('?' * len(TIPOS))})",
        (desde, *TIPOS), colunas="sessao_id,ts,tipo,alvo,tela,detalhe")
    sessoes, _ = metricas._ler("totem_sessoes", {"inicio": f"gte.{desde}"},
                               "SELECT id, faixa, duracao_s, atencao_s FROM sessoes WHERE inicio>=?", (desde,),
                               colunas="id,faixa,duracao_s,atencao_s")
    faixa_da_sessao = {s["id"]: s["faixa"] for s in sessoes}
    if faixa:
        eventos = [e for e in eventos if faixa_da_sessao.get(e["sessao_id"]) == faixa]
        sessoes = [s for s in sessoes if s["faixa"] == faixa]
    eventos.sort(key=lambda e: e["ts"])

    pontos, por_regiao, mortos_regiao, alvos = [], Counter(), Counter(), Counter()
    telas: dict[str, dict[str, float]] = defaultdict(lambda: {"visitas": 0, "tempo": 0.0, "olhando": 0.0})
    prods: dict[str, dict[str, Any]] = defaultdict(lambda: {"impressoes": 0, "aberturas": 0, "tempo": 0.0, "olhando": 0.0,
                                                          "rolou": 0, "medicoes": 0, "adicionados": 0, "categoria": None})
    nomes: dict[str, str] = {}
    rolagens, layouts = [], {}
    por_faixa: dict[str, Counter] = defaultdict(Counter)

    for e in eventos:
        d = metricas._json(e["detalhe"])
        tipo = e["tipo"]
        if tipo in ("clique", "toque") and "x" in d:
            morto = tipo == "toque"
            pontos.append({"x": d["x"], "y": d["y"], "tela": e["tela"] or "inicio", "morto": morto})
            regiao = d.get("regiao") or "outro"
            por_regiao[regiao] += 1
            mortos_regiao[regiao] += morto
            if not morto:
                alvos[(e["alvo"], regiao)] += 1
        elif tipo == "tela_tempo":
            t = telas[e["alvo"] or "inicio"]
            t["visitas"] += 1
            t["tempo"] += d.get("duracao_s", 0)
            t["olhando"] += d.get("olhando_s", 0)
        elif tipo == "impressoes":
            for pid in d.get("ids") or []:
                prods[str(pid)]["impressoes"] += 1
        elif tipo == "produto" and d.get("id"):
            p = prods[str(d["id"])]
            p["aberturas"] += 1
            p["categoria"] = d.get("categoria") or p["categoria"]
            nomes[str(d["id"])] = e["alvo"]
            if faixa_da_sessao.get(e["sessao_id"]):
                por_faixa[faixa_da_sessao[e["sessao_id"]]][str(d["id"])] += 1
        elif tipo == "produto_tempo" and d.get("id"):
            p = prods[str(d["id"])]
            p["tempo"] += d.get("duracao_s", 0)
            p["olhando"] += d.get("olhando_s", 0)
            p["rolou"] += d.get("rolou_pct", 0)
            p["medicoes"] += 1
            nomes[str(d["id"])] = e["alvo"]
        elif tipo == "carrinho_add" and d.get("id"):
            prods[str(d["id"])]["adicionados"] += 1
            nomes.setdefault(str(d["id"]), e["alvo"])
        elif tipo == "rolagem":
            rolagens.append(int(d.get("max_linha") or 0))
        elif tipo == "layout":
            layouts[e["tela"] or "inicio"] = d   # o mais recente de cada tela vale

    produtos = []
    for pid, p in prods.items():
        n = p["medicoes"]
        produtos.append({
            "id": pid, "nome": _nome_produto(pid, nomes), "categoria": p["categoria"],
            "impressoes": p["impressoes"], "aberturas": p["aberturas"], "adicionados": p["adicionados"],
            # taxa de abertura: das vezes que apareceu na tela, quantas foram abertas
            # (pode abrir sem ter aparecido na grade, pela busca ou pela voz: limita a 100%)
            "taxa_abertura": min(round(p["aberturas"] / p["impressoes"] * 100, 1), 100.0) if p["impressoes"] else None,
            "conversao": round(p["adicionados"] / p["aberturas"] * 100, 1) if p["aberturas"] else None,
            "tempo_medio_s": round(p["tempo"] / n, 1) if n else None,
            "olhando_medio_s": round(p["olhando"] / n, 1) if n else None,
            "rolou_medio": round(p["rolou"] / n) if n else None,
            "tempo_total_s": round(p["tempo"], 1),
        })
    produtos.sort(key=lambda p: (-p["aberturas"], -p["impressoes"]))

    total_toques = sum(por_regiao.values())
    duracoes = [s["duracao_s"] or 0 for s in sessoes]
    return jsonify({
        "fonte": fonte, "faixa": faixa or None,
        "resumo": {
            "sessoes": len(sessoes),
            "tempo_medio_sessao_s": round(sum(duracoes) / len(duracoes), 1) if duracoes else 0,
            "olhando_medio_sessao_s": round(sum(s["atencao_s"] or 0 for s in sessoes) / len(sessoes), 1) if sessoes else 0,
            "toques": total_toques, "toques_sem_resposta": sum(mortos_regiao.values()),
            "produtos_na_tela": sum(1 for p in produtos if p["impressoes"]),
            "produtos_abertos": sum(1 for p in produtos if p["aberturas"]),
            "aberturas": sum(p["aberturas"] for p in produtos),
            "taxa_abertura": round(sum(p["aberturas"] for p in produtos) / max(sum(p["impressoes"] for p in produtos), 1) * 100, 1),
            "rolagem_media_linhas": round(sum(rolagens) / len(rolagens), 1) if rolagens else 0,
        },
        "toques": {
            "pontos": pontos[-4000:],
            "por_regiao": [{"regiao": r, "toques": n, "sem_resposta": mortos_regiao[r],
                            "pct": round(n / total_toques * 100, 1)} for r, n in por_regiao.most_common()],
            "mais_tocados": [{"alvo": a, "regiao": r, "toques": n} for (a, r), n in alvos.most_common(15)],
        },
        "telas": sorted([{"tela": t, "nome": NOMES_TELA.get(t, t), "visitas": v["visitas"],
                          "tempo_medio_s": round(v["tempo"] / v["visitas"], 1) if v["visitas"] else 0,
                          "tempo_total_s": round(v["tempo"], 1),
                          "olhando_pct": min(round(v["olhando"] / v["tempo"] * 100), 100) if v["tempo"] else 0}
                         for t, v in telas.items()], key=lambda t: -t["tempo_total_s"]),
        "produtos": produtos[:80],
        "rolagem": [{"faixa": nome, "sessoes": sum(1 for r in rolagens if a <= r <= b)} for a, b, nome in FAIXAS_ROLAGEM],
        "por_faixa": {f: [{"id": pid, "nome": _nome_produto(pid, nomes), "aberturas": n} for pid, n in c.most_common(5)]
                      for f, c in por_faixa.items()},
        "layouts": layouts,
    })
