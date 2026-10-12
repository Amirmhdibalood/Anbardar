package ir.anbardar.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

/**
 * پنجره روی همه نسخه‌های اندروید لبه‌به‌لبه (edge-to-edge) است تا فاصله نوارهای سیستم و صفحه‌کلید فقط یک بار
 * اعمال شود: افزونه SystemBars کپسیتور (insetsHandling = css) با WebView جدید مقدار را به CSS می‌دهد و با WebView
 * قدیمی خودش padding بومی می‌گذارد (برای صفحه‌کلید هم همین‌طور).
 *
 * مهم: این کار عمداً بعد از super.onCreate انجام می‌شود. BridgeActivity در super تم AppTheme.NoActionBar را
 * می‌گذارد؛ اگر decor قبل از آن ساخته شود (مثلاً با EdgeToEdge.enable پیش از super) پنجره با تم اسپلش ساخته
 * می‌شد و یک نوار عنوان بومی «انباردار» (ActionBar) ظاهر می‌شد که فاصله صفحه‌کلید را هم دوباره حساب می‌کرد.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // بدون پرده نیمه‌شفاف روی ناوبری سه‌دکمه‌ای؛ رنگ منوی پایین برنامه تا لبه ادامه پیدا می‌کند
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
    }
}
