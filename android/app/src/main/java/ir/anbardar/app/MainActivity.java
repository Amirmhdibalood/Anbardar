package ir.anbardar.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

/**
 * پنجره روی همه نسخه‌های اندروید لبه‌به‌لبه (edge-to-edge) کشیده می‌شود تا فاصله نوارهای سیستم فقط یک بار اعمال شود:
 * افزونه SystemBars کپسیتور (insetsHandling = css) یا با WebView جدید مقدار را به CSS می‌دهد، یا با WebView قدیمی
 * خودش padding بومی می‌گذارد و متغیرهای CSS را صفر می‌کند. بدون این خط، روی اندروید ۱۴ و قدیمی‌تر سیستم هم
 * محتوا را از زیر نوارها کنار می‌کشید و فاصله دو برابر می‌شد (نوار خالی زیر منوی پایین و بالای صفحه).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // قبل از super تا سبک آیکون‌های نوار (روشن/تیره) که SystemBars بعداً تنظیم می‌کند حفظ شود
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // بدون پرده نیمه‌شفاف روی ناوبری سه‌دکمه‌ای؛ رنگ منوی پایین برنامه تا لبه ادامه پیدا می‌کند
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
    }
}
