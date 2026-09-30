using System.Text.Json;
using MdTracker;
using Xunit;

public class HangulTests
{
    public record Case(string query, string name, string[]? aliases, bool expect);

    public static IEnumerable<object[]> SharedCases()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "deckSearchCases.json")));
        foreach (var c in doc.RootElement.GetProperty("cases").EnumerateArray())
            yield return new object[] { c.Deserialize<Case>()! };
    }

    [Theory]
    [MemberData(nameof(SharedCases))]
    public void MatchesLikeTheSite(Case c) =>
        Assert.Equal(c.expect, Hangul.Matches(c.query, c.name, c.aliases ?? Array.Empty<string>()));

    [Fact]
    public void ExpandsCompoundJamo() => Assert.Equal("ㅋㄹㅌ", Hangul.ExpandCompoundJamo("ㅋㄾ"));
}
