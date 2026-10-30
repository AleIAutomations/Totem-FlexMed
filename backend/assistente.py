"""Assistente por voz do totem: transcreve a fala (Whisper local), entende o
pedido (produto citado e/ou sintoma) e busca no catálogo.

A transcrição erra palavras parecidas ("ir de piruna" em vez de "dipirona"),
então os termos são comparados por semelhança com o vocabulário do catálogo.
"""
from __future__ import annotations

import difflib
import re
import tempfile
import threading
import time
import unicodedata
from typing import Any, Callable

# ─── Transcrição ─────────────────────────────────────────────────────────────
MODELO_WHISPER = "small"     # bom equilíbrio entre precisão em português e velocidade na CPU
DICA_VOCABULARIO = (
    "Atendimento de farmácia. O cliente pede remédios e produtos: dipirona, paracetamol, ibuprofeno, "
    "dorflex, neosaldina, protetor solar, vitamina C, xarope, antialérgico, loratadina, omeprazol, "
    "dor de cabeça, febre, gripe, alergia, tosse, azia."
)

_modelo = None
_status = "carregando"   # carregando | pronto | erro


def _carregar_modelo() -> None:
    global _modelo, _status
    try:
        from faster_whisper import WhisperModel
        _modelo = WhisperModel(MODELO_WHISPER, device="cpu", compute_type="int8")
        _status = "pronto"
    except Exception as exc:  # pragma: no cover - depende do ambiente
        _status = f"erro: {exc}"
    print(f"[Assistente] Whisper {MODELO_WHISPER}: {_status}", flush=True)


threading.Thread(target=_carregar_modelo, daemon=True).start()


def status() -> str:
    return _status


_lock_transcricao = threading.Lock()   # uma transcrição por vez (o modelo usa toda a CPU)


def transcrever(audio: bytes, sufixo: str = ".webm") -> str:
    """Transcrição final (mais precisa) da fala completa."""
    if _modelo is None:
        raise RuntimeError(f"transcrição indisponível ({_status})")
    with _lock_transcricao:
        return _transcrever(audio, sufixo, beam_size=5)


def transcrever_parcial(audio: bytes, sufixo: str = ".webm") -> str | None:
    """Rascunho rápido enquanto a pessoa ainda fala (para mostrar na tela).
    Se o modelo estiver ocupado, devolve None em vez de esperar: a parcial
    nunca pode atrasar a transcrição final."""
    if _modelo is None or not _lock_transcricao.acquire(blocking=False):
        return None
    try:
        return _transcrever(audio, sufixo, beam_size=1)
    except Exception:   # áudio parcial pode vir cortado no meio de um bloco
        return None
    finally:
        _lock_transcricao.release()


def _transcrever(audio: bytes, sufixo: str, beam_size: int) -> str:
    with tempfile.NamedTemporaryFile(suffix=sufixo) as arq:
        arq.write(audio)
        arq.flush()
        segmentos, _ = _modelo.transcribe(arq.name, language="pt", beam_size=beam_size,
                                          vad_filter=True, initial_prompt=DICA_VOCABULARIO)
        return " ".join(s.text.strip() for s in segmentos).strip()


# ─── Interpretação do pedido ─────────────────────────────────────────────────
def _norm(texto: str) -> str:
    texto = unicodedata.normalize("NFD", texto.lower()).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-z0-9 ]+", " ", texto)
    # junções comuns da fala transcrita ("parador de cabeça" = "para dor de cabeça")
    texto = re.sub(r"\bparador\b", "para dor", texto)
    texto = re.sub(r"\bpra\b", "para", texto)
    return " ".join(texto.split())


# Sintoma/necessidade -> (categoria principal, termos extras de busca, como falar)
SINTOMAS = [
    (r"dor de cabeca|enxaqueca|cefaleia", "analgesico", ["dipirona", "paracetamol"], "dor de cabeça"),
    (r"\bfebre\b", "analgesico", ["dipirona", "paracetamol"], "febre"),
    (r"\bdor\b|dores|colica|muscular|contusao|inflamac", "analgesico", [], "dor"),
    (r"alergi|coceira|rinite|espirr", "alergias", ["loratadina"], "alergia"),
    (r"gripe|resfriad|nariz entupido|congest|coriza", "alergias", ["antigripal"], "gripe e resfriado"),
    (r"\btosse\b|garganta", "alergias", ["xarope"], "tosse e garganta"),
    (r"azia|estomago|ma digestao|enjoo|nausea|diarreia|intestin|gases|refluxo", "gastro", [], "estômago e intestino"),
    (r"pressao|coracao|colesterol", "coracao", [], "coração e pressão"),
    (r"diabet|glicose|acucar no sangue", "diabetes", [], "diabetes"),
    (r"insonia|dormir|ansiedade|estresse|calmante", "sistema_nervoso", [], "sono e ansiedade"),
    (r"vitamina|suplement|imunidade|cansaco|energia|proteina|colageno", "vitaminas", [], "vitaminas e suplementos"),
    (r"\bpele\b|acne|espinha|manchas|hidratante|protetor solar|solar", "dermato", [], "cuidados com a pele"),
    (r"\bbebe\b|crianca|infantil|filho", "infantil", [], "infantil"),
    (r"curativo|machucad|corte|ferida|queimadura|band aid", "primeiros_socorros", [], "primeiros socorros"),
    (r"anticoncepc|menstrua|colica menstrual|gravidez", "saude_mulher", [], "saúde da mulher"),
]

# Palavras que não identificam produto (pedido, cortesia, conectivos)
PARADAS = set("""
a o as os um uma uns umas de do da dos das no na nos nas em para por com sem e ou
eu voce voces vc tem tenho temos ter quero queria gostaria preciso precisava procuro procurando
estou to tou esta estao me ve vende vendem comprar compra algum alguma alguns algumas coisa coisas
remedio remedios medicamento medicamentos produto produtos farmacia aqui ai la isso esse essa
bom boa dia tarde noite ola oi favor obrigado obrigada sim nao qual quais onde fica tipo
sinto sentindo estou com ta muito mais forte alguma bem algo meu minha meus minhas filho filha
pro pros pras ele ela dele dela seu sua tudo nada pouco dando doendo tomar usar serve
que seja preferencia assim pode ser alguma tipo uns gostava daria poderia mostrar ver
""".split())

# Palavras que só descrevem o sintoma (já tratado pela categoria); não buscam produto.
# Palavras de produto ("vitamina", "protetor", "xarope") continuam como termos.
PALAVRAS_SINTOMA = set("""
dor dores cabeca febre alergia alergiar alergico coceira rinite espirro espirrando gripe gripado
resfriado resfriada tosse tossindo garganta azia estomago enjoo nausea diarreia intestino gases
refluxo pressao coracao colesterol diabetes glicose insonia dormir ansiedade estresse pele espinha
espinhas acne manchas bebe crianca infantil machucado corte ferida queimadura colica muscular
cansaco imunidade energia nariz entupido congestao coriza
""".split())


def interpretar(texto: str) -> dict[str, Any]:
    """Extrai do pedido os termos de produto e a categoria do sintoma citado."""
    norm = _norm(texto)
    sintoma = None
    for padrao, categoria, extras, rotulo in SINTOMAS:
        if re.search(padrao, norm):
            sintoma = {"categoria": categoria, "extras": extras, "rotulo": rotulo, "padrao": padrao}
            break
    # "vitamina c", "vitamina b12": a letra faz parte do nome do produto
    norm_termos = re.sub(r"\bvitamina ([a-z]\d{0,2})\b", r"vitamina_\1", norm)
    termos = [p.replace("_", " ") for p in norm_termos.split()
              if p not in PARADAS and p not in PALAVRAS_SINTOMA and len(p) > 2]
    return {"texto": texto, "normalizado": norm, "termos": termos, "sintoma": sintoma}


# ─── Vocabulário do catálogo (para corrigir termos mal transcritos) ──────────
_vocab: dict[str, Any] = {"palavras": [], "grafia": {}, "atualizado": 0.0}


def _vocabulario(listar_todos: Callable[[], list[dict[str, Any]]]) -> list[str]:
    """Palavras do catálogo (normalizadas). Guarda também a grafia original com
    acento, porque a busca no banco diferencia "liquido" de "líquido"."""
    if time.time() - _vocab["atualizado"] > 600 or not _vocab["palavras"]:
        grafia: dict[str, str] = {}
        for p in listar_todos():
            for original in re.findall(r"[^\W\d_]+", f"{p.get('nome', '')} {p.get('tipo', '')}".lower()):
                w = _norm(original)
                if len(w) >= 4:
                    grafia.setdefault(w, original)
        _vocab.update(palavras=sorted(grafia), grafia=grafia, atualizado=time.time())
    return _vocab["palavras"]


def _com_acento(termo: str) -> str:
    return " ".join(_vocab["grafia"].get(p, p) for p in termo.split())


def _fonetica(palavra: str) -> str:
    """Chave fonética simples do português falado: a transcrição costuma trocar
    o/u, e/i e grafias de mesmo som ("piruna" ~ "dipirona", "sabaun" ~ "sabão")."""
    p = palavra
    for a, b in (("ch", "x"), ("lh", "li"), ("nh", "ni"), ("ph", "f"), ("qu", "k"), ("ss", "s"),
                 ("y", "i"), ("w", "v"), ("h", "")):
        p = p.replace(a, b)
    p = re.sub(r"c(?=[ei])", "s", p)
    p = re.sub(r"g(?=[ei])", "j", p)
    p = p.replace("c", "k").replace("z", "s").replace("o", "u").replace("e", "i")
    return re.sub(r"(.)\1+", r"\1", p)   # letras repetidas


def _semelhanca(termo: str, palavra: str) -> float:
    a, b = _fonetica(termo), _fonetica(palavra)
    if a == b:
        return 1.0
    if len(a) >= 5 and a in b:             # "piruna" dentro de "dipiruna"
        return 0.9
    return difflib.SequenceMatcher(None, a, b).ratio()


def corrigir_termos(termos: list[str], vocab: list[str]) -> list[str]:
    """Troca cada termo pela palavra do catálogo de som mais parecido, se houver
    uma bem parecida (ex.: "piruna" -> "dipirona"). Termos curtos ou sem par
    próximo ficam como estão, para não virar outro produto à força."""
    corrigidos: list[str] = []
    for termo in termos:
        if termo in vocab or len(termo) < 4 or " " in termo:
            corrigidos.append(termo)
            continue
        melhor = max(vocab, key=lambda w: _semelhanca(termo, w), default=None)
        if melhor and _semelhanca(termo, melhor) >= 0.82:
            corrigidos.append(melhor)
        else:
            corrigidos.append(termo)
    return list(dict.fromkeys(corrigidos))   # sem repetidos, mantendo a ordem


# ─── Busca + resposta ────────────────────────────────────────────────────────
def atender(texto: str, listar: Callable[..., tuple[list[dict[str, Any]], int]],
            limite: int = 12) -> dict[str, Any]:
    """Interpreta o pedido e busca os produtos. `listar` é supabase_products.listar."""
    pedido = interpretar(texto)
    vocab = _vocabulario(lambda: listar(only_active=True)[0])
    termos = [_com_acento(t) for t in corrigir_termos(pedido["termos"], vocab)]
    sintoma = pedido["sintoma"]

    encontrados: dict[str, dict[str, Any]] = {}

    def juntar(itens: list[dict[str, Any]]) -> None:
        for p in itens:
            encontrados.setdefault(str(p["id"]), p)

    # 1) o produto citado: produtos com TODOS os termos; se não houver, tira o
    #    último termo e tenta de novo ("protetor solar rosto cor" -> "protetor solar")
    principais = termos   # os termos que, juntos, acharam o produto
    if termos:
        for n in range(len(termos), 0, -1):
            achados = listar(todos_termos=termos[:n], limit=limite)[0]
            if achados:
                juntar(achados)
                principais = termos[:n]
                break
        for t in termos:   # completa com cada termo sozinho
            if len(encontrados) >= limite:
                break
            juntar(listar(q=t, limit=limite)[0])
    citado = len(encontrados) > 0
    # 2) o sintoma: princípios ativos comuns e a categoria correspondente
    if sintoma and len(encontrados) < limite:
        for extra in sintoma["extras"]:
            juntar(listar(q=extra, limit=6)[0])
        juntar(listar(categoria=sintoma["categoria"], limit=limite)[0])

    # Relevância: frase inteira no nome > todos os termos no nome > algum termo no nome
    def relevancia(p: dict[str, Any]) -> int:
        nome = _norm(p.get("nome", ""))
        ts = [_norm(t) for t in termos]
        frase = " ".join(ts)
        return (3 * (bool(frase) and frase in nome)
                + sum(2 for t in ts if t in nome)
                + sum(1 for t in ts if t in _norm(p.get("tipo", "") or "")))

    produtos = sorted(encontrados.values(), key=relevancia, reverse=True)[:limite]
    # A resposta e a vitrine usam só os termos que acharam o produto
    # ("protetor solar para o rosto, de preferência com cor" -> "protetor solar")
    termos = principais
    busca = " ".join(termos) if citado else (sintoma["rotulo"] if sintoma else "")

    if not texto.strip():
        resposta = "Não consegui ouvir. Toque no microfone e fale o nome do produto ou o que está sentindo."
    elif not produtos:
        resposta = f"Não encontrei produtos para \"{texto.strip()}\". Tente falar o nome do produto de outro jeito."
    elif citado:
        resposta = f"Encontrei {len(produtos)} produto{'s' if len(produtos) > 1 else ''} para {busca}."
    else:
        resposta = (f"Para {sintoma['rotulo']}, separei {len(produtos)} opções. "
                    "Antes de usar, confirme com o farmacêutico.")
    return {
        "texto": texto,
        "termos": termos,
        "sintoma": sintoma["rotulo"] if sintoma else None,
        "categoria": sintoma["categoria"] if sintoma else None,
        "busca": busca,
        "resposta": resposta,
        "produtos": produtos,
    }
