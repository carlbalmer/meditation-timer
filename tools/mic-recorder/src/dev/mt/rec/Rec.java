package dev.mt.rec;
import android.app.*; import android.content.Intent; import android.content.pm.ServiceInfo;
import android.media.*; import android.os.IBinder; import android.util.Log;
import java.io.*;
public class Rec extends Service {
  static final int RATE = 16000;
  volatile boolean running; Thread thread;
  @Override public IBinder onBind(Intent i) { return null; }
  @Override public int onStartCommand(Intent intent, int flags, int id) {
    if (running) return START_NOT_STICKY;
    NotificationManager nm = getSystemService(NotificationManager.class);
    nm.createNotificationChannel(new NotificationChannel("rec", "Recording", NotificationManager.IMPORTANCE_LOW));
    Notification n = new Notification.Builder(this, "rec").setContentTitle("Recording").setSmallIcon(android.R.drawable.ic_btn_speak_now).build();
    startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
    String name = intent != null && intent.getStringExtra("name") != null ? intent.getStringExtra("name") : "rec";
    running = true;
    thread = new Thread(() -> record(name)); thread.start();
    return START_NOT_STICKY;
  }
  void record(String name) {
    AudioManager am = getSystemService(AudioManager.class);
    boolean unprocessed = "true".equals(am.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED));
    int src = unprocessed ? MediaRecorder.AudioSource.UNPROCESSED : MediaRecorder.AudioSource.VOICE_RECOGNITION;
    int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
    AudioRecord rec = new AudioRecord(src, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));
    File dir = getExternalFilesDir(null);
    try (FileOutputStream pcm = new FileOutputStream(new File(dir, name + ".pcm"));
         PrintWriter log = new PrintWriter(new FileWriter(new File(dir, name + ".log")))) {
      log.println("source " + (unprocessed ? "UNPROCESSED" : "VOICE_RECOGNITION") + " rate " + RATE);
      rec.startRecording();
      byte[] buf = new byte[RATE / 5 * 2]; long samples = 0; long lastLog = 0;
      while (running) {
        int n = rec.read(buf, 0, buf.length);
        if (n <= 0) { log.println("read " + n); log.flush(); Thread.sleep(50); continue; }
        pcm.write(buf, 0, n); samples += n / 2;
        long now = System.currentTimeMillis();
        if (now - lastLog >= 5000) { log.println("t " + now + " samples " + samples); log.flush(); pcm.flush(); lastLog = now; }
      }
      log.println("t " + System.currentTimeMillis() + " samples " + samples + " end");
    } catch (Exception e) { Log.e("mtrec", "failed", e); }
    finally { rec.stop(); rec.release(); }
  }
  @Override public void onDestroy() { running = false; try { if (thread != null) thread.join(2000); } catch (InterruptedException e) {} super.onDestroy(); }
}
