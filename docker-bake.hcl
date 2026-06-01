// docker-bake.hcl
// Build multi-arch declarativo para uso em CI/CD ou localmente.
//
// Uso:
//   docker buildx bake --push                    (push para registry)
//   docker buildx bake --set *.tags=ghcr.io/...  (override de tag)

variable "REGISTRY" {
  default = ""
}

variable "TAG" {
  default = "latest"
}

function "image" {
  params = [name]
  result = REGISTRY != "" ? "${REGISTRY}/${name}:${TAG}" : "${name}:${TAG}"
}

group "default" {
  targets = ["api", "web"]
}

target "api" {
  context    = "./SRC/SomeNoteTakingLLM.Api"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  tags       = [image("sntllm-api")]
  cache-from = ["type=registry,ref=${image("sntllm-api")}-cache"]
  cache-to   = ["type=inline"]
}

target "web" {
  context    = "./SRC/sntllm-web"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  tags       = [image("sntllm-web")]
  cache-from = ["type=registry,ref=${image("sntllm-web")}-cache"]
  cache-to   = ["type=inline"]
}
