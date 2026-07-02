namespace SomeNoteTakingLLM.Api.Modules.Import;

// ── Request DTOs ────────────────────────────────────────────────────────────

public sealed record ImportZipRequest(
    Guid? ProjectId,
    Guid? ParentNoteId,
    string? OllamaUrl = null,
    string? OllamaModel = null
);

public sealed record ImportExecuteRequest(
    Guid? ProjectId,
    Guid? ParentNoteId
);

// ── Response DTOs ───────────────────────────────────────────────────────────

public sealed record ImportSessionResponse(
    Guid ImportId,
    string Status, // "extracting" | "converting" | "ready" | "importing" | "done" | "error"
    string Stage,  // "extract" | "convert" | "import" | "finalize"
    int ProgressCurrent,
    int ProgressTotal,
    int TotalFiles,
    int HtmlFiles,
    int ConvertedFiles,
    int ImageFiles,
    int NotesCreated,
    List<ImportFileEntry> Files,
    string? ErrorMessage,
    DateTime? StartedAt,
    DateTime LastHeartbeatUtc,
    DateTime LastUpdatedUtc
);

public sealed record ImportFileEntry(
    string RelativePath,
    string FileType, // "html" | "md" | "image" | "other"
    string Status,   // "pending" | "converting" | "converted" | "skipped" | "error"
    Guid? ImportedNoteId,
    string? ImportedNoteTitle,
    string? ErrorMessage
);

public sealed record ImportResultResponse(
    Guid ImportId,
    string Status,
    int NotesCreated,
    List<ImportFileEntry> Files
);
