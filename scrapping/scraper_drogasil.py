import os
import json
import time
import re
import logging
import urllib.request
from datetime import datetime
from playwright.sync_api import sync_playwright

# Configuração de Logging para monitorar a execução
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class DrogasilScraper:
    def __init__(self, base_url="https://www.drogasil.com.br"):
        self.base_url = base_url
        self.dados_produtos = []
        self.dir_imagens = "imagens_drogasil"
        os.makedirs(self.dir_imagens, exist_ok=True)

    def _verificar_receita(self, texto_completo):
        """Verifica se o produto provavelmente precisa de receita com base em palavras-chave no card."""
        palavras_chave = ['tarja preta', 'tarja vermelha', 'controlado', 'receita médica', 'prescrição', 'antibiótico', 'venda sob prescrição']
        texto_lower = texto_completo.lower()
        return any(palavra in texto_lower for palavra in palavras_chave)

    def _limpar_preco(self, texto_preco):
        """Extrai o valor numérico do preço (ex: 'R$ 37,39' -> 37.39)."""
        if not texto_preco:
            return 0.0
        numeros = re.findall(r'[\d.,]+', texto_preco)
        if numeros:
            valor = numeros[0].replace('.', '').replace(',', '.')
            return float(valor)
        return 0.0

    def _baixar_imagem(self, url_imagem, nome_arquivo):
        """Baixa a imagem do produto e salva localmente."""
        try:
            if not url_imagem.startswith('http'):
                url_imagem = self.base_url + url_imagem if url_imagem.startswith('/') else self.base_url + '/' + url_imagem
            
            # Headers para evitar bloqueio 403 no download da imagem
            req = urllib.request.Request(url_imagem, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req, timeout=15) as response:
                caminho_completo = os.path.join(self.dir_imagens, nome_arquivo)
                with open(caminho_completo, 'wb') as f:
                    f.write(response.read())
                return caminho_completo
        except Exception as e:
            logging.warning(f"Falha ao baixar imagem {url_imagem}: {e}")
        return None

    def executar_scraping(self, url_alvo):
        """Lê o site, extrai informações e retorna os dados."""
        logging.info(f"Iniciando scraping em: {url_alvo}")
        produtos_encontrados = []

        with sync_playwright() as p:
            # Lança o navegador em modo headless (invisível, mas pode mudar para False para ver a tela)
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            page = context.new_page()

            try:
                # Aguarda até que a rede esteja inativa (página carregada)
                page.goto(url_alvo, wait_until='networkidle', timeout=60000)
                
                # Aguarda um elemento comum de produto do VTEX IO carregar
                page.wait_for_selector('.vtex-product-summary-2-x-productBrand, .product-name, h2, h3', timeout=15000)
                
                # Rola a página para baixo para acionar o "lazy loading" de imagens e preços
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(3) 

                # Extrai os dados diretamente do DOM usando JavaScript
                dados_raw = page.evaluate('''() => {
                    const produtos = [];
                    // Seletores típicos de cards de produto no VTEX IO (Drogasil)
                    const elementos = document.querySelectorAll('.vtex-product-summary-2-x-container, .shelf-item, .product-card, [data-testid="product-card"]');
                    
                    elementos.forEach(el => {
                        const nomeEl = el.querySelector('.vtex-product-summary-2-x-productBrand, .product-name, h2, h3');
                        const precoEl = el.querySelector('.vtex-product-summary-2-x-currencyContainer, .product-price, .price');
                        const imgEl = el.querySelector('img');
                        const linkEl = el.querySelector('a[href]');
                        const categoriaEl = el.querySelector('.vtex-product-summary-2-x-productClusterContainer, .categoria');
                        
                        produtos.push({
                            nome: nomeEl ? nomeEl.innerText.trim() : 'Nome não encontrado',
                            categoria: categoriaEl ? categoriaEl.innerText.trim() : 'Não especificado',
                            preco_str: precoEl ? precoEl.innerText.trim() : '0',
                            img_url: imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : null,
                            url: linkEl ? linkEl.href : null,
                            texto_completo: el.innerText
                        });
                    });
                    return produtos;
                }''')

                for item in dados_raw:
                    # Sanitiza o nome para criar um nome de arquivo seguro
                    nome_limpo = re.sub(r'[^\w\s-]', '', item['nome'])[:50].strip().replace(' ', '_')
                    nome_arquivo = f"{nome_limpo}_{int(time.time())}.jpg" if nome_limpo else f"produto_{int(time.time())}.jpg"
                    
                    caminho_imagem = None
                    if item['img_url']:
                        caminho_imagem = self._baixar_imagem(item['img_url'], nome_arquivo)

                    produto = {
                        'nome': item['nome'],
                        'tipo': item['categoria'],
                        'preco': self._limpar_preco(item['preco_str']),
                        'precisa_receita': self._verificar_receita(item['texto_completo']),
                        'imagem_url_original': item['img_url'],
                        'imagem_local': caminho_imagem,
                        'url': item['url'],
                        'data_coleta': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    }
                    produtos_encontrados.append(produto)

                logging.info(f"✅ Encontrados {len(produtos_encontrados)} produtos nesta página.")
                self.dados_produtos.extend(produtos_encontrados)

            except Exception as e:
                logging.error(f"❌ Erro ao processar a página {url_alvo}: {e}")
            finally:
                browser.close()

        return self.dados_produtos

    def salvar_dados(self, arquivo_saida="produtos_drogasil.json"):
        """Salva os dados coletados em um arquivo JSON."""
        try:
            with open(arquivo_saida, 'w', encoding='utf-8') as f:
                json.dump(self.dados_produtos, f, ensure_ascii=False, indent=4)
            logging.info(f"💾 Dados salvos com sucesso em {arquivo_saida}")
        except Exception as e:
            logging.error(f"Erro ao salvar dados: {e}")


# ==========================================
# MÓDULO DE AGENDAMENTO (UMA VEZ POR DIA)
# ==========================================
import schedule

def job_diario():
    logging.info("🚀 Iniciando tarefa agendada de scraping diário...")
    scraper = DrogasilScraper()
    
    # IMPORTANTE: Use URLs limpas de categorias. 
    # A URL com parâmetros de anúncio (?gad_source=...) pode redirecionar ou falhar.
    urls_para_scrapar = [
        "https://www.drogasil.com.br/medicamentos",
        "https://www.drogasil.com.br/higiene-e-beleza"
    ]
    
    for url in urls_para_scrapar:
        scraper.executar_scraping(url)
        time.sleep(5) # Pausa ética entre requisições para não sobrecarregar o servidor
        
    scraper.salvar_dados()
    if scraper.dados_produtos:
        # Grava no Supabase (categorias, produtos, fotos e histórico de preços)
        import subprocess, sys
        importador = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "supabase", "importar_produtos.py")
        subprocess.run([sys.executable, importador, "produtos_drogasil.json", "--fonte", "drogasil"], check=False)
    logging.info("✅ Tarefa diária de scraping concluída com sucesso.\n")

def iniciar_agendador():
    """Configura o agendamento para rodar uma vez por dia."""
    # Define o horário que deseja rodar (ex: 03:00 da manhã, horário de baixo tráfego)
    schedule.every().day.at("03:00").do(job_diario)
    
    logging.info("⏰ Agendador iniciado. Aguardando o horário configurado (03:00)...")
    logging.info("Dica: Para testar a execução agora, chame a função 'job_diario()' diretamente.")
    
    # Mantém o script rodando em loop infinito
    while True:
        schedule.run_pending()
        time.sleep(60) # Verifica a cada minuto

if __name__ == "__main__":
    # DESCOMENTE A LINHA ABAIXO PARA TESTAR A EXECUÇÃO IMEDIATAMENTE
    job_diario()
    
    # DESCOMENTE A LINHA ABAIXO PARA RODAR COMO SERVIÇO AGENDADO 24/7
    # iniciar_agendador()