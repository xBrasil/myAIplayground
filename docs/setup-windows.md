# Setup manual no Windows

> Para a maioria dos usuários, basta rodar `install.cmd` seguido de `run.cmd`.
> Esta página documenta o setup **manual**, caso queira configurar individualmente.

## Pré-requisitos

- **Windows 10/11** (64 bits)
- **Python 3.11+**
- **Node.js 20+**
- **GPU NVIDIA** com drivers atualizados (recomendado; funciona sem GPU em modo CPU)

## O que `install.cmd` faz

1. Detecta e instala Python e Node.js via `winget` (se executado como Administrador)
2. Cria o ambiente virtual `.venv` na raiz e instala dependências Python (`backend/requirements.txt`) — incluindo `pillow-heif` e `svglib` para suporte completo a imagens
3. Baixa o binário mais recente do `llama-server` do GitHub (CUDA ou CPU, conforme sua GPU)
4. Instala dependências npm do frontend (`npm install`)
5. Cria os diretórios `data/`, `data/uploads/`, `data/model-cache/`
6. Cria `backend/.env` a partir de `.env.example` com `ENABLE_MODEL_LOADING=true`
7. Cria atalho na área de trabalho

## O que `run.cmd` faz

1. Inicia o backend (FastAPI/Uvicorn na porta 8000) em uma janela PowerShell
2. Inicia o frontend (Vite na porta 5173) em outra janela PowerShell
3. Aguarda ambos ficarem prontos
4. Abre `http://127.0.0.1:5173` no navegador padrão
5. Reutiliza serviços já em execução (seguro rodar mais de uma vez)

## Setup manual do backend

```powershell
# Criar ambiente virtual
python -m venv .venv

# Ativar e instalar dependências
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt

# Criar .env
Copy-Item backend/.env.example backend/.env
# Editar backend/.env conforme necessário (ENABLE_MODEL_LOADING=true)

# Rodar
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Setup manual do frontend

```powershell
cd frontend
npm install
npm run dev
```

## Verificações úteis

Confirmar CUDA no Python:

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

Confirmar backend:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/api/health | Select-Object -ExpandProperty Content
```

## Dados locais

| Caminho | Conteúdo |
|---|---|
| `data/app.db` | Banco SQLite com conversas e mensagens |
| `data/uploads/` | Arquivos enviados nas conversas |
| `data/model-cache/` | Modelos GGUF baixados do Hugging Face |
| `data/llama-server/` | Binário do llama-server |
| `data/legal-acceptance.json` | Registro de aceitação dos termos |

Para resetar tudo: pare backend e frontend, remova a pasta `data/`.
