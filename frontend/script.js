async function bootWithAPI() {
  try {

    // 1. Categorias do banco (os produtos são carregados por página no renderProducts)
    await loadCategoriesFromAPI();

    // 2. Carrega config white label
    const apiCfg = await apiGetConfig();
    if (apiCfg && apiCfg.brand) {
      config = sanitizeConfig({ ...config, ...apiCfg });
      applyWhiteLabelUI();
      applyText();
      console.log("✅ Config carregada do Supabase");
    }

    // 3. Carrega métricas salvas
    const apiM = await apiGetMetrics();
    if (apiM) {
      metrics.views  = apiM.views  || 0;
      metrics.libras = apiM.libras || 0;
      metrics.score  = apiM.score  || 0;
      renderMetrics(); // função já existe no script.js
    }

  } catch (e) {
    console.warn("⚠️ Supabase offline, usando dados locais:", e);
  }
}

// Registra no log do backend a tela deste aparelho (ajuda a adaptar o layout do totem)
fetch(`${FLEXMED_SERVER}/health?tela=${innerWidth}x${innerHeight}&dpr=${devicePixelRatio}&screen=${screen.width}x${screen.height}&layout=${document.documentElement.className || "celular"}`).catch(() => {});

// Chame logo após o splash screen sumir (ou no DOMContentLoaded)
bootWithAPI().then(() => {
  const timeout = Number(config?.standby_timeout_seconds) || 300;
  if (typeof initStandby === 'function') initStandby(timeout);
});

function incMetric(type) {
  if (type === "views")  metrics.views  += 1;
  if (type === "libras") metrics.libras += 1;
  renderMetrics();
  apiTrackEvent(type); // ← adicione esta linha
}


    const DEFAULT_CONFIG = {
      brand: "FlexMed",
      unit: "Farmácia Central",
      monogram: "FM",
      accent: "#1A4D8F",
      accent2: "#2C66B0",
      bgColor: "#f3f8fe",
      surfaceColor: "#ffffff",
      textColor: "#0a1628",
      navyColor: "#0a1628",
      assistantMessage: "Como posso ajudá-lo hoje?",
      librasMessage: "Atendimento em Libras disponível",
      logoDataUrl: "",
      lang: "pt",
      standby_timeout_seconds: 300
    };

    let chatOpenedOnBoot = false;

    const i18n = {
      pt: {
        search: "Buscar medicamento ou produto...",
        libras: "Atendimento em Libras disponível",
        quizTag: "Quiz de Saúde",
        quizTitle: "Você conhece seus medicamentos?",
        quizSub: "Teste seu conhecimento em 30 segundos",
        destaque: "Produtos em Destaque",
        dica: "Dica de Saúde",
        inicio: "Início",
        librasNav: "Libras",
        assistente: "Assistente",
        carrinho: "Carrinho",
        custom: "Marca",
        whitelabel: "White Label",
        avaliar: "Avaliar",
        metricas: "Métricas",
        quickTop: "Mais procurados",
        quickAI: "Fale com a IA",
        bannerAction: "Ver agora",
        quizQuick: "Quiz rápido",
        empty: "Nenhum produto encontrado. Tente outra busca ou categoria.",
        detailUse: "Para que serve",
        detailIndication: "Indicado para",
        detailPrescription: "Receita médica",
        detailStock: "Estoque",
        detailLocation: "Localização",
        detailPrice: "Preço estimado",
        detailInfo: "Informações adicionais",
        detailTip: "Dica da IA",
        requiresPrescription: "Exige apresentação de receita.",
        otc: "Venda livre.",
        unavailable: "Produto indisponível no momento.",
        availableUnits: "unidades disponíveis.",
        freeSale: "Livre",
        prescriptionSale: "Receita",
        noStock: "Sem estoque",
        lastUnits: "Últimas",
        soldOut: "Esgotado",
        unitShort: "un.",
        correct: "Resposta correta.",
        nextQuestion: "Próxima pergunta carregada.",
        langChanged: "Idioma alterado para",
        chatbotTitle: "Assistente FlexMed",
        chatbotSub: "Pergunte sobre remédios e sintomas",
        chatbotPlaceholder: "Digite sua pergunta...",
        chatbotGreeting: "Olá! Posso orientar sobre medicamentos, sintomas comuns, localização de produtos e quando procurar atendimento profissional.",
        chatbotPrompt: "Pergunte sobre sintomas, uso geral ou localização de um produto.",
        chatbotFallback: "Posso ajudar com sintomas comuns, cuidados gerais, localização de produtos e orientações de procura por atendimento. Em caso de sintomas intensos, persistentes ou reação alérgica, procure avaliação profissional.",
        chatbotProductHint: "Esse produto está disponível no sistema.",
        chatbotSymptomHint: "Para sintomas persistentes ou intensos, vale buscar orientação profissional.",
        chatbotPrescriptionHint: "Itens controlados exigem receita e avaliação adequada.",
        chatbotStockHint: "Também posso informar estoque e localização dos produtos mostrados na tela.",
        sendRating: "Selecione uma avaliação antes de enviar.",
        ratingSuccess: "Avaliação registrada com sucesso.",
        personalizeSaved: "Personalização salva no navegador.",
        personalizeReset: "Configuração restaurada para o padrão.",
        librasDone: "Interpretação em Libras concluída.",
        waitingSignal: "Aguardando sinal...",
        interpreting: "Interpretando:",
        recognized: "Sinal reconhecido",
        qrNote: "Escaneie o QR Code com seu celular para salvar as informações deste produto.",
        savePhone: "Salvar no celular",
        qrGenerated: "QR gerado localmente, sem backend."
      },
      en: {
        search: "Search medication or product...",
        libras: "Sign language support available",
        quizTag: "Health Quiz",
        quizTitle: "Do you know your medications?",
        quizSub: "Test your knowledge in 30 seconds",
        destaque: "Featured Products",
        dica: "Health Tip",
        inicio: "Home",
        librasNav: "Sign",
        assistente: "Assistant",
        carrinho: "Cart",
        custom: "Brand",
        whitelabel: "White Label",
        avaliar: "Rate",
        metricas: "Metrics",
        quickTop: "Top picks",
        quickAI: "Talk to AI",
        bannerAction: "See now",
        quizQuick: "Quick quiz",
        empty: "No products found. Try another search or category.",
        detailUse: "What it is for",
        detailIndication: "Recommended for",
        detailPrescription: "Prescription",
        detailStock: "Stock",
        detailLocation: "Location",
        detailPrice: "Estimated price",
        detailInfo: "Additional information",
        detailTip: "AI tip",
        requiresPrescription: "Requires a prescription.",
        otc: "Over-the-counter.",
        unavailable: "Product currently unavailable.",
        availableUnits: "units available.",
        freeSale: "OTC",
        prescriptionSale: "Rx",
        noStock: "Out of stock",
        lastUnits: "Last units",
        soldOut: "Sold out",
        unitShort: "u.",
        correct: "Correct answer.",
        nextQuestion: "Next question loaded.",
        langChanged: "Language changed to",
        chatbotTitle: "FlexMed Assistant",
        chatbotSub: "Ask about medicines and symptoms",
        chatbotPlaceholder: "Type your question...",
        chatbotGreeting: "Hi! I can guide you about medicines, common symptoms, product locations and when to seek professional care.",
        chatbotPrompt: "Ask about symptoms, general use or a product location.",
        chatbotFallback: "I can help with common symptoms, general care, product locations and guidance on when to seek care. For intense, persistent symptoms or allergic reactions, seek professional evaluation.",
        chatbotProductHint: "This product is available in the system.",
        chatbotSymptomHint: "For persistent or intense symptoms, seek professional guidance.",
        chatbotPrescriptionHint: "Controlled items require a prescription and proper evaluation.",
        chatbotStockHint: "I can also tell you stock and location for products shown on screen.",
        sendRating: "Select a rating before sending.",
        ratingSuccess: "Rating submitted successfully.",
        personalizeSaved: "Customization saved in the browser.",
        personalizeReset: "Configuration reset to default.",
        librasDone: "Sign language interpretation completed.",
        waitingSignal: "Waiting for sign...",
        interpreting: "Interpreting:",
        recognized: "Sign recognized",
        qrNote: "Scan the QR code with your phone to save this product information.",
        savePhone: "Save to phone",
        qrGenerated: "QR generated locally, no backend."
      },
      es: {
        search: "Buscar medicamento o producto...",
        libras: "Atención en lengua de señas disponible",
        quizTag: "Quiz de Salud",
        quizTitle: "¿Conoces tus medicamentos?",
        quizSub: "Pon a prueba tu conocimiento en 30 segundos",
        destaque: "Productos Destacados",
        dica: "Consejo de Salud",
        inicio: "Inicio",
        librasNav: "Señas",
        assistente: "Asistente",
        carrinho: "Carrito",
        custom: "Marca",
        whitelabel: "White Label",
        avaliar: "Valorar",
        metricas: "Métricas",
        quickTop: "Más buscados",
        quickAI: "Habla con la IA",
        bannerAction: "Ver ahora",
        quizQuick: "Quiz rápido",
        empty: "No se encontraron productos. Prueba otra búsqueda o categoría.",
        detailUse: "Para qué sirve",
        detailIndication: "Indicado para",
        detailPrescription: "Receta médica",
        detailStock: "Stock",
        detailLocation: "Ubicación",
        detailPrice: "Precio estimado",
        detailInfo: "Información adicional",
        detailTip: "Consejo de IA",
        requiresPrescription: "Requiere presentación de receta.",
        otc: "Venta libre.",
        unavailable: "Producto no disponible en este momento.",
        availableUnits: "unidades disponibles.",
        freeSale: "Libre",
        prescriptionSale: "Receta",
        noStock: "Sin stock",
        lastUnits: "Últimas",
        soldOut: "Agotado",
        unitShort: "u.",
        correct: "Respuesta correcta.",
        nextQuestion: "Siguiente pregunta cargada.",
        langChanged: "Idioma cambiado a",
        chatbotTitle: "Asistente FlexMed",
        chatbotSub: "Pregunta sobre medicamentos y síntomas",
        chatbotPlaceholder: "Escribe tu pregunta...",
        chatbotGreeting: "¡Hola! Puedo orientarte sobre medicamentos, síntomas comunes, ubicación de productos y cuándo buscar atención profesional.",
        chatbotPrompt: "Pregunta sobre síntomas, uso general o ubicación de un producto.",
        chatbotFallback: "Puedo ayudar con síntomas comunes, cuidados generales, ubicación de productos y orientación sobre cuándo buscar atención. En caso de síntomas intensos, persistentes o reacción alérgica, busca evaluación profesional.",
        chatbotProductHint: "Este producto está disponible en el sistema.",
        chatbotSymptomHint: "Para síntomas persistentes o intensos, vale buscar orientación profesional.",
        chatbotPrescriptionHint: "Los productos controlados requieren receta y evaluación adecuada.",
        chatbotStockHint: "También puedo informar stock y ubicación de los productos mostrados en pantalla.",
        sendRating: "Selecciona una valoración antes de enviar.",
        ratingSuccess: "Valoración registrada con éxito.",
        personalizeSaved: "Personalización guardada en el navegador.",
        personalizeReset: "Configuración restaurada al estándar.",
        librasDone: "Interpretación en lengua de señas concluida.",
        waitingSignal: "Esperando señal...",
        interpreting: "Interpretando:",
        recognized: "Señal reconocida",
        qrNote: "Escanea el código QR con tu celular para guardar la información de este producto.",
        savePhone: "Guardar en el celular",
        qrGenerated: "QR generado localmente, sin backend."
      }
    };


    // Banners do topo (carrossel abaixo das categorias). `midia`: o que aparece à direita no
    // totem (fotos das ofertas reais ou um ícone); `cta`: texto do botão; `action`: bannerAction.
    const bannerI18n = {
      pt: [
        {
          tag: "Ofertas",
          title: "Ofertas da semana",
          sub: "Vitaminas, beleza e cuidados com preço reduzido. Peça aqui e retire no balcão.",
          chips: ["Vitaminas", "Beleza", "Higiene"],
          action: "ofertas",
          style: "alt-0 banner-ofertas",
          icon: "tag",
          midia: "ofertas",
          cta: "Ver oferta"
        },
        {
          tag: "Voz",
          title: "Não achou? É só falar.",
          sub: "Diga o nome do produto ou o que está sentindo, e o totem mostra as opções.",
          chips: ["Voz", "Sintomas", "Busca"],
          action: "voz",
          style: "alt-1 banner-voz",
          icon: "search",
          midia: "mic",
          cta: "Falar agora"
        },
        {
          tag: "Libras",
          title: "Atendimento em Libras",
          sub: "Faça as letras em frente à câmera. O totem entende e procura para você.",
          chips: ["Libras", "Acessível", "Alfabeto"],
          action: "libras",
          style: "alt-2 banner-libras",
          icon: "hand",
          midia: "mao",
          cta: "Abrir Libras"
        }
      ],
      en: [
        {
          tag: "Deals",
          title: "Deals of the week",
          sub: "Vitamins, beauty and personal care for less. Order here, pick up at the counter.",
          chips: ["Vitamins", "Beauty", "Hygiene"],
          action: "ofertas",
          style: "alt-0 banner-ofertas",
          icon: "tag",
          midia: "ofertas",
          cta: "See deal"
        },
        {
          tag: "Voice",
          title: "Can't find it? Just say it.",
          sub: "Say the product name or how you feel, and the kiosk shows the options.",
          chips: ["Voice", "Symptoms", "Search"],
          action: "voz",
          style: "alt-1 banner-voz",
          icon: "search",
          midia: "mic",
          cta: "Speak now"
        },
        {
          tag: "Libras",
          title: "Sign language support",
          sub: "Sign the letters in front of the camera. The kiosk understands and searches for you.",
          chips: ["Libras", "Accessible", "Alphabet"],
          action: "libras",
          style: "alt-2 banner-libras",
          icon: "hand",
          midia: "mao",
          cta: "Open Libras"
        }
      ],
      es: [
        {
          tag: "Ofertas",
          title: "Ofertas de la semana",
          sub: "Vitaminas, belleza y cuidado personal con precio reducido. Pide aquí y retira en el mostrador.",
          chips: ["Vitaminas", "Belleza", "Higiene"],
          action: "ofertas",
          style: "alt-0 banner-ofertas",
          icon: "tag",
          midia: "ofertas",
          cta: "Ver oferta"
        },
        {
          tag: "Voz",
          title: "¿No lo encuentras? Solo dilo.",
          sub: "Di el nombre del producto o lo que sientes, y el tótem muestra las opciones.",
          chips: ["Voz", "Síntomas", "Búsqueda"],
          action: "voz",
          style: "alt-1 banner-voz",
          icon: "search",
          midia: "mic",
          cta: "Hablar ahora"
        },
        {
          tag: "Libras",
          title: "Atención en lengua de señas",
          sub: "Haz las letras frente a la cámara. El tótem entiende y busca por ti.",
          chips: ["Libras", "Accesible", "Alfabeto"],
          action: "libras",
          style: "alt-2 banner-libras",
          icon: "hand",
          midia: "mao",
          cta: "Abrir Libras"
        }
      ]
    };

    // Ofertas reais do catálogo para o banner de ofertas (api.js › apiOfertasDaCasa)
    let bannerOfertas = [];
    let currentBanner = 0;
    let bannerInterval = null;

    const produtos = [
      {
        id: 1,
        nome: "Paracetamol 750mg",
        tipo: "Analgésico / Antitérmico",
        categoria: "analgesico",
        uso: "Alivia dores leves a moderadas e reduz febre.",
        indicacoes: ["Dor de cabeça", "Febre", "Dor muscular", "Dor de dente"],
        receita: false,
        estoque: 47,
        estoqueMax: 60,
        local: "Corredor A – Prateleira 2",
        locaisDisponiveis: ["Corredor A – Prateleira 2", "Balcão Principal"],
        info: "Evite uso com álcool. Respeite intervalo entre doses.",
        dicaIA: "Para febre persistente ou dor intensa recorrente, direcione o usuário ao atendimento profissional.",
        preco: "R$ 8,90",
        imgUrl: "",
        imgIndex: 1
      },
      {
        id: 2,
        nome: "Amoxicilina 500mg",
        tipo: "Antibiótico",
        categoria: "antibiotico",
        uso: "Tratamento de infecções bacterianas mediante prescrição.",
        indicacoes: ["Infecção bacteriana", "Sinusite", "Amigdalite"],
        receita: true,
        estoque: 12,
        estoqueMax: 40,
        local: "Corredor B – Prateleira 1",
        locaisDisponiveis: ["Corredor B – Prateleira 1"],
        info: "Uso restrito sob orientação médica. Não interrompa tratamento sem avaliação.",
        dicaIA: "Antibióticos não tratam gripe ou resfriado.",
        preco: "Sob receita",
        imgIndex: 2
      },
      {
        id: 3,
        nome: "Vitamina C 1g",
        tipo: "Suplemento vitamínico",
        categoria: "vitaminas",
        uso: "Auxilia na rotina de suplementação e suporte imunológico.",
        indicacoes: ["Suplementação", "Imunidade", "Rotina diária"],
        receita: false,
        estoque: 32,
        estoqueMax: 50,
        local: "Corredor C – Prateleira 3",
        locaisDisponiveis: ["Corredor C – Prateleira 3"],
        info: "Preferencialmente após as refeições.",
        dicaIA: "A apresentação efervescente e a comprimida têm o mesmo objetivo funcional.",
        preco: "R$ 18,90",
        imgIndex: 3
      },
      {
        id: 4,
        nome: "Insulina NPH 100UI",
        tipo: "Controle glicêmico",
        categoria: "diabetes",
        uso: "Produto de uso controlado para manejo glicêmico.",
        indicacoes: ["Diabetes tipo 1", "Diabetes tipo 2"],
        receita: true,
        estoque: 8,
        estoqueMax: 30,
        local: "Balcão frio – Refrigerado",
        locaisDisponiveis: ["Balcão frio – Refrigerado"],
        info: "Manter refrigerado entre 2°C e 8°C.",
        dicaIA: "É essencial manter cadeia de conservação e orientação adequada de retirada.",
        preco: "Sob receita",
        imgIndex: 4
      },
      {
        id: 5,
        nome: "Protetor Solar FPS 60",
        tipo: "Dermatológico",
        categoria: "dermato",
        uso: "Proteção UVA/UVB para rotina diária.",
        indicacoes: ["Fotoproteção", "Rotina facial", "Uso diário"],
        receita: false,
        estoque: 25,
        estoqueMax: 40,
        local: "Corredor D – Prateleira 1",
        locaisDisponiveis: ["Corredor D – Prateleira 1"],
        info: "Reaplicar conforme tempo de exposição e transpiração.",
        dicaIA: "O uso diário melhora a consistência da proteção, inclusive em dias nublados.",
        preco: "R$ 35,90",
        imgIndex: 5
      },
      {
        id: 6,
        nome: "Xarope Infantil",
        tipo: "Linha infantil",
        categoria: "infantil",
        uso: "Suporte para sintomas leves mediante orientação adequada.",
        indicacoes: ["Pediatria", "Uso infantil"],
        receita: false,
        estoque: 14,
        estoqueMax: 25,
        local: "Corredor F – Infantil",
        locaisDisponiveis: ["Corredor F – Infantil"],
        info: "Posologia depende de idade e peso.",
        dicaIA: "Em bebês muito pequenos, sempre priorize avaliação profissional.",
        preco: "R$ 16,50",
        imgIndex: 6
      },
      {
        id: 7,
        nome: "Loratadina 10mg",
        tipo: "Antialérgico",
        categoria: "cuidados",
        uso: "Auxilia em sintomas de rinite e alergias leves.",
        indicacoes: ["Rinite", "Alergia", "Coceira"],
        receita: false,
        estoque: 28,
        estoqueMax: 40,
        local: "Corredor C – Prateleira 2",
        locaisDisponiveis: ["Corredor C – Prateleira 2"],
        info: "Pode causar sonolência em alguns casos.",
        dicaIA: "Para casos recorrentes, vale orientar avaliação de rotina.",
        preco: "R$ 12,90",
        imgIndex: 7
      }
    ];

    const librasMap = {
      "dor de cabeça": "Sinal reconhecido: dor de cabeça. Produto sugerido: Paracetamol 750mg. Localização: Corredor A.",
      "febre": "Sinal reconhecido: febre. Produtos em destaque: Paracetamol e linha antitérmica disponível.",
      "medicamento": "Sinal reconhecido: medicamento. Use a busca acima ou navegue pelas categorias disponíveis.",
      "receita": "Sinal reconhecido: receita. Itens controlados exigem apresentação de prescrição no balcão."
    };

    const metrics = {
      views: 247,
      libras: 38,
      week: "1.2k",
      score: 4.8,
      searches: {
        "Paracetamol 750mg": 68,
        "Vitamina C 1g": 52,
        "Insulina NPH 100UI": 41,
        "Loratadina 10mg": 36
      }
    };

    // Chips de categoria: esta lista é o padrão offline; com o backend no ar ela é
    // substituída pelas categorias do banco que têm produtos (loadCategoriesFromAPI)
    const CATEGORY_ICONS = {
      todos: "home", analgesico: "pill", antibiotico: "shield", alergias: "snow",
      vitaminas: "leaf", diabetes: "drop", coracao: "target", sistema_nervoso: "spark",
      gastro: "box", saude_mulher: "star", dermato: "sun", infantil: "smile",
      cuidados: "hand", primeiros_socorros: "info", outros: "tag"
    };
    // Navegação em 2 níveis: nicho no topo (Medicamentos, Beleza...) e, embaixo,
    // as categorias daquele nicho (Analgésicos, Antibióticos...)
    const NICHOS = [
      { key: "medicamentos", label: "Medicamentos", icon: "pill" },
      { key: "beleza", label: "Beleza", icon: "palette" },
      { key: "higiene", label: "Higiene e Cuidados", icon: "hand" },
      { key: "infantil", label: "Infantil", icon: "smile" },
      { key: "bem_estar", label: "Saúde e Bem-estar", icon: "leaf" }
    ];
    const NICHO_DA_CATEGORIA = {
      analgesico: "medicamentos", antibiotico: "medicamentos", alergias: "medicamentos",
      diabetes: "medicamentos", coracao: "medicamentos", sistema_nervoso: "medicamentos",
      gastro: "medicamentos", saude_mulher: "medicamentos", dermato: "beleza",
      cuidados: "higiene", infantil: "infantil", vitaminas: "bem_estar",
      primeiros_socorros: "bem_estar", outros: "bem_estar"
    };
    const categories = [
      { key: "todos", label: "Todos", icon: "home" },
      { key: "analgesico", label: "Analgésicos", icon: "pill" },
      { key: "antibiotico", label: "Antibióticos", icon: "shield" },
      { key: "vitaminas", label: "Vitaminas e Suplementos", icon: "leaf" },
      { key: "diabetes", label: "Diabetes", icon: "drop" },
      { key: "dermato", label: "Dermocosméticos", icon: "sun" },
      { key: "infantil", label: "Infantil", icon: "smile" },
      { key: "cuidados", label: "Higiene e Cuidados", icon: "hand" }
    ];


    const categoryLabels = {
      pt: {
        todos: "Todos",
        medicamentos: "Medicamentos",
        beleza: "Beleza",
        higiene: "Higiene e Cuidados",
        bem_estar: "Saúde e Bem-estar",
        analgesico: "Analgésicos",
        antibiotico: "Antibióticos",
        alergias: "Alergias e Gripes",
        vitaminas: "Vitaminas e Suplementos",
        diabetes: "Diabetes",
        coracao: "Coração e Pressão",
        sistema_nervoso: "Sistema Nervoso",
        gastro: "Estômago e Intestino",
        saude_mulher: "Saúde da Mulher",
        dermato: "Dermocosméticos",
        infantil: "Infantil",
        cuidados: "Higiene e Cuidados",
        primeiros_socorros: "Primeiros Socorros",
        outros: "Outros"
      },
      en: {
        todos: "All",
        medicamentos: "Medicines",
        beleza: "Beauty",
        higiene: "Hygiene & Care",
        bem_estar: "Health & Wellness",
        analgesico: "Pain relief",
        antibiotico: "Antibiotics",
        alergias: "Allergy & Flu",
        vitaminas: "Vitamins & Supplements",
        diabetes: "Diabetes",
        coracao: "Heart & Blood pressure",
        sistema_nervoso: "Nervous system",
        gastro: "Stomach & Gut",
        saude_mulher: "Women's health",
        dermato: "Skincare",
        infantil: "Kids",
        cuidados: "Hygiene & Care",
        primeiros_socorros: "First aid",
        outros: "Others"
      },
      es: {
        todos: "Todos",
        medicamentos: "Medicamentos",
        beleza: "Belleza",
        higiene: "Higiene y Cuidado",
        bem_estar: "Salud y Bienestar",
        analgesico: "Analgésicos",
        antibiotico: "Antibióticos",
        alergias: "Alergias y Gripe",
        vitaminas: "Vitaminas y Suplementos",
        diabetes: "Diabetes",
        coracao: "Corazón y Presión",
        sistema_nervoso: "Sistema Nervioso",
        gastro: "Estómago e Intestino",
        saude_mulher: "Salud de la Mujer",
        dermato: "Dermocosméticos",
        infantil: "Infantil",
        cuidados: "Higiene y Cuidados",
        primeiros_socorros: "Primeros Auxilios",
        outros: "Otros"
      }
    };

    const productI18n = {
      pt: {
        1: { nome: "Paracetamol 750mg", tipo: "Analgésico / Antitérmico", uso: "Alivia dores leves a moderadas e reduz febre.", indicacoes: ["Dor de cabeça", "Febre", "Dor muscular", "Dor de dente"], info: "Evite uso com álcool. Respeite intervalo entre doses.", dicaIA: "Para febre persistente ou dor intensa recorrente, direcione o usuário ao atendimento profissional.", preco: "R$ 8,90", local: "Corredor A – Prateleira 2" },
        2: { nome: "Amoxicilina 500mg", tipo: "Antibiótico", uso: "Tratamento de infecções bacterianas mediante prescrição.", indicacoes: ["Infecção bacteriana", "Sinusite", "Amigdalite"], info: "Uso restrito sob orientação médica. Não interrompa tratamento sem avaliação.", dicaIA: "Antibióticos não tratam gripe ou resfriado.", preco: "Sob receita", local: "Corredor B – Prateleira 1" },
        3: { nome: "Vitamina C 1g", tipo: "Suplemento vitamínico", uso: "Auxilia na rotina de suplementação e suporte imunológico.", indicacoes: ["Suplementação", "Imunidade", "Rotina diária"], info: "Preferencialmente após as refeições.", dicaIA: "A apresentação efervescente e a comprimida têm o mesmo objetivo funcional.", preco: "R$ 18,90", local: "Corredor C – Prateleira 3" },
        4: { nome: "Insulina NPH 100UI", tipo: "Controle glicêmico", uso: "Produto de uso controlado para manejo glicêmico.", indicacoes: ["Diabetes tipo 1", "Diabetes tipo 2"], info: "Manter refrigerado entre 2°C e 8°C.", dicaIA: "É essencial manter cadeia de conservação e orientação adequada de retirada.", preco: "Sob receita", local: "Balcão frio – Refrigerado" },
        5: { nome: "Protetor Solar FPS 60", tipo: "Dermatológico", uso: "Proteção UVA/UVB para rotina diária.", indicacoes: ["Fotoproteção", "Rotina facial", "Uso diário"], info: "Reaplicar conforme tempo de exposição e transpiração.", dicaIA: "O uso diário melhora a consistência da proteção, inclusive em dias nublados.", preco: "R$ 35,90", local: "Corredor D – Prateleira 1" },
        6: { nome: "Xarope Infantil", tipo: "Linha infantil", uso: "Suporte para sintomas leves mediante orientação adequada.", indicacoes: ["Pediatria", "Uso infantil"], info: "Posologia depende de idade e peso.", dicaIA: "Em bebês muito pequenos, sempre priorize avaliação profissional.", preco: "R$ 16,50", local: "Corredor F – Infantil" },
        7: { nome: "Loratadina 10mg", tipo: "Antialérgico", uso: "Auxilia em sintomas de rinite e alergias leves.", indicacoes: ["Rinite", "Alergia", "Coceira"], info: "Pode causar sonolência em alguns casos.", dicaIA: "Para casos recorrentes, vale orientar avaliação de rotina.", preco: "R$ 12,90", local: "Corredor C – Prateleira 2" }
      },
      en: {
        1: { nome: "Paracetamol 750mg", tipo: "Pain reliever / Fever reducer", uso: "Relieves mild to moderate pain and reduces fever.", indicacoes: ["Headache", "Fever", "Muscle pain", "Toothache"], info: "Avoid combining with alcohol. Respect the interval between doses.", dicaIA: "For persistent fever or recurring intense pain, direct the user to professional care.", preco: "R$ 8.90", local: "Aisle A – Shelf 2" },
        2: { nome: "Amoxicillin 500mg", tipo: "Antibiotic", uso: "Treatment of bacterial infections with prescription.", indicacoes: ["Bacterial infection", "Sinusitis", "Tonsillitis"], info: "Restricted use under medical guidance. Do not stop treatment without evaluation.", dicaIA: "Antibiotics do not treat flu or common colds.", preco: "Prescription only", local: "Aisle B – Shelf 1" },
        3: { nome: "Vitamin C 1g", tipo: "Vitamin supplement", uso: "Supports supplementation routines and immune support.", indicacoes: ["Supplementation", "Immunity", "Daily routine"], info: "Preferably after meals.", dicaIA: "Effervescent and tablet versions serve the same functional purpose.", preco: "R$ 18.90", local: "Aisle C – Shelf 3" },
        4: { nome: "NPH Insulin 100IU", tipo: "Glycemic control", uso: "Controlled-use product for glycemic management.", indicacoes: ["Type 1 diabetes", "Type 2 diabetes"], info: "Keep refrigerated between 2°C and 8°C.", dicaIA: "It is essential to keep the cold chain and provide proper pickup guidance.", preco: "Prescription only", local: "Cold counter – Refrigerated" },
        5: { nome: "Sunscreen SPF 60", tipo: "Dermatology", uso: "UVA/UVB protection for daily routines.", indicacoes: ["Photoprotection", "Face routine", "Daily use"], info: "Reapply according to exposure time and perspiration.", dicaIA: "Daily use improves protection consistency, even on cloudy days.", preco: "R$ 35.90", local: "Aisle D – Shelf 1" },
        6: { nome: "Children's Syrup", tipo: "Kids line", uso: "Support for mild symptoms with appropriate guidance.", indicacoes: ["Pediatrics", "Child use"], info: "Dosage depends on age and weight.", dicaIA: "For very young babies, always prioritize professional evaluation.", preco: "R$ 16.50", local: "Aisle F – Kids" },
        7: { nome: "Loratadine 10mg", tipo: "Antiallergic", uso: "Helps with rhinitis symptoms and mild allergies.", indicacoes: ["Rhinitis", "Allergy", "Itching"], info: "May cause drowsiness in some cases.", dicaIA: "For recurring cases, routine evaluation is worth recommending.", preco: "R$ 12.90", local: "Aisle C – Shelf 2" }
      },
      es: {
        1: { nome: "Paracetamol 750mg", tipo: "Analgésico / Antitérmico", uso: "Alivia dolores leves a moderados y reduce la fiebre.", indicacoes: ["Dolor de cabeza", "Fiebre", "Dolor muscular", "Dolor de muelas"], info: "Evita usarlo con alcohol. Respeta el intervalo entre dosis.", dicaIA: "Para fiebre persistente o dolor intenso recurrente, orienta al usuario a atención profesional.", preco: "R$ 8,90", local: "Pasillo A – Estante 2" },
        2: { nome: "Amoxicilina 500mg", tipo: "Antibiótico", uso: "Tratamiento de infecciones bacterianas con prescripción.", indicacoes: ["Infección bacteriana", "Sinusitis", "Amigdalitis"], info: "Uso restringido bajo orientación médica. No interrumpas el tratamiento sin evaluación.", dicaIA: "Los antibióticos no tratan la gripe ni el resfriado.", preco: "Con receta", local: "Pasillo B – Estante 1" },
        3: { nome: "Vitamina C 1g", tipo: "Suplemento vitamínico", uso: "Ayuda en la rutina de suplementación y apoyo inmunológico.", indicacoes: ["Suplementación", "Inmunidad", "Rutina diaria"], info: "Preferentemente después de las comidas.", dicaIA: "La presentación efervescente y la comprimida tienen el mismo objetivo funcional.", preco: "R$ 18,90", local: "Pasillo C – Estante 3" },
        4: { nome: "Insulina NPH 100UI", tipo: "Control glucémico", uso: "Producto de uso controlado para manejo glucémico.", indicacoes: ["Diabetes tipo 1", "Diabetes tipo 2"], info: "Mantener refrigerado entre 2°C y 8°C.", dicaIA: "Es esencial mantener la cadena de conservación y una orientación adecuada de retiro.", preco: "Con receta", local: "Mostrador frío – Refrigerado" },
        5: { nome: "Protector Solar FPS 60", tipo: "Dermatológico", uso: "Protección UVA/UVB para la rutina diaria.", indicacoes: ["Fotoprotección", "Rutina facial", "Uso diario"], info: "Reaplicar según el tiempo de exposición y la transpiración.", dicaIA: "El uso diario mejora la consistencia de la protección, incluso en días nublados.", preco: "R$ 35,90", local: "Pasillo D – Estante 1" },
        6: { nome: "Jarabe Infantil", tipo: "Línea infantil", uso: "Apoyo para síntomas leves con orientación adecuada.", indicacoes: ["Pediatría", "Uso infantil"], info: "La posología depende de la edad y el peso.", dicaIA: "En bebés muy pequeños, siempre prioriza la evaluación profesional.", preco: "R$ 16,50", local: "Pasillo F – Infantil" },
        7: { nome: "Loratadina 10mg", tipo: "Antialérgico", uso: "Ayuda con síntomas de rinitis y alergias leves.", indicacoes: ["Rinitis", "Alergia", "Picazón"], info: "Puede causar somnolencia en algunos casos.", dicaIA: "Para casos recurrentes, vale orientar una evaluación de rutina.", preco: "R$ 12,90", local: "Pasillo C – Estante 2" }
      }
    };

    const navItems = [
      { key: "home", labelKey: "inicio", icon: "home", action: () => navHome() },
      { key: "libras", labelKey: "librasNav", icon: "hand", action: () => openOv("o-lb") },
      { key: "ai", labelKey: "assistente", icon: "bot", action: () => toggleAg() },
      { key: "cart", labelKey: "carrinho", icon: "cart", action: () => openOv("o-cart") }
    ];

    let config = loadConfig();
    let currentLang = config.lang || "pt";
    let currentNicho = "todos";
    let currentCategory = "todos";
    let currentProduct = null;
    let currentRating = 0;
    let lastSearchTerm = "";
    let catDrag = { active: false, startX: 0, startScrollLeft: 0 };

    const SAFE_BANNER_ACTIONS = new Set(["products", "chat", "ofertas", "voz", "libras"]);

    function clampText(value, max = 120) {
      return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ")  /* só caracteres de controle */.replace(/\s+/g, " ").trim().slice(0, max);
    }

    function sanitizeConfig(raw) {
      const base = { ...DEFAULT_CONFIG };
      const src = raw && typeof raw === "object" ? raw : {};
      const lang = ["pt", "en", "es"].includes(src.lang) ? src.lang : base.lang;
      const accent = isValidHex && isValidHex(src.accent) ? src.accent.toUpperCase() : base.accent;
      const accent2 = isValidHex && isValidHex(src.accent2) ? src.accent2.toUpperCase() : base.accent2;
      const bgColor = isValidHex && isValidHex(src.bgColor) ? src.bgColor.toUpperCase() : base.bgColor;
      const surfaceColor = isValidHex && isValidHex(src.surfaceColor) ? src.surfaceColor.toUpperCase() : base.surfaceColor;
      const textColor = isValidHex && isValidHex(src.textColor) ? src.textColor.toUpperCase() : base.textColor;
      const navyColor = isValidHex && isValidHex(src.navyColor) ? src.navyColor.toUpperCase() : base.navyColor;
      // Only accept data: URLs for logo (base64 images)
      const logoDataUrl = (typeof src.logoDataUrl === "string" && src.logoDataUrl.startsWith("data:image/")) ? src.logoDataUrl : base.logoDataUrl;
      return {
        ...base,
        brand: clampText(src.brand || base.brand, 36),
        unit: clampText(src.unit || base.unit, 48),
        monogram: normalizeMonogram(src.monogram || base.monogram),
        accent,
        accent2,
        bgColor,
        surfaceColor,
        textColor,
        navyColor,
        logoDataUrl,
        assistantMessage: clampText(src.assistantMessage || base.assistantMessage, 140),
        librasMessage: clampText(src.librasMessage || base.librasMessage, 100),
        lang
      };
    }

    function safeEnum(value, allowed, fallback) {
      return allowed.includes(value) ? value : fallback;
    }


    function loadConfig() {
      const saved = localStorage.getItem("flexmed_whitelabel_config");
      if (!saved) return { ...DEFAULT_CONFIG };
      try {
        return sanitizeConfig(JSON.parse(saved));
      } catch {
        localStorage.removeItem("flexmed_whitelabel_config");
        return { ...DEFAULT_CONFIG };
      }
    }

    function persistConfig() {
      config = sanitizeConfig(config);
      localStorage.setItem("flexmed_whitelabel_config", JSON.stringify(config));
      apiSaveConfig(config).catch(e => console.warn("Config não sincronizada:", e));
    }


    function normalizeMonogram(value) {
      const clean = String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 3);
      return clean || DEFAULT_CONFIG.monogram;
    }

    function isValidHex(value) {
      return /^#([0-9A-F]{6})$/i.test(String(value || "").trim());
    }

    // Lighten (+) or darken (-) a hex color by percentage
    function shadeColor(hex, percent) {
      if (!isValidHex(hex)) return hex;
      const num = parseInt(hex.slice(1), 16);
      const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(2.55 * percent)));
      const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(2.55 * percent)));
      const b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(2.55 * percent)));
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
    }

    function openChatbot(auto = false) {
      const panel = document.getElementById("ag-bub");
      panel.classList.add("on");
      refreshChatbotTexts();
    }

    function applyWhiteLabelUI() {
      const root = document.documentElement;
      root.style.setProperty("--blue", config.accent);
      root.style.setProperty("--blue-2", config.accent2);
      root.style.setProperty("--blue-dim", hexToRgba(config.accent, 0.08));
      root.style.setProperty("--blue-ring", hexToRgba(config.accent, 0.18));
      root.style.setProperty("--blue-line", hexToRgba(config.accent, 0.20));
      root.style.setProperty("--top-banner", `linear-gradient(135deg, ${config.navyColor || "var(--navy)"} 0%, ${config.accent} 100%)`);
      // Extended color tokens
      if (config.bgColor)      root.style.setProperty("--bg", config.bgColor);
      if (config.bgColor)      root.style.setProperty("--bg-2", shadeColor(config.bgColor, -8));
      if (config.surfaceColor) root.style.setProperty("--surface", config.surfaceColor);
      if (config.textColor)    root.style.setProperty("--t1", config.textColor);
      if (config.navyColor) {
        root.style.setProperty("--navy", config.navyColor);
        root.style.setProperty("--navy-mid", shadeColor(config.navyColor, 10));
      }
      // Shadow based on accent
      root.style.setProperty("--shadow-blue", `0 10px 28px ${hexToRgba(config.accent, 0.22)}`);

      // Text elements
      document.getElementById("h-brand").textContent = config.brand;
      document.getElementById("h-pharm").textContent = config.unit;
      const spBrand = document.getElementById("sp-brand");   // tela de abertura (removida no totem)
      if (spBrand) spBrand.textContent = config.brand;

      // Logo handling: if custom logo set, show <img>; else show monogram text
      const logoContainers = document.querySelectorAll(".brand-logo-wrap");
      logoContainers.forEach(wrap => {
        if (config.logoDataUrl) {
          wrap.innerHTML = `<img src="${config.logoDataUrl}" class="brand-logo-img" alt="${config.brand}" />`;
        } else {
          wrap.innerHTML = `<span class="brand-monogram ${wrap.dataset.size === 'sm' ? 'brand-monogram-sm' : ''}">${normalizeMonogram(config.monogram || config.brand)}</span>`;
        }
      });
      // Fallback for elements that aren't wrapped yet
      document.querySelectorAll(".brand-monogram").forEach(el => el.textContent = normalizeMonogram(config.monogram || config.brand));

      const chatMsgs = document.getElementById("ag-msgs");
      if (chatMsgs && !chatMsgs.children.length) {
        addChatMessage("bot", config.assistantMessage, false);
      }
      document.getElementById("t-lb").textContent = L("Libras", "Sign language", "Señas");
    }

    function getText() {
      return i18n[currentLang] || i18n.pt;
    }

    function getTranslatedProduct(p) {
      if (currentLang === "pt") return p;
      const { preco, ...localized } = (productI18n[currentLang] && productI18n[currentLang][p.id]) || {};
      return { ...p, ...localized };
    }

    function translateCategoryLabel(key, fallback) {
      return (categoryLabels[currentLang] && categoryLabels[currentLang][key]) || fallback || key;
    }

    function setLang(lang, el) {
      rastrear("idioma", lang);
      currentLang = lang;
      config.lang = lang;
      persistConfig();
      document.querySelectorAll(".lng").forEach(b => b.classList.remove("on"));
      if (el) el.classList.add("on");
      applyText();
      renderCategories();
      renderProducts(lastSearchTerm);
      renderNav();
      renderMetrics();
      // Only re-render detail if it is currently visible (avoid unwanted redirects)
      if (currentProduct && document.getElementById("detail").classList.contains("on")) {
        openDetail(currentProduct.id);
      }
      refreshChatbotTexts();
      showToast(`${getText().langChanged} ${lang.toUpperCase()}.`);
    }

    function applyText() {
      const t = getText();
      document.getElementById("s-in").placeholder = t.search;
      document.getElementById("t-dest").textContent = t.destaque;
      document.getElementById("t-lb").textContent = L("Libras", "Sign language", "Señas");
      atualizarSaudacao();
      atualizarTituloLista();
      renderNav();
      document.getElementById("t-lb-title").textContent = currentLang === "en" ? "Sign language support" : currentLang === "es" ? "Atención en lengua de señas" : "Atendimento em Libras";
      document.getElementById("lb-st").textContent = t.waitingSignal;
      document.getElementById("ag-title").textContent = t.chatbotTitle;
      document.getElementById("ag-sub").textContent = t.chatbotSub;
      renderBanners();
    }


    function getBannerList() {
      return bannerI18n[currentLang] || bannerI18n.pt;
    }

    function bannerAction(kind) {
      if (kind === "chat") {
        openChatbot();
        return;
      }
      if (kind === "voz") {
        falarNaBusca();
        return;
      }
      if (kind === "libras") {
        window.openOv("o-lb");   // a versão global: o libras_integration.js liga a câmera ao abrir
        return;
      }
      if (kind === "ofertas" && bannerOfertas.length) {
        const oferta = bannerOfertas[0];
        if (!produtos.some(p => String(p.id) === String(oferta.id))) produtos.push(oferta);
        openDetail(oferta.id);
        return;
      }
      scrollTopProducts();
    }

    // À direita do banner no totem: as fotos das ofertas (com o maior desconto) ou um ícone
    const BANNER_ICONES = {
      mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
      mao: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0z"/>',
    };
    function bannerMidia(item) {
      if (item.midia === "ofertas") {
        if (!bannerOfertas.length) return "";
        const maior = Math.max(...bannerOfertas.map(p => p.pct));
        return `<div class="banner-midia banner-midia-ofertas" aria-hidden="true">
          ${bannerOfertas.slice(0, 3).map(p => `<img src="${e(fotoDoProduto(p.imgUrl, 480))}" alt="">`).join("")}
          <span class="banner-off">${e(L(`até -${maior}%`, `up to -${maior}%`, `hasta -${maior}%`))}</span>
        </div>`;
      }
      const svg = BANNER_ICONES[item.midia];
      return svg ? `<div class="banner-midia banner-midia-icone" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${svg}</svg></div>` : "";
    }

    // Rola só a área de produtos (scrollIntoView rolaria também a página do totem,
    // deslocando o app para fora da tela)
    function scrollTopProducts() {
      const target = document.querySelector(".prod-col .sec-head");
      const scroller = productScroller();
      if (!target || !scroller) return;
      const top = target.offsetTop - (scroller.contains(target.offsetParent) ? 0 : scroller.offsetTop);
      scroller.scrollTo({ top: Math.max(top - 8, 0), behavior: "smooth" });
    }

    function e(value) {
      return escapeHtml(clampText(value, 240));
    }

    function safeBannerAction(value) {
      return SAFE_BANNER_ACTIONS.has(value) ? value : "products";
    }

    function renderBanners() {
      const list = getBannerList();
      const track = document.getElementById("banner-track");
      const dots = document.getElementById("banner-dots");
      if (!track || !dots) return;

      if (currentBanner >= list.length) currentBanner = 0;
      const t = getText();

      track.innerHTML = list.map((item) => `
        <button type="button" class="banner-card ${e(item.style || "")}" onclick="bannerAction('${safeBannerAction(item.action)}')" aria-label="${e(item.title)}">
          <div class="banner-top">
            <div>
              <div class="banner-kicker">${icon(item.icon)}<span>${e(item.tag)}</span></div>
              <div class="banner-title">${e(item.title)}</div>
              <div class="banner-sub">${e(item.sub)}</div>
            </div>
            <div class="banner-art">${icon(item.icon)}</div>
            ${bannerMidia(item)}
          </div>
          <div class="banner-foot">
            ${item.chips.map(chip => `<span class="banner-chip">${e(chip)}</span>`).join("")}
            <span class="banner-cta">${e(item.cta || t.bannerAction)}${icon("arrowRight")}</span>
          </div>
        </button>
      `).join("");

      dots.innerHTML = list.map((_, idx) => `
        <button type="button" class="banner-dot ${idx === currentBanner ? "on" : ""}" onclick="goBanner(${Number(idx)})" aria-label="banner ${idx + 1}"></button>
      `).join("");

      updateBannerPosition();
    }

    function updateBannerPosition() {
      const track = document.getElementById("banner-track");
      const dots = document.querySelectorAll(".banner-dot");
      if (track) track.style.transform = `translateX(-${currentBanner * 100}%)`;
      dots.forEach((dot, idx) => dot.classList.toggle("on", idx === currentBanner));
    }

    function goBanner(idx) {
      const list = getBannerList();
      currentBanner = (idx + list.length) % list.length;
      updateBannerPosition();
      restartBannerAuto();
    }

    function nextBanner() {
      const list = getBannerList();
      currentBanner = (currentBanner + 1) % list.length;
      updateBannerPosition();
    }

    function restartBannerAuto() {
      clearInterval(bannerInterval);
      bannerInterval = setInterval(nextBanner, 4200);
    }

    function updateClock() {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, "0");
      const m = now.getMinutes().toString().padStart(2, "0");
      document.getElementById("clock").textContent = `${h}:${m}`;
    }

    // Topo: nichos que têm produtos. Embaixo (#subcats-row): categorias do nicho.
    function nichosDisponiveis() {
      const comProdutos = new Set(categories.slice(1).map(c => c.nicho || NICHO_DA_CATEGORIA[c.key]));
      return [{ key: "todos", label: "Todos", icon: "home" }, ...NICHOS.filter(n => comProdutos.has(n.key))];
    }

    // Ícone próprio da categoria (icones.js); sem desenho próprio, o ícone escolhido no admin
    function iconeCategoria(c) {
      return (window.FlexIcones && FlexIcones.de(c.key, c.label)) || icon(c.icon);
    }

    function chipHtml(c, ativo, acao, variante = "") {
      const nome = translateCategoryLabel(c.key, c.label);
      return `
        <button type="button" class="cat ${variante} ${ativo ? "on" : ""}" onclick="${acao}('${e(c.key)}')" aria-pressed="${ativo}">
          <span class="cat-ico">${iconeCategoria(c)}</span>
          <span class="cat-nome">${e(nome)}</span>
        </button>
      `;
    }

    function renderCategories() {
      document.getElementById("cats-row").innerHTML =
        nichosDisponiveis().map(n => chipHtml(n, n.key === currentNicho, "setNicho", "cat-tile")).join("");
      renderSubcategorias();
    }

    function renderSubcategorias() {
      const wrap = document.getElementById("subcats-row");
      if (!wrap) return;
      const subs = categories.slice(1).filter(c => (c.nicho || NICHO_DA_CATEGORIA[c.key]) === currentNicho);
      wrap.classList.toggle("vazio", currentNicho === "todos" || !subs.length);
      if (currentNicho === "todos") { wrap.innerHTML = ""; return; }
      const todas = { key: "todos", label: "Todos", icon: "spark" };
      wrap.innerHTML = [todas, ...subs].map(c => chipHtml(c, c.key === currentCategory, "setCategory", "cat-sub")).join("");
    }

    function setNicho(nicho) {
      currentNicho = safeEnum(nicho, nichosDisponiveis().map(n => n.key), "todos");
      rastrear("categoria", currentNicho, { nivel: "nicho" });
      currentCategory = "todos";
      renderCategories();
      renderProducts(lastSearchTerm);
    }

    function setCategory(cat) {
      currentCategory = safeEnum(cat, categories.map(c => c.key), "todos");
      rastrear("categoria", currentCategory, { nivel: "categoria" });
      if (currentCategory !== "todos") {
        currentNicho = (categories.find(c => c.key === currentCategory) || {}).nicho
          || NICHO_DA_CATEGORIA[currentCategory] || currentNicho;
      }
      renderCategories();
      renderProducts(lastSearchTerm);
    }

    
function getLocationIcon(location) {
      const raw = String(location || "").toLowerCase();
      if (raw.includes("balc")) return icon("snow");
      return icon("pinSm");
    }

    function getShortLocationLabel(location) {
      const raw = String(location || "").trim();
      if (!raw) return "";
      const normalized = raw
        .replace(/–/g, "-")
        .replace(/\s+/g, " ")
        .trim();

      if (/balc/i.test(normalized)) {
        return currentLang === "en" ? "Cold counter" : currentLang === "es" ? "Mostrador frío" : "Balcão";
      }

      const corredor = normalized.match(/corredor\s+([a-z])/i);
      const shelf = normalized.match(/prateleira\s*(\d+)/i);

      if (corredor && shelf) {
        if (currentLang === "en") return `Aisle ${corredor[1].toUpperCase()} • Shelf ${shelf[1]}`;
        if (currentLang === "es") return `Pasillo ${corredor[1].toUpperCase()} • Estante ${shelf[1]}`;
        return `Corredor ${corredor[1].toUpperCase()} • Prat. ${shelf[1]}`;
      }

      if (corredor) {
        if (currentLang === "en") return `Aisle ${corredor[1].toUpperCase()}`;
        if (currentLang === "es") return `Pasillo ${corredor[1].toUpperCase()}`;
        return `Corredor ${corredor[1].toUpperCase()}`;
      }

      return normalized;
    }

    function getLocationDetailLabel(location) {
      const raw = String(location || "").trim();
      if (!raw) return "";
      const normalized = raw.replace(/–/g, "-").replace(/\s+/g, " ").trim();

      if (/balc/i.test(normalized)) {
        return currentLang === "en" ? "Cold counter • Refrigerated" : currentLang === "es" ? "Mostrador frío • Refrigerado" : "Balcão • Refrigerado";
      }

      const corredor = normalized.match(/corredor\s+([a-z])/i);
      const shelf = normalized.match(/prateleira\s*(\d+)/i);

      if (corredor && shelf) {
        if (currentLang === "en") return `Aisle ${corredor[1].toUpperCase()} • Shelf ${shelf[1]}`;
        if (currentLang === "es") return `Pasillo ${corredor[1].toUpperCase()} • Estante ${shelf[1]}`;
        return `Corredor ${corredor[1].toUpperCase()} • Prateleira ${shelf[1]}`;
      }

      if (corredor) {
        if (currentLang === "en") return `Aisle ${corredor[1].toUpperCase()}`;
        if (currentLang === "es") return `Pasillo ${corredor[1].toUpperCase()}`;
        return `Corredor ${corredor[1].toUpperCase()}`;
      }

      return normalized;
    }

    // ─── CATÁLOGO: páginas do backend + rolagem infinita ────────────────────
    // O backend devolve PAGE_SIZE produtos por vez; ao chegar perto do fim da
    // grade (#p-sentinel), a próxima página é anexada. Sem backend, pagina o
    // catálogo local de demonstração.
    const PAGE_SIZE = 24;
    const produtosDemo = produtos.slice();
    const catalog = { total: 0, offset: 0, loading: false, done: false, reqId: 0, remote: true };
    let productObserver = null;
    let searchDebounce = null;

    function renderProducts(search = "") {
      lastSearchTerm = search;
      catalog.reqId += 1;
      catalog.offset = 0;
      catalog.total = 0;
      catalog.done = false;
      catalog.loading = false;
      document.getElementById("p-grid").innerHTML = "";
      atualizarTituloLista();
      if (window.FlexVitrine) FlexVitrine.reiniciar();
      initProductObserver();
      loadMoreProducts();
    }

    function matchesLocal(p, q) {
      return p.nome.toLowerCase().includes(q) ||
        p.tipo.toLowerCase().includes(q) ||
        p.uso.toLowerCase().includes(q) ||
        p.indicacoes.some(i => i.toLowerCase().includes(q));
    }

    async function fetchProductsPage(q, offset) {
      const categoria = currentCategory === "todos" ? "" : currentCategory;
      const nicho = currentNicho === "todos" ? "" : currentNicho;
      if (catalog.remote && typeof apiGetProductsPage === "function") {
        const page = await apiGetProductsPage({ q, categoria, nicho, limit: PAGE_SIZE, offset });
        if (page) return page;
        catalog.remote = false; // backend offline: segue com o catálogo local
      }
      const ql = q.toLowerCase();
      const list = produtosDemo.map(getTranslatedProduct)
        .filter(p => categoria ? p.categoria === categoria
                     : !nicho || NICHO_DA_CATEGORIA[p.categoria] === nicho)
        .filter(p => !ql || matchesLocal(p, ql));
      return { items: list.slice(offset, offset + PAGE_SIZE), total: list.length };
    }

    async function loadMoreProducts() {
      if (catalog.loading || catalog.done) return;
      const reqId = catalog.reqId;
      const q = lastSearchTerm.trim();
      catalog.loading = true;
      setSentinel("loading");
      const page = await fetchProductsPage(q, catalog.offset);
      if (reqId !== catalog.reqId) return; // filtro mudou durante a requisição

      page.items.forEach(item => {
        const i = produtos.findIndex(p => String(p.id) === String(item.id));
        if (i >= 0) produtos[i] = { ...produtos[i], ...item };
        else produtos.push(item);
      });

      const grid = document.getElementById("p-grid");
      if (catalog.offset === 0 && !page.items.length) {
        grid.innerHTML = `
          <div class="empty">
            <div class="empty-ico">${icon("search")}</div>
            <p>${e(getText().empty)}</p>
          </div>
        `;
      } else {
        const first = catalog.offset === 0;
        grid.insertAdjacentHTML("beforeend",
          page.items.map((p, idx) => productCardHtml(getTranslatedProduct(p), first ? idx : -1)).join(""));
      }
      observarImpressoes(grid);
      // blocos da vitrine (banner, vídeo...) entre as linhas de produtos
      if (window.FlexVitrine && page.items.length) FlexVitrine.intercalar(grid, catalog.offset + page.items.length >= page.total);
      if (catalog.offset === 0 && q) {
        renderSearchDrop(page.items, q);
        rastrear("busca", q, { resultados: page.total });
      }

      catalog.offset += page.items.length;
      catalog.total = page.total;
      atualizarTituloLista();
      catalog.done = !page.items.length || catalog.offset >= page.total;
      catalog.loading = false;
      setSentinel(catalog.done ? "done" : "idle");

      // Tela alta e poucos itens: continua carregando até preencher a área visível
      if (!catalog.done && sentinelVisible()) loadMoreProducts();
    }

    // Produtos que ficaram ~1 s visíveis na tela (Atividade › Comportamento no admin)
    let impressaoObserver = null;
    const impressaoTimers = new Map();
    function observarImpressoes(raiz) {
      if (!("IntersectionObserver" in window) || !window.FlexSessao) return;
      if (!impressaoObserver) {
        impressaoObserver = new IntersectionObserver(entradas => entradas.forEach(en => {
          const card = en.target;
          if (en.isIntersecting) {
            impressaoTimers.set(card, setTimeout(() => {
              impressaoObserver.unobserve(card);
              const grid = document.getElementById("p-grid");
              let linha = 0;
              if (card.parentNode === grid) {
                const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
                linha = Math.floor([...grid.querySelectorAll(":scope > .p-card")].indexOf(card) / cols) + 1;
              }
              FlexSessao.impressao(card.dataset.id, linha);
            }, 900));
          } else {
            clearTimeout(impressaoTimers.get(card));
          }
        }), { threshold: 0.6 });
      }
      raiz.querySelectorAll(".p-card[data-id]:not([data-obs])").forEach(card => {
        card.dataset.obs = "1";
        impressaoObserver.observe(card);
      });
    }

    // Quem rola o catálogo: a coluna de produtos (totem horizontal) ou a página toda
    function productScroller() {
      const col = document.querySelector(".prod-col");
      return col && getComputedStyle(col).overflowY === "auto" ? col : document.getElementById("scroll");
    }

    function initProductObserver() {
      const root = productScroller();
      if (productObserver && productObserver.root === root) return;
      if (productObserver) productObserver.disconnect();
      if (!("IntersectionObserver" in window)) return;
      const sentinel = document.getElementById("p-sentinel");
      if (!sentinel) return;
      productObserver = new IntersectionObserver(entries => {
        if (entries.some(en => en.isIntersecting)) loadMoreProducts();
      }, { root, rootMargin: "0px 0px 600px 0px" });
      productObserver.observe(sentinel);
    }

    function sentinelVisible() {
      const sentinel = document.getElementById("p-sentinel");
      const scroll = productScroller();
      if (!sentinel || !scroll) return false;
      return sentinel.getBoundingClientRect().top < scroll.getBoundingClientRect().bottom + 600;
    }

    function setSentinel(state) {
      const sentinel = document.getElementById("p-sentinel");
      if (!sentinel) return;
      sentinel.dataset.state = state;
      const shown = document.getElementById("p-grid").querySelectorAll(".p-card").length;
      sentinel.textContent = state === "done" && shown > PAGE_SIZE
        ? `${shown} ${currentLang === "en" ? "products" : "produtos"}`
        : "";
    }

    // Estoque controlado no admin (loja.py) manda; sem cadastro de estoque, só os
    // produtos manuais controlam (importados por scraping não têm saldo real)
    function tracksStock(p) {
      if (p.controlaEstoque !== undefined) return p.controlaEstoque;
      return !p.fonte || p.fonte === "manual";
    }

    function precoLabel(p) {
      if (p.precoValor !== null && p.precoValor !== undefined && p.precoValor !== "") {
        return Number(p.precoValor).toLocaleString(currentLang === "en" ? "en-US" : "pt-BR", { style: "currency", currency: "BRL" });
      }
      return p.preco || "";
    }

    // Preço "de" (riscado) e % de desconto, quando o produto está em promoção
    function descontoInfo(p) {
      const atual = Number(p.precoValor), antes = Number(p.precoOriginal);
      if (!atual || !antes || antes <= atual) return null;
      const fmt = v => v.toLocaleString(currentLang === "en" ? "en-US" : "pt-BR", { style: "currency", currency: "BRL" });
      return { de: fmt(antes), pct: Math.round((1 - atual / antes) * 100) };
    }

    // Card no estilo de farmácia online: foto grande, nome e preço (todos do mesmo tamanho)
    function productCardHtml(p, idx) {
      // sem preço numérico (ex.: "Sob receita"): o preço é informado no balcão
      const price = p.precoValor != null && p.precoValor !== "" ? precoLabel(p) : L("Preço no balcão", "Price at the counter", "Precio en el mostrador");
      const desc = descontoInfo(p);
      return `
        <div class="p-card pc-loja ${p.esgotado ? "pc-sem-estoque" : ""} ${idx >= 0 ? `fu d${Math.min(idx + 1, 8)}` : ""}" data-id="${escapeHtml(String(p.id))}" onclick="openDetail('${escapeHtml(escapeJs(p.id))}')">
          <div class="pc-foto">
            ${productImageOrIcon(p, "card")}
            ${desc ? `<span class="pc-off">-${desc.pct}%</span>` : ""}
            ${p.esgotado ? `<span class="pc-estoque pc-esgotado">${e(L("Esgotado", "Sold out", "Agotado"))}</span>`
              : p.ultimasUnidades ? `<span class="pc-estoque">${e(L("Últimas unidades", "Last units", "Últimas unidades"))}</span>` : ""}
          </div>
          <div class="pc-name">${e(p.nome)}</div>
          ${p.receita ? `<div class="pc-rx">${window.FlexIcones ? FlexIcones.receita : ""}<span>${e(L("Com receita", "Prescription", "Con receta"))}</span></div>` : ""}
          <div class="pc-precos">
            ${desc ? `<span class="pc-de">${e(desc.de)}</span>` : ""}
            ${price ? `<span class="pc-price ${p.precoValor == null ? "pc-price-txt" : ""}">${e(price)}</span>` : ""}
          </div>
        </div>
      `;
    }

    async function loadCategoriesFromAPI() {
      if (typeof apiGetCategorias !== "function") return;
      const [cats, nichos] = await Promise.all([apiGetCategorias(), apiFetch("/nichos")]);
      // nichos (1º nível) e subcategorias vêm do admin (Catálogo › Categorias): nome, ícone, ordem e ativo
      if (Array.isArray(nichos) && nichos.length) {
        NICHOS.splice(0, NICHOS.length, ...nichos.map(n => ({ key: n.slug, label: n.nome, icon: n.icone || "tag" })));
        nichos.forEach(n => { categoryLabels.pt[n.slug] = n.nome; });   // nome do admin vale em português
      }
      if (!Array.isArray(cats) || !cats.length) return;
      // O banco manda as categorias com produtos, já na ordem dos chips
      categories.splice(1, categories.length - 1, ...cats.filter(c => c.slug).map(c => ({
        key: c.slug, label: c.nome || c.slug, icon: c.icone || CATEGORY_ICONS[c.slug] || "tag",
        nicho: c.nicho || NICHO_DA_CATEGORIA[c.slug] || "bem_estar"
      })));
      cats.forEach(c => { if (c.nicho) NICHO_DA_CATEGORIA[c.slug] = c.nicho; if (c.nome) categoryLabels.pt[c.slug] = c.nome; });
      if (!categories.some(c => c.key === currentCategory)) currentCategory = "todos";
      if (!nichosDisponiveis().some(n => n.key === currentNicho)) currentNicho = "todos";
      renderCategories();
    }

    // ─── IMAGENS DE PRODUTO ──────────────────────────────────
    // Gera o caminho da imagem com base no índice de ordem de exibição do produto.
    // Padrão: assets/imgRemedio{n}.png — onde n corresponde à posição na listagem.
    // Se o produto tiver imgUrl definida (ex: via painel admin), ela tem prioridade.
    // Para novos produtos, basta definir imgIndex com o próximo número da sequência.
    function getProductImagePath(p) {
      if (p.imgUrl) {
        // Fotos do Supabase saem do notebook (/foto/…), já reduzidas e em cache: pela internet do
        // hotspot cada uma levava ~0,8 s e 43 KB. Outros endereços (data:, http) seguem iguais.
        const noStorage = String(p.imgUrl).match(/\/storage\/v1\/object\/public\/(.+)$/);
        return noStorage ? `/foto/${noStorage[1]}?w=480` : p.imgUrl;
      }
      // Só os produtos de demonstração têm imagem local; os demais usam o ícone
      if (p.imgIndex === null || p.imgIndex === undefined) return "";
      return `assets/imgRemedio${p.imgIndex}.png`;
    }

    // Retorna HTML com a imagem do produto.
    // Se a imagem existir, exibe <img>; caso contrário, cai para o ícone SVG via onerror.
    function productImageOrIcon(p, size = "card") {
      const svgFallback = productIconSvg(p);
      const imgPath = getProductImagePath(p);
      const isCard = size === "card";
      if (!imgPath) {
        return `<span class="${isCard ? "pc" : "d"}-prod-icon-fallback" style="display:flex">${svgFallback}</span>`;
      }

      // Escapa strings para uso seguro em atributos HTML
      const safeAlt = escapeHtml(String(p.nome || ""));
      const safePath = escapeHtml(imgPath);

      if (isCard) {
        return `<img
          src="${safePath}"
          alt="${safeAlt}"
          class="pc-prod-img"
          loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
        /><span class="pc-prod-icon-fallback" style="display:none">${svgFallback}</span>`;
      }

      // Tela de detalhe — imagem maior, com fallback inline
      return `<img
        src="${safePath}"
        alt="${safeAlt}"
        class="d-prod-img d-prod-img--asset"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
      /><span class="d-prod-icon-fallback" style="display:none">${svgFallback}</span>`;
    }

    // Ícone SVG puro (sem imagem) — usado como fallback
    function productIconSvg(p) {
      if (p.categoria === "analgesico") return icon("pill");
      if (p.categoria === "antibiotico") return icon("shield");
      if (p.categoria === "vitaminas") return icon("leaf");
      if (p.categoria === "diabetes") return icon("drop");
      if (p.categoria === "dermato") return icon("sun");
      if (p.categoria === "infantil") return icon("smile");
      return icon("spark");
    }

    // Mantém compatibilidade com chamadas existentes (ex: chatbot, banners)
    function productIcon(p) {
      return productIconSvg(p);
    }

    // ─── PÁGINA DO PRODUTO (autoatendimento) ─────────────────
    // Foto grande, preço em destaque, ações grandes (quantidade + adicionar à
    // lista), ajuda (Libras/assistente) e produtos relacionados.
    let qtdDetalhe = 1;

    function L(pt, en, es) {
      return currentLang === "en" ? en : currentLang === "es" ? es : pt;
    }

    function fmtBRL(v) {
      return Number(v).toLocaleString(currentLang === "en" ? "en-US" : "pt-BR", { style: "currency", currency: "BRL" });
    }

    // Log anônimo da sessão de uso (sessao.js): o que a pessoa fez no totem
    function rastrear(tipo, alvo = "", detalhe = {}) {
      if (window.FlexSessao) FlexSessao.evento(tipo, alvo, detalhe);
      if (window.FlexVitrine) FlexVitrine.observar(tipo, alvo, detalhe);   // interesses da sessão
    }
    function rastrearTela(nome) {
      if (window.FlexSessao) FlexSessao.tela(nome);
    }

    function openDetail(id) {
      const raw = produtos.find(x => String(x.id) === String(id));
      if (!raw) return;
      const p = getTranslatedProduct(raw);
      const stock = tracksStock(p);
      const desc = descontoInfo(p);
      const t = getText();
      const idJs = escapeHtml(escapeJs(p.id));
      const ehMedicamento = NICHO_DA_CATEGORIA[p.categoria] === "medicamentos";
      const semEstoque = stock && p.estoque === 0;
      currentProduct = raw;
      qtdDetalhe = 1;

      document.getElementById("dp-voltar-txt").textContent = L("Voltar aos produtos", "Back to products", "Volver a productos");
      const uso = String(p.uso || "").trim();
      const usoLongo = uso.length > 260;

      document.getElementById("dp-conteudo").innerHTML = `
        <div class="dp-foto">
          ${productImageOrIcon(p, "card")}
          ${desc ? `<span class="dp-selo-off">-${desc.pct}%</span>` : ""}
          <span class="dp-selo-receita ${p.receita ? "rx" : ""}">${e(p.receita ? t.prescriptionSale : t.freeSale)}</span>
        </div>

        <div class="dp-cabecalho">
          ${p.tipo ? `<div class="dp-tipo">${e(p.tipo)}</div>` : ""}
          <h2 class="dp-nome">${e(p.nome)}</h2>
        </div>

        <div class="dp-preco">
          ${desc ? `<div class="dp-preco-de">${L("de", "from", "de")} <s>${e(desc.de)}</s></div>` : ""}
          <div class="dp-preco-linha">
            <span class="dp-preco-por ${p.precoValor == null ? "dp-preco-txt" : ""}">${e(p.precoValor != null ? precoLabel(p) : L("Preço no balcão", "Price at the counter", "Precio en el mostrador"))}</span>
            ${desc ? `<span class="dp-preco-off">-${desc.pct}%</span>` : ""}
          </div>
          ${desc ? `<div class="dp-economia">${L("Você economiza", "You save", "Ahorras")} ${e(fmtBRL(p.precoOriginal - p.precoValor))}</div>` : ""}
          <div class="dp-preco-nota">${L("Preço de referência. Confirme no caixa.", "Reference price. Confirm at checkout.", "Precio de referencia. Confirma en caja.")}</div>
        </div>
        ${p.receita ? `<div class="dp-receita">${window.FlexIcones ? FlexIcones.receita : ""}<div><b>${L("Venda com receita médica", "Prescription required", "Venta con receta médica")}</b>
          <span>${L("Você pode pedir pelo totem: apresente a receita no balcão para retirar.", "You can order here: show the prescription at the counter to pick it up.", "Puedes pedir aquí: presenta la receta en el mostrador.")}</span></div></div>` : ""}

        ${uso ? `
        <div class="dp-desc">
          <p class="dp-texto recolhido">${escapeHtml(clampText(uso, 2000))}</p>
          ${usoLongo ? `<button type="button" class="dp-ler-mais" onclick="this.previousElementSibling.classList.toggle('recolhido'); this.textContent = this.previousElementSibling.classList.contains('recolhido') ? '${L("Ver mais", "See more", "Ver más")}' : '${L("Ver menos", "See less", "Ver menos")}'">${L("Ver mais", "See more", "Ver más")}</button>` : ""}
        </div>` : ""}

        ${ehMedicamento ? `<div class="dp-aviso">${icon("info")}<span>${L("Leia a bula. Em caso de dúvida, fale com o farmacêutico.", "Read the leaflet. Ask the pharmacist if in doubt.", "Lee el prospecto. Consulta al farmacéutico.")}</span></div>` : ""}

        <section class="dp-recs" id="dp-junto" hidden>
          <h3>${L("Leve junto", "Buy it with", "Llévalo junto")}</h3>
          <div class="dp-rel-lista" id="dp-junto-lista"></div>
        </section>
        <section class="dp-recs" id="dp-parecidos" hidden>
          <h3>${L("Produtos parecidos", "Similar products", "Productos similares")}</h3>
          <div class="dp-rel-lista" id="dp-parecidos-lista"></div>
        </section>
      `;
      document.getElementById("dp-conteudo").scrollTop = 0;

      renderRodapeDetalhe(p, semEstoque);
      carregarRelacionados(p);

      document.getElementById("detail").classList.add("on");
      addChatMessage("bot", `${config.assistantMessage} ${currentLang === "en" ? "I am showing the details for" : currentLang === "es" ? "Estoy mostrando los detalles de" : "Estou mostrando os detalhes de"} ${p.nome}.`, false);
      incMetric("views");
      rastrear("produto", p.nome, { id: String(p.id), categoria: p.categoria, preco: p.precoValor ?? null });
      rastrearTela("produto");
      if (window.FlexSessao) FlexSessao.produtoAbriu(p);   // tempo na página do produto
      const conteudo = document.getElementById("dp-conteudo");
      conteudo.scrollTop = 0;
      conteudo.onscroll = () => window.FlexSessao && FlexSessao.produtoRolou(
        (conteudo.scrollTop + conteudo.clientHeight) / Math.max(conteudo.scrollHeight, 1));
    }

    // Barra fixa de ação: quantidade + adicionar ao carrinho (com o total)
    function renderRodapeDetalhe(p, semEstoque) {
      const rodape = document.getElementById("dp-rodape");
      if (semEstoque) {
        rodape.innerHTML = `<div class="dp-indisponivel">${e(getText().unavailable)}</div>`;
        return;
      }
      const total = p.precoValor ? fmtBRL(p.precoValor * qtdDetalhe) : "";
      rodape.innerHTML = `
        <div class="dp-qtd">
          <button type="button" onclick="mudarQtdDetalhe(-1)" aria-label="${L("Diminuir", "Decrease", "Disminuir")}" ${qtdDetalhe <= 1 ? "disabled" : ""}>−</button>
          <span>${qtdDetalhe}</span>
          <button type="button" onclick="mudarQtdDetalhe(1)" aria-label="${L("Aumentar", "Increase", "Aumentar")}">+</button>
        </div>
        <button type="button" class="dp-adicionar" onclick="adicionarDoDetalhe()">
          ${icon("cart")}
          <span>${L("Adicionar ao carrinho", "Add to cart", "Agregar al carrito")}${total ? ` · ${e(total)}` : ""}</span>
        </button>
      `;
    }

    function mudarQtdDetalhe(delta) {
      if (!currentProduct) return;
      qtdDetalhe = Math.max(1, Math.min(20, qtdDetalhe + delta));
      renderRodapeDetalhe(getTranslatedProduct(currentProduct), false);
    }

    function adicionarDoDetalhe() {
      if (!currentProduct) return;
      addToCart(currentProduct.id, qtdDetalhe, document.querySelector("#dp-conteudo .dp-foto img"));
    }

    // Recomendações (backend/recomendacoes.py): "leve junto" e "parecidos"
    async function carregarRelacionados(p) {
      let r = null;
      try {
        const res = await fetch(`${FLEXMED_API_BASE}/products/${encodeURIComponent(p.id)}/recomendacoes`);
        if (res.ok) r = await res.json();
      } catch (_) { /* sem recomendações */ }
      if (!r || !currentProduct || String(currentProduct.id) !== String(p.id)) return;
      [...(r.levar_junto || []), ...(r.parecidos || [])].forEach(item => {
        if (!produtos.some(x => String(x.id) === String(item.id))) produtos.push(item);
      });
      const cartao = (x, comMais) => `
        <div class="dp-rel" onclick="openDetail('${escapeHtml(escapeJs(x.id))}')">
          <span class="dp-rel-foto">${productImageOrIcon(x, "card")}</span>
          <span class="dp-rel-nome">${e(x.nome)}</span>
          <span class="dp-rel-rodape">
            <span class="dp-rel-preco">${e(precoLabel(x))}</span>
            ${comMais ? `<button type="button" class="dp-rel-mais" aria-label="${L("Adicionar ao carrinho", "Add to cart", "Agregar")}"
              onclick="event.stopPropagation(); adicionarRecomendado('${escapeHtml(escapeJs(x.id))}', this)">+</button>` : ""}
          </span>
        </div>`;
      for (const [secao, lista, itens, comMais] of [
        ["dp-junto", "dp-junto-lista", r.levar_junto || [], true],
        ["dp-parecidos", "dp-parecidos-lista", r.parecidos || [], false],
      ]) {
        if (!itens.length) continue;
        document.getElementById(lista).innerHTML = itens.map(x => cartao(x, comMais)).join("");
        document.getElementById(secao).hidden = false;
      }
    }

    function adicionarRecomendado(id, botao) {
      if (!addToCart(id, 1, botao.closest(".dp-rel, .ad-rec")?.querySelector("img"))) return;
      rastrear("clique", "leve junto: adicionou");
      botao.textContent = "✓";
      botao.classList.add("ok");
      botao.disabled = true;
    }

    function closeDetail() {
      if (window.FlexSessao) FlexSessao.produtoFechou();
      document.getElementById("detail").classList.remove("on");
      rastrearTela("inicio");
      currentProduct = null;
    }

    // Microfone da busca: abre o assistente já ouvindo
    function falarNaBusca() {
      openChatbot();
      setTimeout(() => agMic(), 150);
    }

    function atualizarSaudacao() {
      const el = document.getElementById("s-saudacao");
      if (!el) return;
      const h = new Date().getHours();
      const oi = h < 12 ? L("Bom dia", "Good morning", "Buenos días") : h < 18 ? L("Boa tarde", "Good afternoon", "Buenas tardes") : L("Boa noite", "Good evening", "Buenas noches");
      el.textContent = `${oi}! ${L("O que você procura hoje?", "What are you looking for today?", "¿Qué buscas hoy?")}`;
    }

    function atualizarTituloLista() {
      const titulo = document.getElementById("t-dest");
      if (!titulo) return;
      const q = (lastSearchTerm || "").trim();
      const cat = categories.find(c => c.key === currentCategory && c.key !== "todos");
      const nicho = NICHOS.find(n => n.key === currentNicho);
      titulo.textContent = q ? L(`Resultados para “${q}”`, `Results for “${q}”`, `Resultados para “${q}”`)
        : cat ? translateCategoryLabel(cat.key, cat.label)
        : nicho ? translateCategoryLabel(nicho.key, nicho.label)
        : L("Todos os produtos", "All products", "Todos los productos");
      const conta = document.getElementById("t-conta");
      if (conta) conta.textContent = catalog.total ? L(`${catalog.total} produtos`, `${catalog.total} products`, `${catalog.total} productos`) : "";
    }

    function onSrch(val) {
      const drop = document.getElementById("s-drop");
      const clr = document.getElementById("s-clr");

      clr.style.display = val ? "flex" : "none";
      if (!val.trim()) {
        drop.classList.remove("on");
        drop.innerHTML = "";
      }
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => renderProducts(val), 250);
    }

    function renderSearchDrop(items, q) {
      const drop = document.getElementById("s-drop");
      const input = document.getElementById("s-in");
      if (!input || input.value.trim() !== q) return;
      const matches = items.slice(0, 6).map(getTranslatedProduct);
      if (!matches.length) {
        drop.classList.remove("on");
        drop.innerHTML = "";
        return;
      }
      drop.innerHTML = matches.map(p => `
        <div class="s-item" onclick="openDetail('${escapeHtml(escapeJs(p.id))}')">
          <div class="s-item-ico">${productIcon(p)}</div>
          <div class="s-item-txt">
            <div class="s-item-name">${e(p.nome)}</div>
            <div class="s-item-sub">${e([p.tipo, precoLabel(p)].filter(Boolean).join(" · "))}</div>
          </div>
        </div>
      `).join("");
      if (document.activeElement === input) drop.classList.add("on");
    }

    function clrSrch() {
      document.getElementById("s-in").value = "";
      document.getElementById("s-clr").style.display = "none";
      document.getElementById("s-drop").classList.remove("on");
      renderProducts("");
    }

    function showDrop() {
      const val = document.getElementById("s-in").value.trim();
      if (val) document.getElementById("s-drop").classList.add("on");
    }

    function hideDrop() {
      document.getElementById("s-drop").classList.remove("on");
    }

    function lbSel(texto) {
      const t = getText();
      document.getElementById("lb-st").textContent = `${t.interpreting} ${texto}...`;
      setTimeout(() => {
        document.getElementById("lb-st").textContent = t.recognized;
        document.getElementById("lb-text").textContent = librasMap[texto] || t.recognized;
        document.getElementById("lb-result").classList.add("on");
        incMetric("libras");
        showToast(t.librasDone);
      }, 900);
    }

    function openQR() {
      if (!currentProduct) return;
      const p = getTranslatedProduct(currentProduct);
      document.getElementById("qr-note").textContent = `${p.nome} • ${p.local}`;
      drawQR(p.nome + p.local);
      openOv("o-qr");
    }

    function drawQR(seedText) {
      const canvas = document.getElementById("qr-canvas");
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, 130, 130);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 130, 130);

      const seed = seedText.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      ctx.fillStyle = "#0A1628";

      [[5,5],[95,5],[5,95]].forEach(([x,y]) => {
        ctx.fillRect(x, y, 30, 30);
        ctx.fillStyle = "#fff";
        ctx.fillRect(x + 5, y + 5, 20, 20);
        ctx.fillStyle = "#0A1628";
        ctx.fillRect(x + 8, y + 8, 14, 14);
      });

      for (let r = 0; r < 13; r++) {
        for (let c = 0; c < 13; c++) {
          if ((r < 4 && c < 4) || (r < 4 && c > 8) || (r > 8 && c < 4)) continue;
          const hash = ((seed * (r * 13 + c) * 2654435761) >>> 0) % 100;
          if (hash < 52) {
            ctx.fillStyle = "#0A1628";
            ctx.fillRect(5 + c * 9, 5 + r * 9, 8, 8);
          }
        }
      }
    }

    function toggleAg() {
      const panel = document.getElementById("ag-bub");
      if (panel.classList.contains("on")) {
        closeChatbot();
        return;
      }
      openChatbot();
    }

    function showAgent(msg) {
      addChatMessage("bot", msg, false);
    }

    function closeChatbot() {
      document.getElementById("ag-bub").classList.remove("on");
    }

    function addChatMessage(role, message, openPanel = true) {
      const wrap = document.getElementById("ag-msgs");
      if (!wrap) return;
      const bubble = document.createElement("div");
      bubble.className = `ag-msg ${role}`;
      bubble.textContent = message;
      wrap.appendChild(bubble);
      wrap.scrollTop = wrap.scrollHeight;
      if (openPanel) {
        const panel = document.getElementById("ag-bub");
        panel.classList.add("on");
      }
    }

    function refreshChatbotTexts() {
      const t = getText();
      document.getElementById("ag-title").textContent = t.chatbotTitle;
      document.getElementById("ag-sub").textContent = t.chatbotSub;
      const wrap = document.getElementById("ag-msgs");
      if (!wrap.children.length) {
        addChatMessage("bot", t.chatbotGreeting, false);
        addChatMessage("bot", t.chatbotPrompt, false);
      }
    }

    // ─── ASSISTENTE POR VOZ ─────────────────────────────────
    // Toque no microfone: grava a fala, o backend transcreve e busca no catálogo;
    // o painel mostra o que foi entendido e os produtos, e a resposta é falada.
    let ultimaBuscaVoz = null;

    function agStatus(texto) {
      const el = document.getElementById("ag-voz-status");
      if (el) el.textContent = texto;
    }

    async function agMic() {
      const botao = document.getElementById("ag-mic");
      if (FlexVoz.gravando) { FlexVoz.parar(); return; }
      try {
        const r = await FlexVoz.ouvir({
          onEstado: estado => {
            botao.classList.toggle("ouvindo", estado === "ouvindo");
            botao.classList.toggle("processando", estado === "processando");
            agStatus(estado === "ouvindo" ? "Ouvindo... pode falar" : "Procurando...");
          },
          onVolume: v => botao.style.setProperty("--vol", v.toFixed(2)),
          onParcial: texto => agFalaAoVivo(texto),
        });
        botao.classList.remove("ouvindo", "processando");
        agFalaAoVivo(null);  // o balão do rascunho dá lugar ao texto final
        if (!r) { agStatus("Toque no microfone e diga o produto ou o que está sentindo"); return; }
        if (r.semFala) { agStatus("Não ouvi nada. Toque e fale mais perto do totem."); return; }
        mostrarResultadoVoz(r);
      } catch (err) {
        botao.classList.remove("ouvindo", "processando");
        agFalaAoVivo(null);
        const nome = String(err && (err.name || err.message));
        agStatus(nome.includes("NotAllowed") ? "Permita o uso do microfone para falar com o assistente."
               : nome.includes("NotFound") ? "Nenhum microfone encontrado."
               : nome.includes("servidor_503") ? "O reconhecimento de voz ainda está carregando. Tente em instantes."
               : "Não consegui processar. Tente de novo.");
      }
    }

    // Balão com o que está sendo ouvido, atualizado enquanto a pessoa fala
    // (texto null remove o balão)
    function agFalaAoVivo(texto) {
      let bolha = document.getElementById("ag-ao-vivo");
      if (texto === null) { if (bolha) bolha.remove(); return; }
      const wrap = document.getElementById("ag-msgs");
      if (!bolha) {
        bolha = document.createElement("div");
        bolha.id = "ag-ao-vivo";
        bolha.className = "ag-msg user ag-ao-vivo";
        wrap.appendChild(bolha);
      }
      bolha.textContent = texto;
      wrap.scrollTop = wrap.scrollHeight;
    }

    function mostrarResultadoVoz(r) {
      rastrear("voz", r.texto || "", { produtos: (r.produtos || []).length, sintoma: r.sintoma || null });
      if (r.texto) addChatMessage("user", r.texto);
      addChatMessage("bot", r.resposta);
      FlexVoz.falar(r.resposta);
      agStatus("Toque no microfone para uma nova busca");

      // produtos encontrados entram no catálogo local para o detalhe abrir
      (r.produtos || []).forEach(item => {
        const i = produtos.findIndex(p => String(p.id) === String(item.id));
        if (i >= 0) produtos[i] = { ...produtos[i], ...item }; else produtos.push(item);
      });
      if (!r.produtos || !r.produtos.length) return;
      ultimaBuscaVoz = r;

      const wrap = document.getElementById("ag-msgs");
      const lista = document.createElement("div");
      lista.className = "ag-prods";
      lista.innerHTML = r.produtos.slice(0, 6).map(p => `
        <button type="button" class="ag-prod" onclick="openDetail('${escapeHtml(escapeJs(p.id))}')">
          <span class="ag-prod-foto">${productImageOrIcon(p, "card")}</span>
          <span class="ag-prod-nome">${e(p.nome)}</span>
          <span class="ag-prod-preco">${e(precoLabel(p))}</span>
        </button>
      `).join("") + `
        <button type="button" class="ag-ver-vitrine" onclick="verBuscaNaVitrine()">
          Ver ${r.produtos.length > 6 ? "todos" : ""} na vitrine
        </button>`;
      wrap.appendChild(lista);
      wrap.scrollTop = wrap.scrollHeight;
    }

    // Aplica a busca falada à vitrine principal: produto citado vira busca;
    // só sintoma vira filtro de categoria
    function verBuscaNaVitrine() {
      const r = ultimaBuscaVoz;
      if (!r) return;
      closeChatbot();
      const input = document.getElementById("s-in");
      if (r.termos && r.termos.length) {
        currentNicho = "todos";
        currentCategory = "todos";
        renderCategories();
        input.value = r.termos.join(" ");
        onSrch(input.value);
      } else if (r.categoria) {
        input.value = "";
        clrSrch();
        setCategory(r.categoria);
      }
      scrollTopProducts();
    }

    // Barra de baixo do totem: atalhos à esquerda e o carrinho (itens, total, fechar pedido) à direita
    function renderNav() {
      const nav = document.getElementById("nav");
      if (!nav) return;
      const t = i18n[currentLang] || i18n.pt;
      const atalhos = navItems.filter(i => i.key !== "cart" && i.key !== "libras");
      nav.innerHTML = `
        <div class="dock-atalhos">${atalhos.map((item, idx) => `
          <button type="button" class="nav-i ${idx === 0 ? "on" : ""}" data-key="${e(item.key)}" onclick="navAction('${e(item.key)}', this)">
            <span class="nav-ico">${icon(item.icon)}</span>
            <span class="nav-lbl">${e(t[item.labelKey])}</span>
          </button>`).join("")}</div>
        <button type="button" class="dock-carrinho" id="dock-carrinho" onclick="abrirPedido()" aria-live="polite"></button>`;
      atualizarDock();
    }

    function totalCarrinho() {
      return cart.reduce((t, i) => t + (i.valor || 0) * i.qty, 0);
    }

    function atualizarDock(pulsar = false) {
      const botao = document.getElementById("dock-carrinho");
      if (!botao) return;
      const itens = cart.reduce((n, i) => n + i.qty, 0);
      botao.classList.toggle("vazio", !itens);
      botao.innerHTML = itens ? `
        <span class="dock-ico">${icon("cart")}<b class="dock-qtd" id="dock-qtd">${itens}</b></span>
        <span class="dock-txt"><span>${e(L(`${itens} ${itens === 1 ? "item" : "itens"}`, `${itens} item${itens === 1 ? "" : "s"}`, `${itens} artículo${itens === 1 ? "" : "s"}`))}</span>
          <b>${e(fmtBRL(totalCarrinho()))}</b></span>
        <span class="dock-cta">${e(L("Fechar pedido", "Checkout", "Finalizar"))}</span>`
        : `<span class="dock-ico">${icon("cart")}</span><span class="dock-txt"><span>${e(L("Seu carrinho", "Your cart", "Tu carrito"))}</span><b>${e(L("vazio", "empty", "vacío"))}</b></span>`;
      if (pulsar) {
        const qtd = document.getElementById("dock-qtd");
        if (qtd) qtd.animate([{ transform: "scale(1)" }, { transform: "scale(1.45)" }, { transform: "scale(1)" }],
                             { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      }
    }

    function abrirPedido() {
      fecharAdicionado();
      if (document.getElementById("detail").classList.contains("on")) closeDetail();
      openOv("o-cart");
    }

    function navAction(key, el) {
      document.querySelectorAll(".nav-i").forEach(n => n.classList.remove("on"));
      el.classList.add("on");
      const found = navItems.find(i => i.key === key);
      if (found) found.action();
      // For overlay-based nav items, reset active state when overlay closes
      if (key === "libras" || key === "cart") {
        const overlayMap = { libras: "o-lb", cart: "o-cart" };
        const ovId = overlayMap[key];
        const ovEl = document.getElementById(ovId);
        const resetBtn = () => {
          el.classList.remove("on");
          // Re-activate home button as fallback
          const homeBtn = document.querySelector('.nav-i[data-key="home"]');
          if (homeBtn) homeBtn.classList.add("on");
          ovEl.removeEventListener("click", onOverlayClick);
        };
        const onOverlayClick = (evt) => {
          if (evt.target.id === ovId) resetBtn();
        };
        const closeBtn = ovEl && ovEl.querySelector(".sheet-x");
        if (closeBtn) {
          closeBtn.addEventListener("click", resetBtn, { once: true });
        }
        if (ovEl) ovEl.addEventListener("click", onOverlayClick);
      }
    }

    function navHome() {
      document.getElementById("scroll").scrollTo({ top: 0, behavior: "smooth" });
      closeDetail();
    }

    function openOv(id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (window.__standby && typeof window.__standby.exitNow === "function") window.__standby.exitNow();
      el.classList.add("on");
      const tela = { "o-lb": "libras", "o-cart": "carrinho", "o-qr": "qr", "o-rate": "avaliacao" }[id];
      if (tela) rastrearTela(tela);
      if (id === "o-lb") rastrear("libras", "abriu");
    }
    window.openOv = openOv;

    function closeOv(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove("on");
      rastrearTela(document.getElementById("detail").classList.contains("on") ? "produto" : "inicio");
    }
    window.closeOv = closeOv;

    function ovClick(e, id) {
      if (e.target.id === id) closeOv(id);
    }

    function renderStars() {
      document.getElementById("stars-row").innerHTML = Array.from({ length: 5 }, (_, i) => `
        <button type="button" class="star-b ${i < currentRating ? "on" : ""}" onclick="setRating(${i + 1})">
          ${icon("star")}
        </button>
      `).join("");
    }

    function setRating(v) {
      currentRating = v;
      apiSaveRating(currentRating);
      renderStars();
    }

    function submitRating() {
      if (!currentRating) {
        showToast(getText().sendRating);
        return;
      }
      rastrear("avaliacao", String(currentRating));
      metrics.score = Number(((metrics.score + currentRating) / 2).toFixed(1));
      document.getElementById("m-score").textContent = metrics.score.toFixed(1);
      document.getElementById("stat-rate").textContent = metrics.score.toFixed(1);
      document.getElementById("rate-msg").value = "";
      currentRating = 0;
      renderStars();
      closeOv("o-rate");
      showToast(getText().ratingSuccess);
    }

    function renderMetrics() {
      document.getElementById("m-today").textContent = metrics.views;
      document.getElementById("m-week").textContent = metrics.week;
      document.getElementById("m-score").textContent = metrics.score.toFixed(1);

      const top = Object.entries(metrics.searches)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

      document.getElementById("top-searches").innerHTML = top.map(([name, cnt]) => `
        <div class="ts-row">
          <div class="ts-ico">${icon("search")}</div>
          <div class="ts-name">${e(name)}</div>
          <div class="ts-cnt">${Number(cnt)}x</div>
        </div>
      `).join("");
    }

    function incMetric(type) {
      if (type === "views") metrics.views += 1;
      if (type === "libras") metrics.libras += 1;
      renderMetrics();
      if (typeof apiTrackEvent === "function") apiTrackEvent(type).catch(() => {});
    }

    function showToast(text) {
      const toast = document.getElementById("toast");
      document.getElementById("toast-text").textContent = text;
      toast.classList.add("on");
      clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => toast.classList.remove("on"), 3000);
    }

    function escapeHtml(str) {
      return String(str ?? "").replace(/[&<>"']/g, m => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[m]);
    }

    function escapeJs(str) {
      return String(str ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, " ");
    }

    function hexToRgba(hex, alpha) {
      const sanitized = hex.replace("#", "");
      const bigint = parseInt(sanitized, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function icon(name) {
      const icons = {
        home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7"></path><path d="M5 10v10h14V10"></path></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
        hand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0z"/></svg>`,
        palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1a3 3 0 0 0 0-6h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-4z"></path><circle cx="7.5" cy="10.5" r=".8" fill="currentColor" stroke="none"></circle><circle cx="10" cy="7.5" r=".8" fill="currentColor" stroke="none"></circle><circle cx="15" cy="7.5" r=".8" fill="currentColor" stroke="none"></circle></svg>`,
        star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"></polygon></svg>`,
        bar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M7 15v-3"></path><path d="M12 15V8"></path><path d="M17 15v-6"></path></svg>`,
        search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>`,
        pill: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5 4.9 7.9a3.5 3.5 0 1 1 5-5l5.6 5.6"></path><path d="m13.5 10.5 5.6 5.6a3.5 3.5 0 1 1-5 5l-5.6-5.6"></path><path d="m8 6 10 10"></path></svg>`,
        shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
        leaf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 18 7c0 5-2 11-7 13Z"></path><path d="M6 4c6 0 9 3 9 9-6 0-9-3-9-9Z"></path></svg>`,
        drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"></path></svg>`,
        sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`,
        smile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><path d="M9 9h.01"></path><path d="M15 9h.01"></path></svg>`,
        spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"></path></svg>`,
        pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.3 7-11a7 7 0 0 0-14 0c0 5.7 7 11 7 11Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>`,
        pinSm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s5.4-4.2 5.4-8.9a5.4 5.4 0 1 0-10.8 0C6.6 15.8 12 20 12 20Z"></path><circle cx="12" cy="11" r="1.9"></circle></svg>`,
        snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"></path><path d="m4.93 6.93 14.14 10.14"></path><path d="M19.07 6.93 4.93 17.07"></path><path d="m8.5 4 3.5 2 3.5-2"></path><path d="m8.5 20 3.5-2 3.5 2"></path><path d="m3.5 9 3.5 2-3.5 2"></path><path d="m20.5 9-3.5 2 3.5 2"></path></svg>`,
        target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1.5"></circle></svg>`,
        doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>`,
        box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>`,
        tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 11 3H4v7l9.59 9.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82Z"></path><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" stroke="none"></circle></svg>`,
        info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`,
        bot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="3"></rect><path d="M8 22h8"></path><path d="M12 18v4"></path><circle cx="9" cy="11" r="1"></circle><circle cx="15" cy="11" r="1"></circle><path d="M9 14c1 .7 2 .9 3 .9s2-.2 3-.9"></path></svg>`,
        cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`,
        arrowRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path></svg>`,
        qr: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><path d="M14 14h3v3h-3zM17 17h3v3h-3z" fill="currentColor" stroke="none" opacity=".65"></path></svg>`,
        store: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9,22 9,12 15,12 15,22"></polyline></svg>`
      };
      return icons[name] || "";
    }

    function initCategoryDrag() {
      const row = document.getElementById("cats-row");
      if (!row || row.dataset.dragReady === "1") return;
      row.dataset.dragReady = "1";

      const startDrag = clientX => {
        catDrag.active = true;
        catDrag.startX = clientX;
        catDrag.startScrollLeft = row.scrollLeft;
        row.classList.add("dragging");
      };

      const moveDrag = clientX => {
        if (!catDrag.active) return;
        const walk = clientX - catDrag.startX;
        row.scrollLeft = catDrag.startScrollLeft - walk;
      };

      const endDrag = () => {
        catDrag.active = false;
        row.classList.remove("dragging");
      };

      row.addEventListener("mousedown", e => startDrag(e.pageX));
      row.addEventListener("mousemove", e => moveDrag(e.pageX));
      row.addEventListener("mouseleave", endDrag);
      row.addEventListener("mouseup", endDrag);
      row.addEventListener("touchstart", e => startDrag(e.touches[0].clientX), { passive: true });
      row.addEventListener("touchmove", e => moveDrag(e.touches[0].clientX), { passive: true });
      row.addEventListener("touchend", endDrag, { passive: true });
    }

    // ─── CART ────────────────────────────────────────────────
    let cart = [];

    function addToCart(productId, qtd = 1, origem = null) {
      const raw = produtos.find(x => String(x.id) === String(productId));
      if (!raw) return false;
      const p = getTranslatedProduct(raw);
      const existing = cart.find(i => i.id === String(productId));
      // estoque controlado: não deixa pedir mais do que há disponível
      if (tracksStock(p) && typeof p.estoque === "number") {
        const jaNaLista = existing ? existing.qty : 0;
        if (jaNaLista + qtd > p.estoque) {
          showToast(p.estoque > jaNaLista
            ? L(`Só há ${p.estoque} unidade(s) disponível(is).`, `Only ${p.estoque} unit(s) available.`, `Solo hay ${p.estoque} unidad(es).`)
            : L("Produto sem estoque no momento.", "Out of stock right now.", "Sin stock en este momento."));
          return false;
        }
      }
      if (existing) {
        existing.qty += qtd;
      } else {
        cart.push({ id: String(productId), name: p.nome, price: p.precoValor != null ? precoLabel(p) : L("Preço no balcão", "Price at the counter", "Precio en el mostrador"),
                    valor: Number(p.precoValor) || 0, receita: !!p.receita,
                    img: getProductImagePath(p), qty: qtd });
      }
      renderCart();
      rastrear("carrinho_add", p.nome, { id: String(productId), qtd, preco: p.precoValor ?? null, categoria: p.categoria });
      voarParaCarrinho(origem).then(() => { atualizarDock(true); mostrarAdicionado(p, qtd); });
      return true;
    }

    // ─── O momento de adicionar: a foto voa até o carrinho e abre a confirmação ───
    // (com "reduzir movimento", só a confirmação aparece)
    function voarParaCarrinho(origem) {
      // na página do produto a barra de baixo fica coberta: voa até o botão de adicionar
      const destino = document.getElementById("detail").classList.contains("on")
        ? document.querySelector("#dp-rodape .dp-adicionar svg") : document.querySelector("#dock-carrinho .dock-ico");
      const reduzir = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!origem || !destino || reduzir || !origem.getBoundingClientRect().width) return Promise.resolve();
      const de = origem.getBoundingClientRect(), para = destino.getBoundingClientRect();
      const zoom = parseFloat(getComputedStyle(document.getElementById("totem")).zoom) || 1;
      const voo = origem.cloneNode();
      voo.className = "voo-produto";
      const lado = Math.min(de.width, de.height);
      Object.assign(voo.style, { left: `${(de.left + (de.width - lado) / 2) / zoom}px`, top: `${(de.top + (de.height - lado) / 2) / zoom}px`,
                                 width: `${lado / zoom}px`, height: `${lado / zoom}px` });
      document.getElementById("totem").appendChild(voo);
      const dx = (para.left + para.width / 2 - (de.left + de.width / 2)) / zoom;
      const dy = (para.top + para.height / 2 - (de.top + de.height / 2)) / zoom;
      const escala = Math.max(0.12, (para.width / zoom) / (lado / zoom));
      const anim = voo.animate([
        { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.25 - 60}px) scale(0.6)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(${escala})`, opacity: 0.2 },
      ], { duration: 560, easing: "cubic-bezier(0.5, 0, 0.2, 1)" });
      return anim.finished.then(() => voo.remove(), () => voo.remove());
    }

    let adicionadoTimer = null;
    function mostrarAdicionado(p, qtd) {
      fecharAdicionado(true);
      const itens = cart.reduce((n, i) => n + i.qty, 0);
      const fundo = document.createElement("div");
      fundo.className = "ad-fundo";
      fundo.id = "ad-fundo";
      fundo.innerHTML = `
        <div class="ad-painel" role="dialog" aria-labelledby="ad-titulo">
          <div class="ad-topo"><span class="ad-check">${icon("check")}</span>
            <h2 id="ad-titulo">${e(L("Adicionado ao carrinho", "Added to cart", "Agregado al carrito"))}</h2></div>
          <div class="ad-item">
            <div class="ad-foto">${productImageOrIcon(p, "card")}</div>
            <div class="ad-info"><b>${e(p.nome)}</b><span>${qtd} × ${e(precoLabel(p) || "—")}</span></div>
          </div>
          <div class="ad-resumo"><span>${e(L(`Carrinho com ${itens} ${itens === 1 ? "item" : "itens"}`, `Cart: ${itens} item${itens === 1 ? "" : "s"}`, `Carrito: ${itens}`))}</span>
            <b>${e(fmtBRL(totalCarrinho()))}</b></div>
          <div class="ad-recs" id="ad-recs" hidden><h3>${e(L("Quem leva este também leva", "Often bought together", "También llevan"))}</h3><div class="ad-recs-lista" id="ad-recs-lista"></div></div>
          <div class="ad-acoes">
            <button type="button" class="ad-seguir" onclick="continuarComprando()">${e(L("Continuar comprando", "Keep shopping", "Seguir comprando"))}</button>
            <button type="button" class="ad-fechar" onclick="abrirPedido()">${icon("cart")}<span>${e(L("Fechar pedido", "Checkout", "Finalizar pedido"))}</span></button>
          </div>
        </div>`;
      fundo.addEventListener("click", ev => { if (ev.target === fundo) continuarComprando(); });
      document.getElementById("totem").appendChild(fundo);
      requestAnimationFrame(() => fundo.classList.add("on"));
      carregarRecsAdicionado(p);
      clearTimeout(adicionadoTimer);
      adicionadoTimer = setTimeout(() => fecharAdicionado(), 15000);
    }

    async function carregarRecsAdicionado(p) {
      if (typeof FLEXMED_API_BASE === "undefined") return;
      try {
        const r = await fetch(`${FLEXMED_API_BASE}/products/${encodeURIComponent(p.id)}/recomendacoes`);
        if (!r.ok) return;
        const dados = await r.json();
        const lista = (dados.levar_junto || []).filter(x => !cart.some(c => c.id === String(x.id))).slice(0, 3);
        const alvo = document.getElementById("ad-recs-lista");
        if (!lista.length || !alvo) return;
        lista.forEach(x => { if (!produtos.some(y => String(y.id) === String(x.id))) produtos.push(x); });
        alvo.innerHTML = lista.map(x => { const tp = getTranslatedProduct(x); return `
          <div class="ad-rec">
            <div class="ad-rec-foto">${productImageOrIcon(tp, "card")}</div>
            <span>${e(tp.nome)}</span><b>${e(precoLabel(tp) || "")}</b>
            <button type="button" onclick="adicionarRecomendado('${escapeHtml(escapeJs(tp.id))}', this)">${e(L("Adicionar", "Add", "Agregar"))}</button>
          </div>`; }).join("");
        document.getElementById("ad-recs").hidden = false;
      } catch (_) { /* sem sugestões */ }
    }

    function fecharAdicionado(imediato = false) {
      clearTimeout(adicionadoTimer);
      const fundo = document.getElementById("ad-fundo");
      if (!fundo) return;
      if (imediato) { fundo.remove(); return; }
      fundo.classList.remove("on");
      setTimeout(() => fundo.remove(), 220);
    }

    function continuarComprando() {
      fecharAdicionado();
      if (document.getElementById("detail").classList.contains("on")) closeDetail();
    }

    function removeFromCart(id) {
      const item = cart.find(i => i.id === id);
      if (item) rastrear("carrinho_remover", item.name, { id });
      cart = cart.filter(i => i.id !== id);
      renderCart();
    }

    function renderCart() {
      const list = document.getElementById('cart-list');
      const empty = document.getElementById('cart-empty');
      const total = document.getElementById('cart-total');
      const enviar = document.getElementById('cart-enviar');
      atualizarDock();
      if (!list) return;
      if (enviar) enviar.disabled = !cart.length;
      if (!cart.length) {
        list.innerHTML = '';
        if (total) total.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
      }
      if (empty) empty.style.display = 'none';
      list.innerHTML = cart.map(item => {
        const idJs = escapeHtml(escapeJs(item.id));
        return `
        <div class="cart-item">
          <div class="cart-foto">${item.img ? `<img src="${escapeHtml(item.img)}" alt="">` : icon("pill")}</div>
          <div class="cart-info"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.price)}${item.receita ? ` · <em class="cart-rx">${L("receita", "prescription", "receta")}</em>` : ""}</span></div>
          <div class="cart-qtd">
            <button type="button" onclick="changeQty('${idJs}',-1)" aria-label="${L("Diminuir", "Decrease", "Disminuir")}">−</button>
            <span>${item.qty}</span>
            <button type="button" onclick="changeQty('${idJs}',1)" aria-label="${L("Aumentar", "Increase", "Aumentar")}">+</button>
          </div>
          <b class="cart-sub">${escapeHtml(item.valor ? fmtBRL(item.valor * item.qty) : "—")}</b>
          <button type="button" class="cart-rem" onclick="removeFromCart('${idJs}')" aria-label="${L("Remover", "Remove", "Quitar")}">${L("Remover", "Remove", "Quitar")}</button>
        </div>`; }).join('');
      const itens = cart.reduce((n, i) => n + i.qty, 0);
      const comReceita = cart.filter(i => i.receita).length;
      if (total) total.innerHTML = (comReceita ? `<div class="cart-aviso-rx">${window.FlexIcones ? FlexIcones.receita : ""}<span>${L(
        `${comReceita} ${comReceita === 1 ? "item exige" : "itens exigem"} receita: apresente no balcão ao retirar.`,
        `${comReceita} item(s) need a prescription: show it at the counter.`, `${comReceita} artículo(s) con receta: preséntala en el mostrador.`)}</span></div>` : "") + `<span>${L(`Total estimado · ${itens} ${itens === 1 ? "item" : "itens"}`, `Estimated total · ${itens} items`, `Total estimado · ${itens}`)}</span><b>${fmtBRL(totalCarrinho())}</b>
        <small>${L("Preços de referência. O valor final é confirmado no balcão.", "Reference prices. Final amount confirmed at the counter.", "Precios de referencia. Se confirma en el mostrador.")}</small>`;
    }

    function changeQty(id, delta) {
      const item = cart.find(i => i.id === id);
      if (!item) return;
      const raw = produtos.find(x => String(x.id) === String(id));
      if (delta > 0 && raw && tracksStock(raw) && typeof raw.estoque === "number" && item.qty + delta > raw.estoque) {
        showToast(L(`Só há ${raw.estoque} unidade(s) disponível(is).`, `Only ${raw.estoque} unit(s) available.`, `Solo hay ${raw.estoque}.`));
        return;
      }
      item.qty += delta;
      if (item.qty <= 0) removeFromCart(id);
      else renderCart();
    }

    // Pedido vai para o balcão (loja.py): o cliente recebe um código para retirar
    async function checkoutCart() {
      if (!cart.length) { showToast('Adicione itens antes de solicitar.'); return; }
      const itens = cart.map(i => ({ id: i.id, qtd: i.qty }));
      let pedido = null;
      try {
        const r = await fetch(`${FLEXMED_API_BASE}/pedidos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itens, sessao_id: window.FlexSessao ? FlexSessao.id : null }),
        });
        if (r.ok) pedido = await r.json();
      } catch (_) { /* backend fora: o balcão atende pelo nome dos produtos */ }
      rastrear("finalizou", "pedido no balcão", {
        itens: cart.reduce((n, i) => n + i.qty, 0),
        produtos: cart.map(i => i.name).slice(0, 20),
        pedido: pedido ? pedido.codigo : null,
      });
      cart = [];
      renderCart();
      closeOv('o-cart');
      if (pedido) mostrarCodigoPedido(pedido);
      else showToast('Pedido enviado ao balcão! Um farmacêutico irá atendê-lo.');
    }

    function mostrarCodigoPedido(pedido) {
      const fundo = document.createElement("div");
      fundo.className = "pedido-ok";
      fundo.innerHTML = `
        <div class="pedido-ok-card">
          <div class="pedido-ok-ico">${icon("check")}</div>
          <div class="pedido-ok-tit">${e(L("Pedido enviado ao balcão!", "Order sent to the counter!", "¡Pedido enviado al mostrador!"))}</div>
          <div class="pedido-ok-sub">${e(L("Retire no balcão com o código", "Pick it up at the counter with code", "Retíralo en el mostrador con el código"))}</div>
          <div class="pedido-ok-cod">${e(pedido.codigo)}</div>
          ${pedido.total ? `<div class="pedido-ok-sub">${e(L("Total estimado", "Estimated total", "Total estimado"))}: <b>${e(fmtBRL(pedido.total))}</b></div>` : ""}
          ${pedido.itens_em_falta ? `<div class="pedido-ok-aviso">${e(L("Algum item pode estar em falta; o farmacêutico confirma com você.", "Some items may be out of stock; the pharmacist will confirm.", "Algún artículo puede faltar; el farmacéutico lo confirma."))}</div>` : ""}
          <button type="button" class="pedido-ok-btn">${e(L("Entendi", "Got it", "Entendido"))}</button>
        </div>`;
      const fechar = () => fundo.remove();
      fundo.querySelector(".pedido-ok-btn").addEventListener("click", fechar);
      document.getElementById("totem").appendChild(fundo);
      setTimeout(fechar, 20000);
    }

    function boot() {
      // Check if admin panel synced new products
      const syncedProds = sessionStorage.getItem('flexmed_products_sync');
      if (syncedProds) {
        try {
          const admProds = JSON.parse(syncedProds);
          if (Array.isArray(admProds) && admProds.length) {
            // Merge admin products (keep local i18n data, update stock/price/rx/local)
            admProds.forEach(ap => {
              const local = produtos.find(p => p.id === ap.id);
              if (local) {
                local.estoque = ap.stock ?? local.estoque;
                local.preco = ap.price ?? local.preco;
                local.receita = ap.rx ?? local.receita;
                local.local = ap.local ?? local.local;
                if (ap.imgUrl) local.imgUrl = ap.imgUrl;
                if (ap.imgIndex != null) local.imgIndex = ap.imgIndex;
              }
            });
          }
        } catch(e) { /* ignore */ }
      }
      renderCategories();
      renderProducts();
      renderNav();
      renderMetrics();
      renderStars();
      renderBanners();
      restartBannerAuto();
      apiOfertasDaCasa(3).then(ofertas => { bannerOfertas = ofertas; renderBanners(); }).catch(() => {});
      applyWhiteLabelUI();
      applyText();
      updateClock();
      refreshChatbotTexts();
      closeChatbot();
      initCategoryDrag();

      document.querySelectorAll(".lng").forEach(btn => {
        btn.classList.remove("on");
        if (btn.textContent.toLowerCase() === currentLang) btn.classList.add("on");
      });

      // sem tela de abertura: o totem já começa pronto (o assistente abre só quando tocado)

      setInterval(updateClock, 1000);

      setInterval(() => {
        if (Math.random() > 0.72) {
          metrics.views += 1;
          renderMetrics();
        }
      }, 9000);

      setInterval(() => {
        const t = getText();
        const messages = [
          config.assistantMessage,
          t.chatbotPrompt,
          t.chatbotStockHint,
          t.libras
        ];
        addChatMessage("bot", messages[Math.floor(Math.random() * messages.length)], false);
      }, 22000);
    }

    // ─── WHITE LABEL SYNC: listen for changes saved by the admin panel ─────────
    // When admin saves brand/colors in another tab, totem updates instantly.
    window.addEventListener('storage', function(e) {
      if (e.key !== 'flexmed_whitelabel_config') return;
      try {
        const newConfig = e.newValue ? JSON.parse(e.newValue) : null;
        if (newConfig) {
          const prevLang = config.lang || currentLang;
          config = sanitizeConfig({ ...newConfig, lang: prevLang });
          applyWhiteLabelUI();
          applyText();
          showToast('✅ Aparência atualizada pelo painel admin.');
        } else {
          config = { ...DEFAULT_CONFIG, lang: currentLang };
          applyWhiteLabelUI();
          applyText();
          showToast('Aparência redefinida para o padrão.');
        }
      } catch(err) { /* ignore */ }
    });

    boot();