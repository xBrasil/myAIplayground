; Inno Setup script for My AI Playground
; Compiled by: scripts/release.py --installer
; Requires: Inno Setup 6+ (https://jrsoftware.org/isinfo.php)
;
; Preprocessor defines (passed via /D on iscc command line):
;   AppVer  – e.g. "1.6"
;   RepoDir – absolute path to the repository root

#ifndef AppVer
  #define AppVer "0.0.0"
#endif
#ifndef RepoDir
  #define RepoDir ".."
#endif

[Setup]
AppId={{E8A3F7C1-9D4B-4E6A-B5C2-1F0D8E7A6B3C}
AppName=My AI Playground
AppVersion={#AppVer}
AppVerName=My AI Playground {#AppVer}
VersionInfoVersion={#AppVer}.0
AppPublisher=Rodolfo Motta Saraiva
AppPublisherURL=https://rmsaraiva.com/
AppSupportURL=https://github.com/xBrasil/myAIplayground/issues
AppUpdatesURL=https://github.com/xBrasil/myAIplayground/releases
DefaultDirName={autopf}\MyAIPlayground
DefaultGroupName=My AI Playground
UninstallDisplayName=My AI Playground {#AppVer}
OutputDir={#RepoDir}\releases
OutputBaseFilename=my-ai-playground-v{#AppVer}-setup
SetupIconFile={#RepoDir}\frontend\public\favicon.ico
UninstallDisplayIcon={app}\frontend\public\favicon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
AllowNoIcons=yes
DisableWelcomePage=no
ExtraDiskSpaceRequired=8000000000

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"; LicenseFile: "{#RepoDir}\LICENSE"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"; LicenseFile: "{#RepoDir}\LICENÇA"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"; LicenseFile: "{#RepoDir}\LICENSE"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"; LicenseFile: "{#RepoDir}\LICENSE"

[CustomMessages]
english.UninstallDataPrompt=Also delete the user data folder?%n%n%1%n%nIt may contain conversations, uploaded files, and downloaded models. Choose "Yes" to delete everything permanently, or "No" to keep it.
brazilianportuguese.UninstallDataPrompt=Remover também a pasta de dados do usuário?%n%n%1%n%nEla pode conter conversas, arquivos enviados e modelos baixados. Escolha "Sim" para apagar tudo permanentemente, ou "Não" para preservar.
spanish.UninstallDataPrompt=¿Eliminar también la carpeta de datos del usuario?%n%n%1%n%nPuede contener conversaciones, archivos subidos y modelos descargados. Elige "Sí" para borrar todo permanentemente, o "No" para conservarla.
french.UninstallDataPrompt=Supprimer aussi le dossier de données de l'utilisateur ?%n%n%1%n%nIl peut contenir des conversations, des fichiers envoyés et des modèles téléchargés. Choisissez « Oui » pour tout supprimer définitivement, ou « Non » pour le conserver.

english.LaunchApp=Launch My AI Playground now
brazilianportuguese.LaunchApp=Iniciar o My AI Playground agora
spanish.LaunchApp=Iniciar My AI Playground ahora
french.LaunchApp=Lancer My AI Playground maintenant

english.SetupRunning=Setting up the environment: installing dependencies and downloading the AI model.%nThis will take several minutes. Grab a coffee while you wait!
brazilianportuguese.SetupRunning=Configurando o ambiente: instalando dependências e baixando o modelo de IA.%nIsso vai demorar vários minutos. Sugestão: tome um cafezinho enquanto isso!
spanish.SetupRunning=Configurando el entorno: instalando dependencias y descargando el modelo de IA.%nEsto tardará varios minutos. ¡Sugerencia: tómate un café mientras tanto!
french.SetupRunning=Configuration de l'environnement : installation des dépendances et téléchargement du modèle d'IA.%nCela prendra plusieurs minutes. Suggestion : prenez un café en attendant !

english.SetupFailed=Environment setup encountered an error (exit code %1).%n%nCheck the installation log for details:%n%2%n%nYou can retry later by running install.cmd from the installation folder.
brazilianportuguese.SetupFailed=A configuração do ambiente encontrou um erro (código de saída %1).%n%nVerifique o log de instalação para detalhes:%n%2%n%nVocê pode tentar novamente executando install.cmd na pasta de instalação.
spanish.SetupFailed=La configuración del entorno encontró un error (código de salida %1).%n%nConsulte el registro de instalación para más detalles:%n%2%n%nPuede intentar de nuevo ejecutando install.cmd desde la carpeta de instalación.
french.SetupFailed=La configuration de l'environnement a rencontré une erreur (code de sortie %1).%n%nConsultez le journal d'installation pour plus de détails :%n%2%n%nVous pouvez réessayer en exécutant install.cmd depuis le dossier d'installation.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Backend
Source: "{#RepoDir}\backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "__pycache__,*.pyc,.env,.env.local,.mypy_cache,.ruff_cache,.pytest_cache"
; Frontend (source only — node_modules and dist are created by install.cmd)
Source: "{#RepoDir}\frontend\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "node_modules,dist,.vite,*.tsbuildinfo,og-social-preview.png"
; Scripts
Source: "{#RepoDir}\scripts\install.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#RepoDir}\scripts\run.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#RepoDir}\scripts\i18n.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#RepoDir}\scripts\download_default_model.py"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#RepoDir}\scripts\tray.py"; DestDir: "{app}\scripts"; Flags: ignoreversion
; Root files
Source: "{#RepoDir}\install.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\run.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\tray.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\install.sh"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\run.sh"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\tray.sh"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\LICENÇA"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\VERSION"; DestDir: "{app}"; Flags: ignoreversion
; Documentation
Source: "{#RepoDir}\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; Permissions: users-modify — allows runtime writes when installed per-machine (Program Files).
; uninsneveruninstall — preserve user-generated content (chats, uploads, cached models) on uninstall.
Name: "{app}\data"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{app}\data\model-cache"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{app}\data\uploads"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{app}\data\llama-server"; Permissions: users-modify; Flags: uninsneveruninstall

[Icons]
Name: "{group}\My AI Playground"; Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: """{app}\scripts\tray.py"""; IconFilename: "{app}\frontend\public\favicon.ico"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,My AI Playground}"; Filename: "{uninstallexe}"
; {autodesktop} resolves to {userdesktop} on per-user install or {commondesktop} on per-machine install.
Name: "{autodesktop}\My AI Playground"; Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: """{app}\scripts\tray.py"""; IconFilename: "{app}\frontend\public\favicon.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: """{app}\scripts\tray.py"""; Description: "{cm:LaunchApp}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
// --- Win32 helpers for non-blocking process launch ---
type
  TStartupInfo = record
    cb: Cardinal;
    lpReserved, lpDesktop, lpTitle: String;
    dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars,
      dwFillAttribute, dwFlags: Cardinal;
    wShowWindow, cbReserved2: Word;
    lpReserved2: Cardinal;
    hStdInput, hStdOutput, hStdError: THandle;
  end;
  TProcessInformation = record
    hProcess, hThread: THandle;
    dwProcessId, dwThreadId: Cardinal;
  end;

function CreateProcess(lpApp: Cardinal; lpCmd: String; lpPA, lpTA: Cardinal;
  bInherit: BOOL; dwFlags: Cardinal; lpEnv: Cardinal; lpDir: String;
  var si: TStartupInfo; var pi: TProcessInformation): BOOL;
  external 'CreateProcessW@kernel32.dll stdcall';
function WaitForSingleObject(hHandle: THandle; dwMs: Cardinal): Cardinal;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function GetExitCodeProcess(hHandle: THandle; var lpExitCode: Cardinal): BOOL;
  external 'GetExitCodeProcess@kernel32.dll stdcall';
function CloseHandle(hObject: THandle): BOOL;
  external 'CloseHandle@kernel32.dll stdcall';

// --- Message pump so the UI stays responsive ---
type
  TMsg = record
    hwnd: LongWord;
    message: Cardinal;
    wParam: LongWord;
    lParam: LongInt;
    time: Cardinal;
    ptX, ptY: Integer;
  end;

function PeekMessage(var lpMsg: TMsg; hWnd: LongWord;
  wMsgFilterMin, wMsgFilterMax, wRemoveMsg: Cardinal): BOOL;
  external 'PeekMessageW@user32.dll stdcall';
function TranslateMessage(const lpMsg: TMsg): BOOL;
  external 'TranslateMessage@user32.dll stdcall';
function DispatchMessage(const lpMsg: TMsg): LongInt;
  external 'DispatchMessageW@user32.dll stdcall';

procedure ProcessMessages;
var
  Msg: TMsg;
begin
  while PeekMessage(Msg, 0, 0, 0, 1 {PM_REMOVE}) do begin
    TranslateMessage(Msg);
    DispatchMessage(Msg);
  end;
end;

var
  OutputMemo: TNewMemo;

function ReadFileContents(const FileName: String): String;
var
  Lines: TArrayOfString;
  i: Integer;
begin
  Result := '';
  if FileExists(FileName) then begin
    if LoadStringsFromFile(FileName, Lines) then begin
      for i := 0 to GetArrayLength(Lines) - 1 do begin
        if i > 0 then
          Result := Result + #13#10;
        Result := Result + Lines[i];
      end;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  SI: TStartupInfo;
  PI: TProcessInformation;
  LogFile, CmdLine, PrevText: String;
  ExitCode: Cardinal;
  NotepadResult: Integer;
  Created: BOOL;
begin
  if CurStep = ssPostInstall then begin
    LogFile := ExpandConstant('{app}\data\install.log');

    // Update status labels
    WizardForm.StatusLabel.Caption := CustomMessage('SetupRunning');
    WizardForm.FilenameLabel.Caption := '';
    WizardForm.ProgressGauge.Style := npbstMarquee;

    // Create a read-only memo below the progress bar for live output
    OutputMemo := TNewMemo.Create(WizardForm);
    OutputMemo.Parent := WizardForm.InstallingPage;
    OutputMemo.Left := WizardForm.StatusLabel.Left;
    OutputMemo.Width := WizardForm.ProgressGauge.Width;
    OutputMemo.Top := WizardForm.ProgressGauge.Top + WizardForm.ProgressGauge.Height + ScaleY(12);
    OutputMemo.Height := WizardForm.InstallingPage.ClientHeight - OutputMemo.Top - ScaleY(4);
    OutputMemo.ReadOnly := True;
    OutputMemo.ScrollBars := ssVertical;
    OutputMemo.WantReturns := False;
    OutputMemo.Font.Name := 'Consolas';
    OutputMemo.Font.Size := 8;
    OutputMemo.Color := $00F0F0F0;     // light grey background
    OutputMemo.Font.Color := clBlack;  // dark text

    // Launch install.ps1 as a non-blocking process
    CmdLine := ExpandConstant('powershell.exe -ExecutionPolicy Bypass -File "{app}\scripts\install.ps1"');

    SI.cb := 68; // sizeof(TStartupInfo)
    SI.dwFlags := 1; // STARTF_USESHOWWINDOW
    SI.wShowWindow := 0; // SW_HIDE
    Created := CreateProcess(0, CmdLine, 0, 0, False, 0, 0, ExpandConstant('{app}'), SI, PI);

    if Created then begin
      // Poll until the process finishes, keeping the UI responsive
      PrevText := '';
      while WaitForSingleObject(PI.hProcess, 200) = $102 {WAIT_TIMEOUT} do begin
        ProcessMessages;
        // Read log and update memo if content changed
        if FileExists(LogFile) then begin
          CmdLine := ReadFileContents(LogFile);
          if CmdLine <> PrevText then begin
            PrevText := CmdLine;
            OutputMemo.Text := CmdLine;
            // Auto-scroll to bottom
            OutputMemo.SelStart := Length(OutputMemo.Text);
          end;
        end;
      end;

      // Final read of log
      if FileExists(LogFile) then
        OutputMemo.Text := ReadFileContents(LogFile);
      OutputMemo.SelStart := Length(OutputMemo.Text);

      GetExitCodeProcess(PI.hProcess, ExitCode);
      CloseHandle(PI.hThread);
      CloseHandle(PI.hProcess);
    end else begin
      ExitCode := $FFFFFFFF;
    end;

    // Restore progress bar
    WizardForm.ProgressGauge.Style := npbstNormal;
    WizardForm.ProgressGauge.Position := WizardForm.ProgressGauge.Max;

    if ExitCode <> 0 then begin
      MsgBox(FmtMessage(CustomMessage('SetupFailed'), [IntToStr(ExitCode), LogFile]),
             mbError, MB_OK);
      // Open the log in Notepad so the user can inspect what went wrong
      if FileExists(LogFile) then
        ShellExec('open', 'notepad.exe', AddQuotes(LogFile), '', SW_SHOWNORMAL, ewNoWait, NotepadResult);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then begin
    // 1. Remove artifacts created by install.ps1 / install.cmd that Inno doesn't track:
    //    - .venv/             Python virtual env with pip packages
    //    - backend/           clears __pycache__/* (Inno installed only .env.example)
    //    - frontend/          clears node_modules/, dist/, .vite/
    // DelTree is safe on non-existent paths (no-op), so no conditionals needed.
    DelTree(ExpandConstant('{app}\.venv'), True, True, True);
    DelTree(ExpandConstant('{app}\backend'), True, True, True);
    DelTree(ExpandConstant('{app}\frontend'), True, True, True);

    // 2. Remove shortcuts that install.ps1 creates outside Inno's tracking.
    //    In per-machine installs, Inno's {autodesktop} = {commondesktop} while install.ps1
    //    writes to {userdesktop} — two separate shortcuts, both need cleanup.
    DeleteFile(ExpandConstant('{userdesktop}\My AI Playground.lnk'));
    DeleteFile(ExpandConstant('{userappdata}\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\My AI Playground.lnk'));

    // 3. Ask about user data last (chats, uploads, cached models). MB_DEFBUTTON2 makes
    //    "No" the default — also used when uninstall runs silently.
    DataDir := ExpandConstant('{app}\data');
    if DirExists(DataDir) then begin
      if MsgBox(FmtMessage(CustomMessage('UninstallDataPrompt'), [DataDir]),
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then begin
        DelTree(DataDir, True, True, True);
      end;
    end;

    // 4. Drop {app} itself if everything above left it empty.
    RemoveDir(ExpandConstant('{app}'));
  end;
end;
