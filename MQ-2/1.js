const express = require('express');
const rpio = require('rpio');
const app = express();
const port = 3000; // 和舵机同端口，静态页面分开，无冲突

// ================= 核心配置（物理引脚模式，和舵机完全一致） =================
const MQ2_DO_PIN = 16; // MQ2 DO引脚接树莓派【物理16号】引脚
rpio.init({
    gpiomem: false,
    mapping: 'physical' // 全程物理引脚编码，无换算
});

// 配置MQ2引脚为【输入模式】（读取高低电平）
rpio.open(MQ2_DO_PIN, rpio.INPUT);

// 存储传感器状态
let mq2Status = {
    isAlarm: false, // false=正常，true=超标报警
    statusText: "环境正常（无烟雾/燃气）",
    level: "safe"   // safe=安全，danger=危险
};

// ================= 核心函数：读取MQ2数字信号 =================
function readMQ2Digital() {
    // rpio读取数字引脚：0=低电平（超标），1=高电平（正常）
    const pinValue = rpio.read(MQ2_DO_PIN);
    if (pinValue === 0) {
        mq2Status = {
            isAlarm: true,
            statusText: "⚠️ 检测到烟雾/燃气！浓度超标（危险）",
            level: "danger"
        };
    } else {
        mq2Status = {
            isAlarm: false,
            statusText: "✅ 环境正常（无烟雾/无燃气）",
            level: "safe"
        };
    }
    return mq2Status;
}

// ================= 接口配置 =================
// 跨域（前端访问必备）
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});
// 静态文件托管（前端页面）
app.use(express.static(__dirname));

// 接口1：读取MQ2当前状态
app.get('/mq2/status', (req, res) => {
    const data = readMQ2Digital();
    res.send({ status: 'success', ...data });
});

// ================= 启动服务 =================
app.listen(port, () => {
    console.log('====================================');
    console.log('✅ MQ2纯GPIO读取服务已启动（无ADC模块）');
    console.log(`访问页面：http://树莓派IP:${port}/mq2-digital.html`);
    console.log(`MQ2接物理引脚：${MQ2_DO_PIN}号`);
    console.log('====================================');
});

// 退出清理GPIO
process.on('SIGINT', () => {
    rpio.close(MQ2_DO_PIN);
    console.log('\nMQ2服务已停止，GPIO引脚已清理');
    process.exit();
});