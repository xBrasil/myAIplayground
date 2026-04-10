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
| **Chat multimodal** | Texto, imagens, áudio e arquivos em uma única conversa — envio simultâneo de múltiplos arquivos |
| **Modelos Gemma** | Gemma 4 E2B, E4B e 26B-A4B via GGUF — troque de modelo a qualquer momento pela interface |
| **Arquivos de texto** | 60+ extensões de código e dados (`.py`, `.ts`, `.json`, `.csv`, `.xml`, `.yaml`, `.sql`, `.rs`, `.go`…) lidos como texto |
| **Documentos** | PDF, Word (`.docx`), Excel (`.xlsx`) e PowerPoint (`.pptx`) — extração de texto automática |
| **Inferência local** | llama.cpp server com CUDA, flash attention, contexto por modelo (128K–256K tokens) |
| **Streaming** | Respostas exibidas token a token em tempo real |
| **Auto-continuação** | Respostas longas continuam automaticamente quando o limite de tokens é atingido (até 5 rodadas) |
| **Gravação de voz** | Gravar, pausar, retomar e parar antes de enviar; áudio convertido para WAV 16 kHz; timer com contagem regressiva |
| **Transcrição** | Whisper (faster-whisper) converte áudio em texto localmente |
| **Leitura de respostas** | Text-to-Speech via Web Speech API com preferência para vozes Microsoft |
| **Markdown rico** | Renderização com GFM, blocos de código com syntax highlight, matemática KaTeX |
| **Edição de mensagens** | Editar mensagens enviadas e regenerar respostas |
| **i18n** | Português (Brasil) e English — detecta automaticamente o idioma do navegador |
| **Tema escuro** | UI minimalista e responsiva com design dark-mode |
| **Janela deslizante** | Gestão automática de contexto: truncamento de conteúdo longo, descarte de mensagens antigas e retry em estouro |
| **Privacidade total** | Conversas e arquivos ficam em `data/` no seu disco. Nada é enviado para a nuvem. |

---

## Início rápido (Windows)

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
- **PyMuPDF** / **python-docx** / **openpyxl** / **python-pptx** (extração de texto de documentos)

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
│       └── locales/      # pt-BR.json, en-US.json
├── backend/           # FastAPI (API + serviços)
│   └── app/
│       ├── api/routes/   # chat, conversations, health, models
│       ├── core/         # config (pydantic-settings)
│       └── services/     # chat, model, storage, input_adapter, document
├── data/              # Dados locais (ignorados pelo git)
│   ├── app.db            # SQLite com conversas e mensagens
│   ├── uploads/          # Arquivos enviados nas conversas
│   ├── model-cache/      # GGUF e mmproj baixados do HF
│   └── llama-server/     # Binário do llama-server
├── docs/              # Documentação adicional
├── scripts/           # Scripts utilitários (release.py)
├── install.cmd/.ps1   # Instalação automatizada
├── run.cmd/.ps1       # Launcher
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
- A funcionalidade de Text-to-Speech usa a API `speechSynthesis` do navegador. O comportamento (local vs. online) depende da voz selecionada e da configuração do sistema.

---

## Modelos de IA (Gemma)

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

---

## English Summary

**My AI Playground** is an open-source, desktop-local application for chatting with [Google Gemma](https://ai.google.dev/gemma) AI models running entirely on your machine. It features a modern web UI, multimodal input (text, images, audio, files), and conversation history stored only locally.

### Key points

- **100% local inference** — all AI processing runs on your hardware via [llama.cpp](https://github.com/ggml-org/llama.cpp) (GGUF format). No data is sent to cloud services during normal chat use.
- **Privacy by design** — conversations are stored in a local SQLite database (`data/app.db`). Uploaded files stay in `data/uploads/`. No analytics or telemetry.
- **Gemma models are not included** — they are downloaded from [Hugging Face](https://huggingface.co/) at the user's request and are subject to [Google's Gemma Terms of Use](https://ai.google.dev/gemma/terms).
- **Stack**: React 19 + TypeScript + Vite (frontend), FastAPI + SQLAlchemy (backend), llama.cpp server (inference), faster-whisper (speech-to-text).
- **License**: [Apache License 2.0](LICENSE) — Copyright 2026 Rodolfo Motta Saraiva.

For setup instructions, see the Portuguese sections above or the [setup guide](docs/setup-windows.md).
