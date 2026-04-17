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
CloseApplications=force
DisableWelcomePage=no
ExtraDiskSpaceRequired=8000000000

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"; LicenseFile: "{#RepoDir}\LICENSE"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"; LicenseFile: "{#RepoDir}\LICENÇA"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"; LicenseFile: "{#RepoDir}\LICENSE"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"; LicenseFile: "{#RepoDir}\LICENSE"

[CustomMessages]
english.UninstallDataPrompt=Also delete your personal data?%n%n%1%n%nThis folder contains your conversations, uploaded files, and preferences. Choose "Yes" to delete permanently, or "No" to keep it.%n%n(Downloaded models and system files are always removed.)
brazilianportuguese.UninstallDataPrompt=Remover também seus dados pessoais?%n%n%1%n%nEssa pasta contém suas conversas, arquivos enviados e preferências. Escolha "Sim" para apagar permanentemente, ou "Não" para preservar.%n%n(Modelos baixados e arquivos de sistema são sempre removidos.)
spanish.UninstallDataPrompt=¿Eliminar también sus datos personales?%n%n%1%n%nEsta carpeta contiene sus conversaciones, archivos subidos y preferencias. Elige "Sí" para borrar permanentemente, o "No" para conservarla.%n%n(Los modelos descargados y archivos de sistema siempre se eliminan.)
french.UninstallDataPrompt=Supprimer aussi vos données personnelles ?%n%n%1%n%nCe dossier contient vos conversations, fichiers envoyés et préférences. Choisissez « Oui » pour tout supprimer définitivement, ou « Non » pour le conserver.%n%n(Les modèles téléchargés et les fichiers système sont toujours supprimés.)

english.LaunchApp=Launch My AI Playground now
brazilianportuguese.LaunchApp=Iniciar o My AI Playground agora
spanish.LaunchApp=Iniciar My AI Playground ahora
french.LaunchApp=Lancer My AI Playground maintenant

english.UninstallRestartRequired=Some files could not be removed because they are still in use.%n%nPlease restart your computer to complete the uninstallation. The remaining files will be removed automatically on the next startup.
brazilianportuguese.UninstallRestartRequired=Alguns arquivos não puderam ser removidos porque ainda estão em uso.%n%nPor favor, reinicie o computador para concluir a desinstalação. Os arquivos restantes serão removidos automaticamente na próxima inicialização.
spanish.UninstallRestartRequired=Algunos archivos no pudieron ser eliminados porque aún están en uso.%n%nPor favor, reinicie su computadora para completar la desinstalación. Los archivos restantes se eliminarán automáticamente en el próximo inicio.
french.UninstallRestartRequired=Certains fichiers n'ont pas pu être supprimés car ils sont encore utilisés.%n%nVeuillez redémarrer votre ordinateur pour terminer la désinstallation. Les fichiers restants seront supprimés automatiquement au prochain démarrage.

english.UninstallStoppingApp=Stopping My AI Playground...
brazilianportuguese.UninstallStoppingApp=Parando o My AI Playground...
spanish.UninstallStoppingApp=Deteniendo My AI Playground...
french.UninstallStoppingApp=Arrêt de My AI Playground...

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
; System data: always deleted on uninstall (models, logs, engine binaries).
Name: "{app}\data\system"; Permissions: users-modify
Name: "{app}\data\system\model-cache"; Permissions: users-modify
Name: "{app}\data\system\llama-server"; Permissions: users-modify
Name: "{app}\data\system\logs"; Permissions: users-modify
; User data: preserved on uninstall unless user opts to delete.
Name: "{app}\data\user"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{app}\data\user\uploads"; Permissions: users-modify; Flags: uninsneveruninstall

[Icons]
Name: "{group}\My AI Playground"; Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: """{app}\scripts\tray.py"""; IconFilename: "{app}\frontend\public\favicon.ico"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,My AI Playground}"; Filename: "{uninstallexe}"
; {autodesktop} resolves to {userdesktop} on per-user install or {commondesktop} on per-machine install.
Name: "{autodesktop}\My AI Playground"; Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: """{app}\scripts\tray.py"""; IconFilename: "{app}\frontend\public\favicon.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\.venv\Scripts\pythonw.exe"; Parameters: """{app}\scripts\tray.py"""; Description: "{cm:LaunchApp}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent; Check: CanLaunchApp

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

function CanLaunchApp: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\.venv\Scripts\pythonw.exe'));
end;

// --- Auto-uninstall previous version before installing ---
function GetPreviousUninstallString: String;
var
  S: String;
begin
  Result := '';
  // Check current-user install first (PrivilegesRequired=lowest)
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
     'UninstallString', S) then
    Result := S
  else if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#SetupSetting("AppId")}_is1',
     'UninstallString', S) then
    Result := S;
end;

function InitializeSetup: Boolean;
var
  PrevUninstall: String;
  ResultCode: Integer;
  QuoteEnd: Integer;
begin
  Result := True;
  PrevUninstall := GetPreviousUninstallString;
  if PrevUninstall <> '' then begin
    // Extract the executable path: handle quoted paths like '"C:\path\unins000.exe" /SILENT'
    if (Length(PrevUninstall) > 1) and (PrevUninstall[1] = '"') then begin
      QuoteEnd := Pos('"', Copy(PrevUninstall, 2, Length(PrevUninstall) - 1));
      if QuoteEnd > 0 then
        PrevUninstall := Copy(PrevUninstall, 2, QuoteEnd - 1)
      else
        PrevUninstall := Copy(PrevUninstall, 2, Length(PrevUninstall) - 1);
    end else begin
      // Unquoted: take everything up to the first space (if any)
      QuoteEnd := Pos(' ', PrevUninstall);
      if QuoteEnd > 0 then
        PrevUninstall := Copy(PrevUninstall, 1, QuoteEnd - 1);
    end;
    if FileExists(PrevUninstall) then begin
      // Run the old uninstaller silently, keeping user data
      Exec(PrevUninstall, '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES', '',
           SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

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
    LogFile := ExpandConstant('{app}\data\system\logs\install.log');

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
  DataDir, AppDir, SafeApp: String;
  ResultCode: Integer;
  NeedRestart: Boolean;
begin
  // Escape single quotes in {app} for safe embedding in PowerShell single-quoted strings
  AppDir := ExpandConstant('{app}');
  SafeApp := AppDir;
  StringChangeEx(SafeApp, '''', '''''', False);

  if CurUninstallStep = usUninstall then begin
    // --- Stop running app processes before removing files ---
    // Try graceful shutdown via backend API on default and fallback ports.
    // HttpWebRequest has a reliable hard timeout, unlike Invoke-WebRequest
    // whose -TimeoutSec can hang on connection-level issues in PS 5.1.
    try
      Exec('powershell.exe',
        '-NoProfile -ExecutionPolicy Bypass -Command "foreach ($p in 8000..8009) { try { $r=[System.Net.HttpWebRequest]::Create(\"http://127.0.0.1:${p}/api/shutdown\"); $r.Method=''POST''; $r.Timeout=1500; $r.Headers.Add(''Origin'',''http://127.0.0.1:5173''); $null=$r.GetResponse(); break } catch {} finally { if ($r) { try { $r.Abort() } catch {} } } }"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    except
    end;

    // Kill any remaining Python/Node processes that belong to our app
    try
      Exec('powershell.exe',
        '-NoProfile -ExecutionPolicy Bypass -Command "$appPath = (Join-Path ''' + SafeApp + ''' ''''); Get-Process python,pythonw,node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($appPath, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    except
    end;

    // Also kill by window title in case processes are not inside {app}
    try
      Exec('taskkill.exe', '/F /T /FI "WINDOWTITLE eq My AI Playground*"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    except
    end;

    // Kill any process still listening on our ports, including fallback range
    // Backend: 8000-8009, Frontend: 5173-5182, llama-server: 8081
    // Only kills processes whose executable path or command line references {app}
    try
      Exec('powershell.exe',
        '-NoProfile -ExecutionPolicy Bypass -Command "$app = ''' + SafeApp + '''; $ports = @(8081) + @(8000..8009) + @(5173..5182); foreach ($port in $ports) { try { $lines = netstat -ano 2>$null | Select-String ''127\.0\.0\.1:'' | Select-String ('':'' + $port + ''\s'') | Select-String ''LISTENING''; $pids = @(); foreach ($l in $lines) { if ($l -match ''\s(\d+)\s*$'') { $pids += $Matches[1] } }; $pids = $pids | Select-Object -Unique; foreach ($pid in $pids) { try { $proc = Get-CimInstance Win32_Process -Filter (''ProcessId = '' + $pid) -ErrorAction SilentlyContinue; if ($proc -and ((($proc.ExecutablePath) -and $proc.ExecutablePath.StartsWith($app, [System.StringComparison]::OrdinalIgnoreCase)) -or (($proc.CommandLine) -and ($proc.CommandLine.IndexOf($app, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)))) { taskkill /F /T /PID $pid 2>$null } } catch {} } } catch {} }"',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    except
    end;

    // Brief wait for processes to release files
    Sleep(1000);
  end;

  if CurUninstallStep = usPostUninstall then begin

    // 1. Remove artifacts created by install.ps1 / install.cmd that Inno doesn't track
    DelTree(AppDir + '\.venv', True, True, True);
    DelTree(AppDir + '\backend', True, True, True);
    DelTree(AppDir + '\frontend', True, True, True);

    // 2. Remove shortcuts that install.ps1 creates outside Inno's tracking.
    DeleteFile(ExpandConstant('{userdesktop}\My AI Playground.lnk'));
    DeleteFile(ExpandConstant('{userappdata}\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\My AI Playground.lnk'));

    // 3. Always remove system data (models, logs, engine binaries).
    DelTree(AppDir + '\data\system', True, True, True);

    // 4. Ask about user data (conversations, uploads, preferences).
    DataDir := AppDir + '\data\user';
    if DirExists(DataDir) then begin
      if MsgBox(FmtMessage(CustomMessage('UninstallDataPrompt'), [DataDir]),
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then begin
        DelTree(DataDir, True, True, True);
      end;
    end;

    // 5. Drop {app}\data and {app} itself if everything above left them empty.
    RemoveDir(AppDir + '\data');
    RemoveDir(AppDir);

    // 6. Check if files remain (in-use locks) and offer restart to complete cleanup
    NeedRestart := False;
    if DirExists(AppDir + '\.venv') or DirExists(AppDir + '\backend') or
       DirExists(AppDir + '\frontend') then
      NeedRestart := True;
    // Also check data dir if user chose to delete it
    if not DirExists(DataDir) then begin
      // User didn't want to delete, or it was deleted fine — no issue
    end;

    if NeedRestart then begin
      // Schedule only the leftover locked dirs for removal on next login (preserve data/)
      try
        Exec('powershell.exe',
          '-NoProfile -ExecutionPolicy Bypass -Command "' +
          '$dirs = @(''.venv'',''backend'',''frontend''); ' +
          'foreach ($d in $dirs) { ' +
          '  $p = Join-Path ''' + SafeApp + ''' $d; ' +
          '  if (Test-Path $p) { ' +
          '    Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue ' +
          '  } ' +
          '}; ' +
          '$remaining = Get-ChildItem ''' + SafeApp + ''' -ErrorAction SilentlyContinue; ' +
          'if (-not $remaining) { Remove-Item ''' + SafeApp + ''' -Force -ErrorAction SilentlyContinue }"',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      except
      end;
      // Also schedule via RunOnce as a last resort for stubborn locks
      try
        Exec('powershell.exe',
          '-NoProfile -ExecutionPolicy Bypass -Command "' +
          'New-ItemProperty -Path ''HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'' ' +
          '-Name ''MyAIPlaygroundCleanup'' ' +
          '-Value (''cmd /c ' +
          'if exist \"' + AppDir + '\.venv\" rd /s /q \"' + AppDir + '\.venv\" ^& ' +
          'if exist \"' + AppDir + '\backend\" rd /s /q \"' + AppDir + '\backend\" ^& ' +
          'if exist \"' + AppDir + '\frontend\" rd /s /q \"' + AppDir + '\frontend\"'') ' +
          '-PropertyType String -Force -ErrorAction SilentlyContinue"',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      except
      end;
      // Inform user that a restart is needed
      MsgBox(CustomMessage('UninstallRestartRequired'), mbInformation, MB_OK);
    end;
  end;
end;
