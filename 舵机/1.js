const express = require('express');
const rpio = require('rpio');
const app = express();
const port = 3000;

// 物理引脚配置（舵机接物理12引脚 g18）
const SERVO_PIN_PHYSICAL = 12;
rpio.init({
    gpiomem: false,
    mapping: 'physical'
});

// PWM配置（50Hz，适配MG90S）
rpio.open(SERVO_PIN_PHYSICAL, rpio.PWM);
rpio.pwmSetClockDivider(32);
// 重点：根据你的PWM值调整range（2600在12000范围内，无需改）
rpio.pwmSetRange(SERVO_PIN_PHYSICAL, 12000);

// ================= 核心：你的实测PWM值 =================
const PWM_0_DEG = 900;    // 0°对应PWM值
const PWM_90_DEG = 2600;  // 90°对应PWM值
const PWM_180_DEG = 4300; // 180°自动计算（90°+1700，和0°→90°差值一致）

// 角度→PWM映射（精准适配你的舵机）
function angleToPwm(angle) {
    if (angle === 0) return PWM_0_DEG;
    if (angle === 90) return PWM_90_DEG;
    if (angle === 180) return PWM_180_DEG;
    // 中间角度线性计算（比如45°= (2600-900)/2 + 900 = 1750）
    return PWM_0_DEG + (angle / 90) * (PWM_90_DEG - PWM_0_DEG);
}

// 记录当前舵机角度（初始0°）
let currentAngle = 0;
// 初始化：归位到0°
rpio.pwmSetData(SERVO_PIN_PHYSICAL, PWM_0_DEG);

// 跨域+静态文件托管
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});
app.use(express.static(__dirname));

// 正向旋转90°（0°→90° → 90°→180°）
app.get('/servo/rotate/forward', (req, res) => {
    try {
        const newAngle = Math.min(currentAngle + 90, 180);
        if (newAngle === currentAngle) {
            return res.send({ 
                status: 'error', 
                msg: `已到最大角度（${currentAngle}°），无法正向旋转` 
            });
        }
        const targetPwm = angleToPwm(newAngle);
        rpio.pwmSetData(SERVO_PIN_PHYSICAL, targetPwm);
        currentAngle = newAngle;
        
        setTimeout(() => {
            res.send({ 
                status: 'success', 
                msg: `正向旋转90°，当前角度：${currentAngle}°（PWM：${targetPwm}）` 
            });
        }, 200);
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 反向旋转90°（90°→0° → 180°→90°）
app.get('/servo/rotate/backward', (req, res) => {
    try {
        const newAngle = Math.max(currentAngle - 90, 0);
        if (newAngle === currentAngle) {
            return res.send({ 
                status: 'error', 
                msg: `已到最小角度（${currentAngle}°），无法反向旋转` 
            });
        }
        const targetPwm = angleToPwm(newAngle);
        rpio.pwmSetData(SERVO_PIN_PHYSICAL, targetPwm);
        currentAngle = newAngle;
        
        setTimeout(() => {
            res.send({ 
                status: 'success', 
                msg: `反向旋转90°，当前角度：${currentAngle}°（PWM：${targetPwm}）` 
            });
        }, 200);
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 精准归位到0°（用你的实测PWM=900）
app.get('/servo/reset', (req, res) => {
    try {
        // 强制设为900（你的0°PWM值）
        rpio.pwmSetData(SERVO_PIN_PHYSICAL, PWM_0_DEG);
        currentAngle = 0;
        setTimeout(() => {
            res.send({ 
                status: 'success', 
                msg: `舵机已精准归位到0°（PWM：${PWM_0_DEG}）` 
            });
        }, 300);
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 启动服务
app.listen(port, () => {
    console.log(`舵机控制服务已启动（适配你的PWM值）：http:127.0.0.1:${port}`);
    console.log(`0°=PWM${PWM_0_DEG} | 90°=PWM${PWM_90_DEG} | 180°=PWM${PWM_180_DEG}`);
});

// 退出清理
process.on('SIGINT', () => {
    rpio.close(SERVO_PIN_PHYSICAL);
    process.exit();
});