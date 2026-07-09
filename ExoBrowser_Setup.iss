; ═══════════════════════════════════════════════════════════════════════════════
;  Exo Browser — Inno Setup Script
;  © 2026 Ex0 Studios
;
;  Požadavky:
;   • Inno Setup 6.3+ (https://jrsoftware.org/isdl.php)
;   • Složka dist\win-unpacked\ musí existovat (výstup z electron-builder --dir)
;   • build-assets\icon.ico          — ikona aplikace (256×256 px, multi-res)
;   • build-assets\banner_side.bmp   — boční banner 164×314 px (wizard sidebar)
;   • build-assets\header_top.bmp    — horní banner 497×58 px (wizard header)
;   • build-assets\LICENSE.txt       — licenční text
; ═══════════════════════════════════════════════════════════════════════════════

#define AppName       "Exo Browser"
#define AppVersion    "1.1.0"
#define AppPublisher  "Ex0 Studios"
#define AppURL        "https://discord.gg/b5B9tzHNEv"
#define AppExeName    "ExoBrowser.exe"
#define AppId         "{{A7B3C2D1-4E5F-6789-ABCD-EF0123456789}"
#define SourceDir     "dist\win-unpacked"

; ── Základní metadata ──────────────────────────────────────────────────────────
[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
AppCopyright=Copyright © 2026 Ex0 Studios

; Výchozí instalační složka
DefaultDirName={autopf}\{#AppPublisher}\{#AppName}
DefaultGroupName={#AppPublisher}\{#AppName}

; Povinný souhlas s licencí před instalací
LicenseFile=build-assets\LICENSE.txt

; Výstupní soubor instalátoru
OutputDir=installer-output
OutputBaseFilename=Exo-Browser_Setup_v{#AppVersion}

; Ikony
SetupIconFile=build-assets\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}

; ── Moderní vizuální styl ──────────────────────────────────────────────────────
; Inno Setup 6+ automaticky používá moderní Windows 10/11 UI.
; Boční banner (164×314 px BMP) a horní header (497×58 px BMP):
WizardImageFile=build-assets\banner_side.bmp
WizardSmallImageFile=build-assets\header_top.bmp
WizardStyle=modern
WizardSizePercent=120

; ── Komprese & bezpečnost ───────────────────────────────────────────────────────
Compression=lzma2/ultra64
SolidCompression=yes
InternalCompressLevel=ultra64

; ── Windows požadavky ──────────────────────────────────────────────────────────
MinVersion=10.0.17763
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

; ── Misc ───────────────────────────────────────────────────────────────────────
ShowLanguageDialog=no
LanguageDetectionMethod=locale
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
CloseApplications=yes
CloseApplicationsFilter=*{#AppExeName}*
RestartIfNeededByRun=no
DisableProgramGroupPage=yes
DisableWelcomePage=no
DisableReadyPage=no

; ── Registrační metadata (Přidat/Odebrat programy) ────────────────────────────
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoCopyright=Copyright © 2026 Ex0 Studios

; ── Jazyky ─────────────────────────────────────────────────────────────────────
[Languages]
Name: "czech"; MessagesFile: "compiler:Languages\Czech.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

; ── Úlohy (zástupci) ───────────────────────────────────────────────────────────
[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}";       GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "startmenu";   Description: "Přidat do nabídky Start";      GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "pinTaskbar";  Description: "Připnout na hlavní panel";      GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

; ── Soubory ────────────────────────────────────────────────────────────────────
[Files]
; Celý výstup electron-builder (win-unpacked)
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Licenční soubor do instalační složky
Source: "build-assets\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

; ── Zástupci ───────────────────────────────────────────────────────────────────
[Icons]
; Plocha
Name: "{autodesktop}\{#AppName}";                   Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon
; Nabídka Start
Name: "{group}\{#AppName}";                          Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Tasks: startmenu
Name: "{group}\Odinstalovat {#AppName}";             Filename: "{uninstallexe}";      IconFilename: "{app}\{#AppExeName}"; Tasks: startmenu

; ── Spuštění po instalaci ──────────────────────────────────────────────────────
[Run]
Filename: "{app}\{#AppExeName}"; Description: "Spustit {#AppName}"; Flags: nowait postinstall skipifsilent

; ── Registr ────────────────────────────────────────────────────────────────────
[Registry]
; Přidat/Odebrat programy — rozšířené info
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1"; ValueType: string; ValueName: "DisplayName";          ValueData: "{#AppName}";      Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1"; ValueType: string; ValueName: "Publisher";            ValueData: "{#AppPublisher}"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1"; ValueType: string; ValueName: "DisplayVersion";       ValueData: "{#AppVersion}";   Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1"; ValueType: string; ValueName: "URLInfoAbout";         ValueData: "{#AppURL}";       Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1"; ValueType: string; ValueName: "HelpLink";             ValueData: "{#AppURL}";       Flags: uninsdeletevalue

; Uložení installation path pro budoucí použití
Root: HKCU; Subkey: "Software\{#AppPublisher}\{#AppName}"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletevalue uninsdeletekeyifempty

; ── Mazání při odinstalaci ─────────────────────────────────────────────────────
[UninstallDelete]
Type: filesandordirs; Name: "{app}"
Type: dirifempty;     Name: "{autopf}\{#AppPublisher}"

; ── Vlastní zprávy ─────────────────────────────────────────────────────────────
[CustomMessages]
czech.WelcomeLabel1=Vítejte v instalaci [name]!
czech.WelcomeLabel2=Tento průvodce nainstaluje [name/ver] do vašeho počítače.%n%nDoporučujeme zavřít všechny spuštěné aplikace před pokračováním.
czech.FinishedHeadingLabel=Instalace [name] dokončena
czech.FinishedLabelNoIcons=[name] byl úspěšně nainstalován do vašeho počítače.
czech.FinishedLabel=[name] byl úspěšně nainstalován. Aplikaci můžete spustit pomocí nainstalovaných zástupců.

; ── Pascal Script — UI přizpůsobení ────────────────────────────────────────────
[Code]
// Přidání vlastního textu na Welcome stránku (studio tagline)
procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel2.Caption :=
    'Vítejte v instalaci Exo Browser od Ex0 Studios.' + #13#10 + #13#10 +
    'Exo je moderní, minimalistický prohlížeč s integrovaným' + #13#10 +
    'AI agentem (Google Gemini), privacy štítem a herním panelem.' + #13#10 + #13#10 +
    'Verze: 1.0.0   |   © 2026 Ex0 Studios' + #13#10 + #13#10 +
    'Kliknutím na Další pokračujte v instalaci.';
end;

// Kontrola Windows 10+
function InitializeSetup(): Boolean;
var
  Version: TWindowsVersion;
begin
  GetWindowsVersionEx(Version);
  if Version.Major < 10 then
  begin
    MsgBox(
      'Exo Browser vyžaduje Windows 10 nebo novější.' + #13#10 +
      'Instalace bude ukončena.',
      mbError, MB_OK
    );
    Result := False;
  end else
    Result := True;
end;

// Čistý uninstall — nabídne restart pokud je .exe zamčený
function InitializeUninstall(): Boolean;
begin
  Result := True;
end;
