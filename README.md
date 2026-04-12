<p align="center">
  <img src="frontend/public/original_logo.png" alt="My AI Playground" width="180" />
</p>

<h1 align="center">My AI Playground</h1>

<p align="center">
  Aplicação desktop-local para conversas com modelos <a href="https://ai.google.dev/gemma">Gemma</a> rodando inteiramente na sua máquina.<br/>
  Interface web moderna, entrada multimodal (texto, imagens, áudio, arquivos) e histórico salvo apenas localmente.
</p>

<p align="center">

![Stack](https://img.shields.io/badge/React_19-282c34?logo=react) ![Stack](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white) ![Stack](https://img.shields.io/badge/llama.cpp-GGUF-blue) ![Stack](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)

</p>

---

## Funcionalidades

| Categoria | Descrição |
|---|---|
| **Chat multimodal** | Texto, imagens, áudio e arquivos em uma única conversa — envio simultâneo de múltiplos arquivos; imagens em PNG, JPEG, WebP, GIF, SVG, HEIC/HEIF, AVIF, BMP, ICO e TIFF |
| **Modelos Gemma** | Gemma 4 E2B, E4B e 26B-A4B via GGUF — troque de modelo a qualquer momento pela interface |
| **Arquivos de texto** | 60+ extensões de código e dados (`.py`, `.ts`, `.json`, `.csv`, `.xml`, `.yaml`, `.sql`, `.rs`, `.go`…) lidos como texto |
| **Documentos** | PDF, Word (`.docx`), Excel (`.xlsx`) e PowerPoint (`.pptx`) — extração de texto automática |
| **Pesquisa na web** | Busca via DuckDuckGo e leitura de páginas — o modelo cita fontes com referências numeradas `[1]`, `[2]`… |
| **Acesso a arquivos locais** | O modelo pode listar e ler arquivos de pastas permitidas pelo usuário (somente leitura) |
| **Visão de imagens locais** | Em modelos com visão (Gemma 4 E2B/E4B), o modelo pode ver e descrever imagens de pastas permitidas |
| **Tool calling** | O modelo pode chamar ferramentas (web, filesystem, visão) automaticamente; chamadas ficam salvas no histórico e são exibidas de forma auditável |
| **Instruções personalizadas** | System prompt customizável pelo usuário nos Ajustes — aplicado a todas as conversas |
| **Inferência local** | llama.cpp server com CUDA, flash attention, contexto por modelo (128K–256K tokens) |
| **Streaming** | Respostas exibidas token a token em tempo real |
| **Auto-continuação** | Respostas longas continuam automaticamente quando o limite de tokens é atingido (até 5 rodadas) |
| **Gravação de voz** | Gravar, pausar, retomar e parar antes de enviar; áudio convertido para WAV 16 kHz; timer com contagem regressiva |
| **Transcrição** | Whisper (faster-whisper) converte áudio em texto localmente |
| **Leitura de respostas** | Text-to-Speech via Web Speech API com preferência para vozes Microsoft |
| **Markdown rico** | Renderização com GFM, blocos de código com syntax highlight, matemática KaTeX |
| **Edição de mensagens** | Editar mensagens enviadas e regenerar respostas |
| **Pesquisa de mensagens** | Busque conversas por título ou conteúdo — destaque automático dos termos encontrados |
| **Localização** | Compartilhamento opcional de geolocalização para respostas mais contextualizadas (desativado por padrão) |
| **Avaliação de risco** | Instruções personalizadas são avaliadas automaticamente pelo LLM; alerta exibido apenas quando o risco é significativo |
| **i18n** | Português (BR), English (US), Español e Français — detecta automaticamente o idioma do navegador |
| **Tema escuro** | UI minimalista e responsiva com design dark-mode |
| **Janela deslizante** | Gestão automática de contexto: truncamento de conteúdo longo, descarte de mensagens antigas e retry em estouro |
| **Privacidade total** | Conversas e arquivos ficam em `data/` no seu disco. Nada é enviado para a nuvem. |

---

## Interface

<p align="center">
  <img src="docs/screenshots/chat-dark-mode.jpeg" alt="Chat em tema escuro" width="720" /><br/>
  <em>Interface principal com tema escuro — conversa com o modelo Gemma 4 E4B</em>
</p>

<p align="center">
  <img src="docs/screenshots/multimodal-image.jpeg" alt="Entrada multimodal com imagem" width="720" /><br/>
  <em>Envio de imagem com análise visual pelo modelo</em>
</p>

<p align="center">
  <img src="docs/screenshots/streaming-response.jpeg" alt="Resposta em streaming" width="720" /><br/>
  <em>Resposta em tempo real — tokens aparecem conforme são gerados</em>
</p>

<p align="center">
  <img src="docs/screenshots/model-selector.jpeg" alt="Seletor de modelos" width="720" /><br/>
  <em>Seletor de modelos com descrições de capacidade e limitações</em>
</p>

<p align="center">
  <img src="docs/screenshots/settings-panel.jpeg" alt="Painel de ajustes" width="720" /><br/>
  <em>Painel de ajustes — idioma, voz, instruções personalizadas, acesso web, arquivos locais</em>
</p>

<p align="center">
  <img src="docs/screenshots/web-search.jpeg" alt="Pesquisa na web" width="720" /><br/>
  <em>Pesquisa na web com citação de fontes numeradas</em>
</p>

---

## Requisitos de Sistema

O My AI Playground roda modelos de IA localmente no seu hardware. Os requisitos variam conforme o modelo escolhido.

### Mínimos (modelo Gemma 4 E2B — 2B parâmetros)

| Componente | Requisito |
|---|---|
| **SO** | Windows 10/11 (64 bits) |
| **RAM** | 8 GB |
| **VRAM (GPU)** | 4 GB (NVIDIA com CUDA) ou modo CPU |
| **Disco** | ~3 GB para o modelo + ~1 GB para dependências |
| **CPU** | Qualquer x86-64 com suporte AVX2 |

### Recomendados (modelo Gemma 4 E4B — 4B parâmetros)

| Componente | Requisito |
|---|---|
| **RAM** | 16 GB |
| **VRAM (GPU)** | 6 GB (NVIDIA com CUDA) |
| **Disco** | ~5 GB para o modelo |

### Para o modelo maior (Gemma 4 26B-A4B — 26B parâmetros, MoE)

| Componente | Requisito |
|---|---|
| **RAM** | 32 GB |
| **VRAM (GPU)** | 16 GB+ (NVIDIA com CUDA) |
| **Disco** | ~15 GB para o modelo |

> **Nota:** sem VRAM suficiente, o llama.cpp fará offloading para a RAM do sistema (modo CPU/parcial), resultando em inferência significativamente mais lenta. Se você receber erros de **Out of Memory (OOM)**, experimente um modelo menor ou reduza `N_CTX` no arquivo `backend/.env`.

---

## Início rápido (Windows)

### Opção A — Instalador gráfico

Na [página de releases](https://github.com/xBrasil/myAIplayground/releases) está disponível um instalador `.exe` para Windows (criado com [Inno Setup](https://jrsoftware.org/isinfo.php)). O assistente de instalação copia os arquivos, cria atalhos no Menu Iniciar e na Área de Trabalho, e opcionalmente executa a configuração de dependências ao final.

> **Nota:** Python 3.11+ e Node.js 20+ ainda precisam estar instalados no sistema.

### Opção B — Via scripts

### Pré-requisitos

- **Windows 10/11** (64 bits)
- **Python 3.11+**
- **Node.js 20+**
- **GPU NVIDIA** com drivers atualizados (recomendado; funciona sem GPU em modo CPU)

### Instalação

```powershell
install.cmd
```

O instalador:
- Detecta e instala Python e Node.js automaticamente via `winget` (se executado como Administrador)
- Cria o ambiente virtual `.venv` e instala dependências do backend
- Instala dependências npm do frontend
- Baixa o binário mais recente do `llama-server` (CUDA ou CPU, conforme sua GPU)
- Cria `backend/.env` a partir de `.env.example`

### Execução

```powershell
run.cmd
```

O launcher:
- Inicia backend (FastAPI na porta 8000) e frontend (Vite na porta 5173)
- Aguarda ambos ficarem prontos e abre a interface no navegador
- Reutiliza serviços já em execução — seguro rodar mais de uma vez
- Logs salvos em `data/backend.log` e `data/frontend.log`

> **Dica:** o primeiro uso de cada modelo envolve download do GGUF do Hugging Face. Modelos ficam em cache em `data/model-cache/`.

---

## Início rápido (Linux / macOS)

### Pré-requisitos

- **Python 3.11+** com `venv` (`python3-venv` no Ubuntu/Debian)
- **Node.js 20+**
- **GPU NVIDIA** com drivers atualizados (recomendado; funciona sem GPU em modo CPU)
- `curl` e `unzip` instalados

### Instalação

```bash
chmod +x install.sh
./install.sh
```

O instalador faz as mesmas etapas da versão Windows: cria `.venv`, instala dependências, baixa `llama-server` e prepara `.env`.

### Execução

```bash
./run.sh
```

Inicia backend e frontend, aguarda ambos ficarem prontos e abre o navegador. Use `Ctrl+C` para encerrar.

> **Nota:** o script detecta automaticamente macOS (arm64/x64) e Linux para baixar o binário correto do llama-server.

---

## Modelos disponíveis

| Modelo | Arquivo GGUF | Quantização | Contexto | Uso típico |
|---|---|---|---|---|
| **Gemma 4 E2B** | `gemma-4-E2B-it-Q8_0.gguf` | Q8_0 | 128K | Rápido, ideal para testes |
| **Gemma 4 E4B** | `gemma-4-E4B-it-Q4_K_M.gguf` | Q4_K_M | 128K | Equilíbrio entre qualidade e velocidade |
| **Gemma 4 26B-A4B** | `gemma-4-26B-A4B-it-UD-IQ4_XS.gguf` | IQ4_XS | 256K | Maior qualidade, requer mais VRAM |

O modelo E4B é o padrão. Todos são executados pelo llama.cpp via GGUF, sem PyTorch em runtime.

---

## Stack técnica

### Frontend
- **React 19** + **TypeScript** + **Vite**
- `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex`
- Web Speech API (TTS)
- MediaRecorder API (gravação de áudio)

### Backend
- **FastAPI** + **Uvicorn**
- **SQLAlchemy** (SQLite)
- **faster-whisper** (transcrição de áudio)
- **huggingface_hub** (download de modelos)
- **httpx** (comunicação com llama-server)
- **duckduckgo-search** (pesquisa web via DuckDuckGo)
- **beautifulsoup4** (extração de conteúdo de páginas web)
- **PyMuPDF** / **python-docx** / **openpyxl** / **python-pptx** (extração de texto de documentos)
- **pillow-heif** (suporte a HEIC e AVIF no Pillow)
- **svglib** + **reportlab** (renderização de SVG para análise visual)

### Inferência
- **llama.cpp server** (binário pré-compilado, CUDA ou CPU)
- Gerenciado automaticamente pelo backend — download, inicialização e fallback

---

## Estrutura do projeto

```
myAIplayground/
├── frontend/          # React + Vite (interface web)
│   └── src/
│       ├── components/   # Sidebar, ChatLayout, Composer, MessageList...
│       ├── lib/          # API client, preferências, speech, i18n
│       └── locales/      # pt-BR.json, en-US.json, es-ES.json, fr-FR.json
├── backend/           # FastAPI (API + serviços)
│   └── app/
│       ├── api/routes/   # chat, conversations, health, models
│       ├── core/         # config (pydantic-settings)
│       └── services/     # chat, model, storage, input_adapter, document, web, filesystem
├── data/              # Dados locais (ignorados pelo git)
│   ├── app.db            # SQLite com conversas e mensagens
│   ├── uploads/          # Arquivos enviados nas conversas
│   ├── model-cache/      # GGUF e mmproj baixados do HF
│   └── llama-server/     # Binário do llama-server
├── docs/              # Documentação adicional
├── scripts/           # Scripts utilitários (install, run, release, i18n, test)
├── install.cmd        # Instalação automatizada (Windows)
├── run.cmd            # Launcher (Windows)
├── install.sh         # Instalação automatizada (Linux / macOS)
├── run.sh             # Launcher (Linux / macOS)
└── README.md
```

---

## Configuração

As variáveis de ambiente ficam em `backend/.env` (criado automaticamente pelo instalador). Principais opções:

| Variável | Padrão | Descrição |
|---|---|---|
| `ENABLE_MODEL_LOADING` | `true` | Habilita download e carregamento automático de modelos |
| `DEFAULT_MODEL_KEY` | `e4b` | Modelo padrão (`e2b`, `e4b`, `26b`) |
| `N_CTX` | `0` (auto) | Tamanho do contexto do llama-server (`0` = usar perfil do modelo: 128K E2B/E4B, 256K 26B) |
| `N_GPU_LAYERS` | `-1` | Camadas na GPU (`-1` = todas) |
| `FLASH_ATTN` | `true` | Flash Attention (mais rápido em GPUs compatíveis) |
| `WHISPER_MODEL_SIZE` | `base` | Tamanho do modelo Whisper (`tiny`, `base`, `small`, `medium`, `large`) |
| `DEFAULT_SYSTEM_PROMPT` | `You are a helpful local assistant.` | System prompt padrão |

---

## Privacidade

- As conversas são salvas apenas em `data/app.db` (local).
- Arquivos enviados ficam em `data/uploads/` (local).
- O download inicial dos modelos vem do Hugging Face. Após isso, tudo roda offline.
- **Pesquisa web**: quando ativada nos Ajustes, o modelo pode fazer buscas no DuckDuckGo e acessar páginas web. Essas requisições saem da sua máquina. Desative nos Ajustes para modo totalmente offline.
- **Acesso a arquivos locais**: quando ativado nos Ajustes, o modelo pode ler arquivos **somente** das pastas que você permitiu explicitamente. Acesso é READ-ONLY e protegido contra travessia de diretório.
- A funcionalidade de Text-to-Speech usa a API `speechSynthesis` do navegador. O comportamento (local vs. online) depende da voz selecionada e da configuração do sistema.

---

## Modelos de IA (Gemma)

> **Aviso:** Este projeto **não é afiliado, patrocinado nem endossado pelo Google ou pela Alphabet Inc.** "Gemma" é uma marca do Google. Os modelos Gemma são utilizados sob os termos de licenciamento disponibilizados pelo Google.

Os modelos de IA utilizados por esta aplicação (família **Google Gemma**) **não são distribuídos** com este repositório. Eles são baixados diretamente do [Hugging Face](https://huggingface.co/) mediante solicitação do usuário e estão sujeitos aos [Termos de Uso do Gemma](https://ai.google.dev/gemma/terms) do Google.

Ao baixar e usar esses modelos, você concorda em cumprir os termos do Google, que incluem restrições à geração de conteúdo prejudicial, ilegal ou enganoso.

---

## Licença

Este projeto é licenciado sob a [Apache License 2.0](LICENSE).

```
Copyright 2026 Rodolfo Motta Saraiva
```

Criado por [Rodolfo Motta Saraiva](https://rmsaraiva.com/) como projeto pessoal de código aberto.

### Componentes de terceiros

| Componente | Licença |
|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT |
| [FastAPI](https://github.com/tiangolo/fastapi) | MIT |
| [React](https://github.com/facebook/react) | MIT |
| [Hugging Face Hub](https://github.com/huggingface/huggingface_hub) | Apache 2.0 |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT |
| [duckduckgo-search](https://github.com/deedy5/duckduckgo_search) | MIT |
| [beautifulsoup4](https://www.crummy.com/software/BeautifulSoup/) | MIT |
| [pillow-heif](https://github.com/bigcat88/pillow_heif) | BSD-3-Clause |
| [svglib](https://github.com/deeplook/svglib) | LGPL-3.0 |
| [reportlab](https://www.reportlab.com/dev/opensource/) | BSD-3-Clause |
| [Google Gemma 4](https://ai.google.dev/gemma) (modelos de IA — não distribuídos) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) |

---

## English Summary

**My AI Playground** is an open-source, desktop-local application for chatting with [Google Gemma](https://ai.google.dev/gemma) AI models running entirely on your machine. It features a modern web UI, multimodal input (text, images, audio, files), and conversation history stored only locally.

> **Disclaimer:** This project is **not affiliated with, sponsored by, or endorsed by Google or Alphabet Inc.** "Gemma" is a trademark of Google. The Gemma models are used under the licensing terms provided by Google.

### System Requirements

| Model | RAM | VRAM (NVIDIA CUDA) | Disk |
|---|---|---|---|
| Gemma 4 E2B (2B) | 8 GB | 4 GB (or CPU-only) | ~3 GB |
| Gemma 4 E4B (4B) | 16 GB | 6 GB | ~5 GB |
| Gemma 4 26B-A4B (26B MoE) | 32 GB | 16 GB+ | ~15 GB |

> Without sufficient VRAM, llama.cpp will offload layers to system RAM (CPU mode), resulting in significantly slower inference. If you encounter **OOM errors**, try a smaller model or reduce `N_CTX` in `backend/.env`.

### Key points

- **100% local inference** — all AI processing runs on your hardware via [llama.cpp](https://github.com/ggml-org/llama.cpp) (GGUF format). No data is sent to cloud services during normal chat use.
- **Privacy by design** — conversations are stored in a local SQLite database (`data/app.db`). Uploaded files stay in `data/uploads/`. No analytics or telemetry.
- **Gemma models are not included** — they are downloaded from [Hugging Face](https://huggingface.co/) at the user's request and are subject to [Google's Gemma Terms of Use](https://ai.google.dev/gemma/terms).
- **Stack**: React 19 + TypeScript + Vite (frontend), FastAPI + SQLAlchemy (backend), llama.cpp server (inference), faster-whisper (speech-to-text).
- **License**: [Apache License 2.0](LICENSE) — Copyright 2026 Rodolfo Motta Saraiva.

For setup instructions, see the Portuguese sections above or the [setup guide](docs/setup-windows.md).

### Quick Start

**Windows:**
```powershell
install.cmd   # one-time setup
run.cmd        # launch
```

**Linux / macOS:**
```bash
chmod +x install.sh run.sh
./install.sh   # one-time setup
./run.sh       # launch
```
