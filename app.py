from flask import Flask, render_template, request, jsonify
from web3 import Web3
import requests
import os
from dotenv import load_dotenv
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

# Configurações do Telegram
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID')

# Resto do código permanece igual...

def enviar_telegram(mensagem):
    # Verificar se as variáveis de ambiente estão configuradas
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        error_msg = "Variáveis de ambiente do Telegram não configuradas"
        logger.error(error_msg)
        print(f"TELEGRAM_BOT_TOKEN: {TELEGRAM_BOT_TOKEN}")
        print(f"TELEGRAM_CHAT_ID: {TELEGRAM_CHAT_ID}")
        return False
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': TELEGRAM_CHAT_ID, 
        'text': mensagem, 
        'parse_mode': 'HTML'
    }
    
    try:
        # Adicionar timeout e verificação mais robusta
        response = requests.post(url, json=payload, timeout=10)
        
        # Log para debugging
        logger.info(f"Status Code: {response.status_code}")
        logger.info(f"Response Text: {response.text}")
        
        if response.status_code == 200:
            return True
        else:
            logger.error(f"Erro do Telegram API: {response.status_code} - {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        logger.error("Timeout ao conectar com o Telegram")
        return False
    except requests.exceptions.ConnectionError:
        logger.error("Erro de conexão com o Telegram")
        return False
    except Exception as e:
        logger.error(f"Erro inesperado ao enviar para Telegram: {e}")
        return False

# Rota de health check para testar o Telegram
@app.route('/health')
def health_check():
    telegram_status = "Funcionando" if enviar_telegram("Teste de saúde do bot") else "Falhou"
    return jsonify({
        "status": "online",
        "telegram": telegram_status,
        "token_configurado": bool(TELEGRAM_BOT_TOKEN),
        "chat_id_configurado": bool(TELEGRAM_CHAT_ID)
    })



# Configurações Blockchain
RPC_URL = "https://polygon-rpc.com"
TOKEN_ADDRESS = "0x0Eb8ef4D2843170D23aA029AB62DaB24d1194FeB"
USDT_ADDRESS = "0x6ab707Aca953eDAeFBc4fD23bA73294241490620"
SAFE_ADDRESS = "0x5a8217Fea97407091F21339ca84e83e35c10E599"
RESERVE_ADDRESSES = ["0x25dADC09e2F80378bd427a8F1adaC3Afad4a6eA3"]

# ABI mínima ERC20
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [],
        "name": "totalSupply",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [{"name": "owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function"
    }
]

# Conexão Web3
try:
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    token_contract = w3.eth.contract(address=TOKEN_ADDRESS, abi=ERC20_ABI)
    usdt_contract = w3.eth.contract(address=USDT_ADDRESS, abi=ERC20_ABI)
except Exception as e:
    print(f"Erro na conexão Web3: {e}")
    w3 = None
    token_contract = None
    usdt_contract = None

def formatar_quatro_decimais(valor):
    return round(float(valor), 2) if valor else 0.00

def enviar_telegram(mensagem):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Token ou Chat ID do Telegram não configurado")
        return False
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {'chat_id': TELEGRAM_CHAT_ID, 'text': mensagem, 'parse_mode': 'HTML'}
    
    try:
        response = requests.post(url, json=payload)
        return response.status_code == 200
    except Exception as e:
        print(f"Erro ao enviar para Telegram: {e}")
        return False

@app.route('/')
def index():
    # Valores padrão para caso de erro
    default_values = {
        'total_supply': 1000000.0000,
        'reserve_supply': 600000.0000,
        'circulating_supply': 400000.0000,
        'usdt_balance': 400000.0000,
        'value_per_token': 1.0000
    }
    
    if not w3 or not token_contract or not usdt_contract:
        return render_template('index.html', **default_values)
    
    try:
        # Buscar dados da blockchain
        token_decimals = token_contract.functions.decimals().call()
        token_decimal_factor = 10 ** token_decimals
        
        total_supply = token_contract.functions.totalSupply().call()
        total_supply_adj = total_supply / token_decimal_factor
        
        reserve_balance_total = sum(token_contract.functions.balanceOf(addr).call() for addr in RESERVE_ADDRESSES)
        reserve_balance_adj = reserve_balance_total / token_decimal_factor
        
        circulating_supply = total_supply_adj - reserve_balance_adj
        
        usdt_decimals = usdt_contract.functions.decimals().call()
        usdt_decimal_factor = 10 ** usdt_decimals
        usdt_balance = usdt_contract.functions.balanceOf(SAFE_ADDRESS).call()
        usdt_balance_adj = usdt_balance / usdt_decimal_factor
        
        value_per_token = usdt_balance_adj / circulating_supply if circulating_supply > 0 else 1.0000
        
        return render_template(
            'index.html',
            total_supply=formatar_quatro_decimais(total_supply_adj),    
            reserve_supply=formatar_quatro_decimais(reserve_balance_adj),
            circulating_supply=formatar_quatro_decimais(circulating_supply),
            usdt_balance=formatar_quatro_decimais(usdt_balance_adj),
            value_per_token=formatar_quatro_decimais(value_per_token)
        )
        
    except Exception as e:
        print(f"Erro ao buscar dados blockchain: {e}")
        return render_template('index.html', **default_values)

@app.route('/enviar_contato', methods=['POST'])
def enviar_contato():
    try:
        nome = request.form.get('nome', '').strip()
        email = request.form.get('email', '').strip()
        valor = request.form.get('valor', '').strip()
        
        if not nome or not email:
            return jsonify({'success': False, 'message': 'Nome e email são obrigatórios'})
        
        mensagem = f"""🚀 NOVO INTERESSADO NO BZUK 🚀

📋 Nome: {nome}
📧 Email: {email}
💰 Valor de interesse: {valor or 'Não informado'} USDT

💡 Entre em contato o mais rápido possível!"""
        
        if enviar_telegram(mensagem):
            return jsonify({'success': True, 'message': 'Mensagem enviada com sucesso! Entraremos em contato em breve.'})
        else:
            return jsonify({'success': False, 'message': 'Erro ao enviar mensagem. Tente novamente.'})
            
    except Exception as e:
        print(f"Erro no formulário: {e}")
        return jsonify({'success': False, 'message': 'Erro interno do servidor'})

if __name__ == '__main__':
    app.run(debug=os.getenv('FLASK_DEBUG', 'False').lower() == 'true')