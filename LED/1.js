const express = require('express');
const rpio = require('rpio');
const app = express();
const port = 3000;

// 修复：删除 mapping: 'bcm'，使用默认物理引脚模式
rpio.init({ 
  gpiomem: true   // 保留这行，兼容旧系统
});

// 修复：替换为物理引脚编号（11=红, 12=绿, 13=蓝）
rpio.open(11, rpio.OUTPUT, rpio.LOW); // 红灯（G17 → 物理11）
rpio.open(12, rpio.OUTPUT, rpio.LOW); // 绿灯（G18 → 物理12）
rpio.open(13, rpio.OUTPUT, rpio.LOW); // 蓝灯（G27 → 物理13）

// 跨域配置（不变）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// 静态文件托管（不变）
app.use(express.static(__dirname));

// 修复：控制逻辑里的引脚号同步替换为物理编号
app.get('/led/:color', (req, res) => {
  const color = req.params.color.toLowerCase();
  try {
    switch(color) {
      case 'red': // 亮红灯
        rpio.write(11, rpio.HIGH);
        rpio.write(12, rpio.LOW);
        rpio.write(13, rpio.LOW);
        res.send({ status: 'success', msg: '红灯已亮' });
        break;
      case 'green': // 亮绿灯
        rpio.write(11, rpio.LOW);
        rpio.write(12, rpio.HIGH);
        rpio.write(13, rpio.LOW);
        res.send({ status: 'success', msg: '绿灯已亮' });
        break;
      case 'blue': // 亮蓝灯
        rpio.write(11, rpio.LOW);
        rpio.write(12, rpio.LOW);
        rpio.write(13, rpio.HIGH);
        res.send({ status: 'success', msg: '蓝灯已亮' });
        break;
      case 'white': // 亮白灯
        rpio.write(11, rpio.HIGH);
        rpio.write(12, rpio.HIGH);
        rpio.write(13, rpio.HIGH);
        res.send({ status: 'success', msg: '白灯已亮' });
        break;
      case 'off': // 关灯
        rpio.write(11, rpio.LOW);
        rpio.write(12, rpio.LOW);
        rpio.write(13, rpio.LOW);
        res.send({ status: 'success', msg: '所有灯已关' });
        break;
      default:
        res.send({ status: 'error', msg: '仅支持 red/green/blue/white/off' });
    }
  } catch (err) {
    res.send({ status: 'error', msg: err.message });
  }
});

// 启动服务（不变）
app.listen(port, () => {
  console.log(`服务已启动：http://树莓派IP:${port}`);
  console.log(`示例：访问 http://树莓派IP:${port}/led/red 亮红灯`);
});

// 修复：退出清理时的引脚号也替换为物理编号
process.on('SIGINT', () => {
  rpio.close(11);
  rpio.close(12);
  rpio.close(13);
  process.exit();
});