# glTF Viewer 样式模板

一个仿照 [glTF Viewer](https://gltf-viewer.donmccurdy.com/) 的页面样式模板，提供完整的 UI 结构和基础交互逻辑。

## 样式特性

- 🎨 **精确还原**: 完全仿照原始 glTF Viewer 的视觉设计
- 📱 **响应式布局**: 适配不同屏幕尺寸
- 🎯 **拖拽交互**: 完整的拖拽上传体验
- 📁 **文件选择**: 点击按钮选择文件功能
- 🌙 **深色主题**: 与原始网站一致的深色配色方案
- ⚡ **轻量级**: 只包含样式和基础交互，无复杂功能

## 开始使用

1. 安装依赖:
```bash
npm install
```

2. 启动开发服务器:
```bash
npm run dev
```

3. 构建生产版本:
```bash
npm run build
```

## 使用方法

1. **基础交互**: 
   - 拖拽 .gltf 或 .glb 文件到页面
   - 或点击"Choose file"按钮选择文件
   - 文件选择后会切换到查看器视图

2. **自定义功能**:
   - 在 `src/main.ts` 中的 `loadFile()` 方法中添加您的加载逻辑
   - 使用 `#viewer` 容器来渲染您的 3D 内容
   - 调用 `app.resetToDropZone()` 返回文件选择界面

## 页面结构

- **页眉**: 显示 "glTF Viewer" 标题
- **主内容区**: 拖拽区域和文件选择按钮
- **查看器容器**: 用于显示 3D 内容的区域（默认隐藏）
- **页脚**: 显示版本信息和链接

## 技术栈

- **TypeScript** - 类型安全的 JavaScript
- **Vite** - 快速构建工具
- **CSS3** - 现代样式和动画

## 项目结构

```
src/
├── main.ts          # 基础交互逻辑
├── shaders/         # GLSL 着色器文件（可选）
├── useComposer.ts   # 后处理效果（可选）
└── utils.ts         # 工具函数（可选）

public/
├── draco/           # DRACO 解码器文件（如需要）
├── hdr/             # HDR 环境贴图（如需要）
└── threejs/         # 示例模型文件（如需要）
```

## 自定义开发

1. **添加 Three.js 支持**:
   ```bash
   npm install three @types/three
   ```

2. **在 `loadFile()` 方法中实现您的逻辑**:
   ```typescript
   private loadFile(file: File): void {
     // 您的 Three.js 加载逻辑
     const loader = new GLTFLoader();
     // ...
   }
   ```

3. **使用查看器容器**:
   ```typescript
   // 获取查看器容器
   const viewer = document.getElementById('viewer');
   // 将您的 Three.js 渲染器添加到容器中
   viewer.appendChild(renderer.domElement);
   ```

## 浏览器支持

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+
