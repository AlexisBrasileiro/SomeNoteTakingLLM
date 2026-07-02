# Build local (single-platform) com --provenance=false + docker compose build file
# Para build multi-arch (x86 + arm64), use: .\build-multiarch.ps1

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot | Split-Path -Parent
Push-Location $ROOT

try {
    Write-Host "==> Build sntllm-api (--provenance=false)..." -ForegroundColor Cyan
    docker buildx build `
        -f "$ROOT\SRC\SomeNoteTakingLLM.Api\Dockerfile" `
        "$ROOT\SRC\SomeNoteTakingLLM.Api" `
        --tag somenotetakingllm-api:latest `
        --provenance=false `
        --load 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Build api falhou" }

    Write-Host "==> Build sntllm-web (--provenance=false)..." -ForegroundColor Cyan
    docker buildx build `
        -f "$ROOT\SRC\sntllm-web\Dockerfile" `
        "$ROOT\SRC\sntllm-web" `
        --tag somenotetakingllm-web:latest `
        --provenance=false `
        --load 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Build web falhou" }

    Write-Host "==> Subindo containers (docker-compose.build.yml)..." -ForegroundColor Cyan
    docker compose -f docker-compose.build.yml up -d --remove-orphans 2>&1

    Write-Host "==> Pronto!" -ForegroundColor Green
    docker compose -f docker-compose.build.yml ps 2>&1
}
finally {
    Pop-Location
}
