// Configurações da Blockchain
const CONFIG = {
    RPC_URL: "https://polygon-rpc.com",
    TOKEN_ADDRESS: "0x0Eb8ef4D2843170D23aA029AB62DaB24d1194FeB",
    USDT_ADDRESS: "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
    SAFE_ADDRESS: "0x5a8217Fea97407091F21339ca84e83e35c10E599",
    RESERVE_ADDRESSES: [
        "0x25dADC09e2F80378bd427a8F1adaC3Afad4a6eA3"
    ]
};

// URL do arquivo TXT no GitHub (substitua com sua URL real)
const GITHUB_STATS_URL = "https://raw.githubusercontent.com/Rixieri/bzuk-proof/refs/heads/main/stats.txt";

// ABI mínima para ERC20
const ERC20_ABI = [
    {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [{"name": "owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
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

// Função para buscar dados da blockchain
async function fetchBlockchainData() {
    if (!web3) {
        console.error('Web3 não está disponível');
        showPlaceholderData();
        return;
    }

    try {
        // Buscar decimals do token
        const tokenDecimals = await tokenContract.methods.decimals().call();
        const tokenDecimalFactor = 10 ** tokenDecimals;

        // Buscar total supply
        const totalSupply = await tokenContract.methods.totalSupply().call();
        const totalSupplyFormatted = totalSupply / tokenDecimalFactor;

        // Buscar saldos das reservas
        let totalReserveBalance = 0;
        for (const address of CONFIG.RESERVE_ADDRESSES) {
            const balance = await tokenContract.methods.balanceOf(address).call();
            totalReserveBalance += Number(balance);
        }
        const reserveBalanceFormatted = totalReserveBalance / tokenDecimalFactor;

        // Calcular circulating supply
        const circulatingSupply = totalSupplyFormatted - reserveBalanceFormatted;

        // Buscar saldo USDT da Safe
        const usdtDecimals = await usdtContract.methods.decimals().call();
        const usdtDecimalFactor = 10 ** usdtDecimals;
        const usdtBalance = await usdtContract.methods.balanceOf(CONFIG.SAFE_ADDRESS).call();
        const usdtBalanceFormatted = usdtBalance / usdtDecimalFactor;

        // Calcular preço do token
        const tokenPrice = circulatingSupply > 0 ? usdtBalanceFormatted / circulatingSupply : 1;

        // Atualizar a interface
        updateUI({
            tokenPrice,
            circulatingSupply,
            totalSupply: totalSupplyFormatted,
            reserveBalance: reserveBalanceFormatted,
            usdtBalance: usdtBalanceFormatted
        });

    } catch (error) {
        console.error('Erro ao buscar dados da blockchain:', error);
        showPlaceholderData();
    }
}

// Atualizar a interface com os dados
function updateUI(data) {
    document.getElementById('tokenPrice').textContent = `BZUK: $${formatNumber(data.tokenPrice, 2)}`;
    document.getElementById('currentPrice').textContent = `$${formatNumber(data.tokenPrice, 2)}`;
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
    
    const valor = qtd * window.tokenValue;
    document.getElementById("resultado").innerText = `${formatNumber(valor)} USDT`;
}

// Configuração do seletor de idioma
function setupLanguageSelector() {
    const languageOptions = document.querySelectorAll('.language-option');
    
    languageOptions.forEach(option => {
        option.addEventListener('click', function() {
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
    alert(`Idioma alterado para ${lang === 'pt' ? 'Português' : 'Inglês'}`);
    
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
document.getElementById('contactForm').addEventListener('submit', async function(e) {
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
document.addEventListener('DOMContentLoaded', function() {
    // Buscar dados da blockchain
    fetchBlockchainData();
    
    // Configurar o seletor de idioma
    setupLanguageSelector();
    
    // Carregar dados das estatísticas do GitHub
    loadStatsFromGitHub();
    
    // Atualizar a cada 30 segundos
    setInterval(fetchBlockchainData, 30000);
    
    // Configurar evento para a calculadora
    document.getElementById('tokenAmount').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            calcularValor();
        }
    });
});