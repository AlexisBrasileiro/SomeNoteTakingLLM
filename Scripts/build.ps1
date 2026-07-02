<#
.SYNOPSIS
    Build local das imagens Docker (api + web) usando docker compose.
    Desabilita attestations SLSA que travam no Docker Desktop.
#>
param(
    [switch]$NoCache,
    [switch]$Down
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT = $PSScriptRoot | Split-Path -Parent

# Força desabilitar attestations no BuildKit (precisa estar no ambiente ANTES de chamar docker)
$env:BUILDX_NO_DEFAULT_ATTESTATIONS = "1"
$env:BUILDKIT_SANDBOX_HOSTNAME = "buildkit"
$env:COMPOSE_DOCKER_CLI_BUILD = "1"

Push-Location $ROOT
try {
    if ($Down) {
        Write-Host "==> Parando containers..." -ForegroundColor Yellow
        docker compose -f docker-compose.build.yml down --remove-orphans 2>&1 | Out-Null
    }

    $buildArgs = @(
        "compose", "-f", "docker-compose.build.yml", "build"
    )
    if ($NoCache) {
        $buildArgs += "--no-cache"
    }

    Write-Host "==> Build api + web (BUILDX_NO_DEFAULT_ATTESTATIONS=1)..." -ForegroundColor Cyan
    $buildResult = & docker @buildArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO NO BUILD:" -ForegroundColor Red
        Write-Host ($buildResult -join "`n")
        throw "Build falhou com codigo $LASTEXITCODE"
    }

    Write-Host "==> Subindo containers..." -ForegroundColor Cyan
    docker compose -f docker-compose.build.yml up -d --remove-orphans 2>&1

    Write-Host "==> Pronto! Servicos:" -ForegroundColor Green
    docker compose -f docker-compose.build.yml ps 2>&1
}
finally {
    Pop-Location
}
