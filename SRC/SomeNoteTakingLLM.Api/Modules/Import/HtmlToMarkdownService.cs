using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SomeNoteTakingLLM.Api.Modules.Import;

/// <summary>
/// Serviço que converte HTML para Markdown usando Ollama.
/// </summary>
public sealed class HtmlToMarkdownService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<HtmlToMarkdownService> _logger;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public HtmlToMarkdownService(IHttpClientFactory httpClientFactory, ILogger<HtmlToMarkdownService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// Converte conteúdo HTML para Markdown usando o modelo do Ollama.
    /// O prompt instrui o modelo a:
    /// - Preservar todo o conteúdo textual
    /// - Converter links HTML (.html) para referências .md
    /// - Preservar referências a imagens (serão tratadas depois)
    /// - Produzir Markdown limpo e bem formatado
    /// </summary>
    public async Task<string> ConvertHtmlToMarkdownAsync(
        string htmlContent,
        string fileName,
        string ollamaUrl,
        string model,
        CancellationToken cancellationToken = default)
    {
        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(3);

        var prompt = $"""
You are an expert HTML-to-Markdown converter. Convert the following HTML content to clean, well-formatted Markdown.

CRITICAL RULES:
1. Preserve ALL textual content exactly as-is. Do not summarize or omit anything.
2. Convert ALL <a href="..."> links: change any .html extension to .md in the href.
   Example: <a href="other-file.html">link</a> → [link](other-file.md)
   Example: <a href="folder/page.html">link</a> → [link](folder/page.md)
3. Preserve image references as-is: ![alt](path/to/image.png) — do NOT change image paths.
4. Convert headings (<h1>-<h6>), paragraphs, lists, tables, bold, italic, code blocks properly.
5. Remove any remaining HTML tags that don't have Markdown equivalents.
6. Output ONLY the Markdown content — no explanations, no preamble, no "Here is the converted markdown".

File name: {fileName}

HTML CONTENT:
{TruncateHtml(htmlContent)}
""";

        var requestBody = new
        {
            model,
            prompt,
            stream = false,
            options = new { temperature = 0.1, num_predict = 8192 }
        };

        try
        {
            var response = await client.PostAsJsonAsync(
                $"{ollamaUrl.TrimEnd('/')}/api/generate",
                requestBody,
                JsonOpts,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning("Ollama retornou {StatusCode} para {FileName}: {Error}",
                    (int)response.StatusCode, fileName, errorBody);
                return FallbackConvert(htmlContent, fileName);
            }

            var result = await response.Content.ReadFromJsonAsync<OllamaGenerateResponse>(JsonOpts, cancellationToken);
            var markdown = result?.Response?.Trim() ?? "";

            if (string.IsNullOrWhiteSpace(markdown))
            {
                _logger.LogWarning("Ollama retornou resposta vazia para {FileName}, usando fallback", fileName);
                return FallbackConvert(htmlContent, fileName);
            }

            return markdown;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("Timeout do Ollama para {FileName}, usando fallback", fileName);
            return FallbackConvert(htmlContent, fileName);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Erro ao converter {FileName} via Ollama, usando fallback", fileName);
            return FallbackConvert(htmlContent, fileName);
        }
    }

    /// <summary>
    /// Conversão fallback simples: strip de tags HTML básicas e conversão de links.
    /// </summary>
    private static string FallbackConvert(string html, string fileName)
    {
        var sb = new StringBuilder(html);

        // Substitui extensão .html por .md em links
        sb.Replace(".html\"", ".md\"");
        sb.Replace(".html'", ".md'");
        sb.Replace(".HTML\"", ".md\"");
        sb.Replace(".HTM\"", ".md\"");

        // Remove tags HTML comuns preservando conteúdo
        var replacements = new (string from, string to)[]
        {
            ("<h1>", "# "), ("</h1>", "\n\n"),
            ("<h2>", "## "), ("</h2>", "\n\n"),
            ("<h3>", "### "), ("</h3>", "\n\n"),
            ("<h4>", "#### "), ("</h4>", "\n\n"),
            ("<h5>", "##### "), ("</h5>", "\n\n"),
            ("<h6>", "###### "), ("</h6>", "\n\n"),
            ("<p>", ""), ("</p>", "\n\n"),
            ("<br>", "\n"), ("<br/>", "\n"), ("<br />", "\n"),
            ("<li>", "- "), ("</li>", "\n"),
            ("<strong>", "**"), ("</strong>", "**"),
            ("<b>", "**"), ("</b>", "**"),
            ("<em>", "*"), ("</em>", "*"),
            ("<i>", "*"), ("</i>", "*"),
            ("<code>", "`"), ("</code>", "`"),
            ("<pre>", "```\n"), ("</pre>", "\n```\n"),
            ("<blockquote>", "> "), ("</blockquote>", "\n"),
            ("<hr>", "---\n"), ("<hr/>", "---\n"),
            ("<ul>", "\n"), ("</ul>", "\n"),
            ("<ol>", "\n"), ("</ol>", "\n"),
        };

        foreach (var (from, to) in replacements)
        {
            sb.Replace(from, to);
            sb.Replace(from.ToUpperInvariant(), to);
        }

        // Remove tags restantes (simplificado)
        var result = System.Text.RegularExpressions.Regex.Replace(
            sb.ToString(), "<[^>]+>", "");

        // Decodifica entidades HTML comuns
        result = System.Net.WebUtility.HtmlDecode(result);

        // Limpa linhas em branco excessivas
        result = System.Text.RegularExpressions.Regex.Replace(result, @"\n{3,}", "\n\n");

        return result.Trim();
    }

    private static string TruncateHtml(string html, int maxChars = 12000)
    {
        if (html.Length <= maxChars) return html;
        return html[..maxChars] + "\n\n[... content truncated due to length ...]";
    }

    private sealed record OllamaGenerateResponse(
        [property: JsonPropertyName("response")] string? Response
    );
}
