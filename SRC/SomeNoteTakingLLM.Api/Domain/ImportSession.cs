namespace SomeNoteTakingLLM.Api.Domain;

/// <summary>
/// Sessão de importação persistida em banco.
/// Permite retomar estado e progresso entre reinicializações da API.
/// </summary>
public sealed class ImportSession
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }

    public string Status { get; set; } = "extracting"; // extracting | ready | converting | importing | done | error
    public string CurrentStage { get; set; } = "extract"; // extract | convert | import | finalize
    public int ProgressCurrent { get; set; }
    public int ProgressTotal { get; set; }
    public int ConvertedFiles { get; set; }
    public int NotesCreated { get; set; }
    public int TotalFiles { get; set; }
    public int HtmlFiles { get; set; }
    public int ImageFiles { get; set; }

    public string? ExtractDir { get; set; }
    public string? OllamaUrl { get; set; }
    public string? OllamaModel { get; set; }
    public string? ErrorMessage { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime LastHeartbeatUtc { get; set; }
    public DateTime ExpiresAt { get; set; }

    public List<ImportSessionFile> Files { get; set; } = new();
}

/// <summary>
/// Arquivo de uma sessão de importação, com status individual para o progresso real.
/// </summary>
public sealed class ImportSessionFile
{
    public Guid Id { get; set; }
    public Guid ImportSessionId { get; set; }
    public ImportSession? ImportSession { get; set; }

    public string RelativePath { get; set; } = string.Empty;
    public string FileType { get; set; } = "other"; // html | md | image | other
    public string Status { get; set; } = "pending"; // pending | converting | converted | skipped | error
    public Guid? ImportedNoteId { get; set; }
    public string? ImportedNoteTitle { get; set; }
    public string? ErrorMessage { get; set; }
    public string PathHash { get; set; } = string.Empty;
}