        // 全局变量
        let video = null;
        let canvas = null;
        let stream = null;
        let isDetecting = false;
        let currentModel = 'tiny'; // 默认使用轻量级模型以提高速度和灵敏度
        let minConfidence = 0.3; // 降低默认置信度以提高检测灵敏度
        
        // 人脸对比相关变量
        let referenceFaceDescriptor = null;
        let referenceFaceDescriptors = []; // 存储所有基准人脸描述符
        let compareFaceDescriptor = null;
        let compareImageElement = null;
        const STORAGE_KEY = 'reference_face_descriptor';
        
        // 音频控制变量
        let audioPlayed = false; // 标记音频是否已经播放过
        let servoRotated = false; // 标记舵机是否已经旋转过
        let alertAudioPlayed = false; // 标记警告音频是否已经播放过
        let isRecognitionPaused = false; // 标记识别是否暂停（5秒内不识别）
        let fireAlarmPlayed = false; // 标记火灾警报是否已经播放过

        // 日志记录配置
        const LOG_API_URL = 'http://localhost:3000/api/face-log';

        // 记录人脸识别日志
        async function logFaceRecognition(status, message, similarity = null, gender = null, age = null, expression = null) {
            try {
                await fetch(LOG_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        status,
                        message,
                        similarity,
                        gender,
                        age,
                        expression
                    })
                });
            } catch (error) {
                console.error('日志记录失败:', error);
            }
        }

        // 检查是否在黑名单中
        async function checkBlackList(descriptor, detection) {
            try {
                const response = await fetch(BLACKLIST_API_URL);
                const result = await response.json();

                if (result.status === 'success' && result.data.length > 0) {
                    // 获取黑名单描述符列表
                    const blacklistDescriptors = await fetchBlackListDescriptors();
                    
                    if (blacklistDescriptors.length > 0) {
                        // 检查是否匹配黑名单
                        for (let item of blacklistDescriptors) {
                            const distance = faceapi.euclideanDistance(descriptor, item.descriptor);
                            if (distance < 0.6) {
                                console.log(`检测到黑名单用户: ${item.name}, 距离: ${distance.toFixed(4)}`);
                                
                                // 播放黑名单警报音频
                                if (blacklistAudioElement && !blacklistAlertPlayed) {
                                    blacklistAudioElement.currentTime = 0;
                                    blacklistAudioElement.play().catch(err => {
                                        console.error('播放黑名单警报失败:', err);
                                    });
                                    blacklistAlertPlayed = true;
                                    
                                    // 亮红灯
                                    controlLed('red');
                                    
                                    // 记录黑名单识别日志
                                    logFaceRecognition(
                                        'failed',
                                        `检测到黑名单用户: ${item.name}`,
                                        1 - distance,
                                        detection.gender,
                                        detection.age,
                                        detection.expressions ? Object.keys(detection.expressions).reduce((a, b) => detection.expressions[a] > detection.expressions[b] ? a : b) : null
                                    );
                                    
                                    // 暂停识别5秒
                                    isRecognitionPaused = true;
                                    
                                    setTimeout(() => {
                                        blacklistAlertPlayed = false;
                                        controlLed('off');
                                        isRecognitionPaused = false;
                                    }, 5000);
                                }
                                
                                return;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('黑名单检测失败:', error);
            }
        }

        // 获取黑名单描述符
        async function fetchBlackListDescriptors() {
            try {
                const response = await fetch(BLACKLIST_API_URL);
                const result = await response.json();
                
                if (result.status === 'success') {
                    return result.data;
                }
                return [];
            } catch (error) {
                console.error('获取黑名单失败:', error);
                return [];
            }
        }

        // DOM元素
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const modelSelect = document.getElementById('modelSelect');
        const confidenceSlider = document.getElementById('confidenceSlider');
        const confidenceValue = document.getElementById('confidenceValue');
        const statusElement = document.getElementById('status');
        
        // 人脸对比DOM元素
        const saveFaceBtn = document.getElementById('saveFaceBtn');
        const captureFaceBtn = document.getElementById('captureFaceBtn');
        const uploadFaceBtn = document.getElementById('uploadFaceBtn');
        const compareFaceBtn = document.getElementById('compareFaceBtn');
        const clearFaceBtn = document.getElementById('clearFaceBtn');
        const compareResultElement = document.getElementById('compareResult');
        
        // 音频元素
        const audioElement = document.querySelector('.welcome-video');
        const alertAudioElement = document.querySelector('.alert-video');
        const fireAlarmElement = document.querySelector('.fire-alarm-video');
        const blacklistAudioElement = document.querySelector('.blacklist-video');

        // 黑名单检测配置
        const BLACKLIST_API_URL = 'http://localhost:3000/api/blacklist';
        let blacklistAlertPlayed = false; // 标记黑名单警报是否已播放

        // 初始化
        async function init() {
            video = document.getElementById('video');
            canvas = document.getElementById('canvas');
            
            // 从localStorage加载基准人脸
            loadReferenceFaceFromStorage();
            
            // 初始化清除按钮状态
            clearFaceBtn.disabled = !referenceFaceDescriptor;
            
            // 更新状态
            statusElement.textContent = '状态：初始化完成，等待启动摄像头...';
            
            // 事件监听
                startBtn.addEventListener('click', startDetection);
                stopBtn.addEventListener('click', stopDetection);
                modelSelect.addEventListener('change', handleModelChange);
                confidenceSlider.addEventListener('input', updateConfidence);
                
                // 人脸对比事件监听
                saveFaceBtn.addEventListener('click', saveReferenceFace);
                captureFaceBtn.addEventListener('click', captureCompareFace);
                uploadFaceBtn.addEventListener('change', handleUploadFace);
                compareFaceBtn.addEventListener('click', compareFaces);
                clearFaceBtn.addEventListener('click', clearReferenceFaceFromStorage);
        }

        // 启动摄像头和检测
        async function startDetection() {
            try {
                // 重置音频和舵机播放标记
                audioPlayed = false;
                servoRotated = false;
                alertAudioPlayed = false;
                isRecognitionPaused = false;
                fireAlarmPlayed = false;
                
                // 关闭所有LED灯
                await controlLed('off');
                
                // 检查浏览器是否支持
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    // 增强的错误检测，检查是否是安全上下文问题
                    const isSecureContext = window.isSecureContext;
                    const protocol = window.location.protocol;
                    
                    let errorMessage = '您的浏览器不支持摄像头访问功能，请使用Chrome、Firefox等现代浏览器';
                    if (!isSecureContext && protocol === 'http:') {
                        errorMessage = '摄像头访问需要在安全上下文(HTTPS)中运行<br>当前是HTTP协议，无法访问摄像头<br>请将网站部署到HTTPS环境或在本地使用localhost访问';
                    }
                    throw new Error(errorMessage);
                }
                
                // 启动摄像头 - 优化请求前置摄像头的逻辑
                statusElement.textContent = '状态：正在启动摄像头...';
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 640 }, // 降低分辨率以提高性能
                        height: { ideal: 480 },
                        facingMode: {
                            exact: 'user'  // 使用exact确保优先使用前置摄像头
                        }
                    }
                }).catch(err => {
                    // 如果exact模式失败，尝试使用普通模式
                    if (err.name === 'OverconstrainedError') {
                        console.log('精确模式请求前置摄像头失败，尝试普通模式');
                        return navigator.mediaDevices.getUserMedia({
                            video: {
                                width: { ideal: 640 },
                                height: { ideal: 480 },
                                facingMode: 'user'  // 普通模式，让浏览器自动选择最合适的前置摄像头
                            }
                        });
                    }
                    throw err;
                });
                
                video.srcObject = stream;
                await video.play();
                
                // 调整画布尺寸
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                // 加载模型
                const modelsLoaded = await loadModels();
                
                if (!modelsLoaded) {
                    // 如果模型加载失败，停止启动流程
                    console.log('模型加载失败，停止检测流程');
                    stopDetection();
                    return;
                }
                
                // 更新按钮状态
                startBtn.disabled = true;
                stopBtn.disabled = false;
                modelSelect.disabled = true;
                confidenceSlider.disabled = true;
                saveFaceBtn.disabled = false;
                captureFaceBtn.disabled = false;
                uploadFaceBtn.disabled = false;
                compareFaceBtn.disabled = false;
                clearFaceBtn.disabled = !referenceFaceDescriptor;
                
                // 开始检测循环
                isDetecting = true;
                statusElement.textContent = '状态：开始检测...';
                
                // 等待100ms后开始检测，确保视频流稳定
                setTimeout(() => {
                    if (isDetecting) {
                        detectFrame();
                    }
                }, 100);
                
            } catch (error) {
                console.error('启动失败:', error);
                
                // 更友好的错误提示
                if (error.name === 'NotAllowedError' || error.message.includes('Permission denied')) {
                    statusElement.innerHTML = '状态：<span style="color: red;">摄像头权限被拒绝</span><br>请在浏览器地址栏左侧的"锁"图标中允许网站访问您的摄像头，然后重试';
                } else if (error.name === 'NotFoundError') {
                    statusElement.innerHTML = '状态：<span style="color: red;">未检测到摄像头设备</span><br>请确保您的设备已连接摄像头并正常工作';
                } else if (error.name === 'OverconstrainedError') {
                    statusElement.innerHTML = '状态：<span style="color: red;">无法访问前置摄像头</span><br>您的设备可能不支持前置摄像头或该功能被禁用';
                } else if (error.message.includes('HTTPS')) {
                    statusElement.innerHTML = `状态：<span style="color: red;">安全上下文错误</span><br>${error.message}<br>详细错误请查看控制台`;
                } else {
                    statusElement.innerHTML = `状态：<span style="color: red;">启动失败</span><br>${error.message}<br>详细错误请查看控制台`;
                }
                stopDetection();
            }
        }

        // 停止检测
        function stopDetection() {
            isDetecting = false;
            
            // 重置音频和舵机标记
            audioPlayed = false;
            servoRotated = false;
            alertAudioPlayed = false;
            isRecognitionPaused = false;
            fireAlarmPlayed = false;
            
            // 关闭LED灯
            controlLed('off');
            
            // 停止视频流
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            
            // 更新按钮状态
            startBtn.disabled = false;
            stopBtn.disabled = true;
            modelSelect.disabled = false;
            confidenceSlider.disabled = false;
            saveFaceBtn.disabled = true;
            captureFaceBtn.disabled = true;
            uploadFaceBtn.disabled = true;
            compareFaceBtn.disabled = true;
            clearFaceBtn.disabled = !referenceFaceDescriptor;
            
            // 更新状态
            statusElement.textContent = '状态：已停止';
            console.log('检测已停止');
        }

        // 加载模型
        async function loadModels() {
            // 根据目录结构，修改为正确的模型路径
            const modelPath = './models';
            
            statusElement.textContent = '状态：正在加载本地模型...';
            
            try {
                // 基础模型，根据实际目录结构修正路径
                statusElement.textContent = '状态：正在加载模型... 关键点模型';
                await faceapi.nets.faceLandmark68Net.loadFromUri(modelPath + '/face_landmark_68');
                console.log('关键点模型加载成功');
                
                statusElement.textContent = '状态：正在加载模型... 识别模型';
                await faceapi.nets.faceRecognitionNet.loadFromUri(modelPath + '/face_recognition');
                console.log('识别模型加载成功');
                
                // 添加情绪识别模型
                statusElement.textContent = '状态：正在加载模型... 情绪识别模型';
                await faceapi.nets.faceExpressionNet.loadFromUri(modelPath + '/face_expression');
                console.log('情绪识别模型加载成功');
                
                // 添加年龄性别识别模型
                statusElement.textContent = '状态：正在加载模型... 年龄性别模型';
                await faceapi.nets.ageGenderNet.loadFromUri(modelPath + '/age_gender_model');
                console.log('年龄性别模型加载成功');
                
                // 根据选择加载检测模型
                if (currentModel === 'tiny') {
                    statusElement.textContent = '状态：正在加载模型... 轻量级检测模型';
                    await faceapi.nets.tinyFaceDetector.loadFromUri(modelPath + '/tiny_face_detector');
                    console.log('轻量级检测模型加载成功');
                } else {
                    statusElement.textContent = '状态：正在加载模型... 高精度检测模型';
                    await faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath + '/ssd_mobilenetv1');
                    console.log('高精度检测模型加载成功');
                }
                
                statusElement.textContent = '状态：模型加载完成，准备开始检测';
                return true;
            } catch (error) {
                console.error('本地模型加载失败:', error);
                statusElement.innerHTML = `状态：<span style="color: red;">本地模型加载失败</span><br>${error.message}<br><br>请确保已将face-api.js模型文件下载到d:\ZoRo\desktop\毕设\models目录。<br>详细错误请查看控制台`;
                return false;
            }
        }

        // 检测帧
        async function detectFrame() {
            if (!isDetecting) return;
            
            let detections = [];
            let ctx = null;
            let resizedResults = [];
            
            try {
                // 选择检测器和配置，优化参数以提高检测灵敏度
                let options;
                if (currentModel === 'tiny') {
                    options = new faceapi.TinyFaceDetectorOptions({
                        inputSize: 320, // 降低输入尺寸以提高速度
                        scoreThreshold: minConfidence
                    });
                } else {
                    options = new faceapi.SsdMobilenetv1Options({
                        minConfidence: minConfidence,
                        maxResults: 10 // 最多检测10张人脸
                    });
                }
                
                // 使用正确的链式调用方式进行检测
                const startTime = Date.now();
                
                // 检测人脸并添加情绪识别、年龄性别分析和人脸描述符
                detections = await faceapi.detectAllFaces(
                    video, 
                    options
                ).withFaceLandmarks()
                 .withFaceExpressions()
                 .withAgeAndGender()
                 .withFaceDescriptors();
                
                const endTime = Date.now();
                
                // 更新状态显示处理时间
                statusElement.textContent = `状态：检测中... 处理时间: ${endTime - startTime}ms 检测到: ${detections.length}张人脸`;
                
                // 清除画布
                ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // 绘制检测结果
                if (detections.length > 0) {
                    // 调整检测结果尺寸以匹配画布
                    const dims = faceapi.matchDimensions(canvas, video, true);
                    resizedResults = faceapi.resizeResults(detections, dims);
                    
                    // 手动绘制检测框
                    resizedResults.forEach(result => {
                        const { x, y, width, height } = result.detection.box;
                        
                        // 绘制检测框
                        ctx.strokeStyle = '#4a6cf7';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(x, y, width, height);
                        
                        // 绘制置信度
                        ctx.fillStyle = 'rgba(74, 108, 247, 0.8)';
                        ctx.font = '12px Arial';
                        ctx.fillText(`置信度: ${(result.detection.score * 100).toFixed(1)}%`, x, y > 15 ? y - 5 : 15);
                        
                        // 如果有关键点，绘制关键点
                        if (result.landmarks) {
                            ctx.fillStyle = '#ff6b6b';
                            result.landmarks.positions.forEach(point => {
                                ctx.beginPath();
                                ctx.arc(point.x, point.y, 2, 0, 2 * Math.PI);
                                ctx.fill();
                            });
                        }
                        
                        // 绘制性别和年龄信息
                        if (result.gender && result.age) {
                            const gender = result.gender;
                            const genderProbability = Math.round(result.genderProbability * 100);
                            const age = Math.round(result.age);
                            
                            ctx.fillStyle = 'rgba(74, 108, 247, 0.8)';
                            ctx.font = '12px Arial';
                            ctx.fillText(`${gender === 'male' ? '男' : '女'} (${genderProbability}%)`, x, y + height + 15);
                            ctx.fillText(`年龄: ${age}岁`, x, y + height + 30);
                        }
                        
                        // 绘制情绪识别结果
                        if (result.expressions) {
                            const expressions = result.expressions;
                            // 获取最可能的表情
                            const highestExpression = Object.entries(expressions)
                                .sort(([,a], [,b]) => b - a)[0];
                            
                            const expressionName = highestExpression[0];
                            const expressionProbability = Math.round(highestExpression[1] * 100);
                            
                            // 将英文表情名称转换为中文
                            const expressionMap = {
                                'happy': '开心',
                                'sad': '悲伤',
                                'angry': '生气',
                                'fearful': '害怕',
                                'disgusted': '厌恶',
                                'surprised': '惊讶',
                                'neutral': '中性'
                            };
                            
                            const chineseExpression = expressionMap[expressionName] || expressionName;
                            
                            ctx.fillStyle = 'rgba(255, 107, 107, 0.8)';
                            ctx.font = '12px Arial';
                            ctx.fillText(`${chineseExpression} (${expressionProbability}%)`, x, y + height + 45);
                        }
                    });
                    
                    // 添加人脸数量提示
                    ctx.fillStyle = 'rgba(74, 108, 247, 0.8)';
                    ctx.font = 'bold 16px Arial';
                    ctx.fillText(`检测到 ${detections.length} 张人脸`, 10, 30);
                } else {
                    // 如果没有检测到人脸，在画布上显示提示
                    ctx.fillStyle = 'rgba(255, 107, 107, 0.8)';
                    ctx.font = 'bold 16px Arial';
                    ctx.fillText('未检测到人脸', 10, 30);
                }
                
            } catch (error) {
                console.error('检测过程中出错:', error);
                statusElement.innerHTML = `状态：<span style="color: red;">检测出错</span><br>${error.message}<br>详细错误请查看控制台`;
                stopDetection();
                return;
            }
            
            // 如果存在基准人脸，自动进行对比
            if (referenceFaceDescriptors.length > 0 && detections.length > 0 && !isRecognitionPaused) {
                // 为检测到的每个人脸计算与所有基准人脸的相似度
                detections.forEach((detection, index) => {
                    if (detection.descriptor) {
                        // 与每个基准人脸进行对比
                        let bestMatch = null;
                        let bestDistance = Infinity;
                        let bestSimilarity = 0;
                        
                        referenceFaceDescriptors.forEach((ref, refIndex) => {
                            // 计算欧几里得距离
                            const distance = faceapi.euclideanDistance(ref.descriptor, detection.descriptor);
                            
                            // 计算相似度百分比（阈值0.6为匹配）
                            const similarity = 100 - (distance * 100);
                            
                            // 寻找最佳匹配
                            if (distance < bestDistance) {
                                bestDistance = distance;
                                bestSimilarity = similarity;
                                bestMatch = {
                                    refIndex: refIndex,
                                    isMatch: distance < 0.6
                                };
                            }
                        });
                        
                        // 控制台输出最佳对比结果
                        console.log(`人脸 ${index + 1} 对比结果:`);
                        console.log(`  最佳欧几里得距离: ${bestDistance.toFixed(4)}`);
                        console.log(`  最佳相似度: ${bestSimilarity.toFixed(2)}%`);
                        console.log(`  最佳匹配状态: ${bestMatch.isMatch ? '匹配' : '不匹配'}`);
                        console.log(`  置信度: ${(detection.detection.score * 100).toFixed(1)}%`);
                        
                        // 检查是否在黑名单中
                        checkBlackList(detection.descriptor, detection);
                        
                        // 记录人脸识别日志
                        const gender = detection.gender || null;
                        const age = detection.age || null;
                        const expression = detection.expressions ? Object.keys(detection.expressions).reduce((a, b) => detection.expressions[a] > detection.expressions[b] ? a : b) : null;
                        
                        if (bestMatch.isMatch) {
                            logFaceRecognition(
                                'success',
                                `人脸识别成功，相似度 ${bestSimilarity.toFixed(2)}%`,
                                bestSimilarity / 100,
                                gender,
                                age,
                                expression
                            );
                        } else {
                            logFaceRecognition(
                                'failed',
                                `人脸识别失败，相似度 ${bestSimilarity.toFixed(2)}%`,
                                bestSimilarity / 100,
                                gender,
                                age,
                                expression
                            );
                        }
                        
                        // 如果需要，在画布上绘制匹配结果
                        if (resizedResults && resizedResults[index]) {
                            const { x, y, width, height } = resizedResults[index].detection.box;
                            
                            // 绘制匹配状态框
                            ctx.strokeStyle = bestMatch.isMatch ? '#4ecdc4' : '#ff6b6b';
                            ctx.lineWidth = 3;
                            ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
                            
                            // 绘制匹配标签
                            ctx.fillStyle = bestMatch.isMatch ? 'rgba(78, 205, 196, 0.8)' : 'rgba(255, 107, 107, 0.8)';
                            ctx.font = 'bold 14px Arial';
                            const matchLabel = bestMatch.isMatch ? `匹配 (${bestSimilarity.toFixed(0)}%)` : '不匹配';
                            ctx.fillText(matchLabel, x, y - 10);
                            
                            // 播放欢迎音频（仅播放一次）
                            if (bestMatch.isMatch && audioElement && !audioPlayed) {
                                audioElement.currentTime = 0; // 重置音频到开头
                                audioElement.play().catch(err => {
                                    console.error('播放音频失败:', err);
                                });
                                audioPlayed = true; // 标记音频已播放
                                
                                // 亮绿灯
                                controlLed('green');
                                
                                // 设置识别暂停标记，5秒内不再识
                                isRecognitionPaused = true;
                            }
                            
                            // 播放警告音频（比对失败时播放，仅播放一次，且未检测到黑名单时）
                            if (!bestMatch.isMatch && alertAudioElement && !alertAudioPlayed && !blacklistAlertPlayed) {
                                alertAudioElement.currentTime = 0; // 重置音频到开头
                                alertAudioElement.play().catch(err => {
                                    console.error('播放警告音频失败:', err);
                                });
                                alertAudioPlayed = true; // 标记警告音频已播放
                                statusElement.innerHTML = '状态：识别失败，访问被拒绝';
                                
                                // 亮红灯
                                controlLed('red');
                                
                                // 设置识别暂停标记，5秒内不再识别
                                isRecognitionPaused = true;
                                
                                // 5秒后重置所有标记并关闭LED灯
                                setTimeout(async () => {
                                    alertAudioPlayed = false;
                                    audioPlayed = false;
                                    servoRotated = false;
                                    isRecognitionPaused = false;
                                    await controlLed('off');
                                }, 5000);
                            }
                            
                            // 人脸比对成功后控制舵机正向旋转90度（仅旋转一次）
                            if (bestMatch.isMatch && !servoRotated) {
                                controlServoForward();
                                servoRotated = true; // 标记舵机已旋转
                            }
                        }
                    }
                });
            }
            
            // 检测MQ-2传感器状态
            await checkMQ2Sensor();
            
            // 继续检测，使用setTimeout代替requestAnimationFrame以降低CPU使用率
            if (isDetecting) {
                setTimeout(detectFrame, 100); // 每100ms检测一次
            }
        }

        // 处理模型选择变化
        function handleModelChange(e) {
            currentModel = e.target.value;
            if (isDetecting) {
                // 如果正在检测，重新加载模型
                statusElement.textContent = '状态：模型切换中，请稍候...';
                stopDetection();
                setTimeout(startDetection, 500);
            }
        }

        // 更新置信度
        function updateConfidence(e) {
            minConfidence = parseFloat(e.target.value);
            confidenceValue.textContent = minConfidence.toFixed(2);
            
            // 如果正在检测，应用新的置信度
            if (isDetecting) {
                // 需要重新加载模型以应用新的置信度
                statusElement.textContent = '状态：置信度更新中，请稍候...';
                stopDetection();
                setTimeout(startDetection, 500);
            }
        }

        // 人脸对比相关函数
        // 存储基准人脸到localStorage
        function saveReferenceFaceToStorage() {
            if (referenceFaceDescriptor) {
                // 将Float32Array转换为普通数组以便存储
                const descriptorArray = Array.from(referenceFaceDescriptor);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(descriptorArray));
                console.log('基准人脸已保存到localStorage');
            }
        }
        
        // 从localStorage加载所有基准人脸
        function loadReferenceFaceFromStorage() {
            // 加载所有基准人脸描述符
            referenceFaceDescriptors = [];
            
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('reference_face_descriptor_')) {
                    try {
                        const storedData = localStorage.getItem(key);
                        if (storedData) {
                            const descriptorArray = JSON.parse(storedData);
                            const descriptor = new Float32Array(descriptorArray);
                            referenceFaceDescriptors.push({
                                key: key,
                                descriptor: descriptor
                            });
                        }
                    } catch (error) {
                        console.error(`从localStorage加载基准人脸 ${key} 失败:`, error);
                        localStorage.removeItem(key); // 清除损坏的数据
                        i--; // 因为删除后长度变化，需要调整索引
                    }
                }
            }
            
            if (referenceFaceDescriptors.length > 0) {
                // 设置当前基准人脸为第一个
                referenceFaceDescriptor = referenceFaceDescriptors[0].descriptor;
                compareResultElement.textContent = `对比结果：已从本地存储加载 ${referenceFaceDescriptors.length} 个基准人脸，等待对比人脸...`;
                console.log(`已从localStorage加载 ${referenceFaceDescriptors.length} 个基准人脸`);
            }
        }
        
        // 清除localStorage中的所有基准人脸
        function clearReferenceFaceFromStorage() {
            // 删除所有以reference_face_descriptor_开头的键
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('reference_face_descriptor_')) {
                    localStorage.removeItem(key);
                    i--; // 因为删除后长度变化，需要调整索引
                }
            }
            referenceFaceDescriptor = null;
            audioPlayed = false; // 重置音频播放标记
            compareResultElement.textContent = '对比结果：所有基准人脸已清除';
            console.log('已清除localStorage中的所有基准人脸');
        }
        
        // 存储基准人脸
        async function saveReferenceFace() {
            try {
                // 选择检测器和配置
                let options;
                if (currentModel === 'tiny') {
                    options = new faceapi.TinyFaceDetectorOptions({
                        inputSize: 320,
                        scoreThreshold: minConfidence
                    });
                } else {
                    options = new faceapi.SsdMobilenetv1Options({
                        minConfidence: minConfidence
                    });
                }
                
                // 检测人脸并获取描述符
                statusElement.textContent = '状态：正在检测并存储基准人脸...';
                const detections = await faceapi.detectAllFaces(
                    video, 
                    options
                ).withFaceLandmarks()
                 .withFaceDescriptors();
                
                if (detections.length === 0) {
                    statusElement.textContent = '状态：未检测到人脸，请调整姿势后重试';
                    return;
                } else if (detections.length > 1) {
                    statusElement.textContent = '状态：检测到多张人脸，请确保只有一张人脸在画面中';
                    return;
                }
                
                referenceFaceDescriptor = detections[0].descriptor;
                
                // 保存到localStorage
                saveReferenceFaceToStorage();
                
                statusElement.textContent = '状态：基准人脸已存储（已保存到本地）';
                compareResultElement.textContent = '对比结果：基准人脸已存储，等待对比人脸...';
                
                console.log('基准人脸已存储');
            } catch (error) {
                console.error('存储基准人脸失败:', error);
                statusElement.textContent = '状态：存储基准人脸失败，请重试';
            }
        }
        
        // 拍摄对比人脸
        async function captureCompareFace() {
            try {
                // 选择检测器和配置
                let options;
                if (currentModel === 'tiny') {
                    options = new faceapi.TinyFaceDetectorOptions({
                        inputSize: 320,
                        scoreThreshold: minConfidence
                    });
                } else {
                    options = new faceapi.SsdMobilenetv1Options({
                        minConfidence: minConfidence
                    });
                }
                
                // 检测人脸并获取描述符
                statusElement.textContent = '状态：正在拍摄并检测对比人脸...';
                const detections = await faceapi.detectAllFaces(
                    video, 
                    options
                ).withFaceLandmarks()
                 .withFaceDescriptors();
                
                if (detections.length === 0) {
                    statusElement.textContent = '状态：未检测到人脸，请调整姿势后重试';
                    return;
                } else if (detections.length > 1) {
                    statusElement.textContent = '状态：检测到多张人脸，请确保只有一张人脸在画面中';
                    return;
                }
                
                compareFaceDescriptor = detections[0].descriptor;
                statusElement.textContent = '状态：对比人脸已拍摄并检测完成';
                compareResultElement.textContent = '对比结果：对比人脸已准备好，可以开始对比';
                
                console.log('对比人脸已拍摄');
            } catch (error) {
                console.error('拍摄对比人脸失败:', error);
                statusElement.textContent = '状态：拍摄对比人脸失败，请重试';
            }
        }
        
        // 上传基准人脸
        async function handleUploadFace(event) {
            try {
                const files = Array.from(event.target.files);
                if (files.length === 0) return;
                
                statusElement.textContent = `状态：正在处理 ${files.length} 张上传的照片...`;
                let processedCount = 0;
                let savedCount = 0;
                
                // 处理每张上传的照片
                for (const file of files) {
                    try {
                        // 读取文件并创建图像元素
                        const imgElement = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                const img = new Image();
                                img.onload = () => resolve(img);
                                img.onerror = reject;
                                img.src = e.target.result;
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                        
                        // 选择检测器和配置
                        let options;
                        if (currentModel === 'tiny') {
                            options = new faceapi.TinyFaceDetectorOptions({
                                inputSize: 320,
                                scoreThreshold: minConfidence
                            });
                        } else {
                            options = new faceapi.SsdMobilenetv1Options({
                                minConfidence: minConfidence
                            });
                        }
                        
                        // 检测人脸并获取描述符
                        const detections = await faceapi.detectAllFaces(
                            imgElement, 
                            options
                        ).withFaceLandmarks()
                         .withFaceDescriptors();
                        
                        processedCount++;
                        statusElement.textContent = `状态：正在处理 ${processedCount}/${files.length} 张照片...`;
                        
                        if (detections.length === 0) {
                            console.log(`照片 ${file.name} 中未检测到人脸`);
                            continue;
                        } else if (detections.length > 1) {
                            console.log(`照片 ${file.name} 中检测到多张人脸，跳过`);
                            continue;
                        }
                        
                        // 保存到基准人脸列表
                        const faceDescriptor = detections[0].descriptor;
                        
                        // 生成唯一键名
                        const timestamp = Date.now();
                        const keyName = `reference_face_descriptor_${timestamp}`;
                        
                        // 保存到localStorage
                        localStorage.setItem(keyName, JSON.stringify(Array.from(faceDescriptor)));
                        
                        // 保存到当前基准人脸（最后一张）
                        referenceFaceDescriptor = faceDescriptor;
                        
                        savedCount++;
                        console.log(`已保存基准人脸: ${keyName}`);
                        
                    } catch (error) {
                        console.error(`处理照片 ${file.name} 失败:`, error);
                    }
                }
                
                statusElement.textContent = `状态：处理完成，成功保存 ${savedCount}/${files.length} 张基准人脸`;
                compareResultElement.textContent = '对比结果：基准人脸已更新，可以开始对比';
                
                // 更新清除按钮状态
                clearFaceBtn.disabled = savedCount === 0;
                
                console.log(`上传完成，共处理 ${files.length} 张照片，成功保存 ${savedCount} 个基准人脸`);
                
            } catch (error) {
                console.error('上传基准人脸失败:', error);
                statusElement.textContent = '状态：上传基准人脸失败，请重试';
            }
        }
        
        // 开始人脸对比
        function compareFaces() {
            if (referenceFaceDescriptors.length === 0) {
                compareResultElement.innerHTML = '对比结果：<span style="color: red;">请先存储基准人脸</span>';
                return;
            }
            
            if (!compareFaceDescriptor) {
                compareResultElement.innerHTML = '对比结果：<span style="color: red;">请先拍摄或上传对比人脸</span>';
                return;
            }
            
            try {
                // 与所有基准人脸进行对比，寻找最佳匹配
                let bestMatch = null;
                let bestDistance = Infinity;
                let bestSimilarity = 0;
                
                referenceFaceDescriptors.forEach((ref, refIndex) => {
                    // 计算两个人脸描述符的相似度
                    const distance = faceapi.euclideanDistance(ref.descriptor, compareFaceDescriptor);
                    const similarity = 1 - distance;
                    
                    // 寻找最佳匹配
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestSimilarity = similarity;
                        bestMatch = {
                            refIndex: refIndex,
                            isMatch: similarity >= 0.6
                        };
                    }
                });
                
                // 转换为百分比
                const similarityPercentage = Math.round(bestSimilarity * 100);
                
                // 显示结果
                let resultText = `对比结果：最佳相似度 ${similarityPercentage}%<br>`;
                if (bestMatch.isMatch) {
                    resultText += `<span style="color: green;">✅ 与基准人脸 #${bestMatch.refIndex + 1} 匹配</span>`;
                    
                    // 记录识别成功日志
                    logFaceRecognition(
                        'success',
                        `手动对比成功，与基准人脸 #${bestMatch.refIndex + 1} 匹配，相似度 ${similarityPercentage}%`,
                        bestSimilarity
                    );
                    
                    // 播放欢迎音频（仅播放一次）
                    if (audioElement && !audioPlayed) {
                        audioElement.currentTime = 0; // 重置音频到开头
                        audioElement.play().catch(err => {
                            console.error('播放音频失败:', err);
                        });
                        audioPlayed = true; // 标记音频已播放
                    }
                } else {
                    resultText += `<span style="color: red;">❌ 与所有基准人脸均不匹配</span>`;
                    
                    // 记录识别失败日志
                    logFaceRecognition(
                        'failed',
                        `手动对比失败，与所有基准人脸均不匹配，相似度 ${similarityPercentage}%`,
                        bestSimilarity
                    );
                }
                
                compareResultElement.innerHTML = resultText;
                statusElement.textContent = '状态：人脸对比完成';
                
                console.log(`人脸对比完成，最佳相似度：${similarityPercentage}%`);
            } catch (error) {
                console.error('人脸对比失败:', error);
                compareResultElement.innerHTML = '对比结果：<span style="color: red;">对比失败，请重试</span>';
                statusElement.textContent = '状态：人脸对比失败，请重试';
            }
        }
        
        // LED控制函数
        async function controlLed(color) {
            const piIp = 'localhost';
            const port = 3000;
            try {
                const response = await fetch(`http://${piIp}:${port}/led/${color}`);
                const result = await response.json();
                if (result.status === 'success') {
                    console.log('LED控制成功:', result.msg);
                } else {
                    console.error('LED控制失败:', result.msg);
                }
            } catch (err) {
                console.error('LED控制请求失败:', err);
            }
        }

        // MQ-2传感器检测函数
        async function checkMQ2Sensor() {
            const piIp = 'localhost';
            const port = 3000;
            try {
                const response = await fetch(`http://${piIp}:${port}/mq2/status`);
                const data = await response.json();
                
                if (data.status === 'success' && data.level === 'danger' && !fireAlarmPlayed) {
                    // 检测到烟雾浓度过高，播放火灾警报
                    if (fireAlarmElement) {
                        fireAlarmElement.currentTime = 0;
                        fireAlarmElement.play().catch(err => {
                            console.error('播放火灾警报失败:', err);
                        });
                        fireAlarmPlayed = true;
                        statusElement.innerHTML = '状态：⚠️ 检测到烟雾/燃气！火灾警报已触发！';
                        console.log('火灾警报已触发:', data.statusText);
                        
                        // 亮红灯
                        await controlLed('red');
                    }
                } else if (data.status === 'success' && data.level === 'safe' && fireAlarmPlayed) {
                    // 烟雾浓度恢复正常，重置警报标记并关闭LED灯
                    fireAlarmPlayed = false;
                    console.log('烟雾浓度恢复正常');
                    await controlLed('off');
                }
            } catch (err) {
                console.error('MQ-2传感器检测失败:', err);
            }
        }

        // 舵机控制函数 - 正向旋转90度，保持5秒后归位
        async function controlServoForward() {
            const piIp = 'localhost';
            const port = 3000;
            try {
                statusElement.innerHTML = '状态：人脸比对成功！正在开门...';
                
                // 正向旋转90度
                const response = await fetch(`http://${piIp}:${port}/servo/rotate/forward`);
                const result = await response.json();
                
                if (result.status === 'success') {
                    console.log('舵机正向旋转90度成功:', result.msg);
                    statusElement.innerHTML = '状态：门已打开，保持5秒...';
                    
                    // 等待5秒
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // 归位到0度
                    const resetResponse = await fetch(`http://${piIp}:${port}/servo/reset`);
                    const resetResult = await resetResponse.json();
                    
                    if (resetResult.status === 'success') {
                        console.log('舵机归位成功:', resetResult.msg);
                        statusElement.innerHTML = '状态：门已关闭';
                        
                        // 关闭LED灯
                        await controlLed('off');
                        
                        // 重置标记，允许下次识别时再次触发
                        servoRotated = false;
                        audioPlayed = false;
                        alertAudioPlayed = false;
                        isRecognitionPaused = false;
                    } else {
                        console.error('舵机归位失败:', resetResult.msg);
                        statusElement.innerHTML = '状态：门关闭失败';
                    }
                } else {
                    console.error('舵机控制失败:', result.msg);
                    statusElement.innerHTML = '状态：开门失败';
                }
            } catch (err) {
                console.error('舵机控制请求失败:', err);
                statusElement.innerHTML = '状态：舵机控制失败';
            }
        }

        // 页面加载完成后初始化
        window.addEventListener('DOMContentLoaded', init);