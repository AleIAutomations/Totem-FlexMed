// campaign_player.js — Player de campanhas para o modo standby

// Descanso de tela sem campanha ativa: banners da própria farmácia (ofertas reais do catálogo,
// serviços do totem e o convite para marcas anunciarem), um a cada CASA_MS
const CASA_MS = 8000;
const CASA_ICONES = {
  mao: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
  sacola: '<path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
  megafone: '<path d="M3 10.5v3a1 1 0 0 0 1 1h3l7 4.5v-14L7 9.5H4a1 1 0 0 0-1 1z"/><path d="M17.5 9a4 4 0 0 1 0 6M20 6.5a8 8 0 0 1 0 11"/>',
};
const casaIcone = nome => `<span class="cp-casa-icone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CASA_ICONES[nome]}</svg></span>`;
const casaTexto = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const casaPreco = v => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

class CampaignPlayer {
  constructor(container) {
    this.container = container;
    this.campaigns = [];
    this._timer = null;
    this._carouselTimer = null;
    this.isPlaying = false;
  }

  // Carrega campanhas ativas do Supabase e filtra por data/hora
  async loadCampaigns() {
    try {
      const all = await apiGetCampaigns();
      const now = new Date();
      this.campaigns = (all || []).filter(c => {
        if (!c.is_active) return false;
        if (c.start_date && new Date(c.start_date) > now) return false;
        if (c.end_date   && new Date(c.end_date)   < now) return false;
        return true;
      });
      this.campaigns.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      console.log(`📺 ${this.campaigns.length} campanha(s) carregadas`);
    } catch (e) {
      console.warn('⚠️ Não foi possível carregar campanhas:', e);
      this.campaigns = [];
    }
  }

  // ─── Segmentação por faixa etária ─────────────────────────────────────────
  // O próximo anúncio é escolhido pela proporção do público que está olhando:
  // a faixa mais "atrasada" em relação à sua fatia do público é a próxima
  // (ex.: 40% jovens -> ~40% das exibições para anúncios de jovens), então a
  // maioria vê mais e as outras faixas vão sendo intercaladas. Sem público (ou
  // sem anúncio para a faixa), a rotação é a normal.

  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this._exibidasPorFaixa = {};      // exibições por faixa no público atual
    this._ultimaPorCampanha = {};      // quando cada campanha passou por último
    this._semPublicoDesde = Date.now();
    this._rotacao = 0;
    this._casa = null;                 // banners da casa: ofertas recarregadas a cada descanso
    this._showCurrent();
    // reavalia o público a cada segundo: se mudar, troca o anúncio
    this._monitor = setInterval(() => this._reavaliar(), 1000);
  }

  stop({ interagiu = false } = {}) {
    this.isPlaying = false;
    clearTimeout(this._timer);
    clearTimeout(this._carouselTimer);
    clearInterval(this._monitor);
    this._fecharExibicao(interagiu);
    this.container.innerHTML = '';
  }

  _publico() {
    return (window.FlexAudiencia && window.FlexAudiencia.retrato()) || { olhando: 0, proporcao: {} };
  }

  _candidatas(faixa) {
    return this.campaigns.filter(c => (c.faixas || []).includes(faixa));
  }

  _escolher() {
    const publico = this._publico();
    if (publico.olhando > 0) {
      this._semPublicoDesde = null;
      const total = Object.values(this._exibidasPorFaixa).reduce((a, b) => a + b, 0);
      // faixa com maior "déficit" = fatia do público - fatia das exibições já feitas
      const faixas = Object.entries(publico.proporcao || {})
        .filter(([f, p]) => p > 0 && this._candidatas(f).length)
        .map(([f, p]) => [f, p - (total ? (this._exibidasPorFaixa[f] || 0) / total : 0)])
        .sort((a, b) => b[1] - a[1]);
      if (faixas.length) {
        const faixa = faixas[0][0];
        // dentro da faixa, a campanha que está há mais tempo sem passar (prioridade desempata)
        const c = this._candidatas(faixa).sort((a, b) =>
          (this._ultimaPorCampanha[a.id] || 0) - (this._ultimaPorCampanha[b.id] || 0)
          || (b.priority || 0) - (a.priority || 0))[0];
        return { campanha: c, motivo: 'segmentado', faixa };
      }
    } else if (!this._semPublicoDesde) {
      this._semPublicoDesde = Date.now();
    } else if (Date.now() - this._semPublicoDesde > 8000) {
      this._exibidasPorFaixa = {};     // público foi embora: recomeça a proporção
    }
    // rotação normal: primeiro as campanhas para todos os públicos
    const gerais = this.campaigns.filter(c => !(c.faixas || []).length);
    const lista = gerais.length ? gerais : this.campaigns;
    const c = lista[this._rotacao++ % lista.length];
    return { campanha: c, motivo: 'rotacao', faixa: null };
  }

  // Público mudou: se o anúncio atual não serve mais para a maioria, troca
  _reavaliar() {
    if (!this.isPlaying || !this._atual || Date.now() - this._atual.inicio < 3000) return;
    const publico = this._publico();
    const dominante = publico.dominante;
    if (!dominante || !this._candidatas(dominante).length) return;
    const alvo = this._atual.campanha.faixas || [];
    const atendeMaioria = alvo.includes(dominante);
    const chegouPublico = this._atual.motivo === 'rotacao' && publico.olhando > 0;
    if (!atendeMaioria && (chegouPublico || this._atual.faixa !== dominante)) this._advance();
  }

  _abrirExibicao(escolha) {
    const c = escolha.campanha;
    this._atual = { ...escolha, inicio: Date.now(), exibicaoId: null };
    if (escolha.faixa) this._exibidasPorFaixa[escolha.faixa] = (this._exibidasPorFaixa[escolha.faixa] || 0) + 1;
    this._ultimaPorCampanha[c.id] = Date.now();
    if (c?.id) apiTrackCampaignEvent(c.id, 'impression').catch(() => {});
    const atual = this._atual;
    fetch(`${FLEXMED_API_BASE}/anuncios/exibicoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: c.id, motivo: escolha.motivo, faixa_alvo: escolha.faixa }),
    }).then(r => r.json()).then(d => {
      atual.exibicaoId = d.id;
      if (this._atual === atual && window.FlexAudiencia) window.FlexAudiencia.setAnuncio(d.id);
      else this._enviarFim(d.id, false);   // já trocou de anúncio antes da resposta
    }).catch(() => {});
  }

  _fecharExibicao(interagiu) {
    const atual = this._atual;
    this._atual = null;
    if (window.FlexAudiencia) window.FlexAudiencia.setAnuncio(null);
    if (!atual) return;
    if (interagiu && atual.campanha?.id) apiTrackCampaignEvent(atual.campanha.id, 'click').catch(() => {});
    if (atual.exibicaoId) this._enviarFim(atual.exibicaoId, interagiu);
  }

  _enviarFim(id, interagiu) {
    fetch(`${FLEXMED_API_BASE}/anuncios/exibicoes/${id}/fim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interagiu }),
      keepalive: true,
    }).catch(() => {});
  }

  _advance() {
    if (!this.isPlaying || this.campaigns.length === 0) return;
    const c = this._atual?.campanha;
    if (c?.id) apiTrackCampaignEvent(c.id, 'view_complete').catch(() => {});
    this._fecharExibicao(false);
    this._showCurrent();
  }

  _showCurrent() {
    clearTimeout(this._timer);
    clearTimeout(this._carouselTimer);

    if (!this.isPlaying) return;

    if (this.campaigns.length === 0) {
      this._renderCasa();
      return;
    }

    const escolha = this._escolher();
    this._abrirExibicao(escolha);
    this._render(escolha.campanha);
  }

  _render(campaign) {
    const urls = Array.isArray(campaign.media_urls) ? campaign.media_urls : [];

    // Fade out existing slide
    const existing = this.container.querySelector('.cp-slide');
    if (existing) {
      existing.classList.add('cp-slide-exit');
      setTimeout(() => existing.remove(), 400);
    }

    const slide = document.createElement('div');
    slide.className = 'cp-slide';
    slide.addEventListener('click', () => {
      if (campaign.id) apiTrackCampaignEvent(campaign.id, 'click').catch(() => {});
    });

    if (campaign.type === 'video' && urls[0]) {
      this._buildVideo(slide, campaign, urls[0]);
    } else if (campaign.type === 'carousel' && urls.length > 1) {
      this._buildCarousel(slide, campaign, urls);
    } else if (urls[0]) {
      this._buildImage(slide, campaign, urls[0]);
    } else {
      this._buildPlaceholder(slide, campaign);
    }

    this.container.appendChild(slide);
    requestAnimationFrame(() => slide.classList.add('cp-slide-visible'));
  }

  _buildImage(slide, campaign, url) {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'cp-media';
    img.alt = campaign.name || '';
    slide.appendChild(img);
    const dur = (campaign.duration_seconds || 10) * 1000;
    this._timer = setTimeout(() => this._advance(), dur);
  }

  _buildVideo(slide, campaign, url) {
    const video = document.createElement('video');
    video.src = url;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.className = 'cp-media';
    video.addEventListener('ended', () => this._advance());
    // Fallback se o vídeo não carregar: avança após timeout configurado
    const maxDur = (campaign.duration_seconds || 30) * 1000;
    this._timer = setTimeout(() => this._advance(), maxDur);
    slide.appendChild(video);
  }

  _buildCarousel(slide, campaign, urls) {
    let idx = 0;
    const perSlide = Math.max(2000,
      Math.floor(((campaign.duration_seconds || 10) * 1000) / urls.length)
    );

    const track = document.createElement('div');
    track.className = 'cp-carousel-track';

    const items = urls.map((url, i) => {
      const item = document.createElement('div');
      item.className = 'cp-carousel-item' + (i === 0 ? ' cp-carousel-active' : '');
      const img = document.createElement('img');
      img.src = url;
      img.className = 'cp-media';
      item.appendChild(img);
      track.appendChild(item);
      return item;
    });

    const dots = document.createElement('div');
    dots.className = 'cp-carousel-dots';
    const dotEls = urls.map((_, i) => {
      const d = document.createElement('div');
      d.className = 'cp-dot' + (i === 0 ? ' cp-dot-active' : '');
      dots.appendChild(d);
      return d;
    });

    slide.appendChild(track);
    slide.appendChild(dots);

    const advance = () => {
      if (!this.isPlaying) return;
      items[idx].classList.remove('cp-carousel-active');
      dotEls[idx].classList.remove('cp-dot-active');
      idx = (idx + 1) % urls.length;
      items[idx].classList.add('cp-carousel-active');
      dotEls[idx].classList.add('cp-dot-active');
      if (idx < urls.length - 1) {
        this._carouselTimer = setTimeout(advance, perSlide);
      } else {
        this._timer = setTimeout(() => this._advance(), perSlide);
      }
    };
    this._carouselTimer = setTimeout(advance, perSlide);
  }

  _buildPlaceholder(slide, campaign) {
    slide.innerHTML = `
      <div class="cp-placeholder">
        <div class="cp-placeholder-name">${campaign.name || 'Campanha'}</div>
      </div>`;
    const dur = (campaign.duration_seconds || 10) * 1000;
    this._timer = setTimeout(() => this._advance(), dur);
  }

  // ─── Anúncios da casa (descanso de tela sem campanha ativa) ──────────────────
  async _renderCasa() {
    if (!this._casa) this._casa = { proximo: 0, ofertas: await this._carregarOfertas() };
    if (!this.isPlaying || this.campaigns.length) return;
    const banners = this._bannersCasa();
    const existente = this.container.querySelector('.cp-slide');
    if (existente) {
      existente.classList.add('cp-slide-exit');
      setTimeout(() => existente.remove(), 400);
    }
    const slide = document.createElement('div');
    slide.className = 'cp-slide';
    slide.innerHTML = banners[this._casa.proximo++ % banners.length];
    this.container.appendChild(slide);
    requestAnimationFrame(() => slide.classList.add('cp-slide-visible'));
    this._timer = setTimeout(() => this._renderCasa(), CASA_MS);
  }

  // Os 3 maiores descontos reais do catálogo, com as regras de api.js › apiOfertasDaCasa
  _carregarOfertas() {
    return apiOfertasDaCasa(3);
  }

  _bannersCasa() {
    const loja = document.getElementById('h-pharm')?.textContent || 'nossa farmácia';
    const banners = [];
    const ofertas = this._casa.ofertas;
    if (ofertas.length) {
      banners.push(`
        <div class="cp-casa cp-casa-ofertas">
          <h2>Ofertas da semana</h2>
          <p>Preços de hoje na ${casaTexto(loja)}</p>
          <ul class="cp-casa-lista">${ofertas.map(p => `
            <li>
              <img src="${casaTexto(fotoDoProduto(p.imgUrl, 480))}" alt="">
              <div><b class="cp-casa-nome">${casaTexto(p.nome)}</b>
                <s>de ${casaPreco(p.precoOriginal)}</s><strong>${casaPreco(p.precoValor)}</strong></div>
              <span class="cp-casa-off">-${p.pct}%</span>
            </li>`).join('')}
          </ul>
          <span class="cp-casa-cta">Toque na tela e peça no balcão</span>
        </div>`);
    }
    banners.push(`
      <div class="cp-casa cp-casa-libras">${casaIcone('mao')}
        <h2>Atendimento em Libras</h2>
        <p>Faça as letras em frente à câmera. O totem entende e procura o produto para você.</p>
        <span class="cp-casa-cta">Toque em Libras, no topo da tela</span>
      </div>`);
    banners.push(`
      <div class="cp-casa cp-casa-voz">${casaIcone('mic')}
        <h2>Não achou? É só falar.</h2>
        <p>Diga o nome do remédio ou o que está sentindo, e o totem mostra as opções.</p>
        <span class="cp-casa-cta">Toque no microfone da busca</span>
      </div>`);
    banners.push(`
      <div class="cp-casa cp-casa-balcao">${casaIcone('sacola')}
        <h2>Escolha aqui. Retire no balcão.</h2>
        <p>Monte o pedido no totem e receba um código. O farmacêutico separa enquanto você espera.</p>
        <span class="cp-casa-codigo">DP40</span>
      </div>`);
    banners.push(`
      <div class="cp-casa cp-casa-marcas">${casaIcone('megafone')}
        <h2>Sua marca nesta tela</h2>
        <p>Anúncios que mudam conforme quem está olhando, com medição de público anônima.</p>
        <span class="cp-casa-cta">Fale com a gerência da ${casaTexto(loja)}</span>
      </div>`);
    return banners;
  }

  // Retorna campanha atualmente exibida (para correlação com toque/visão)
  currentCampaign() {
    return this._atual?.campanha || null;
  }
}
