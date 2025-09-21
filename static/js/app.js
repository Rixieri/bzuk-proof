// Configurações da Blockchain
const CONFIG = {
    RPC_URL: "https://polygon-rpc.com",
    TOKEN_ADDRESS: "0x0Eb8ef4D2843170D23aA029AB62DaB24d1194FeB",
    USDT_ADDRESS: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
    SAFE_ADDRESS: "0x5a8217Fea97407091F21339ca84e83e35c10E599",
    RESERVE_ADDRESSES: [
        "0x2468dFf6150F657e2BA4CB2B8312fC35F3D1641A"
    ]
};

// URL do arquivo TXT no GitHub (substitua com sua URL real)
const GITHUB_STATS_URL = "https://raw.githubusercontent.com/Rixieri/bzuk-proof/refs/heads/main/static/stats.txt";

// ABI mínima para ERC20
const ERC20_ABI = [
    {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [{ "name": "", "type": "uint8" }],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{ "name": "", "type": "uint256" }],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [{ "name": "owner", "type": "address" }],
        "name": "balanceOf",
        "outputs": [{ "name": "", "type": "uint256" }],
        "type": "function"
    }
];

// Conexão con Web3
let web3;
try {
    web3 = new Web3(new Web3.providers.HttpProvider(CONFIG.RPC_URL));
} catch (error) {
    console.error('Erro ao conectar com a blockchain:', error);
}

// Contratos
const tokenContract = web3 ? new web3.eth.Contract(ERC20_ABI, CONFIG.TOKEN_ADDRESS) : null;
const usdtContract = web3 ? new web3.eth.Contract(ERC20_ABI, CONFIG.USDT_ADDRESS) : null;

// Função para formatar números
function formatNumber(num, decimals = 2) {
    return Number(num).toLocaleString('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// ---------- HELPERS ----------

// Faz uma chamada segura ao contrato (retorna string ou null). Tenta 'retries' vezes.
async function safeCall(contract, method, args = [], retries = 1) {
    if (!contract || !contract.methods || !contract.methods[method]) {
        console.warn(`safeCall: método inválido ${method}`);
        return null;
    }
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await contract.methods[method](...args).call();
        } catch (err) {
            console.warn(`safeCall: erro ${method} attempt ${attempt + 1}/${retries + 1}`, err);
            if (attempt < retries) await new Promise(r => setTimeout(r, 300));
        }
    }
    return null;
}

// Converte um bigint raw (string/BigInt) em string decimal humana com 'displayDecimals' frações (trim trailing zeros)
function bigIntToDecimalString(raw, decimals, displayDecimals = 6) {
    const s = (typeof raw === 'bigint') ? raw.toString() : (raw || '0').toString();
    if (decimals === 0) return s;
    const neg = s.startsWith('-');
    const abs = neg ? s.slice(1) : s;
    // garante comprimento mínimo
    const padded = abs.padStart(decimals + 1, '0');
    const intPart = padded.slice(0, padded.length - decimals);
    let fracPart = padded.slice(-decimals).slice(0, displayDecimals);
    // remove zeros à direita
    fracPart = fracPart.replace(/0+$/, '');
    const out = fracPart ? `${intPart}.${fracPart}` : intPart;
    return neg ? '-' + out : out;
}

// Converte um BigInt 'scaled' (valor * 10^precision) em string decimal (precision casas)
function scaledBigIntToString(nBigInt, precision) {
    const s = nBigInt.toString();
    if (precision === 0) return s;
    const neg = s.startsWith('-');
    const abs = neg ? s.slice(1) : s;
    if (abs.length <= precision) {
        const zeros = '0'.repeat(precision - abs.length + 1);
        return (neg ? '-' : '') + '0.' + zeros + abs;
    } else {
        const intPart = abs.slice(0, abs.length - precision);
        let frac = abs.slice(abs.length - precision);
        // trim trailing zeros
        frac = frac.replace(/0+$/, '');
        return (neg ? '-' : '') + intPart + (frac ? '.' + frac : '');
    }
}

// ---------- FETCH MELHORADO ----------
async function fetchBlockchainData() {
    if (!web3 || !tokenContract || !usdtContract) {
        console.error('Web3 ou contratos não estão prontos');
        showPlaceholderData();
        return;
    }

    try {
        // buscar decimals e totalSupply em paralelo
        const [tokenDecimalsRaw, usdtDecimalsRaw, totalSupplyRaw] = await Promise.all([
            safeCall(tokenContract, 'decimals', [], 1),
            safeCall(usdtContract, 'decimals', [], 1),
            safeCall(tokenContract, 'totalSupply', [], 1)
        ]);

        const tokenDecimals = Number.isFinite(parseInt(tokenDecimalsRaw, 10)) ? parseInt(tokenDecimalsRaw, 10) : 18;
        const usdtDecimals = Number.isFinite(parseInt(usdtDecimalsRaw, 10)) ? parseInt(usdtDecimalsRaw, 10) : 6;

        // buscar saldos das reservas (paralelo)
        const reservePromises = CONFIG.RESERVE_ADDRESSES.map(addr => safeCall(tokenContract, 'balanceOf', [addr], 1));
        const reserveRawArray = await Promise.all(reservePromises);

        // buscar saldo USDT da safe
        const usdtBalanceRaw = await safeCall(usdtContract, 'balanceOf', [CONFIG.SAFE_ADDRESS], 1);

        // normaliza strings -> BigInt (usa '0' se null)
        const totalSupplyBN = BigInt((totalSupplyRaw || '0').toString());
        let totalReserveBN = 0n;
        for (const r of reserveRawArray) {
            totalReserveBN += BigInt((r || '0').toString());
        }
        const circulatingBN = totalSupplyBN > totalReserveBN ? (totalSupplyBN - totalReserveBN) : 0n;

        // se circulating zero, não dá para calcular preço (evita divisão por zero)
        if (circulatingBN === 0n) {
            console.warn('Circulating supply = 0 -> usando placeholder');
            showPlaceholderData();
            return;
        }

        // cálculo do preço usando BigInt:
        // tokenPrice = (usdtBalance / 10^usdtDecimals) / (circulating / 10^tokenDecimals)
        // => tokenPrice = (usdtBalance * 10^tokenDecimals) / (circulating * 10^usdtDecimals)
        // para preservar precisão, escalamos por "pricePrecision"
        const pricePrecision = 9; // casas internas de precisão (ajuste se quiser mais)
        const scale = 10n ** BigInt(pricePrecision);

        const usdtBN = BigInt((usdtBalanceRaw || '0').toString());
        const numerator = usdtBN * (10n ** BigInt(tokenDecimals)) * scale;
        const denominator = circulatingBN * (10n ** BigInt(usdtDecimals));

        const priceScaled = denominator === 0n ? 0n : (numerator / denominator); // inteiro = price * 10^pricePrecision
        const tokenPriceStr = scaledBigIntToString(priceScaled, pricePrecision); // string "123.456..."
        const tokenPriceNumber = parseFloat(tokenPriceStr);

        if (!isFinite(tokenPriceNumber) || tokenPriceNumber <= 0) {
            console.warn('Preço inválido calculado -> usando placeholder');
            showPlaceholderData();
            return;
        }

        // preparar valores legíveis para UI
        const circulatingStr = bigIntToDecimalString(circulatingBN, tokenDecimals, 0); // exibe sem casas
        const totalSupplyStr = bigIntToDecimalString(totalSupplyBN, tokenDecimals, 0);
        const reserveStr = bigIntToDecimalString(totalReserveBN, tokenDecimals, 0);
        const usdtBalanceStr = bigIntToDecimalString(usdtBN, usdtDecimals, 2);

        // atualizar UI (passa valores numéricos para formatNumber quando apropriado)
        updateUI({
            tokenPrice: tokenPriceNumber,
            circulatingSupply: Number(circulatingStr.replace(/\D/g,'')) || parseFloat(circulatingStr),
            totalSupply: Number(totalSupplyStr.replace(/\D/g,'')) || parseFloat(totalSupplyStr),
            reserveBalance: Number(reserveStr.replace(/\D/g,'')) || parseFloat(reserveStr),
            usdtBalance: parseFloat(usdtBalanceStr)
        });

    } catch (error) {
        console.error('Erro geral ao buscar dados da blockchain:', error);
        showPlaceholderData();
    }
}


// Atualizar a interface com os dados
function updateUI(data) {
    document.getElementById('tokenPriceMobile').textContent = `$${formatNumber(data.tokenPrice, 3)}`;
    document.getElementById('tokenPrice').textContent = `BZUK: $${formatNumber(data.tokenPrice, 3)}`;
    document.getElementById('currentPrice').textContent = `$${formatNumber(data.tokenPrice, 3)}`;
    document.getElementById('circulatingSupply').textContent = formatNumber(data.circulatingSupply, 0);
    document.getElementById('totalSupply').textContent = formatNumber(data.totalSupply, 0);
    document.getElementById('reserveSupply').textContent = formatNumber(data.reserveBalance, 0);
    document.getElementById('usdtBalance').textContent = formatNumber(data.usdtBalance, 2);

    // Atualizar variável global para a calculadora
    window.tokenValue = data.tokenPrice;
}

// Mostrar dados placeholder em caso de erro
function showPlaceholderData() {
    document.getElementById('tokenPrice').textContent = 'BZUK: $1.00';
    document.getElementById('currentPrice').textContent = '$1.00';
    document.getElementById('circulatingSupply').textContent = '400,000';
    document.getElementById('totalSupply').textContent = '1,000,000';
    document.getElementById('reserveSupply').textContent = '600,000';
    document.getElementById('usdtBalance').textContent = '400,000';

    window.tokenValue = 1.0;
}

// Função da calculadora
function calcularValor() {
    if (!window.tokenValue) {
        document.getElementById("resultado").innerText = "Dados não carregados";
        return;
    }

    const qtd = parseFloat(document.getElementById("tokenAmount").value);
    if (isNaN(qtd) || qtd <= 0) {
        document.getElementById("resultado").innerText = "Insira uma quantidade válida";
        return;
    }

    const valor = qtd * window.tokenValue
    document.getElementById("resultado").innerText = `${formatNumber(valor)} USDT`;
}

// Configuração do seletor de idioma
function setupLanguageSelector() {
    const languageOptions = document.querySelectorAll('.language-option');

    languageOptions.forEach(option => {
        option.addEventListener('click', function () {
            const selectedLang = this.getAttribute('data-lang');

            // Atualizar a interface visual
            languageOptions.forEach(opt => opt.classList.remove('active'));
            this.classList.add('active');

            // Aqui você pode implementar a lógica para mudar o idioma
            changeLanguage(selectedLang);
        });
    });
}

// Função para mudar o idioma (exemplo básico)
function changeLanguage(lang) {
    // Esta é uma implementação básica. Em um cenário real, você teria
    // um sistema mais complexo com arquivos de tradução ou API

    console.log(`Idioma alterado para: ${lang}`);

    // Aqui você implementaria a lógica para trocar todo o texto do site
    // Por enquanto, apenas mostra um alerta
    // alert(`Idioma alterado para ${lang === 'pt' ? 'Português' : 'Inglês'}`);

    // Em uma implementação real, você:
    // 1. Carregaria um arquivo JSON com as traduções
    // 2. Percorreria todos os elementos de texto substituindo pelos equivalentes
    // 3. Atualizaria o atributo lang do html
    document.documentElement.lang = lang;
}

// Função para carregar dados das estatísticas do GitHub
async function loadStatsFromGitHub() {
    try {
        // Buscar o arquivo TXT do GitHub
        const response = await fetch(GITHUB_STATS_URL);

        if (!response.ok) {
            throw new Error(`Erro HTTP: ${response.status}`);
        }

        const textData = await response.text();

        // Processar o conteúdo do arquivo TXT
        const statsData = parseStatsText(textData);

        // Atualizar a interface com os dados
        updateStatsUI(statsData);

    } catch (error) {
        console.error('Erro ao carregar dados do GitHub:', error);

        // Em caso de erro, mostrar valores padrão
        showDefaultStats();
    }
}

// Função para processar o texto do arquivo TXT
function parseStatsText(text) {
    const lines = text.split('\n');
    const stats = {};

    lines.forEach(line => {
        // Ignorar linhas vazias ou comentários (que começam com #)
        if (line.trim() === '' || line.trim().startsWith('#')) {
            return;
        }

        // Dividir a linha em chave e valor
        const separatorIndex = line.indexOf(':');
        if (separatorIndex !== -1) {
            const key = line.substring(0, separatorIndex).trim();
            const value = line.substring(separatorIndex + 1).trim();
            stats[key] = value;
        }
    });

    return stats;
}

// Atualizar a interface com os dados das estatísticas
function updateStatsUI(statsData) {
    // Atualizar cada campo se existir nos dados
    if (statsData['ultimo_mes']) {
        document.getElementById('lastMonth').textContent = statsData['ultimo_mes'];
    }

    if (statsData['lucro_pago']) {
        document.getElementById('profitPaid').textContent = statsData['lucro_pago'];
    }

    if (statsData['maxima_token']) {
        document.getElementById('maxToken').textContent = statsData['maxima_token'];
    }

    if (statsData['roi']) {
        document.getElementById('roi').textContent = statsData['roi'];
    }
}

// Mostrar valores padrão em caso de erro
function showDefaultStats() {
    document.getElementById('lastMonth').textContent = "3.85%";
    document.getElementById('profitPaid').textContent = "$38,250";
    document.getElementById('maxToken').textContent = "$1.42";
    document.getElementById('roi').textContent = "42.0%";
}

// Manipular envio do formulário
document.getElementById('contactForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const messageDiv = document.getElementById('formMessage');

    // Mostrar loading
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Enviando...';
    messageDiv.style.display = 'none';

    try {
        const formData = new FormData(form);

        const response = await fetch('/enviar_contato', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            messageDiv.className = 'mt-3 alert alert-success';
            messageDiv.textContent = result.message;
            form.reset();
        } else {
            messageDiv.className = 'mt-3 alert alert-danger';
            messageDiv.textContent = result.message;
        }

    } catch (error) {
        messageDiv.className = 'mt-3 alert alert-danger';
        messageDiv.textContent = 'Erro ao enviar mensagem. Tente novamente.';
    } finally {
        messageDiv.style.display = 'block';
        submitButton.disabled = false;
        submitButton.innerHTML = 'Solicitar Informações';

        // Rolagem suave para a mensagem
        messageDiv.scrollIntoView({ behavior: 'smooth' });
    }
});

// Inicializar quando a página carregar
document.addEventListener('DOMContentLoaded', function () {
    // Buscar dados da blockchain
    fetchBlockchainData();

    // Configurar o seletor de idioma
    setupLanguageSelector();

    // Carregar dados das estatísticas do GitHub
    loadStatsFromGitHub();

    // Atualizar a cada 30 segundos
    // setInterval(fetchBlockchainData, 30000);

    // Configurar evento para a calculadora
    document.getElementById('tokenAmount').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            calcularValor();
        }
    });
});


// Dicionário de traduções
const translations = {
    'pt': {
        // Menu
        'menu_about': 'Sobre',
        'menu_strategy': 'Estratégia',
        'menu_token': 'Token',
        'menu_invest': 'Investir',

        // Hero Section
        'hero_title': 'Inteligência Artificial aplicada a investimentos',
        'hero_subtitle': 'Robôs de trading automatizados que geram lucros consistentes no mercado DeFi',
        'hero_cta1': 'Quero Investir',
        'hero_cta2': 'Como Funciona',

        // About Section
        'about_title': 'O Grupo BZUK',
        'about_subtitle': 'Um grupo seleto de investidores que une expertise tradicional com tecnologia de ponta em trading algorítmico',
        'about_card1_title': 'Filosofia Colaborativa',
        'about_card1_text': 'Começamos como um pequeno grupo de amigos investidores, compartilhando estratégias e insights. Nossa estrutura permite decisões ágeis e foco em resultados.',
        'about_card2_title': 'Tecnologia de Ponta',
        'about_card2_text': 'Desenvolvemos sistemas de IA especializados em identificar oportunidades no mercado DeFi, executando trades com precisão e velocidade impossíveis para humanos.',

        // Strategy Section
        'strategy_title': 'Estratégia de Investimento',
        'strategy_subtitle': 'Como transformamos tecnologia em retornos consistentes',
        'strategy_card1_title': 'Algoritmos de Trading',
        'strategy_card1_text': 'Nossos robôs operam 24/7 analisando milhões de dados de mercado para identificar padrões e oportunidades de arbitragem, yield farming e trading momentum.',
        'strategy_card1_item1': 'Análise de sentimentos em redes sociais',
        'strategy_card1_item2': 'Reconhecimento de padrões gráficos',
        'strategy_card1_item3': 'Execução em múltiplas exchanges simultaneamente',
        'strategy_card1_item4': 'Gestão automática de riscos',
        'strategy_card2_title': 'Modelo Tokenizado',
        'strategy_card2_text': 'Criamos o token BZUK como representação digital das ações do grupo. Todo lucro gerado pelos robôs é convertido para USDT e adicionado ao fundo Safe.',
        'strategy_card2_item1': 'Token lastreado 1:1 com USDT no lançamento',
        'strategy_card2_item2': 'Valorização constante através dos lucros operacionais',
        'strategy_card2_item3': 'Distribuição proporcional aos detentores de tokens',
        'strategy_card2_item4': 'Transparência total com proof-of-reserves',

        // Value Proposition
        'value_title': 'Por que investir no BZUK?',
        'value_subtitle': 'Enquanto criptomoedas tradicionais estão sujeitas à volatilidade do mercado, o token BZUK oferece um modelo inovador:',
        'value_card1_title': 'Valorização Constante',
        'value_card1_text': 'Os lucros gerados pelos robôs são adicionados ao fundo, aumentando continuamente o valor lastreado de cada token.',
        'value_card2_title': 'Proteção contra volatilidade',
        'value_card2_text': 'O lastro em USDT protege contra quedas bruscas do mercado cripto, enquanto participa dos ganhos operacionais.',
        'value_card3_title': 'Transparência Total',
        'value_card3_text': 'Todos os trades e movimentações são auditáveis na blockchain, com relatórios regulares de performance.',

        // Token Section
        'token_title': 'Token BZUK',
        'token_subtitle': 'Ações digitais com lastro real e valorização programada',
        'token_total': 'Total Supply',
        'token_total_desc': 'Tokens emitidos',
        'token_reserved': 'Reservado',
        'token_reserved_desc': 'Não circulando',
        'token_circulating': 'Circulating',
        'token_circulating_desc': 'Em circulação',
        'token_balance': 'Saldo USDT',
        'token_balance_desc': 'Na Safe - TVL',
        'token_value': 'Valor por Token',
        'token_value_desc': 'BZUK/USDT',

        // Statistics
        'stats_lastmonth': 'Último Mês',
        'stats_profit': 'Lucro Pago',
        'stats_profit_desc': 'Total distribuído',
        'stats_maxtoken': 'Máxima Token',
        'stats_maxtoken_desc': 'Valor histórico',
        'stats_roi': 'ROI',
        'stats_roi_desc': 'Retorno sobre investimento',

        // Calculator
        'calculator_title': '💰 Calculadora do Investidor',
        'calculator_placeholder': 'Quantidade de BZUK',
        'calculator_button': 'Calcular Valor',
        'calculator_result_label': 'Valor estimado em USDT:',

        // Contracts
        'contracts_title': '🔗 Contratos na Blockchain',
        'contract_token': 'Contrato do Token BZUK',
        'contracts_note': 'Todos os contratos são verificados e auditáveis na Polygon blockchain',

        // CTA Section
        'cta_title': 'Junte-se ao Grupo BZUK',
        'cta_subtitle': 'Invista em tokens lastreados com valorização baseada em performance real de algoritmos de IA',
        'form_title': 'Entre em Contato',
        'form_name': 'Seu Nome',
        'form_email': 'Seu Email',
        'form_amount': 'Valor de Interesse (USDT)',
        'form_button': 'Solicitar Informações',
        'cta_contact': 'Ou entre em contato diretamente:',

        // Footer
        'footer_description': 'Investimentos inteligentes com inteligência artificial no mercado DeFi.',
        'footer_links': 'Links',
        'footer_connect': 'Conecte-se',
        'footer_rights': 'Todos os direitos reservados.'
    },
    'en': {
        // Menu
        'menu_about': 'About',
        'menu_strategy': 'Strategy',
        'menu_token': 'Token',
        'menu_invest': 'Invest',

        // Hero Section
        'hero_title': 'Artificial Intelligence applied to investments',
        'hero_subtitle': 'Automated trading robots that generate consistent profits in the DeFi market',
        'hero_cta1': 'I Want to Invest',
        'hero_cta2': 'How It Works',

        // About Section
        'about_title': 'The BZUK Group',
        'about_subtitle': 'A select group of investors combining traditional expertise with cutting-edge algorithmic trading technology',
        'about_card1_title': 'Collaborative Philosophy',
        'about_card1_text': 'We started as a small group of investor friends, sharing strategies and insights. Our structure allows for agile decisions and focus on results.',
        'about_card2_title': 'Cutting-Edge Technology',
        'about_card2_text': 'We develop AI systems specialized in identifying opportunities in the DeFi market, executing trades with precision and speed impossible for humans.',

        // Strategy Section
        'strategy_title': 'Investment Strategy',
        'strategy_subtitle': 'How we transform technology into consistent returns',
        'strategy_card1_title': 'Trading Algorithms',
        'strategy_card1_text': 'Our robots operate 24/7 analyzing millions of market data points to identify patterns and opportunities for arbitrage, yield farming, and momentum trading.',
        'strategy_card1_item1': 'Social media sentiment analysis',
        'strategy_card1_item2': 'Pattern recognition',
        'strategy_card1_item3': 'Simultaneous execution on multiple exchanges',
        'strategy_card1_item4': 'Automatic risk management',
        'strategy_card2_title': 'Tokenized Model',
        'strategy_card2_text': 'We created the BZUK token as a digital representation of the group shares. All profits generated by the robots are converted to USDT and added to the Safe fund.',
        'strategy_card2_item1': 'Token backed 1:1 with USDT at launch',
        'strategy_card2_item2': 'Constant appreciation through operational profits',
        'strategy_card2_item3': 'Proportional distribution to token holders',
        'strategy_card2_item4': 'Full transparency with proof-of-reserves',

        // Value Proposition
        'value_title': 'Why invest in BZUK?',
        'value_subtitle': 'While traditional cryptocurrencies are subject to market volatility, the BZUK token offers an innovative model:',
        'value_card1_title': 'Constant Appreciation',
        'value_card1_text': 'Profits generated by the robots are added to the fund, continuously increasing the backed value of each token.',
        'value_card2_title': 'Protection against volatility',
        'value_card2_text': 'The USDT backing protects against sharp crypto market declines, while participating in operational gains.',
        'value_card3_title': 'Full Transparency',
        'value_card3_text': 'All trades and movements are auditable on the blockchain, with regular performance reports.',

        // Token Section
        'token_title': 'BZUK Token',
        'token_subtitle': 'Digital shares with real backing and programmed appreciation',
        'token_total': 'Total Supply',
        'token_total_desc': 'Tokens issued',
        'token_reserved': 'Reserved',
        'token_reserved_desc': 'Not circulating',
        'token_circulating': 'Circulating',
        'token_circulating_desc': 'In circulation',
        'token_balance': 'USDT Balance',
        'token_balance_desc': 'In Safe - TVL',
        'token_value': 'Value per Token',
        'token_value_desc': 'BZUK/USDT',

        // Statistics
        'stats_lastmonth': 'Last Month',
        'stats_profit': 'Profit Paid',
        'stats_profit_desc': 'Total distributed',
        'stats_maxtoken': 'All-Time High',
        'stats_maxtoken_desc': 'Historical value',
        'stats_roi': 'ROI',
        'stats_roi_desc': 'Return on investment',

        // Calculator
        'calculator_title': '💰 Investor Calculator',
        'calculator_placeholder': 'Amount of BZUK',
        'calculator_button': 'Calculate Value',
        'calculator_result_label': 'Estimated value in USDT:',

        // Contracts
        'contracts_title': '🔗 Blockchain Contracts',
        'contract_token': 'BZUK Token Contract',
        'contracts_note': 'All contracts are verified and auditable on Polygon blockchain',

        // CTA Section
        'cta_title': 'Join the BZUK Group',
        'cta_subtitle': 'Invest in backed tokens with appreciation based on real AI algorithm performance',
        'form_title': 'Contact Us',
        'form_name': 'Your Name',
        'form_email': 'Your Email',
        'form_amount': 'Amount of Interest (USDT)',
        'form_button': 'Request Information',
        'cta_contact': 'Or contact us directly:',

        // Footer
        'footer_description': 'Smart investments with artificial intelligence in the DeFi market.',
        'footer_links': 'Links',
        'footer_connect': 'Connect',
        'footer_rights': 'All rights reserved.'
    }
};

// Função para aplicar traduções
function applyTranslation(lang) {
    // Atualizar todos os elementos com atributo data-translate
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        if (translations[lang][key]) {
            element.textContent = translations[lang][key];
        }
    });

    // Atualizar placeholders
    document.querySelectorAll('[data-translate-placeholder]').forEach(element => {
        const key = element.getAttribute('data-translate-placeholder');
        if (translations[lang][key]) {
            element.placeholder = translations[lang][key];
        }
    });

    // Atualizar o atributo lang do html
    document.documentElement.lang = lang;

    // Atualizar o seletor de idioma ativo
    document.querySelectorAll('.language-option').forEach(option => {
        if (option.getAttribute('data-lang') === lang) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });

    // Salvar preferência de idioma
    localStorage.setItem('preferredLanguage', lang);
}

// Inicializar o sistema de tradução
document.addEventListener('DOMContentLoaded', function () {
    // Verificar se há um idioma salvo ou usar o padrão (pt)
    const savedLanguage = localStorage.getItem('preferredLanguage') || 'pt';
    applyTranslation(savedLanguage);

    // Adicionar event listeners aos botões de idioma
    document.querySelectorAll('.language-option').forEach(option => {
        option.addEventListener('click', function () {
            const lang = this.getAttribute('data-lang');
            applyTranslation(lang);
        });
    });
});

// Função da calculadora (mantida do código original)
function calcularValor() {
    const tokenAmount = document.getElementById('tokenAmount').value;
    const currentPrice = window.tokenValue; // Este valor poderia vir de uma API
    const resultado = tokenAmount * currentPrice;
    document.getElementById('resultado').textContent = '$' + resultado.toFixed(2);
}

// Inicializar o formulário de contato
document.getElementById('contactForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const formMessage = document.getElementById('formMessage');
    formMessage.textContent = 'Mensagem enviada com sucesso! Em breve entraremos em contato.';
    formMessage.classList.add('alert-success');
    formMessage.style.display = 'block';
    this.reset();
});