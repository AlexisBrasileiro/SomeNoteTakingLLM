using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Data;

public sealed class SomeNoteTakingLlmDbContext : DbContext
{
    public SomeNoteTakingLlmDbContext(DbContextOptions<SomeNoteTakingLlmDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(user => user.Id);
            entity.Property(user => user.UserName).HasMaxLength(100).IsRequired();
            entity.Property(user => user.Email).HasMaxLength(320).IsRequired();
            entity.Property(user => user.PasswordHash).HasMaxLength(500).IsRequired();
            entity.Property(user => user.Role).HasConversion<int>();

            entity.HasMany(user => user.Projects)
                .WithOne(project => project.Owner)
                .HasForeignKey(project => project.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(user => user.Notes)
                .WithOne(note => note.Owner)
                .HasForeignKey(note => note.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Project>(entity =>
        {
            entity.HasKey(project => project.Id);
            entity.Property(project => project.Name).HasMaxLength(200).IsRequired();
            entity.Property(project => project.Description).HasMaxLength(1000);

            entity.HasMany(project => project.Notes)
                .WithOne(note => note.Project)
                .HasForeignKey(note => note.ProjectId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Note>(entity =>
        {
            entity.HasKey(note => note.Id);
            entity.Property(note => note.Title).HasMaxLength(200);
            entity.Property(note => note.Content).HasColumnType("longtext");
            entity.Property(note => note.Depth).HasDefaultValue(0);
            entity.Property(note => note.NoteType).HasConversion<int>().HasDefaultValue(NoteType.FreeNote);

            entity.HasOne(note => note.ParentNote)
                .WithMany(note => note.SubNotes)
                .HasForeignKey(note => note.ParentNoteId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(note => note.OwnerId);
            entity.HasIndex(note => note.ProjectId);
            entity.HasIndex(note => note.ParentNoteId);
        });

        modelBuilder.Entity<AppSetting>(e =>
        {
            e.HasKey(s => s.Key);
            e.Property(s => s.Key).HasMaxLength(100);
            e.Property(s => s.Value).HasColumnType("longtext");
        });

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Role).HasMaxLength(20).IsRequired();
            entity.Property(m => m.Content).HasColumnType("longtext").IsRequired();
            entity.Property(m => m.ReferencesJson).HasColumnType("longtext");
            entity.HasOne(m => m.ChatNote)
                  .WithMany()
                  .HasForeignKey(m => m.ChatNoteId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(m => m.ChatNoteId);
        });
    }
}