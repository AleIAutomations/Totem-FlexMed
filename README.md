# FlexMed v5

Totem de autoatendimento para farmácias com:

- catálogo de produtos e busca assistida;
- painel administrativo;
- campanhas/anúncios em modo standby;
- métricas de campanhas por visão computacional;
- interpretação de Libras com arquitetura nova baseada em mãos, expressão facial e postura;
- controle de câmera compartilhada para impedir conflito entre anúncios e Libras.

Este pacote foi consolidado a partir dos 5 ZIPs enviados. Foram removidos ambientes virtuais, `site-packages`, caches, `_MACOSX`, binários de ambiente e código legado redundante. O modelo antigo baseado apenas em mãos/Random Forest não foi mantido como caminho ativo. A estrutura de Libras padrão é a nova, com vídeos, PDFs, expressões faciais, mãos e postura.

---

## ⚡ Guia rápido — apresentação / totem

Tudo roda por um único script na raiz do projeto: **`./flexmed.sh`**. Abra o terminal do VS Code (**Ctrl+`**); ele já abre na pasta do projeto.

### Passo a passo no dia

1. **Notebook e totem na mesma rede Wi-Fi.**
2. **Suba o sistema:**
   ```bash
   ./flexmed.sh iniciar
   ```
   Em ~5 segundos aparece algo assim:
   ```text
   FlexMed no ar (https, porta 5050)
     Totem (digite no kiosk) : https://192.168.0.243:5050/index.html
     Admin no totem          : https://192.168.0.243:5050/admin.html
     Neste notebook          : https://localhost:5050/index.html
   ```
   O servidor fica rodando **em segundo plano**: pode fechar o terminal que ele continua. Enquanto estiver no ar, o Mac não entra em repouso (mantenha o carregador ligado e a tampa aberta).
3. **No totem (kiosk)**, coloque como página inicial o endereço da linha "Totem". **O IP muda conforme a rede**: no local da apresentação, rode `./flexmed.sh ip` e confira se o endereço do kiosk é o mesmo.
4. **Certificado:** na primeira vez o navegador diz que a conexão "não é particular". Toque em **Avançado → Continuar**. No **Fully Kiosk Browser**: *Settings → Web Content Settings → Ignore SSL Errors* = ligado. Permita **câmera** e **microfone** quando ele pedir.
5. **Libras:** ao tocar em **Libras** no totem, a câmera usada é a **do notebook**. Ela fica **sempre ligada** (a luz verde do Mac fica acesa) para a imagem aparecer na hora; para desligar isso, use `FLEXMED_LIBRAS_SEMPRE_LIGADA=0` no `backend/.env`. Deixe o notebook ao lado do totem, com a câmera virada para quem vai sinalizar, a ~60–80 cm, com luz no rosto e nas mãos. A pessoa faz cada letra parada por ~1 s. Para voltar à câmera do totem: `FLEXMED_LIBRAS_CAMERA=totem` no `backend/.env` e `./flexmed.sh reiniciar`.
6. **Painel admin:** pela engrenagem discreta no topo do totem. Ele abre por cima do totem e a câmera continua capturando. Ou pelo notebook: `./flexmed.sh abrir`.

### Todos os comandos

| Comando | O que faz |
|---|---|
| `./flexmed.sh iniciar` | Sobe para o totem: HTTPS, aceita conexões da rede, em segundo plano. Se já houver algo na porta 5050, reinicia. |
| `./flexmed.sh status` | Mostra se está no ar, testa a página pelo IP da rede e o catálogo, e imprime os endereços. |
| `./flexmed.sh ip` | Só o endereço para digitar no totem. |
| `./flexmed.sh logs` | Log ao vivo (Ctrl+C sai do log, o servidor continua). Fica em `logs/flexmed.log`; o da execução anterior, em `logs/flexmed.log.anterior`. |
| `./flexmed.sh reiniciar` | Parar + iniciar (use depois de mudar código do backend). |
| `./flexmed.sh parar` | Derruba o servidor. |
| `./flexmed.sh abrir` | Abre o admin no navegador do notebook. |
| `./flexmed.sh dev` | Desenvolvimento: HTTP, só `localhost`, log no próprio terminal. **O totem não acessa nesse modo.** |

Sem digitar nada: **Cmd+Shift+P → "Tasks: Run Task" → FlexMed: …** (definidas em `.vscode/tasks.json`). **Cmd+Shift+B** = iniciar.

Mudou só arquivo do `frontend/` (HTML/JS/CSS)? Não precisa reiniciar: recarregue a página no totem.

### Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Navegador do notebook dá "demorou muito para responder" ou "não é particular" | Use **`https://localhost:5050/index.html`** (`http://` agora redireciona sozinho). No aviso de certificado: **Avançado → Continuar**. Se travou mesmo, `./flexmed.sh reiniciar`. |
| Totem não abre a página | `./flexmed.sh status`. Se "Teste pelo IP da rede" não der 200, o servidor está no modo errado: `./flexmed.sh iniciar`. Se der 200 aqui mas não no totem: confira se estão na **mesma rede** e se o **IP** no kiosk é o atual (`./flexmed.sh ip`). |
| Rede do evento bloqueia aparelhos entre si (Wi-Fi de visitante) | Ligue o **roteador do celular**, conecte notebook e totem nele, rode `./flexmed.sh ip` e atualize o endereço no kiosk. |
| Libras no totem mostra "Erro: camera_unavailable" | A câmera do notebook está em uso (feche Zoom, FaceTime ou Photo Booth) ou sem permissão: *Ajustes do Sistema → Privacidade e Segurança → Câmera* → libere o app de onde você rodou o `./flexmed.sh` (VS Code ou Terminal) e rode `./flexmed.sh reiniciar` por ele. |
| Admin no totem sem as outras páginas | Toque em **Menu**, no topo do painel. |
| Câmera não liga no totem | Precisa ser **https://** (não http). Confira a permissão de câmera no kiosk/Chrome do totem e recarregue a página. |
| "Address already in use" / porta ocupada | `./flexmed.sh parar` e depois `./flexmed.sh iniciar`. |
| `iniciar` diz que o servidor não respondeu | Ele mostra as últimas linhas do log com o erro. Para ver tudo: `cat logs/flexmed.log`. |
| Produtos não aparecem | Precisa de internet (catálogo no Supabase) e do `backend/.env` com as chaves. Teste: `curl -k https://localhost:5050/api/products`. |
| Mac sem a pasta `.venv` | Siga a seção 3 (instalação). |

### Rodar na mão, sem o script

```bash
cd backend
FLEXMED_HOST=0.0.0.0 FLEXMED_HTTPS=1 ../.venv/bin/python app.py     # totem (HTTPS na rede)
FLEXMED_HTTPS=0 ../.venv/bin/python app.py                          # desenvolvimento (http://localhost:5050)
```

Para parar: **Ctrl+C** no mesmo terminal. Se ele ficou perdido em segundo plano:

```bash
lsof -ti tcp:5050 | xargs kill        # derruba o que estiver na porta 5050
ipconfig getifaddr en0                # IP do notebook no Wi-Fi
```

O antigo `bash main/start.sh` continua funcionando (HTTPS na rede, preso ao terminal, abre o admin sozinho).

---

## 1. Estrutura final

```text
flexmed.v5/
├── flexmed.sh            ← iniciar / parar / status (guia rápido acima)
├── logs/                 ← log do servidor (criado pelo flexmed.sh)
├── main/
│   ├── start.py
│   ├── start.sh
│   └── start_windows.bat
├── frontend/
│   ├── index.html
│   ├── admin.html
│   ├── api.js
│   ├── campaign_player.js
│   ├── standby.js
│   ├── libras_integration.js
│   ├── script.js
│   ├── styles.css
│   └── assets/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── data/
│   │   └── seed_products.json
│   ├── uploads/campanhas/
│   └── libras/
│       ├── config.py
│       ├── utils.py
│       ├── coleta.py
│       ├── gravar_dataset.py
│       ├── treinar.py
│       ├── verificar_dataset.py
│       ├── main.py
│       ├── progress.py
│       ├── dataset/
│       │   ├── train/
│       │   ├── videos/
│       │   └── pdfs/
│       ├── data/
│       └── models/
└── docs/
    └── migration_notes.md
```

---

## 2. Requisitos

Use **Python 3.9, 3.10 ou 3.11**. A versão recomendada é **Python 3.11**. Python 3.12+ pode ter incompatibilidades com MediaPipe/TensorFlow em alguns ambientes; valide antes de usar em produção.

Também é necessário:

- webcam funcional;
- navegador moderno;
- Windows, macOS ou Linux;
- pelo menos 4 GB de RAM para uso do totem;
- mais memória/CPU/GPU para treinamento de modelos.

---

## 3. Instalação em computador novo

### Windows PowerShell

```powershell
cd flexmed.v5
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
```

### macOS/Linux

```bash
cd flexmed.v5
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
```

Teste rápido:

```bash
python -c "import flask, cv2, mediapipe, numpy; print('Dependências principais OK')"
```

---

## 4. Rodar o sistema completo

Veja o **Guia rápido** no topo. Resumo: o backend serve o totem, o admin e a API na mesma porta (**5050**). Não existe mais servidor separado do frontend (porta 3000).

| Modo | Comando | Endereço |
|---|---|---|
| Totem (rede, HTTPS) | `./flexmed.sh iniciar` | `https://<IP do notebook>:5050/index.html` |
| Desenvolvimento | `./flexmed.sh dev` | `http://localhost:5050/index.html` |
| Windows | `main\start_windows.bat` | o endereço aparece no terminal |

O totem Android só libera a câmera e o microfone do navegador em **HTTPS**. O certificado autoassinado fica em `backend/certs/` (criado sozinho se faltar).

---

## 5. Painel admin

Na demonstração o admin **não pede senha**. Pela engrenagem do totem ele abre **por cima** do totem (a câmera continua capturando); "Ver Totem" ou "Sair" fecham o painel. Direto pelo endereço: `/admin.html`.

Para produção/white label real, mova autenticação para backend, banco e sessão segura.

---

## 6. Banco local

O backend usa SQLite por padrão:

```text
backend/data/flexmed.sqlite3
```

Na primeira execução, ele cria as tabelas e carrega produtos iniciais de:

```text
backend/data/seed_products.json
```

Para reiniciar os dados locais:

```bash
rm backend/data/flexmed.sqlite3
python backend/app.py
```

No Windows PowerShell:

```powershell
Remove-Item backend\data\flexmed.sqlite3
python backend\app.py
```

---

## 7. Câmera, anúncios e Libras

- A câmera fica **sempre ligada** medindo audiência (~6 frames/s): quantas pessoas, se olham para a tela e a faixa etária estimada. **Não guarda imagem nem dado do rosto** (LGPD).
- Sem interação, o totem entra em modo anúncios; ao detectar alguém se aproximando, acorda.
- Ao abrir **Libras**, a audiência pausa e a câmera passa ao reconhecimento de sinais; ao fechar, volta.
- O admin pode desligar a câmera do totem (Presença).

Detalhes técnicos em `docs/ARQUITETURA.md`; o que o cliente e a farmácia veem em `docs/FUNCIONALIDADES_TOTEM.md`.

---

## 8. LibrasFlow v2 — arquitetura mantida

A pasta ativa é:

```text
backend/libras/
```

A arquitetura usa:

- MediaPipe Holistic;
- Face Mesh com pontos expressivos;
- Pose do torso/superior;
- duas mãos;
- sequências de vídeo frame a frame;
- normalização por ombro;
- modelo estático para letras/sinais sem movimento;
- modelo temporal com Conv1D/LSTM para sinais com movimento.

A estrutura esperada do dataset novo é:

```text
backend/libras/dataset/
├── train/
│   ├── A/
│   ├── B/
│   └── ...
├── videos/
│   ├── oi/
│   │   ├── 001.mp4
│   │   └── ...
│   └── obrigado/
└── pdfs/
    ├── apostila_libras.pdf
    └── dicionario_libras.pdf
```

---

## 9. Comandos de Libras

Entre na pasta:

```bash
cd flexmed.v5/backend/libras
```

Verificar dataset:

```bash
python verificar_dataset.py
```

Gravar vídeos pela webcam:

```bash
python gravar_dataset.py --sinais oi tchau obrigado --n 50
```

Processar imagens estáticas:

```bash
python coleta.py --imagens
```

Processar vídeos:

```bash
python coleta.py --videos
```

Processar PDFs:

```bash
python coleta.py --pdfs
```

Aplicar data augmentation nos vídeos:

```bash
python coleta.py --aug
```

Executar tudo em sequência:

```bash
python coleta.py --tudo
```

Treinar somente modelo estático:

```bash
python treinar.py --estatico
```

Treinar somente modelo de vídeo:

```bash
python treinar.py --video
```

Treinar tudo:

```bash
python treinar.py --tudo
```

Rodar reconhecimento local em janela OpenCV:

```bash
python main.py
```

Os scripts de coleta, gravação e treino imprimem progresso, tempo decorrido e ETA no terminal.

---

## 10. Campanhas/anúncios

No painel admin:

```text
https://localhost:5050/admin.html
```

A área de campanhas usa as funções do `frontend/api.js`, que conversam com o backend local. Uploads de mídia são salvos em:

```text
backend/uploads/campanhas/
```

As campanhas ativas são exibidas no standby conforme prioridade, data e duração.

---

## 11. Testes básicos antes de deploy

```bash
.venv/bin/python -m py_compile backend/app.py backend/libras/*.py
./flexmed.sh iniciar
./flexmed.sh status        # deve mostrar HTTP 200 no IP da rede e no catálogo
curl -k https://localhost:5050/health
```

---

## 12. Observações para deploy

- Não suba `.venv/`, `venv/`, `node_modules/`, `__pycache__/`, `_MACOSX/` ou `site-packages/`.
- Não coloque chaves `service_role` ou credenciais sensíveis em `frontend/api.js`.
- Para produção, rode o backend atrás de um servidor WSGI como Waitress/Gunicorn e configure HTTPS.
- O SQLite é suficiente para protótipo e banca acadêmica; para white label multiunidade, migre para PostgreSQL/Supabase com chaves no backend.
- O dataset grande deve ser versionado fora do ZIP principal, por exemplo em storage próprio ou DVC.
