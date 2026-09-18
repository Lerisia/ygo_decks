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
    private double _dragRight;
    private string _stripKey = "";

    private static readonly Brush Muted = new SolidColorBrush(Color.FromRgb(107, 114, 128));

    public LiveWindow()
    {
        InitializeComponent();
        OverlayScale.Apply(this);
        Loaded += (_, _) => Place();
    }

    public void Update(LiveDuel s)
    {
        SyncVisibility(this);
        StripHead.Text = $"vs {s.OppName}";
        StripTurn.Text = s.Turn == 0 ? "듀얼 시작" : $"{s.Turn}턴 · {(s.TurnMe ? "내 턴" : "상대 턴")}";
        if (s.Turn > 0 && s.MySecLeft > 0) StripTurn.Text += $" · 상대 남은 시간 {s.OppSecLeft}초";   // my own clock is on screen already
        var top2 = s.OppCandidates.Take(2).Select(c => $"{c.Name} {Math.Round(c.Share * 100)}%").ToList();
        bool anyOpp = s.Cards.Any(c => !c.Me);
        StripDeck.Text = top2.Count > 0 ? string.Join(" · 또는 ", top2) : anyOpp ? "판독 중…" : "아직 공개된 카드 없음";
        StripMatchup.Text = s.MatchupText ?? (top2.Count > 0 ? "이 매치업은 첫 대결" : "");
        StripMatchup.Visibility = StripMatchup.Text.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
        Fill(StripRows, OppRows(s), ref _stripKey, "상대가 아직 보여준 카드 없음");
        Place();
    }

    private string Name(LiveDuel s, int id) => s.Names.TryGetValue(s.Base(id), out var n) ? n : $"#{id}";

    /// Rebuilds a row list only when its content changed (keeps the card from flickering every tick).
    private static void Fill(StackPanel target, List<(string text, int count, bool header)> rows, ref string lastKey, string emptyText)
    {
        var key = string.Join("|", rows.Select(r => $"{r.text}:{r.count}:{r.header}"));
        if (key == lastKey) return;
        lastKey = key;
        target.Children.Clear();
        foreach (var r in rows)
        {
            if (r.header)
            {
                target.Children.Add(new TextBlock { Text = r.text, Foreground = new SolidColorBrush(Color.FromRgb(156, 163, 175)), FontSize = 11, Margin = new Thickness(0, 6, 0, 2) });
                continue;
            }
            var g = new Grid { Margin = new Thickness(0, 1, 0, 1) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var fg = r.count == 0 ? Muted : Brushes.White;
            var name = new TextBlock { Text = r.text, Foreground = fg, TextTrimming = TextTrimming.CharacterEllipsis };
            var cnt = new TextBlock { Text = r.count.ToString(), Foreground = fg, Margin = new Thickness(8, 0, 0, 0), FontWeight = FontWeights.SemiBold };
            Grid.SetColumn(cnt, 1);
            g.Children.Add(name); g.Children.Add(cnt);
            target.Children.Add(g);
        }
        if (rows.Count == 0) target.Children.Add(new TextBlock { Text = emptyText, Foreground = Muted, Margin = new Thickness(0, 4, 0, 0) });
    }

    /// Main decklist minus every own card seen outside the deck zone → what is still in the deck, in decklist order.
    /// Extra-deck monsters are left out: they never get drawn. Used by the cursor pop-up.
    public static List<(string text, int count, bool header)> MyRows(LiveDuel s)
    {
        var rows = new List<(string, int, bool)>();
        if (s.MyDeckList.Count == 0) return rows;
        var seen = s.Cards.Where(c => c.Me && c.Zone != LiveCard.Deck).GroupBy(c => s.Base(c.Id)).ToDictionary(g => g.Key, g => g.Count());
        var body = new List<(string, int, bool)>();
        foreach (var c in s.MyDeckList)
        {
            if (s.MyExtraIds.Contains(c.Id)) continue;
            int n = Math.Max(0, c.Count - (seen.TryGetValue(c.Id, out var k) ? k : 0));
            body.Add((c.Name, n, false));
        }
        rows.Add(("내 덱", 0, true));
        rows.AddRange(body);
        return rows;
    }

    /// What the cursor pop-up should show for the zone the game cursor is on, or null for nothing.
    /// My deck → remaining cards; an opponent's face-down field card → its name if ever seen; their piles → the list.
    public (string title, List<(string text, int count, bool header)> rows)? HoverRows(LiveDuel s)
    {
        if (s.HoverZone < 0) return null;
        List<(string, int, bool)> Rows(IEnumerable<LiveCard> cards) => cards.Where(c => c.Id != 0)
            .GroupBy(c => s.Base(c.Id)).Select(g => (Name(s, g.Key), g.Count(), false)).ToList();
        if (s.HoverMe)
        {
            var mine = s.Cards.Where(c => c.Me).ToList();
            return s.HoverZone switch
            {
                LiveCard.Deck => ("내 덱", MyRows(s).Where(r => !r.header).ToList()),
                LiveCard.ExtraDeck => ("내 엑스트라 덱", Rows(mine.Where(c => c.Zone == LiveCard.ExtraDeck))),
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
            return ("상대 세트 카드", new() { (Name(s, slot.Id), -1, false) });   // -1: just the name, no count
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

    /// Everything the opponent has ever shown, by where it is now: hand, deck (extra marked), set cards
    /// (known ones by name, the rest as a count), graveyard, banished. Face-up field cards are visible in the game itself.
    private List<(string text, int count, bool header)> OppRows(LiveDuel s)
    {
        var rows = new List<(string, int, bool)>();
        var opp = s.Cards.Where(c => !c.Me).ToList();
        void Section(string title, Func<LiveCard, bool> pick, Func<LiveCard, string>? suffix = null)
        {
            var known = opp.Where(c => c.Id != 0 && pick(c)).ToList();
            if (known.Count == 0) return;
            rows.Add(($"{title} {known.Count}", 0, true));
            foreach (var g in known.GroupBy(c => (id: s.Base(c.Id), tag: suffix?.Invoke(c) ?? "")))
                rows.Add((Name(s, g.Key.id) + g.Key.tag, g.Count(), false));
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

    /// Right edge of the game window, below the opponent's LP strip and card-effect popup, unless dragged elsewhere.
    private void Place()
    {
        if (!IsLoaded) return;
        if (_dragged) { Left = _dragRight - ActualWidth; return; }
        var src = PresentationSource.FromVisual(this);
        var fromDevice = src?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        double right, top;
        if (WinApi.GameWindowRect() is WinApi.RECT r)
        {
            var tl = fromDevice.Transform(new Point(r.Left, r.Top));
            var br = fromDevice.Transform(new Point(r.Right, r.Bottom));
            right = br.X; top = tl.Y + (br.Y - tl.Y) * 0.28;
        }
        else { right = SystemParameters.PrimaryScreenWidth; top = SystemParameters.PrimaryScreenHeight * 0.28; }
        Left = right - ActualWidth - 12;
        Top = top;
    }

    private void Panel_MouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left || e.OriginalSource is not (Border or Panel or TextBlock)) return;
        var before = new Point(Left, Top);
        try { DragMove(); } catch { }
        if (Math.Abs(Left - before.X) > 2 || Math.Abs(Top - before.Y) > 2) { _dragged = true; _dragRight = Left + ActualWidth; }
    }
}
