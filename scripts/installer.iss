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
AppPublisher=Rodolfo Motta Saraiva
AppPublisherURL=https://rmsaraiva.com/
AppSupportURL=https://github.com/xBrasil/myAIplayground/issues
AppUpdatesURL=https://github.com/xBrasil/myAIplayground/releases
DefaultDirName={autopf}\MyAIPlayground
DefaultGroupName=My AI Playground
LicenseFile={#RepoDir}\LICENSE
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
DisableWelcomePage=no
WizardImageFile=compiler:WizModernImage-IS.bmp
WizardSmallImageFile=compiler:WizModernSmallImage-IS.bmp

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Backend
Source: "{#RepoDir}\backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "__pycache__,*.pyc,.env,.env.local,.mypy_cache,.ruff_cache,.pytest_cache"
; Frontend (source only — node_modules and dist are created by install.cmd)
Source: "{#RepoDir}\frontend\*"; DestDir: "{app}\frontend"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "node_modules,dist,.vite,*.tsbuildinfo,og-social-preview.png"
; Scripts
Source: "{#RepoDir}\scripts\install.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#RepoDir}\scripts\run.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#RepoDir}\scripts\i18n.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
; Root files
Source: "{#RepoDir}\install.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\run.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\install.sh"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\run.sh"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\LICENÇA"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoDir}\VERSION"; DestDir: "{app}"; Flags: ignoreversion
; Documentation
Source: "{#RepoDir}\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\data"
Name: "{app}\data\model-cache"
Name: "{app}\data\uploads"
Name: "{app}\data\llama-server"

[Icons]
Name: "{group}\My AI Playground"; Filename: "{app}\run.cmd"; IconFilename: "{app}\frontend\public\favicon.ico"; WorkingDir: "{app}"
Name: "{group}\Setup Dependencies"; Filename: "{app}\install.cmd"; IconFilename: "{app}\frontend\public\favicon.ico"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,My AI Playground}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\My AI Playground"; Filename: "{app}\run.cmd"; IconFilename: "{app}\frontend\public\favicon.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\install.cmd"; Description: "Run initial setup (install dependencies)"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent unchecked
