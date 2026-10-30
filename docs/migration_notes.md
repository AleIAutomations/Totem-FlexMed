# Notas de consolidação — FlexMed v5

## Removido

- Ambientes virtuais empacotados: `venv`, `Scripts`, `site-packages`, `back-venv-*`, `venv-lib-*`.
- Artefatos de sistema operacional: `_MACOSX`, `.DS_Store`.
- Caches Python: `__pycache__`, `.pyc`.
- Modelo/dataset legado de Libras baseado apenas em mãos como caminho ativo.
- Chave Supabase hardcoded no frontend. O frontend agora fala com `backend/app.py`.

## Mantido como padrão

- Arquitetura nova de LibrasFlow v2: imagens, vídeos, PDFs, face, mãos, postura e sequência frame a frame.
- Frontend do totem e painel admin.
- Player de campanhas em standby.
- Coleta de métricas de visão somente em standby.

## Ajustes de estabilidade

- Controle de câmera exclusivo entre visão de anúncios e Libras.
- Timeout padrão de standby alterado para 300 segundos.
- `gravar_dataset.py` corrigido: havia import inválido em Python.
- `script.js` corrigido: referência inexistente a `PRODUCTS` substituída por `produtos`.
- `script.js` corrigido: métrica `incMetric` agora chama backend.
- `script.js` limpo: removido caractere NUL que fazia ferramentas tratarem o arquivo como binário.
- Scripts de Libras receberam logs de progresso/ETA.
