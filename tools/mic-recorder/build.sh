#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
BT=~/opt/android-sdk/build-tools/36.0.0; JAR=~/opt/android-sdk/platforms/android-36/android.jar
rm -rf out && mkdir -p out/classes out/dex
$BT/aapt2 link -o out/base.apk -I $JAR --manifest AndroidManifest.xml
javac -source 11 -target 11 -classpath $JAR -d out/classes $(find src -name '*.java') 2>&1 | grep -v warning || true
$BT/d8 --lib $JAR --min-api 30 --output out/dex $(find out/classes -name '*.class')
cp out/base.apk out/unsigned.apk && (cd out/dex && zip -q ../unsigned.apk classes.dex)
$BT/zipalign -f 4 out/unsigned.apk out/aligned.apk
[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android -alias d -keyalg RSA -dname CN=mt -validity 10000 >/dev/null 2>&1
$BT/apksigner sign --ks debug.keystore --ks-pass pass:android --out out/rec.apk out/aligned.apk
echo built out/rec.apk
