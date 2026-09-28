#if TEST_BUILD
using System.Windows;
using System.Windows.Controls;

namespace MdTracker;

/// The test build runs only while the server accepts its password (changed on the server, checked at every start),
/// so a copy that leaks stops working as soon as the password changes.
internal static class TestGate
{
    public static bool Unlock(Store store, Api api)
    {
        var key = store.Config.TestKey ?? "";
        var note = "";
        while (true)
        {
            if (key.Length > 0)
            {
                var ok = api.TestUnlock(key);
                if (ok == true)
                {
                    if (store.Config.TestKey != key) { store.Config.TestKey = key; store.SaveConfig(); }
                    return true;
                }
                if (ok == null)
                {
                    MessageBox.Show("서버에 연결할 수 없어 테스트 빌드를 켤 수 없습니다.", "YGO Decks 레코더 (테스트 빌드)", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return false;
                }
                note = "비밀번호가 맞지 않습니다.";
            }
            var entered = Ask(note);
            if (entered == null) return false;
            key = entered.Trim();
        }
    }

    private static string? Ask(string note)
    {
        var box = new PasswordBox { Margin = new Thickness(0, 8, 0, 0), Padding = new Thickness(6, 4, 6, 4) };
        var ok = new Button { Content = "확인", IsDefault = true, Padding = new Thickness(16, 6, 16, 6), Margin = new Thickness(0, 12, 8, 0) };
        var cancel = new Button { Content = "닫기", IsCancel = true, Padding = new Thickness(16, 6, 16, 6), Margin = new Thickness(0, 12, 0, 0) };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        buttons.Children.Add(ok); buttons.Children.Add(cancel);
        var panel = new StackPanel { Margin = new Thickness(20) };
        panel.Children.Add(new TextBlock { Text = "테스트 빌드 비밀번호를 입력하세요." });
        if (note.Length > 0) panel.Children.Add(new TextBlock { Text = note, Foreground = System.Windows.Media.Brushes.Firebrick, Margin = new Thickness(0, 6, 0, 0) });
        panel.Children.Add(box);
        panel.Children.Add(buttons);
        var w = new Window
        {
            Title = "YGO Decks 레코더 (테스트 빌드)", Content = panel, SizeToContent = SizeToContent.WidthAndHeight,
            MinWidth = 320, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterScreen,
        };
        ok.Click += (_, _) => w.DialogResult = true;
        w.Loaded += (_, _) => box.Focus();
        return w.ShowDialog() == true ? box.Password : null;
    }
}
#endif
