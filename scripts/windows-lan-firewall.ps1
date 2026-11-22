<#
  Makes a Windows PC safe to host the local stack on a shared Wi-Fi or LAN.

  What it does (all of it reversible with -Undo):
    1. Turns Windows Defender Firewall on for the Domain, Private and Public profiles
       (inbound blocked unless a rule allows it, outbound allowed).
    2. Adds a BLOCK rule for TCP 54321-54327 (the local Supabase stack: API, Postgres,
       Studio, mail catcher, analytics) on Wi-Fi and wired interfaces. A block rule beats
       any allow rule, so a later installer cannot open the database to the network.
       The loopback address and the WSL virtual switch are not touched, so the stack,
       the tests and Docker keep working on this PC.
    3. Adds one ALLOW rule for the app ports (default 4173 and 5173 for the web app, 5741 and
       5751 for the staff and customer Mini Apps) from the local subnet only, on Wi-Fi and
       wired interfaces only. Nothing listens there until you start a server bound to the
       network, for example `pnpm zalo:dev --lan` or `vite preview --host`.

  It does not change the network category (Public stays Public), the router, the IP
  address or any sleep setting.

  Run in an elevated PowerShell (right-click, Run as administrator):
      powershell -ExecutionPolicy Bypass -File scripts\windows-lan-firewall.ps1
  Report only, no change, no admin needed:   ... -Check
  Remove the two rules again (the firewall stays on):   ... -Undo
#>
param(
	[switch]$Check,
	[switch]$Undo,
	[int[]]$AppPorts = @(4173, 5173, 5741, 5751),
	[string]$Log
)

$ErrorActionPreference = 'Stop'
$Group = 'FNB local server'
$BlockName = 'FNB local stack - block from the network (54321-54327)'
$AllowName = 'FNB app ports - local subnet only'

function Say([string]$Text) {
	Write-Host $Text
	if ($Log) { Add-Content -LiteralPath $Log -Value $Text }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Show-State {
	Say '--- Firewall profiles ---'
	Get-NetFirewallProfile | ForEach-Object { Say ("{0,-8} enabled={1} inbound={2}" -f $_.Name, $_.Enabled, $_.DefaultInboundAction) }
	Say '--- Rules of this script ---'
	$rules = Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue
	if ($rules) { $rules | ForEach-Object { Say ("{0} | {1} | {2}" -f $_.DisplayName, $_.Action, $_.Enabled) } } else { Say 'none' }
	Say '--- Reachable beyond this PC? (own LAN address) ---'
	$lan = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*' -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
	if ($lan) {
		foreach ($port in 54321, 54322, 54323) {
			$r = Test-NetConnection -ComputerName $lan -Port $port -WarningAction SilentlyContinue
			Say ("port {0} on the LAN address: {1}" -f $port, $(if ($r.TcpTestSucceeded) { 'OPEN' } else { 'closed' }))
		}
	}
}

if ($Check) { Show-State; return }

if (-not $admin) {
	Say 'This needs an elevated PowerShell (Run as administrator). Nothing was changed.'
	exit 2
}

if ($Undo) {
	Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
	Say 'The two rules are removed. The firewall itself stays on.'
	Show-State
	return
}

Set-NetFirewallProfile -Profile Domain, Private, Public -Enabled True -DefaultInboundAction Block -DefaultOutboundAction Allow
Say 'Firewall is on for Domain, Private and Public.'

Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule -DisplayName $BlockName -Group $Group -Direction Inbound -Action Block `
	-Protocol TCP -LocalPort '54321-54327' -InterfaceType Wired, Wireless -Profile Any | Out-Null
Say 'Blocked: TCP 54321-54327 from Wi-Fi and wired networks.'

New-NetFirewallRule -DisplayName $AllowName -Group $Group -Direction Inbound -Action Allow `
	-Protocol TCP -LocalPort $AppPorts -RemoteAddress LocalSubnet -InterfaceType Wired, Wireless -Profile Any | Out-Null
Say ("Allowed: TCP {0} from the local subnet only." -f ($AppPorts -join ', '))

Show-State
