; Moonproject-Setup.exe (PLAN C6, C8), built by .github/workflows/windows.yml with Inno Setup 6 from ops/windows/out/stage.
; Installs to Program Files; the data (database, backups, logs) lives in ProgramData\Moonproject and is never removed,
; not on an update and not on uninstall. An update stops the service, replaces the program and starts it again; the
; database is migrated when the server starts.

#define AppVersion GetEnv("MOONPROJECT_VERSION")
#if AppVersion == ""
  #define AppVersion "0.0.0-dev"
#endif
#define Svc "{app}\service\moonproject-service.exe"
#define Data "{commonappdata}\Moonproject"

[Setup]
AppId={{6F1B7C2E-3A9D-4E58-9B41-2D7C5E8A0F13}
AppName=Moonproject
AppVersion={#AppVersion}
AppPublisher=Virtus Garments, Inc.
DefaultDirName={autopf}\Moonproject
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=out
OutputBaseFilename=Moonproject-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Moonproject
CloseApplications=no

[Tasks]
Name: "timezone"; Description: "Set this PC's time zone to Manila (UTC+8). Moonproject dates everything in Manila time."

[Dirs]
Name: "{app}\app\node_modules\@moonproject"
Name: "{#Data}"; Flags: uninsneveruninstall
Name: "{#Data}\data"; Flags: uninsneveruninstall
Name: "{#Data}\backups"; Flags: uninsneveruninstall
Name: "{#Data}\logs"; Flags: uninsneveruninstall

[Files]
Source: "out\stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Run]
; Node strips types only outside node_modules, so @moonproject/shared is a junction to packages\shared.
Filename: "{cmd}"; Parameters: "/c if exist ""{app}\app\node_modules\@moonproject\shared"" rmdir ""{app}\app\node_modules\@moonproject\shared"""; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/c mklink /J ""{app}\app\node_modules\@moonproject\shared"" ""{app}\app\packages\shared"""; Flags: runhidden waituntilterminated; StatusMsg: "Linking the program files..."
; Register the service afresh (an update removes the old registration first), then run it as its own virtual account.
Filename: "{#Svc}"; Parameters: "uninstall"; Flags: runhidden waituntilterminated
Filename: "{#Svc}"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Registering the Moonproject service..."
Filename: "{sys}\sc.exe"; Parameters: "config Moonproject obj= ""NT SERVICE\Moonproject"""; Flags: runhidden waituntilterminated
; Only the service, SYSTEM and Administrators may open the data folder (the database holds the shop's certificate key).
; The rights are set on the folder alone and everything inside inherits them; set file by file, the folder-only flags
; would leave a file with no rights at all.
Filename: "{sys}\icacls.exe"; Parameters: """{#Data}"" /inheritance:r /grant:r ""*S-1-5-18:(OI)(CI)F"" ""*S-1-5-32-544:(OI)(CI)F"" ""NT SERVICE\Moonproject:(OI)(CI)M"" /C /Q"; Flags: runhidden waituntilterminated; StatusMsg: "Protecting the data folder..."
Filename: "{sys}\icacls.exe"; Parameters: """{#Data}\*"" /reset /T /C /Q"; Flags: runhidden waituntilterminated
Filename: "{sys}\icacls.exe"; Parameters: """{app}"" /grant ""NT SERVICE\Moonproject:(OI)(CI)RX"" /C /Q"; Flags: runhidden waituntilterminated
; Open ports 443 (the app) and 80 (the "Join this PC" page; 8080 when another program has 80) on private and domain
; networks only, never on public Wi-Fi.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Moonproject"""; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Moonproject"" dir=in action=allow protocol=TCP localport=443,80,8080 profile=private,domain"; Flags: runhidden waituntilterminated
Filename: "{sys}\tzutil.exe"; Parameters: "/s ""Singapore Standard Time"""; Tasks: timezone; Flags: runhidden waituntilterminated
Filename: "{#Svc}"; Parameters: "start"; Flags: runhidden waituntilterminated; StatusMsg: "Starting Moonproject..."
Filename: "http://localhost/"; Description: "Open the ""Join this PC"" page"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{#Svc}"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{#Svc}"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Moonproject"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewall"
Filename: "{cmd}"; Parameters: "/c rmdir ""{app}\app\node_modules\@moonproject\shared"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveLink"

[Code]
{ An update: stop the running service first, so its files can be replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\service\moonproject-service.exe')) then
    Exec(ExpandConstant('{app}\service\moonproject-service.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
