<#
.SYNOPSIS
    Build multi-arch Docker images (linux/amd64 + linux/arm64) para api e web.

.PARAMETER Push
    Faz push para o registry apos o build.

.PARAMETER Registry
    Prefixo do registry. Ex: "docker.io/seu-usuario" ou "ghcr.io/seu-usuario".

.PARAMETER Tag
    Tag das imagens. Default: "latest".

.PARAMETER Load
    Faz load da imagem localmente (single-platform, para testes).
    Nao pode ser combinado com -Push.

.EXAMPLE
    # Build local para testes (apenas a plataforma nativa):
    .\build-multiarch.ps1 -Load

    # Build multi-arch e push para Docker Hub:
    .\build-multiarch.ps1 -Push -Registry "docker.io/meu-usuario"

    # Build multi-arch e push com tag especifica:
    .\build-multiarch.ps1 -Push -Registry "ghcr.io/meu-usuario" -Tag "v1.0.0"
#>
param(
    [switch]$Push,
    [switch]$Load,
    [string]$Registry = "",
    [string]$Tag = "latest"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $PSScriptRoot
$BUILDER = "sntllm-multiarch"
$PLATFORMS = "linux/amd64,linux/arm64"

$API_CONTEXT  = Join-Path $ROOT "SRC\SomeNoteTakingLLM.Api"
$WEB_CONTEXT  = Join-Path $ROOT "SRC\sntllm-web"

function Get-ImageName([string]$Name) {
    if ($Registry) { return "${Registry}/${Name}:${Tag}" }
    return "${Name}:${Tag}"
}

# ── Validação de argumentos ──────────────────────────────────────────────────
if ($Push -and $Load) {
    Write-Error "Use -Push OU -Load, nao ambos."
    exit 1
}

if ($Push -and -not $Registry) {
    Write-Error "Informe -Registry ao usar -Push. Ex: -Registry 'docker.io/seu-usuario'"
    exit 1
}

# ── Garante builder dedicado ─────────────────────────────────────────────────
Write-Host "`n[builder] Verificando builder '${BUILDER}'..." -ForegroundColor Cyan

$existingBuilders = docker buildx ls 2>&1 | Select-String $BUILDER
if (-not $existingBuilders) {
    Write-Host "[builder] Criando builder multi-platform..." -ForegroundColor Yellow
    docker buildx create --name $BUILDER --driver docker-container --bootstrap
} else {
    Write-Host "[builder] Builder ja existe." -ForegroundColor Green
}

docker buildx use $BUILDER

# ── Build API ────────────────────────────────────────────────────────────────
$API_IMAGE = Get-ImageName "sntllm-api"
Write-Host "`n[api] Build ${API_IMAGE} para ${PLATFORMS}..." -ForegroundColor Cyan

$buildArgs = @(
    "buildx", "build",
    "--platform", $PLATFORMS,
    "--tag", $API_IMAGE,
    $API_CONTEXT
)

if ($Push)   { $buildArgs += "--push" }
if ($Load)   { $buildArgs += "--load"; $buildArgs[2] = "--platform"; $buildArgs[3] = "linux/amd64" }

docker @buildArgs
if ($LASTEXITCODE -ne 0) { Write-Error "[api] Build falhou."; exit 1 }

# ── Build Web ────────────────────────────────────────────────────────────────
$WEB_IMAGE = Get-ImageName "sntllm-web"
Write-Host "`n[web] Build ${WEB_IMAGE} para ${PLATFORMS}..." -ForegroundColor Cyan

$buildArgs = @(
    "buildx", "build",
    "--platform", $PLATFORMS,
    "--tag", $WEB_IMAGE,
    $WEB_CONTEXT
)

if ($Push)   { $buildArgs += "--push" }
if ($Load)   { $buildArgs += "--load"; $buildArgs[2] = "--platform"; $buildArgs[3] = "linux/amd64" }

docker @buildArgs
if ($LASTEXITCODE -ne 0) { Write-Error "[web] Build falhou."; exit 1 }

# ── Resumo ───────────────────────────────────────────────────────────────────
Write-Host "`n✔ Build concluido!" -ForegroundColor Green
Write-Host "  api : ${API_IMAGE}"
Write-Host "  web : ${WEB_IMAGE}"
if ($Push) { Write-Host "  Imagens enviadas para: ${Registry}" -ForegroundColor Cyan }
if ($Load) { Write-Host "  Imagens carregadas localmente (linux/amd64)." -ForegroundColor Yellow }
