using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace MdTracker;

/// Side card pinned to the game window while a duel runs: opponent deck read, my record, clocks, and every card the
/// opponent has shown, by zone. My own deck is a separate pop-up beside the cursor (DeckPopupWindow).
public partial class LiveWindow : Window
{
    private bool _dragged;
    private string _stripKey = "";

    private static readonly Brush Muted = new SolidColorBrush(Color.FromRgb(107, 114, 128));

    public LiveWindow()
    {
        InitializeComponent();
        OverlayScale.Apply(this);
        Full.Width = Math.Clamp(App.Tracker.Store.Config.LiveCardW, 180, 520);
        Loaded += (_, _) => Place();
    }

    // corner grip: width only; height follows the content
    private void Grip_DragDelta(object sender, System.Windows.Controls.Primitives.DragDeltaEventArgs e)
    {
        Full.Width = Math.Clamp(Full.Width + e.HorizontalChange, 180, 520);
    }
    private void Grip_DragCompleted(object sender, System.Windows.Controls.Primitives.DragCompletedEventArgs e)
    {
        App.Tracker.Store.Config.LiveCardW = Full.Width;
        App.Tracker.Store.SaveConfig();
    }

    // The − / + button folds just the opponent's card lists; the header lines stay. Kept for the rest of the session.
    private static bool s_minimized;
    private bool _full = true;
    private void Minimize_Click(object sender, RoutedEventArgs e) { s_minimized = !s_minimized; ApplyMinimized(); }
    private void ApplyMinimized()
    {
        StripRows.Visibility = _full && !s_minimized ? Visibility.Visible : Visibility.Collapsed;
        MinBtn.Content = s_minimized ? "+" : "−";
        MinBtn.Visibility = _full ? Visibility.Visible : Visibility.Collapsed;
        Dispatcher.BeginInvoke(Place, System.Windows.Threading.DispatcherPriority.Loaded);
    }

    /// full=false is the record-only mode: no card lists, no opponent clock estimate.
    public void Update(LiveDuel s, bool full = true)
    {
        SyncVisibility(this);
        if (_full != full || (StripRows.Visibility == Visibility.Visible) != (full && !s_minimized)) { _full = full; ApplyMinimized(); }
        StripHead.Text = $"vs {s.OppName}";
        StripTurn.Text = s.Turn == 0 ? "듀얼 시작" : $"{s.Turn}턴 · {(s.TurnMe ? "내 턴" : "상대 턴")}";
        if (full && s.Turn > 0 && s.MySecLeft > 0) StripTurn.Text += $" · 상대 남은 시간 {s.OppSecLeft}초";   // my own clock is on screen already
        var top2 = s.OppCandidates.Take(2).Select(c => $"{c.Name} {Math.Round(c.Share * 100)}%").ToList();
        bool anyOpp = s.Cards.Any(c => !c.Me);
        StripDeck.Text = top2.Count > 0 ? string.Join(" · 또는 ", top2) : anyOpp ? "판독 중…" : "아직 공개된 카드 없음";
        StripMatchup.Text = s.MatchupText ?? (top2.Count > 0 ? "이 매치업은 첫 대결" : "");
        StripMatchup.Visibility = StripMatchup.Text.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
        if (full) Fill(StripRows, OppRows(s), ref _stripKey, "상대가 아직 보여준 카드 없음");
        Place();
    }

    private string Name(LiveDuel s, int id) => s.Names.TryGetValue(s.Base(id), out var n) ? n : $"#{id}";

    /// Rebuilds a row list only when its content changed (keeps the card from flickering every tick).
    public static void Fill(StackPanel target, List<Row> rows, ref string lastKey, string emptyText)
    {
        var key = string.Join("|", rows.Select(r => $"{r.Id}:{r.Text}:{r.Count}:{r.Header}"));
        if (key == lastKey) return;
        lastKey = key;
        target.Children.Clear();
        foreach (var r in rows)
        {
            if (r.Header)
                target.Children.Add(new TextBlock { Text = r.Text, Foreground = new SolidColorBrush(Color.FromRgb(156, 163, 175)), FontSize = 11, Margin = new Thickness(0, 6, 0, 2) });
            else
            {
                var g = Thumbs.RowElement(r);
                g.Margin = new Thickness(0, 1, 0, 1);
                target.Children.Add(g);
            }
        }
        if (rows.Count == 0) target.Children.Add(new TextBlock { Text = emptyText, Foreground = Muted, Margin = new Thickness(0, 4, 0, 0) });
    }

    /// Main decklist minus every own card seen outside the deck zone → what is still in the deck, in decklist order.
    /// Extra-deck monsters are left out: they never get drawn. Used by the cursor pop-up.
    public static List<Row> MyRows(LiveDuel s)
    {
        var rows = new List<Row>();
        if (s.MyDeckList.Count == 0) return rows;
        var seen = s.Cards.Where(c => c.Me && c.Zone != LiveCard.Deck).GroupBy(c => s.Base(c.Id)).ToDictionary(g => g.Key, g => g.Count());
        var body = new List<Row>();
        foreach (var c in s.MyDeckList)
        {
            if (s.MyExtraIds.Contains(c.Id)) continue;
            int n = Math.Max(0, c.Count - (seen.TryGetValue(c.Id, out var k) ? k : 0));
            body.Add(new Row(c.Id, c.Name, n, Frame: s.Frames.GetValueOrDefault(c.Id, "")));
        }
        rows.Add(new Row(0, "내 덱", 0, true));
        rows.AddRange(body);
        return rows;
    }

    /// What the cursor pop-up should show for the zone the game cursor is on, or null for nothing.
    /// My zones → their contents; an opponent's face-down field card → its name if ever seen; their piles → the list.
    public (string title, List<Row> rows)? HoverRows(LiveDuel s)
    {
        var r = HoverRowsRaw(s);
        if (r == null) return null;
        int total = r.Value.rows.Where(x => !x.Header && x.Count > 0).Sum(x => x.Count);
        return (total > 0 ? $"{r.Value.title} {total}" : r.Value.title, r.Value.rows);   // e.g. "내 묘지 9"
    }

    private (string title, List<Row> rows)? HoverRowsRaw(LiveDuel s)
    {
        if (s.HoverZone < 0) return null;
        List<Row> Rows(IEnumerable<LiveCard> cards) => cards.Where(c => c.Id != 0)
            .GroupBy(c => s.Base(c.Id)).Select(g => new Row(g.Key, Name(s, g.Key), g.Count(), Frame: s.Frames.GetValueOrDefault(g.Key, ""))).ToList();
        if (s.HoverMe)
        {
            var mine = s.Cards.Where(c => c.Me).ToList();
            return s.HoverZone switch
            {
                // my deck and extra deck: the person knows what is in there
                LiveCard.Grave => ("내 묘지", Rows(mine.Where(c => c.Zone == LiveCard.Grave))),
                LiveCard.Banished => ("내 제외", Rows(mine.Where(c => c.Zone == LiveCard.Banished))),
                _ => null,
            };
        }
        var opp = s.Cards.Where(c => !c.Me).ToList();
        if (s.HoverZone <= 12)
        {
            var slot = opp.FirstOrDefault(c => c.Zone == s.HoverZone && c.Index == s.HoverIndex);
            if (slot == null || slot.Face || slot.Id == 0) return null;   // empty, face-up (readable in the game), or never seen
            return ("상대 세트 카드", new() { new Row(s.Base(slot.Id), Name(s, slot.Id), -1, Frame: s.Frames.GetValueOrDefault(s.Base(slot.Id), "")) });   // -1: just the name, no count
        }
        return s.HoverZone switch
        {
            LiveCard.Grave => ("상대 묘지", Rows(opp.Where(c => c.Zone == LiveCard.Grave))),
            LiveCard.Banished => ("상대 제외", Rows(opp.Where(c => c.Zone == LiveCard.Banished))),
            LiveCard.Hand => ("상대 패 (공개된 것)", Rows(opp.Where(c => c.Zone == LiveCard.Hand))),
            LiveCard.Deck => ("상대 덱 (공개된 것)", Rows(opp.Where(c => c.Zone == LiveCard.Deck))),
            LiveCard.ExtraDeck => ("상대 엑스트라 덱 (공개된 것)", Rows(opp.Where(c => c.Zone == LiveCard.ExtraDeck))),
            _ => null,
        };
    }

    /// Everything the opponent has ever shown, by where it is now: hand, deck, extra deck, set cards (only the ones
    /// ever seen), graveyard, banished. Face-up field cards are visible in the game itself.
    private List<Row> OppRows(LiveDuel s)
    {
        var rows = new List<Row>();
        var opp = s.Cards.Where(c => !c.Me).ToList();
        void Section(string title, Func<LiveCard, bool> pick)
        {
            var known = opp.Where(c => c.Id != 0 && pick(c)).ToList();
            if (known.Count == 0) return;
            rows.Add(new Row(0, $"{title} {known.Count}", 0, true));
            foreach (var g in known.GroupBy(c => s.Base(c.Id))) rows.Add(new Row(g.Key, Name(s, g.Key), g.Count(), Frame: s.Frames.GetValueOrDefault(g.Key, "")));
        }
        Section("상대 패", c => c.Zone == LiveCard.Hand);
        Section("상대 덱", c => c.Zone == LiveCard.Deck);
        Section("상대 엑스트라 덱", c => c.Zone == LiveCard.ExtraDeck);
        Section("상대 세트", c => c.Zone <= 12 && !c.Face);
        Section("상대 묘지", c => c.Zone == LiveCard.Grave);
        Section("상대 제외", c => c.Zone == LiveCard.Banished);
        return rows;
    }

    /// Overlays follow the game: hidden while it is minimized or behind another app.
    public static void SyncVisibility(Window w)
    {
        bool show = WinApi.GameInFront();
        if (show && w.Visibility != Visibility.Visible) w.Show();
        else if (!show && w.Visibility == Visibility.Visible) w.Hide();
    }

    /// Where the person last dragged it (saved relative to the game window), else the left edge of the game window
    /// (the right side is where the game stacks its own pop-ups).
    private void Place()
    {
        if (!IsLoaded || _dragged) return;
        var cfg = App.Tracker.Store.Config;
        var rect = OverlayScale.GameRect(this);
        if (rect is { } g)
        {
            Left = g.tl.X + (cfg.LiveCardX ?? 12);
            Top = g.tl.Y + (cfg.LiveCardY ?? (g.br.Y - g.tl.Y) * 0.28);
        }
        else { Left = cfg.LiveCardX ?? 12; Top = cfg.LiveCardY ?? SystemParameters.PrimaryScreenHeight * 0.28; }
    }

    private void Panel_MouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left || e.OriginalSource is not (Border or Panel or TextBlock or Image)) return;
        var before = new Point(Left, Top);
        try { DragMove(); } catch { }
        if (Math.Abs(Left - before.X) > 2 || Math.Abs(Top - before.Y) > 2)
        {
            _dragged = true;
            var cfg = App.Tracker.Store.Config;
            var origin = OverlayScale.GameRect(this)?.tl ?? new Point(0, 0);
            cfg.LiveCardX = Left - origin.X; cfg.LiveCardY = Top - origin.Y;
            App.Tracker.Store.SaveConfig();
        }
    }
}
