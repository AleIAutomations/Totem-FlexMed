#!/bin/bash
# =====================================================
# FlexMed v5 — comandos do dia a dia (macOS/Linux)
#
#   ./flexmed.sh iniciar     sobe para o totem (HTTPS na rede, em segundo plano)
#   ./flexmed.sh parar       derruba o servidor
#   ./flexmed.sh reiniciar   parar + iniciar
#   ./flexmed.sh status      está no ar? mostra os endereços e testa a API
#   ./flexmed.sh ip          endereço para digitar no totem
#   ./flexmed.sh logs        acompanha o log ao vivo (Ctrl+C sai só do log)
#   ./flexmed.sh dev         modo desenvolvimento (HTTP, só neste notebook, no terminal)
#   ./flexmed.sh abrir       abre o admin no navegador deste notebook
#
# Detalhes e solução de problemas: README.md, seção "Apresentação / totem".
# =====================================================

RAIZ="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$RAIZ/backend"
PY="$RAIZ/.venv/bin/python"
PORTA="${FLEXMED_PORT:-5050}"
LOGS="$RAIZ/logs"
LOG="$LOGS/flexmed.log"
CERT="$BACKEND/certs/flexmed.crt"
KEY="$BACKEND/certs/flexmed.key"

verde()   { printf "\033[32m%s\033[0m\n" "$*"; }
amarelo() { printf "\033[33m%s\033[0m\n" "$*"; }
vermelho(){ printf "\033[31m%s\033[0m\n" "$*"; }

# IP deste notebook na rede (o que o totem usa)
ip_rede() {
  local iface ip
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  [ -n "$iface" ] && ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"
  [ -z "$ip" ] && ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
  [ -z "$ip" ] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"   # Linux
  echo "${ip:-127.0.0.1}"
}

# PIDs escutando na porta do FlexMed
pids_porta() { lsof -t -iTCP:"$PORTA" -sTCP:LISTEN 2>/dev/null; }

esquema_atual() {
  # descobre se o servidor no ar está em HTTPS ou HTTP
  if curl -sk -o /dev/null --max-time 3 "https://127.0.0.1:$PORTA/health"; then echo https
  elif curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORTA/health"; then echo http
  fi
}

conferir_python() {
  if [ ! -x "$PY" ]; then
    vermelho "Não achei o Python do projeto em $PY"
    echo "Crie o ambiente (README, seção 3) ou ajuste a variável PY no topo deste script."
    exit 1
  fi
}

garantir_certificado() {
  [ -f "$CERT" ] && [ -f "$KEY" ] && return 0
  amarelo "Certificado HTTPS não encontrado: criando um autoassinado em backend/certs/"
  mkdir -p "$BACKEND/certs"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$KEY" -out "$CERT" -subj "/CN=FlexMed" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1 \
    || { vermelho "Falhou ao criar o certificado (openssl instalado?)"; exit 1; }
}

mostrar_enderecos() {
  local esq="${1:-$(esquema_atual)}" ip
  ip="$(ip_rede)"
  echo
  verde "FlexMed no ar ($esq, porta $PORTA)"
  echo "  Totem (digite no kiosk) : $esq://$ip:$PORTA/index.html"
  echo "  Admin no totem          : $esq://$ip:$PORTA/admin.html"
  echo "  Neste notebook          : $esq://localhost:$PORTA/index.html"
  if [ "$esq" = "http" ]; then
    amarelo "  Atenção: em HTTP o totem Android não libera a câmera. Para o totem use ./flexmed.sh iniciar"
  fi
  echo
}

cmd_parar() {
  local pids
  pids="$(pids_porta)"
  if [ -z "$pids" ]; then
    echo "Nada rodando na porta $PORTA."
  else
    echo "Parando FlexMed (PID $(echo $pids | tr '\n' ' '))..."
    kill $pids 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [ -z "$(pids_porta)" ] && break
      sleep 0.5
    done
    pids="$(pids_porta)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null
    verde "Parado."
  fi
  pkill -f "caffeinate.*flexmed-keepawake" 2>/dev/null
  return 0
}

cmd_iniciar() {
  conferir_python
  garantir_certificado
  if [ -n "$(pids_porta)" ]; then
    amarelo "Já tem algo na porta $PORTA: reiniciando."
    cmd_parar
  fi
  mkdir -p "$LOGS"
  [ -f "$LOG" ] && mv "$LOG" "$LOG.anterior"
  echo "Subindo FlexMed para o totem (HTTPS, aceitando conexões da rede)..."
  # 0.0.0.0 = o totem acessa pelo IP do notebook; -u = log sem atraso
  cd "$BACKEND" || exit 1
  FLEXMED_HOST=0.0.0.0 FLEXMED_PORT="$PORTA" FLEXMED_HTTPS=1 nohup "$PY" -u app.py >>"$LOG" 2>&1 &
  local pid=$!
  # Espera a API responder (modelos de visão e Whisper levam alguns segundos)
  for _ in $(seq 1 90); do
    if curl -sk -o /dev/null --max-time 2 "https://127.0.0.1:$PORTA/health"; then
      # impede o Mac de dormir enquanto o servidor estiver no ar
      if command -v caffeinate >/dev/null; then
        (exec -a flexmed-keepawake caffeinate -i -s -w "$pid" >/dev/null 2>&1 &)
      fi
      mostrar_enderecos https
      echo "Log: ./flexmed.sh logs    Parar: ./flexmed.sh parar"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || break   # o Python caiu: mostra o erro
    sleep 1
  done
  vermelho "O servidor não respondeu. Últimas linhas do log ($LOG):"
  tail -n 30 "$LOG"
  exit 1
}

cmd_status() {
  local pids esq
  pids="$(pids_porta)"
  if [ -z "$pids" ]; then
    vermelho "FlexMed parado (nada na porta $PORTA). Suba com: ./flexmed.sh iniciar"
    exit 1
  fi
  esq="$(esquema_atual)"
  if [ -z "$esq" ]; then
    amarelo "Tem processo na porta $PORTA (PID $pids), mas a API não respondeu. Veja: ./flexmed.sh logs"
    exit 1
  fi
  echo "Processo: PID $(echo $pids | tr '\n' ' ')"
  if lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN 2>/dev/null | grep -q "127.0.0.1:$PORTA"; then
    amarelo "Escutando só em 127.0.0.1: o totem NÃO consegue acessar. Use ./flexmed.sh iniciar"
  fi
  local ip code
  ip="$(ip_rede)"
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$esq://$ip:$PORTA/index.html")"
  echo "Teste pelo IP da rede ($ip): HTTP $code"
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$esq://127.0.0.1:$PORTA/api/products")"
  echo "Teste do catálogo (/api/products): HTTP $code"
  mostrar_enderecos "$esq"
}

cmd_dev() {
  conferir_python
  [ -n "$(pids_porta)" ] && cmd_parar
  echo "Modo desenvolvimento: http://localhost:$PORTA/index.html (Ctrl+C para parar)"
  cd "$BACKEND" && FLEXMED_HOST=127.0.0.1 FLEXMED_PORT="$PORTA" FLEXMED_HTTPS=0 exec "$PY" app.py
}

cmd_logs() {
  [ -f "$LOG" ] || { echo "Ainda não há log em $LOG (o modo dev escreve no próprio terminal)."; exit 1; }
  tail -n 50 -f "$LOG"
}

cmd_abrir() {
  local esq
  esq="$(esquema_atual)"
  [ -z "$esq" ] && { vermelho "FlexMed parado. Suba com: ./flexmed.sh iniciar"; exit 1; }
  open "$esq://localhost:$PORTA/admin.html" 2>/dev/null || xdg-open "$esq://localhost:$PORTA/admin.html"
}

case "${1:-}" in
  iniciar|start)     cmd_iniciar ;;
  parar|stop)        cmd_parar ;;
  reiniciar|restart) cmd_parar; cmd_iniciar ;;
  status)            cmd_status ;;
  ip)                echo "https://$(ip_rede):$PORTA/index.html" ;;
  logs|log)          cmd_logs ;;
  dev)               cmd_dev ;;
  abrir|open)        cmd_abrir ;;
  *)
    sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'
    [ -n "${1:-}" ] && { echo; vermelho "Comando desconhecido: $1"; exit 1; }
    ;;
esac
