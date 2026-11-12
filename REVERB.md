# 混响（Reverb）功能说明

本仓库基于 MusicFree 官方源码（master @ 拉取时最新）新增「混响」功能，交互参考网易云音乐的「音效 / 混响」。

## 功能

- 播放页封面下方的操作栏新增「音效」图标（喇叭波纹），点击弹出混响面板
- 面板内容：
  - 启用 / 关闭混响
  - 空间预设：原声、录音棚、演唱会、音乐厅、剧院、KTV、房间
  - 混响强度滑块（0 ~ 100%，对湿声电平做线性插值）
- 设置持久化：开关 / 预设 / 强度写入 MMKV，重开 App 自动恢复
- 设备不支持时面板内会提示「当前设备不支持混响效果」

## 实现原理

1. **原生（Android / Kotlin）**：`android/app/src/main/java/fun/upup/musicfree/reverb/`
   - `ReverbModule.kt`：绑定 react-native-track-player 的 `MusicService`，反射拿到
     `QueuedAudioPlayer` 后通过公开的 `getExoPlayer()` 取得 ExoPlayer；
     读取 / 生成 `audioSessionId`，用 `EnvironmentalReverb` 把混响挂到本应用自己的
     音频会话上（只影响本 App，不需要系统权限、不需要 root）。
   - 播放未开始、audioSessionId 尚未生成时会自动重试（最多 20 秒），
     切歌时 JS 侧也会再次触发应用。
   - `ReverbPackage.kt`：注册模块，`MainApplication.kt` 中 `add(ReverbPackage())`。

2. **JS 桥接**：`src/native/reverb/index.ts`（`NativeModules.Reverb`）
3. **核心逻辑**：`src/core/reverb/index.ts`
   - 预设参数（`roomLevel / decayTime / reflectionsLevel / reverbLevel / diffusion ...`）
   - 强度插值、状态（GlobalState）、持久化（PersistStatus）
4. **UI**：`src/components/panels/types/reverbPanel.tsx`，注册在 `panels/types/index.ts`
5. **入口**：`src/pages/musicDetail/components/content/albumCover/operations.tsx`
6. **启动恢复**：`src/entry/bootstrap/bootstrap.ts` 中 `restoreReverb()` + 切歌重应用

## 构建

本机（Windows）没有 Android SDK / NDK，无法直接在此打包。两种方式：

### 方式 A：GitHub Actions（推荐，零本地环境）

1. 把本仓库推到自己 GitHub 的仓库（或 fork）
2. 仓库设置里确认 Actions 可用
3. 手动运行 `Build APK (with Reverb)` workflow（或 push 到 `reverb` 分支）
4. 构建完成后在 Artifacts 下载 `musicfree-reverb-apk`

workflow 会自动生成临时签名（storepass/keypass 均为 `musicfree`），
所以装的时候可能与已安装的官方版冲突，需要先卸载官方版。

### 方式 B：本地有 Android Studio / SDK

需要：JDK 17、Node 20、Android SDK 35、Build-Tools 35.0.0、NDK 26.1.10909125（约 6~8GB 磁盘）。

```bash
npm ci
cd android
./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/*.apk
```

## 签名

CI 使用仓库内固定的**测试签名**（`android/test-signing.b64`，base64 存储的 PKCS12；口令/别名见 workflow）：

- 与官方签名不同 → 安装前必须先卸载官方版（只需一次）
- 每次构建签名完全一致 → 之后的新测试包可以直接覆盖安装，便于迭代测试
- 这是公开的测试密钥，**不要用于正式分发**

## 注意事项

- 混响使用 Android 系统提供的 `EnvironmentalReverb`，不同机型 / 音频 HAL 的支持程度不同，
  部分设备（尤其部分蓝牙耳机链路）可能听不出效果，此时面板会提示不支持。
- 效果挂在 ExoPlayer 的 audioSession 上，重启播放器（冷启动）后由 `restoreReverb()` 重新挂载。
