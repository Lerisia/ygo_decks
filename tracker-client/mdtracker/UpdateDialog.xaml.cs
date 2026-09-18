using System.Windows;

namespace MdTracker;

public partial class UpdateDialog : Window
{
    public UpdateDialog() { InitializeComponent(); }
    private void Yes_Click(object sender, RoutedEventArgs e) { DialogResult = true; Close(); }
    private void Later_Click(object sender, RoutedEventArgs e) { DialogResult = false; Close(); }
}
