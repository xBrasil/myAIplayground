# Setup no Windows 11

## Pre-requisitos

- Python 3.11+
- Node.js 20+
- Git
- Drivers NVIDIA atualizados
- CUDA compativel com a build do PyTorch escolhida

## Fluxo recomendado

1. Na raiz do repositorio, rode `install.cmd`.
2. Quando a instalacao terminar, rode `run.cmd`.

O `install.cmd`:

- cria `.venv` na raiz se necessario
- instala dependencias Python do backend
- instala dependencias npm do frontend
- cria `backend/.env` a partir de `backend/.env.example` se ele ainda nao existir
- liga `ENABLE_MODEL_LOADING=true` no `.env` criado automaticamente

O `run.cmd`:

- abre uma janela de PowerShell para o backend
- abre outra janela de PowerShell para o frontend
- espera os dois servicos ficarem prontos
- abre `http://127.0.0.1:5173` no navegador padrao
- reaproveita backend/frontend ja em execucao para evitar conflito de porta

Os logs ficam nas janelas separadas de backend e frontend, que continuam abertas para diagnostico.

## Uso manual, se voce preferir

## Backend

1. Crie um ambiente virtual em `.venv` na raiz.
2. Instale as dependencias com `pip install -r backend/requirements.txt`.
3. Se houver GPU NVIDIA, substitua o PyTorch padrao por uma build com CUDA:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu128
```

4. Copie `backend/.env.example` para `backend/.env`.
5. Ajuste `ENABLE_MODEL_LOADING=true` para carregar o Gemma 4 E4B no startup.
6. Rode a API com `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000` dentro de `backend/`.

## Verificacoes uteis

Confirme CUDA no Python:

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'sem gpu')"
```

Confirme o backend:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/api/health | Select-Object -ExpandProperty Content
```

## Onde o historico fica salvo

- Conversas: `data/app.db`
- Arquivos enviados nas conversas: `data/uploads/`
- Cache do modelo: `data/model-cache/`

Para resetar tudo manualmente, pare frontend e backend e remova `data/app.db` e o conteudo de `data/uploads/`.

## Frontend

1. Entre em `frontend/`.
2. Instale as dependencias com `npm install`.
3. Rode com `npm run dev`.

## Voz Microsoft Antonio

O frontend usa as vozes locais do Windows 11 via `speechSynthesis` no navegador. A aplicacao tenta usar `Microsoft Antonio` automaticamente quando a voz aparece na lista do navegador.

Se a voz nao aparecer:

1. Confirme no Windows 11 que a voz esta instalada.
2. Prefira usar Edge ou Chrome atualizados.
3. Abra `Ajustes` na interface e verifique o seletor de voz.

## Privacidade

- Depois que o modelo foi baixado e o backend esta configurado, o chat e processado localmente na sua maquina.
- O aplicativo salva conversas e anexos apenas localmente, salvo se voce decidir copiar ou sincronizar os arquivos por conta propria.
- O aplicativo nao envia intencionalmente o conteudo digitado para APIs em nuvem durante a inferencia local do chat.
- O botao de ouvir resposta usa `speechSynthesis` do navegador com as vozes do Windows. O aplicativo nao envia intencionalmente o texto para servidores Microsoft, mas a implementacao final depende do navegador e das vozes disponiveis no sistema.

## GitHub remoto

Depois do bootstrap local, crie um repositrio remoto no GitHub e conecte `origin`:

```powershell
git remote add origin <URL_DO_REPOSITORIO>
git branch -M main
git push -u origin main
```
