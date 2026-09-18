using System.Windows;
using System.Windows.Controls;

namespace MdTracker;

/// Fix a saved record from the recent-games list; the change goes straight to the site. No points are re-awarded.
public partial class EditWindow : Window
{
    private readonly Tracker _t;
    private readonly PendingMatch _m;
    private SiteDeck? _myDeck, _oppDeck;
    private bool _oppUnknown;

    public EditWindow(Tracker t, PendingMatch m)
    {
        InitializeComponent();
        _t = t; _m = m;
        Headline.Text = $"vs {m.OppName}  ·  {(DateTime.TryParse(m.EndedAt, out var e) ? e.ToString("MM-dd HH:mm") : "")}";
        Pick(ResultBox, m.Result == "lose" ? "lose" : "win");
        Pick(CoinBox, m.CoinWin ? "win" : "lose");
        Pick(FirstBox, m.First ? "first" : "second");
        _myDeck = t.Store.Decks.FirstOrDefault(d => d.Name == m.SavedDeckName);
        MyDeckBox.Text = m.SavedDeckName ?? "";
        _oppDeck = t.Store.Decks.FirstOrDefault(d => d.Name == m.SavedOppDeckName);
        _oppUnknown = _oppDeck == null;
        OppDeckBox.Text = _oppDeck?.Name ?? "모름/기타";
        MemoBox.Text = m.Notes ?? "";
    }

    private static void Pick(ComboBox box, string tag)
    {
        foreach (ComboBoxItem it in box.Items) if ((string)it.Tag == tag) { box.SelectedItem = it; return; }
    }
    private static string Tag(ComboBox box) => (string)((ComboBoxItem)box.SelectedItem).Tag;

    private void Search(TextBox box, ListBox list)
    {
        var q = box.Text.Trim();
        if (q.Length == 0 || !box.IsKeyboardFocusWithin) { list.Visibility = Visibility.Collapsed; return; }
        var hits = _t.Store.Decks.Where(d => Hangul.Matches(q, d.Name, d.Aliases)).Take(6).ToList();
        list.ItemsSource = hits; list.DisplayMemberPath = "Name";
        list.Visibility = hits.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }
    private void MyDeckBox_TextChanged(object sender, TextChangedEventArgs e) => Search(MyDeckBox, MyDeckList);
    private void OppDeckBox_TextChanged(object sender, TextChangedEventArgs e) { if (OppDeckBox.IsKeyboardFocusWithin) _oppUnknown = false; Search(OppDeckBox, OppDeckList); }
    private void MyDeckList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (MyDeckList.SelectedItem is SiteDeck d) { _myDeck = d; MyDeckBox.Text = d.Name; MyDeckList.Visibility = Visibility.Collapsed; }
    }
    private void OppDeckList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (OppDeckList.SelectedItem is SiteDeck d) { _oppDeck = d; _oppUnknown = false; OppDeckBox.Text = d.Name; OppDeckList.Visibility = Visibility.Collapsed; }
    }
    private void Unknown_Click(object sender, RoutedEventArgs e) { _oppDeck = null; _oppUnknown = true; OppDeckBox.Text = "모름/기타"; OppDeckList.Visibility = Visibility.Collapsed; }
    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (_myDeck == null || _myDeck.Name != MyDeckBox.Text.Trim()) _myDeck = _t.Store.Decks.FirstOrDefault(d => d.Name == MyDeckBox.Text.Trim()) ?? _myDeck;
        if (!_oppUnknown && (_oppDeck == null || _oppDeck.Name != OppDeckBox.Text.Trim())) _oppDeck = _t.Store.Decks.FirstOrDefault(d => d.Name == OppDeckBox.Text.Trim()) ?? _oppDeck;
        if (_myDeck == null) { Msg.Text = "내 덱을 선택해 주세요"; return; }
        if (_m.MatchId is not int matchId) { Msg.Text = "사이트에 저장된 기록이 아닙니다"; return; }
        SaveBtn.IsEnabled = false; Msg.Text = "";
        string result = Tag(ResultBox), coin = Tag(CoinBox), first = Tag(FirstBox);
        var oppId = _oppUnknown ? null : _oppDeck?.Id;
        var memo = MemoBox.Text.Trim();
        var err = await Task.Run(() =>
        {
            try { _t.Api.UpdateMatch(matchId, _myDeck.Id, oppId, first, result, coin, memo.Length == 0 ? null : memo); return null; }
            catch (UnauthorizedAccessException) { return "로그인이 만료되었습니다"; }
            catch (Exception ex) { return ex.Message; }
        });
        SaveBtn.IsEnabled = true;
        if (err != null) { Msg.Text = "수정 실패: " + err; return; }
        _m.Result = result; _m.CoinWin = coin == "win"; _m.First = first == "first";
        _m.SavedDeckName = _myDeck.Name; _m.SavedOppDeckName = _oppUnknown ? null : _oppDeck?.Name; _m.Notes = memo.Length == 0 ? null : memo;
        _t.Store.Save(_m); _t.NotifyMatchesChanged();
        Close();
    }
}
