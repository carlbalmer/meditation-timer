package dev.mt.rec;
import android.app.Activity; import android.content.Intent; import android.os.Bundle;
public class Main extends Activity {
  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    String cmd = getIntent().getStringExtra("cmd");
    Intent i = new Intent(this, Rec.class);
    if ("stop".equals(cmd)) stopService(i); else { i.putExtra("name", getIntent().getStringExtra("name")); startForegroundService(i); }
    finish();
  }
}
