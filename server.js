const express = require('express');
const rpio = require('rpio');
const app = express();
const port = 3000;

// ==================== Spug推送配置 ====================
const SPUG_API_URL = 'https://push.spug.cc/send/Lo5Ngm7nwn8GRAW0';
const SPUG_PHONE = '13572548672';
let spugAlertSent = false; // 防止重复发送警报

// 调用Spug接口发送警报
async function sendSpugAlert() {
    if (spugAlertSent) {
        console.log('警报已发送，跳过重复发送');
        return;
    }
    
    try {
        const response = await fetch(SPUG_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                targets: SPUG_PHONE
            })
        });
        
        const result = await response.json();
        console.log('Spug警报发送成功:', result);
        spugAlertSent = true;
    } catch (error) {
        console.error('Spug警报发送失败:', error.message);
    }
}

// 重置警报发送标记（当烟雾消除时调用）
function resetSpugAlert() {
    spugAlertSent = false;
}

// ==================== 人脸识别日志配置 ====================
let faceLogs = [];
const MAX_LOGS = 1000; // 最多保存1000条日志

// 添加人脸识别日志
function addFaceLog(logData) {
    const log = {
        id: Date.now(),
        timestamp: new Date().toLocaleString('zh-CN'),
        ...logData
    };
    faceLogs.unshift(log);
    
    // 限制日志数量
    if (faceLogs.length > MAX_LOGS) {
        faceLogs = faceLogs.slice(0, MAX_LOGS);
    }
    
    console.log(`[人脸日志] ${log.status === 'success' ? '✅' : '❌'} ${log.timestamp} - ${log.message}`);
}

// ==================== 黑名单配置 ====================
let blackList = [];
const MAX_BLACKLIST = 100; // 最多保存100个黑名单

// 添加黑名单人脸
function addBlackList(descriptor, name) {
    const item = {
        id: Date.now(),
        name: name || '未知',
        descriptor: descriptor,
        addTime: new Date().toLocaleString('zh-CN')
    };
    blackList.push(item);
    
    // 限制黑名单数量
    if (blackList.length > MAX_BLACKLIST) {
        blackList = blackList.slice(-MAX_BLACKLIST);
    }
    
    console.log(`[黑名单] 已添加: ${name}`);
}

// 检查是否在黑名单中
function checkBlackList(descriptor, threshold = 0.6) {
    for (let item of blackList) {
        const distance = euclideanDistance(descriptor, item.descriptor);
        if (distance < threshold) {
            return {
                isMatch: true,
                item: item,
                distance: distance
            };
        }
    }
    return { isMatch: false };
}

// 计算欧几里得距离
function euclideanDistance(desc1, desc2) {
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
        sum += Math.pow(desc1[i] - desc2[i], 2);
    }
    return Math.sqrt(sum);
}

// 初始化GPIO
rpio.init({
    gpiomem: false,
    mapping: 'physical'
});

// ==================== LED配置 ====================
const LED_RED = 11;
const LED_GREEN = 15;
const LED_BLUE = 13;

rpio.open(LED_RED, rpio.OUTPUT, rpio.LOW);
rpio.open(LED_GREEN, rpio.OUTPUT, rpio.LOW);
rpio.open(LED_BLUE, rpio.OUTPUT, rpio.LOW);

// ==================== 舵机配置 ====================
const SERVO_PIN = 12;
rpio.open(SERVO_PIN, rpio.PWM);
rpio.pwmSetClockDivider(32);
rpio.pwmSetRange(SERVO_PIN, 12000);

const PWM_0_DEG = 900;
const PWM_90_DEG = 2600;
const PWM_180_DEG = 4300;

let currentAngle = 0;
rpio.pwmSetData(SERVO_PIN, PWM_0_DEG);

function angleToPwm(angle) {
    if (angle === 0) return PWM_0_DEG;
    if (angle === 90) return PWM_90_DEG;
    if (angle === 180) return PWM_180_DEG;
    return PWM_0_DEG + (angle / 90) * (PWM_90_DEG - PWM_0_DEG);
}

// ==================== MQ-2配置 ====================
const MQ2_PIN = 16;
rpio.open(MQ2_PIN, rpio.INPUT);

// ==================== 跨域和静态文件 ====================
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static(__dirname));

// ==================== LED控制接口 ====================
app.get('/led/:color', (req, res) => {
    const color = req.params.color.toLowerCase();
    try {
        switch(color) {
            case 'red':
                rpio.write(LED_RED, rpio.HIGH);
                rpio.write(LED_GREEN, rpio.LOW);
                rpio.write(LED_BLUE, rpio.LOW);
                res.send({ status: 'success', msg: '红灯已亮' });
                break;
            case 'green':
                rpio.write(LED_RED, rpio.LOW);
                rpio.write(LED_GREEN, rpio.HIGH);
                rpio.write(LED_BLUE, rpio.LOW);
                res.send({ status: 'success', msg: '绿灯已亮' });
                break;
            case 'blue':
                rpio.write(LED_RED, rpio.LOW);
                rpio.write(LED_GREEN, rpio.LOW);
                rpio.write(LED_BLUE, rpio.HIGH);
                res.send({ status: 'success', msg: '蓝灯已亮' });
                break;
            case 'white':
                rpio.write(LED_RED, rpio.HIGH);
                rpio.write(LED_GREEN, rpio.HIGH);
                rpio.write(LED_BLUE, rpio.HIGH);
                res.send({ status: 'success', msg: '白灯已亮' });
                break;
            case 'off':
                rpio.write(LED_RED, rpio.LOW);
                rpio.write(LED_GREEN, rpio.LOW);
                rpio.write(LED_BLUE, rpio.LOW);
                res.send({ status: 'success', msg: '所有灯已关' });
                break;
            default:
                res.send({ status: 'error', msg: '仅支持 red/green/blue/white/off' });
        }
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// ==================== 舵机控制接口 ====================
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
        rpio.pwmSetData(SERVO_PIN, targetPwm);
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
        rpio.pwmSetData(SERVO_PIN, targetPwm);
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

app.get('/servo/reset', (req, res) => {
    try {
        rpio.pwmSetData(SERVO_PIN, PWM_0_DEG);
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

// ==================== MQ-2传感器接口 ====================
app.get('/mq2/status', (req, res) => {
    try {
        const value = rpio.read(MQ2_PIN);
        const isDanger = value === 0;
        
        // 检测到烟雾时发送Spug警报
        if (isDanger) {
            sendSpugAlert();
        } else {
            // 烟雾消除时重置警报标记
            resetSpugAlert();
        }
        
        res.send({
            status: 'success',
            value: value,
            level: isDanger ? 'danger' : 'safe',
            statusText: isDanger ? '⚠️ 检测到烟雾/燃气！' : '✅ 环境安全',
            alertSent: spugAlertSent
        });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// ==================== 人脸识别日志接口 ====================
// 添加人脸识别日志
app.post('/api/face-log', express.json(), (req, res) => {
    try {
        const { status, message, similarity, gender, age, expression } = req.body;
        
        addFaceLog({
            status,
            message,
            similarity,
            gender,
            age,
            expression
        });
        
        res.send({ status: 'success', msg: '日志添加成功' });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 获取所有人脸识别日志
app.get('/api/face-logs', (req, res) => {
    try {
        const { status, limit } = req.query;
        let logs = [...faceLogs];
        
        // 按状态过滤
        if (status && (status === 'success' || status === 'failed')) {
            logs = logs.filter(log => log.status === status);
        }
        
        // 限制返回数量
        if (limit && !isNaN(limit)) {
            logs = logs.slice(0, parseInt(limit));
        }
        
        res.send({
            status: 'success',
            total: logs.length,
            data: logs
        });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 清除所有人脸识别日志
app.delete('/api/face-logs', (req, res) => {
    try {
        faceLogs = [];
        res.send({ status: 'success', msg: '日志已清除' });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// ==================== 黑名单接口 ====================
// 添加黑名单人脸
app.post('/api/blacklist', express.json(), (req, res) => {
    try {
        const { descriptor, name } = req.body;
        
        if (!descriptor || !Array.isArray(descriptor)) {
            return res.send({ status: 'error', msg: '无效的人脸描述符' });
        }
        
        addBlackList(descriptor, name);
        
        res.send({ 
            status: 'success', 
            msg: `已添加黑名单: ${name || '未知'}`,
            total: blackList.length
        });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 获取黑名单列表
app.get('/api/blacklist', (req, res) => {
    try {
        const { limit } = req.query;
        let list = blackList.map(item => ({
            id: item.id,
            name: item.name,
            addTime: item.addTime,
            descriptor: item.descriptor
        }));
        
        if (limit && !isNaN(limit)) {
            list = list.slice(0, parseInt(limit));
        }
        
        res.send({
            status: 'success',
            total: blackList.length,
            data: list
        });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 删除黑名单
app.delete('/api/blacklist/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const index = blackList.findIndex(item => item.id === id);
        
        if (index === -1) {
            return res.send({ status: 'error', msg: '未找到该黑名单记录' });
        }
        
        const removedName = blackList[index].name;
        blackList.splice(index, 1);
        
        res.send({ 
            status: 'success', 
            msg: `已删除黑名单: ${removedName}`,
            total: blackList.length
        });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// 清空黑名单
app.delete('/api/blacklist', (req, res) => {
    try {
        blackList = [];
        res.send({ status: 'success', msg: '黑名单已清空' });
    } catch (err) {
        res.send({ status: 'error', msg: err.message });
    }
});

// ==================== 启动服务 ====================
app.listen(port, () => {
    console.log('========================================');
    console.log('智能硬件控制服务已启动');
    console.log(`服务地址: http://localhost:${port}`);
    console.log('========================================');
    console.log('LED控制:');
    console.log(`  - 红灯: http://localhost:${port}/led/red`);
    console.log(`  - 绿灯: http://localhost:${port}/led/green`);
    console.log(`  - 蓝灯: http://localhost:${port}/led/blue`);
    console.log(`  - 白灯: http://localhost:${port}/led/white`);
    console.log(`  - 关灯: http://localhost:${port}/led/off`);
    console.log('========================================');
    console.log('舵机控制:');
    console.log(`  - 正向90°: http://localhost:${port}/servo/rotate/forward`);
    console.log(`  - 反向90°: http://localhost:${port}/servo/rotate/backward`);
    console.log(`  - 归位0°: http://localhost:${port}/servo/reset`);
    console.log('========================================');
    console.log('MQ-2传感器:');
    console.log(`  - 状态: http://localhost:${port}/mq2/status`);
    console.log('========================================');
    console.log('人脸识别日志:');
    console.log(`  - 添加日志: POST http://localhost:${port}/api/face-log`);
    console.log(`  - 获取日志: GET http://localhost:${port}/api/face-logs`);
    console.log(`  - 清除日志: DELETE http://localhost:${port}/api/face-logs`);
    console.log('========================================');
    console.log('黑名单管理:');
    console.log(`  - 添加黑名单: POST http://localhost:${port}/api/blacklist`);
    console.log(`  - 获取黑名单: GET http://localhost:${port}/api/blacklist`);
    console.log(`  - 删除黑名单: DELETE http://localhost:${port}/api/blacklist/:id`);
    console.log(`  - 清空黑名单: DELETE http://localhost:${port}/api/blacklist`);
    console.log('========================================');
});

// ==================== 退出清理 ====================
process.on('SIGINT', () => {
    console.log('\n正在清理GPIO资源...');
    rpio.close(LED_RED);
    rpio.close(LED_GREEN);
    rpio.close(LED_BLUE);
    rpio.close(SERVO_PIN);
    rpio.close(MQ2_PIN);
    console.log('GPIO资源已清理');
    process.exit();
});
