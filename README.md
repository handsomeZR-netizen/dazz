# Dazz Web

胶片风格 Web 相机，主用途是在 OPPO Find X6 上：

- 用 X6 摄像头实时取景，套预设/边框拍照存胶卷
- 把 X6 相册里的已有照片导入应用滤镜（单选实时编辑、多选批量）
- 一键分享到系统盘 → 保存到相册
- 装成 PWA 放在桌面，离线也能套滤镜

## 快速上手

```bash
npm install
npm run dev      # 自签 HTTPS dev server
npm run build    # 生产构建（dist/ 含 manifest + sw）
npm run preview  # 预览构建产物
```

首次 `npm run dev` 时 `vite-plugin-mkcert` 会让 Windows 弹一次"信任本地证书"。同意后局域网内 X6 也能用同一 ip 访问（`getUserMedia` 必须 secure context）。

## X6 真机使用

1. 电脑跑 `npm run dev` 后，输出里会显示局域网 IP，如 `https://192.168.x.x:5173/`。
2. 在 X6 Chrome 里打开该 URL，第一次访问会因自签证书警告 → 点"高级 → 继续访问"。
3. 授权摄像头权限。
4. Chrome 菜单 → "添加到主屏" 即可装成 PWA，下次直接从桌面图标启动。
5. 离线模式仍能：切预设、看相册、给已导入的图套滤镜（实时摄像头需要 stream，无法离线）。

## 主要功能

- **胶片预设**：NC（怀旧）/ FX（电影）/ G（黑白颗粒）/ D（一次性）。预设条横向滚动，左右滑取景器或方向键切换。
- **边框**：无 / 35mm 胶片 / 拍立得 / 方画幅。点取景器右上的方框图标循环切换。
- **特效**（仅 GL 路径）：光晕（Halation）/ 鱼眼（Fisheye）/ 闪光（Flash，待发射模式）。
- **强度**：100 / 70 / 40 / OFF 四档循环。
- **从相册导入**：顶栏图片图标 → 单选进入实时编辑模式（按快门保存，再点切回相机）；多选则进入批量队列，逐张套当前预设入胶卷。
- **胶卷**：左下缩略图 → 相册网格；点单张进详情可下载、用 Web Share API 分享/保存到系统相册、删除；右上图标导出全部为 zip。
- **显影动画**：NC 1.5s / D 3s 显影延时，缩略图 / 详情 / 网格三处都有渐显效果。

## 项目结构

```
src/
  main.js               入口 / DOM 绑定 / drawFrame 主循环
  source.js             cameraSource / imageSource，统一渲染源
  batch.js              批量导入离屏渲染管线
  capture.js            单张拍照（边框合成 + 水印 + 入库）
  camera.js             getUserMedia + resizeCanvas
  borders.js            4 种边框 + 水印烘焙
  presets/{nc,fx,g,d,curves,index}.js
  renderer/{gl,cpu,shaders,noise,index}.js  统一接口 { setSize, setPreset, draw }
  gallery/{db,zip}.js   IndexedDB 胶卷 + STORE-mode ZIP
  ui/                   preset-strip / fx-drawer / album / toast
  input/                gestures / keyboard
  utils/                date / frame
styles/                  按区块拆分，由 index.css 串联
public/icons/            PWA 图标
```

## 路线图

详见 `C:/Users/86151/.claude/plans/github-oppofind-x6-melodic-crane.md`：

- ✅ P0-1 从相册导入图片应用滤镜
- ✅ P0-3 批量导入套用滤镜
- ✅ P0-4 Web Share 保存到设备相册
- ✅ P0-5 PWA 安装 + 离线
- ⏳ P0-2 预设扩展包（Portra / CineStill 800T / Ektar / Pro 400H / HP5 / Lomo）— 由作者亲自调
- ⏳ P1：滤镜/特效强度滑杆、画幅切换、相册分组、EXIF、拼贴导出
- ⏳ P2：自定义 LUT 编辑器、.cube 导入、视频拍摄、TF.js 风格迁移、自动色彩匹配

## 开发约定

- 渲染器两路径（GL / CPU）共用接口 `{ kind, setSize(w,h), setPreset(p), draw(source, opts) }`。
- 渲染源（video / image）统一走 `cameraSource(video)` / `imageSource(file)`，主循环只读 `currentSource.element` + `intrinsicW/H`。
- 居中裁切由 `utils/frame.js` 的 `centerCrop()` 统一计算，主预览与批量管线共用。
- 不引入运行时框架；状态直接放在 main.js 顶部，复杂度可控。
- HTTPS dev 是硬要求（getUserMedia + Web Share + Service Worker 都需要 secure context）。
