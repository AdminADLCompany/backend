<#
.SYNOPSIS
  Daily backup of the ADL server: MongoDB (mongodump), uploads, Caddy CA data and config.env.

.DESCRIPTION
  Creates <BackupRoot>\<yyyy-MM-dd_HHmm>\ containing:
    adlcompany.archive.gz   mongodump --gzip --archive of the application database
    uploads\                copy of LOCAL_UPLOAD_DIR
    caddy\                  copy of Caddy's storage (local CA root.key: keep this drive protected)
    config\config.env       copy of the server configuration (contains secrets)
  Deletes backup folders older than RetentionDays. Exits non-zero on failure so
  Task Scheduler reports it.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File D:\ADLApp\server\deploy\backup-adl.ps1
#>
param(
    [string]$BackupRoot = "E:\ADLBackups",
    [string]$MongoUri = "",
    [string]$UploadDir = "D:\ADLData\uploads",
    [string]$CaddyDir = "D:\ADLData\caddy",
    [string]$ConfigFile = (Join-Path $PSScriptRoot "..\config\config.env"),
    [string]$Mongodump = "mongodump",
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"
$logFile = Join-Path $BackupRoot "backup.log"

function Write-Log([string]$Message) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Output $line
    Add-Content -Path $logFile -Value $line
}

function Copy-Folder([string]$Source, [string]$Target) {
    if (-not (Test-Path $Source)) {
        Write-Log "SKIP  $Source does not exist"
        return
    }
    robocopy $Source $Target /E /R:2 /W:5 /NP /NFL /NDL /NJH /NJS | Out-Null
    # robocopy exit codes 0-7 mean success (8+ are failures)
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $Source (exit $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
    Write-Log "OK    copied $Source"
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

try {
    if (-not $MongoUri -and (Test-Path $ConfigFile)) {
        $line = Select-String -Path $ConfigFile -Pattern '^\s*DB_LOCAL_URI\s*=' | Select-Object -First 1
        if ($line) { $MongoUri = ($line.Line -split '=', 2)[1].Trim().Trim("'").Trim('"') }
    }
    if (-not $MongoUri) { $MongoUri = "mongodb://127.0.0.1:27017/adlcompany" }
    if ($MongoUri -notmatch '^mongodb://(.*@)?(127\.0\.0\.1|localhost)[:/]') {
        throw "Refusing to back up a non-local database URI. Pass -MongoUri explicitly for the local MongoDB."
    }

    $stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
    $dest = Join-Path $BackupRoot $stamp
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Write-Log "START backup to $dest"

    $archive = Join-Path $dest "adlcompany.archive.gz"
    & $Mongodump --uri="$MongoUri" --gzip --archive="$archive" --quiet
    if ($LASTEXITCODE -ne 0) { throw "mongodump failed (exit $LASTEXITCODE)" }
    Write-Log ("OK    mongodump {0:N1} MB" -f ((Get-Item $archive).Length / 1MB))

    Copy-Folder $UploadDir (Join-Path $dest "uploads")
    Copy-Folder $CaddyDir (Join-Path $dest "caddy")

    if (Test-Path $ConfigFile) {
        New-Item -ItemType Directory -Force -Path (Join-Path $dest "config") | Out-Null
        Copy-Item $ConfigFile (Join-Path $dest "config\config.env")
        Write-Log "OK    copied config.env"
    }

    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -Path $BackupRoot -Directory |
        Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' -and $_.CreationTime -lt $cutoff } |
        ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force
            Write-Log "PRUNE $($_.FullName)"
        }

    Write-Log "DONE  backup completed"
    exit 0
}
catch {
    Write-Log "FAIL  $($_.Exception.Message)"
    exit 1
}
