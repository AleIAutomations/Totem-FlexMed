# FlexMed v5 — instruções para o Claude

## Documentação viva (obrigatório)
Toda mudança no sistema atualiza, na mesma tarefa:
- `docs/ARQUITETURA.md` — quando entra ou muda módulo, rota, tabela, fluxo de dados, modelo ou forma de rodar. Contextualize a peça nova na seção certa e adicione uma linha no "Histórico de mudanças" (data + o que mudou).
- `docs/FUNCIONALIDADES_TOTEM.md` — quando entra ou muda algo que o cliente do totem ou a farmácia (admin) vê ou usa. Mesma regra do histórico.

## Restrições
- A secret key do Supabase fica só em `backend/.env`, nunca no frontend.
- LGPD: não guardar imagem nem dado do rosto; só faixa etária, se olhou e por quanto tempo.
- Não instalar o pacote `onnx` no `.venv` (quebra o `ml-dtypes` do TensorFlow); use um venv separado.
- Desenvolvimento: `cd backend && FLEXMED_HTTPS=0 ../.venv/bin/python app.py` (http://localhost:5050). Totem: `main/start.sh` (HTTPS).
