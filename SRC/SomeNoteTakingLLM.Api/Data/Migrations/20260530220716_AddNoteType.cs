using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SomeNoteTakingLLM.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNoteType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "NoteType",
                table: "Notes",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NoteType",
                table: "Notes");
        }
    }
}
